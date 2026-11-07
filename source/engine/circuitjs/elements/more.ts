// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Ported from CircuitJS1 (InvertingSchmittElm.java, SchmittElm.java, AntennaElm.java,
// PolarCapacitorElm.java, TappedTransformerElm.java, AmmeterElm.java, GyratorElm.java) by Paul Falstad,
// Iain Sharp and contributors. Licensed under the GNU General Public License v2 or later. See LICENSE.

import { CircuitElm, type XmlAttrs } from "../core/elm";
import { type GridPoint, interpPoint, interpPointPerp, pt } from "../core/geometry";
import type { VoltageSource } from "../core/nodes";
import type { TokenStream, XmlNode } from "../io/tokens";
import { FindPathInfo, PathKind } from "../core/findpath";
import { Scale } from "./annotations";
import { SwitchElm } from "./basic";
import { ChipElm, Side } from "./chips";
import { Diode, DiodeModel } from "./diode";
import { CapacitorElm } from "./reactive";
import { RailElm, Waveform } from "./sources";

const ch = (c: string) => c.charCodeAt(0);
const pair = (n1: number, n2: number, a: number, b: number) => (n1 === a && n2 === b) || (n1 === b && n2 === a);

export class InvertingSchmittElm extends CircuitElm {
  static override dumpType = 183;
  slewRate = 0.5;
  lowerTrigger = 1.66;
  upperTrigger = 3.33;
  state = false;
  logicOnLevel = 5;
  logicOffLevel = 0;

  override initNew(): void {
    this.noDiagonal = true;
  }

  override readTokens(st: TokenStream): void {
    this.noDiagonal = true;
    const set = [(v: number) => (this.slewRate = v), (v: number) => (this.lowerTrigger = v), (v: number) => (this.upperTrigger = v),
      (v: number) => (this.logicOnLevel = v), (v: number) => (this.logicOffLevel = v)];
    for (const f of set) {
      const v = st.tryDouble();
      if (v === undefined) break;
      f(v);
    }
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.noDiagonal = true;
    this.slewRate = xml.double("slr", this.slewRate);
    this.lowerTrigger = xml.double("lt", this.lowerTrigger);
    this.upperTrigger = xml.double("ut", this.upperTrigger);
    this.logicOnLevel = xml.double("lon", this.logicOnLevel);
    this.logicOffLevel = xml.double("loff", this.logicOffLevel);
  }

  override dumpValues(): string {
    return ` ${this.slewRate} ${this.lowerTrigger} ${this.upperTrigger} ${this.logicOnLevel} ${this.logicOffLevel}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["slr", String(this.slewRate)], ["lt", String(this.lowerTrigger)], ["ut", String(this.upperTrigger)], ["lon", String(this.logicOnLevel)],
      ["loff", String(this.logicOffLevel)]);
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

  /** Output level and new state for the input (inverting). */
  protected target(): number {
    if (this.state) {
      // output is high: input high enough to set output low?
      if (this.volts[0] > this.upperTrigger) {
        this.state = false;
        return this.logicOffLevel;
      }
      return this.logicOnLevel;
    }
    if (this.volts[0] < this.lowerTrigger) {
      this.state = true;
      return this.logicOnLevel;
    }
    return this.logicOffLevel;
  }

  protected lastOut(): number {
    return this.volts[1];
  }

  override doStep(): void {
    const v0 = this.lastOut();
    let out = this.target();
    const maxStep = this.slewRate * this.sim.timeStep * 1e9;
    out = Math.max(Math.min(v0 + maxStep, out), v0 - maxStep);
    this.sim.updateVoltageSource(this.sim.ground, this.nodes[1]!, this.voltSource!, out);
  }

  override getVoltageDiff(): number {
    return this.volts[0];
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

/** Non-inverting Schmitt trigger. */
export class SchmittElm extends InvertingSchmittElm {
  static override dumpType = 182;
  lastOutputVoltage = 0;

  override startIteration(): void {
    this.lastOutputVoltage = this.volts[1];
  }

  protected override lastOut(): number {
    return this.lastOutputVoltage;
  }

  protected override target(): number {
    if (this.state) {
      // (upstream's state is inverted relative to the output here)
      if (this.volts[0] > this.upperTrigger) {
        this.state = false;
        return this.logicOnLevel;
      }
      return this.logicOffLevel;
    }
    if (this.volts[0] < this.lowerTrigger) {
      this.state = true;
      return this.logicOffLevel;
    }
    return this.logicOnLevel;
  }

  override setPoints(): void {
    super.setPoints();
    let ww = 16;
    if (ww > this.dn / 2) ww = Math.trunc(this.dn / 2);
    this.lead1 = interpPoint(this.point1, this.point2, 0.5 - ww / this.dn);
    this.lead2 = interpPoint(this.point1, this.point2, 0.5 + (ww - 3) / this.dn);
  }
}

/** Antenna: a rail picking up a mix of AM and FM signals. */
export class AntennaElm extends RailElm {
  static override dumpType = ch("A");
  fmphase = 0;

  override initNew(): void {
    super.initNew();
    this.waveform = Waveform.ac;
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.waveform = Waveform.ac;
  }

  override getVoltage(): number {
    const pi = Math.PI, t = this.sim.t;
    const fm = 3 * Math.sin(this.fmphase);
    return Math.sin(2 * pi * t * 3000) * (1.3 + Math.sin(2 * pi * t * 12)) * 3 + Math.sin(2 * pi * t * 2710) * (1.3 + Math.sin(2 * pi * t * 13)) * 3 +
      Math.sin(2 * pi * t * 2433) * (1.3 + Math.sin(2 * pi * t * 14)) * 3 + fm;
  }

  override stepFinished(): void {
    this.fmphase += 2 * Math.PI * (2200 + Math.sin(2 * Math.PI * this.sim.t * 13) * 100) * this.sim.timeStep;
  }
}

/** Electrolytic capacitor: stops the simulation past its reverse voltage rating. */
export class PolarCapacitorElm extends CapacitorElm {
  static override dumpType = 209;
  static override get xmlTag(): string {
    return "pc";
  }
  maxNegativeVoltage = 1;

  override initNew(): void {
    super.initNew();
    this.maxNegativeVoltage = 1;
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.maxNegativeVoltage = st.nextDouble();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.maxNegativeVoltage = xml.double("mv", this.maxNegativeVoltage);
  }

  override dumpValues(): string {
    return `${super.dumpValues()} ${this.maxNegativeVoltage}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["mv", String(this.maxNegativeVoltage)]);
  }

  override stepFinished(): void {
    if (this.getVoltageDiff() < 0 && this.getVoltageDiff() < -this.maxNegativeVoltage) this.sim.stop("capacitor exceeded max reverse voltage", this);
    super.stepFinished();
  }
}

/** Center-tapped transformer. */
export class TappedTransformerElm extends CircuitElm {
  static override dumpType = 169;
  static override get xmlTag(): string {
    return "tt";
  }
  static readonly FLAG_FLIP = 1;
  static readonly FLAG_BACK_EULER = 2;
  inductance = 4;
  ratio = 1;
  couplingCoef = 0.99;
  /** Visual winding span; electrical coupling is independent of this size. */
  width = 64;
  terminalExtensions = [0, 0, 0, 0, 0];
  flip = 1;
  coilCurrents = [0, 0, 0, 0];
  voltdiff = [0, 0, 0];
  curSourceValue = [0, 0, 0];
  a = new Array<number>(9).fill(0);
  ptEnds: GridPoint[] = [];
  ptCoil: GridPoint[] = [];
  ptCore: GridPoint[] = [];

  override initNew(): void {
    this.inductance = 4;
    this.ratio = 1;
    this.noDiagonal = true;
    this.couplingCoef = 0.99;
  }

  override readTokens(st: TokenStream): void {
    this.inductance = st.nextDouble();
    this.ratio = st.nextDouble();
    this.coilCurrents[0] = st.nextDouble();
    this.coilCurrents[1] = st.nextDouble();
    this.coilCurrents[2] = st.tryDouble() ?? 0;
    this.couplingCoef = st.tryDouble() ?? 0.99;
    this.width = st.tryInt() ?? 64;
    const ends = st.hasMoreTokens ? st.next().split(",") : [];
    this.terminalExtensions = Array.from({ length: 5 }, (_, i) => Math.max(0, Number(ends[i]) || 0));
    this.noDiagonal = true;
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.inductance = xml.double("in", this.inductance);
    this.ratio = xml.double("ra", this.ratio);
    this.couplingCoef = xml.double("co", this.couplingCoef);
    this.width = xml.int("wi", 64);
    const ends = (xml.string("te", "") ?? "").split(",");
    this.terminalExtensions = Array.from({ length: 5 }, (_, i) => Math.max(0, Number(ends[i]) || 0));
    this.coilCurrents[0] = xml.double("c0", 0);
    this.coilCurrents[1] = xml.double("c1", 0);
    this.coilCurrents[2] = xml.double("c2", 0);
    this.noDiagonal = true;
  }

  override dumpValues(): string {
    const c = this.coilCurrents;
    const extended = this.terminalExtensions.some((v) => v !== 0);
    return ` ${this.inductance} ${this.ratio} ${c[0]} ${c[1]} ${c[2]} ${this.couplingCoef}${this.width === 64 && !extended ? "" : ` ${this.width}`}${extended ? ` ${this.terminalExtensions.join(",")}` : ""}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["in", String(this.inductance)], ["ra", String(this.ratio)], ["co", String(this.couplingCoef)]);
    if (this.width !== 64) a.push(["wi", String(this.width)]);
    if (this.terminalExtensions.some((v) => v !== 0)) a.push(["te", this.terminalExtensions.join(",")]);
  }

  override dumpXmlState(a: XmlAttrs): void {
    const c = this.coilCurrents;
    a.push(["c0", String(c[0])], ["c1", String(c[1])], ["c2", String(c[2])]);
  }

  override setPoints(): void {
    super.setPoints();
    this.flip = this.hasFlag(TappedTransformerElm.FLAG_FLIP) ? -1 : 1;
    const span = Math.max(32, this.width), tap = Math.max(16, Math.floor(span / 32) * 16);
    const p1 = this.point1, p2 = this.point2;
    const e = [p1, interpPointPerp(p1, p2, 0, -span * this.flip), p2, interpPointPerp(p1, p2, 1, -tap * this.flip), interpPointPerp(p1, p2, 1, -span * this.flip)];
    const ce = 0.5 - 12 / this.dn, cd = 0.5 - 2 / this.dn;
    const axis = { x: (p2.x - p1.x) / (this.dn || 1), y: (p2.y - p1.y) / (this.dn || 1) };
    this.ptEnds = e.map((p, i) => {
      const extension = this.terminalExtensions[i] ?? 0;
      return extension ? pt(p.x + axis.x * extension * (i < 2 ? -1 : 1),
        p.y + axis.y * extension * (i < 2 ? -1 : 1)) : p;
    });
    this.ptCoil = [interpPoint(e[0], e[2], ce), interpPointPerp(e[0], e[2], ce, -span * this.flip), interpPoint(e[0], e[2], 1 - ce),
      interpPointPerp(e[0], e[2], 1 - ce, -tap * this.flip), interpPointPerp(e[0], e[2], 1 - ce, -span * this.flip)];
    this.ptCore = [];
    for (let i = 0; i !== 2; i++) {
      const b = -span * i * this.flip;
      this.ptCore[i] = interpPointPerp(e[0], e[2], cd, b);
      this.ptCore[i + 2] = interpPointPerp(e[0], e[2], 1 - cd, b);
    }
  }

  override getPost(n: number): GridPoint {
    return this.ptEnds[n];
  }
  override getPostCount(): number {
    return 5;
  }

  override reset(): void {
    this.coilCurrents.fill(0);
    for (let i = 0; i < 5; i++) this.volts[i] = 0;
    this.curSourceValue.fill(0);
    this.curcount = 0;
  }

  isTrapezoidal(): boolean {
    return (this.flags & TappedTransformerElm.FLAG_BACK_EULER) === 0;
  }

  override stamp(): void {
    // equations for transformer:
    //   v1 = L1 di1/dt + M1 di2/dt + M1 di3/dt
    //   v2 = M1 di1/dt + L2 di2/dt + M2 di3/dt
    //   v3 = M1 di1/dt + M2 di2/dt + L2 di3/dt
    // we invert that to get:
    //   di1/dt = a1 v1 + a2 v2 + a3 v3
    //   di2/dt = a4 v1 + a5 v2 + a6 v3
    //   di3/dt = a7 v1 + a8 v2 + a9 v3
    // integrate di1/dt using trapezoidal approx and we get:
    //   i1(t2) = i1(t1) + dt/2 (di1/dt(t1) + di1/dt(t2))
    //          = i1(t1) + a1 dt/2 v1(t1)+a2 dt/2 v2(t1)+a3 dt/2 v3(t3) + a1 dt/2 v1(t2)+a2 dt/2 v2(t2)+a3 dt/2 v3(t2)
    // the norton equivalent of this for i1 is:
    //  a. current source, I = i1(t1) + a1 dt/2 v1(t1) + a2 dt/2 v2(t1) + a3 dt/2 v3(t1)
    //  b. resistor, G = a1 dt/2
    //  c. current source controlled by voltage v2, G = a2 dt/2
    //  d. current source controlled by voltage v3, G = a3 dt/2
    // and similarly for i2
    const sim = this.sim, nd = this.nodes, a = this.a;
    const l1 = this.inductance;
    // inductance of each half of the secondary is a quarter of the full secondary
    const l2 = (this.inductance * this.ratio * this.ratio) / 4;
    const m1 = this.couplingCoef * Math.sqrt(l1 * l2);
    // mutual inductance of the two halves of the secondary
    const m2 = this.couplingCoef * l2;
    a[0] = l2 + m2;
    a[1] = a[2] = a[3] = a[6] = -m1;
    a[4] = a[8] = (l1 * l2 - m1 * m1) / (l2 - m2);
    a[5] = a[7] = (m1 * m1 - l1 * m2) / (l2 - m2);
    const det = l1 * (l2 + m2) - 2 * m1 * m1;
    for (let i = 0; i !== 9; i++) a[i] *= (this.isTrapezoidal() ? sim.timeStep / 2 : sim.timeStep) / det;
    const n = (i: number) => nd[i]!;
    sim.stampConductance(n(0), n(1), a[0]);
    sim.stampVCCurrentSource(n(0), n(1), n(2), n(3), a[1]);
    sim.stampVCCurrentSource(n(0), n(1), n(3), n(4), a[2]);
    sim.stampVCCurrentSource(n(2), n(3), n(0), n(1), a[3]);
    sim.stampConductance(n(2), n(3), a[4]);
    sim.stampVCCurrentSource(n(2), n(3), n(3), n(4), a[5]);
    sim.stampVCCurrentSource(n(3), n(4), n(0), n(1), a[6]);
    sim.stampVCCurrentSource(n(3), n(4), n(2), n(3), a[7]);
    sim.stampConductance(n(3), n(4), a[8]);
  }

  override startIteration(): void {
    const v = this.volts, vd = this.voltdiff;
    vd[0] = v[0] - v[1];
    vd[1] = v[2] - v[3];
    vd[2] = v[3] - v[4];
    for (let i = 0; i !== 3; i++) {
      this.curSourceValue[i] = this.coilCurrents[i];
      if (this.isTrapezoidal()) for (let j = 0; j !== 3; j++) this.curSourceValue[i] += this.a[i * 3 + j] * vd[j];
    }
  }

  override doStep(): void {
    const sim = this.sim, nd = this.nodes, c = this.curSourceValue;
    sim.stampCurrentSource(nd[0]!, nd[1]!, c[0]);
    sim.stampCurrentSource(nd[2]!, nd[3]!, c[1]);
    sim.stampCurrentSource(nd[3]!, nd[4]!, c[2]);
  }

  override calculateCurrent(): void {
    const v = this.volts, vd = this.voltdiff, cur = this.coilCurrents;
    vd[0] = v[0] - v[1];
    vd[1] = v[2] - v[3];
    vd[2] = v[3] - v[4];
    for (let i = 0; i !== 3; i++) {
      cur[i] = this.curSourceValue[i];
      for (let j = 0; j !== 3; j++) cur[i] += this.a[i * 3 + j] * vd[j];
    }
    cur[3] = cur[1] - cur[2];
  }

  override getCurrentIntoNode(n: number): number {
    const c = this.coilCurrents;
    if (n === 0) return -c[0];
    if (n === 1) return c[0];
    if (n === 2) return -c[1];
    if (n === 3) return c[3];
    return c[2];
  }

  override getConnection(n1: number, n2: number): boolean {
    return pair(n1, n2, 0, 1) || pair(n1, n2, 2, 3) || pair(n1, n2, 3, 4) || pair(n1, n2, 2, 4);
  }
  override getMatrixConnection(): boolean {
    return true;
  }
  override getCurrent(): number {
    return this.coilCurrents[0];
  }
}

/** Ammeter: a 0 V source that measures the current through it. */
export class AmmeterElm extends CircuitElm {
  static override dumpType = 370;
  static readonly FLAG_SHOWCURRENT = 1;
  static readonly FLAG_CIRCLE = 2;
  static readonly AM_VOL = 0;
  static readonly AM_RMS = 1;
  meter = 0;
  scale: number = Scale.auto;
  zerocount = 0;
  rmsI = 0;
  total = 0;
  count = 0;
  maxI = 0;
  lastMaxI = 0;
  minI = 0;
  lastMinI = 0;
  selectedValue = 0;
  increasingI = true;
  decreasingI = true;

  override initNew(): void {
    this.flags = AmmeterElm.FLAG_SHOWCURRENT | AmmeterElm.FLAG_CIRCLE;
    this.scale = Scale.auto;
  }

  override readTokens(st: TokenStream): void {
    this.scale = Scale.auto;
    this.meter = st.nextInt();
    this.scale = st.tryInt() ?? this.scale;
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.meter = xml.int("me", this.meter);
    this.scale = xml.int("sc", this.scale);
  }

  override dumpValues(): string {
    return ` ${this.meter} ${this.scale}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["me", String(this.meter)], ["sc", String(this.scale)]);
  }

  override stepFinished(): void {
    const c = this.current;
    this.count++;
    this.total += c * c;
    if (c > this.maxI && this.increasingI) {
      this.maxI = c;
      this.increasingI = true;
      this.decreasingI = false;
    }
    if (c < this.maxI && this.increasingI) {
      // change of direction: I now going down, at the start of a waveform
      this.lastMaxI = this.maxI;
      this.minI = c;
      this.increasingI = false;
      this.decreasingI = true;
      this.endCycle();
    }
    if (c < this.minI && this.decreasingI) {
      this.minI = c;
      this.increasingI = false;
      this.decreasingI = true;
    }
    if (c > this.minI && this.decreasingI) {
      // change of direction: I now going up
      this.lastMinI = this.minI;
      this.maxI = c;
      this.increasingI = true;
      this.decreasingI = false;
      this.endCycle();
    }
    if (c === 0) {
      this.zerocount++;
      if (this.zerocount > 5) {
        this.total = 0;
        this.rmsI = 0;
        this.maxI = 0;
        this.minI = 0;
      }
    } else this.zerocount = 0;
    this.selectedValue = this.meter === AmmeterElm.AM_RMS ? this.rmsI : c;
  }

  private endCycle(): void {
    this.total = this.total / this.count;
    this.rmsI = Math.sqrt(this.total);
    if (Number.isNaN(this.rmsI)) this.rmsI = 0;
    this.count = 0;
    this.total = 0;
  }

  override setVoltageSource(n: number, v: VoltageSource): void {
    super.setVoltageSource(n, v);
    v.setNodes(this.nodes[0]!, this.nodes[1]!);
  }

  override stamp(): void {
    this.sim.stampVoltageSource(this.nodes[0]!, this.nodes[1]!, this.voltSource!, 0);
  }

  override getVoltageSourceCount(): number {
    return 1;
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
}

/** Gyrator: two ports where each port's current follows the other port's voltage. */
export class GyratorElm extends CircuitElm {
  static override dumpType = 0;
  static override get xmlTag(): string {
    return "Gyrator";
  }
  static readonly FLAG_VERTICAL = 8;
  static readonly FLAG_FLIP = 16;
  gyrResistance = 1000;
  width = 32;
  flip = 1;
  ports = [0, 0];
  ptEnds: GridPoint[] = [];
  ptStub: GridPoint[] = [];

  override initNew(): void {
    this.gyrResistance = 1000;
    this.width = 32;
    this.noDiagonal = true;
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.noDiagonal = true;
  }

  /** Not in the text format: saved as XML. */
  override textLossless(): boolean {
    return false;
  }

  override setPoints(): void {
    super.setPoints();
    if (this.hasFlag(GyratorElm.FLAG_VERTICAL)) this.point2 = pt(this.point1.x, this.point2.y);
    else this.point2 = pt(this.point2.x, this.point1.y);
    const p1 = this.point1, p2 = this.point2;
    this.flip = this.hasFlag(GyratorElm.FLAG_FLIP) ? -1 : 1;
    const e = [p1, p2, interpPointPerp(p1, p2, 0, -this.dsign * this.width * this.flip), interpPointPerp(p1, p2, 1, -this.dsign * this.width * this.flip)];
    const cs = 0.5 - 12 / this.dn;
    this.ptStub = [interpPoint(e[0], e[1], cs), interpPoint(e[1], e[0], cs), interpPoint(e[2], e[3], cs), interpPoint(e[3], e[2], cs)];
    this.ptEnds = e;
  }

  override getPost(n: number): GridPoint {
    return this.ptEnds[n];
  }
  override getPostCount(): number {
    return 4;
  }

  override reset(): void {
    this.ports[0] = this.ports[1] = 0;
    for (let i = 0; i < 4; i++) this.volts[i] = 0;
    this.curcount = 0;
  }

  override stamp(): void {
    const g = 1 / this.gyrResistance, nd = this.nodes;
    this.sim.stampVCCurrentSource(nd[0]!, nd[2]!, nd[1]!, nd[3]!, g);
    this.sim.stampVCCurrentSource(nd[1]!, nd[3]!, nd[0]!, nd[2]!, -g);
  }

  override calculateCurrent(): void {
    const g = 1 / this.gyrResistance, v = this.volts;
    this.ports[0] = g * (v[1] - v[3]);
    this.ports[1] = -g * (v[0] - v[2]);
  }

  override getCurrent(): number {
    return this.ports[0];
  }
  override getCurrentIntoNode(n: number): number {
    if (n < 2) return -this.ports[n];
    return this.ports[n - 2];
  }
  override getMatrixConnection(): boolean {
    return true;
  }
  override getConnection(n1: number, n2: number): boolean {
    return pair(n1, n2, 0, 2) || pair(n1, n2, 1, 3);
  }
}

/** Audio output: records the voltage at its post for playback (a high-impedance probe). */
export class AudioOutputElm extends CircuitElm {
  static override dumpType = 211;
  static override get xmlTag(): string {
    return "aout";
  }
  static lastSamplingRate = 8000;
  static readonly samplingRateChoices = [8000, 11025, 16000, 22050, 44100, 48000];
  duration = 1;
  samplingRate = 8000;
  labelNum = 1;
  data = new Float64Array(0);
  dataCount = 0;
  dataPtr = 0;
  dataFull = false;
  sampleStep = 1 / 8000;
  dataSampleCount = 0;
  nextDataSample = 0;
  dataSample = 0;

  override initNew(): void {
    this.duration = 1;
    this.samplingRate = AudioOutputElm.lastSamplingRate;
    this.setDataCount();
  }

  override readTokens(st: TokenStream): void {
    this.duration = st.nextDouble();
    this.samplingRate = st.nextInt();
    this.labelNum = st.nextInt();
    this.setDataCount();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.duration = xml.double("du", this.duration);
    this.samplingRate = xml.int("sa", this.samplingRate);
    this.labelNum = xml.int("la", this.labelNum);
    this.setDataCount();
  }

  override dumpValues(): string {
    return ` ${this.duration} ${this.samplingRate} ${this.labelNum}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["du", String(this.duration)], ["sa", String(this.samplingRate)], ["la", String(this.labelNum)]);
  }

  setDataCount(): void {
    this.dataCount = Math.trunc(this.samplingRate * this.duration);
    this.data = new Float64Array(this.dataCount);
    this.dataPtr = 0;
    this.dataFull = false;
    this.sampleStep = 1 / this.samplingRate;
    this.nextDataSample = (this.sim?.t ?? 0) + this.sampleStep;
  }

  override getPostCount(): number {
    return 1;
  }

  override reset(): void {
    this.dataPtr = 0;
    this.dataFull = false;
    this.dataSampleCount = 0;
    this.nextDataSample = 0;
    this.dataSample = 0;
  }

  override getVoltageDiff(): number {
    return this.volts[0];
  }

  override stepFinished(): void {
    this.dataSample += this.volts[0];
    this.dataSampleCount++;
    if (this.sim.t >= this.nextDataSample) {
      this.nextDataSample += this.sampleStep;
      this.data[this.dataPtr++] = this.dataSample / this.dataSampleCount;
      this.dataSampleCount = 0;
      this.dataSample = 0;
      if (this.dataPtr >= this.dataCount) {
        this.dataPtr = 0;
        this.dataFull = true;
      }
    }
  }

  /** The recorded samples in time order. */
  samples(): Float64Array {
    if (!this.dataFull) return this.data.slice(0, this.dataPtr);
    const out = new Float64Array(this.dataCount);
    out.set(this.data.subarray(this.dataPtr), 0);
    out.set(this.data.subarray(0, this.dataPtr), this.dataCount - this.dataPtr);
    return out;
  }
}

/** A scope drawn on the sheet. The simulation ignores it; the interface shows its plot. */
export class ScopeElm extends CircuitElm {
  static override dumpType = 403;
  /** The scope definition as stored: text-format tokens (joined with "_") or an XML <o> element. */
  specText: string | null = null;
  specXml: XmlNode | null = null;

  override initNew(): void {
    this.noDiagonal = false;
  }

  override readTokens(st: TokenStream): void {
    this.specText = st.next();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.specXml = xml.children.find((c) => c.tag === "o") ?? null;
  }

  override dumpValues(): string {
    return this.specText ? ` ${this.specText}` : "";
  }

  override textLossless(): boolean {
    // NodeForge: a scope rewritten by the app has both forms
    return this.specXml === null || this.specText !== null;
  }

  override xmlChildren(): XmlNode[] {
    return this.specXml ? [this.specXml] : [];
  }

  override getPostCount(): number {
    return 0;
  }
}

/** A matrix of LEDs between row and column pins. */
export class LEDArrayElm extends ChipElm {
  static override dumpType = 405;
  diodes: Diode[] = [];
  currents: number[] = [];
  brightness: number[] = [];

  override isDigitalChip(): boolean {
    return false;
  }
  override nonLinear(): boolean {
    return true;
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    const sx = st.tryInt();
    if (sx !== undefined) {
      this.sizeX = sx;
      this.sizeY = st.tryInt() ?? this.sizeY;
    }
    this.setupPins();
    this.allocNodes();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.sizeX = xml.int("sx", this.sizeX);
    this.sizeY = xml.int("sy", this.sizeY);
    this.setupPins();
    this.allocNodes();
  }

  override dumpChipValues(): string {
    return ` ${this.sizeX} ${this.sizeY}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["sx", String(this.sizeX)], ["sy", String(this.sizeY)]);
  }

  setupPins(): void {
    if (this.sizeX === 0 || this.sizeY === 0) this.sizeX = this.sizeY = 8;
    this.pins = [];
    for (let i = 0; i !== this.sizeX; i++) this.pins[i] = this.newPin(i, Side.S, "");
    for (let i = 0; i !== this.sizeY; i++) this.pins[i + this.sizeX] = this.newPin(i, Side.W, "");
    this.brightness = new Array<number>(this.sizeX * this.sizeY).fill(0);
  }

  override reset(): void {
    super.reset();
    this.brightness = new Array<number>(this.sizeX * this.sizeY).fill(0);
  }

  override stamp(): void {
    super.stamp();
    const model = DiodeModel.getModelWithName("default-led");
    this.diodes = [];
    for (let i = 0; i !== this.sizeX * this.sizeY; i++) {
      const d = new Diode(this);
      d.setup(model);
      d.stamp(this.nodes[this.sizeX + Math.trunc(i / this.sizeX)]!, this.nodes[i % this.sizeX]!);
      this.diodes.push(d);
    }
    this.currents = new Array<number>(this.diodes.length).fill(0);
  }

  override doStep(): void {
    super.doStep();
    let i = 0;
    for (let iy = 0; iy !== this.sizeY; iy++) for (let ix = 0; ix !== this.sizeX; ix++, i++) this.diodes[i].doStep(this.volts[this.sizeX + iy] - this.volts[ix]);
  }

  override calculateCurrent(): void {
    for (let ix = 0; ix !== this.sizeX; ix++) this.pins[ix].current = 0;
    if (!this.diodes.length) return;
    let i = 0;
    for (let iy = 0; iy !== this.sizeY; iy++) {
      let cur = 0;
      for (let ix = 0; ix !== this.sizeX; ix++, i++) {
        this.currents[i] = this.diodes[i].calculateCurrent(this.volts[this.sizeX + iy] - this.volts[ix]);
        cur += this.currents[i];
        this.pins[ix].current += this.currents[i];
      }
      this.pins[iy + this.sizeX].current = -cur;
    }
  }

  override stepFinished(): void {
    for (const c of this.currents) if (Math.abs(c) > 1e12) this.sim.stop("max current exceeded", this);
  }

  override getPostCount(): number {
    return this.sizeX + this.sizeY;
  }
  override getVoltageSourceCount(): number {
    return 0;
  }
  override getMatrixConnection(): boolean {
    return true;
  }
  override getConnection(): boolean {
    return true;
  }
}

/** DPDT wired as a crossover (polarity reversing) switch. */
export class CrossSwitchElm extends SwitchElm {
  static override dumpType = 430;
  static readonly poleCount = 2;
  static readonly openhs = 16;
  voltageSources: (VoltageSource | null)[] = [null, null];
  currents = [0, 0];
  polePosts: GridPoint[] = [];
  throwPosts: GridPoint[] = [];
  crossPoints: GridPoint[] = [];

  override initNew(): void {
    super.initNew();
    this.noDiagonal = true;
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.noDiagonal = true;
  }

  override setPoints(): void {
    super.setPoints();
    this.calcLeads(32);
    const p1 = this.point1, p2 = this.point2, h = CrossSwitchElm.openhs * this.geometryFlip;
    this.polePosts = [];
    this.throwPosts = [];
    for (let i = 0; i !== 2; i++) {
      const offset = -i * h * 3;
      this.polePosts[i] = interpPointPerp(p1, p2, 0, offset);
      this.throwPosts[i * 2] = interpPointPerp(p1, p2, 1, offset - h);
      this.throwPosts[i * 2 + 1] = interpPointPerp(p1, p2, 1, offset + h);
    }
    const dp = 16 / this.dn;
    this.crossPoints = [interpPointPerp(p1, p2, 1 + dp, h), interpPointPerp(p1, p2, 1 + dp * 2, h), interpPointPerp(p1, p2, 1 + dp * 3, h),
      interpPointPerp(p1, p2, 1 + dp * 2, -h), interpPointPerp(p1, p2, 1 + dp, -h * 4), interpPointPerp(p1, p2, 1 + dp * 3, -h * 4)];
  }

  override getCurrentIntoNode(n: number): number {
    if (n === 0 || n === 2) return -this.currents[Math.trunc(n / 2)];
    if (this.position === 0) return this.currents[Math.trunc(n / 2)];
    return this.currents[1 - Math.trunc(n / 2)];
  }

  override setCurrent(vs: VoltageSource, c: number): void {
    if (vs === this.voltageSources[0]) this.currents[0] = c;
    else this.currents[1] = c;
  }

  override getPost(n: number): GridPoint {
    if (n === 0 || n === 2) return this.polePosts[n / 2];
    if (n === 1) return this.crossPoints[2];
    return this.crossPoints[5];
  }
  override getPostCount(): number {
    return 4;
  }

  override calculateCurrent(): void {
    if (this.resistance > 0) {
      for (let i = 0; i !== 2; i++) {
        const dst = this.position === 0 ? i * 2 + 1 : 3 - i * 2;
        this.currents[i] = (this.volts[i * 2] - this.volts[dst]) / this.resistance;
      }
    }
  }

  override setVoltageSource(j: number, vs: VoltageSource): void {
    this.voltageSources[j] = vs;
    vs.setNodes(this.nodes[j * 2]!, this.nodes[j * 2 + 1]!);
  }

  override stamp(): void {
    const sim = this.sim, nd = this.nodes;
    for (let i = 0; i !== 2; i++) {
      const dst = this.position === 0 ? i * 2 + 1 : 3 - i * 2;
      if (this.resistance > 0) sim.stampResistor(nd[i * 2]!, nd[dst]!, this.resistance);
      else sim.stampVoltageSource(nd[i * 2]!, nd[dst]!, this.voltageSources[i]!, 0);
    }
  }

  override getVoltageSourceCount(): number {
    return this.resistance > 0 ? 0 : 2;
  }

  override getConnection(n1: number, n2: number): boolean {
    if (this.position === 0) return pair(n1, n2, 0, 1) || pair(n1, n2, 2, 3);
    return pair(n1, n2, 0, 3) || pair(n1, n2, 2, 1);
  }

  override isWireEquivalent(): boolean {
    return this.resistance === 0;
  }
  override isRemovableWire(): boolean {
    return false;
  }

  override validate(): boolean {
    if (this.resistance > 0) return true;
    for (let i = 0; i !== 2; i++) {
      const dst = this.position === 0 ? i * 2 + 1 : 3 - i * 2;
      const fpi = new FindPathInfo(PathKind.Voltage, this, this.getNode(i * 2)!, this.sim);
      if (fpi.findPath(this.getNode(dst)!)) {
        this.resistance = 0.001;
        return false;
      }
    }
    return true;
  }
}
