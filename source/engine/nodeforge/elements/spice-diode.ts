// Diodes, zeners and LEDs as the NodeForge engine simulates them: by the SPICE diode device, with a
// model from the library (named by the part's `nfm` attribute and stored in the circuit) or the
// SPICE equivalent of the part's CircuitJS model. The part is drawn, edited and saved as CircuitJS's.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { XmlAttrs } from "../../circuitjs/core/elm";
import { DiodeElm, ZenerElm } from "../../circuitjs/elements/diode";
import { LEDElm } from "../../circuitjs/elements/semis";
import type { XmlNode } from "../../circuitjs/io/tokens";
import { GMIN, simSelfHeating, simTemperature } from "../devices/device";
import { DiodeDevice, diodeParams } from "../devices/diode";
import { circuitJSLeak, diodeCard } from "../spice/circuitjs";
import type { SpiceModel } from "../spice/parse";
import { findModel } from "../spice/registry";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeScript's rule for mixin bases
type DiodeClass = abstract new (...args: any[]) => DiodeElm;

/**
 * The SPICE-model behaviour, on top of a CircuitJS diode class. Which code simulates the part:
 * a model from the library (`spiceModel`) always runs as a SPICE device; otherwise the NodeForge
 * engine runs the SPICE equivalent of the part's CircuitJS model, and the CircuitJS solver runs
 * CircuitJS's own diode (so it stays exactly CircuitJS).
 */
function withSpiceModel<B extends DiodeClass>(Base: B) {
  abstract class SpiceDiode extends Base {
    /** A model from the library (a `.model … D` card) by name, or "" for the part's CircuitJS model. */
    spiceModel = "";
    device: DiodeDevice | null = null;
    /** Why the model can't be used (unknown name, wrong type), or null. */
    spiceProblem: string | null = null;
    /** What the device was built for (rebuilt when it changes). */
    private deviceKey = "";

    /** Use a model from the library (by name), or the part's CircuitJS model (""). */
    setSpiceModel(name: string): void {
      this.spiceModel = name;
      this.prepareDevice(this.sim?.accurate ?? false);
    }

    /** The SPICE card the part is simulated with (the library's, or its CircuitJS model's), or null. */
    spiceCard(): SpiceModel | null {
      if (!this.spiceModel) return this.model ? diodeCard(this.model) : null;
      const m = findModel(this.spiceModel)?.model;
      return m && m.type === "D" ? m : null;
    }

    /** Build the device the solver needs (called before each analysis). */
    prepareDevice(accurate: boolean): void {
      const cjs = !this.spiceModel && this.model ? diodeCard(this.model).source : "";
      // (a model redefined under the same name, as a custom one is when dialled, rebuilds it)
      const key = this.spiceModel ? `m:${this.spiceModel}:${findModel(this.spiceModel)?.text ?? ""}` : accurate ? `c:${cjs}` : "";
      const tkey = key && `${key}@${simTemperature(this.sim)}${simSelfHeating(this.sim) ? ":sh" : ""}`;
      if (tkey === this.deviceKey) return;
      this.deviceKey = tkey;
      this.spiceProblem = null;
      let m: SpiceModel | null = null;
      if (this.spiceModel) {
        const def = findModel(this.spiceModel);
        this.spiceProblem = !def ? `SPICE model ${this.spiceModel} isn't defined` : !def.model || def.model.type !== "D" ? `${this.spiceModel} isn't a diode model` : null;
        m = this.spiceProblem ? null : def!.model;
      } else if (accurate && this.model) m = diodeCard(this.model);
      const p = m ? diodeParams(m, simTemperature(this.sim)) : null;
      // a CircuitJS model: with its junction leak
      if (p && !this.spiceModel) p.gmin += circuitJSLeak(m!);
      // anode 0, cathode 1, the junction's anode side (internal) 2 with series resistance
      const nodes = this.getPostCount() + this.getInternalNodeCount();
      this.device = p ? new DiodeDevice(this, p, 0, 1, p.rs > 0 ? 2 : 0) : null;
      // self-heating (the circuit's setting, a model with RTH0): the temperature rise on a node of its own
      if (this.device && m && simSelfHeating(this.sim) && (m.params.get("rth0") ?? 0) > 0) {
        this.device.thermal = {
          model: m, area: 1, temp: simTemperature(this.sim), rth: m.params.get("rth0")!, cth: m.params.get("cth0") ?? 0,
          tn: p!.rs > 0 ? 3 : 2, gminExtra: p!.gmin - GMIN,
        };
      }
      // new nodes only if their number changed (a loaded part keeps its voltages)
      if (this.getPostCount() + this.getInternalNodeCount() !== nodes || this.volts.length !== nodes) this.allocNodes();
    }

    /** Does a SPICE device simulate the part now (else CircuitJS's diode, or nothing)? */
    private get spice(): boolean {
      return this.device !== null || this.spiceProblem !== null;
    }

    override undumpXml(xml: XmlNode): void {
      super.undumpXml(xml);
      this.spiceModel = xml.string("nfm", "") ?? "";
    }

    override dumpXml(a: XmlAttrs): void {
      super.dumpXml(a);
      if (this.spiceModel) a.push(["nfm", this.spiceModel]);
    }

    /** The text format has no room for a library model. */
    override textLossless(): boolean {
      return !this.spiceModel && super.textLossless();
    }

    override getInternalNodeCount(): number {
      if (!this.spice) return super.getInternalNodeCount();
      return this.device ? (this.device.ap !== this.device.a ? 1 : 0) + (this.device.thermal ? 1 : 0) : 0;
    }

    override nonLinear(): boolean {
      return true;
    }

    /** The junction's temperature (°C) while self-heating heats it (a model with RTH0), else null. */
    junctionTemperature(): number | null {
      const th = this.device?.thermal;
      return th ? th.temp - 273.15 + (this.volts[th.tn] ?? 0) : null;
    }

    override reset(): void {
      if (!this.spice) return super.reset();
      this.volts.fill(0);
      this.curcount = 0;
      this.device?.reset();
    }

    override stamp(): void {
      if (!this.spice) return super.stamp();
      if (this.spiceProblem) this.sim.stop(this.spiceProblem, this);
      this.device?.stamp();
    }

    override startIteration(): void {
      if (!this.spice) return super.startIteration();
      this.device?.startIteration();
    }

    override doStep(): void {
      if (!this.spice) return super.doStep();
      this.device?.doStep();
    }

    override calculateCurrent(): void {
      if (!this.spice) return super.calculateCurrent();
      this.current = this.device ? this.device.junctionCurrent() : 0;
    }

    override stepFinished(): void {
      if (!this.spice) return super.stepFinished();
      this.device?.stepFinished();
      if (Math.abs(this.current) > 1e12) this.sim.stop("max current exceeded", this);
    }
  }
  return SpiceDiode;
}

export class SpiceDiodeElm extends withSpiceModel(DiodeElm) {
  static readonly baseName = "DiodeElm";
  /** Saved under CircuitJS's tag. */
  static override get xmlTag(): string {
    return DiodeElm.xmlTag;
  }
}
export class SpiceZenerElm extends withSpiceModel(ZenerElm) {
  static readonly baseName = "ZenerElm";
  /** Saved under CircuitJS's tag. */
  static override get xmlTag(): string {
    return ZenerElm.xmlTag;
  }
}
export class SpiceLEDElm extends withSpiceModel(LEDElm) {
  static readonly baseName = "LEDElm";
  /** Saved under CircuitJS's tag. */
  static override get xmlTag(): string {
    return LEDElm.xmlTag;
  }
}
