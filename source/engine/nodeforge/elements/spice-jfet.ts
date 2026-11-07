// JFETs as the NodeForge engine simulates them: by the SPICE level 1 JFET, with a model from the
// library (an NJF / PJF card, named by the part's `nfm` attribute and stored in the circuit) or the
// SPICE equivalent of the part's CircuitJS model (a JFET card with CircuitJS's gate diode and gate
// capacitances beside it). Under the CircuitJS solver a part on its CircuitJS model runs CircuitJS's
// own JFET, so CircuitJS mode stays exactly CircuitJS. The part is drawn, edited and saved as CircuitJS's.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { XmlAttrs } from "../../circuitjs/core/elm";
import { JfetElm } from "../../circuitjs/elements/semis";
import type { XmlNode } from "../../circuitjs/io/tokens";
import { type Device, simTemperature } from "../devices/device";
import { DiodeDevice, diodeParams } from "../devices/diode";
import { JfetDevice, type JfetParams, jfetParams } from "../devices/jfet";
import { CapacitorDevice, ResistorDevice } from "../devices/linear";
import { DeviceGroup } from "../devices/subckt";
import { bodyDiodeCard, circuitJSLeak, jfetCard } from "../spice/circuitjs";
import type { SpiceModel } from "../spice/parse";
import { findModel } from "../spice/registry";

/** CircuitJS's posts: gate 0, source 1, drain 2 (the gate diode goes to the source). */
const GATE = 0, SOURCE = 1, DRAIN = 2;

export class SpiceJfetElm extends JfetElm {
  static readonly baseName: string = "JfetElm";
  /** Saved under CircuitJS's tag. */
  static override get xmlTag(): string {
    return JfetElm.xmlTag;
  }
  /** A model from the library (an NJF / PJF card) by name, or "" for the part's CircuitJS model. */
  spiceModel = "";
  device: Device | null = null;
  /** Why the model can't be used (unknown name, wrong type), or null. */
  spiceProblem: string | null = null;
  /** Current into the device at each node (posts, then internal), at the last accepted step. */
  pinCurrents: number[] = [];
  private innerCount = 0;
  /** The JFET parameters of a part on its CircuitJS model (they follow its Vt and β). */
  private circuitJSParams: JfetParams | null = null;
  /** What the circuit's temperature does to them: the threshold's shift and BETA's factor. */
  private tempShift = { vto: 0, beta: 1 };
  /** What the device was built for (rebuilt when it changes). */
  private deviceKey = "";

  /** Use a model from the library (by name), or the part's CircuitJS model (""). */
  setSpiceModel(name: string): void {
    this.spiceModel = name;
    this.prepareDevice(this.sim?.accurate ?? false);
  }

  /** The SPICE card the part is simulated with (the library's, or its CircuitJS model's), or null. */
  spiceCard(): SpiceModel | null {
    if (!this.spiceModel) return this.model ? jfetCard(this.model, this.pnp) : null;
    const m = findModel(this.spiceModel)?.model;
    return m && (m.type === "NJF" || m.type === "PJF") ? m : null;
  }

  /** Build the device the solver needs (called before each analysis). */
  prepareDevice(accurate: boolean): void {
    const m = this.model;
    const cjs = !this.spiceModel && m ? `${jfetCard(m, this.pnp).source} ${m.capGS} ${m.capGD}` : "";
    const key = this.spiceModel ? `m:${this.spiceModel}:${findModel(this.spiceModel)?.text ?? ""}:${this.pnp}` : accurate ? `c:${cjs}` : "";
    const tkey = key && `${key}@${simTemperature(this.sim)}`;
    if (tkey === this.deviceKey) return;
    this.deviceKey = tkey;
    const nodes = this.getPostCount() + this.getInternalNodeCount();
    this.device = null;
    this.innerCount = 0;
    this.spiceProblem = null;
    this.circuitJSParams = null;
    if (this.spiceModel) this.buildLibraryDevice();
    else if (accurate && m) this.device = this.circuitJSDevice();
    // new nodes only if their number changed (a loaded part keeps its voltages)
    if (this.getPostCount() + this.getInternalNodeCount() !== nodes || this.volts.length !== nodes) this.allocNodes();
  }

  /**
   * The part's CircuitJS model as SPICE devices, as `nfsim spice` exports it: the JFET card between
   * drain and source, CircuitJS's 100 MΩ drain-source leak, its gate diode (to the source) with
   * its leak, and its gate capacitances.
   */
  private circuitJSDevice(): Device {
    const m = this.model!;
    const p = jfetParams(jfetCard(m, this.pnp), simTemperature(this.sim));
    this.circuitJSParams = p;
    this.tempShift = { vto: p.vto - m.threshold, beta: p.beta / (m.beta / 2) };
    const card = bodyDiodeCard(), dp = diodeParams(card, simTemperature(this.sim));
    dp.gmin += circuitJSLeak(card);
    const devices: Device[] = [
      new JfetDevice(this, p, DRAIN, GATE, SOURCE, DRAIN, SOURCE),
      new ResistorDevice(this, DRAIN, SOURCE, 1e8),
      this.pnp < 0 ? new DiodeDevice(this, dp, SOURCE, GATE, SOURCE) : new DiodeDevice(this, dp, GATE, SOURCE, GATE),
    ];
    if (m.capGS > 0) devices.push(new CapacitorDevice(this, GATE, SOURCE, m.capGS));
    if (m.capGD > 0) devices.push(new CapacitorDevice(this, GATE, DRAIN, m.capGD));
    return new DeviceGroup(this, devices);
  }

  private buildLibraryDevice(): void {
    const def = findModel(this.spiceModel);
    const type = def?.model?.type;
    if (!def) this.spiceProblem = `SPICE model ${this.spiceModel} isn't defined`;
    else if (type !== "NJF" && type !== "PJF") this.spiceProblem = `${this.spiceModel} isn't a JFET model (NJF, PJF)`;
    else if ((type === "PJF" ? -1 : 1) !== this.pnp) this.spiceProblem = `${this.spiceModel} is ${type === "PJF" ? "p" : "n"}-channel, the part isn't`;
    if (this.spiceProblem) return;
    const p = jfetParams(def!.model!, simTemperature(this.sim));
    // inner nodes after the posts, for each resistance the model has
    let next = this.getPostCount();
    const dp = p.gd > 0 ? next++ : DRAIN, sp = p.gs > 0 ? next++ : SOURCE;
    this.device = new JfetDevice(this, p, DRAIN, GATE, SOURCE, dp, sp);
    this.innerCount = next - this.getPostCount();
  }

  /** Does a SPICE device simulate the part now (else CircuitJS's JFET)? */
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

  override nonLinear(): boolean {
    return true;
  }

  override reset(): void {
    if (!this.spice) return super.reset();
    this.volts.fill(0);
    this.curcount = 0;
    this.ids = this.gateCurrent = 0;
    this.pinCurrents = [];
    this.device?.reset();
  }

  override startIteration(): void {
    if (!this.spice) return super.startIteration();
    // on its CircuitJS model: the part's own Vt and β (which tolerances vary); BETA is β/2
    const p = this.circuitJSParams;
    if (p) {
      p.vto = this.vt + this.tempShift.vto;
      p.beta = (this.beta / 2) * this.tempShift.beta;
    }
    this.device?.startIteration();
  }

  override stamp(): void {
    if (!this.spice) return super.stamp();
    if (this.spiceProblem) this.sim.stop(this.spiceProblem, this);
    this.device?.stamp();
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
    // as CircuitJS keeps them: drain current into the part, gate current into the part
    this.ids = into[DRAIN];
    this.gateCurrent = into[GATE];
  }

  override getCurrent(): number {
    if (!this.spice) return super.getCurrent();
    return this.ids;
  }

  override getCurrentIntoNode(n: number): number {
    if (!this.spice) return super.getCurrentIntoNode(n);
    // out of the part into node n
    return -(this.pinCurrents[n] ?? 0);
  }

  override getPower(): number {
    if (!this.spice) return super.getPower();
    let p = 0;
    for (let i = 0; i < this.getPostCount(); i++) p += (this.pinCurrents[i] ?? 0) * this.volts[i];
    return p;
  }
}

/** New n- and p-channel parts (the Draw menu's), as CircuitJS's NJfetElm / PJfetElm. */
export class SpiceNJfetElm extends SpiceJfetElm {
  static override readonly baseName: string = "NJfetElm";
  override initNew(): void {
    this.initNewPolarity(false);
  }
}
export class SpicePJfetElm extends SpiceJfetElm {
  static override readonly baseName: string = "PJfetElm";
  override initNew(): void {
    this.initNewPolarity(true);
  }
}
