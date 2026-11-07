// Ported from CircuitJS1 (LogicInputElm.java, LogicOutputElm.java, GateElm.java, AndGateElm.java,
// NandGateElm.java, OrGateElm.java, NorGateElm.java, XorGateElm.java, XnorGateElm.java,
// InverterElm.java) by Paul Falstad and Iain Sharp.
// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { CircuitElm, type XmlAttrs } from "../core/elm";
import { validateRailNode } from "../core/findpath";
import { type GridPoint, interpPoint, interpPointPerp } from "../core/geometry";
import type { VoltageSource } from "../core/nodes";
import type { TokenStream, XmlNode } from "../io/tokens";
import { SwitchElm } from "./basic";

const ch = (c: string) => c.charCodeAt(0);

/** A logic level source: a voltage source from ground, switched between low and high. */
export class LogicInputElm extends SwitchElm {
  static override dumpType = ch("L");
  static override invertsBooleanPosition = true;
  static readonly FLAG_TERNARY = 1;
  static readonly FLAG_NUMERIC = 2;
  hiV = 5;
  loV = 0;

  override isLogicInput(): boolean {
    return true;
  }

  override initNew(): void {
    this.hiV = 5;
    this.loV = 0;
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    const hi = st.tryDouble();
    const lo = hi === undefined ? undefined : st.tryDouble();
    if (hi === undefined || lo === undefined) {
      this.hiV = 5;
      this.loV = 0;
    } else {
      this.hiV = hi;
      this.loV = lo;
    }
    if (this.isTernary) this.posCount = 3;
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.hiV = xml.double("hi", this.hiV);
    this.loV = xml.double("lo", this.loV);
    if (this.isTernary) this.posCount = 3;
  }

  override dumpValues(): string {
    return `${super.dumpValues()} ${this.hiV} ${this.loV}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    if (this.hiV !== 5) a.push(["hi", String(this.hiV)]);
    if (this.loV !== 0) a.push(["lo", String(this.loV)]);
  }

  get isTernary(): boolean {
    return (this.flags & LogicInputElm.FLAG_TERNARY) !== 0;
  }
  get isNumeric(): boolean {
    return (this.flags & (LogicInputElm.FLAG_TERNARY | LogicInputElm.FLAG_NUMERIC)) !== 0;
  }

  override getPostCount(): number {
    return 1;
  }

  override setPoints(): void {
    super.setPoints();
    this.lead1 = interpPoint(this.point1, this.point2, 1 - 12 / this.dn);
  }

  override setCurrent(_vs: VoltageSource, c: number): void {
    this.current = c;
  }
  override calculateCurrent(): void {}

  override stamp(): void {
    this.sim.stampVoltageSource(this.sim.ground, this.nodes[0]!, this.voltSource!);
  }

  override isWireEquivalent(): boolean {
    return false;
  }
  override isRemovableWire(): boolean {
    return false;
  }
  override getConnection(): boolean {
    return true;
  }

  override doStep(): void {
    let v = this.position === 0 ? this.loV : this.hiV;
    if (this.isTernary) v = this.loV + this.position * (this.hiV - this.loV) * 0.5;
    this.sim.updateVoltageSource(this.sim.ground, this.nodes[0]!, this.voltSource!, v);
  }

  override getVoltageSourceCount(): number {
    return 1;
  }
  override getVoltageDiff(): number {
    return this.volts[0];
  }
  override hasGroundConnection(): boolean {
    return true;
  }
  override getCurrentIntoNode(): number {
    return this.current;
  }
  override validate(): boolean {
    return validateRailNode(this, 0);
  }
}

/** A logic level indicator (with an optional pull-down so it draws current). */
export class LogicOutputElm extends CircuitElm {
  static override dumpType = ch("M");
  static readonly FLAG_TERNARY = 1;
  static readonly FLAG_NUMERIC = 2;
  static readonly FLAG_PULLDOWN = 4;
  threshold = 2.5;

  override readTokens(st: TokenStream): void {
    this.threshold = st.tryDouble() ?? 2.5;
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.threshold = xml.double("th", this.threshold);
  }

  override dumpValues(): string {
    return ` ${this.threshold}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    if (this.threshold !== 2.5) a.push(["th", String(this.threshold)]);
  }

  override getPostCount(): number {
    return 1;
  }
  get isTernary(): boolean {
    return (this.flags & LogicOutputElm.FLAG_TERNARY) !== 0;
  }
  get isNumeric(): boolean {
    return (this.flags & (LogicOutputElm.FLAG_TERNARY | LogicOutputElm.FLAG_NUMERIC)) !== 0;
  }
  get needsPullDown(): boolean {
    return (this.flags & LogicOutputElm.FLAG_PULLDOWN) !== 0;
  }

  override setPoints(): void {
    super.setPoints();
    this.lead1 = interpPoint(this.point1, this.point2, 1 - 12 / this.dn);
  }

  override stamp(): void {
    if (this.needsPullDown) this.sim.stampResistor(this.nodes[0]!, this.sim.ground, 1e6);
  }

  override getVoltageDiff(): number {
    return this.volts[0];
  }

  /** What the indicator shows: "H", "L", or (ternary) "0" / "1" / "2". */
  get displayValue(): string {
    const v = this.volts[0];
    if (this.isTernary) return v > 3.75 ? "2" : v > 1.25 ? "1" : "0";
    if (this.isNumeric) return v < this.threshold ? "0" : "1";
    return v < this.threshold ? "L" : "H";
  }
}

/** Logic gates: inputs on the left, one output driven from ground by a voltage source. */
export abstract class GateElm extends CircuitElm {
  static readonly FLAG_SMALL = 1 << 0;
  static readonly FLAG_SCHMITT = 1 << 1;
  static readonly FLAG_INVERT_INPUTS = 1 << 2;
  static readonly FLAG_DEMORGAN = 1 << 3;
  static lastHighVoltage = 5;
  inputCount = 2;
  lastOutput = false;
  highVoltage = 5;
  /** Seconds; 0 = instant. */
  propagationDelay = 0;
  delayEndTime = 0;
  gsize = 2;
  gwidth = 14;
  gwidth2 = 28;
  gheight = 16;
  hs2 = 0;
  ww = 0;
  inPosts: GridPoint[] = [];
  inGates: GridPoint[] = [];
  inputStates: boolean[] = [];
  oscillationCount = 0;
  lastTime = 0;

  override setHighVoltage(hv: number): void {
    this.highVoltage = hv;
  }

  override initNew(): void {
    this.noDiagonal = true;
    this.inputCount = 2;
    this.highVoltage = GateElm.lastHighVoltage;
    this.setSize(2);
    this.allocNodes();
    this.setupVolts();
  }

  override readTokens(st: TokenStream): void {
    this.inputCount = st.nextInt();
    const lastOutputVoltage = st.nextDouble();
    this.noDiagonal = true;
    this.highVoltage = st.tryDouble() ?? 5;
    this.lastOutput = lastOutputVoltage > this.highVoltage * 0.5;
    this.setSize((this.flags & GateElm.FLAG_SMALL) !== 0 ? 1 : 2);
    this.allocNodes();
    this.setupVolts();
  }

  override undumpXml(xml: XmlNode): void {
    // SMALL might have been set by the new-element defaults
    if (xml.get("ix") === undefined) this.flags = 0;
    super.undumpXml(xml);
    this.noDiagonal = true;
    this.highVoltage = xml.double("hi", this.highVoltage);
    this.inputCount = xml.int("in", this.inputCount);
    this.propagationDelay = xml.double("pd", this.propagationDelay);
    this.lastOutput = xml.double("o", 0) > this.highVoltage * 0.5;
    this.setSize((this.flags & GateElm.FLAG_SMALL) !== 0 ? 1 : 2);
    this.allocNodes();
    this.setupVolts();
  }

  /** The output level to save: the gate's remembered output (volts[] is only set once it has run). */
  private savedOutput(): number {
    return this.lastOutput ? this.highVoltage : 0;
  }

  override dumpValues(): string {
    return ` ${this.inputCount} ${this.savedOutput()} ${this.highVoltage}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    if (this.highVoltage !== 5) a.push(["hi", String(this.highVoltage)]);
    if (this.inputCount !== 2) a.push(["in", String(this.inputCount)]);
    if (this.propagationDelay !== 0) a.push(["pd", String(this.propagationDelay)]);
  }

  override dumpXmlState(a: XmlAttrs): void {
    const o = this.savedOutput();
    if (o !== 0) a.push(["o", String(o)]);
  }

  override textLossless(): boolean {
    return this.propagationDelay === 0;
  }

  isInverting(): boolean {
    return false;
  }
  abstract calcFunction(): boolean;
  /** Draw with the AND outline (otherwise the OR outline). */
  abstract drawAsAndGate(): boolean;
  isXor(): boolean {
    return false;
  }
  getLeadAdjustment(_ix: number): number {
    return 0;
  }

  setSize(s: number): void {
    this.gsize = s;
    this.gwidth = 7 * s;
    this.gwidth2 = 14 * s;
    this.gheight = 8 * s;
    this.flags &= ~GateElm.FLAG_SMALL;
    this.flags |= s === 1 ? GateElm.FLAG_SMALL : 0;
  }

  override setPoints(): void {
    super.setPoints();
    this.inputStates = new Array<boolean>(this.inputCount).fill(false);
    const hs = this.gheight * this.geometryFlip;
    let ww = this.gwidth2;
    if (ww > this.dn / 2) ww = Math.trunc(this.dn / 2);
    if (this.isInverting() && ww + 8 > this.dn / 2) ww = Math.trunc(this.dn / 2 - 8);
    this.ww = ww;
    this.calcLeads(ww * 2);
    this.inPosts = [];
    this.inGates = [];
    const circles = this.hasFlag(GateElm.FLAG_INVERT_INPUTS) || this.hasFlag(GateElm.FLAG_DEMORGAN);
    let i0 = -Math.trunc(this.inputCount / 2);
    for (let i = 0; i !== this.inputCount; i++, i0++) {
      if (i0 === 0 && (this.inputCount & 1) === 0) i0++;
      const adj = this.getLeadAdjustment(i);
      this.inPosts[i] = interpPointPerp(this.point1, this.point2, 0, hs * i0);
      this.inGates[i] = interpPointPerp(this.lead1!, this.lead2!, circles ? -8 / (ww * 2) + adj : adj, hs * i0);
    }
    this.hs2 = this.gwidth * (Math.trunc(this.inputCount / 2) + 1);
    if (this.isInverting() !== this.hasFlag(GateElm.FLAG_DEMORGAN)) this.lead2 = interpPoint(this.point1, this.point2, 0.5 + (ww + 8) / this.dn);
  }

  setupVolts(): void {
    for (let i = 0; i !== this.inputCount; i++) this.volts[i] = this.lastOutput !== this.isInverting() ? this.highVoltage : 0;
  }

  override getPostCount(): number {
    return this.inputCount + 1;
  }

  override getPost(n: number): GridPoint {
    return n === this.inputCount ? this.point2 : this.inPosts[n];
  }

  override getVoltageSourceCount(): number {
    return 1;
  }

  override stamp(): void {
    this.sim.stampVoltageSource(this.sim.ground, this.nodes[this.inputCount]!, this.voltSource!);
  }

  get hasSchmittInputs(): boolean {
    return (this.flags & GateElm.FLAG_SCHMITT) !== 0;
  }

  getInput(x: number): boolean {
    const high = !this.hasFlag(GateElm.FLAG_INVERT_INPUTS);
    if (!this.hasSchmittInputs) return this.volts[x] > this.highVoltage * 0.5 ? high : !high;
    if (this.inputStates.length !== this.inputCount) this.inputStates = new Array<boolean>(this.inputCount).fill(false);
    const res = this.volts[x] > this.highVoltage * (this.inputStates[x] ? 0.35 : 0.55);
    this.inputStates[x] = res;
    return res ? high : !high;
  }

  override doStep(): void {
    let f = this.calcFunction();
    if (this.isInverting()) f = !f;
    const sim = this.sim;
    // detect oscillation (using sim.t to only check once per timestep)
    if (this.propagationDelay === 0 && this.lastTime !== sim.t) {
      if (this.lastOutput === !f) {
        if (this.oscillationCount++ > 50) {
          // output is oscillating too much, randomly leave output the same
          this.oscillationCount = 0;
          if (sim.getrand(10) > 5) f = this.lastOutput;
        }
      } else this.oscillationCount = 0;
      this.lastTime = sim.t;
    }
    if (this.propagationDelay > 0) {
      if (f !== this.lastOutput) {
        if (this.delayEndTime === 0) this.delayEndTime = sim.t + this.propagationDelay;
        else if (sim.t >= this.delayEndTime) {
          this.lastOutput = f;
          this.delayEndTime = 0;
        }
      } else this.delayEndTime = 0;
    } else this.lastOutput = f;
    const res = this.lastOutput ? this.highVoltage : 0;
    sim.updateVoltageSource(sim.ground, this.nodes[this.inputCount]!, this.voltSource!, res);
  }

  override validate(): boolean {
    return validateRailNode(this, this.inputCount);
  }
  override getConnection(): boolean {
    return false;
  }
  override hasGroundConnection(n1: number): boolean {
    return n1 === this.inputCount;
  }
  override getCurrentIntoNode(n: number): number {
    return n === this.inputCount ? this.current : 0;
  }
}

export class AndGateElm extends GateElm {
  static override dumpType = 150;
  static override get xmlTag(): string {
    return "And";
  }
  calcFunction(): boolean {
    let f = true;
    for (let i = 0; i !== this.inputCount; i++) f = this.getInput(i) && f;
    return f;
  }
  drawAsAndGate(): boolean {
    return !this.hasFlag(GateElm.FLAG_DEMORGAN);
  }
}

export class NandGateElm extends AndGateElm {
  static override dumpType = 151;
  static override get xmlTag(): string {
    return "Nand";
  }
  override isInverting(): boolean {
    return true;
  }
}

export class OrGateElm extends GateElm {
  static override dumpType = 152;
  static override get xmlTag(): string {
    return "Or";
  }
  override getLeadAdjustment(ix: number): number {
    const n = this.inputCount;
    if (n > 3 && (ix === 0 || ix === n - 1)) return -0.15;
    if (n > 7 && (ix === 1 || ix === n - 2)) return -0.25;
    if (n >= 12 && (ix === 2 || ix === n - 3)) return -0.35;
    return 0;
  }
  calcFunction(): boolean {
    let f = false;
    for (let i = 0; i !== this.inputCount; i++) f = this.getInput(i) || f;
    return f;
  }
  drawAsAndGate(): boolean {
    return this.hasFlag(GateElm.FLAG_DEMORGAN);
  }
}

export class NorGateElm extends OrGateElm {
  static override dumpType = 153;
  static override get xmlTag(): string {
    return "Nor";
  }
  override isInverting(): boolean {
    return true;
  }
}

export class XorGateElm extends OrGateElm {
  static override dumpType = 154;
  static override get xmlTag(): string {
    return "Xor";
  }
  override calcFunction(): boolean {
    let f = false;
    for (let i = 0; i !== this.inputCount; i++) f = this.getInput(i) !== f;
    return f;
  }
  override drawAsAndGate(): boolean {
    return false;
  }
  override isXor(): boolean {
    return true;
  }
}

export class XnorGateElm extends XorGateElm {
  static override dumpType = 431;
  static override get xmlTag(): string {
    return "Xnor";
  }
  override isInverting(): boolean {
    return true;
  }
}

/** Inverter with a slew-rate limited output. */
export class InverterElm extends CircuitElm {
  static override dumpType = ch("I");
  static readonly FLAG_DEMORGAN = 1 << 3;
  slewRate = 0.5;
  highVoltage = 5;
  lastOutputVoltage = 0;

  override setHighVoltage(hv: number): void {
    this.highVoltage = hv;
  }

  override initNew(): void {
    this.noDiagonal = true;
    this.slewRate = 0.5;
    this.highVoltage = GateElm.lastHighVoltage;
  }

  override readTokens(st: TokenStream): void {
    this.noDiagonal = true;
    this.slewRate = 0.5;
    this.highVoltage = 5;
    const sl = st.tryDouble();
    if (sl !== undefined) {
      this.slewRate = sl;
      const hv = st.tryDouble();
      if (hv !== undefined) this.highVoltage = hv;
    }
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.noDiagonal = true;
    this.slewRate = xml.double("sl", this.slewRate);
    this.highVoltage = xml.double("hi", this.highVoltage);
  }

  override dumpValues(): string {
    return ` ${this.slewRate} ${this.highVoltage}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["sl", String(this.slewRate)], ["hi", String(this.highVoltage)]);
  }

  override setPoints(): void {
    super.setPoints();
    let ww = 16;
    if (ww > this.dn / 2) ww = Math.trunc(this.dn / 2);
    this.lead1 = interpPoint(this.point1, this.point2, 0.5 - ww / this.dn);
    this.lead2 = interpPoint(this.point1, this.point2, 0.5 + (ww + 2) / this.dn);
  }

  override getVoltageSourceCount(): number {
    return 1;
  }

  override stamp(): void {
    this.sim.stampVoltageSource(this.sim.ground, this.nodes[1]!, this.voltSource!);
  }

  override startIteration(): void {
    this.lastOutputVoltage = this.volts[1];
  }

  override doStep(): void {
    let out = this.volts[0] > this.highVoltage * 0.5 ? 0 : this.highVoltage;
    const maxStep = this.slewRate * this.sim.timeStep * 1e9;
    out = Math.max(Math.min(this.lastOutputVoltage + maxStep, out), this.lastOutputVoltage - maxStep);
    this.sim.updateVoltageSource(this.sim.ground, this.nodes[1]!, this.voltSource!, out);
  }

  override getVoltageDiff(): number {
    return this.volts[0];
  }
  override validate(): boolean {
    return validateRailNode(this, 1);
  }
  override getConnection(): boolean {
    return false;
  }
  override hasGroundConnection(n1: number): boolean {
    return n1 === 1;
  }
  override getCurrentIntoNode(n: number): number {
    return n === 1 ? this.current : 0;
  }
}
