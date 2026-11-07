// Ported from CircuitJS1 (WireElm.java, GroundElm.java, ResistorElm.java, SwitchElm.java,
// CurrentElm.java) by Paul Falstad and Iain Sharp.
// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { CircuitElm, type XmlAttrs } from "../core/elm";
import { FindPathInfo, PathKind } from "../core/findpath";
import { type GridPoint, pt } from "../core/geometry";
import type { VoltageSource } from "../core/nodes";
import { CircuitText, JavaNumber, type TokenStream, type XmlNode } from "../io/tokens";

const ch = (c: string) => c.charCodeAt(0);

export class WireElm extends CircuitElm {
  static override dumpType = ch("w");
  static readonly FLAG_SHOWCURRENT = 1;
  static readonly FLAG_SHOWVOLTAGE = 2;

  busWidth = 1;
  currents: number[] | null = null;

  override getPostCount(): number {
    return this.busWidth * 2;
  }
  override getBusWidth(): number {
    return this.busWidth;
  }
  override getPostWidth(): number {
    return this.busWidth;
  }
  override setBusWidth(w: number): void {
    this.busWidth = w;
    this.currents = w > 1 ? new Array<number>(w).fill(0) : null;
    this.allocNodes();
  }

  override getPost(n: number): GridPoint {
    if (this.busWidth === 1) return n === 0 ? this.point1 : this.point2;
    if (n < this.busWidth) return pt(this.point1.x, this.point1.y, n);
    return pt(this.point2.x, this.point2.y, n - this.busWidth);
  }

  override getConnection(n1: number, n2: number): boolean {
    if (this.busWidth === 1) return true;
    // only matching bits are connected
    return Math.abs(n1 - n2) === this.busWidth;
  }

  override getConnectedPost(n = 0): GridPoint | null {
    if (this.busWidth === 1) return n === 0 ? this.point2 : this.point1;
    if (n < this.busWidth) return pt(this.point2.x, this.point2.y, n);
    return pt(this.point1.x, this.point1.y, n - this.busWidth);
  }

  override getPower(): number {
    return 0;
  }
  override getVoltageDiff(): number {
    return this.volts[0];
  }
  override isWireEquivalent(): boolean {
    return true;
  }
  override isRemovableWire(): boolean {
    return true;
  }
  override isWire(): boolean {
    return true;
  }

  override setWireCurrent(bit: number, c: number): void {
    if (this.currents) this.currents[bit] = c;
    else this.current = c;
  }

  override getCurrentIntoNode(n: number): number {
    if (this.currents) return n < this.busWidth ? -this.currents[n] : this.currents[n - this.busWidth];
    return n === 0 ? -this.current : this.current;
  }
}

export class GroundElm extends CircuitElm {
  static override dumpType = ch("g");
  /** Needed for old subcircuits which have GroundElm dumped. */
  static readonly FLAG_OLD_STYLE = 1;

  /** 0 = earth, 1 = chassis, 2 = signal, 3 = common. */
  symbolType = 0;

  override readTokens(st: TokenStream): void {
    const s = st.tryInt();
    if (s !== undefined) this.symbolType = s;
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.symbolType = xml.int("sy", 0);
  }

  override dumpValues(): string {
    return ` ${this.symbolType}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    if (this.symbolType !== 0) a.push(["sy", String(this.symbolType)]);
  }

  override getPostCount(): number {
    return 1;
  }

  get isOldStyle(): boolean {
    return (this.flags & GroundElm.FLAG_OLD_STYLE) !== 0;
  }
  override getVoltageSourceCount(): number {
    return this.isOldStyle ? 1 : 0;
  }

  override stamp(): void {
    if (this.isOldStyle) this.sim.stampVoltageSource(this.sim.ground, this.nodes[0]!, this.voltSource!, 0);
  }

  override setCurrent(_vs: VoltageSource, c: number): void {
    this.current = this.isOldStyle ? -c : c;
  }

  override isWireEquivalent(): boolean {
    return true;
  }
  override isRemovableWire(): boolean {
    return true;
  }
  override isGround(): boolean {
    return true;
  }

  /** All grounds are merged: the first one seen reports no connection, later ones connect to it. */
  override getConnectedPost(): GridPoint | null {
    if (this.sim.firstGround) return this.sim.firstGround;
    this.sim.firstGround = this.point1;
    return null;
  }

  override getVoltageDiff(): number {
    return 0;
  }
  override hasGroundConnection(): boolean {
    return true;
  }
  override getCurrentIntoNode(): number {
    return -this.current;
  }
}

export class ResistorElm extends CircuitElm {
  static override dumpType = ch("r");
  resistance = 0;

  override initNew(): void {
    this.resistance = 1000;
  }

  override readTokens(st: TokenStream): void {
    this.resistance = st.nextDouble();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.resistance = xml.double("r", this.resistance);
  }

  override dumpValues(): string {
    return ` ${this.resistance}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["r", String(this.resistance)]);
  }

  override setPoints(): void {
    super.setPoints();
    this.calcLeads(32);
  }

  override calculateCurrent(): void {
    this.current = (this.volts[0] - this.volts[1]) / this.resistance;
  }

  override stamp(): void {
    this.sim.stampResistor(this.nodes[0]!, this.nodes[1]!, this.resistance);
  }
}

/** SPST switch. A closed ideal switch is merged out of the matrix like a wire. */
export class SwitchElm extends CircuitElm {
  static override dumpType = ch("s");
  static readonly COMPOSITE_CLOSED_R = 0.001;
  static readonly FLAG_IEC = 2;
  static readonly FLAG_LABEL = 4;
  /** Logic inputs store their position inverted in the old text format. */
  static invertsBooleanPosition = false;

  momentary = false;
  /** 0 = closed, 1 = open. */
  position = 0;
  posCount = 2;
  resistance = 0;
  /** Switches sharing a label toggle together. */
  label: string | null = null;
  keyShortcut: string | null = null;

  override readTokens(st: TokenStream): void {
    const str = st.next();
    const inverted = (this.constructor as typeof SwitchElm).invertsBooleanPosition;
    if (str === "true") this.position = inverted ? 0 : 1;
    else if (str === "false") this.position = inverted ? 1 : 0;
    else this.position = JavaNumber.parseInt(str);
    this.momentary = st.nextBool();
    if ((this.flags & SwitchElm.FLAG_LABEL) !== 0) this.label = CircuitText.unescape(st.next());
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.position = xml.int("p", this.position);
    this.momentary = xml.bool("mm", this.momentary);
    this.label = xml.string("lab", this.label);
    this.keyShortcut = xml.string("key", this.keyShortcut);
    this.resistance = xml.double("r", 0);
  }

  override dumpValues(): string {
    const inverted = (this.constructor as typeof SwitchElm).invertsBooleanPosition;
    // two-position switches keep the old boolean form so older versions can read them
    const pos = this.posCount === 2 ? String(inverted ? this.position === 0 : this.position === 1) : String(this.position);
    let s = ` ${pos} ${this.momentary}`;
    if ((this.flags & SwitchElm.FLAG_LABEL) !== 0) s += ` ${CircuitText.escape(this.label ?? "")}`;
    return s;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["p", String(this.position)], ["mm", String(this.momentary)]);
    if (this.label) a.push(["lab", this.label]);
    if (this.keyShortcut) a.push(["key", this.keyShortcut]);
    if (this.resistance > 0) a.push(["r", String(this.resistance)]);
  }

  override textLossless(): boolean {
    return this.resistance === 0 && !this.keyShortcut;
  }

  override setPoints(): void {
    super.setPoints();
    this.calcLeads(32);
  }

  override calculateCurrent(): void {
    if (this.position === 1) this.current = 0;
    else if (this.resistance > 0) this.current = (this.volts[0] - this.volts[1]) / this.resistance;
    else if (this.parent) this.current = (this.volts[0] - this.volts[1]) / SwitchElm.COMPOSITE_CLOSED_R;
  }

  simpleToggle(): void {
    this.position++;
    if (this.position >= this.posCount) this.position = 0;
  }

  /** Toggle this switch and any others sharing its label. The caller must re-analyze. */
  toggle(): void {
    this.simpleToggle();
    if (this.label === null) return;
    for (const o of this.sim?.circuitElements ?? []) {
      if (o !== this && o instanceof SwitchElm && o.label === this.label) o.simpleToggle();
    }
  }

  override getConnection(_n1: number, _n2: number): boolean {
    return this.position === 0;
  }
  override isWireEquivalent(): boolean {
    return this.position === 0 && this.parent === null && this.resistance === 0;
  }
  override isRemovableWire(): boolean {
    return this.isWireEquivalent();
  }
  override isSwitch(): boolean {
    return true;
  }

  override stamp(): void {
    if (this.position !== 0) return;
    if (this.resistance > 0) this.sim.stampResistor(this.nodes[0]!, this.nodes[1]!, this.resistance);
    else if (this.parent) this.sim.stampResistor(this.nodes[0]!, this.nodes[1]!, SwitchElm.COMPOSITE_CLOSED_R);
  }
}

export class CurrentElm extends CircuitElm {
  static override dumpType = ch("i");
  currentValue = 0;
  /** Compliance voltage; 0 = unlimited (ideal current source). */
  maxVoltage = 0;
  lastVoltDiff = 0;
  broken = false;

  override initNew(): void {
    this.currentValue = 0.01;
  }

  override readTokens(st: TokenStream): void {
    const cv = st.tryDouble();
    if (cv !== undefined) {
      this.currentValue = cv;
      const mv = st.tryDouble();
      if (mv !== undefined) this.maxVoltage = mv;
    }
    if (this.currentValue === 0) this.currentValue = 0.01;
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.currentValue = xml.double("cu", this.currentValue);
    this.maxVoltage = xml.double("mv", 0);
  }

  override dumpValues(): string {
    return ` ${this.currentValue} ${this.maxVoltage}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["cu", String(this.currentValue)]);
    if (this.maxVoltage > 0) a.push(["mv", String(this.maxVoltage)]);
  }

  get isVoltageLimited(): boolean {
    return this.maxVoltage > 0;
  }
  override nonLinear(): boolean {
    return this.isVoltageLimited;
  }
  override isCurrentSource(): boolean {
    return true;
  }

  override reset(): void {
    super.reset();
    this.lastVoltDiff = 0;
  }

  override setPoints(): void {
    super.setPoints();
    this.calcLeads(26);
  }

  /** analyzeCircuit determines whether the source has a current path. */
  setBroken(b: boolean): void {
    this.broken = b && !this.isVoltageLimited;
  }

  override stamp(): void {
    const [n0, n1] = [this.nodes[0]!, this.nodes[1]!];
    if (this.broken) {
      // no current path; a current source here would make the matrix singular
      this.sim.stampResistor(n0, n1, 1e8);
      this.current = 0;
    } else if (this.isVoltageLimited) {
      // nonlinear; doStep() handles the smooth saturation model
      this.sim.markNonLinear(n0);
      this.sim.markNonLinear(n1);
    } else {
      // NodeForge engine: sourceScale ramps sources up for the operating point (1 in CircuitJS mode)
      this.sim.stampCurrentSource(n0, n1, this.currentValue * this.sim.sourceScale);
      this.current = this.currentValue * this.sim.sourceScale;
    }
  }

  /** Smooth voltage compliance via a tanh-shaped transition between 0.95·Vmax and Vmax. */
  override doStep(): void {
    if (this.broken || !this.isVoltageLimited) return;
    let vd = this.volts[1] - this.volts[0];
    const vStart = 0.95 * this.maxVoltage;
    const vWidth = this.maxVoltage - vStart;
    const vMid = (vStart + this.maxVoltage) / 2;
    const vt = Math.max(vWidth / 5, 1e-3);

    // step-size limits so a Newton step can't jump across the transition region
    if (this.lastVoltDiff < vStart && vd > vStart) {
      vd = vStart;
      this.sim.converged = false;
    } else if (this.lastVoltDiff > this.maxVoltage && vd < this.maxVoltage) {
      vd = this.maxVoltage;
      this.sim.converged = false;
    } else if (this.lastVoltDiff >= vStart && this.lastVoltDiff <= this.maxVoltage) {
      const maxStep = Math.max(vWidth / 4, 0.01);
      if (vd > this.lastVoltDiff + maxStep) {
        vd = this.lastVoltDiff + maxStep;
        this.sim.converged = false;
      } else if (vd < this.lastVoltDiff - maxStep) {
        vd = this.lastVoltDiff - maxStep;
        this.sim.converged = false;
      }
    }
    this.lastVoltDiff = vd;

    const tanhArg = Math.tanh((vd - vMid) / vt);
    const i = this.currentValue * 0.5 * (1 - tanhArg);
    const sech2 = 1 - tanhArg * tanhArg;
    const g = (-this.currentValue * 0.5 * sech2) / vt * vd;

    // Norton companion; the Gmin floor keeps the resistance finite when sech² vanishes
    const absG = Math.abs(g) + 1e-6;
    this.sim.stampResistor(this.nodes[0]!, this.nodes[1]!, 1 / absG);
    this.sim.stampCurrentSource(this.nodes[0]!, this.nodes[1]!, i - g * vd);
    this.current = i;
  }

  override getVoltageDiff(): number {
    return this.volts[1] - this.volts[0];
  }
  override getPower(): number {
    return -this.getVoltageDiff() * this.current;
  }

  override validate(): boolean {
    const fpi = new FindPathInfo(PathKind.Induct, this, this.getNode(1)!, this.sim);
    this.setBroken(!fpi.findPath(this.getNode(0)!));
    return true;
  }
}

/** Stand-in for an element type that hasn't been ported yet. It keeps its place in the element
 * list (indices stay compatible) but is never simulated. */
export class PlaceholderElm extends CircuitElm {
  typeName = "";
  /** The original text-format line (null for parts loaded from XML). */
  source = "";
  /** The original XML element (null for parts loaded from the text format). */
  xml: XmlNode | null = null;

  override isPlaceholder(): boolean {
    return true;
  }

  /** The original line with the current position and flags. */
  override dump(): string {
    const tokens = this.source.trim().split(/[ \t]+/);
    return [tokens[0], this.x, this.y, this.x2, this.y2, this.flags, ...tokens.slice(6)].join(" ");
  }

  override xmlTag(): string {
    return this.xml?.tag ?? this.typeName;
  }

  /** The original attributes, with the current position. */
  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    for (const [k, v] of Object.entries(this.xml?.attributes ?? {})) if (k !== "x" && k !== "f") a.push([k, v]);
  }

  override xmlChildren(): XmlNode[] {
    return this.xml?.children ?? [];
  }

  /** Placeholders can only be written back in the format they came from. */
  override textLossless(): boolean {
    return this.xml === null;
  }

  get xmlLossless(): boolean {
    return this.xml !== null;
  }
}

/** Fuse: a resistor that blows (becomes 1 GΩ) once its accumulated I²t exceeds the rating. */
export class FuseElm extends CircuitElm {
  static override dumpType = 404;
  static readonly FLAG_IEC_SYMBOL = 1;
  static readonly blownResistance = 1e9;

  resistance = 0;
  heat = 0;
  i2t = 0;
  blown = false;

  override initNew(): void {
    // from the Littelfuse 218 datasheet
    this.i2t = 6.73;
    this.resistance = 0.0613;
  }

  override readTokens(st: TokenStream): void {
    this.resistance = st.nextDouble();
    this.i2t = st.nextDouble();
    this.heat = st.nextDouble();
    this.blown = st.nextBool();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.resistance = xml.double("re", this.resistance);
    this.i2t = xml.double("i2", this.i2t);
    this.heat = xml.double("he", this.heat);
    this.blown = xml.bool("bl", this.blown);
  }

  override dumpValues(): string {
    return ` ${this.resistance} ${this.i2t} ${this.heat} ${this.blown}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["re", String(this.resistance)], ["i2", String(this.i2t)], ["he", String(this.heat)], ["bl", String(this.blown)]);
  }

  isIECSymbol(): boolean {
    return (this.flags & FuseElm.FLAG_IEC_SYMBOL) !== 0;
  }

  override reset(): void {
    super.reset();
    this.heat = 0;
    this.blown = false;
  }

  override setPoints(): void {
    super.setPoints();
    this.calcLeads(this.isIECSymbol() ? 32 : 16);
  }

  override calculateCurrent(): void {
    this.current = (this.volts[0] - this.volts[1]) / (this.blown ? FuseElm.blownResistance : this.resistance);
  }

  override stamp(): void {
    this.sim.markNonLinear(this.nodes[0]!);
    this.sim.markNonLinear(this.nodes[1]!);
  }

  override nonLinear(): boolean {
    return true;
  }

  override startIteration(): void {
    const i = this.getCurrent();
    const dt = this.sim.timeStep;
    // accumulate heat
    this.heat += i * i * dt;
    // dissipate heat; assume the fuse can dissipate its entire i2t in 3 seconds
    this.heat -= (dt * this.i2t) / 3;
    if (this.heat < 0) this.heat = 0;
    if (this.heat > this.i2t) this.blown = true;
  }

  override doStep(): void {
    this.sim.stampResistor(this.nodes[0]!, this.nodes[1]!, this.blown ? FuseElm.blownResistance : this.resistance);
  }
}
