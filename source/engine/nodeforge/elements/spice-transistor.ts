// Bipolar transistors as the NodeForge engine simulates them: by the SPICE Gummel-Poon device, with
// a model from the library (an NPN / PNP card, named by the part's `nfm` attribute and stored in
// the circuit) or the SPICE equivalent of the part's CircuitJS model (BF its beta). Under the
// CircuitJS solver a part on its CircuitJS model runs CircuitJS's own transistor, so CircuitJS mode
// stays exactly CircuitJS. The part is drawn, edited and saved as CircuitJS's.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { XmlAttrs } from "../../circuitjs/core/elm";
import { TransistorElm } from "../../circuitjs/elements/semis";
import type { XmlNode } from "../../circuitjs/io/tokens";
import { BjtDevice, bjtParams } from "../devices/bjt";
import { simTemperature } from "../devices/device";
import { transistorCard } from "../spice/circuitjs";
import type { SpiceModel } from "../spice/parse";
import { findModel } from "../spice/registry";

/** CircuitJS's posts: base 0, collector 1, emitter 2. */
const BASE = 0, COLLECTOR = 1, EMITTER = 2;

export class SpiceTransistorElm extends TransistorElm {
  static readonly baseName: string = "TransistorElm";
  /** Saved under CircuitJS's tag. */
  static override get xmlTag(): string {
    return TransistorElm.xmlTag;
  }
  /** A model from the library (an NPN / PNP card) by name, or "" for the part's CircuitJS model. */
  spiceModel = "";
  device: BjtDevice | null = null;
  /** Why the model can't be used (unknown name, wrong type), or null. */
  spiceProblem: string | null = null;
  /** What of the model isn't simulated (it still runs without it). */
  spiceWarnings: string[] = [];
  /** Current into the device at each node (posts, then internal), at the last accepted step. */
  pinCurrents: number[] = [];
  private innerCount = 0;
  /** On its CircuitJS model (BF follows the part's beta). */
  private onCircuitJSModel = false;
  /** What the circuit's temperature does to BF (XTB's factor; 1 on a CircuitJS model, which has none). */
  private bfFactor = 1;
  /** What the device was built for (rebuilt when it changes). */
  private deviceKey = "";

  /** Use a model from the library (by name), or the part's CircuitJS model (""). */
  setSpiceModel(name: string): void {
    this.spiceModel = name;
    this.prepareDevice(this.sim?.accurate ?? false);
  }

  /** The SPICE card the part is simulated with (the library's, or its CircuitJS model's), or null. */
  spiceCard(): SpiceModel | null {
    if (!this.spiceModel) return this.model ? transistorCard(this.model, this.pnp, this.beta) : null;
    const m = findModel(this.spiceModel)?.model;
    return m && (m.type === "NPN" || m.type === "PNP") ? m : null;
  }

  /** Build the device the solver needs (called before each analysis). */
  prepareDevice(accurate: boolean): void {
    // (BF isn't part of the key: startIteration follows the part's beta)
    const cjs = !this.spiceModel && this.model ? transistorCard(this.model, this.pnp, 1).source : "";
    const key = this.spiceModel ? `m:${this.spiceModel}:${findModel(this.spiceModel)?.text ?? ""}:${this.pnp}` : accurate ? `c:${cjs}` : "";
    const tkey = key && `${key}@${simTemperature(this.sim)}`;
    if (tkey === this.deviceKey) return;
    this.deviceKey = tkey;
    this.spiceProblem = null;
    this.onCircuitJSModel = false;
    let m: SpiceModel | null = null;
    if (this.spiceModel) {
      const def = findModel(this.spiceModel);
      const type = def?.model?.type;
      if (!def) this.spiceProblem = `SPICE model ${this.spiceModel} isn't defined`;
      else if (type !== "NPN" && type !== "PNP") this.spiceProblem = `${this.spiceModel} isn't a transistor model (NPN, PNP)`;
      else if ((type === "PNP" ? -1 : 1) !== this.pnp) this.spiceProblem = `${this.spiceModel} is ${type}, the part isn't`;
      else m = def.model;
    } else if (accurate && this.model) {
      m = transistorCard(this.model, this.pnp, this.beta);
      this.onCircuitJSModel = true;
    }
    const nodes = this.getPostCount() + this.getInternalNodeCount();
    this.device = null;
    this.innerCount = 0;
    this.spiceWarnings = [];
    if (m) {
      const p = bjtParams(m, simTemperature(this.sim));
      this.bfFactor = p.bf / (m.params.get("bf") ?? 100);
      this.spiceWarnings = p.ignored.map((x) => `${x} not simulated`);
      // inner nodes after the posts, for each resistance the model has (RCO: the epi node, then
      // the intrinsic collector); the substrate is ground
      let next = this.getPostCount();
      const cx = p.gc > 0 ? next++ : COLLECTOR, cp = p.rco > 0 ? next++ : cx;
      const bp = p.rb > 0 ? next++ : BASE, ep = p.ge > 0 ? next++ : EMITTER;
      this.device = new BjtDevice(this, p, COLLECTOR, BASE, EMITTER, -1, cp, bp, ep, cx);
      this.innerCount = next - this.getPostCount();
    }
    // new nodes only if their number changed (a loaded part keeps its voltages)
    if (this.getPostCount() + this.getInternalNodeCount() !== nodes || this.volts.length !== nodes) this.allocNodes();
  }

  /** Does a SPICE device simulate the part now (else CircuitJS's transistor)? */
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
    return this.innerCount;
  }

  override reset(): void {
    if (!this.spice) return super.reset();
    this.volts.fill(0);
    this.curcount = 0;
    this.ib = this.ic = this.ie = 0;
    this.pinCurrents = [];
    this.device?.reset();
  }

  override stamp(): void {
    if (!this.spice) return super.stamp();
    if (this.spiceProblem) this.sim.stop(this.spiceProblem, this);
    this.device?.stamp();
  }

  override startIteration(): void {
    if (!this.spice) return super.startIteration();
    // on its CircuitJS model: the part's own beta (which tolerances vary), at the nominal temperature
    if (this.onCircuitJSModel && this.device) this.device.p.bf = this.beta * this.bfFactor;
    this.device?.startIteration();
  }

  override doStep(): void {
    if (!this.spice) return super.doStep();
    this.device?.doStep();
  }

  override calculateCurrent(): void {
    if (!this.spice) return super.calculateCurrent();
  }

  override stepFinished(): void {
    if (!this.spice) return super.stepFinished();
    const dev = this.device;
    if (!dev) return;
    dev.stepFinished();
    const into = new Array<number>(this.volts.length).fill(0);
    dev.currents(into);
    this.pinCurrents = into;
    // into the part at each post, as CircuitJS keeps them
    this.ib = into[BASE];
    this.ic = into[COLLECTOR];
    this.ie = into[EMITTER];
    if (Math.abs(this.ic) > 1e12 || Math.abs(this.ib) > 1e12) this.sim.stop("max current exceeded", this);
  }
}

/** New NPN and PNP parts (the Draw menu's), as CircuitJS's NTransistorElm / PTransistorElm. */
export class SpiceNTransistorElm extends SpiceTransistorElm {
  static override readonly baseName: string = "NTransistorElm";
  override initNew(): void {
    this.initNewPolarity(false);
  }
}
export class SpicePTransistorElm extends SpiceTransistorElm {
  static override readonly baseName: string = "PTransistorElm";
  override initNew(): void {
    this.initNewPolarity(true);
  }
}
