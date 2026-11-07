// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Ported from CircuitJS1 (MosfetElm.java, MosfetModel.java, NMosfetElm.java, PMosfetElm.java) by
// Paul Falstad and Iain Sharp. Licensed under the GNU General Public License v2 or later. See LICENSE.

import { CircuitElm, type XmlAttrs } from "../core/elm";
import { type GridPoint, interpPoint, interpPointPerp } from "../core/geometry";
import type { TokenStream, XmlNode } from "../io/tokens";
import { Diode } from "./diode";

/** MOSFET / JFET model parameters. Global and shared by name, as upstream (static modelMap). */
export class MosfetModel {
  static readonly FLAG_JFET = 1;
  private static modelMap: Map<string, MosfetModel> | null = null;

  flags = 0;
  name = "";
  description: string | null = null;
  /** Vt: threshold voltage (V). */
  threshold = 1.5;
  /** Transconductance parameter (A/V²). */
  beta = 0.02;
  /** Channel-length modulation (1/V), 0 = ideal. */
  lambda = 0;
  /** Gate-source capacitance (F), 0 = disabled. */
  capGS = 0;
  /** Gate-drain capacitance (F), 0 = disabled. */
  capGD = 0;

  // how parts using this model are drawn and simulated (not used for JFETs)
  showBulk = true;
  /** Draw as a simple digital-logic symbol (only if !showBulk). */
  digitalSymbol = false;
  /** Simulate the parasitic body diode (only if showBulk). */
  bodyDiode = true;
  /** Expose the body as a 4th terminal (only if bodyDiode). */
  bodyTerminal = false;
  /** Draw the body diode symbol (only if bodyDiode). */
  showBodyDiodeSymbol = false;

  dumped = false;
  readOnly = false;
  builtIn = false;
  internal = false;
  /** Synthesized from an old file's inline per-element vt/beta values. */
  oldStyle = false;

  constructor(d: string | null = null, vt = 1.5, b = 0.02) {
    this.description = d;
    this.threshold = vt;
    this.beta = b;
  }

  static copyOf(copy: MosfetModel): MosfetModel {
    const m = new MosfetModel(null, copy.threshold, copy.beta);
    m.flags = copy.flags;
    m.lambda = copy.lambda;
    m.capGS = copy.capGS;
    m.capGD = copy.capGD;
    m.showBulk = copy.showBulk;
    m.digitalSymbol = copy.digitalSymbol;
    m.bodyDiode = copy.bodyDiode;
    m.bodyTerminal = copy.bodyTerminal;
    m.showBodyDiodeSymbol = copy.showBodyDiodeSymbol;
    return m;
  }

  isJfet(): boolean {
    return (this.flags & MosfetModel.FLAG_JFET) !== 0;
  }

  setJfet(): MosfetModel {
    this.flags |= MosfetModel.FLAG_JFET;
    return this;
  }

  static getModelWithName(name: string): MosfetModel {
    const map = MosfetModel.createModelMap();
    let lm = map.get(name);
    if (lm) return lm;
    lm = new MosfetModel();
    lm.name = name;
    map.set(name, lm);
    return lm;
  }

  static getModelWithNameOrCopy(name: string, oldmodel: MosfetModel | null, jfet: boolean): MosfetModel {
    const map = MosfetModel.createModelMap();
    let lm = map.get(name);
    if (lm) return lm;
    if (!oldmodel) return MosfetModel.getDefaultModel(jfet);
    lm = MosfetModel.copyOf(oldmodel);
    lm.name = name;
    map.set(name, lm);
    return lm;
  }

  static createModelMap(): Map<string, MosfetModel> {
    if (MosfetModel.modelMap) return MosfetModel.modelMap;
    MosfetModel.modelMap = new Map();
    const add = MosfetModel.addDefaultModel;
    add("default", new MosfetModel("default", 1.5, 0.02));
    const noDiode = new MosfetModel("default-nodiode", 1.5, 0.02);
    noDiode.bodyDiode = false;
    add("default-nodiode", noDiode);
    const body = new MosfetModel("default-body", 1.5, 0.02);
    body.bodyTerminal = true;
    add("default-body", body);
    const digital = new MosfetModel("default-digital", 1.5, 0.02);
    digital.showBulk = false;
    digital.digitalSymbol = true;
    digital.bodyDiode = false;
    add("default-digital", digital);
    // values from Hayes + Horowitz p155. JFETs never show a bulk/body terminal.
    const jfet = new MosfetModel("default-jfet", -4, 0.00125).setJfet();
    jfet.showBulk = jfet.bodyDiode = false;
    add("default-jfet", jfet);
    return MosfetModel.modelMap;
  }

  private static addDefaultModel(name: string, mm: MosfetModel): void {
    MosfetModel.modelMap!.set(name, mm);
    mm.readOnly = mm.builtIn = true;
    mm.name = name;
  }

  static getDefaultModel(jfet: boolean): MosfetModel {
    return MosfetModel.getModelWithName(jfet ? "default-jfet" : "default");
  }

  /**
   * Find or create a model matching the per-element vt/beta and drawing/behavior flags of an old
   * circuit file, which stored them inline instead of by model name.
   */
  static getModelWithParameters(vt: number, beta: number, jfet: boolean, showBulk: boolean, bodyDiode: boolean,
    bodyTerminal: boolean, digitalSymbol: boolean, showBodyDiodeSymbol: boolean): MosfetModel {
    const map = MosfetModel.createModelMap();
    for (const mm of map.values()) {
      if (mm.isJfet() === jfet && Math.abs(mm.threshold - vt) < 1e-15 && Math.abs(mm.beta - beta) < 1e-15 &&
        mm.lambda === 0 && mm.capGS === 0 && mm.capGD === 0 &&
        mm.showBulk === showBulk && mm.bodyDiode === bodyDiode && mm.bodyTerminal === bodyTerminal &&
        mm.digitalSymbol === digitalSymbol && mm.showBodyDiodeSymbol === showBodyDiodeSymbol)
        return mm;
    }
    const baseName = "old-" + (jfet ? "jfet" : "mosfet");
    let name = baseName;
    if (map.has(name)) {
      for (let num = 2; ; num++) {
        const n = baseName + "-" + num;
        if (!map.has(n)) {
          name = n;
          break;
        }
      }
    }
    const mm = MosfetModel.getModelWithName(name);
    mm.threshold = vt;
    mm.beta = beta;
    mm.showBulk = showBulk;
    mm.bodyDiode = bodyDiode;
    mm.bodyTerminal = bodyTerminal;
    mm.digitalSymbol = digitalSymbol;
    mm.showBodyDiodeSymbol = showBodyDiodeSymbol;
    if (jfet) mm.setJfet();
    mm.oldStyle = true;
    return mm;
  }

  /** XML format: `<mm nm= f= vt= be= la= cgs= cgd= sb= dsy= bd= bt= sbd=>`. */
  static undumpModelXml(xml: XmlNode): MosfetModel {
    const mm = MosfetModel.getModelWithName(xml.string("nm", null) ?? "");
    mm.flags = xml.int("f", mm.flags);
    mm.threshold = xml.double("vt", mm.threshold);
    mm.beta = xml.double("be", mm.beta);
    mm.lambda = xml.double("la", mm.lambda);
    mm.capGS = xml.double("cgs", mm.capGS);
    mm.capGD = xml.double("cgd", mm.capGD);
    mm.showBulk = xml.int("sb", mm.showBulk ? 1 : 0) !== 0;
    mm.digitalSymbol = xml.int("dsy", mm.digitalSymbol ? 1 : 0) !== 0;
    mm.bodyDiode = xml.int("bd", mm.bodyDiode ? 1 : 0) !== 0;
    mm.bodyTerminal = xml.int("bt", mm.bodyTerminal ? 1 : 0) !== 0;
    mm.showBodyDiodeSymbol = xml.int("sbd", mm.showBodyDiodeSymbol ? 1 : 0) !== 0;
    return mm;
  }

  dumpXml(): XmlAttrs {
    const b = (v: boolean) => (v ? "1" : "0");
    const a: XmlAttrs = [["nm", this.name], ["f", String(this.flags)], ["vt", String(this.threshold)], ["be", String(this.beta)]];
    if (this.lambda !== 0) a.push(["la", String(this.lambda)]);
    if (this.capGS !== 0) a.push(["cgs", String(this.capGS)]);
    if (this.capGD !== 0) a.push(["cgd", String(this.capGD)]);
    a.push(["sb", b(this.showBulk)], ["dsy", b(this.digitalSymbol)], ["bd", b(this.bodyDiode)], ["bt", b(this.bodyTerminal)], ["sbd", b(this.showBodyDiodeSymbol)]);
    return a;
  }

  /** Models offered for a MOSFET (or a JFET). */
  static getModelList(jfet: boolean): MosfetModel[] {
    const list = [...new Set(MosfetModel.createModelMap().values())].filter((mm) => !mm.internal && mm.isJfet() === jfet);
    return list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  getDescription(): string {
    return this.description === null || this.description === this.name ? this.name : `${this.name} (${this.description})`;
  }
}

/** Square-law MOSFET with optional body diodes, body terminal and gate capacitances. */
export class MosfetElm extends CircuitElm {
  static override dumpType = "f".charCodeAt(0);
  static readonly FLAG_PNP = 1;
  static readonly FLAG_SHOWVT = 2;
  static readonly FLAG_FLIP = 8;
  // no longer set on new elements (these settings now live on MosfetModel), but still needed to
  // decode old files that packed them into the element's flags
  static readonly FLAG_DIGITAL_LEGACY = 4;
  static readonly FLAG_HIDE_BULK_LEGACY = 16;
  static readonly FLAG_BODY_DIODE_LEGACY = 32;
  static readonly FLAG_BODY_TERMINAL_LEGACY = 64;
  static readonly FLAG_SHOW_BODY_DIODE_LEGACY = 128;
  static lastModelName = "default";
  static readonly hs = 16;

  /** 1 for n-channel, -1 for p-channel. */
  pnp = 1;
  bodyTerminal = 0;
  vt = 0;
  /** beta = 1/(RdsON*(Vgs-Vt)) */
  beta = 0;
  // gate capacitance state (backward Euler companion model)
  capVoltGS = 0;
  capVoltGD = 0;
  capCurGS = 0;
  capCurGD = 0;
  geqGS = 0;
  geqGD = 0;
  ceqGS = 0;
  ceqGD = 0;
  /** Body diodes: from node 1 and from node 2 to the body. */
  diodeB1 = new Diode(this);
  diodeB2 = new Diode(this);
  diodeCurrent1 = 0;
  diodeCurrent2 = 0;
  modelName = "";
  model: MosfetModel | null = null;

  // cached copies of the model's drawing/behavior settings, refreshed in setup()
  bulkShown = false;
  digitalSymbolShown = false;
  bodyDiodeSimulated = false;
  bodyTerminalShown = false;
  bodyDiodeSymbolShown = false;

  lastv0 = 0;
  lastv1 = 0;
  lastv2 = 0;
  ids = 0;
  /** 0 = off, 1 = linear, 2 = saturation. */
  mode = 0;
  gm = 0;

  // geometry: source/drain (swapped on PNP), gate and body points
  src: GridPoint[] = [];
  drn: GridPoint[] = [];
  gate: GridPoint[] = [];
  body: GridPoint[] | null = null;

  /** Is this a JFET? Both share MosfetModel; this only picks the default model. */
  isJfet(): boolean {
    return false;
  }
  getLastModelName(): string {
    return MosfetElm.lastModelName;
  }
  /** Fallback vt for old files. JfetElm overrides this. */
  getDefaultThreshold(): number {
    return 1.5;
  }
  /** Fallback beta for old files with no configurable beta. JfetElm overrides this. */
  getBackwardCompatibilityBeta(): number {
    return 0.02;
  }

  /** The Java "new element" constructor; NMosfetElm and PMosfetElm pick the polarity. */
  initNewPolarity(pnpflag: boolean): void {
    this.pnp = pnpflag ? -1 : 1;
    this.flags = pnpflag ? MosfetElm.FLAG_PNP : 0;
    this.noDiagonal = true;
    this.setupDiodes();
    this.modelName = this.getLastModelName();
    this.setup();
  }

  override initNew(): void {
    this.initNewPolarity(false);
  }

  override readTokens(st: TokenStream): void {
    this.pnp = (this.flags & MosfetElm.FLAG_PNP) !== 0 ? -1 : 1;
    this.noDiagonal = true;
    this.setupDiodes();
    let vt0 = this.getDefaultThreshold();
    let beta0 = this.getBackwardCompatibilityBeta();
    // both optional; Java reads them in one try block
    const v = st.tryDouble();
    if (v !== undefined) {
      vt0 = v;
      const b = st.tryDouble();
      if (b !== undefined) beta0 = b;
    }
    this.model = this.legacyModel(vt0, beta0, this.flags);
    this.modelName = this.model.name;
    this.setup();
    this.allocNodes();
  }

  override undumpXml(xml: XmlNode): void {
    this.flags = 0;
    super.undumpXml(xml);
    const mo = xml.string("mo", null);
    if (mo === null) {
      // pre-model file: vt/be on the element, drawing/behavior options in its flags
      const vt0 = xml.double("vt", this.getDefaultThreshold());
      const beta0 = xml.double("be", this.getBackwardCompatibilityBeta());
      this.model = this.legacyModel(vt0, beta0, this.flags);
      this.modelName = this.model.name;
    } else this.modelName = mo;
    this.setup();
    this.pnp = (this.flags & MosfetElm.FLAG_PNP) !== 0 ? -1 : 1;
  }

  /**
   * Build (or find) a model matching the drawing/behavior bits of a pre-model file, and strip
   * those bits from our own flags.
   */
  legacyModel(vt0: number, beta0: number, legacyFlags: number): MosfetModel {
    // JFETs never showed a bulk terminal
    const legacyShowBulk = !this.isJfet() && (legacyFlags & (MosfetElm.FLAG_DIGITAL_LEGACY | MosfetElm.FLAG_HIDE_BULK_LEGACY)) === 0;
    const legacyDigital = (legacyFlags & MosfetElm.FLAG_DIGITAL_LEGACY) !== 0;
    const legacyBodyDiode = (legacyFlags & MosfetElm.FLAG_BODY_DIODE_LEGACY) !== 0;
    const legacyBodyTerminal = (legacyFlags & MosfetElm.FLAG_BODY_TERMINAL_LEGACY) !== 0;
    const legacyShowBodyDiode = (legacyFlags & MosfetElm.FLAG_SHOW_BODY_DIODE_LEGACY) !== 0;
    this.flags &= ~(MosfetElm.FLAG_DIGITAL_LEGACY | MosfetElm.FLAG_HIDE_BULK_LEGACY | MosfetElm.FLAG_BODY_DIODE_LEGACY |
      MosfetElm.FLAG_BODY_TERMINAL_LEGACY | MosfetElm.FLAG_SHOW_BODY_DIODE_LEGACY);
    return MosfetModel.getModelWithParameters(vt0, beta0, this.isJfet(), legacyShowBulk, legacyBodyDiode, legacyBodyTerminal,
      legacyDigital, legacyShowBodyDiode);
  }

  /**
   * The text format has no MOSFET model lines, so it stores the old per-element form: vt and beta,
   * with the drawing/behavior options packed into the flags (decoded again by legacyModel).
   */
  override dump(): string {
    const m = this.model!;
    let f = this.flags & ~(MosfetElm.FLAG_DIGITAL_LEGACY | MosfetElm.FLAG_HIDE_BULK_LEGACY | MosfetElm.FLAG_BODY_DIODE_LEGACY |
      MosfetElm.FLAG_BODY_TERMINAL_LEGACY | MosfetElm.FLAG_SHOW_BODY_DIODE_LEGACY);
    if (!m.showBulk) f |= m.digitalSymbol ? MosfetElm.FLAG_DIGITAL_LEGACY : MosfetElm.FLAG_HIDE_BULK_LEGACY;
    if (m.bodyDiode) f |= MosfetElm.FLAG_BODY_DIODE_LEGACY;
    if (m.bodyTerminal) f |= MosfetElm.FLAG_BODY_TERMINAL_LEGACY;
    if (m.showBodyDiodeSymbol) f |= MosfetElm.FLAG_SHOW_BODY_DIODE_LEGACY;
    const t = (this.constructor as typeof MosfetElm).dumpType;
    return `${String.fromCharCode(t)} ${this.x} ${this.y} ${this.x2} ${this.y2} ${f} ${m.threshold} ${m.beta}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["mo", this.modelName]);
  }

  /** Lambda and gate capacitances only exist in XML models. */
  override textLossless(): boolean {
    const m = this.model!;
    return m.lambda === 0 && m.capGS === 0 && m.capGD === 0;
  }

  /** Switch to another model by name. */
  setModel(name: string): void {
    this.modelName = name;
    this.model = null;
    this.setup();
  }

  setup(): void {
    const model = MosfetModel.getModelWithNameOrCopy(this.modelName, this.model, this.isJfet());
    this.model = model;
    this.modelName = model.name;
    this.vt = model.threshold;
    this.beta = model.beta;
    this.bulkShown = model.showBulk;
    this.digitalSymbolShown = !this.bulkShown && model.digitalSymbol;
    this.bodyDiodeSimulated = this.bulkShown && model.bodyDiode;
    this.bodyTerminalShown = this.bodyDiodeSimulated && model.bodyTerminal;
    this.bodyDiodeSymbolShown = this.bodyDiodeSimulated && model.showBodyDiodeSymbol;
    this.allocNodes(); // post count may have changed
  }

  updateModels(): void {
    this.setup();
    this.setPoints();
  }

  setupDiodes(): void {
    this.diodeB1.setupForDefaultModel();
    this.diodeB2.setupForDefaultModel();
  }

  hasGateCaps(): boolean {
    return this.model!.capGS > 0 || this.model!.capGD > 0;
  }
  drawDigital(): boolean {
    return this.digitalSymbolShown;
  }
  showBulk(): boolean {
    return this.bulkShown;
  }
  hasBodyTerminal(): boolean {
    return this.bodyTerminalShown;
  }
  doBodyDiode(): boolean {
    return this.bodyDiodeSimulated;
  }
  showBodyDiode(): boolean {
    return this.bodyDiodeSymbolShown;
  }

  override nonLinear(): boolean {
    return true;
  }

  override reset(): void {
    this.lastv1 = this.lastv2 = this.volts[0] = this.volts[1] = this.volts[2] = this.curcount = 0;
    this.capVoltGS = this.capVoltGD = this.capCurGS = this.capCurGD = 0;
    this.geqGS = this.geqGD = this.ceqGS = this.ceqGD = 0;
    this.diodeB1.reset();
    this.diodeB2.reset();
    if (this.doBodyDiode()) this.volts[this.bodyTerminal] = 0;
  }

  override setPoints(): void {
    super.setPoints();
    const hs = MosfetElm.hs;
    let hs2 = hs * this.dsign;
    if ((this.flags & MosfetElm.FLAG_FLIP) !== 0) hs2 = -hs2;
    const p1 = this.point1, p2 = this.point2, dn = this.dn;
    // Java int arithmetic: hs2*4/3 truncates
    const hs43 = Math.trunc((-hs2 * 4) / 3);
    this.src = [interpPointPerp(p1, p2, 1, -hs2), interpPointPerp(p1, p2, 1 - 22 / dn, -hs2), interpPointPerp(p1, p2, 1 - 22 / dn, hs43)];
    this.drn = [interpPointPerp(p1, p2, 1, hs2), interpPointPerp(p1, p2, 1 - 22 / dn, hs2), interpPointPerp(p1, p2, 1 - 22 / dn, -hs43)];
    const g0 = interpPointPerp(p1, p2, 1 - 28 / dn, hs2 / 2);
    const g2 = interpPointPerp(p1, p2, 1 - 28 / dn, -hs2 / 2);
    this.gate = [g0, interpPoint(g0, g2, 0.5), g2];
    this.body = this.showBulk() ? [interpPoint(this.src[0], this.drn[0], 0.5), interpPoint(this.src[1], this.drn[1], 0.5)] : null;
  }

  /** Post 0 = gate, 1 = source (drain on PNP), 2 = drain (source on PNP), 3 = body (if present). */
  override getPost(n: number): GridPoint {
    return n === 0 ? this.point1 : n === 1 ? this.src[0] : n === 2 ? this.drn[0] : this.body![0];
  }

  override getPostCount(): number {
    return this.hasBodyTerminal() ? 4 : 3;
  }

  override getConnection(n1: number, n2: number): boolean {
    if (this.hasGateCaps()) return true;
    return !(n1 === 0 || n2 === 0);
  }

  override getMatrixConnection(): boolean {
    return true;
  }

  override startIteration(): void {
    const sim = this.sim;
    if (sim.timeStep <= 0) return;
    const model = this.model!;
    if (model.capGS > 0) {
      this.geqGS = model.capGS / sim.timeStep;
      this.ceqGS = -this.geqGS * this.capVoltGS;
    }
    if (model.capGD > 0) {
      this.geqGD = model.capGD / sim.timeStep;
      this.ceqGD = -this.geqGD * this.capVoltGD;
    }
  }

  override stamp(): void {
    const sim = this.sim, nodes = this.nodes;
    sim.markNonLinear(nodes[1]!);
    sim.markNonLinear(nodes[2]!);
    if (this.hasGateCaps()) sim.markNonLinear(nodes[0]!);

    if (this.hasBodyTerminal()) this.bodyTerminal = 3;
    else this.bodyTerminal = this.pnp === -1 ? 2 : 1;

    if (this.doBodyDiode()) {
      if (this.pnp === -1) {
        // pnp: diodes conduct when S or D are higher than body
        this.diodeB1.stamp(nodes[1]!, nodes[this.bodyTerminal]!);
        this.diodeB2.stamp(nodes[2]!, nodes[this.bodyTerminal]!);
      } else {
        // npn: diodes conduct when body is higher than S or D
        this.diodeB1.stamp(nodes[this.bodyTerminal]!, nodes[1]!);
        this.diodeB2.stamp(nodes[this.bodyTerminal]!, nodes[2]!);
      }
    }
  }

  nonConvergence(last: number, now: number): boolean {
    let diff = Math.abs(last - now);
    // high beta MOSFETs are more sensitive to small differences, so be stricter
    if (this.beta > 1) diff *= 100;
    // difference of less than 10mV is fine
    if (diff < 0.01) return false;
    const sub = this.sim.subIterations;
    // larger differences are fine if the value is large
    if (sub > 10 && diff < Math.abs(now) * 0.001) return false;
    // if we're having trouble converging, get more lenient
    if (sub > 100 && diff < 0.01 + (sub - 100) * 0.0001) return false;
    return true;
  }

  override stepFinished(): void {
    this.calculate(true);

    // fix current if body is connected to source or drain
    if (this.bodyTerminal === 1) this.diodeCurrent1 = -this.diodeCurrent2;
    if (this.bodyTerminal === 2) this.diodeCurrent2 = -this.diodeCurrent1;

    // save gate cap state for the next time step
    const model = this.model!;
    if (model.capGS > 0 && this.geqGS > 0) {
      this.capVoltGS = this.volts[0] - this.volts[1];
      this.capCurGS = this.geqGS * this.capVoltGS + this.ceqGS;
    }
    if (model.capGD > 0 && this.geqGD > 0) {
      this.capVoltGD = this.volts[0] - this.volts[2];
      this.capCurGD = this.geqGD * this.capVoltGD + this.ceqGD;
    }
  }

  override doStep(): void {
    this.calculate(false);
  }

  /** Stamps the matrix (from doStep), or only calculates the current (from stepFinished). */
  calculate(finished: boolean): void {
    const volts = this.volts, sim = this.sim, pnp = this.pnp;
    let vs: number[];
    if (finished) vs = volts;
    else {
      // limit voltage changes to .5V
      vs = [volts[0], volts[1], volts[2]];
      if (vs[1] > this.lastv1 + 0.5) vs[1] = this.lastv1 + 0.5;
      if (vs[1] < this.lastv1 - 0.5) vs[1] = this.lastv1 - 0.5;
      if (vs[2] > this.lastv2 + 0.5) vs[2] = this.lastv2 + 0.5;
      if (vs[2] < this.lastv2 - 0.5) vs[2] = this.lastv2 - 0.5;
    }

    let source = 1;
    let drain = 2;
    // if source voltage > drain (for NPN), swap source and drain (opposite for PNP)
    if (pnp * vs[1] > pnp * vs[2]) {
      source = 2;
      drain = 1;
    }
    const gate = 0;
    let vgs = vs[gate] - vs[source];
    let vds = vs[drain] - vs[source];
    if (!finished && (this.nonConvergence(this.lastv1, vs[1]) || this.nonConvergence(this.lastv2, vs[2]) || this.nonConvergence(this.lastv0, vs[0])))
      sim.converged = false;
    this.lastv0 = vs[0];
    this.lastv1 = vs[1];
    this.lastv2 = vs[2];
    const realvgs = vgs;
    const realvds = vds;
    vgs *= pnp;
    vds *= pnp;
    this.ids = 0;
    this.gm = 0;
    let Gds = 0;
    const vt = this.vt, beta = this.beta, lambda = this.model!.lambda;
    if (vgs < vt) {
      // should be all zero, but that causes a singular matrix, so use a large resistor
      Gds = 1e-8;
      this.ids = vds * Gds;
      this.mode = 0;
    } else if (vds < vgs - vt) {
      // linear
      this.ids = beta * ((vgs - vt) * vds - vds * vds * 0.5) * (1 + lambda * vds);
      this.gm = beta * vds * (1 + lambda * vds);
      Gds = beta * ((vgs - vds - vt) * (1 + lambda * vds) + lambda * ((vgs - vt) * vds - vds * vds * 0.5));
      this.mode = 1;
    } else {
      // saturation; Gds = 0 without lambda
      const vgs_vt = vgs - vt;
      this.gm = beta * vgs_vt * (1 + lambda * vds);
      Gds = 0.5 * beta * vgs_vt * vgs_vt * lambda;
      if (Gds < 1e-8) Gds = 1e-8;
      this.ids = 0.5 * beta * vgs_vt * vgs_vt * (1 + lambda * vds);
      this.mode = 2;
    }

    if (this.doBodyDiode()) {
      const bt = this.bodyTerminal;
      this.diodeB1.doStep(pnp * (volts[bt] - volts[1]));
      this.diodeCurrent1 = this.diodeB1.calculateCurrent(pnp * (volts[bt] - volts[1])) * pnp;
      this.diodeB2.doStep(pnp * (volts[bt] - volts[2]));
      this.diodeCurrent2 = this.diodeB2.calculateCurrent(pnp * (volts[bt] - volts[2])) * pnp;
    } else this.diodeCurrent1 = this.diodeCurrent2 = 0;

    const ids0 = this.ids;
    // flip ids if we swapped source and drain above
    if ((source === 2 && pnp === 1) || (source === 1 && pnp === -1)) this.ids = -this.ids;

    if (finished) return;

    const nodes = this.nodes, gm = this.gm;
    const nd = nodes[drain]!, ns = nodes[source]!, ng = nodes[gate]!;
    const rs = -pnp * ids0 + Gds * realvds + gm * realvgs;
    sim.stampMatrix(nd, nd, Gds);
    sim.stampMatrix(nd, ns, -Gds - gm);
    sim.stampMatrix(nd, ng, gm);

    sim.stampMatrix(ns, nd, -Gds);
    sim.stampMatrix(ns, ns, Gds + gm);
    sim.stampMatrix(ns, ng, -gm);

    sim.stampRightSide(nd, rs);
    sim.stampRightSide(ns, -rs);

    // gate capacitance companion model stamps (backward Euler; avoids the oscillation the
    // trapezoidal rule can cause when RC is small relative to the timestep)
    const model = this.model!;
    const n0 = nodes[0]!, n1 = nodes[1]!, n2 = nodes[2]!;
    if (model.capGS > 0 && this.geqGS > 0) {
      sim.stampMatrix(n0, n0, this.geqGS);
      sim.stampMatrix(n1, n1, this.geqGS);
      sim.stampMatrix(n0, n1, -this.geqGS);
      sim.stampMatrix(n1, n0, -this.geqGS);
      sim.stampRightSide(n0, -this.ceqGS);
      sim.stampRightSide(n1, this.ceqGS);
    }
    if (model.capGD > 0 && this.geqGD > 0) {
      sim.stampMatrix(n0, n0, this.geqGD);
      sim.stampMatrix(n2, n2, this.geqGD);
      sim.stampMatrix(n0, n2, -this.geqGD);
      sim.stampMatrix(n2, n0, -this.geqGD);
      sim.stampRightSide(n0, -this.ceqGD);
      sim.stampRightSide(n2, this.ceqGD);
    }
  }

  override getCurrent(): number {
    return this.ids;
  }

  override getPower(): number {
    const v = this.volts, bt = this.bodyTerminal;
    return this.ids * (v[2] - v[1]) - this.diodeCurrent1 * (v[1] - v[bt]) - this.diodeCurrent2 * (v[2] - v[bt]);
  }

  override getVoltageDiff(): number {
    return this.volts[2] - this.volts[1];
  }

  override getCurrentIntoNode(n: number): number {
    const model = this.model!, v = this.volts;
    if (n === 0) {
      // gate current from cap currents (cap current flows out of gate)
      let gateCur = 0;
      if (model.capGS > 0 && this.geqGS > 0) gateCur -= this.geqGS * (v[0] - v[1]) + this.ceqGS;
      if (model.capGD > 0 && this.geqGD > 0) gateCur -= this.geqGD * (v[0] - v[2]) + this.ceqGD;
      return gateCur;
    }
    if (n === 3) return -this.diodeCurrent1 - this.diodeCurrent2;
    if (n === 1) {
      const capCur = model.capGS > 0 && this.geqGS > 0 ? this.geqGS * (v[0] - v[1]) + this.ceqGS : 0;
      return this.ids + this.diodeCurrent1 + capCur;
    }
    const capCur = model.capGD > 0 && this.geqGD > 0 ? this.geqGD * (v[0] - v[2]) + this.ceqGD : 0;
    return -this.ids + this.diodeCurrent2 + capCur;
  }

  /** Body current, as shown in the info panel. */
  getBodyCurrent(): number {
    const bt = this.bodyTerminal;
    return bt === 1 ? -this.diodeCurrent1 : bt === 2 ? this.diodeCurrent2 : -this.pnp * (this.diodeCurrent1 + this.diodeCurrent2);
  }
}

export class NMosfetElm extends MosfetElm {
  override initNew(): void {
    this.initNewPolarity(false);
  }
}

export class PMosfetElm extends MosfetElm {
  override initNew(): void {
    this.initNewPolarity(true);
  }
}
