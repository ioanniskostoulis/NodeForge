// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Ported from CircuitJS1 (OpAmpElm.java, OpAmpSwapElm.java, VarRailElm.java, SweepElm.java,
// ExtVoltageElm.java, NoiseElm.java, PotElm.java, Switch2Elm.java, PushSwitchElm.java,
// AnalogSwitchElm.java, AnalogSwitch2Elm.java, TransLineElm.java, MemristorElm.java,
// SparkGapElm.java, LampElm.java, CC2Elm.java, TransformerElm.java) by Paul Falstad, Iain Sharp and
// contributors. Licensed under the GNU General Public License v2 or later. See LICENSE.

import { CircuitElm, type PartSlider, type XmlAttrs } from "../core/elm";
import { FindPathInfo, PathKind, validateRailNode } from "../core/findpath";
import { type GridPoint, grid, interpPoint, interpPointPerp, pt, sign } from "../core/geometry";
import type { VoltageSource } from "../core/nodes";
import { CircuitText, type TokenStream, type XmlNode } from "../io/tokens";
import { SwitchElm } from "./basic";
import { ChipElm, type Pin, Side } from "./chips";
import { RailElm, VoltageElm, Waveform } from "./sources";

const ch = (c: string) => c.charCodeAt(0);

/** Text fields to the end of the line, joined with spaces (old free-text format). */
function restOfLine(st: TokenStream): string {
  const words: string[] = [];
  while (st.hasMoreTokens) words.push(st.next());
  return words.join(" ");
}

export class OpAmpElm extends CircuitElm {
  static override dumpType = ch("a");
  static readonly FLAG_SWAP = 1;
  static readonly FLAG_SMALL = 2;
  static readonly FLAG_LOWGAIN = 4;
  static readonly FLAG_GAIN = 8;
  opsize = 2;
  opheight = 16;
  opwidth = 26;
  maxOut = 15;
  minOut = -15;
  gain = 100000;
  gbw = 1e6;
  lastvd = 0;
  in1p: GridPoint[] = [];
  in2p: GridPoint[] = [];

  override initNew(): void {
    this.noDiagonal = true;
    this.maxOut = 15;
    this.minOut = -15;
    this.gbw = 1e6;
    this.flags = OpAmpElm.FLAG_GAIN;
    this.gain = 100000;
    this.setSize(2);
  }

  override readTokens(st: TokenStream): void {
    this.maxOut = 15;
    this.minOut = -15;
    this.gbw = 1e6;
    // all optional, read in one go
    const fields: ((v: number) => void)[] = [
      (v) => (this.maxOut = v), (v) => (this.minOut = v), (v) => (this.gbw = v),
      (v) => (this.volts[0] = v), (v) => (this.volts[1] = v), (v) => (this.gain = v),
    ];
    for (const f of fields) {
      const v = st.tryDouble();
      if (v === undefined) break;
      f(v);
    }
    this.noDiagonal = true;
    this.setSize((this.flags & OpAmpElm.FLAG_SMALL) !== 0 ? 1 : 2);
    this.setGain();
  }

  override undumpXml(xml: XmlNode): void {
    this.flags = 0; // size might have changed
    super.undumpXml(xml);
    this.noDiagonal = true;
    this.maxOut = xml.double("ma", this.maxOut);
    this.minOut = xml.double("mi", this.minOut);
    this.gain = xml.double("ga", this.gain);
    this.setSize((this.flags & OpAmpElm.FLAG_SMALL) !== 0 ? 1 : 2);
  }

  override dump(): string {
    // the gain field is only read back when this flag is set
    this.flags |= OpAmpElm.FLAG_GAIN;
    return super.dump();
  }

  override dumpValues(): string {
    return ` ${this.maxOut} ${this.minOut} ${this.gbw} ${this.volts[0]} ${this.volts[1]} ${this.gain}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["ma", String(this.maxOut)], ["mi", String(this.minOut)], ["ga", String(this.gain)]);
  }

  setGain(): void {
    if ((this.flags & OpAmpElm.FLAG_GAIN) !== 0) return;
    this.gain = (this.flags & OpAmpElm.FLAG_LOWGAIN) !== 0 ? 1000 : 100000;
  }

  setSize(s: number): void {
    this.opsize = s;
    this.opheight = 8 * s;
    this.opwidth = 13 * s;
    this.flags = (this.flags & ~OpAmpElm.FLAG_SMALL) | (s === 1 ? OpAmpElm.FLAG_SMALL : 0);
  }

  override nonLinear(): boolean {
    return true;
  }
  override getPower(): number {
    return this.volts[2] * this.current;
  }

  override setPoints(): void {
    super.setPoints();
    let ww = this.opwidth;
    if (ww > this.dn / 2) ww = Math.trunc(this.dn / 2);
    this.calcLeads(ww * 2);
    let hs = this.opheight * this.dsign;
    if ((this.flags & OpAmpElm.FLAG_SWAP) !== 0) hs = -hs;
    this.in1p = [interpPointPerp(this.point1, this.point2, 0, hs), interpPointPerp(this.lead1!, this.lead2!, 0, hs)];
    this.in2p = [interpPointPerp(this.point1, this.point2, 0, -hs), interpPointPerp(this.lead1!, this.lead2!, 0, -hs)];
  }

  override getPostCount(): number {
    return 3;
  }
  override getPost(n: number): GridPoint {
    return n === 0 ? this.in1p[0] : n === 1 ? this.in2p[0] : this.point2;
  }
  override getVoltageSourceCount(): number {
    return 1;
  }

  override stamp(): void {
    this.sim.stampMatrixNV(this.nodes[2]!, this.voltSource!, 1);
  }

  override doStep(): void {
    const sim = this.sim, vs = this.voltSource!, nd = this.nodes, v = this.volts;
    const vd = v[1] - v[0];
    const midpoint = (this.maxOut + this.minOut) * 0.5;
    if (Math.abs(this.lastvd - vd) > 0.1) sim.converged = false;
    else if (v[2] > this.maxOut + 0.1 || v[2] < this.minOut - 0.1) sim.converged = false;
    let x = 0, dx = 0;
    const maxAdj = this.maxOut - midpoint, minAdj = this.minOut - midpoint;
    if (vd >= maxAdj / this.gain && (this.lastvd >= 0 || sim.getrand(4) === 1)) {
      dx = 1e-4;
      x = this.maxOut - (dx * maxAdj) / this.gain;
    } else if (vd <= minAdj / this.gain && (this.lastvd <= 0 || sim.getrand(4) === 1)) {
      dx = 1e-4;
      x = this.minOut - (dx * minAdj) / this.gain;
    } else {
      dx = this.gain;
      x = midpoint;
    }
    // newton-raphson
    sim.stampMatrixVN(vs, nd[0]!, dx);
    sim.stampMatrixVN(vs, nd[1]!, -dx);
    sim.stampMatrixVN(vs, nd[2]!, 1);
    sim.stampRightSideV(vs, x);
    this.lastvd = vd;
  }

  override validate(): boolean {
    return validateRailNode(this, 2);
  }
  override getConnection(): boolean {
    return false;
  }
  override getMatrixConnection(): boolean {
    return true;
  }
  override hasGroundConnection(n1: number): boolean {
    return n1 === 2;
  }
  override getVoltageDiff(): number {
    return this.volts[2] - this.volts[1];
  }
  override getCurrentIntoNode(n: number): number {
    return n === 2 ? -this.current : 0;
  }
}

/** Op-amp with the inputs the other way up (only differs when placed). */
export class OpAmpSwapElm extends OpAmpElm {
  override initNew(): void {
    super.initNew();
    this.flags |= OpAmpElm.FLAG_SWAP;
  }
}

/** A rail whose voltage is set by a slider (0–100 between the bias and the max). */
export class VarRailElm extends RailElm {
  static override dumpType = 172;
  sliderText = "Voltage";
  /** Slider position, 0–100. */
  sliderValue = 0;

  override initNew(): void {
    super.initNew();
    this.waveform = Waveform.variable;
    this.sliderText = "Voltage";
    this.frequency = this.maxVoltage;
    this.createSlider();
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.sliderText = restOfLine(st).replace(/%2[bB]/g, "+");
    this.createSlider();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.sliderText = xml.string("st", this.sliderText) ?? this.sliderText;
    this.createSlider();
  }

  override dumpValues(): string {
    // '+' separates tokens in the text format; old files write it as %2B
    return `${super.dumpValues()} ${this.sliderText.replace(/\+/g, "%2B")}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["st", this.sliderText]);
  }

  createSlider(): void {
    this.waveform = Waveform.variable;
    this.sliderValue = Math.trunc(((this.frequency - this.bias) * 100) / (this.maxVoltage - this.bias));
  }

  override getVoltage(): number {
    this.frequency = (this.sliderValue * (this.maxVoltage - this.bias)) / 100 + this.bias;
    return this.frequency;
  }

  override partSlider(): PartSlider {
    const v = (this.sliderValue * (this.maxVoltage - this.bias)) / 100 + this.bias;
    return { label: this.sliderText, value: this.sliderValue, valueText: `${+v.toPrecision(4)} V`, set: (x) => (this.sliderValue = Math.max(0, Math.min(100, Math.trunc(x)))) };
  }
}

/** Rail driven from outside the simulation (CircuitJS's JS interface); 0 V here. */
export class ExtVoltageElm extends RailElm {
  static override dumpType = 418;
  name = "ext";
  voltage = 0;

  override initNew(): void {
    super.initNew();
    this.waveform = Waveform.ac;
    this.name = "ext";
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.name = CircuitText.unescape(st.next());
    this.waveform = Waveform.ac;
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.name = xml.string("nm", this.name) ?? this.name;
  }

  override dumpValues(): string {
    return `${super.dumpValues()} ${CircuitText.escape(this.name)}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["nm", this.name]);
  }

  setVoltage(v: number): void {
    if (!Number.isNaN(v)) this.voltage = v;
  }

  override getVoltage(): number {
    return this.voltage;
  }
}

/** Noise source (old files: type 'n'; saved as a rail with the noise waveform). */
export class NoiseElm extends RailElm {
  static override dumpType = ch("n");
  override initNew(): void {
    super.initNew();
    this.waveform = Waveform.noise;
  }
  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.waveform = Waveform.noise;
  }
  override dump(): string {
    return `R${super.dump().slice(1)}`;
  }
  override xmlTag(): string {
    return "R";
  }
}

/** Frequency sweep generator. */
export class SweepElm extends CircuitElm {
  static override dumpType = 170;
  static override get xmlTag(): string {
    return "sw";
  }
  static readonly FLAG_LOG = 1;
  static readonly FLAG_BIDIR = 2;
  static readonly circleSize = 17;
  maxV = 5;
  maxF = 4000;
  minF = 20;
  sweepTime = 0.1;
  frequency = 20;
  fadd = 0;
  fmul = 1;
  freqTime = 0;
  savedTimeStep = 0;
  dir = 1;
  v = 0;
  private needsParams = true;

  override initNew(): void {
    this.minF = 20;
    this.maxF = 4000;
    this.maxV = 5;
    this.sweepTime = 0.1;
    this.flags = SweepElm.FLAG_BIDIR;
    this.reset();
  }

  override readTokens(st: TokenStream): void {
    this.minF = st.nextDouble();
    this.maxF = st.nextDouble();
    this.maxV = st.nextDouble();
    this.sweepTime = st.nextDouble();
    this.reset();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.minF = xml.double("mi", this.minF);
    this.maxF = xml.double("ma", this.maxF);
    this.maxV = xml.double("mv", this.maxV);
    this.sweepTime = xml.double("sw", this.sweepTime);
    this.reset();
  }

  override dumpValues(): string {
    return ` ${this.minF} ${this.maxF} ${this.maxV} ${this.sweepTime}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["mi", String(this.minF)], ["ma", String(this.maxF)], ["mv", String(this.maxV)], ["sw", String(this.sweepTime)]);
  }

  override getPostCount(): number {
    return 1;
  }

  override setPoints(): void {
    super.setPoints();
    this.lead1 = interpPoint(this.point1, this.point2, 1 - SweepElm.circleSize / this.dn);
  }

  override validate(): boolean {
    return validateRailNode(this, 0);
  }

  override stamp(): void {
    this.sim.stampVoltageSource(this.sim.ground, this.nodes[0]!, this.voltSource!);
  }

  setParams(): void {
    if (this.frequency < this.minF || this.frequency > this.maxF) {
      this.frequency = this.minF;
      this.freqTime = 0;
      this.dir = 1;
    }
    const ts = this.sim?.timeStep ?? 0;
    if ((this.flags & SweepElm.FLAG_LOG) === 0) {
      this.fadd = (this.dir * ts * (this.maxF - this.minF)) / this.sweepTime;
      this.fmul = 1;
    } else {
      this.fadd = 0;
      this.fmul = Math.pow(this.maxF / this.minF, (this.dir * ts) / this.sweepTime);
    }
    this.savedTimeStep = ts;
    this.needsParams = !this.sim;
  }

  override reset(): void {
    this.frequency = this.minF;
    this.freqTime = 0;
    this.dir = 1;
    this.setParams();
  }

  override startIteration(): void {
    const sim = this.sim;
    if (this.needsParams || sim.timeStep !== this.savedTimeStep) this.setParams();
    this.v = Math.sin(this.freqTime) * this.maxV;
    this.freqTime += this.frequency * 2 * Math.PI * sim.timeStep;
    this.frequency = this.frequency * this.fmul + this.fadd;
    if (this.frequency >= this.maxF && this.dir === 1) {
      if ((this.flags & SweepElm.FLAG_BIDIR) !== 0) {
        this.fadd = -this.fadd;
        this.fmul = 1 / this.fmul;
        this.dir = -1;
      } else this.frequency = this.minF;
    }
    if (this.frequency <= this.minF && this.dir === -1) {
      this.fadd = -this.fadd;
      this.fmul = 1 / this.fmul;
      this.dir = 1;
    }
  }

  override doStep(): void {
    this.sim.updateVoltageSource(this.sim.ground, this.nodes[0]!, this.voltSource!, this.v);
  }

  override getVoltageDiff(): number {
    return this.volts[0];
  }
  override getVoltageSourceCount(): number {
    return 1;
  }
  override hasGroundConnection(): boolean {
    return true;
  }
  override getPower(): number {
    return -this.getVoltageDiff() * this.current;
  }
}

export class PotElm extends CircuitElm {
  static override dumpType = 174;
  static override get xmlTag(): string {
    return "pt";
  }
  static readonly FLAG_SHOW_VALUES = 1;
  static readonly FLAG_FLIP = 2;
  static readonly FLAG_FLIP_OFFSET = 4;
  position = 0.5;
  maxResistance = 1000;
  resistance1 = 0;
  resistance2 = 0;
  current1 = 0;
  current2 = 0;
  current3 = 0;
  sliderText = "Resistance";
  /** Slider position, 0–100 (position = value × 0.0099 + 0.005). */
  sliderValue = 50;
  /** Pots with the same nonzero link share a slider. */
  link = 0;
  post3: GridPoint = pt(0, 0);
  corner2: GridPoint = pt(0, 0);
  arrowPoint: GridPoint = pt(0, 0);
  midpoint: GridPoint = pt(0, 0);

  override initNew(): void {
    this.maxResistance = 1000;
    this.position = 0.5;
    this.sliderText = "Resistance";
    this.flags = PotElm.FLAG_SHOW_VALUES;
    this.sliderValue = this.calcSliderValue();
  }

  override readTokens(st: TokenStream): void {
    this.maxResistance = st.nextDouble();
    this.position = st.nextDouble();
    this.sliderText = restOfLine(st);
    this.sliderValue = this.calcSliderValue();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.maxResistance = xml.double("ma", this.maxResistance);
    this.position = xml.double("po", this.position);
    this.sliderText = xml.string("sl", this.sliderText) ?? this.sliderText;
    this.link = xml.int("li", 0);
    this.sliderValue = this.calcSliderValue();
  }

  override dumpValues(): string {
    return ` ${this.maxResistance} ${this.position} ${this.sliderText}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["ma", String(this.maxResistance)], ["po", String(this.position)], ["sl", this.sliderText]);
    if (this.link !== 0) a.push(["li", String(this.link)]);
  }

  override textLossless(): boolean {
    return this.link === 0;
  }

  calcSliderValue(): number {
    return Math.round((this.position - 0.005) / 0.0099);
  }

  override getPostCount(): number {
    return 3;
  }
  override getPost(n: number): GridPoint {
    return n === 0 ? this.point1 : n === 1 ? this.point2 : this.post3;
  }

  override setPoints(): void {
    super.setPoints();
    let offset = 0;
    const g = grid.size;
    const dx = this.dx, dy = this.dy;
    if (Math.abs(dx) > Math.abs(dy) !== this.hasFlag(PotElm.FLAG_FLIP)) {
      const myLen = 2 * g * Math.sign(dx) * Math.trunc((Math.abs(dx) + 2 * g - 1) / (2 * g));
      this.point2 = pt(this.point1.x + myLen, this.point1.y);
      offset = dx < 0 ? dy : -dy;
    } else {
      const myLen = 2 * g * Math.sign(dy) * Math.trunc((Math.abs(dy) + 2 * g - 1) / (2 * g));
      if (dy !== 0) {
        this.point2 = pt(this.point1.x, this.point1.y + myLen);
        offset = dy > 0 ? dx : -dx;
      }
    }
    if (offset === 0) offset = this.hasFlag(PotElm.FLAG_FLIP_OFFSET) ? -g : g;
    offset *= this.geometryFlip;
    this.dn = Math.hypot(this.point2.x - this.point1.x, this.point2.y - this.point1.y);
    const bodyLen = 32;
    this.calcLeads(bodyLen);
    this.position = this.sliderValue * 0.0099 + 0.005;
    const soff = Math.trunc((this.position - 0.5) * bodyLen);
    this.post3 = interpPointPerp(this.point1, this.point2, 0.5, offset);
    this.corner2 = interpPointPerp(this.point1, this.point2, soff / this.dn + 0.5, offset);
    this.arrowPoint = interpPointPerp(this.point1, this.point2, soff / this.dn + 0.5, 8 * sign(offset));
    this.midpoint = interpPoint(this.point1, this.point2, soff / this.dn + 0.5);
  }

  override partSlider(): PartSlider {
    const r1 = this.maxResistance * this.position;
    const text = r1 >= 1e6 ? `${+(r1 / 1e6).toPrecision(3)} MΩ` : r1 >= 1e3 ? `${+(r1 / 1e3).toPrecision(3)} kΩ` : `${+r1.toPrecision(3)} Ω`;
    return { label: this.sliderText, value: this.sliderValue, valueText: text, set: (v) => this.setSliderValue(v) };
  }

  /** Move the slider (0–100); linked pots follow. The caller must re-analyze. */
  setSliderValue(v: number): void {
    this.sliderValue = Math.max(0, Math.min(100, Math.round(v)));
    this.setPoints();
    if (this.link !== 0) {
      for (const o of this.sim?.circuitElements ?? []) {
        if (o !== this && o instanceof PotElm && o.link === this.link) {
          o.sliderValue = this.sliderValue;
          o.setPoints();
        }
      }
    }
  }

  override calculateCurrent(): void {
    if (this.resistance1 === 0) return; // avoid NaN
    this.current1 = (this.volts[0] - this.volts[2]) / this.resistance1;
    this.current2 = (this.volts[1] - this.volts[2]) / this.resistance2;
    this.current3 = -this.current1 - this.current2;
  }

  override getCurrentIntoNode(n: number): number {
    return n === 0 ? -this.current1 : n === 1 ? -this.current2 : -this.current3;
  }

  override stamp(): void {
    this.resistance1 = this.maxResistance * this.position;
    this.resistance2 = this.maxResistance * (1 - this.position);
    this.sim.stampResistor(this.nodes[0]!, this.nodes[2]!, this.resistance1);
    this.sim.stampResistor(this.nodes[2]!, this.nodes[1]!, this.resistance2);
  }

  override getVoltageDiff(): number {
    return this.volts[0] - this.volts[1];
  }
}

/** SPDT switch (or more throws), with an optional center-off position. */
export class Switch2Elm extends SwitchElm {
  static override dumpType = ch("S");
  static readonly FLAG_CENTER_OFF = 1;
  static readonly FLAG_FLIPPED = 8;
  static readonly openhs = 16;
  link = 0;
  throwCount = 2;
  swposts: GridPoint[] = [];
  swpoles: GridPoint[] = [];

  override initNew(): void {
    this.noDiagonal = true;
    this.throwCount = 2;
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.link = st.nextInt();
    this.throwCount = st.tryInt() ?? 2;
    this.noDiagonal = true;
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.link = xml.int("li", this.link);
    this.throwCount = xml.int("th", this.throwCount);
    this.noDiagonal = true;
  }

  override dumpValues(): string {
    // multi-position switches save their position as a number
    return ` ${this.position} ${this.momentary}${(this.flags & SwitchElm.FLAG_LABEL) !== 0 ? " " + CircuitText.escape(this.label ?? "") : ""} ${this.link} ${this.throwCount}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["li", String(this.link)], ["th", String(this.throwCount)]);
  }

  override setPoints(): void {
    super.setPoints();
    this.calcLeads(32);
    this.swposts = [];
    this.swpoles = [];
    let i: number;
    for (i = 0; i !== this.throwCount; i++) {
      let hs = -Switch2Elm.openhs * (i - Math.trunc((this.throwCount - 1) / 2));
      if (this.throwCount === 2 && i === 0) hs = Switch2Elm.openhs;
      hs *= this.geometryFlip;
      this.swpoles[i] = interpPointPerp(this.lead1!, this.lead2!, 1, hs);
      this.swposts[i] = interpPointPerp(this.point1, this.point2, 1, hs);
    }
    this.swpoles[i] = this.lead2!; // for center off
    this.posCount = this.hasCenterOff() ? 3 : this.throwCount;
  }

  override getCurrentIntoNode(n: number): number {
    if (n === 0) return -this.current;
    if (n === this.position + 1) return this.current;
    return 0;
  }

  override getPost(n: number): GridPoint {
    return n === 0 ? this.point1 : this.swposts[n - 1];
  }
  override getPostCount(): number {
    return 1 + this.throwCount;
  }

  private get isOff(): boolean {
    return this.position === 2 && this.hasCenterOff();
  }

  override calculateCurrent(): void {
    if (this.isOff) this.current = 0;
    else if (this.resistance > 0) this.current = (this.volts[0] - this.volts[this.position + 1]) / this.resistance;
  }

  override setVoltageSource(_n: number, v: VoltageSource): void {
    this.voltSource = v;
    v.setNodes(this.nodes[0]!, this.nodes[this.position + 1]!);
  }

  override stamp(): void {
    if (this.isOff) return;
    if (this.resistance > 0) this.sim.stampResistor(this.nodes[0]!, this.nodes[this.position + 1]!, this.resistance);
    else this.sim.stampVoltageSource(this.nodes[0]!, this.nodes[this.position + 1]!, this.voltSource!, 0);
  }

  override getVoltageSourceCount(): number {
    if (this.isOff) return 0;
    return this.resistance > 0 ? 0 : 1;
  }

  override toggle(): void {
    super.toggle();
    if (this.link === 0) return;
    for (const o of this.sim?.circuitElements ?? []) {
      if (o instanceof Switch2Elm && o.link === this.link) {
        let pos = this.position;
        if (o.isPositionFlipped() !== this.isPositionFlipped()) pos = this.posCount - 1 - pos;
        if (pos < o.posCount) o.position = pos;
      }
    }
  }

  override getConnection(n1: number, n2: number): boolean {
    if (this.isOff) return false;
    const a = 0, b = 1 + this.position;
    return (n1 === a && n2 === b) || (n1 === b && n2 === a);
  }

  override isWireEquivalent(): boolean {
    return this.resistance === 0;
  }
  override isRemovableWire(): boolean {
    return false;
  }

  hasCenterOff(): boolean {
    return (this.flags & Switch2Elm.FLAG_CENTER_OFF) !== 0 && this.throwCount === 2;
  }
  isPositionFlipped(): boolean {
    return (this.flags & Switch2Elm.FLAG_FLIPPED) !== 0;
  }

  override validate(): boolean {
    if (this.isOff || this.resistance > 0) return true;
    const fpi = new FindPathInfo(PathKind.Voltage, this, this.getNode(0)!, this.sim);
    if (fpi.findPath(this.getNode(1 + this.position)!)) {
      this.resistance = 0.001;
      return false;
    }
    return true;
  }
}

/** Push button: a momentary SPST switch (saved as a plain switch). */
export class PushSwitchElm extends SwitchElm {
  override initNew(): void {
    super.initNew();
    this.momentary = true;
    this.position = 1;
  }
}

/** Switch controlled by a voltage on its third pin. */
export class AnalogSwitchElm extends CircuitElm {
  static override dumpType = 159;
  static override get xmlTag(): string {
    return "as";
  }
  static readonly FLAG_INVERT = 1;
  static readonly FLAG_PULLDOWN = 2;
  static readonly FLAG_FLIPPED_X = 4;
  static readonly FLAG_FLIPPED_Y = 8;
  static readonly FLAG_FLIPPED = 16;
  resistance = 0;
  r_on = 20;
  r_off = 1e10;
  threshold = 2.5;
  open = false;
  openhs = 16;
  point3: GridPoint = pt(0, 0);

  override initNew(): void {
    this.r_on = 20;
    this.r_off = 1e10;
    this.threshold = 2.5;
    this.noDiagonal = true;
    this.flags |= AnalogSwitchElm.FLAG_PULLDOWN;
  }

  override readTokens(st: TokenStream): void {
    this.noDiagonal = true;
    const a = st.tryDouble();
    if (a === undefined) return;
    this.r_on = a;
    const b = st.tryDouble();
    if (b === undefined) return;
    this.r_off = b;
    this.threshold = st.tryDouble() ?? this.threshold;
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.noDiagonal = true;
    this.r_on = xml.double("ron", this.r_on);
    this.r_off = xml.double("roff", this.r_off);
    this.threshold = xml.double("th", this.threshold);
  }

  override dumpValues(): string {
    return ` ${this.r_on} ${this.r_off} ${this.threshold}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["ron", String(this.r_on)], ["roff", String(this.r_off)], ["th", String(this.threshold)]);
  }

  isFlippedX(): boolean {
    return this.hasFlag(AnalogSwitchElm.FLAG_FLIPPED_X);
  }
  isFlippedY(): boolean {
    return this.hasFlag(AnalogSwitchElm.FLAG_FLIPPED_Y);
  }
  isFlipped(): boolean {
    return this.hasFlag(AnalogSwitchElm.FLAG_FLIPPED);
  }

  override setPoints(): void {
    super.setPoints();
    this.calcLeads(32);
    this.adjustLeadsToGrid(this.isFlippedX(), this.isFlippedY());
    this.openhs = (this.isFlippedX() !== this.isFlippedY()) !== this.isFlipped() ? -16 : 16;
    this.point3 = interpPointPerp(this.lead1!, this.lead2!, 0.5, -this.openhs);
  }

  override calculateCurrent(): void {
    if (this.resistance === 0) return;
    if (this.needsPulldown() && this.open) this.current = 0;
    else this.current = (this.volts[0] - this.volts[1]) / this.resistance;
  }

  override nonLinear(): boolean {
    return true;
  }
  needsPulldown(): boolean {
    return this.hasFlag(AnalogSwitchElm.FLAG_PULLDOWN);
  }

  override stamp(): void {
    if (this.needsPulldown()) {
      // if pulldown flag set, resistor from sw output to ground
      this.sim.stampResistor(this.nodes[0]!, this.sim.ground, this.r_off);
      this.sim.stampResistor(this.nodes[1]!, this.sim.ground, this.r_off);
    }
  }

  override doStep(): void {
    this.open = this.volts[2] < this.threshold;
    if (this.hasFlag(AnalogSwitchElm.FLAG_INVERT)) this.open = !this.open;
    // if pulldown flag is set, resistance is r_off and we already stamped it in stamp(), so skip
    if (!(this.needsPulldown() && this.open)) {
      this.resistance = this.open ? this.r_off : this.r_on;
      this.sim.stampResistor(this.nodes[0]!, this.nodes[1]!, this.resistance);
    }
  }

  override getPostCount(): number {
    return 3;
  }
  override getPost(n: number): GridPoint {
    return n === 0 ? this.point1 : n === 1 ? this.point2 : this.point3;
  }
  override getConnection(n1: number, n2: number): boolean {
    return !(n1 === 2 || n2 === 2);
  }
  override hasGroundConnection(n1: number): boolean {
    return this.needsPulldown() && n1 < 2;
  }
  override getCurrentIntoNode(n: number): number {
    if (n === 2) return 0;
    if (n === 0) return -this.current;
    return this.current;
  }
}

/** SPDT analog switch. */
export class AnalogSwitch2Elm extends AnalogSwitchElm {
  static override dumpType = 160;
  static override get xmlTag(): string {
    return "as2";
  }
  swposts: GridPoint[] = [];
  swpoles: GridPoint[] = [];
  ctlPoint: GridPoint = pt(0, 0);

  override setPoints(): void {
    super.setPoints();
    this.calcLeads(32);
    this.adjustLeadsToGrid(this.isFlippedX(), this.isFlippedY());
    this.swpoles = [interpPointPerp(this.lead1!, this.lead2!, 1, this.openhs), interpPointPerp(this.lead1!, this.lead2!, 1, -this.openhs)];
    this.swposts = [interpPointPerp(this.point1, this.point2, 1, this.openhs), interpPointPerp(this.point1, this.point2, 1, -this.openhs)];
    this.ctlPoint = interpPointPerp(this.lead1!, this.lead2!, 0.5, this.openhs);
  }

  override getPostCount(): number {
    return 4;
  }
  override getPost(n: number): GridPoint {
    return n === 0 ? this.point1 : n === 3 ? this.ctlPoint : this.swposts[n - 1];
  }

  override calculateCurrent(): void {
    if (this.open) this.current = (this.volts[0] - this.volts[2]) / this.r_on;
    else this.current = (this.volts[0] - this.volts[1]) / this.r_on;
  }

  override stamp(): void {
    if (this.needsPulldown()) {
      this.sim.stampResistor(this.nodes[1]!, this.sim.ground, this.r_off);
      this.sim.stampResistor(this.nodes[2]!, this.sim.ground, this.r_off);
    }
  }

  override doStep(): void {
    const sim = this.sim, nd = this.nodes;
    this.open = this.volts[3] < this.threshold;
    if (this.hasFlag(AnalogSwitchElm.FLAG_INVERT)) this.open = !this.open;
    if (this.open) {
      sim.stampResistor(nd[0]!, nd[2]!, this.r_on);
      if (!this.needsPulldown()) sim.stampResistor(nd[0]!, nd[1]!, this.r_off);
    } else {
      sim.stampResistor(nd[0]!, nd[1]!, this.r_on);
      if (!this.needsPulldown()) sim.stampResistor(nd[0]!, nd[2]!, this.r_off);
    }
  }

  override getConnection(n1: number, n2: number): boolean {
    return n1 !== 3 && n2 !== 3;
  }
  override hasGroundConnection(n: number): boolean {
    return this.needsPulldown() && (n === 1 || n === 2);
  }
  override getCurrentIntoNode(n: number): number {
    if (n === 0) return -this.current;
    const position = this.open ? 1 : 0;
    if (n === position + 1) return this.current;
    return 0;
  }
}

export class TransLineElm extends CircuitElm {
  /** NodeForge display geometry: preserve terminal identity when turning or mirroring. */
  static readonly FLAG_GEOMETRY_FLIP = 1 << 20;
  static override dumpType = 171;
  static override get xmlTag(): string {
    return "tl";
  }
  delay = 0;
  imped = 75;
  width = 0;
  voltageL: Float64Array | null = null;
  voltageR: Float64Array | null = null;
  lenSteps = 0;
  ptr = 0;
  lastStepCount = 0;
  posts: GridPoint[] = [];
  inner: GridPoint[] = [];
  voltSource1: VoltageSource | null = null;
  voltSource2: VoltageSource | null = null;
  current1 = 0;
  current2 = 0;
  private needsReset = true;

  override initNew(): void {
    this.delay = 1000 * 5e-6;
    this.imped = 75;
    this.noDiagonal = true;
  }

  override readTokens(st: TokenStream): void {
    this.delay = st.nextDouble();
    this.imped = st.nextDouble();
    this.width = st.nextInt();
    // next slot is for resistance (losses), which is not implemented
    st.next();
    this.noDiagonal = true;
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.delay = xml.double("de", this.delay);
    this.imped = xml.double("im", this.imped);
    this.width = xml.int("wi", this.width);
  }

  override dumpValues(): string {
    return ` ${this.delay} ${this.imped} ${this.width} 0`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["de", String(this.delay)], ["im", String(this.imped)], ["wi", String(this.width)]);
  }

  override getPostCount(): number {
    return 4;
  }
  override getInternalNodeCount(): number {
    return 2;
  }

  override reset(): void {
    const sim = this.sim;
    if (!sim || sim.maxTimeStep === 0) {
      this.needsReset = true;
      return;
    }
    this.lenSteps = Math.trunc(this.delay / sim.maxTimeStep);
    if (this.lenSteps > 100000) this.voltageL = this.voltageR = null;
    else {
      this.voltageL = new Float64Array(this.lenSteps);
      this.voltageR = new Float64Array(this.lenSteps);
    }
    this.ptr = 0;
    this.waveT = [];
    this.waveL = [];
    this.waveR = [];
    this.waveL0 = this.waveR0 = 0;
    super.reset();
    this.lastStepCount = 0;
    this.needsReset = false;
  }

  /**
   * NodeForge engine: the waves entering each end, with their times (one entry per accepted step),
   * so the delay is exact in time rather than a whole number of max steps.
   */
  waveT: number[] = [];
  waveL: number[] = [];
  waveR: number[] = [];
  /** NodeForge engine: the waves before the first entry (0: at rest; set by the DC operating point). */
  waveL0 = 0;
  waveR0 = 0;
  /** NodeForge engine: stamped for the DC operating point (see stamp). */
  private dc = false;

  /** A recorded wave at time t, linear between entries (the initial wave before the first). */
  private waveAt(wave: number[], t: number, initial: number): number {
    const ts = this.waveT;
    if (!ts.length || t < ts[0]) return initial;
    let lo = 0, hi = ts.length - 1;
    if (t >= ts[hi]) return wave[hi];
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ts[mid] <= t) lo = mid;
      else hi = mid;
    }
    const f = (t - ts[lo]) / (ts[hi] - ts[lo]);
    return wave[lo] + (wave[hi] - wave[lo]) * f;
  }

  override setPoints(): void {
    super.setPoints();
    const ds = (this.dy === 0 ? sign(this.dx) : -sign(this.dy)) * (this.hasFlag(TransLineElm.FLAG_GEOMETRY_FLIP) ? -1 : 1);
    const p1 = this.point1, p2 = this.point2, w = this.width;
    const sep = Math.trunc(grid.size / 2);
    const half = Math.trunc(w / 2);
    const p3 = interpPointPerp(p1, p2, 0, -w * ds), p4 = interpPointPerp(p1, p2, 1, -w * ds);
    const p5 = interpPointPerp(p1, p2, 0, -(half - sep) * ds), p6 = interpPointPerp(p1, p2, 1, -(half - sep) * ds);
    const p7 = interpPointPerp(p1, p2, 0, -(half + sep) * ds), p8 = interpPointPerp(p1, p2, 1, -(half + sep) * ds);
    // we number the posts like this because we want the lower-numbered points to be on the bottom,
    // so that if some of them are unconnected (which is often true) then the bottom ones will get
    // automatically attached to ground.
    this.posts = [p3, p4, p1, p2];
    this.inner = [p7, p8, p5, p6];
  }

  override setVoltageSource(n: number, v: VoltageSource): void {
    if (n === 0) {
      this.voltSource1 = v;
      v.setNodes(this.nodes[4]!, this.nodes[0]!);
    } else {
      this.voltSource2 = v;
      v.setNodes(this.nodes[5]!, this.nodes[1]!);
    }
  }

  override setCurrent(vs: VoltageSource, c: number): void {
    if (vs === this.voltSource1) this.current1 = c;
    else this.current2 = c;
  }

  override stamp(): void {
    const sim = this.sim, nd = this.nodes;
    if (this.needsReset) this.reset();
    this.dc = sim.dcShortInductors;
    if (this.dc) {
      // NodeForge engine: at the DC operating point a lossless line is ngspice's: both ports at the
      // same voltage, the current into one coming out of the other (a 1:1 ideal transformer).
      // The first source carries that current; the second is idle (inner node 4 held at post 0).
      const vs = this.voltSource1!;
      const ports: [number, number][] = [[2, 1], [0, -1], [3, -1], [1, 1]];
      for (const [n, x] of ports) {
        sim.stampMatrixVN(vs, nd[n]!, x);
        sim.stampMatrixNV(nd[n]!, vs, x);
      }
      sim.stampVoltageSource(nd[4]!, nd[0]!, this.voltSource2!, 0);
      sim.stampResistor(nd[5]!, nd[1]!, this.imped);
      return;
    }
    sim.stampVoltageSource(nd[4]!, nd[0]!, this.voltSource1!);
    sim.stampVoltageSource(nd[5]!, nd[1]!, this.voltSource2!);
    sim.stampResistor(nd[2]!, nd[4]!, this.imped);
    sim.stampResistor(nd[3]!, nd[5]!, this.imped);
  }

  override startIteration(): void {
    // NodeForge engine: the delay comes from the recorded waves instead (doStep)
    if (this.sim.accurate || this.dc) return;
    // calculate voltage changes due to incoming waves
    if (!this.voltageL || !this.voltageR) {
      this.sim.stop("Transmission line delay too large!", this);
      return;
    }
    const v = this.volts;
    this.voltageL[this.ptr] = v[2] - v[0] + v[2] - v[4];
    this.voltageR[this.ptr] = v[3] - v[1] + v[3] - v[5];
  }

  override doStep(): void {
    const sim = this.sim, nd = this.nodes;
    // NodeForge engine: nothing to update at the DC operating point
    if (this.dc) return;
    if (sim.accurate) {
      // NodeForge engine: what entered the other end one delay ago (exact in time)
      const t = sim.t - this.delay;
      sim.updateVoltageSource(nd[4]!, nd[0]!, this.voltSource1!, -this.waveAt(this.waveR, t, this.waveR0));
      sim.updateVoltageSource(nd[5]!, nd[1]!, this.voltSource2!, -this.waveAt(this.waveL, t, this.waveL0));
      if (Math.abs(this.volts[0]) > 1e-5 || Math.abs(this.volts[1]) > 1e-5) sim.stop("Need to ground transmission line!", this);
      return;
    }
    if (!this.voltageL || !this.voltageR) {
      sim.stop("Transmission line delay too large!", this);
      return;
    }
    const nextPtr = (this.ptr + 1) % this.lenSteps;
    sim.updateVoltageSource(nd[4]!, nd[0]!, this.voltSource1!, -this.voltageR[nextPtr]);
    sim.updateVoltageSource(nd[5]!, nd[1]!, this.voltSource2!, -this.voltageL[nextPtr]);
    if (Math.abs(this.volts[0]) > 1e-5 || Math.abs(this.volts[1]) > 1e-5) sim.stop("Need to ground transmission line!", this);
  }

  override stepFinished(): void {
    const sim = this.sim;
    if (this.dc) {
      // NodeForge engine: the DC operating point's steady waves (port voltage + Z0 × current in) are
      // what has been travelling along the line, so a run from it continues in steady state
      const v = this.volts, z = this.imped * this.current1;
      this.waveL0 = v[2] - v[0] + z;
      this.waveR0 = v[3] - v[1] - z;
      return;
    }
    if (sim.accurate) {
      // NodeForge engine: record the waves entering each end now, and forget what's older than the delay needs
      const v = this.volts, ts = this.waveT;
      if (ts.length && sim.t <= ts[ts.length - 1]) return;
      ts.push(sim.t);
      this.waveL.push(v[2] - v[0] + v[2] - v[4]);
      this.waveR.push(v[3] - v[1] + v[3] - v[5]);
      let old = 0;
      while (old + 1 < ts.length && ts[old + 1] < sim.t - this.delay - sim.maxTimeStep) old++;
      if (old > 256) {
        ts.splice(0, old);
        this.waveL.splice(0, old);
        this.waveR.splice(0, old);
      }
      return;
    }
    // stepFinished() may be called more than once per time step (it's called once per time step
    // in each subcircuit), so check to make sure
    if (this.sim.timeStepCount === this.lastStepCount) return;
    this.lastStepCount = this.sim.timeStepCount;
    this.ptr = (this.ptr + 1) % this.lenSteps;
  }

  override getPost(n: number): GridPoint {
    return this.posts[n];
  }
  override getVoltageSourceCount(): number {
    return 2;
  }
  override hasGroundConnection(): boolean {
    return false;
  }
  override getConnection(): boolean {
    return false;
  }
  override getMatrixConnection(n1: number, n2: number): boolean {
    // NodeForge engine: at the DC operating point the two ends are coupled (see stamp)
    if (this.sim?.dcShortInductors) return true;
    return n1 % 2 === n2 % 2;
  }

  override getCurrentIntoNode(n: number): number {
    // NodeForge engine: at the DC operating point the first source carries the current through
    if (this.dc) return n === 0 || n === 3 ? this.current1 : -this.current1;
    if (n === 0) return this.current1;
    if (n === 2) return -this.current1;
    if (n === 3) return -this.current2;
    return this.current2;
  }
}

export class MemristorElm extends CircuitElm {
  static override dumpType = ch("m");
  r_on = 100;
  r_off = 16000;
  dopeWidth = 0;
  totalWidth = 10e-9;
  mobility = 1e-10;
  resistance = 100;

  override initNew(): void {
    this.r_on = 100;
    this.r_off = 160 * this.r_on;
    this.dopeWidth = 0;
    this.totalWidth = 10e-9;
    this.mobility = 1e-10;
    this.resistance = 100;
  }

  override readTokens(st: TokenStream): void {
    this.r_on = st.nextDouble();
    this.r_off = st.nextDouble();
    this.dopeWidth = st.nextDouble();
    this.totalWidth = st.nextDouble();
    this.mobility = st.nextDouble();
    const c = st.tryDouble();
    if (c !== undefined) this.current = c;
    this.resistance = 100;
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.r_on = xml.double("ron", this.r_on);
    this.r_off = xml.double("rof", this.r_off);
    this.dopeWidth = xml.double("do", this.dopeWidth);
    this.totalWidth = xml.double("to", this.totalWidth);
    this.mobility = xml.double("mo", this.mobility);
  }

  override dumpValues(): string {
    return ` ${this.r_on} ${this.r_off} ${this.dopeWidth} ${this.totalWidth} ${this.mobility} ${this.current}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["ron", String(this.r_on)], ["rof", String(this.r_off)], ["do", String(this.dopeWidth)], ["to", String(this.totalWidth)], ["mo", String(this.mobility)]);
  }

  override setPoints(): void {
    super.setPoints();
    this.calcLeads(32);
  }

  override nonLinear(): boolean {
    return true;
  }

  override calculateCurrent(): void {
    this.current = (this.volts[0] - this.volts[1]) / this.resistance;
  }

  override reset(): void {
    this.dopeWidth = 0;
  }

  override startIteration(): void {
    const wd = this.dopeWidth / this.totalWidth;
    this.dopeWidth += (this.sim.timeStep * this.mobility * this.r_on * this.current) / this.totalWidth;
    if (this.dopeWidth < 0) this.dopeWidth = 0;
    if (this.dopeWidth > this.totalWidth) this.dopeWidth = this.totalWidth;
    this.resistance = this.r_on * wd + this.r_off * (1 - wd);
  }

  override doStep(): void {
    this.sim.stampResistor(this.nodes[0]!, this.nodes[1]!, this.resistance);
  }

  override getScopeValue(x: number): number {
    return x === 2 ? this.resistance : super.getScopeValue(x);
  }
}

export class SparkGapElm extends CircuitElm {
  static override dumpType = 187;
  resistance = 0;
  onresistance = 1e3;
  offresistance = 1e9;
  breakdown = 1e3;
  holdcurrent = 0.001;
  state = false;

  override initNew(): void {
    this.offresistance = 1e9;
    this.onresistance = 1e3;
    this.breakdown = 1e3;
    this.holdcurrent = 0.001;
    this.state = false;
  }

  override readTokens(st: TokenStream): void {
    this.onresistance = st.nextDouble();
    this.offresistance = st.nextDouble();
    this.breakdown = st.nextDouble();
    this.holdcurrent = st.nextDouble();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.onresistance = xml.double("on", this.onresistance);
    this.offresistance = xml.double("of", this.offresistance);
    this.breakdown = xml.double("br", this.breakdown);
    this.holdcurrent = xml.double("ho", this.holdcurrent);
  }

  override dumpValues(): string {
    return ` ${this.onresistance} ${this.offresistance} ${this.breakdown} ${this.holdcurrent}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["on", String(this.onresistance)], ["of", String(this.offresistance)], ["br", String(this.breakdown)], ["ho", String(this.holdcurrent)]);
  }

  override nonLinear(): boolean {
    return true;
  }

  override setPoints(): void {
    super.setPoints();
    this.calcLeads(24);
  }

  override calculateCurrent(): void {
    this.current = (this.volts[0] - this.volts[1]) / this.resistance;
  }

  override reset(): void {
    super.reset();
    this.state = false;
  }

  override startIteration(): void {
    if (Math.abs(this.current) < this.holdcurrent) this.state = false;
    if (Math.abs(this.volts[0] - this.volts[1]) > this.breakdown) this.state = true;
  }

  override doStep(): void {
    this.resistance = this.state ? this.onresistance : this.offresistance;
    this.sim.stampResistor(this.nodes[0]!, this.nodes[1]!, this.resistance);
  }
}

/** Incandescent lamp: the filament resistance follows its temperature. */
export class LampElm extends CircuitElm {
  static override dumpType = 181;
  static readonly roomTemp = 300;
  resistance = 0;
  temp = 300;
  nom_pow = 100;
  nom_v = 120;
  warmTime = 0.4;
  coolTime = 0.4;
  /** Initialize the filament after the simulator is attached. */
  private pendingInit = true;

  override initNew(): void {
    this.temp = LampElm.roomTemp;
    this.nom_pow = 100;
    this.nom_v = 120;
    this.warmTime = 0.4;
    this.coolTime = 0.4;
    this.pendingInit = true;
  }

  override readTokens(st: TokenStream): void {
    this.temp = st.nextDouble();
    if (Number.isNaN(this.temp)) this.temp = LampElm.roomTemp;
    this.nom_pow = st.nextDouble();
    this.nom_v = st.nextDouble();
    this.warmTime = st.nextDouble();
    this.coolTime = st.nextDouble();
    this.pendingInit = true;
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.temp = xml.double("te", this.temp);
    this.nom_pow = xml.double("np", this.nom_pow);
    this.nom_v = xml.double("nv", this.nom_v);
    this.warmTime = xml.double("wa", this.warmTime);
    this.coolTime = xml.double("co", this.coolTime);
  }

  override dumpValues(): string {
    return ` ${this.temp} ${this.nom_pow} ${this.nom_v} ${this.warmTime} ${this.coolTime}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["te", String(this.temp)], ["np", String(this.nom_pow)], ["nv", String(this.nom_v)], ["wa", String(this.warmTime)], ["co", String(this.coolTime)]);
  }

  override reset(): void {
    super.reset();
    this.temp = LampElm.roomTemp;
    this.pendingInit = false;
    this.update();
  }

  override setPoints(): void {
    super.setPoints();
    this.calcLeads(16);
  }

  override calculateCurrent(): void {
    this.current = (this.volts[0] - this.volts[1]) / this.resistance;
    if (this.resistance === 0) this.current = 0;
  }

  override nonLinear(): boolean {
    return true;
  }

  override startIteration(): void {
    if (this.pendingInit) {
      this.pendingInit = false;
      this.update();
    }
    this.update();
  }

  private update(): void {
    const nom_r = (this.nom_v * this.nom_v) / this.nom_pow;
    // this formula doesn't work for values over 5390
    const tp = this.temp > 5390 ? 5390 : this.temp;
    this.resistance = nom_r * (1.26104 - 4.90662 * Math.sqrt(17.1839 / tp - 0.00318794) - 7.8569 / (tp - 187.56));
    const cap = 1.57e-4 * this.nom_pow;
    const capw = (cap * this.warmTime) / 0.4, capc = (cap * this.coolTime) / 0.4;
    const ts = this.sim?.timeStep ?? 0;
    this.temp += (this.getPower() * ts) / capw;
    const cr = 2600 / this.nom_pow;
    this.temp -= (ts * (this.temp - LampElm.roomTemp)) / (capc * cr);
  }

  override doStep(): void {
    this.sim.stampResistor(this.nodes[0]!, this.nodes[1]!, this.resistance);
  }

  override getScopeValue(x: number): number {
    return x === 2 ? this.resistance : super.getScopeValue(x);
  }
}

export class CC2Elm extends ChipElm {
  static override dumpType = 179;
  gain = 1;

  override initNew(): void {
    super.initNew();
    this.gain = 1;
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.gain = st.nextDouble();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.gain = xml.double("ga", this.gain);
  }

  override dumpChipValues(): string {
    return ` ${this.gain}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["ga", String(this.gain)]);
  }

  override chipName(): string {
    return this.gain === 1 ? "CC2+" : "CC2-";
  }

  setupPins(): void {
    this.sizeX = 2;
    this.sizeY = 3;
    const pins = (this.pins = new Array<Pin>(3));
    pins[0] = this.newPin(0, Side.W, "X");
    pins[0].output = true;
    pins[1] = this.newPin(2, Side.W, "Y");
    pins[2] = this.newPin(1, Side.E, "Z");
  }

  override isDigitalChip(): boolean {
    return false;
  }

  override stamp(): void {
    const sim = this.sim, vs = this.pins[0].voltSource!;
    // X voltage = Y voltage
    sim.stampVoltageSource(sim.ground, this.nodes[0]!, vs);
    sim.stampVCVS(sim.ground, this.nodes[1]!, 1, vs);
    // Z current = gain * X current
    sim.stampCCCS(sim.ground, this.nodes[2]!, vs, this.gain);
  }

  override calculateCurrent(): void {
    this.pins[2].current = this.pins[0].current * this.gain;
  }

  override getPostCount(): number {
    return 3;
  }
  override getVoltageSourceCount(): number {
    return 1;
  }
  override getMatrixConnection(): boolean {
    return true;
  }
}

/** CC2 with negative current gain. */
export class CC2NegElm extends CC2Elm {
  override initNew(): void {
    super.initNew();
    this.gain = -1;
  }
}

export class TransformerElm extends CircuitElm {
  static override dumpType = ch("T");
  static readonly FLAG_BACK_EULER = 2;
  static readonly FLAG_REVERSE = 4;
  static readonly FLAG_VERTICAL = 8;
  static readonly FLAG_FLIP = 16;
  inductance = 4;
  ratio = 1;
  couplingCoef = 0.999;
  /** 0 = linear core. */
  saturationCurrent = 0;
  /** Primary and secondary currents. */
  coilCurrents = [0, 0];
  width = 64;
  /** Extra straight lead beyond each terminal; no effect on winding geometry. */
  terminalExtensions = [0, 0, 0, 0];
  polarity = 1;
  flip = 1;
  ptEnds: GridPoint[] = [];
  ptCoil: GridPoint[] = [];
  ptCore: GridPoint[] = [];
  dots: GridPoint[] | null = null;
  a1 = 0;
  a2 = 0;
  a3 = 0;
  a4 = 0;
  curSourceValue1 = 0;
  curSourceValue2 = 0;

  override initNew(): void {
    this.inductance = 4;
    this.ratio = this.polarity = 1;
    this.width = 64;
    this.terminalExtensions = [0, 0, 0, 0];
    this.noDiagonal = true;
    this.couplingCoef = 0.999;
  }

  override readTokens(st: TokenStream): void {
    this.width = this.hasFlag(TransformerElm.FLAG_VERTICAL) ? -Math.max(32, Math.abs(this.x2 - this.x)) : Math.max(32, Math.abs(this.y2 - this.y));
    this.inductance = st.nextDouble();
    this.ratio = st.nextDouble();
    this.coilCurrents[0] = st.nextDouble();
    this.coilCurrents[1] = st.nextDouble();
    this.couplingCoef = 0.999;
    const k = st.tryDouble();
    if (k !== undefined) {
      this.couplingCoef = k;
      this.saturationCurrent = st.tryDouble() ?? this.saturationCurrent;
      this.width = st.tryInt() ?? this.width;
      const ends = st.hasMoreTokens ? st.next().split(",") : [];
      this.terminalExtensions = Array.from({ length: 4 }, (_, i) => Math.max(0, Number(ends[i]) || 0));
    }
    this.noDiagonal = true;
    this.polarity = this.hasFlag(TransformerElm.FLAG_REVERSE) ? -1 : 1;
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.width = this.hasFlag(TransformerElm.FLAG_VERTICAL) ? -Math.max(32, Math.abs(this.x2 - this.x)) : Math.max(32, Math.abs(this.y2 - this.y));
    this.inductance = xml.double("in", this.inductance);
    this.ratio = xml.double("ra", this.ratio);
    this.couplingCoef = xml.double("co", this.couplingCoef);
    this.width = xml.int("wi", this.width);
    const ends = (xml.string("te", "") ?? "").split(",");
    this.terminalExtensions = Array.from({ length: 4 }, (_, i) => Math.max(0, Number(ends[i]) || 0));
    this.saturationCurrent = xml.double("isat", this.saturationCurrent);
    this.coilCurrents[0] = xml.double("c0", 0);
    this.coilCurrents[1] = xml.double("c1", 0);
    this.polarity = this.hasFlag(TransformerElm.FLAG_REVERSE) ? -1 : 1;
    this.noDiagonal = true;
  }

  override dumpValues(): string {
    const inferredWidth = this.hasFlag(TransformerElm.FLAG_VERTICAL)
      ? -Math.max(32, Math.abs(this.x2 - this.x)) : Math.max(32, Math.abs(this.y2 - this.y));
    const extended = this.terminalExtensions.some((v) => v !== 0);
    const width = this.width === inferredWidth && !extended ? "" : ` ${this.width}`;
    return ` ${this.inductance} ${this.ratio} ${this.coilCurrents[0]} ${this.coilCurrents[1]} ${this.couplingCoef} ${this.saturationCurrent}${width}${extended ? ` ${this.terminalExtensions.join(",")}` : ""}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["in", String(this.inductance)], ["ra", String(this.ratio)], ["co", String(this.couplingCoef)], ["wi", String(this.width)]);
    if (this.terminalExtensions.some((v) => v !== 0)) a.push(["te", this.terminalExtensions.join(",")]);
    if (this.saturationCurrent !== 0) a.push(["isat", String(this.saturationCurrent)]);
  }

  override dumpXmlState(a: XmlAttrs): void {
    a.push(["c0", String(this.coilCurrents[0])], ["c1", String(this.coilCurrents[1])]);
  }

  override nonLinear(): boolean {
    return this.saturationCurrent > 0;
  }
  isTrapezoidal(): boolean {
    return (this.flags & TransformerElm.FLAG_BACK_EULER) === 0;
  }

  override setPoints(): void {
    super.setPoints();
    if (this.hasFlag(TransformerElm.FLAG_VERTICAL)) this.point2 = pt(this.point1.x, this.point2.y);
    else this.point2 = pt(this.point2.x, this.point1.y);
    const p1 = this.point1, p2 = this.point2;
    this.flip = this.hasFlag(TransformerElm.FLAG_FLIP) ? -1 : 1;
    const ends = [p1, p2, interpPointPerp(p1, p2, 0, -this.dsign * this.width * this.flip), interpPointPerp(p1, p2, 1, -this.dsign * this.width * this.flip)];
    const ce = 0.5 - 12 / this.dn, cd = 0.5 - 2 / this.dn;
    const coil: GridPoint[] = [], core: GridPoint[] = [];
    for (let i = 0; i !== 4; i += 2) {
      coil[i] = interpPoint(ends[i], ends[i + 1], ce);
      coil[i + 1] = interpPoint(ends[i], ends[i + 1], 1 - ce);
      core[i] = interpPoint(ends[i], ends[i + 1], cd);
      core[i + 1] = interpPoint(ends[i], ends[i + 1], 1 - cd);
    }
    if (this.polarity === -1) {
      const vsign = this.hasFlag(TransformerElm.FLAG_VERTICAL) ? -1 : 1;
      const dotp = Math.abs(7 / this.width);
      this.dots = [
        interpPointPerp(coil[0], coil[2], dotp, -7 * this.dsign * vsign * this.flip),
        interpPointPerp(coil[3], coil[1], dotp, -7 * this.dsign * vsign * this.flip),
      ];
      [ends[1], ends[3]] = [ends[3], ends[1]];
      [coil[1], coil[3]] = [coil[3], coil[1]];
    } else this.dots = null;
    const axis = { x: (p2.x - p1.x) / (this.dn || 1), y: (p2.y - p1.y) / (this.dn || 1) };
    this.ptEnds = ends.map((p, i) => {
      const extension = this.terminalExtensions[i] ?? 0;
      return extension ? pt(p.x + axis.x * extension * (i === 0 || i === 2 ? -1 : 1),
        p.y + axis.y * extension * (i === 0 || i === 2 ? -1 : 1)) : p;
    });
    this.ptCoil = coil;
    this.ptCore = core;
  }

  override getPost(n: number): GridPoint {
    return this.ptEnds[n];
  }
  override getPostCount(): number {
    return 4;
  }

  override reset(): void {
    this.coilCurrents[0] = this.coilCurrents[1] = this.volts[0] = this.volts[1] = this.volts[2] = this.volts[3] = 0;
    this.curcount = this.curSourceValue1 = this.curSourceValue2 = 0;
  }

  calcEffectiveInductance(l0: number, i: number, isat: number): number {
    if (isat <= 0) return l0;
    const r = i / isat;
    return l0 / (1 + r * r);
  }

  computeCoefficients(l1: number, l2: number, m: number): void {
    // see Inductor for the derivation; this is the 2-coil generalization
    const deti = 1 / (l1 * l2 - m * m);
    const ts = this.isTrapezoidal() ? this.sim.timeStep / 2 : this.sim.timeStep;
    this.a1 = l2 * deti * ts;
    this.a2 = -m * deti * ts;
    this.a3 = -m * deti * ts;
    this.a4 = l1 * deti * ts;
  }

  override stamp(): void {
    const sim = this.sim, nd = this.nodes;
    const l1 = this.inductance, l2 = this.inductance * this.ratio * this.ratio;
    const m = this.couplingCoef * Math.sqrt(l1 * l2);
    this.computeCoefficients(l1, l2, m);
    if (this.saturationCurrent <= 0) {
      sim.stampConductance(nd[0]!, nd[2]!, this.a1);
      sim.stampVCCurrentSource(nd[0]!, nd[2]!, nd[1]!, nd[3]!, this.a2);
      sim.stampVCCurrentSource(nd[1]!, nd[3]!, nd[0]!, nd[2]!, this.a3);
      sim.stampConductance(nd[1]!, nd[3]!, this.a4);
    }
  }

  override startIteration(): void {
    if (this.saturationCurrent > 0) {
      const l1 = this.calcEffectiveInductance(this.inductance, this.coilCurrents[0], this.saturationCurrent);
      const l2 = this.calcEffectiveInductance(this.inductance * this.ratio * this.ratio, this.coilCurrents[1], this.saturationCurrent * this.ratio);
      const m = this.couplingCoef * Math.sqrt(l1 * l2);
      this.computeCoefficients(l1, l2, m);
    }
    const v = this.volts;
    const voltdiff1 = v[0] - v[2], voltdiff2 = v[1] - v[3];
    if (this.isTrapezoidal()) {
      this.curSourceValue1 = voltdiff1 * this.a1 + voltdiff2 * this.a2 + this.coilCurrents[0];
      this.curSourceValue2 = voltdiff1 * this.a3 + voltdiff2 * this.a4 + this.coilCurrents[1];
    } else {
      this.curSourceValue1 = this.coilCurrents[0];
      this.curSourceValue2 = this.coilCurrents[1];
    }
  }

  override doStep(): void {
    const sim = this.sim, nd = this.nodes;
    if (this.saturationCurrent > 0) {
      sim.stampConductance(nd[0]!, nd[2]!, this.a1);
      sim.stampVCCurrentSource(nd[0]!, nd[2]!, nd[1]!, nd[3]!, this.a2);
      sim.stampVCCurrentSource(nd[1]!, nd[3]!, nd[0]!, nd[2]!, this.a3);
      sim.stampConductance(nd[1]!, nd[3]!, this.a4);
    }
    sim.stampCurrentSource(nd[0]!, nd[2]!, this.curSourceValue1);
    sim.stampCurrentSource(nd[1]!, nd[3]!, this.curSourceValue2);
  }

  override calculateCurrent(): void {
    const v = this.volts;
    const voltdiff1 = v[0] - v[2], voltdiff2 = v[1] - v[3];
    this.coilCurrents[0] = voltdiff1 * this.a1 + voltdiff2 * this.a2 + this.curSourceValue1;
    this.coilCurrents[1] = voltdiff1 * this.a3 + voltdiff2 * this.a4 + this.curSourceValue2;
  }

  override getCurrentIntoNode(n: number): number {
    if (n < 2) return -this.coilCurrents[n];
    return this.coilCurrents[n - 2];
  }

  override getConnection(n1: number, n2: number): boolean {
    return ((n1 === 0 && n2 === 2) || (n1 === 2 && n2 === 0)) || ((n1 === 1 && n2 === 3) || (n1 === 3 && n2 === 1));
  }
  override getMatrixConnection(): boolean {
    return true;
  }
  override getCurrent(): number {
    return this.coilCurrents[0];
  }
}

export { VoltageElm };
