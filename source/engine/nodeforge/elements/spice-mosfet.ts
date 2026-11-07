// MOSFETs as the NodeForge engine simulates them: by SPICE devices, with a model from the library
// (a VDMOS or level 1, 2 or 3 card, or a manufacturer's subcircuit; named by the part's `nfm` attribute and
// stored in the circuit) or the SPICE equivalent of the part's CircuitJS model (level 1 with
// CircuitJS's body diodes). Under the CircuitJS solver a part on its CircuitJS model runs
// CircuitJS's own MOSFET, so CircuitJS mode stays exactly CircuitJS. The part is drawn, edited and
// saved as CircuitJS's.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { XmlAttrs } from "../../circuitjs/core/elm";
import type { VoltageSource } from "../../circuitjs/core/nodes";
import { MosfetElm } from "../../circuitjs/elements/mosfet";
import type { XmlNode } from "../../circuitjs/io/tokens";
import { type Device, simSelfHeating, simTemperature } from "../devices/device";
import { DiodeDevice, diodeParams } from "../devices/diode";
import { ResistorDevice } from "../devices/linear";
import { Mos1Device, type Mos1Params, mos1Params } from "../devices/mos1";
import { Mos2Device, mos2Params } from "../devices/mos2";
import { Mos3Device, mos3Params } from "../devices/mos3";
import { buildSubckt, DeviceGroup, mosfetPins, scopeOf } from "../devices/subckt";
import { VdmosDevice, vdmosParams, vdmosType } from "../devices/vdmos";
import { bodyDiodeCard, circuitJSLeak, mosfetCard } from "../spice/circuitjs";
import type { SpiceModel } from "../spice/parse";
import { findModel } from "../spice/registry";

export class SpiceMosfetElm extends MosfetElm {
  static readonly baseName: string = "MosfetElm";
  /** Saved under CircuitJS's tag. */
  static override get xmlTag(): string {
    return MosfetElm.xmlTag;
  }
  /** A model from the library by name (a VDMOS / NMOS / PMOS card or a subcircuit), or "" for the part's CircuitJS model. */
  spiceModel = "";
  /**
   * The heatsink: case-to-ambient thermal resistance (K/W, with its mounting) in place of a VDMOS
   * card's RTHCA (free air), or null. Used with self-heating on; saved as `nfhs`.
   */
  heatsink: number | null = null;
  device: Device | null = null;
  /** Why the model can't be used (unknown name, wrong type), or null. */
  spiceProblem: string | null = null;
  /** What of a subcircuit couldn't be built (it still runs without them). */
  spiceWarnings: string[] = [];
  /** Current into the device at each node (posts, then internal), at the last accepted step. */
  pinCurrents: number[] = [];
  /** A subcircuit's named inner nodes and their indices in volts (for probing). */
  spiceNodes = new Map<string, number>();
  private innerCount = 0;
  /** The level 1 parameters of a part on its CircuitJS model (they follow its Vt and β). */
  private circuitJSParams: Mos1Params | null = null;
  /** What the circuit's temperature does to them: the threshold's shift and β's factor. */
  private tempShift = { vto: 0, beta: 1 };
  /** What the device was built for (rebuilt when it changes). */
  private deviceKey = "";

  /** The part's drain and source posts (they swap on a p-channel part). */
  get drainPost(): number {
    return this.pnp > 0 ? 2 : 1;
  }
  get sourcePost(): number {
    return this.pnp > 0 ? 1 : 2;
  }

  /** Use a model from the library (by name), or the part's CircuitJS model (""). */
  setSpiceModel(name: string): void {
    this.spiceModel = name;
    this.prepareDevice(this.sim?.accurate ?? false);
  }

  /** The SPICE card the part is simulated with (null for a subcircuit, or none). */
  spiceCard(): SpiceModel | null {
    if (!this.spiceModel) return this.model ? mosfetCard(this.model, this.pnp) : null;
    return findModel(this.spiceModel)?.model ?? null;
  }

  /**
   * The junction's temperature (°C) while self-heating heats it (a VDMOS with RTHJC, on its own or
   * in a subcircuit: the first), else null.
   */
  junctionTemperature(): number | null {
    const d = this.device;
    for (const x of d instanceof DeviceGroup ? d.devices : [d]) {
      if (x instanceof VdmosDevice && x.thermal) return this.volts[x.thermal.tj] ?? null;
    }
    return null;
  }

  /** The free-air case-to-ambient resistance (K/W) of a library VDMOS card with a thermal model (RTHJC), or null. */
  freeAirRthca(): number | null {
    const m = this.spiceModel ? findModel(this.spiceModel)?.model : null;
    return m?.type === "VDMOS" && m.params.has("rthjc") ? (m.params.get("rthca") ?? 23) : null;
  }

  /** The body terminal CircuitJS uses: the 4th post when shown, else the source. */
  private circuitJSBody(): number {
    return this.hasBodyTerminal() ? 3 : this.pnp === -1 ? 2 : 1;
  }

  /** Build the device the solver needs (called before each analysis). */
  prepareDevice(accurate: boolean): void {
    const m = this.model;
    const nodes = this.getPostCount() + this.getInternalNodeCount();
    const cjs = !this.spiceModel && m ? `${mosfetCard(m, this.pnp).source} ${this.doBodyDiode()} ${this.hasBodyTerminal()}` : "";
    // (a model redefined under the same name, as a custom one is when dialled, rebuilds it)
    const key = this.spiceModel ? `m:${this.spiceModel}:${findModel(this.spiceModel)?.text ?? ""}:${this.pnp}` : accurate ? `c:${cjs}` : "";
    const tkey = key && `${key}@${simTemperature(this.sim)}${simSelfHeating(this.sim) ? `:sh${this.heatsink ?? ""}` : ""}`;
    if (tkey === this.deviceKey) return;
    this.deviceKey = tkey;
    this.device = null;
    this.innerCount = 0;
    this.spiceWarnings = [];
    this.spiceNodes = new Map();
    this.spiceProblem = null;
    this.circuitJSParams = null;
    this.libNominal = null;
    if (this.spiceModel) this.buildLibraryDevice();
    else if (accurate && m) this.device = this.circuitJSDevice();
    // new nodes only if their number changed (a loaded part keeps its voltages)
    if (this.getPostCount() + this.getInternalNodeCount() !== nodes || this.volts.length !== nodes) this.allocNodes();
    // self-heating: the junctions start at the ambient
    const d = this.device;
    for (const x of d instanceof DeviceGroup ? d.devices : [d]) if (x instanceof VdmosDevice) x.startThermal();
  }

  /**
   * The part's CircuitJS model as SPICE devices, as `nfsim spice` exports it: level 1 between
   * drain (post 2) and source (post 1), CircuitJS's 100 MΩ drain-source leak, and its body diodes.
   */
  private circuitJSDevice(): Device {
    const p = mos1Params(mosfetCard(this.model!, this.pnp), { l: 1, w: 1, m: 1, ad: 0, as: 0, pd: 0, ps: 0 }, simTemperature(this.sim));
    this.circuitJSParams = p;
    // (level 1 with γ = 0: the temperature moves VTO by a fixed amount and scales KP)
    const card = mosfetCard(this.model!, this.pnp);
    this.tempShift = { vto: p.vto - card.params.get("vto")!, beta: p.beta / card.params.get("kp")! };
    const bulk = this.circuitJSBody();
    const devices: Device[] = [new Mos1Device(this, p, 2, 0, 1, bulk, 2, 1), new ResistorDevice(this, 2, 1, 1e8)];
    if (this.doBodyDiode()) {
      const card = bodyDiodeCard(), dp = diodeParams(card, simTemperature(this.sim));
      dp.gmin += circuitJSLeak(card);
      for (const terminal of [1, 2]) {
        if (terminal === bulk) continue;
        devices.push(this.pnp < 0 ? new DiodeDevice(this, dp, terminal, bulk, terminal) : new DiodeDevice(this, dp, bulk, terminal, bulk));
      }
    }
    return new DeviceGroup(this, devices);
  }

  /** Tolerances on a library model: its varied threshold (V, as VTO) and gain (A/V²); null: nominal. */
  variedVt: number | null = null;
  variedGain: number | null = null;
  /** The library model's nominal threshold and gain (its first MOSFET's, for a subcircuit), or null. */
  private libNominal: { vt: number; gain: number } | null = null;

  /** The library model's nominal threshold (V, as its VTO), or null. */
  modelThreshold(): number | null {
    return this.nominalValues()?.vt ?? null;
  }
  /** The library model's nominal gain (KP, or KP·W/L; A/V²), or null. */
  modelGain(): number | null {
    return this.nominalValues()?.gain ?? null;
  }
  /** (Tolerances are put in place before a run builds the device: build it now if it isn't.) */
  private nominalValues(): { vt: number; gain: number } | null {
    if (!this.libNominal && this.spiceModel) this.prepareDevice(this.sim?.accurate ?? true);
    return this.libNominal;
  }

  /** The MOSFET devices a library model is built of (a subcircuit's, nested groups included). */
  private mosfetDevices(): (VdmosDevice | Mos1Device)[] {
    const out: (VdmosDevice | Mos1Device)[] = [];
    const walk = (d: Device | null) => {
      if (d instanceof VdmosDevice || d instanceof Mos1Device) out.push(d);
      else if (d instanceof DeviceGroup) for (const x of d.devices) walk(x);
    };
    walk(this.device);
    return out;
  }

  /** Put the tolerances' variation (or none) on the library model's MOSFETs. */
  private applyVariation(): void {
    const n = this.libNominal;
    if (!n) return;
    const dVt = (this.variedVt ?? n.vt) - n.vt;
    const gain = n.gain > 0 ? (this.variedGain ?? n.gain) / n.gain : 1;
    for (const d of this.mosfetDevices()) {
      if (d instanceof VdmosDevice) {
        d.vtoShift = dVt;
        d.betaFactor = gain;
      } else d.setVariation(dVt, gain);
    }
  }

  private buildLibraryDevice(): void {
    this.buildLibraryDeviceOnly();
    // the nominal values the tolerances vary (the first MOSFET's)
    const first = this.mosfetDevices()[0];
    this.libNominal = first ? { vt: first.p.vto, gain: first.p.beta } : null;
  }

  private buildLibraryDeviceOnly(): void {
    const def = findModel(this.spiceModel);
    if (!def) {
      this.spiceProblem = `SPICE model ${this.spiceModel} isn't defined`;
      return;
    }
    const d = this.drainPost, s = this.sourcePost, first = this.getPostCount();
    if (def.subckt) {
      // a manufacturer's subcircuit: its pins on drain, gate and source, the rest inner nodes
      const sub = def.subckt;
      const order = mosfetPins(sub);
      const pins: (number | undefined)[] = new Array(sub.pins.length).fill(undefined);
      pins[order.d] = d;
      pins[order.g] = 0;
      pins[order.s] = s;
      const built = buildSubckt(this, sub, pins, first, scopeOf(def.text), simTemperature(this.sim));
      this.device = built.device;
      this.innerCount = built.internalNodes;
      this.spiceWarnings = built.problems;
      this.spiceNodes = built.nodeNames;
      return;
    }
    const m = def.model!;
    if (m.type === "NMOS" || m.type === "PMOS") {
      // a plain MOSFET card (level 1): bulk on the source, W = L as SPICE's default
      if ((m.type === "PMOS" ? -1 : 1) !== this.pnp) {
        this.spiceProblem = `${this.spiceModel} is ${m.type === "PMOS" ? "p" : "n"}-channel, the part isn't`;
        return;
      }
      const level = m.params.get("level") ?? 1;
      if (level !== 1 && level !== 2 && level !== 3) this.spiceWarnings.push(`level ${level} simulated as level 1`);
      const inst = { l: 100e-6, w: 100e-6, m: 1, ad: 0, as: 0, pd: 0, ps: 0 };
      const l3 = level === 3 ? mos3Params(m, inst, simTemperature(this.sim)) : null;
      const l2 = level === 2 ? mos2Params(m, inst, simTemperature(this.sim)) : null;
      const p = l3 ? l3.p : l2 ? l2.p : mos1Params(m, inst, simTemperature(this.sim));
      let next = first;
      const dp = p.rd > 0 ? next++ : d, sp = p.rs > 0 ? next++ : s;
      this.device = l3 ? new Mos3Device(this, p, l3.x, d, 0, s, s, dp, sp) : l2 ? new Mos2Device(this, p, l2.x, d, 0, s, s, dp, sp) : new Mos1Device(this, p, d, 0, s, s, dp, sp);
      this.innerCount = next - first;
      return;
    }
    if (m.type !== "VDMOS") {
      this.spiceProblem = `${this.spiceModel} isn't a MOSFET model (VDMOS, NMOS, PMOS) or a subcircuit`;
      return;
    }
    if (vdmosType(m) !== this.pnp) {
      this.spiceProblem = `${this.spiceModel} is ${vdmosType(m) > 0 ? "n" : "p"}-channel, the part isn't`;
      return;
    }
    const p = vdmosParams(m, simTemperature(this.sim));
    // inner nodes after the posts, for each resistance the model has
    let next = first;
    const inner = (r: number, outer: number) => (r > 0 ? next++ : outer);
    const dp = inner(p.rd, d), gp = inner(p.rg, 0), sp = inner(p.rs, s), bp = inner(p.rb, s);
    const vd = new VdmosDevice(this, p, d, 0, s, dp, gp, sp, bp);
    // self-heating (the circuit's setting, a model with RTHJC): junction and case temperature nodes (°C)
    if (simSelfHeating(this.sim) && m.params.has("rthjc")) {
      vd.setThermal({
        tj: next++, tc: next++, rthjc: m.params.get("rthjc")!, rthca: this.heatsink ?? m.params.get("rthca") ?? 23,
        cthj: m.params.get("cthj") ?? 10e-6, ambient: simTemperature(this.sim) - 273.15,
      });
    }
    this.device = vd;
    this.innerCount = next - first;
  }

  /** Does a SPICE device simulate the part now (else CircuitJS's MOSFET)? */
  private get spice(): boolean {
    return this.device !== null || this.spiceProblem !== null;
  }

  override getVoltageSourceCount(): number {
    if (!this.spice) return super.getVoltageSourceCount();
    return this.device?.voltageSourceCount() ?? 0;
  }
  override setVoltageSource(n: number, v: VoltageSource): void {
    super.setVoltageSource(n, v);
    if (this.spice) this.device?.setVoltageSource(n, v);
  }
  override setCurrent(vs: VoltageSource, c: number): void {
    if (!this.spice) return super.setCurrent(vs, c);
    this.device?.setCurrent(vs, c);
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.spiceModel = xml.string("nfm", "") ?? "";
    const hs = Number(xml.string("nfhs", "") ?? "");
    this.heatsink = hs > 0 ? hs : null;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    if (this.spiceModel) a.push(["nfm", this.spiceModel]);
    if (this.heatsink !== null) a.push(["nfhs", String(this.heatsink)]);
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
    this.ids = 0;
    this.pinCurrents = [];
    this.device?.reset();
  }

  override startIteration(): void {
    if (!this.spice) return super.startIteration();
    // on its CircuitJS model: the part's own Vt and β (which tolerances vary); with γ = 0 at the
    // nominal temperature level 1's threshold is VTO and its β is KP·W/L = KP
    const p = this.circuitJSParams;
    if (p) {
      p.vto = p.vbi = (this.pnp < 0 ? -this.vt : this.vt) + this.tempShift.vto;
      p.beta = this.beta * this.tempShift.beta;
    }
    this.applyVariation();
    this.device?.startIteration();
  }

  override stamp(): void {
    if (!this.spice) return super.stamp();
    if (this.spiceProblem) this.sim.stop(this.spiceProblem, this);
    this.bodyTerminal = this.spiceModel ? this.sourcePost : this.circuitJSBody();
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
    // drain to source, as CircuitJS shows it
    this.ids = this.pnp * into[this.drainPost];
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

/** New n- and p-channel parts (the Draw menu's), as CircuitJS's NMosfetElm / PMosfetElm. */
export class SpiceNMosfetElm extends SpiceMosfetElm {
  static override readonly baseName: string = "NMosfetElm";
  override initNew(): void {
    this.initNewPolarity(false);
  }
}
export class SpicePMosfetElm extends SpiceMosfetElm {
  static override readonly baseName: string = "PMosfetElm";
  override initNew(): void {
    this.initNewPolarity(true);
  }
}
