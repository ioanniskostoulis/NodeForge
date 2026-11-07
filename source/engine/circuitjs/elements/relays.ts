// Ported from CircuitJS1 (RelayElm.java, RelayModel.java, RelayCoilElm.java, RelayContactElm.java)
// by Paul Falstad, Iain Sharp and contributors.
// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { CircuitElm, type XmlAttrs } from "../core/elm";
import { type GridPoint, interpPoint, interpPointPerp } from "../core/geometry";
import { CircuitText, type TokenStream, type XmlNode } from "../io/tokens";
import { Inductor } from "./reactive";

/** Relay parameters, shared by name like the other device models. */
export class RelayModel {
  private static modelMap: Map<string, RelayModel> | null = null;
  flags = 0;
  name = "";
  description: string | null = null;
  inductance = 0.2;
  r_on = 0.05;
  r_off = 1e6;
  onCurrent = 0.02;
  offCurrent = 0.015;
  coilR = 20;
  switchingTime = 5e-3;
  /** 0 = coil on both sides, 1 = side 1, 2 = side 2. */
  coilStyle = 0;
  poleCount = 1;
  showBox = true;
  pulldown = true;
  dumped = false;
  readOnly = false;
  builtIn = false;
  oldStyle = false;

  static copyOf(c: RelayModel): RelayModel {
    const m = new RelayModel();
    m.flags = c.flags;
    m.inductance = c.inductance;
    m.r_on = c.r_on;
    m.r_off = c.r_off;
    m.onCurrent = c.onCurrent;
    m.offCurrent = c.offCurrent;
    m.coilR = c.coilR;
    m.switchingTime = c.switchingTime;
    m.coilStyle = c.coilStyle;
    m.poleCount = c.poleCount;
    m.showBox = c.showBox;
    m.pulldown = c.pulldown;
    return m;
  }

  static getModelWithName(name: string): RelayModel {
    const map = RelayModel.createModelMap();
    let m = map.get(name);
    if (m) return m;
    m = new RelayModel();
    m.name = name;
    map.set(name, m);
    return m;
  }

  static getModelWithNameOrCopy(name: string, old: RelayModel | null): RelayModel {
    const map = RelayModel.createModelMap();
    let m = map.get(name);
    if (m) return m;
    if (!old) return RelayModel.getModelWithName("default");
    m = RelayModel.copyOf(old);
    m.name = name;
    map.set(name, m);
    return m;
  }

  static createModelMap(): Map<string, RelayModel> {
    if (RelayModel.modelMap) return RelayModel.modelMap;
    const map = (RelayModel.modelMap = new Map());
    const add = (name: string, m: RelayModel) => {
      map.set(name, m);
      m.readOnly = m.builtIn = true;
      m.name = name;
    };
    add("default", new RelayModel());
    const m2 = new RelayModel();
    m2.poleCount = 2;
    add("default-2-poles", m2);
    const m3 = new RelayModel();
    m3.poleCount = 3;
    add("default-3-poles", m3);
    return map;
  }

  static getModelList(): RelayModel[] {
    return [...new Set(RelayModel.createModelMap().values())].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  getDescription(): string {
    return this.description === null ? this.name : `${this.name} (${this.description})`;
  }

  /** Find or create a model for an old file that stored the relay parameters inline. */
  static getModelWithParameters(inductance: number, r_on: number, r_off: number, onCurrent: number, offCurrent: number, coilR: number,
    switchingTime: number, coilStyle: number, showBox: boolean, pulldown: boolean, poleCount: number): RelayModel {
    const map = RelayModel.createModelMap();
    const eq = (a: number, b: number) => Math.abs(a - b) < 1e-15;
    for (const m of map.values()) {
      if (eq(m.inductance, inductance) && eq(m.r_on, r_on) && eq(m.r_off, r_off) && eq(m.onCurrent, onCurrent) && eq(m.offCurrent, offCurrent) &&
        eq(m.coilR, coilR) && eq(m.switchingTime, switchingTime) && m.coilStyle === coilStyle && m.showBox === showBox && m.pulldown === pulldown &&
        m.poleCount === poleCount) return m;
    }
    let name = "old-relay";
    if (map.has(name)) for (let num = 2; ; num++) if (!map.has(`old-relay-${num}`)) {
      name = `old-relay-${num}`;
      break;
    }
    const m = RelayModel.getModelWithName(name);
    Object.assign(m, { inductance, r_on, r_off, onCurrent, offCurrent, coilR, switchingTime, coilStyle, showBox, pulldown, poleCount, oldStyle: true });
    return m;
  }

  static undumpModelXml(xml: XmlNode): RelayModel {
    const m = RelayModel.getModelWithName(xml.string("nm", null) ?? "");
    m.flags = xml.int("f", m.flags);
    m.inductance = xml.double("in", m.inductance);
    m.r_on = xml.double("ron", m.r_on);
    m.r_off = xml.double("rof", m.r_off);
    m.onCurrent = xml.double("on", m.onCurrent);
    m.offCurrent = xml.double("of", m.offCurrent);
    m.coilR = xml.double("coR", m.coilR);
    m.switchingTime = xml.double("sw", m.switchingTime);
    m.coilStyle = xml.int("cs", m.coilStyle);
    m.poleCount = xml.int("po", m.poleCount);
    m.showBox = xml.int("sb", m.showBox ? 1 : 0) !== 0;
    m.pulldown = xml.int("pd", m.pulldown ? 1 : 0) !== 0;
    return m;
  }

  dumpXml(): XmlAttrs {
    const a: XmlAttrs = [["nm", this.name], ["f", String(this.flags)], ["in", String(this.inductance)], ["ron", String(this.r_on)], ["rof", String(this.r_off)],
      ["on", String(this.onCurrent)], ["of", String(this.offCurrent)], ["coR", String(this.coilR)], ["sw", String(this.switchingTime)], ["cs", String(this.coilStyle)]];
    if (this.poleCount !== 1) a.push(["po", String(this.poleCount)]);
    if (this.showBox) a.push(["sb", "1"]);
    if (this.pulldown) a.push(["pd", "1"]);
    return a;
  }
}

/** Relay: a coil (inductor + resistance) and one or more SPDT poles. */
export class RelayElm extends CircuitElm {
  static override dumpType = 178;
  static override get xmlTag(): string {
    return "rl";
  }
  static readonly FLAG_SWAP_COIL = 1;
  static readonly FLAG_SHOW_BOX = 2;
  static readonly FLAG_BOTH_SIDES_COIL = 4;
  static readonly FLAG_FLIP = 8;
  static readonly FLAG_PULLDOWN = 16;
  static lastModelName = "default";
  modelName = "default";
  model: RelayModel | null = null;
  ind = new Inductor();
  coilCurrent = 0;
  switchCurrent: number[] = [0];
  d_position = 0;
  i_position = 0;
  onState = false;
  nCoil1 = 3;
  nCoil2 = 4;
  nCoil3 = 5;
  openhs = 16;
  dflip = 1;
  swposts: GridPoint[][] = [];
  swpoles: GridPoint[][] = [];
  coilPosts: GridPoint[] = [];
  coilLeads: GridPoint[] = [];
  outline: GridPoint[] = [];

  get m(): RelayModel {
    return this.model!;
  }
  poleCount(): number {
    return this.model?.poleCount ?? 1;
  }
  needsPulldown(): boolean {
    return this.model?.pulldown ?? false;
  }
  static coilStyleFromFlags(f: number): number {
    if ((f & RelayElm.FLAG_SWAP_COIL) !== 0) return 2;
    if ((f & RelayElm.FLAG_BOTH_SIDES_COIL) !== 0) return 0;
    return 1;
  }

  override initNew(): void {
    this.modelName = RelayElm.lastModelName;
    this.model = RelayModel.getModelWithName(this.modelName);
    this.ind.setup(this.m.inductance, 0, Inductor.FLAG_BACK_EULER);
    this.noDiagonal = true;
    this.coilCurrent = 0;
    this.setupPoles();
    this.allocNodes();
  }

  override readTokens(st: TokenStream): void {
    const f = this.flags;
    const poleCount = st.nextInt();
    const inductance = st.nextDouble();
    this.coilCurrent = st.nextDouble();
    const r_on = st.nextDouble(), r_off = st.nextDouble(), onCurrent = st.nextDouble(), coilR = st.nextDouble();
    let offCurrent = onCurrent, switchingTime = 0;
    const of = st.tryDouble();
    if (of !== undefined) {
      offCurrent = of;
      const sw = st.tryDouble();
      if (sw !== undefined) {
        switchingTime = sw;
        const ip = st.tryInt();
        if (ip !== undefined) this.d_position = this.i_position = ip;
      }
    }
    this.model = RelayModel.getModelWithParameters(inductance, r_on, r_off, onCurrent, offCurrent, coilR, switchingTime,
      RelayElm.coilStyleFromFlags(f), (f & RelayElm.FLAG_SHOW_BOX) !== 0, (f & RelayElm.FLAG_PULLDOWN) !== 0, poleCount);
    this.modelName = this.model.name;
    this.postUndump();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    const mo = xml.string("mo", null);
    if (mo !== null) {
      this.modelName = mo;
      this.model = RelayModel.getModelWithNameOrCopy(mo, this.model);
      this.modelName = this.model.name;
    } else if (xml.get("ix") === undefined) {
      const d = new RelayModel();
      this.model = RelayModel.getModelWithParameters(xml.double("in", d.inductance), xml.double("ron", d.r_on), xml.double("roff", d.r_off),
        xml.double("on", d.onCurrent), xml.double("of", d.offCurrent), xml.double("coR", d.coilR), xml.double("sw", d.switchingTime),
        RelayElm.coilStyleFromFlags(this.flags), (this.flags & RelayElm.FLAG_SHOW_BOX) !== 0, (this.flags & RelayElm.FLAG_PULLDOWN) !== 0, xml.int("po", 1));
      this.modelName = this.model.name;
    }
    this.coilCurrent = xml.double("i", this.coilCurrent);
    this.d_position = this.i_position = xml.int("ip", this.i_position);
    this.postUndump();
  }

  /** Text format: the parameters inline, with the drawing options in the flags. */
  override dump(): string {
    const m = this.m;
    let f = this.flags & ~(RelayElm.FLAG_SWAP_COIL | RelayElm.FLAG_SHOW_BOX | RelayElm.FLAG_BOTH_SIDES_COIL | RelayElm.FLAG_PULLDOWN);
    if (m.coilStyle === 2) f |= RelayElm.FLAG_SWAP_COIL;
    else if (m.coilStyle === 0) f |= RelayElm.FLAG_BOTH_SIDES_COIL;
    if (m.showBox) f |= RelayElm.FLAG_SHOW_BOX;
    if (m.pulldown) f |= RelayElm.FLAG_PULLDOWN;
    return `178 ${this.x} ${this.y} ${this.x2} ${this.y2} ${f} ${m.poleCount} ${m.inductance} ${this.coilCurrent} ${m.r_on} ${m.r_off} ${m.onCurrent} ${m.coilR} ${m.offCurrent} ${m.switchingTime} ${this.i_position}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["mo", this.modelName]);
  }

  override dumpXmlState(a: XmlAttrs): void {
    a.push(["i", String(this.coilCurrent)], ["ip", String(this.i_position)]);
  }

  postUndump(): void {
    if (this.i_position === 1) this.onState = true;
    // intermediate state
    if (this.i_position === 2) this.d_position = 0.5;
    this.noDiagonal = true;
    this.ind = new Inductor();
    this.ind.setup(this.m.inductance, this.coilCurrent, Inductor.FLAG_BACK_EULER);
    this.setupPoles();
    this.allocNodes();
  }

  setModel(name: string): void {
    this.model = RelayModel.getModelWithNameOrCopy(name, this.model);
    this.modelName = this.model.name;
    this.ind.setup(this.m.inductance, this.coilCurrent, Inductor.FLAG_BACK_EULER);
    this.setupPoles();
    this.allocNodes();
  }

  setupPoles(): void {
    this.nCoil1 = 3 * this.poleCount();
    this.nCoil2 = this.nCoil1 + 1;
    this.nCoil3 = this.nCoil1 + 2;
    if (this.switchCurrent.length !== this.poleCount()) this.switchCurrent = new Array<number>(this.poleCount()).fill(0);
  }

  override getCurrentIntoNode(n: number): number {
    if (n < 3 * this.poleCount()) {
      const p = Math.trunc(n / 3), k = n % 3;
      if (k === 0) return -this.switchCurrent[p];
      if (k === 1 + this.i_position) return this.switchCurrent[p];
      return 0;
    }
    if (n === this.nCoil1) return -this.coilCurrent;
    return this.coilCurrent;
  }

  override setPoints(): void {
    super.setPoints();
    this.setupPoles();
    this.allocNodes();
    this.dflip = this.hasFlag(RelayElm.FLAG_FLIP) ? -this.dsign : this.dsign;
    const openhs = (this.openhs = -this.dflip * 16);
    this.calcLeads(32);
    const p1 = this.point1, p2 = this.point2, l1 = this.lead1!, l2 = this.lead2!;
    this.swposts = [];
    this.swpoles = [];
    for (let i = 0; i !== this.poleCount(); i++) {
      this.swpoles.push([interpPointPerp(l1, l2, 0, -openhs * 3 * i), interpPointPerp(l1, l2, 1, -openhs * 3 * i - openhs), interpPointPerp(l1, l2, 1, -openhs * 3 * i + openhs)]);
      this.swposts.push([interpPointPerp(p1, p2, 0, -openhs * 3 * i), interpPointPerp(p1, p2, 1, -openhs * 3 * i - openhs), interpPointPerp(p1, p2, 1, -openhs * 3 * i + openhs)]);
    }
    const x = this.m.coilStyle === 2 ? 1 : 0;
    let boxSize: number;
    if (this.m.coilStyle !== 0) {
      this.coilPosts = [interpPointPerp(p1, p2, x, openhs * 2), interpPointPerp(p1, p2, x, openhs * 3)];
      this.coilLeads = [interpPointPerp(p1, p2, 0.5, openhs * 2), interpPointPerp(p1, p2, 0.5, openhs * 3)];
      boxSize = 56;
    } else {
      this.coilPosts = [interpPointPerp(p1, p2, 0, openhs * 2), interpPointPerp(p1, p2, 1, openhs * 2)];
      this.coilLeads = [interpPointPerp(p1, p2, 0.5 - 16 / this.dn, openhs * 2), interpPointPerp(p1, p2, 0.5 + 16 / this.dn, openhs * 2)];
      boxSize = 40;
    }
    const w = Math.min(0.4, 25 / this.dn);
    const far = -(openhs * 3 * this.poleCount()) - 24 * this.dflip;
    this.outline = [interpPointPerp(p1, p2, 0.5 - w, -boxSize * this.dflip), interpPointPerp(p1, p2, 0.5 + w, -boxSize * this.dflip),
      interpPointPerp(p1, p2, 0.5 + w, far), interpPointPerp(p1, p2, 0.5 - w, far)];
  }

  override getPost(n: number): GridPoint {
    if (n < 3 * this.poleCount()) return this.swposts[Math.trunc(n / 3)][n % 3];
    return this.coilPosts[n - 3 * this.poleCount()];
  }
  override getPostCount(): number {
    return 2 + this.poleCount() * 3;
  }
  override getInternalNodeCount(): number {
    return 1;
  }

  override reset(): void {
    super.reset();
    this.ind.resetTo(0);
    this.coilCurrent = 0;
    this.switchCurrent.fill(0);
    this.d_position = this.i_position = 0;
    // (upstream doesn't reset onState)
  }

  override stamp(): void {
    const sim = this.sim, nd = this.nodes;
    // inductor from coil post 1 to internal node
    this.ind.stamp(sim, nd[this.nCoil1]!, nd[this.nCoil3]!);
    // resistor from internal node to coil post 2
    sim.stampResistor(nd[this.nCoil3]!, nd[this.nCoil2]!, this.m.coilR);
    if (this.needsPulldown()) {
      for (let i = 0; i < this.poleCount(); i++) {
        sim.stampResistor(nd[1 + i * 3]!, sim.ground, this.m.r_off);
        sim.stampResistor(nd[2 + i * 3]!, sim.ground, this.m.r_off);
      }
    }
  }

  override startIteration(): void {
    if (this.m.switchingTime === 0) return this.startIterationOld();
    const sim = this.sim;
    this.ind.startIteration(sim, this.volts[this.nCoil1] - this.volts[this.nCoil3]);
    const absCurrent = Math.abs(this.coilCurrent);
    if (this.onState) {
      // on or turning on. check if we need to turn off
      if (absCurrent < this.m.offCurrent) {
        // turning off, set switch to intermediate position
        this.onState = false;
        this.i_position = 2;
      } else {
        this.d_position += sim.timeStep / this.m.switchingTime;
        if (this.d_position >= 1) this.d_position = this.i_position = 1;
      }
    } else if (absCurrent > this.m.onCurrent) {
      // off or turning off. check if we need to turn on: turning on, set switch to intermediate position
      this.onState = true;
      this.i_position = 2;
    } else {
      this.d_position -= sim.timeStep / this.m.switchingTime;
      if (this.d_position <= 0) this.d_position = this.i_position = 0;
    }
  }

  /** The old behavior with switchingTime = 0: position follows the coil current. */
  startIterationOld(): void {
    this.ind.startIteration(this.sim, this.volts[this.nCoil1] - this.volts[this.nCoil3]);
    // CircuitJS's factor balances operate and release timing in the legacy instant-switch model.
    const magic = 1.3;
    const pmult = Math.sqrt(magic + 1);
    const p = (this.coilCurrent * pmult) / this.m.onCurrent;
    this.d_position = Math.abs(p * p) - 1.3;
    if (this.d_position < 0) this.d_position = 0;
    if (this.d_position > 1) this.d_position = 1;
    if (this.d_position < 0.1) this.i_position = 0;
    else if (this.d_position > 0.9) this.i_position = 1;
    else this.i_position = 2;
  }

  override nonLinear(): boolean {
    return true;
  }

  override doStep(): void {
    const sim = this.sim, nd = this.nodes, m = this.m;
    this.ind.doStep(sim);
    for (let p = 0; p !== this.poleCount() * 3; p += 3) {
      if (this.i_position === 0) {
        sim.stampResistor(nd[p]!, nd[p + 1]!, m.r_on);
        if (!this.needsPulldown()) sim.stampResistor(nd[p]!, nd[p + 2]!, m.r_off);
      } else if (this.i_position === 1) {
        sim.stampResistor(nd[p]!, nd[p + 2]!, m.r_on);
        if (!this.needsPulldown()) sim.stampResistor(nd[p]!, nd[p + 1]!, m.r_off);
      } else {
        sim.stampResistor(nd[p]!, nd[p + 1]!, m.r_off);
        sim.stampResistor(nd[p]!, nd[p + 2]!, m.r_off);
      }
    }
  }

  override calculateCurrent(): void {
    const v = this.volts;
    this.coilCurrent = this.ind.calculateCurrent(v[this.nCoil1] - v[this.nCoil3]);
    // The reported contact current excludes leakage through an open contact.
    for (let p = 0; p !== this.poleCount(); p++) {
      if (this.i_position === 2) this.switchCurrent[p] = 0;
      else this.switchCurrent[p] = (v[p * 3] - v[p * 3 + 1 + this.i_position]) / this.m.r_on;
    }
  }

  override getConnection(n1: number, n2: number): boolean {
    return Math.trunc(n1 / 3) === Math.trunc(n2 / 3);
  }
  override hasGroundConnection(n: number): boolean {
    return this.needsPulldown() && n < this.nCoil1;
  }
  override getCurrent(): number {
    return this.coilCurrent;
  }
}

/** A relay coil on its own; it switches the RelayContactElms with the same label. */
export class RelayCoilElm extends CircuitElm {
  static override dumpType = 425;
  static readonly TYPE_NORMAL = 0;
  static readonly TYPE_ON_DELAY = 1;
  static readonly TYPE_OFF_DELAY = 2;
  static readonly TYPE_LATCHING = 3;
  static readonly TYPE_LATCHING_ON = 4;
  static readonly TYPE_LATCHING_OFF = 5;
  inductance = 0.2;
  ind = new Inductor();
  label = "label";
  onCurrent = 0.02;
  offCurrent = 0.015;
  coilCurrent = 0;
  avgCurrent = 0;
  coilR = 20;
  switchingTime = 5e-3;
  switchingTimeOn = 0;
  switchingTimeOff = 0;
  lastTransition = 0;
  state = 0;
  switchPosition = 0;
  type = 0;
  elmList: CircuitElm[] = [];
  coilLeads: GridPoint[] = [];
  outline: GridPoint[] = [];

  static isLatchingType(t: number): boolean {
    return t === RelayCoilElm.TYPE_LATCHING || t === RelayCoilElm.TYPE_LATCHING_ON || t === RelayCoilElm.TYPE_LATCHING_OFF;
  }

  override initNew(): void {
    this.inductance = 0.2;
    this.ind.setup(this.inductance, 0, Inductor.FLAG_BACK_EULER);
    this.noDiagonal = true;
    this.onCurrent = 0.02;
    this.offCurrent = 0.015;
    this.state = 0;
    this.label = "label";
    this.coilR = 20;
    this.switchingTime = 5e-3;
    this.coilCurrent = 0;
  }

  override readTokens(st: TokenStream): void {
    this.label = CircuitText.unescape(st.next());
    this.inductance = st.nextDouble();
    this.coilCurrent = st.nextDouble();
    this.onCurrent = st.nextDouble();
    this.coilR = st.nextDouble();
    this.offCurrent = st.nextDouble();
    this.switchingTime = st.nextDouble();
    this.type = st.nextInt();
    this.state = st.nextInt();
    this.switchPosition = st.nextInt();
    this.noDiagonal = true;
    this.ind.setup(this.inductance, this.coilCurrent, Inductor.FLAG_BACK_EULER);
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.label = xml.string("lb", this.label) ?? this.label;
    this.inductance = xml.double("in", this.inductance);
    this.onCurrent = xml.double("oc", this.onCurrent);
    this.coilR = xml.double("cr", this.coilR);
    this.offCurrent = xml.double("ofc", this.offCurrent);
    this.switchingTime = xml.double("swt", this.switchingTime);
    this.type = xml.int("tp", this.type);
    this.coilCurrent = xml.double("ci", this.coilCurrent);
    this.state = xml.int("st", this.state);
    this.switchPosition = xml.int("sp", this.switchPosition);
    this.noDiagonal = true;
    this.ind.setup(this.inductance, this.coilCurrent, Inductor.FLAG_BACK_EULER);
  }

  override dumpValues(): string {
    return ` ${CircuitText.escape(this.label)} ${this.inductance} ${this.coilCurrent} ${this.onCurrent} ${this.coilR} ${this.offCurrent} ${this.switchingTime} ${this.type} ${this.state} ${this.switchPosition}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["lb", this.label], ["in", String(this.inductance)], ["oc", String(this.onCurrent)], ["cr", String(this.coilR)], ["ofc", String(this.offCurrent)],
      ["swt", String(this.switchingTime)], ["tp", String(this.type)]);
  }

  override dumpXmlState(a: XmlAttrs): void {
    a.push(["ci", String(this.coilCurrent)], ["st", String(this.state)], ["sp", String(this.switchPosition)]);
  }

  override getCurrentIntoNode(n: number): number {
    return n === 0 ? -this.coilCurrent : this.coilCurrent;
  }

  override setPoints(): void {
    super.setPoints();
    const w = Math.min(0.4, 12 / this.dn), p1 = this.point1, p2 = this.point2, box = 32;
    this.coilLeads = [interpPoint(p1, p2, 0.5 - w), interpPoint(p1, p2, 0.5 + w)];
    this.outline = [interpPointPerp(p1, p2, 0.5 - w, -box * this.dsign), interpPointPerp(p1, p2, 0.5 + w, -box * this.dsign),
      interpPointPerp(p1, p2, 0.5 + w, box * this.dsign), interpPointPerp(p1, p2, 0.5 - w, box * this.dsign)];
  }

  override getPostCount(): number {
    return 2;
  }
  override getInternalNodeCount(): number {
    return 1;
  }

  override reset(): void {
    super.reset();
    this.ind.resetTo(0);
    this.coilCurrent = 0;
    this.avgCurrent = 0;
  }

  override setParentList(list: CircuitElm[]): void {
    this.elmList = list;
  }

  override stamp(): void {
    const sim = this.sim, nd = this.nodes;
    // inductor from coil post 1 to internal node, resistor from internal node to coil post 2
    this.ind.stamp(sim, nd[0]!, nd[2]!);
    sim.stampResistor(nd[2]!, nd[1]!, this.coilR);
    if (this.type === RelayCoilElm.TYPE_ON_DELAY) {
      this.switchingTimeOn = this.switchingTime;
      this.switchingTimeOff = 0;
    } else if (this.type === RelayCoilElm.TYPE_OFF_DELAY) {
      this.switchingTimeOff = this.switchingTime;
      this.switchingTimeOn = 0;
    } else this.switchingTimeOff = this.switchingTimeOn = this.switchingTime;
    if (this.type !== RelayCoilElm.TYPE_LATCHING_ON && this.type !== RelayCoilElm.TYPE_LATCHING_OFF) this.toggleSwitchPositions();
  }

  override startIteration(): void {
    const sim = this.sim, T = RelayCoilElm;
    this.ind.startIteration(sim, this.volts[0] - this.volts[2]);
    const absCurrent = Math.abs(this.coilCurrent);
    const a = Math.exp(-sim.timeStep * 1e3);
    this.avgCurrent = a * this.avgCurrent + (1 - a) * absCurrent;
    const oldSwitchPosition = this.switchPosition;
    if (this.state === 0) {
      if (this.avgCurrent > this.onCurrent) {
        this.lastTransition = sim.t;
        this.state = 1;
      }
    } else if (this.state === 1) {
      if (this.avgCurrent < this.offCurrent) this.state = 0;
      else if (sim.t - this.lastTransition > this.switchingTimeOn) {
        this.state = 2;
        if (this.type === T.TYPE_LATCHING) this.switchPosition = 1 - this.switchPosition;
        else if (this.type === T.TYPE_LATCHING_ON) {
          this.switchPosition = 1;
          this.setSwitchPositions(0);
        } else if (this.type === T.TYPE_LATCHING_OFF) {
          this.switchPosition = 0;
          this.setSwitchPositions(1);
        } else this.switchPosition = 1;
      }
    } else if (this.state === 2) {
      if (this.avgCurrent < this.offCurrent) {
        this.lastTransition = sim.t;
        this.state = 3;
      }
    } else if (this.state === 3) {
      if (this.avgCurrent > this.onCurrent) this.state = 2;
      else if (sim.t - this.lastTransition > this.switchingTimeOff) {
        this.state = 0;
        if (!T.isLatchingType(this.type)) this.switchPosition = 0;
      }
    }
    if (this.type !== T.TYPE_LATCHING_ON && this.type !== T.TYPE_LATCHING_OFF && oldSwitchPosition !== this.switchPosition) this.toggleSwitchPositions();
  }

  toggleSwitchPositions(): void {
    for (const o of this.elmList) if (o instanceof RelayContactElm && o.label === this.label) o.setContactPosition(1 - this.switchPosition, this.type);
  }

  setSwitchPositions(position: number): void {
    for (const o of this.elmList) if (o instanceof RelayContactElm && o.label === this.label) o.setContactPosition(position, this.type);
  }

  override doStep(): void {
    this.ind.doStep(this.sim);
  }

  override calculateCurrent(): void {
    this.coilCurrent = this.ind.calculateCurrent(this.volts[0] - this.volts[2]);
  }

  override nonLinear(): boolean {
    return false;
  }
  override getConnection(): boolean {
    return true;
  }
  override getCurrent(): number {
    return this.coilCurrent;
  }
}

/** A relay contact, switched by the RelayCoilElm with the same label. */
export class RelayContactElm extends CircuitElm {
  static override dumpType = 426;
  static readonly FLAG_NORMALLY_CLOSED = 2;
  static readonly FLAG_IEC = 4;
  r_on = 0.05;
  r_off = 1e6;
  label = "label";
  type = 0;
  i_position = 0;
  switchCurrent = 0;
  openhs = 16;
  swposts: GridPoint[] = [];
  swpoles: GridPoint[] = [];

  override initNew(): void {
    this.noDiagonal = true;
    this.r_on = 0.05;
    this.r_off = 1e6;
    this.label = "label";
    this.flags |= RelayContactElm.FLAG_IEC;
  }

  override readTokens(st: TokenStream): void {
    this.label = CircuitText.unescape(st.next());
    this.r_on = st.nextDouble();
    this.r_off = st.nextDouble();
    this.i_position = st.tryInt() ?? this.i_position;
    this.noDiagonal = true;
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.label = xml.string("lb", this.label) ?? this.label;
    this.r_on = xml.double("ron", this.r_on);
    this.r_off = xml.double("roff", this.r_off);
    this.i_position = xml.int("ip", this.i_position);
    this.noDiagonal = true;
  }

  override dumpValues(): string {
    return ` ${CircuitText.escape(this.label)} ${this.r_on} ${this.r_off} ${this.i_position}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["lb", this.label], ["ron", String(this.r_on)], ["roff", String(this.r_off)], ["ip", String(this.i_position)]);
  }

  get useIECSymbol(): boolean {
    return (this.flags & RelayContactElm.FLAG_IEC) !== 0;
  }
  isNormallyClosed(): boolean {
    return (this.flags & RelayContactElm.FLAG_NORMALLY_CLOSED) !== 0;
  }

  override getCurrentIntoNode(n: number): number {
    return n === 0 ? -this.switchCurrent : n === 1 ? this.switchCurrent : 0;
  }

  override setPoints(): void {
    super.setPoints();
    this.openhs = this.dsign * 16;
    this.calcLeads(32);
    const l1 = this.lead1!, l2 = this.lead2!, p1 = this.point1, p2 = this.point2;
    this.swpoles = [interpPointPerp(l1, l2, 0, 0), interpPointPerp(l1, l2, 1, 0), interpPointPerp(l1, l2, 1, this.openhs)];
    this.swposts = [interpPointPerp(p1, p2, 0, 0), interpPointPerp(p1, p2, 1, 0), interpPointPerp(p1, p2, 1, this.openhs)];
  }

  /** RelayContactElm.setPosition (renamed: CircuitElm.setPosition moves the element). */
  setContactPosition(position: number, type: number): void {
    this.i_position = this.isNormallyClosed() ? 1 - position : position;
    this.type = type;
  }

  override getPost(n: number): GridPoint {
    return this.swposts[n];
  }
  override getPostCount(): number {
    return 2;
  }

  override reset(): void {
    super.reset();
    this.switchCurrent = 0;
    this.i_position = 0;
  }

  override nonLinear(): boolean {
    return true;
  }

  override doStep(): void {
    this.sim.stampResistor(this.nodes[0]!, this.nodes[1]!, this.i_position === 0 ? this.r_on : this.r_off);
  }

  override calculateCurrent(): void {
    if (this.i_position === 1) this.switchCurrent = 0;
    else this.switchCurrent = (this.volts[0] - this.volts[1 + this.i_position]) / this.r_on;
  }

  override getConnection(): boolean {
    return true;
  }
  override getCurrent(): number {
    return this.switchCurrent;
  }
}
