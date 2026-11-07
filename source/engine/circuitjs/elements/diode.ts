// Ported from CircuitJS1 (Diode.java, DiodeModel.java, DiodeElm.java, ZenerElm.java) by Paul Falstad
// and Iain Sharp; Zener code contributed by J. Mike Rollins.
// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { CircuitElm, type XmlAttrs } from "../core/elm";
import type { CircuitNode } from "../core/nodes";
import type { Simulator } from "../core/simulator";
import { CircuitText, type TokenStream, type XmlNode } from "../io/tokens";

const ch = (c: string) => c.charCodeAt(0);

// CircuitJS's fixed thermal voltage, derived at 27 C (300.15 K); keep it bit-exact:
const vt = 0.025865;

/** Diode model parameters. Models are global and shared by name, as upstream (static modelMap). */
export class DiodeModel {
  static readonly FLAGS_SIMPLE = 1;
  private static modelMap: Map<string, DiodeModel> | null = null;

  flags = 0;
  name = "";
  description: string | null = null;
  saturationCurrent = 1e-14;
  seriesResistance = 0;
  emissionCoefficient = 1;
  breakdownVoltage = 0;
  // used for UI code, not guaranteed to be set
  forwardVoltage = 0;
  forwardCurrent = 0;
  dumped = false;
  readOnly = false;
  builtIn = false;
  oldStyle = false;
  internal = false;

  /** The diode's "scale voltage", the voltage increase which will raise current by a factor of e. */
  vscale = 0;
  /** The multiplicative equivalent of dividing by vscale (for speed). */
  vdcoef = 0;
  /** Voltage drop at 1 A. */
  fwdrop = 0;

  constructor(sc = 1e-14, sr = 0, ec = 1, bv = 0, d: string | null = null) {
    this.saturationCurrent = sc;
    this.seriesResistance = sr;
    this.emissionCoefficient = ec;
    this.breakdownVoltage = bv;
    this.description = d;
    this.updateModel();
  }

  static copyOf(copy: DiodeModel): DiodeModel {
    const m = new DiodeModel(copy.saturationCurrent, copy.seriesResistance, copy.emissionCoefficient, copy.breakdownVoltage);
    m.flags = copy.flags;
    m.forwardCurrent = copy.forwardCurrent;
    m.updateModel();
    return m;
  }

  static getModelWithName(name: string): DiodeModel {
    const map = DiodeModel.createModelMap();
    let lm = map.get(name);
    if (lm) return lm;
    lm = new DiodeModel();
    lm.name = name;
    map.set(name, lm);
    return lm;
  }

  static getModelWithNameOrCopy(name: string, oldmodel: DiodeModel | null): DiodeModel {
    const map = DiodeModel.createModelMap();
    let lm = map.get(name);
    if (lm) return lm;
    // an unknown model name falls back to the default model
    if (!oldmodel) return DiodeModel.getDefaultModel();
    lm = DiodeModel.copyOf(oldmodel);
    lm.name = name;
    map.set(name, lm);
    return lm;
  }

  static createModelMap(): Map<string, DiodeModel> {
    if (DiodeModel.modelMap) return DiodeModel.modelMap;
    DiodeModel.modelMap = new Map();
    const add = DiodeModel.addDefaultModel;
    add("spice-default", new DiodeModel(1e-14, 0, 1, 0, null));
    add("default", new DiodeModel(1.7143528192808883e-7, 0, 2, 0, null));
    add("default-zener", new DiodeModel(1.7143528192808883e-7, 0, 2, 5.6, null));
    // old default LED with saturation current that is way too small (causes numerical errors)
    add("old-default-led", new DiodeModel(2.2349907006671927e-18, 0, 2, 0, null).setInternal());
    // default for newly created LEDs
    add("default-led", new DiodeModel(93.2e-12, 0.042, 3.73, 0, null));
    add("default-optocoupler-led", new DiodeModel(1.714e-7, 0, 4.077, 0, null));
    add("1N5711", new DiodeModel(315e-9, 2.8, 2.03, 70, "Schottky"));
    add("1N5712", new DiodeModel(680e-12, 12, 1.003, 20, "Schottky"));
    add("BAT85", new DiodeModel(2.076e-7, 2.326, 1.023, 33, "Schottky"));
    // model is inaccurate
    add("1N34", new DiodeModel(200e-12, 84e-3, 2.19, 60, "germanium").setInternal());
    add("1N4004", new DiodeModel(18.8e-9, 28.6e-3, 2, 400, "general purpose"));
    add("1N4148", new DiodeModel(4.352e-9, 0.6458, 1.906, 75, "switching"));
    add("x2n2646-emitter", new DiodeModel(2.13e-11, 0, 1.8, 0, null).setInternal());
    // for TL431 and LM317
    DiodeModel.loadInternalModel("~tl431ed-d_ed 0 1e-14 5 1 0 0");
    DiodeModel.loadInternalModel("~lm317-dz 0 1e-14 0 1 6.3 0");
    return DiodeModel.modelMap;
  }

  private static addDefaultModel(name: string, dm: DiodeModel): void {
    DiodeModel.modelMap!.set(name, dm);
    dm.readOnly = dm.builtIn = true;
    dm.name = name;
  }

  private setInternal(): DiodeModel {
    this.internal = true;
    return this;
  }

  /**
   * Find or create a model for an old-style element that stored its forward drop (and Zener
   * voltage) inline. Kept for backward compatibility; the leakage currents this produces can be
   * far off, but changing it would change old circuits' behavior.
   */
  static getModelWithParameters(fwdrop: number, zvoltage: number): DiodeModel {
    const map = DiodeModel.createModelMap();
    const emcoef = 2;
    for (const dm of map.values()) {
      if (Math.abs(dm.fwdrop - fwdrop) < 1e-8 && dm.seriesResistance === 0 && Math.abs(dm.breakdownVoltage - zvoltage) < 1e-8 && dm.emissionCoefficient === emcoef)
        return dm;
    }
    // create a new one, converting to new parameter values
    const vscale = emcoef * vt;
    const vdcoef = 1 / vscale;
    const leakage = 1 / (Math.exp(fwdrop * vdcoef) - 1);
    let name = "fwdrop=" + fwdrop;
    if (zvoltage !== 0) name = name + " zvoltage=" + zvoltage;
    const dm = DiodeModel.getModelWithName(name);
    dm.saturationCurrent = leakage;
    dm.emissionCoefficient = emcoef;
    dm.breakdownVoltage = zvoltage;
    dm.readOnly = dm.oldStyle = true;
    dm.updateModel();
    return dm;
  }

  static getDefaultModel(): DiodeModel {
    return DiodeModel.getModelWithName("default");
  }

  private static loadInternalModel(s: string): void {
    const parts = s.split(" ");
    const dm = DiodeModel.getModelWithName(parts[0]);
    dm.undumpValues(parts.slice(1));
    dm.builtIn = dm.internal = true;
  }

  /** Text format: `34 name flags Is Rs n bv [fi]`. `st` is positioned after the `34`. */
  static undumpModel(st: TokenStream): DiodeModel {
    const name = CircuitText.unescape(st.next());
    const dm = DiodeModel.getModelWithName(name);
    dm.flags = st.nextInt();
    dm.saturationCurrent = st.nextDouble();
    dm.seriesResistance = st.nextDouble();
    dm.emissionCoefficient = st.nextDouble();
    dm.breakdownVoltage = st.nextDouble();
    const fi = st.tryDouble();
    if (fi !== undefined) dm.forwardCurrent = fi;
    dm.updateModel();
    return dm;
  }

  private undumpValues(v: string[]): void {
    this.flags = Number.parseInt(v[0], 10);
    this.saturationCurrent = Number(v[1]);
    this.seriesResistance = Number(v[2]);
    this.emissionCoefficient = Number(v[3]);
    this.breakdownVoltage = Number(v[4]);
    if (v.length > 5) this.forwardCurrent = Number(v[5]);
    this.updateModel();
  }

  /** XML format: `<dm nm= f= is= rs= n= bv= fi=>`. */
  static undumpModelXml(xml: XmlNode): DiodeModel {
    const dm = DiodeModel.getModelWithName(xml.string("nm", null) ?? "");
    dm.flags = xml.int("f", dm.flags);
    dm.saturationCurrent = xml.double("is", dm.saturationCurrent);
    dm.seriesResistance = xml.double("rs", dm.seriesResistance);
    dm.emissionCoefficient = xml.double("n", dm.emissionCoefficient);
    dm.breakdownVoltage = xml.double("bv", dm.breakdownVoltage);
    dm.forwardCurrent = xml.double("fi", dm.forwardCurrent);
    dm.updateModel();
    return dm;
  }

  /** Text format: `34 name flags Is Rs n bv fi`. */
  dump(): string {
    return `34 ${CircuitText.escape(this.name)} ${this.flags} ${this.saturationCurrent} ${this.seriesResistance} ${this.emissionCoefficient} ${this.breakdownVoltage} ${this.forwardCurrent}`;
  }

  dumpXml(): XmlAttrs {
    return [["nm", this.name], ["f", String(this.flags)], ["is", String(this.saturationCurrent)], ["rs", String(this.seriesResistance)],
      ["n", String(this.emissionCoefficient)], ["bv", String(this.breakdownVoltage)], ["fi", String(this.forwardCurrent)]];
  }

  /** Models offered for a diode (or, with `zener`, a Zener: those with a breakdown voltage). */
  static getModelList(zener: boolean): DiodeModel[] {
    const list = [...new Set(DiodeModel.createModelMap().values())].filter((dm) => !dm.internal && !(zener && dm.breakdownVoltage === 0));
    return list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  getDescription(): string {
    return this.description === null ? this.name : `${this.name} (${this.description})`;
  }

  updateModel(): void {
    this.vscale = this.emissionCoefficient * vt;
    this.vdcoef = 1 / this.vscale;
    this.fwdrop = Math.log(1 / this.saturationCurrent + 1) * this.emissionCoefficient * vt;
  }
}

/** A P-N junction that can be embedded in other elements. Series resistance is DiodeElm's job. */
export class Diode {
  static readonly vt = vt;
  // The Zener breakdown curve is a steeper exponential, the ideal Shockley curve flipped and
  // translated: vt and vzcoef replace vscale and vdcoef.
  static readonly vzcoef = 1 / vt;

  nodes: (CircuitNode | null)[] = [null, null];
  vscale = 0;
  vdcoef = 0;
  /** User-specified Zener voltage. */
  zvoltage = 0;
  /** The diode current's scale factor. */
  leakage = 0;
  /** Voltage offset for the Zener breakdown exponential. */
  zoffset = 0;
  /** Critical voltages for limiting the normal diode and Zener breakdown exponentials. */
  vcrit = 0;
  vzcrit = 0;
  lastvoltdiff = 0;

  /** `owner.sim` is read when simulating; the owner gets its simulator after construction. */
  constructor(private readonly owner: { sim: Simulator }) {}

  private get sim(): Simulator {
    return this.owner.sim;
  }

  setup(model: DiodeModel): void {
    this.leakage = model.saturationCurrent;
    this.zvoltage = model.breakdownVoltage;
    this.vscale = model.vscale;
    this.vdcoef = model.vdcoef;
    // critical voltage for limiting; current is vscale/sqrt(2) at this voltage
    this.vcrit = this.vscale * Math.log(this.vscale / (Math.sqrt(2) * this.leakage));
    // translated, positive critical voltage for limiting in the Zener breakdown region
    this.vzcrit = vt * Math.log(vt / (Math.sqrt(2) * this.leakage));
    if (this.zvoltage === 0) this.zoffset = 0;
    else {
      // offset which gives 5 mA at zvoltage
      const i = -0.005;
      this.zoffset = this.zvoltage - Math.log(-(1 + i / this.leakage)) / Diode.vzcoef;
    }
  }

  setupForDefaultModel(): void {
    this.setup(DiodeModel.getDefaultModel());
  }

  reset(): void {
    this.lastvoltdiff = 0;
  }

  limitStep(vnew: number, vold: number): number {
    let arg: number;
    // check new voltage; has current changed by factor of e^2?
    if (vnew > this.vcrit && Math.abs(vnew - vold) > this.vscale + this.vscale) {
      if (vold > 0) {
        arg = 1 + (vnew - vold) / this.vscale;
        // adjust vnew so that the current is the same as in the linearized model from the
        // previous iteration
        if (arg > 0) vnew = vold + this.vscale * Math.log(arg);
        else vnew = this.vcrit;
      } else {
        vnew = this.vscale * Math.log(vnew / this.vscale);
      }
      this.sim.converged = false;
    } else if (vnew < 0 && this.zoffset !== 0) {
      // Zener breakdown: the same logic on translated values, with the steeper curve's constants
      vnew = -vnew - this.zoffset;
      vold = -vold - this.zoffset;
      if (vnew > this.vzcrit && Math.abs(vnew - vold) > vt + vt) {
        if (vold > 0) {
          arg = 1 + (vnew - vold) / vt;
          if (arg > 0) vnew = vold + vt * Math.log(arg);
          else vnew = this.vzcrit;
        } else {
          vnew = vt * Math.log(vnew / vt);
        }
        this.sim.converged = false;
      }
      vnew = -(vnew + this.zoffset);
    }
    return vnew;
  }

  stamp(n0: CircuitNode, n1: CircuitNode): void {
    this.nodes[0] = n0;
    this.nodes[1] = n1;
    this.sim.markNonLinear(n0);
    this.sim.markNonLinear(n1);
  }

  doStep(voltdiff: number): void {
    const sim = this.sim;
    // used to have .1 here, but needed .01 for peak detector
    if (Math.abs(voltdiff - this.lastvoltdiff) > 0.01) sim.converged = false;
    voltdiff = this.limitStep(voltdiff, this.lastvoltdiff);
    this.lastvoltdiff = voltdiff;

    // a tiny conductance in parallel with each P-N junction prevents a singular matrix
    let gmin = this.leakage * 0.01;
    if (sim.subIterations > 100) {
      // having trouble converging: gradually increase the parallel conductance
      gmin = Math.exp(-9 * Math.log(10) * (1 - sim.subIterations / 3000));
      if (gmin > 0.1) gmin = 0.1;
    }

    const n0 = this.nodes[0]!, n1 = this.nodes[1]!;
    if (voltdiff >= 0 || this.zvoltage === 0) {
      // regular diode or forward-biased zener
      const evalv = Math.exp(voltdiff * this.vdcoef);
      const geq = this.vdcoef * this.leakage * evalv + gmin;
      const nc = (evalv - 1) * this.leakage - geq * voltdiff;
      sim.stampConductance(n0, n1, geq);
      sim.stampCurrentSource(n0, n1, nc);
    } else {
      // reverse-biased Zener: I(Vd) = Is * (exp[Vd*C] - exp[(-Vd-Vz)*Cz] - 1)
      const vz = Diode.vzcoef;
      const geq = this.leakage * (this.vdcoef * Math.exp(voltdiff * this.vdcoef) + vz * Math.exp((-voltdiff - this.zoffset) * vz)) + gmin;
      const nc = this.leakage * (Math.exp(voltdiff * this.vdcoef) - Math.exp((-voltdiff - this.zoffset) * vz) - 1) + geq * -voltdiff;
      sim.stampConductance(n0, n1, geq);
      sim.stampCurrentSource(n0, n1, nc);
    }
  }

  calculateCurrent(voltdiff: number): number {
    if (voltdiff >= 0 || this.zvoltage === 0) return this.leakage * (Math.exp(voltdiff * this.vdcoef) - 1);
    return this.leakage * (Math.exp(voltdiff * this.vdcoef) - Math.exp((-voltdiff - this.zoffset) * Diode.vzcoef) - 1);
  }
}

export class DiodeElm extends CircuitElm {
  static override dumpType = ch("d");
  static readonly FLAG_FWDROP = 1;
  static readonly FLAG_MODEL = 2;
  static lastModelName = "default";

  diode = new Diode(this);
  modelName = "";
  model: DiodeModel | null = null;
  hasResistance = false;
  diodeEndNode = 1;

  override initNew(): void {
    this.modelName = DiodeElm.lastModelName;
    this.setup();
  }

  override readTokens(st: TokenStream): void {
    const defaultdrop = 0.805904783;
    let fwdrop = defaultdrop;
    const zvoltage = 0;
    if ((this.flags & DiodeElm.FLAG_MODEL) !== 0) {
      this.modelName = CircuitText.unescape(st.next());
    } else {
      if ((this.flags & DiodeElm.FLAG_FWDROP) > 0) {
        const v = st.tryDouble();
        if (v !== undefined) fwdrop = v;
      }
      this.model = DiodeModel.getModelWithParameters(fwdrop, zvoltage);
      this.modelName = this.model.name;
    }
    this.setup();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.modelName = xml.string("mo", this.modelName) ?? this.modelName;
    this.setup();
  }

  override dump(): string {
    this.flags |= DiodeElm.FLAG_MODEL;
    return super.dump();
  }

  override dumpValues(): string {
    return ` ${CircuitText.escape(this.modelName)}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["mo", this.modelName]);
  }

  /** Switch to another model by name. */
  setModel(name: string): void {
    this.modelName = name;
    this.model = null;
    this.setup();
  }

  setup(): void {
    this.model = DiodeModel.getModelWithNameOrCopy(this.modelName, this.model);
    this.modelName = this.model.name; // in case we couldn't find that model
    this.diode.setup(this.model);
    this.hasResistance = this.model.seriesResistance > 0;
    this.diodeEndNode = this.hasResistance ? 2 : 1;
    this.allocNodes();
  }

  updateModels(): void {
    this.setup();
  }

  override nonLinear(): boolean {
    return true;
  }

  override getInternalNodeCount(): number {
    return this.hasResistance ? 1 : 0;
  }

  override setPoints(): void {
    super.setPoints();
    this.calcLeads(16);
  }

  override reset(): void {
    this.diode.reset();
    this.volts[0] = this.volts[1] = this.curcount = 0;
    if (this.hasResistance) this.volts[2] = 0;
  }

  override stamp(): void {
    if (this.hasResistance) {
      // diode from node 0 to the internal node, resistor from the internal node to node 1
      this.diode.stamp(this.nodes[0]!, this.nodes[2]!);
      this.sim.stampResistor(this.nodes[1]!, this.nodes[2]!, this.model!.seriesResistance);
    } else this.diode.stamp(this.nodes[0]!, this.nodes[1]!);
  }

  override doStep(): void {
    this.diode.doStep(this.volts[0] - this.volts[this.diodeEndNode]);
  }

  override calculateCurrent(): void {
    this.current = this.diode.calculateCurrent(this.volts[0] - this.volts[this.diodeEndNode]);
  }

  override stepFinished(): void {
    // A runaway current makes subsequent solver values unusable.
    if (Math.abs(this.current) > 1e12) this.sim.stop("max current exceeded", this);
  }
}

export class ZenerElm extends DiodeElm {
  static override dumpType = ch("z");
  static lastZenerModelName = "default-zener";

  override initNew(): void {
    super.initNew();
    this.modelName = ZenerElm.lastZenerModelName;
    this.setup();
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    // Old files store the Zener voltage inline. With FLAG_MODEL set the next token is a model
    // name instead, and any value after it is ignored.
    if ((this.flags & DiodeElm.FLAG_MODEL) === 0) {
      const zvoltage = st.nextDouble();
      this.model = DiodeModel.getModelWithParameters(this.model!.fwdrop, zvoltage);
      this.modelName = this.model.name;
    }
    this.setup();
  }
}
