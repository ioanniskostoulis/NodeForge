// Ported from CircuitJS1 (LDRElm.java, ThermistorNTCElm.java, DCMotorElm.java, ComparatorElm.java,
// TriStateElm.java, DelayBufferElm.java, AnalogMuxElm.java, OptocouplerElm.java,
// TimeDelayRelayElm.java, BusTransceiverElm.java, OpAmpRealElm.java, DPDTSwitchElm.java,
// MBBSwitchElm.java, CustomTransformerElm.java) by Paul Falstad and contributors.
// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { CircuitElm, type PartSlider, type XmlAttrs } from "../core/elm";
import { FindPathInfo, PathKind } from "../core/findpath";
import { type GridPoint, orientSymbolPoint, grid, interpPoint, interpPointPerp, pt } from "../core/geometry";
import { invertMatrix } from "../core/lu";
import type { VoltageSource } from "../core/nodes";
import { CircuitText, JavaNumber, TokenStream, type XmlNode } from "../io/tokens";
import { type ResistorElm, SwitchElm } from "./basic";
import { ChipElm, Side } from "./chips";
import { CompositeElm } from "./composite";
import type { CCCSElm } from "./controlled";
import type { DiodeElm } from "./diode";
import { GateElm } from "./logic";
import { type CapacitorElm, Inductor } from "./reactive";
import type { TransistorElm } from "./semis";

const comparePair = (x1: number, x2: number, y1: number, y2: number) => (x1 === y1 && x2 === y2) || (x1 === y2 && x2 === y1);

/**
 * The slider value for a saved position (inverse of value·0.0099 + offset). Upstream uses
 * trunc(position·100), which moves the slider down a notch every save and reload.
 */
function sliderFor(position: number, offset: number): number {
  return Math.max(0, Math.min(100, Math.round((position - offset) / 0.0099)));
}


/** Light-dependent resistor; the light level is set by a slider. */
export class LDRElm extends CircuitElm {
  static override dumpType = 374;
  position = 0.34;
  resistance = 0;
  minLux = 0.1;
  maxLux = 10000;
  lux = 0;
  sliderText = "Light Brightness";
  sliderValue = 34;

  override initNew(): void {
    this.position = 0.34;
    this.sliderText = "Light Brightness";
    this.sliderValue = sliderFor(this.position, 0.0001);
    this.update();
  }

  override readTokens(st: TokenStream): void {
    this.position = st.nextDouble();
    this.sliderText = CircuitText.unescape(st.next());
    this.sliderValue = sliderFor(this.position, 0.0001);
    this.update();
  }

  override dumpValues(): string {
    return ` ${this.position} ${CircuitText.escape(this.sliderText)}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["ps", String(this.position)], ["st", this.sliderText]);
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.position = xml.double("ps", this.position);
    this.sliderText = xml.string("st", this.sliderText) ?? this.sliderText;
    this.sliderValue = sliderFor(this.position, 0.0001);
    this.update();
  }

  private update(): void {
    this.lux = this.maxLux * this.position + this.minLux;
    this.resistance = Math.round((this.maxLux - this.lux + 1) * 10);
  }

  override partSlider(): PartSlider {
    return { label: this.sliderText, value: this.sliderValue, valueText: `${Math.round(this.lux)} lux`, set: (v) => this.setSliderValue(v) };
  }

  setSliderValue(v: number): void {
    this.sliderValue = Math.max(0, Math.min(100, Math.round(v)));
    this.position = this.sliderValue * 0.0099 + 0.0001;
    this.update();
  }

  override setPoints(): void {
    super.setPoints();
    this.calcLeads(32);
    // upstream re-reads the slider here
    this.position = this.sliderValue * 0.0099 + 0.0001;
    this.update();
  }

  override calculateCurrent(): void {
    this.current = (this.volts[0] - this.volts[1]) / this.resistance;
  }

  override stamp(): void {
    this.update();
    this.sim.stampResistor(this.nodes[0]!, this.nodes[1]!, this.resistance);
  }
}

/** NTC thermistor; the temperature is set by a slider. */
export class ThermistorNTCElm extends CircuitElm {
  static override dumpType = 350;
  static readonly t0 = 273.15;
  position = 0.34;
  resistance = 0;
  minTempr = -40;
  maxTempr = 150;
  temperature = 25;
  r25 = 10000;
  r50 = 3605;
  b25100 = 0;
  sliderText = "Temperature";
  sliderValue = 34;

  override initNew(): void {
    this.minTempr = -40;
    this.maxTempr = 150;
    this.r25 = 10000;
    this.r50 = 3605;
    this.position = 0.34;
    this.sliderText = "Temperature";
    this.sliderValue = sliderFor(this.position, 0.005);
    this.update();
  }

  override readTokens(st: TokenStream): void {
    this.r25 = st.nextDouble();
    this.r50 = st.nextDouble();
    this.minTempr = st.nextDouble();
    this.maxTempr = st.nextDouble();
    this.position = st.nextDouble();
    this.sliderText = CircuitText.unescape(st.next());
    this.sliderValue = sliderFor(this.position, 0.005);
    this.update();
  }

  override dumpValues(): string {
    return ` ${this.r25} ${this.r50} ${this.minTempr} ${this.maxTempr} ${this.position} ${CircuitText.escape(this.sliderText)}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["r25", String(this.r25)], ["r50", String(this.r50)], ["mnt", String(this.minTempr)], ["mxt", String(this.maxTempr)],
      ["ps", String(this.position)], ["st", this.sliderText]);
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.r25 = xml.double("r25", this.r25);
    this.r50 = xml.double("r50", this.r50);
    this.minTempr = xml.double("mnt", this.minTempr);
    this.maxTempr = xml.double("mxt", this.maxTempr);
    this.position = xml.double("ps", this.position);
    this.sliderText = xml.string("st", this.sliderText) ?? this.sliderText;
    this.sliderValue = sliderFor(this.position, 0.005);
    this.update();
  }

  private update(): void {
    const k1 = ThermistorNTCElm.t0 + 25, k2 = ThermistorNTCElm.t0 + 50;
    this.b25100 = (Math.log(this.r25) - Math.log(this.r50)) / (1 / k1 - 1 / k2);
    this.temperature = Math.round(this.position * (this.maxTempr - this.minTempr) + this.minTempr);
    this.resistance = this.calcResistance(this.temperature);
  }

  calcResistance(tempr: number): number {
    return Math.round(this.r25 * Math.exp(this.b25100 * (1 / (tempr + ThermistorNTCElm.t0) - 1 / (ThermistorNTCElm.t0 + 25))));
  }

  override partSlider(): PartSlider {
    return { label: this.sliderText, value: this.sliderValue, valueText: `${this.temperature} °C`, set: (v) => this.setSliderValue(v) };
  }

  setSliderValue(v: number): void {
    this.sliderValue = Math.max(0, Math.min(100, Math.round(v)));
    this.position = this.sliderValue * 0.0099 + 0.005;
    this.update();
  }

  override setPoints(): void {
    super.setPoints();
    this.calcLeads(32);
    this.position = this.sliderValue * 0.0099 + 0.005;
    this.update();
  }

  override calculateCurrent(): void {
    this.current = (this.volts[0] - this.volts[1]) / this.resistance;
  }

  override stamp(): void {
    this.update();
    this.sim.stampResistor(this.nodes[0]!, this.nodes[1]!, this.resistance);
  }
}

/** DC motor: armature L and R with back-EMF, and a mechanical side modelled as an inductor. */
export class DCMotorElm extends CircuitElm {
  static override dumpType = 415;
  ind = new Inductor();
  indInertia = new Inductor();
  inductance = 0.5;
  resistance = 1;
  K = 0.15;
  Kb = 0.15;
  J = 0.02;
  b = 0.05;
  gearRatio = 1;
  tau = 0;
  angle = Math.PI / 2;
  speed = 0;
  coilCurrent = 0;
  inertiaCurrent = 0;
  voltSources: (VoltageSource | null)[] = [null, null];
  motorCenter: GridPoint = pt(0, 0);

  override initNew(): void {
    this.inductance = 0.5;
    this.resistance = 1;
    this.angle = Math.PI / 2;
    this.speed = 0;
    this.K = 0.15;
    this.b = 0.05;
    this.J = 0.02;
    this.Kb = 0.15;
    this.gearRatio = 1;
    this.tau = 0;
    this.setupInductors();
  }

  override readTokens(st: TokenStream): void {
    this.angle = Math.PI / 2;
    this.speed = 0;
    this.inductance = st.nextDouble();
    this.resistance = st.nextDouble();
    this.K = st.nextDouble();
    this.Kb = st.nextDouble();
    this.J = st.nextDouble();
    this.b = st.nextDouble();
    this.gearRatio = st.nextDouble();
    this.tau = st.nextDouble();
    this.setupInductors();
  }

  private setupInductors(): void {
    this.ind = new Inductor();
    this.indInertia = new Inductor();
    this.ind.setup(this.inductance, 0, Inductor.FLAG_BACK_EULER);
    this.indInertia.setup(this.J, 0, Inductor.FLAG_BACK_EULER);
  }

  // upstream has no text writer for this part; the fields are written so text files stay readable
  override dumpValues(): string {
    return ` ${this.inductance} ${this.resistance} ${this.K} ${this.Kb} ${this.J} ${this.b} ${this.gearRatio} ${this.tau}`;
  }
  override textLossless(): boolean {
    return false;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["in", String(this.inductance)], ["rs", String(this.resistance)], ["k", String(this.K)], ["kb", String(this.Kb)],
      ["j", String(this.J)], ["b", String(this.b)], ["gr", String(this.gearRatio)], ["ta", String(this.tau)]);
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.inductance = xml.double("in", this.inductance);
    this.resistance = xml.double("rs", this.resistance);
    this.K = xml.double("k", this.K);
    this.Kb = xml.double("kb", this.Kb);
    this.J = xml.double("j", this.J);
    this.b = xml.double("b", this.b);
    this.gearRatio = xml.double("gr", this.gearRatio);
    this.tau = xml.double("ta", this.tau);
    this.setupInductors();
  }

  override setPoints(): void {
    super.setPoints();
    this.calcLeads(36);
    this.motorCenter = interpPoint(this.point1, this.point2, 0.5);
    this.allocNodes();
  }

  override getInternalNodeCount(): number {
    return 4;
  }
  override getVoltageSourceCount(): number {
    return 2;
  }

  override setVoltageSource(n: number, v: VoltageSource): void {
    this.voltSources[n] = v;
    if (n === 0) v.setNodes(this.nodes[3]!, this.nodes[1]!);
    else v.setNodes(this.nodes[4]!, this.sim.ground);
  }

  override reset(): void {
    super.reset();
    this.ind.resetTo(0);
    this.indInertia.resetTo(0);
    this.coilCurrent = 0;
    this.inertiaCurrent = 0;
  }

  override stamp(): void {
    const sim = this.sim, nd = this.nodes;
    this.ind.stamp(sim, nd[0]!, nd[2]!);
    sim.stampResistor(nd[2]!, nd[3]!, this.resistance);
    sim.stampVoltageSource(nd[3]!, nd[1]!, this.voltSources[0]!);
    this.indInertia.stamp(sim, nd[4]!, nd[5]!);
    sim.stampResistor(nd[5]!, sim.ground, this.b);
    sim.stampVoltageSource(nd[4]!, sim.ground, this.voltSources[1]!);
  }

  override startIteration(): void {
    this.ind.startIteration(this.sim, this.volts[0] - this.volts[2]);
    this.indInertia.startIteration(this.sim, this.volts[4] - this.volts[5]);
    this.angle = this.angle + this.speed * this.sim.timeStep;
  }

  override doStep(): void {
    const sim = this.sim, nd = this.nodes;
    sim.updateVoltageSource(nd[4]!, sim.ground, this.voltSources[1]!, this.coilCurrent * this.K);
    sim.updateVoltageSource(nd[3]!, nd[1]!, this.voltSources[0]!, this.inertiaCurrent * this.Kb);
    this.ind.doStep(sim);
    this.indInertia.doStep(sim);
  }

  override calculateCurrent(): void {
    this.coilCurrent = this.ind.calculateCurrent(this.volts[0] - this.volts[2]);
    this.inertiaCurrent = this.indInertia.calculateCurrent(this.volts[4] - this.volts[5]);
    this.speed = this.inertiaCurrent;
  }

  override setCurrent(vs: VoltageSource, c: number): void {
    if (vs === this.voltSources[0]) this.current = c;
  }

  /** Speed in RPM. */
  get rpm(): number {
    return (60 * Math.abs(this.speed)) / (2 * Math.PI);
  }
}

/** Comparator: an op-amp driving an open-collector-style analog switch output. */
export class ComparatorElm extends CompositeElm {
  static override dumpType = 401;
  static readonly FLAG_SMALL = 2;
  static readonly FLAG_SWAP = 4;
  static readonly modelString = "OpAmpElm 1 2 3\rAnalogSwitchElm 4 5 3\rGroundElm 5";
  static readonly externalNodes = [2, 1, 4];
  opsize = 2;
  opheight = 16;
  opwidth = 26;
  in1p: GridPoint[] = [];
  in2p: GridPoint[] = [];

  override initNew(): void {
    this.initComposite(null, ComparatorElm.modelString, ComparatorElm.externalNodes);
    this.noDiagonal = true;
    this.setSize(grid.size === 8 ? 1 : 2);
  }

  override readTokens(st: TokenStream): void {
    this.initComposite(st, ComparatorElm.modelString, ComparatorElm.externalNodes);
    this.noDiagonal = true;
    this.setSize((this.flags & ComparatorElm.FLAG_SMALL) !== 0 ? 1 : 2);
  }

  setSize(s: number): void {
    this.opsize = s;
    this.opheight = 8 * s;
    this.opwidth = 13 * s;
    this.flags = (this.flags & ~ComparatorElm.FLAG_SMALL) | (s === 1 ? ComparatorElm.FLAG_SMALL : 0);
  }

  override setPoints(): void {
    super.setPoints();
    let ww = this.opwidth;
    if (ww > this.dn / 2) ww = Math.trunc(this.dn / 2);
    this.calcLeads(ww * 2);
    const hs = this.opheight * this.dsign;
    const sgn = this.hasFlag(ComparatorElm.FLAG_SWAP) ? -1 : 1;
    this.in1p = [interpPointPerp(this.point1, this.point2, 0, hs * sgn), interpPointPerp(this.lead1!, this.lead2!, 0, hs * sgn)];
    this.in2p = [interpPointPerp(this.point1, this.point2, 0, -hs * sgn), interpPointPerp(this.lead1!, this.lead2!, 0, -hs * sgn)];
    this.setPost(0, this.in1p[0]);
    this.setPost(1, this.in2p[0]);
    this.setPost(2, this.point2);
  }
}

/** Tri-state buffer (one bit or a bus): output follows input when enabled, floats otherwise. */
export class TriStateElm extends CircuitElm {
  static override dumpType = 180;
  static override get xmlTag(): string {
    return "ts";
  }
  static readonly FLAG_FLIP = 1;
  static readonly FLAG_FLIP_X = 2;
  static readonly FLAG_FLIP_Y = 4;
  resistance = 0;
  r_on = 0.1;
  r_off = 1e10;
  r_off_ground = 1e8;
  highVoltage = 5;
  busWidth = 1;
  voltageSources: (VoltageSource | null)[] = [];
  open = false;
  point3: GridPoint = pt(0, 0);
  lead3: GridPoint = pt(0, 0);

  override initNew(): void {
    this.r_on = 0.1;
    this.r_off = 1e10;
    this.r_off_ground = 1e8;
    this.noDiagonal = true;
    this.highVoltage = GateElm.lastHighVoltage;
  }

  override readTokens(st: TokenStream): void {
    this.r_on = 0.1;
    this.r_off = 1e10;
    this.r_off_ground = 0;
    this.noDiagonal = true;
    this.highVoltage = 5;
    const fields: ((v: number) => void)[] = [(v) => (this.r_on = v), (v) => (this.r_off = v), (v) => (this.r_off_ground = v), (v) => (this.highVoltage = v)];
    for (const f of fields) {
      const v = st.tryDouble();
      if (v === undefined) break;
      f(v);
    }
  }

  override dumpValues(): string {
    return ` ${this.r_on} ${this.r_off} ${this.r_off_ground} ${this.highVoltage}`;
  }
  override textLossless(): boolean {
    return this.busWidth === 1;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["ron", String(this.r_on)], ["roff", String(this.r_off)], ["rog", String(this.r_off_ground)], ["hi", String(this.highVoltage)]);
    if (this.busWidth !== 1) a.push(["bw", String(this.busWidth)]);
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.r_on = xml.double("ron", this.r_on);
    this.r_off = xml.double("roff", this.r_off);
    this.r_off_ground = xml.double("rog", this.r_off_ground);
    this.highVoltage = xml.double("hi", this.highVoltage);
    this.busWidth = xml.int("bw", 1);
  }

  override setHighVoltage(hv: number): void {
    this.highVoltage = hv;
  }

  override setPoints(): void {
    super.setPoints();
    this.calcLeads(32);
    this.adjustLeadsToGrid((this.flags & TriStateElm.FLAG_FLIP_X) !== 0, (this.flags & TriStateElm.FLAG_FLIP_Y) !== 0);
    const hs = 16;
    const sgn = (this.flags & TriStateElm.FLAG_FLIP) === 0 ? -1 : 1;
    this.point3 = interpPointPerp(this.lead1!, this.lead2!, 0.5, sgn * hs);
    this.lead3 = interpPointPerp(this.lead1!, this.lead2!, 0.5, sgn * (hs / 2 + 2));
  }

  controlNode(): number {
    return 2 * this.busWidth;
  }
  internalNode(bit: number): number {
    return 2 * this.busWidth + 1 + bit;
  }

  override calculateCurrent(): void {
    this.current = 0;
    for (let i = 0; i < this.busWidth; i++) {
      const intNode = this.internalNode(i), outNode = this.busWidth + i;
      const current31 = (this.volts[intNode] - this.volts[outNode]) / this.resistance;
      const current10 = this.r_off_ground === 0 ? 0 : this.volts[outNode] / this.r_off_ground;
      this.current += current31 - current10;
    }
  }

  override getCurrentIntoNode(n: number): number {
    if (n >= this.busWidth && n < 2 * this.busWidth) return this.current / this.busWidth;
    return 0;
  }

  override nonLinear(): boolean {
    return true;
  }

  override stamp(): void {
    for (let i = 0; i < this.busWidth; i++) this.sim.stampVoltageSource(this.sim.ground, this.nodes[this.internalNode(i)]!, this.voltageSources[i]!);
  }

  override doStep(): void {
    const sim = this.sim, nd = this.nodes;
    this.open = this.volts[this.controlNode()] < this.highVoltage * 0.5;
    this.resistance = this.open ? this.r_off : this.r_on;
    for (let i = 0; i < this.busWidth; i++) {
      const intNode = this.internalNode(i), outNode = this.busWidth + i;
      sim.stampResistor(nd[intNode]!, nd[outNode]!, this.resistance);
      if (this.r_off_ground > 0) sim.stampResistor(nd[outNode]!, sim.ground, this.r_off_ground);
      sim.updateVoltageSource(sim.ground, nd[intNode]!, this.voltageSources[i]!, this.volts[i] > this.highVoltage * 0.5 ? this.highVoltage : 0);
    }
  }

  override getPostCount(): number {
    return 2 * this.busWidth + 1;
  }
  override getInternalNodeCount(): number {
    return this.busWidth;
  }
  override getVoltageSourceCount(): number {
    return this.busWidth;
  }

  override setVoltageSource(n: number, v: VoltageSource): void {
    if (this.voltageSources.length !== this.busWidth) this.voltageSources = new Array<VoltageSource | null>(this.busWidth).fill(null);
    this.voltageSources[n] = v;
    v.setNodes(this.sim.ground, this.nodes[this.internalNode(n)]!);
  }

  override getMatrixConnection(n1: number, n2: number): boolean {
    for (let i = 0; i < this.busWidth; i++) if (comparePair(n1, n2, this.busWidth + i, this.internalNode(i))) return true;
    return false;
  }

  override getPost(n: number): GridPoint {
    const bw = this.busWidth;
    if (n < bw) return bw > 1 ? pt(this.point1.x, this.point1.y, n) : this.point1;
    if (n < 2 * bw) return bw > 1 ? pt(this.point2.x, this.point2.y, n - bw) : this.point2;
    return this.point3;
  }

  override getPostWidth(n: number): number {
    return n < 2 * this.busWidth ? this.busWidth : 1;
  }

  override getConnection(_n1: number, _n2: number): boolean {
    return false;
  }
  override hasGroundConnection(n1: number): boolean {
    return n1 >= this.busWidth && n1 < 2 * this.busWidth;
  }
}

/** Buffer whose output follows the input after a delay. */
export class DelayBufferElm extends CircuitElm {
  static override dumpType = 422;
  delay = 0;
  threshold = 2.5;
  highVoltage = 5;
  delayEndTime = 0;

  override initNew(): void {
    this.noDiagonal = true;
    this.threshold = 2.5;
    this.highVoltage = 5;
  }

  override readTokens(st: TokenStream): void {
    this.noDiagonal = true;
    this.delay = st.nextDouble();
    this.threshold = 2.5;
    this.highVoltage = 5;
    const th = st.tryDouble();
    if (th !== undefined) {
      this.threshold = th;
      this.highVoltage = st.tryDouble() ?? this.highVoltage;
    }
  }

  // upstream has no text writer for this part; the fields are written so text files stay readable
  override dumpValues(): string {
    return ` ${this.delay} ${this.threshold} ${this.highVoltage}`;
  }
  override textLossless(): boolean {
    return false;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["dl", String(this.delay)], ["th", String(this.threshold)], ["hv", String(this.highVoltage)]);
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.delay = xml.double("dl", this.delay);
    this.threshold = xml.double("th", this.threshold);
    this.highVoltage = xml.double("hv", this.highVoltage);
  }

  override setHighVoltage(hv: number): void {
    this.highVoltage = hv;
  }

  override setPoints(): void {
    super.setPoints();
    let ww = 16 - 2;
    if (ww > this.dn / 2) ww = Math.trunc(this.dn / 2);
    this.lead1 = interpPoint(this.point1, this.point2, 0.5 - ww / this.dn);
    this.lead2 = interpPoint(this.point1, this.point2, 0.5 + ww / this.dn);
  }

  override getVoltageSourceCount(): number {
    return 1;
  }
  override stamp(): void {
    this.sim.stampVoltageSource(this.sim.ground, this.nodes[1]!, this.voltSource!);
  }

  override doStep(): void {
    const inState = this.volts[0] > this.threshold;
    let outState = this.volts[1] > this.threshold;
    if (inState !== outState) {
      if (this.sim.t >= this.delayEndTime) outState = inState;
    } else this.delayEndTime = this.sim.t + this.delay;
    this.sim.updateVoltageSource(this.sim.ground, this.nodes[1]!, this.voltSource!, outState ? this.highVoltage : 0);
  }

  override getVoltageDiff(): number {
    return this.volts[0];
  }
  override getConnection(_n1: number, _n2: number): boolean {
    return false;
  }
  override hasGroundConnection(n1: number): boolean {
    return n1 === 1;
  }
  override getCurrentIntoNode(n: number): number {
    return n === 1 ? this.current : 0;
  }
}

/** Analog multiplexer: connects the selected input to Z through r_on. */
export class AnalogMuxElm extends ChipElm {
  static override dumpType = 432;
  static readonly FLAG_PULLDOWN = 2;
  selectBitCount = 2;
  inputCount = 4;
  outputPin = 6;
  r_on = 20;
  r_off = 1e10;
  threshold = 2.5;

  override initNew(): void {
    this.selectBitCount = 2;
    this.r_on = 20;
    this.r_off = 1e10;
    this.threshold = 2.5;
    super.initNew();
    this.flags |= AnalogMuxElm.FLAG_PULLDOWN;
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.selectBitCount = 2;
    this.r_on = 20;
    this.r_off = 1e10;
    this.threshold = 2.5;
    const sb = st.tryInt();
    if (sb !== undefined) {
      this.selectBitCount = sb;
      const fields: ((v: number) => void)[] = [(v) => (this.r_on = v), (v) => (this.r_off = v), (v) => (this.threshold = v)];
      for (const f of fields) {
        const v = st.tryDouble();
        if (v === undefined) break;
        f(v);
      }
    }
    this.setupPins();
    this.allocNodes();
  }

  override dumpChipValues(): string {
    return ` ${this.selectBitCount} ${this.r_on} ${this.r_off} ${this.threshold}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["sb", String(this.selectBitCount)], ["ron", String(this.r_on)], ["rof", String(this.r_off)], ["thr", String(this.threshold)]);
  }

  override undumpXml(xml: XmlNode): void {
    this.selectBitCount = xml.int("sb", this.selectBitCount);
    super.undumpXml(xml);
    this.r_on = xml.double("ron", this.r_on);
    this.r_off = xml.double("rof", this.r_off);
    this.threshold = xml.double("thr", this.threshold);
  }

  override chipName(): string {
    return "Analog Mux";
  }
  override nonLinear(): boolean {
    return true;
  }

  setupPins(): void {
    this.inputCount = 1 << this.selectBitCount;
    this.sizeX = this.selectBitCount + 1;
    this.sizeY = this.inputCount + 1;
    this.pins = [];
    for (let i = 0; i !== this.inputCount; i++) this.pins[i] = this.newPin(i, Side.W, "I" + i);
    for (let i = 0; i !== this.selectBitCount; i++) this.pins[this.inputCount + i] = this.newPin(i + 1, Side.S, "S" + i);
    this.outputPin = this.inputCount + this.selectBitCount;
    this.pins[this.outputPin] = this.newPin(0, Side.E, "Z");
    this.allocNodes();
  }

  override getPostCount(): number {
    return this.inputCount + this.selectBitCount + 1;
  }
  override getVoltageSourceCount(): number {
    return 0;
  }
  needsPulldown(): boolean {
    return this.hasFlag(AnalogMuxElm.FLAG_PULLDOWN);
  }

  override stamp(): void {}

  private selectedInput(): number {
    let sel = 0;
    for (let i = 0; i !== this.selectBitCount; i++) if (this.volts[this.inputCount + i] > this.threshold) sel |= 1 << i;
    return sel;
  }

  override startIteration(): void {}

  override doStep(): void {
    const sel = this.selectedInput(), sim = this.sim, nd = this.nodes;
    for (let i = 0; i !== this.inputCount; i++) {
      if (i === sel) sim.stampResistor(nd[i]!, nd[this.outputPin]!, this.r_on);
      else if (this.needsPulldown()) sim.stampResistor(nd[i]!, sim.ground, this.r_off);
      else sim.stampResistor(nd[i]!, nd[this.outputPin]!, this.r_off);
    }
  }

  override calculateCurrent(): void {
    const sel = this.selectedInput();
    let outputCurrent = 0;
    for (let i = 0; i !== this.inputCount; i++) {
      if (i === sel) {
        const c = (this.volts[i] - this.volts[this.outputPin]) / this.r_on;
        this.pins[i].current = -c;
        outputCurrent += c;
      } else if (this.needsPulldown()) {
        this.pins[i].current = -this.volts[i] / this.r_off;
      } else {
        const c = (this.volts[i] - this.volts[this.outputPin]) / this.r_off;
        this.pins[i].current = -c;
        outputCurrent += c;
      }
    }
    this.pins[this.outputPin].current = outputCurrent;
    for (let i = 0; i !== this.selectBitCount; i++) this.pins[this.inputCount + i].current = 0;
  }

  override getConnection(n1: number, n2: number): boolean {
    if (n1 >= this.inputCount && n1 < this.outputPin) return false;
    if (n2 >= this.inputCount && n2 < this.outputPin) return false;
    return true;
  }
  override hasGroundConnection(n1: number): boolean {
    return this.needsPulldown() && n1 < this.inputCount;
  }
  override validate(): boolean {
    return true;
  }
}

/** Optocoupler: an LED whose current drives a phototransistor's base (through a CCCS). */
export class OptocouplerElm extends CompositeElm {
  static override dumpType = 407;
  static readonly modelString = "DiodeElm 6 1\rCCCSElm 1 2 3 4\rNTransistorElm 3 4 5";
  static readonly externalNodes = [6, 2, 4, 5];
  ctr = 1;
  cspc = 16;
  cspc2 = 32;
  stubs: GridPoint[] = [];
  rect: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: 0, h: 0 };

  get diode(): DiodeElm {
    return this.compElmList[0] as DiodeElm;
  }
  get transistor(): TransistorElm {
    return this.compElmList[2] as TransistorElm;
  }

  override initNew(): void {
    this.initComposite(null, OptocouplerElm.modelString, OptocouplerElm.externalNodes);
    this.noDiagonal = true;
    this.initOptocoupler();
    this.diode.modelName = "default-optocoupler-led";
    this.diode.setup();
  }

  override readTokens(_st: TokenStream): void {
    // upstream passes no state for the parts
    this.initComposite(null, OptocouplerElm.modelString, OptocouplerElm.externalNodes);
    this.noDiagonal = true;
    this.initOptocoupler();
  }

  initOptocoupler(): void {
    const cccs = this.compElmList[1] as CCCSElm;
    cccs.setExpr(
      `${this.ctr}*max(0,min(.0001, select(i-.003, (-80000000000*(i)^5+800000000*(i)^4-3000000*(i)^3+5177.2*(i)^2+.2453*(i)-.00005)*1.04/700, (9000000*(i)^5-998113*(i)^4+42174*(i)^3-861.32*(i)^2+9.0836*(i)-.0078)*.945/700)))`,
    );
    this.transistor.setBeta(700);
  }

  override textLossless(): boolean {
    return false;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["ctr", String(this.ctr)], ["dmo", this.diode.modelName]);
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.ctr = xml.double("ctr", this.ctr);
    const defaultDmo = xml.get("ix") !== undefined ? this.diode.modelName : "default";
    this.diode.modelName = xml.string("dmo", defaultDmo) ?? defaultDmo;
    this.initOptocoupler();
    this.diode.setup();
  }

  override getConnection(n1: number, n2: number): boolean {
    return Math.trunc(n1 / 2) === Math.trunc(n2 / 2);
  }

  isFlippedX(): boolean {
    return (this.flags & ChipElm.FLAG_FLIP_X) !== 0;
  }
  isFlippedY(): boolean {
    return (this.flags & ChipElm.FLAG_FLIP_Y) !== 0;
  }

  override setPoints(): void {
    super.setPoints();
    const cspc = this.cspc, cspc2 = this.cspc2;
    const x0 = this.x + cspc2, y0 = this.y;
    const xr = x0 - cspc, yr = y0 - cspc / 2;
    const xs = 2 * cspc2, ys = 2 * cspc2 - cspc;
    this.rect = { x: xr, y: yr, w: xs, h: ys };
    this.stubs = [];
    this.setPin(0, x0, y0, 0, 1, -1, 0, 0, 0);
    this.setPin(1, x0, y0, 0, 1, -1, 0, 0, 0);
    this.setPin(2, x0, y0, 0, 1, 1, 0, xs - cspc2, 0);
    this.setPin(3, x0, y0, 0, 1, 1, 0, xs - cspc2, 0);
    const dx = this.isFlippedX() ? -1 : 1;
    const p = this.posts;
    this.diode.setPosition(p[0].x + 32 * dx, p[0].y, p[1].x + 32 * dx, p[1].y);
    this.stubs[0] = this.diode.getPost(0);
    this.stubs[1] = this.diode.getPost(1);
    const midp = Math.trunc((p[2].y + p[3].y) / 2);
    this.transistor.setFlipped(this.isFlippedY());
    this.transistor.setPosition(p[2].x - 40 * dx, midp, p[2].x - 24 * dx, midp);
    this.stubs[2] = this.transistor.getPost(1);
    this.stubs[3] = this.transistor.getPost(2);
    // NodeForge display geometry: turn the complete package, including its internal symbols.
    const map = (p: GridPoint) => orientSymbolPoint(this, p);
    for (let i = 0; i < 4; i++) this.setPost(i, map(this.getPost(i)));
    this.stubs = this.stubs.map(map);
    for (const child of [this.diode, this.transistor]) {
      child.point1 = map(child.point1); child.point2 = map(child.point2);
      if (child.lead1) child.lead1 = map(child.lead1);
      if (child.lead2) child.lead2 = map(child.lead2);
    }
    this.transistor.coll = this.transistor.coll.map(map);
    this.transistor.emit = this.transistor.emit.map(map);
    this.transistor.rect = this.transistor.rect.map(map);
    this.transistor.base = map(this.transistor.base);
    const a = this.symbolPoint(xr, yr), b = this.symbolPoint(xr + xs, yr + ys);
    this.boundingBox = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x) + 1, height: Math.abs(a.y - b.y) + 1 };
  }

  symbolPoint(x: number, y: number): GridPoint { return orientSymbolPoint(this, pt(x, y)); }

  private setPin(n: number, px: number, py: number, dx: number, dy: number, dax: number, day: number, sx: number, sy: number): void {
    const pos = n % 2;
    if (this.isFlippedX()) {
      dx = -dx;
      dax = -dax;
      px += this.cspc2;
      sx = -sx;
    }
    if (this.isFlippedY()) {
      dy = -dy;
      day = -day;
      py += this.cspc2;
      sy = -sy;
    }
    const xa = px + this.cspc2 * dx * pos + sx, ya = py + this.cspc2 * dy * pos + sy;
    this.setPost(n, pt(xa + dax * this.cspc2, ya + day * this.cspc2));
    this.stubs[n] = pt(xa + dax * this.cspc, ya + day * this.cspc);
  }
}

/** Relay that switches after a delay once its input is powered (or unpowered). */
export class TimeDelayRelayElm extends ChipElm {
  static override dumpType = 414;
  static readonly vinResistance = 10e3;
  lastTransition = 0;
  poweredState = false;
  onState = false;
  resistance = 10e6;
  onDelay = 1;
  offDelay = 0;
  onResistance = 1;
  offResistance = 10e6;

  override initNew(): void {
    super.initNew();
    this.onDelay = 1;
    this.offDelay = 0;
    this.onResistance = 1;
    this.offResistance = this.resistance = 10e6;
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.onDelay = st.nextDouble();
    this.offDelay = st.nextDouble();
    this.onResistance = st.nextDouble();
    this.offResistance = this.resistance = st.nextDouble();
  }

  // upstream has no text writer for this part; the fields are written so text files stay readable
  override dumpChipValues(): string {
    return ` ${this.onDelay} ${this.offDelay} ${this.onResistance} ${this.offResistance}`;
  }
  override textLossless(): boolean {
    return false;
  }

  override reset(): void {
    this.lastTransition = 0;
    this.poweredState = this.onState = false;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["ond", String(this.onDelay)], ["ofd", String(this.offDelay)], ["onr", String(this.onResistance)], ["ofr", String(this.offResistance)]);
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.onDelay = xml.double("ond", this.onDelay);
    this.offDelay = xml.double("ofd", this.offDelay);
    this.onResistance = xml.double("onr", this.onResistance);
    this.offResistance = xml.double("ofr", this.offResistance);
    this.resistance = this.offResistance;
  }

  override chipName(): string {
    return "time delay relay";
  }

  setupPins(): void {
    this.sizeX = 2;
    this.sizeY = 2;
    this.pins = [this.newPin(1, Side.W, "Vin"), this.newPin(1, Side.E, "gnd"), this.newPin(0, Side.W, "in"), this.newPin(0, Side.E, "out")];
  }

  override nonLinear(): boolean {
    return true;
  }
  override isDigitalChip(): boolean {
    return false;
  }

  override stamp(): void {
    this.resistance = this.onState ? this.onResistance : this.offResistance;
    this.sim.stampResistor(this.nodes[0]!, this.nodes[1]!, TimeDelayRelayElm.vinResistance);
  }

  override startIteration(): void {}

  override doStep(): void {
    this.resistance = this.onState ? this.onResistance : this.offResistance;
    this.sim.stampResistor(this.nodes[2]!, this.nodes[3]!, this.resistance);
  }

  override stepFinished(): void {
    const oldState = this.poweredState;
    this.poweredState = this.volts[0] - this.volts[1] > 2.5;
    if (oldState !== this.poweredState) this.lastTransition = this.sim.t;
    if (this.sim.t > this.lastTransition + (this.poweredState ? this.onDelay : this.offDelay)) this.onState = this.poweredState;
    // pin currents (upstream computes these while drawing)
    const p = this.pins;
    p[0].current = -(this.volts[0] - this.volts[1]) / TimeDelayRelayElm.vinResistance;
    p[2].current = -(this.volts[2] - this.volts[3]) / this.resistance;
    p[1].current = -p[0].current;
    p[3].current = -p[2].current;
  }

  override getPostCount(): number {
    return 4;
  }
  override getVoltageSourceCount(): number {
    return 0;
  }
  override validate(): boolean {
    return true;
  }
}

/** Bidirectional bus transceiver (like a 74x245): DIR picks A→B or B→A, OE enables the outputs. XML only. */
export class BusTransceiverElm extends ChipElm {
  static override get xmlTag(): string {
    return "BusTransceiver";
  }
  dataBits = 4;
  aNodes = 2;
  bNodes = 6;
  intNodes = 10;
  vSources: (VoltageSource | null)[] = [];

  override initNew(): void {
    this.dataBits = 4;
    super.initNew();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.dataBits = xml.int("db", this.dataBits);
    this.setupPins();
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["db", String(this.dataBits)]);
  }
  override textLossless(): boolean {
    return false;
  }

  override nonLinear(): boolean {
    return true;
  }
  override allowBus(): boolean {
    return true;
  }
  override chipName(): string {
    return "Bus Transceiver";
  }
  override defaultBitCount(): number {
    return 4;
  }

  setupPins(): void {
    if (this.dataBits === 0) this.dataBits = 4;
    this.sizeX = 2;
    const dataY = this.useBus() ? 1 : this.dataBits;
    this.sizeY = dataY + 2;
    this.bits = this.dataBits;
    this.pins = [];
    this.pins[0] = this.newPin(0, Side.W, "OE");
    this.pins[0].lineOver = true;
    this.pins[1] = this.newPin(0, Side.E, "DIR");
    this.aNodes = 2;
    this.bNodes = 2 + this.dataBits;
    this.intNodes = 2 + 2 * this.dataBits;
    this.makeBitPins(this.dataBits, this.sizeY - dataY, Side.W, this.aNodes, "A", false, false, true);
    this.makeBitPins(this.dataBits, this.sizeY - dataY, Side.E, this.bNodes, "B", false, false, true);
    this.allocNodes();
  }

  override getPostCount(): number {
    return 2 + 2 * this.dataBits;
  }
  override getVoltageSourceCount(): number {
    return this.dataBits;
  }
  override getInternalNodeCount(): number {
    return this.dataBits;
  }

  override setVoltageSource(j: number, vs: VoltageSource): void {
    if (this.vSources.length !== this.dataBits) this.vSources = new Array<VoltageSource | null>(this.dataBits).fill(null);
    this.vSources[j] = vs;
    vs.setNodes(this.sim.ground, this.nodes[this.intNodes + j]!);
  }

  override getMatrixConnection(n1: number, n2: number): boolean {
    for (let i = 0; i < this.dataBits; i++) {
      if (comparePair(n1, n2, this.intNodes + i, this.aNodes + i)) return true;
      if (comparePair(n1, n2, this.intNodes + i, this.bNodes + i)) return true;
    }
    return false;
  }

  override stamp(): void {
    for (let i = 0; i < this.dataBits; i++) this.sim.stampVoltageSource(this.sim.ground, this.nodes[this.intNodes + i]!, this.vSources[i]!);
  }

  override startIteration(): void {}

  override doStep(): void {
    const sim = this.sim, nd = this.nodes, th = this.getThreshold();
    const outputEnabled = this.volts[0] < th;
    const dirAtoB = this.volts[1] > th;
    for (let i = 0; i < this.dataBits; i++) {
      const srcVal = dirAtoB ? this.volts[this.aNodes + i] > th : this.volts[this.bNodes + i] > th;
      sim.updateVoltageSource(sim.ground, nd[this.intNodes + i]!, this.vSources[i]!, srcVal ? this.highVoltage : 0);
      const rDst = outputEnabled ? 1 : 1e10;
      if (dirAtoB) {
        sim.stampResistor(nd[this.intNodes + i]!, nd[this.aNodes + i]!, 1e8);
        sim.stampResistor(nd[this.intNodes + i]!, nd[this.bNodes + i]!, rDst);
      } else {
        sim.stampResistor(nd[this.intNodes + i]!, nd[this.aNodes + i]!, rDst);
        sim.stampResistor(nd[this.intNodes + i]!, nd[this.bNodes + i]!, 1e8);
      }
    }
  }

  override validate(): boolean {
    return true;
  }
}

/** Transistor-level op-amp (LM741 or LM324 models). Posts: −, +, out, V+, V−. */
export class OpAmpRealElm extends CompositeElm {
  static override dumpType = 409;
  static readonly MODEL_741 = 0;
  static readonly MODEL_324 = 1;
  static readonly MODEL_324v2 = 2;
  static readonly FLAG_SWAP = 2;
  static readonly defaultCurrentLimit = 0.0231;
  static readonly model741String =
    "NTransistorElm 3 8 9\rNTransistorElm 2 8 10\rPTransistorElm 11 12 9\rPTransistorElm 11 13 10\rNTransistorElm 14 12 1\r" +
    "NTransistorElm 14 13 5\rNTransistorElm 12 7 14\rPTransistorElm 8 8 7\rPTransistorElm 8 11 7\rNTransistorElm 17 11 16\r" +
    "NTransistorElm 17 17 4\rPTransistorElm 18 18 7\rPTransistorElm 18 20 7\rNTransistorElm 20 7 25\rNTransistorElm 13 22 24\r" +
    "NTransistorElm 21 20 22\rNTransistorElm 25 20 6\rNTransistorElm 24 22 23\rPTransistorElm 22 4 15\rNTransistorElm 23 13 4\r" +
    "CapacitorElm 13 20\r" +
    "ResistorElm 15 6\rResistorElm 6 25\r" +
    "ResistorElm 4 1\rResistorElm 4 14\rResistorElm 4 5\rResistorElm 4 16\rResistorElm 4 24\rResistorElm 4 23\rResistorElm 17 18\r" +
    "ResistorElm 22 21\rResistorElm 21 20\r";
  static readonly model741ExternalNodes = [2, 3, 6, 7, 4];
  static readonly lm324ModelString =
    "TransistorElm 1 2 3\rCurrentElm 4 3\rTransistorElm 2 2 5\rTransistorElm 2 6 5\rCapacitorElm 6 7\rCurrentElm 4 8\rCurrentElm 4 7\rTransistorElm 8 4 9\r" +
    "TransistorElm 7 4 10\rTransistorElm 10 4 11\rTransistorElm 11 7 12\rResistorElm 11 12\rTransistorElm 7 5 12\rCurrentElm 12 5\rTransistorElm 6 5 8\r" +
    "ResistorElm 9 5\rTransistorElm 9 7 5\rTransistorElm 13 6 3";
  static readonly lm324ExternalNodes = [1, 13, 12, 4, 5];
  static readonly lm324ModelDump =
    "0 -1 -0 0 10000/0 0.000006/0 1 0 0 100/0 1 0 0 100/0 1e-11 0/0 0.000004/0 0.0001/0 1 0 0 100/0 1 0 0 100/0 1 0 0 100/0 1 0 0 100/0 25/0 -1 0 0 100/0 0.00005/" +
    "0 -1 0 0 100/0 10000/0 1 0 0 100/0 -1 0 0 10000";
  static readonly lm324v2ModelString =
    "ResistorElm 4 6\rCurrentElm 4 7\rResistorElm 4 29\rResistorElm 8 30\rResistorElm 9 31\rTransistorElm 30 29 31 \rResistorElm 4 32\rResistorElm 2 33\rResistorElm 10 34\r" +
    "TransistorElm 33 32 34 \rResistorElm 9 35\rResistorElm 9 36\rResistorElm 11 37\rTransistorElm 36 35 37 \rResistorElm 10 38\rResistorElm 10 39\rResistorElm 11 40\r" +
    "TransistorElm 39 38 40 \rResistorElm 12 41\rTransistorElm 13 41 4 \rResistorElm 13 42\rTransistorElm 13 42 4 \rResistorElm 4 43\rTransistorElm 12 43 14 \rResistorElm 3 44\r" +
    "TransistorElm 14 44 6 \rResistorElm 15 45\rTransistorElm 6 45 4 \rResistorElm 3 46\rTransistorElm 15 46 16 \rResistorElm 3 47\rTransistorElm 16 47 17 \rResistorElm 17 16\r" +
    "ResistorElm 5 17\rResistorElm 4 48\rTransistorElm 15 48 5 \rResistorElm 15 49\rTransistorElm 17 49 5 \rCurrentElm 18 3\rCurrentElm 19 3\rCurrentElm 20 3\rResistorElm 11 50\r" +
    "TransistorElm 18 50 3 \rResistorElm 14 51\rTransistorElm 19 51 3 \rResistorElm 5 52\rTransistorElm 7 52 4 \rResistorElm 15 53\rTransistorElm 20 53 3 \rCapacitorElm 21 22\r" +
    "ResistorElm 12 21\rResistorElm 12 15\rVCVSElm 3 0 23 8\rVoltageElm 23 1\rCurrentElm 3 4\rResistorElm 4 3\rResistorElm 12 54\rTransistorElm 9 54 11 \rResistorElm 13 55\r" +
    "TransistorElm 10 55 11 \rCapacitorElm 12 13\rCapacitorElm 6 15\rCapacitorElm 3 24\rResistorElm 11 24\rCapacitorElm 1 2\rCapacitorElm 2 0\rCapacitorElm 1 0\r" +
    "VCVSElm 15 0 22 0\rCapacitorElm 5 0\rResistorElm 25 56\rTransistorElm 25 56 0 \rVCCSElm 27 0 4 3\rCurrentElm 0 25\rVoltageElm 25 26\rResistorElm 0 26\r" +
    "VCVSElm 28 26 27 0\rResistorElm 0 27\rVoltageElm 28 0\rResistorElm 0 28";
  static readonly lm324v2ExternalNodes = [2, 1, 5, 3, 4];
  static readonly lm324v2ModelDump =
    "0 40000/0 5e-7/0 380/0 1700/0 5/0 -1 0 0 306 xlm324v2-qpi/0 380/0 1700/0 5/0 -1 0 0 300 xlm324v2-qpa/0 380/0 1700/0 5/0 -1 0 0 306 xlm324v2-qpi/0 380/0 1700/0 5/" +
    "0 -1 0 0 306 xlm324v2-qpi/0 25/0 1 0 0 100 xlm324v2-qnq/0 25/0 1 0 0 100 xlm324v2-qnq/0 300/0 -1 0 0 100 xlm324v2-qpq/0 25/0 1 0 0 100 xlm324v2-qnq/0 25/0 1 0 0 100 xlm324v2-qnq/" +
    "0 25/0 1 0 0 100 xlm324v2-qnq/0 25/0 1 0 0 100 xlm324v2-qnq/0 40000/0 18/0 300/0 -1 0 0 100 xlm324v2-qpq/0 25/0 1 0 0 100 xlm324v2-qnq/0 1.2e-7/0 6e-8/0 0.000001/0 300/" +
    "0 -1 0 0 100 xlm324v2-qpq/0 300/0 -1 0 0 100 xlm324v2-qpq/0 25/0 1 0 0 100 xlm324v2-qnq/0 300/0 -1 0 0 100 xlm324v2-qpq/2 4.8e-12 0 0/0 3/0 3000000000/0 2 -0.00001*(a-b)/" +
    "0 0 0 -0.00156/0 0.000005/0 450000/0 300/0 -1 0 0 100 xlm324v2-qpq/0 300/0 -1 0 0 100 xlm324v2-qpq/2 8e-12 0 0/2 1e-12 0 0/2 1e-13 0 0/0 300000/2 2.3e-13 0 0/2 7.9e-13 0 0/" +
    "2 7.9e-13 0 0/0 2 2*(a-b)/2 5e-14 0 0/0 25/0 1 0 0 100 xlm324v2-qnq/0 2 0.0003*(a-b)/0 0.001/0 0 0 -0.25/0 1000000/0 2 1*(a-b)/0 1000000/0 0 0 -0.55/0 1000000";
  static readonly model741resistances = [50, 25, 1e3, 50e3, 1e3, 5e3, 50e3, 50, 39e3, 7500, 4500];
  static readonly opheight = 16;
  static readonly opwidth = 32;
  modelType = 0;
  slewRate = 0.6;
  currentLimit = OpAmpRealElm.defaultCurrentLimit;
  capValue = 0;
  in1p: GridPoint[] = [];
  in2p: GridPoint[] = [];
  rail1p: GridPoint[] = [];
  rail2p: GridPoint[] = [];

  override initNew(): void {
    this.noDiagonal = true;
    this.slewRate = 0.6;
    this.currentLimit = OpAmpRealElm.defaultCurrentLimit;
    this.modelType = OpAmpRealElm.MODEL_741;
    this.initModel();
  }

  override readTokens(st: TokenStream): void {
    this.noDiagonal = true;
    this.slewRate = st.nextDouble();
    this.capValue = st.nextDouble();
    this.currentLimit = OpAmpRealElm.defaultCurrentLimit;
    this.modelType = OpAmpRealElm.MODEL_741;
    const cl = st.tryDouble();
    if (cl !== undefined) {
      this.currentLimit = cl;
      this.modelType = st.tryInt() ?? this.modelType;
    }
    this.initModel();
  }

  // upstream's text writer writes the parts instead; these are the fields its reader expects
  override dumpValues(): string {
    const cap = this.getCapacitor();
    return ` ${this.slewRate} ${cap ? cap.voltdiff : 0} ${this.currentLimit} ${this.modelType}`;
  }
  override textLossless(): boolean {
    return false;
  }

  initModel(): void {
    this.flags |= CompositeElm.FLAG_ESCAPE;
    const T = OpAmpRealElm;
    const mult = this.currentLimit / T.defaultCurrentLimit;
    if (this.modelType === T.MODEL_741) {
      this.initComposite(null, T.model741String, T.model741ExternalNodes);
      const cap = this.getCapacitor()!;
      cap.capacitance = 30e-12 / (this.slewRate / 0.6);
      cap.voltdiff = this.capValue;
      for (let i = 0; i !== 11; i++) (this.compElmList[21 + i] as ResistorElm).resistance = T.model741resistances[i];
      (this.compElmList[21] as ResistorElm).resistance /= mult;
      (this.compElmList[22] as ResistorElm).resistance /= mult;
      (this.compElmList[13] as TransistorElm).setBeta(mult * 100);
      (this.compElmList[18] as TransistorElm).setBeta(mult * 100);
    } else if (this.modelType === T.MODEL_324) {
      this.initComposite(new TokenStream(T.lm324ModelDump, /\/+/), T.lm324ModelString, T.lm324ExternalNodes);
      const cap = this.getCapacitor()!;
      cap.capacitance = 10e-12 / (this.slewRate / 0.55);
      cap.voltdiff = this.capValue;
      (this.compElmList[11] as ResistorElm).resistance /= mult;
      for (const i of [9, 10, 12, 16]) (this.compElmList[i] as TransistorElm).setBeta(mult * 100);
    } else {
      this.initComposite(new TokenStream(T.lm324v2ModelDump, /\/+/), T.lm324v2ModelString, T.lm324v2ExternalNodes);
    }
    this.setPoints();
  }

  getCapacitor(): CapacitorElm | null {
    if (this.modelType === OpAmpRealElm.MODEL_324v2) return null;
    return this.compElmList[this.modelType === OpAmpRealElm.MODEL_741 ? 20 : 4] as CapacitorElm;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["slr", String(this.slewRate)], ["cl", String(this.currentLimit)], ["mt", String(this.modelType)]);
  }

  override dumpXmlState(a: XmlAttrs): void {
    a.push(["vd", String(this.getCapacitor()?.voltdiff ?? 0)]);
  }

  override xmlChildren(): XmlNode[] {
    return [];
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.slewRate = xml.double("slr", this.slewRate);
    this.currentLimit = xml.double("cl", this.currentLimit);
    this.modelType = xml.int("mt", this.modelType);
    const voltdiff = xml.double("vd", 0);
    this.initModel();
    const cap = this.getCapacitor();
    if (cap) cap.voltdiff = voltdiff;
  }

  override getConnection(_n1: number, _n2: number): boolean {
    return true;
  }

  override setPoints(): void {
    super.setPoints();
    this.dsign *= this.geometryFlip;
    let ww = OpAmpRealElm.opwidth;
    if (ww > this.dn / 2) ww = Math.trunc(this.dn / 2);
    this.calcLeads(ww * 2);
    const hs = OpAmpRealElm.opheight * this.dsign;
    const hsswap = (this.flags & OpAmpRealElm.FLAG_SWAP) !== 0 ? -hs : hs;
    const p1 = this.point1, p2 = this.point2, l1 = this.lead1!, l2 = this.lead2!;
    this.in1p = [interpPointPerp(p1, p2, 0, hsswap), interpPointPerp(l1, l2, 0, hsswap)];
    this.in2p = [interpPointPerp(p1, p2, 0, -hsswap), interpPointPerp(l1, l2, 0, -hsswap)];
    const railPos = 0.5 - ((this.dn / 2) % grid.size) / (ww * 2);
    this.rail1p = [interpPointPerp(l1, l2, railPos, hs * 2), interpPointPerp(l1, l2, railPos, hs * 2 * (1 - railPos))];
    this.rail2p = [interpPointPerp(l1, l2, railPos, -hs * 2), interpPointPerp(l1, l2, railPos, -hs * 2 * (1 - railPos))];
    if (this.posts.length < 5) return;
    this.setPost(0, this.in1p[0]);
    this.setPost(1, this.in2p[0]);
    this.setPost(2, p2);
    this.setPost(3, this.rail1p[0]);
    this.setPost(4, this.rail2p[0]);
  }
}

/** Double-pole (or more) double-throw switch. */
export class DPDTSwitchElm extends SwitchElm {
  static override dumpType = 429;
  static override get xmlTag(): string {
    return "dpdt";
  }
  static readonly openhs = 16;
  poleCount = 2;
  voltageSources: (VoltageSource | null)[] = [];
  currents: number[] = [];
  polePosts: GridPoint[] = [];
  poleLeads: GridPoint[] = [];
  throwPosts: GridPoint[] = [];
  throwLeads: GridPoint[] = [];

  override initNew(): void {
    this.noDiagonal = true;
    this.poleCount = 2;
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.poleCount = st.tryInt() ?? this.poleCount;
    this.noDiagonal = true;
  }

  override dumpValues(): string {
    return `${super.dumpValues()} ${this.poleCount}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["po", String(this.poleCount)]);
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.poleCount = xml.int("po", this.poleCount);
  }

  private ensureArrays(): void {
    if (this.voltageSources.length !== this.poleCount) {
      this.voltageSources = new Array<VoltageSource | null>(this.poleCount).fill(null);
      this.currents = new Array<number>(this.poleCount).fill(0);
    }
  }

  override setPoints(): void {
    super.setPoints();
    this.calcLeads(32);
    this.ensureArrays();
    const h = DPDTSwitchElm.openhs * this.geometryFlip, p1 = this.point1, p2 = this.point2, l1 = this.lead1!, l2 = this.lead2!;
    const iec = (this.flags & SwitchElm.FLAG_IEC) !== 0;
    this.polePosts = [];
    this.poleLeads = [];
    this.throwPosts = [];
    this.throwLeads = [];
    for (let i = 0; i !== this.poleCount; i++) {
      const offset = -i * h * 3;
      this.polePosts[i] = interpPointPerp(p1, p2, 0, offset);
      this.poleLeads[i] = interpPointPerp(l1, l2, 0, offset);
      this.throwPosts[i * 2] = interpPointPerp(p1, p2, 1, offset - h);
      this.throwLeads[i * 4] = interpPointPerp(l1, l2, 1, offset - h);
      this.throwPosts[i * 2 + 1] = interpPointPerp(p1, p2, 1, offset + h);
      this.throwLeads[i * 4 + 1] = interpPointPerp(l1, l2, 1, offset + h);
      this.throwLeads[i * 4 + 2] = interpPointPerp(l1, l2, 1, offset + h * 0.33);
      this.throwLeads[i * 4 + 3] = iec ? interpPointPerp(l1, l2, 1.2, offset - h * 0.33) : interpPointPerp(l1, l2, 1, offset - h);
    }
  }

  override getCurrentIntoNode(n: number): number {
    const t = Math.trunc(n / 3), n3 = n % 3;
    if (n3 === 0) return -this.currents[t];
    if (n3 === this.position + 1) return this.currents[t];
    return 0;
  }

  override setCurrent(vs: VoltageSource, c: number): void {
    for (let i = 0; i !== this.poleCount; i++) if (vs === this.voltageSources[i]) this.currents[i] = c;
  }

  override getPost(n: number): GridPoint {
    const t = Math.trunc(n / 3), n3 = n % 3;
    return n3 === 0 ? this.polePosts[t] : this.throwPosts[t * 2 + n3 - 1];
  }

  override getPostCount(): number {
    return 3 * this.poleCount;
  }

  override calculateCurrent(): void {
    if (this.resistance > 0) {
      for (let i = 0; i !== this.poleCount; i++) this.currents[i] = (this.volts[i * 3] - this.volts[i * 3 + 1 + this.position]) / this.resistance;
    }
  }

  override setVoltageSource(j: number, vs: VoltageSource): void {
    this.ensureArrays();
    this.voltageSources[j] = vs;
    vs.setNodes(this.nodes[j * 3]!, this.nodes[this.position + 1 + j * 3]!);
  }

  override stamp(): void {
    this.ensureArrays();
    for (let i = 0; i !== this.poleCount; i++) {
      if (this.resistance > 0) this.sim.stampResistor(this.nodes[i * 3]!, this.nodes[this.position + 1 + i * 3]!, this.resistance);
      else {
        const vs = this.voltageSources[i]!;
        this.sim.stampVoltageSource(vs.n1!, vs.n2!, vs, 0);
      }
    }
  }

  override getVoltageSourceCount(): number {
    return this.resistance > 0 ? 0 : this.poleCount;
  }

  override getConnection(n1: number, n2: number): boolean {
    for (let i = 0; i !== this.poleCount; i++) if (comparePair(n1, n2, i * 3, i * 3 + 1 + this.position)) return true;
    return false;
  }

  override isWireEquivalent(): boolean {
    return this.resistance === 0;
  }
  override isRemovableWire(): boolean {
    return false;
  }

  override validate(): boolean {
    if (this.resistance > 0) return true;
    for (let i = 0; i !== this.poleCount; i++) {
      const fpi = new FindPathInfo(PathKind.Voltage, this, this.getNode(i * 3)!, this.sim);
      if (fpi.findPath(this.getNode(i * 3 + 1 + this.position)!)) {
        this.resistance = 0.001;
        return false;
      }
    }
    return true;
  }
}

/** Make-before-break SPDT switch: passes through a position with both throws connected. */
export class MBBSwitchElm extends SwitchElm {
  static override dumpType = 416;
  static readonly openhs = 16;
  link = 0;
  voltSources: (VoltageSource | null)[] = [null, null];
  currents = [0, 0];
  both = false;
  swposts: GridPoint[] = [];
  swpoles: GridPoint[] = [];

  override initNew(): void {
    this.noDiagonal = true;
    this.posCount = 4;
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.link = st.nextInt();
    this.noDiagonal = true;
    this.posCount = 4;
  }

  override dumpValues(): string {
    return `${super.dumpValues()} ${this.link}`;
  }
  override textLossless(): boolean {
    return false;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["li", String(this.link)]);
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.link = xml.int("li", this.link);
  }

  override setPoints(): void {
    super.setPoints();
    this.calcLeads(32);
    this.swposts = [];
    this.swpoles = [];
    for (let i = 0; i !== 2; i++) {
      const hs = (i === 0 ? MBBSwitchElm.openhs : -MBBSwitchElm.openhs * i) * this.geometryFlip;
      this.swpoles[i] = interpPointPerp(this.lead1!, this.lead2!, 1, hs);
      this.swposts[i] = interpPointPerp(this.point1, this.point2, 1, hs);
    }
    this.posCount = 4;
  }

  override getCurrentIntoNode(n: number): number {
    if (n === 0) return -this.currents[0] - this.currents[1];
    return this.currents[n - 1];
  }

  override getPost(n: number): GridPoint {
    return n === 0 ? this.point1 : this.swposts[n - 1];
  }
  override getPostCount(): number {
    return 3;
  }

  override setCurrent(vs: VoltageSource, c: number): void {
    if (vs === this.voltSources[0]) this.currents[this.both ? 0 : Math.trunc(this.position / 2)] = c;
    else if (vs === this.voltSources[1]) this.currents[1] = c;
  }

  override calculateCurrent(): void {
    if (this.resistance > 0) {
      this.currents[0] = this.both || this.position === 0 ? (this.volts[0] - this.volts[1]) / this.resistance : 0;
      this.currents[1] = this.both || this.position === 2 ? (this.volts[0] - this.volts[2]) / this.resistance : 0;
      return;
    }
    if (!this.both) this.currents[1 - Math.trunc(this.position / 2)] = 0;
  }

  override setVoltageSource(n: number, v: VoltageSource): void {
    this.voltSources[n] = v;
    if (this.both) v.setNodes(this.nodes[0]!, this.nodes[n + 1]!);
    else if (this.position === 0) v.setNodes(this.nodes[0]!, this.nodes[1]!);
    else v.setNodes(this.nodes[0]!, this.nodes[2]!);
  }

  override stamp(): void {
    const sim = this.sim, nd = this.nodes;
    if (this.resistance > 0) {
      if (this.both || this.position === 0) sim.stampResistor(nd[0]!, nd[1]!, this.resistance);
      if (this.both || this.position === 2) sim.stampResistor(nd[0]!, nd[2]!, this.resistance);
      return;
    }
    let k = 0;
    const stampVs = () => {
      const vs = this.voltSources[k++]!;
      sim.stampVoltageSource(vs.n1!, vs.n2!, vs, 0);
    };
    if (this.both || this.position === 0) stampVs();
    if (this.both || this.position === 2) stampVs();
  }

  override getVoltageSourceCount(): number {
    this.both = this.position === 1 || this.position === 3;
    if (this.resistance > 0) return 0;
    return this.both ? 2 : 1;
  }

  override toggle(): void {
    super.toggle();
    if (this.link === 0) return;
    for (const o of this.sim?.circuitElements ?? []) if (o instanceof MBBSwitchElm && o.link === this.link) o.position = this.position;
  }

  override getConnection(n1: number, n2: number): boolean {
    if (this.both) return true;
    return comparePair(n1, n2, 0, 1 + Math.trunc(this.position / 2));
  }

  // not optimized out even when wire-equivalent: it may have 3 nodes to merge
  override isRemovableWire(): boolean {
    return false;
  }
  override isWireEquivalent(): boolean {
    return this.resistance === 0;
  }

  override validate(): boolean {
    if (this.resistance > 0) return true;
    const b = this.position === 1 || this.position === 3;
    for (const [cond, n] of [[b || this.position === 0, 1], [b || this.position === 2, 2]] as [boolean, number][]) {
      if (!cond) continue;
      const fpi = new FindPathInfo(PathKind.Voltage, this, this.getNode(0)!, this.sim);
      if (fpi.findPath(this.getNode(n)!)) {
        this.resistance = 0.001;
        return false;
      }
    }
    return true;
  }
}

/** Transformer with any number of coils and taps, from a description like "1,1:2+2". */
export class CustomTransformerElm extends CircuitElm {
  static override dumpType = 406;
  static readonly FLAG_FLIP = 1;
  static readonly FLAG_BACK_EULER = 2;
  /**
   * NodeForge: drawn vertically (point2 below or above point1), as TransformerElm.FLAG_VERTICAL.
   * Geometry only; CircuitJS ignores the bit and draws the part horizontally.
   */
  static readonly FLAG_VERTICAL = 8;
  inductance = 4;
  couplingCoef = 0.999;
  description = "1,1:1";
  width = 32;
  terminalExtensions: number[] = [];
  flip = 1;
  coilCount = 0;
  nodeCount = 0;
  primaryCoils = 0;
  coilNodes: number[] = [];
  coilInductances: number[] = [];
  coilCurrents: number[] = [];
  coilCurSourceValues: number[] = [];
  coilPolarities: number[] = [];
  nodeCurrents: number[] = [];
  nodePoints: GridPoint[] = [];
  nodeTaps: GridPoint[] = [];
  ptCore: GridPoint[] = [];
  dots: GridPoint[] | null = null;
  needDots = false;
  xformMatrix: number[][] | null = null;
  /** The last description error (for the editor). */
  error: string | null = null;

  override initNew(): void {
    this.inductance = 4;
    this.width = 32;
    this.terminalExtensions = [];
    this.noDiagonal = true;
    this.couplingCoef = 0.999;
    this.description = "1,1:1";
    this.parseDescription(this.description);
  }

  override readTokens(st: TokenStream): void {
    this.width = 32;
    this.inductance = st.nextDouble();
    this.couplingCoef = st.nextDouble();
    this.description = CircuitText.unescape(st.next());
    this.coilCount = st.nextInt();
    this.coilCurrents = [];
    for (let i = 0; i !== this.coilCount; i++) this.coilCurrents[i] = st.nextDouble();
    this.width = st.tryInt() ?? 32;
    const ends = st.hasMoreTokens ? st.next().split(",") : [];
    this.noDiagonal = true;
    this.parseDescription(this.description);
    this.terminalExtensions = Array.from({ length: this.nodeCount }, (_, i) => Math.max(0, Number(ends[i]) || 0));
  }

  // upstream has no text writer for this part; the fields are written so text files stay readable
  override dumpValues(): string {
    const extended = this.terminalExtensions.some((v) => v !== 0);
    return ` ${this.inductance} ${this.couplingCoef} ${CircuitText.escape(this.description)} ${this.coilCount} ${this.coilCurrents.join(" ")}${this.width === 32 && !extended ? "" : ` ${this.width}`}${extended ? ` ${this.terminalExtensions.join(",")}` : ""}`;
  }
  override textLossless(): boolean {
    return false;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["in", String(this.inductance)], ["cc", String(this.couplingCoef)], ["ds", this.description], ["nc", String(this.coilCount)]);
    if (this.width !== 32) a.push(["wi", String(this.width)]);
    if (this.terminalExtensions.some((v) => v !== 0)) a.push(["te", this.terminalExtensions.join(",")]);
  }

  override dumpXmlState(a: XmlAttrs): void {
    a.push(["ci", this.coilCurrents.slice(0, this.coilCount).join(" ")]);
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.inductance = xml.double("in", this.inductance);
    this.couplingCoef = xml.double("cc", this.couplingCoef);
    this.description = xml.string("ds", this.description) ?? this.description;
    this.width = xml.int("wi", 32);
    const ends = (xml.string("te", "") ?? "").split(",");
    this.coilCount = xml.int("nc", this.coilCount);
    this.coilCurrents = new Array<number>(this.coilCount).fill(0);
    const ci = xml.string("ci", null);
    if (ci !== null) {
      const st = new TokenStream(ci, / +/);
      for (let i = 0; i !== this.coilCount && st.hasMoreTokens; i++) this.coilCurrents[i] = st.nextDouble();
    }
    this.parseDescription(this.description);
    this.terminalExtensions = Array.from({ length: this.nodeCount }, (_, i) => Math.max(0, Number(ends[i]) || 0));
  }

  /** Parse a description; returns false (with `error` set) if it's malformed. */
  parseDescription(desc: string): boolean {
    this.error = null;
    const tokens = desc.split(/([,:+])/).filter((t) => t.length > 0);
    let coilCount = 0, nodeCount = 0;
    for (const s of tokens) {
      if (s === "+") nodeCount--;
      if (s === "," || s === "+" || s === ":") continue;
      nodeCount += 2;
      coilCount++;
    }
    this.coilCount = coilCount;
    this.nodeCount = nodeCount;
    if (coilCount === 0) {
      this.error = "no coils defined";
      return false;
    }
    this.coilNodes = new Array<number>(coilCount).fill(0);
    this.coilInductances = new Array<number>(coilCount).fill(0);
    if (this.coilCurrents.length !== coilCount) this.coilCurrents = new Array<number>(coilCount).fill(0);
    this.coilCurSourceValues = new Array<number>(coilCount).fill(0);
    this.coilPolarities = new Array<number>(coilCount).fill(0);
    this.nodeCurrents = new Array<number>(nodeCount).fill(0);
    let k = 0;
    let nodeNum = 0, coilNum = 0;
    this.primaryCoils = 0;
    let secondary = false;
    this.needDots = false;
    for (;;) {
      const tok = tokens[k++];
      let n: number;
      try {
        n = JavaNumber.parseDouble(tok ?? "");
      } catch {
        this.error = `expected number, got '${tok}'`;
        return false;
      }
      if (n === 0) {
        this.error = "turns ratio cannot be zero";
        return false;
      }
      this.coilNodes[coilNum] = nodeNum;
      this.coilInductances[coilNum] = n * n * this.inductance;
      this.coilPolarities[coilNum] = 1;
      if (n < 0) {
        this.coilPolarities[coilNum] = -1;
        this.needDots = true;
      }
      nodeNum += 2;
      coilNum++;
      if (!secondary) this.primaryCoils = coilNum;
      if (k >= tokens.length) break;
      const sep = tokens[k++];
      if (sep === ",") continue;
      if (sep === "+") {
        nodeNum--;
        continue;
      }
      if (sep === ":") {
        if (secondary) {
          this.error = "only one ':' separator allowed";
          return false;
        }
        secondary = true;
        continue;
      }
      this.error = `unexpected '${sep}'`;
      return false;
    }
    this.terminalExtensions = Array.from({ length: this.nodeCount }, (_, i) => this.terminalExtensions[i] ?? 0);
    this.allocNodes();
    this.setPoints();
    this.xformMatrix = null;
    return true;
  }

  isTrapezoidal(): boolean {
    return (this.flags & CustomTransformerElm.FLAG_BACK_EULER) === 0;
  }

  override setPoints(): void {
    super.setPoints();
    const vertical = this.hasFlag(CustomTransformerElm.FLAG_VERTICAL);
    this.point2 = vertical ? pt(this.point1.x, this.point2.y) : pt(this.point2.x, this.point1.y);
    this.flip = this.hasFlag(CustomTransformerElm.FLAG_FLIP) ? -1 : 1;
    if (this.coilNodes.length < this.coilCount || this.nodeCount === 0) return;
    const primaryNodes = this.primaryCoils === this.coilCount ? this.nodeCount : this.coilNodes[this.primaryCoils];
    this.dn = vertical ? Math.abs(this.point1.y - this.point2.y) : Math.abs(this.point1.x - this.point2.x);
    const ce = 0.5 - 12 / this.dn, cd = 0.5 - 2 / this.dn;
    let maxWidth = 0;
    for (let step = 0; step !== 2; step++) {
      let c = 0;
      let offset = 0;
      for (let i = 0; i !== this.nodeCount; i++) {
        if (i === primaryNodes) offset = 0;
        if (step === 1) {
          if (i === primaryNodes - 1 || i === this.nodeCount - 1) offset = maxWidth;
          this.nodePoints[i] = interpPointPerp(this.point1, this.point2, i < primaryNodes ? 0 : 1, -offset * this.flip);
          this.nodeTaps[i] = interpPointPerp(this.point1, this.point2, i < primaryNodes ? ce : 1 - ce, -offset * this.flip);
        }
        maxWidth = Math.max(maxWidth, offset);
        const nn = c < this.coilCount ? this.coilNodes[c] : -1;
        if (nn === i) {
          c++;
          offset += this.width;
        } else offset += 16;
      }
    }
    this.ptCore = [];
    for (let i = 0; i !== 4; i += 2) {
      const h = i === 2 ? -maxWidth * this.flip : 0;
      this.ptCore[i] = interpPointPerp(this.point1, this.point2, cd, h);
      this.ptCore[i + 1] = interpPointPerp(this.point1, this.point2, 1 - cd, h);
    }
    if (this.needDots) {
      const dotp = Math.abs(7 / this.width);
      this.dots = [];
      for (let i = 0; i !== this.coilCount; i++) {
        const n = this.coilNodes[i];
        this.dots[i] = interpPointPerp(this.nodeTaps[n], this.nodeTaps[n + 1], this.coilPolarities[i] > 0 ? dotp : 1 - dotp, i < this.primaryCoils ? -7 : 7);
      }
    } else this.dots = null;
    const axis = { x: (this.point2.x - this.point1.x) / (this.dn || 1), y: (this.point2.y - this.point1.y) / (this.dn || 1) };
    this.nodePoints = this.nodePoints.slice(0, this.nodeCount).map((p, i) => {
      const extension = this.terminalExtensions[i] ?? 0;
      return extension ? pt(p.x + axis.x * extension * (i < primaryNodes ? -1 : 1),
        p.y + axis.y * extension * (i < primaryNodes ? -1 : 1)) : p;
    });
  }

  override getPost(n: number): GridPoint {
    return this.nodePoints[n] ?? this.point1;
  }
  override getPostCount(): number {
    return this.nodeCount;
  }

  override reset(): void {
    for (let i = 0; i !== this.coilCount; i++) this.coilCurrents[i] = this.coilCurSourceValues[i] = 0;
    for (let i = 0; i !== this.nodeCount; i++) this.volts[i] = this.nodeCurrents[i] = 0;
  }

  override stamp(): void {
    const n = this.coilCount, sim = this.sim, nd = this.nodes;
    const xf = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (let i = 0; i !== n; i++) xf[i][i] = this.coilInductances[i];
    for (let i = 0; i !== n; i++)
      for (let j = 0; j !== i; j++)
        xf[i][j] = xf[j][i] = this.couplingCoef * Math.sqrt(this.coilInductances[i] * this.coilInductances[j]) * this.coilPolarities[i] * this.coilPolarities[j];
    invertMatrix(xf, n);
    const ts = this.isTrapezoidal() ? sim.timeStep / 2 : sim.timeStep;
    for (let i = 0; i !== n; i++) {
      for (let j = 0; j !== n; j++) {
        xf[i][j] *= ts;
        const ni = this.coilNodes[i], nj = this.coilNodes[j];
        if (i === j) sim.stampConductance(nd[ni]!, nd[ni + 1]!, xf[i][i]);
        else sim.stampVCCurrentSource(nd[ni]!, nd[ni + 1]!, nd[nj]!, nd[nj + 1]!, xf[i][j]);
      }
    }
    this.xformMatrix = xf;
  }

  override startIteration(): void {
    const xf = this.xformMatrix!;
    for (let i = 0; i !== this.coilCount; i++) {
      let val = this.coilCurrents[i];
      if (this.isTrapezoidal()) {
        for (let j = 0; j !== this.coilCount; j++) {
          const n = this.coilNodes[j];
          val += (this.volts[n] - this.volts[n + 1]) * xf[i][j];
        }
      }
      this.coilCurSourceValues[i] = val;
    }
  }

  override doStep(): void {
    for (let i = 0; i !== this.coilCount; i++) {
      const n = this.coilNodes[i];
      this.sim.stampCurrentSource(this.nodes[n]!, this.nodes[n + 1]!, this.coilCurSourceValues[i]);
    }
  }

  override calculateCurrent(): void {
    this.nodeCurrents.fill(0);
    for (let i = 0; i !== this.coilCount; i++) {
      let val = this.coilCurSourceValues[i];
      if (this.xformMatrix !== null) {
        for (let j = 0; j !== this.coilCount; j++) {
          const n = this.coilNodes[j];
          val += (this.volts[n] - this.volts[n + 1]) * this.xformMatrix[i][j];
        }
      }
      this.coilCurrents[i] = val;
      const ni = this.coilNodes[i];
      this.nodeCurrents[ni] += val;
      this.nodeCurrents[ni + 1] -= val;
    }
  }

  override getCurrentIntoNode(n: number): number {
    return -this.nodeCurrents[n];
  }

  override getConnection(n1: number, n2: number): boolean {
    for (let i = 0; i !== this.coilCount; i++) if (comparePair(n1, n2, this.coilNodes[i], this.coilNodes[i] + 1)) return true;
    return false;
  }
  // VCCS stamps couple all nodes, so they must all be in the same matrix
  override getMatrixConnection(): boolean {
    return true;
  }
}
