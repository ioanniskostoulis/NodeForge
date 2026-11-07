// Ported from CircuitJS1 (BatteryElm.java, AMElm.java, FMElm.java, DataInputElm.java,
// AudioInputElm.java, OhmMeterElm.java, WattmeterElm.java, WattmeterTrueElm.java,
// TestPointElm.java, StopTriggerElm.java, DataRecorderElm.java) by Paul Falstad and contributors.
// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Licensed under the GNU General Public License v2 or later. See LICENSE.
//
// Sources with their own models, and measuring / control parts.

import { CircuitElm, type XmlAttrs } from "../core/elm";
import { validateRailNode } from "../core/findpath";
import { type GridPoint, grid, interpPoint, interpPointPerp, pt, sign } from "../core/geometry";
import type { VoltageSource } from "../core/nodes";
import { CircuitText, JavaNumber, type TokenStream, type XmlNode } from "../io/tokens";
import { CurrentElm } from "./basic";
import { RailElm, Waveform } from "./sources";

/** Battery with a state-of-charge voltage table, series resistance and an RC polarization branch. */
export class BatteryElm extends CircuitElm {
  static readonly FLAG_SHOW_VOLTAGE = 1;
  static readonly FLAG_SHOW_SOC = 2;
  static readonly BT_LITHIUM = 1;
  static readonly BT_CUSTOM = -1;
  static readonly typeNames = ["Alkaline 1.5V", "Lithium-Ion", "NiMH 1.2V", "NiCd 1.2V", "Lead-Acid"];
  static readonly typeTables = [
    "0=0.8\n10=0.95\n20=1.05\n40=1.18\n60=1.28\n80=1.38\n90=1.43\n100=1.55\n",
    "0=3.00\n5=3.30\n10=3.45\n20=3.55\n30=3.62\n40=3.68\n50=3.73\n60=3.79\n70=3.87\n80=3.97\n90=4.08\n95=4.15\n100=4.20\n",
    "0=1.00\n10=1.15\n20=1.20\n50=1.25\n80=1.30\n90=1.33\n100=1.40\n",
    "0=1.00\n10=1.15\n20=1.20\n50=1.22\n80=1.25\n90=1.28\n100=1.35\n",
    "0=1.75\n10=1.90\n20=1.95\n50=2.05\n80=2.10\n90=2.12\n100=2.15\n",
  ];
  /** Capacity (Ah), R0, R1, C1 for each type. */
  static readonly typeDefaults = [[2.5, 0.15, 0.25, 1500], [3.0, 0.025, 0.02, 2000], [2.0, 0.03, 0.04, 1800], [1.0, 0.02, 0.025, 1200], [10, 0.008, 0.012, 5000]];
  batteryType = BatteryElm.BT_LITHIUM;
  r0 = 0.01;
  r1 = 0.02;
  c1 = 2000;
  capacityAh = 2;
  initialSoc = 1;
  soc = 1;
  compResistance = 0;
  capVoltDiff = 0;
  capCurrent = 0;
  curSourceValue = 0;
  socVoltageTable = BatteryElm.typeTables[BatteryElm.BT_LITHIUM];
  socTable: [number, number][] = [];

  override initNew(): void {
    this.r0 = 0.01;
    this.r1 = 0.02;
    this.c1 = 2000;
    this.capacityAh = 2;
    this.initialSoc = 1;
    this.flags |= BatteryElm.FLAG_SHOW_VOLTAGE | BatteryElm.FLAG_SHOW_SOC;
    this.batteryType = BatteryElm.BT_LITHIUM;
    this.socVoltageTable = BatteryElm.typeTables[this.batteryType];
    this.parseSocTable();
    this.reset();
  }

  override isBattery(): boolean {
    return true;
  }
  override getInternalNodeCount(): number {
    return 2;
  }
  override getVoltageSourceCount(): number {
    return 1;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["r0", String(this.r0)], ["r1", String(this.r1)], ["c1", String(this.c1)], ["cap", String(this.capacityAh)],
      ["isoc", String(this.initialSoc)], ["bt", String(this.batteryType)]);
  }
  override xmlText(): string | null {
    return this.batteryType === BatteryElm.BT_CUSTOM && this.socVoltageTable ? this.socVoltageTable : null;
  }
  override dumpXmlState(a: XmlAttrs): void {
    a.push(["soc", String(this.soc)]);
  }
  override textLossless(): boolean {
    return false;
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.r0 = xml.double("r0", 0.01);
    this.r1 = xml.double("r1", 0.02);
    this.c1 = xml.double("c1", 2000);
    this.capacityAh = xml.double("cap", 2);
    this.initialSoc = BatteryElm.clampSoc(xml.double("isoc", 1));
    this.soc = Math.min(1, xml.double("soc", this.initialSoc));
    this.batteryType = xml.int("bt", BatteryElm.BT_LITHIUM);
    if (this.batteryType === BatteryElm.BT_CUSTOM) {
      this.socVoltageTable = xml.text;
      if (!this.socVoltageTable) this.socVoltageTable = BatteryElm.typeTables[BatteryElm.BT_LITHIUM];
    } else {
      this.socVoltageTable = BatteryElm.typeTables[this.batteryType] ?? BatteryElm.typeTables[BatteryElm.BT_LITHIUM];
    }
    this.parseSocTable();
  }

  override reset(): void {
    this.soc = BatteryElm.clampSoc(this.initialSoc);
    this.capVoltDiff = this.capCurrent = this.curSourceValue = 0;
    this.curcount = 0;
  }

  static clampSoc(s: number): number {
    return s < 0 ? 0 : s > 1 ? 1 : s;
  }

  /** Change the battery type; a built-in type also sets its typical capacity and resistances. */
  setBatteryType(t: number): void {
    const old = this.batteryType;
    this.batteryType = t;
    if (t !== BatteryElm.BT_CUSTOM) {
      this.socVoltageTable = BatteryElm.typeTables[t];
      if (t !== old) [this.capacityAh, this.r0, this.r1, this.c1] = BatteryElm.typeDefaults[t];
    } else if (old !== BatteryElm.BT_CUSTOM) this.socVoltageTable = BatteryElm.typeTables[old];
    this.parseSocTable();
  }

  parseSocTable(): void {
    this.socTable = [];
    if (!this.socVoltageTable) return;
    for (const raw of this.socVoltageTable.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      try {
        this.socTable.push([JavaNumber.parseDouble(line.substring(0, eq).trim()), JavaNumber.parseDouble(line.substring(eq + 1).trim())]);
      } catch {
        // skip bad lines
      }
    }
    // insertion sort by SOC (stable, as upstream)
    for (let i = 1; i < this.socTable.length; i++) {
      const cur = this.socTable[i];
      let j = i - 1;
      while (j >= 0 && this.socTable[j][0] > cur[0]) {
        this.socTable[j + 1] = this.socTable[j];
        j--;
      }
      this.socTable[j + 1] = cur;
    }
  }

  getVoltageForSoc(socFrac: number): number {
    const socPct = socFrac * 100;
    if (socPct < 0) {
      const v0 = this.interpSocTable(0), v10 = this.interpSocTable(10);
      const slope = (v10 - v0) / 10;
      return v0 + slope * 3 * socPct;
    }
    return this.interpSocTable(socPct);
  }

  interpSocTable(socPct: number): number {
    const t = this.socTable;
    if (t.length === 0) return 3.7;
    if (t.length === 1) return t[0][1];
    if (socPct <= t[0][0]) return t[0][1];
    const n = t.length;
    if (socPct >= t[n - 1][0]) return t[n - 1][1];
    for (let i = 0; i < n - 1; i++) {
      const a = t[i], b = t[i + 1];
      if (socPct >= a[0] && socPct <= b[0]) {
        if (b[0] === a[0]) return a[1];
        const frac = (socPct - a[0]) / (b[0] - a[0]);
        return a[1] + frac * (b[1] - a[1]);
      }
    }
    return t[n - 1][1];
  }

  override setVoltageSource(n: number, v: VoltageSource): void {
    super.setVoltageSource(n, v);
    v.setNodes(this.nodes[0]!, this.nodes[2]!);
  }

  override stamp(): void {
    const sim = this.sim, nd = this.nodes;
    sim.stampVoltageSource(nd[0]!, nd[2]!, this.voltSource!);
    sim.stampResistor(nd[2]!, nd[3]!, this.r0);
    sim.stampResistor(nd[3]!, nd[1]!, this.r1);
    this.compResistance = sim.dcAnalysisFlag ? 1e8 : sim.timeStep / (2 * this.c1);
    sim.stampResistor(nd[3]!, nd[1]!, this.compResistance);
  }

  override startIteration(): void {
    if (this.sim.dcAnalysisFlag) this.curSourceValue = 0;
    else this.curSourceValue = -this.capVoltDiff / this.compResistance - this.capCurrent;
  }

  override doStep(): void {
    const nd = this.nodes;
    this.sim.updateVoltageSource(nd[0]!, nd[2]!, this.voltSource!, this.getVoltageForSoc(this.soc));
    this.sim.stampCurrentSource(nd[3]!, nd[1]!, this.curSourceValue);
  }

  override stepFinished(): void {
    this.capVoltDiff = this.volts[3] - this.volts[1];
    if (this.compResistance > 0) this.capCurrent = this.capVoltDiff / this.compResistance + this.curSourceValue;
    if (this.capacityAh > 0 && !this.sim.dcAnalysisFlag) {
      this.soc -= (this.current * this.sim.timeStep) / (3600 * this.capacityAh);
      if (this.soc > 1) this.soc = 1;
    }
  }

  override setPoints(): void {
    super.setPoints();
    this.calcLeads(8);
  }

  override getPower(): number {
    return -this.getVoltageDiff() * this.current;
  }
  override getVoltageDiff(): number {
    return this.volts[1] - this.volts[0];
  }

  get socText(): string {
    return Math.round(this.soc * 100) + "%";
  }
}

/** Amplitude-modulated source (to ground). */
export class AMElm extends CircuitElm {
  static override dumpType = 200;
  static readonly FLAG_COS = 2;
  static readonly circleSize = 17;
  carrierfreq = 1000;
  signalfreq = 40;
  maxVoltage = 5;
  freqTimeZero = 0;

  override initNew(): void {
    this.maxVoltage = 5;
    this.carrierfreq = 1000;
    this.signalfreq = 40;
    this.reset();
  }

  override readTokens(st: TokenStream): void {
    this.carrierfreq = st.nextDouble();
    this.signalfreq = st.nextDouble();
    this.maxVoltage = st.nextDouble();
    if ((this.flags & AMElm.FLAG_COS) !== 0) this.flags &= ~AMElm.FLAG_COS;
    this.reset();
  }

  // upstream has no text writer for this part; the fields are written so text files stay readable
  override dumpValues(): string {
    return ` ${this.carrierfreq} ${this.signalfreq} ${this.maxVoltage}`;
  }
  override textLossless(): boolean {
    return false;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["cf", String(this.carrierfreq)], ["sf", String(this.signalfreq)], ["mv", String(this.maxVoltage)]);
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.carrierfreq = xml.double("cf", this.carrierfreq);
    this.signalfreq = xml.double("sf", this.signalfreq);
    this.maxVoltage = xml.double("mv", this.maxVoltage);
    this.reset();
  }

  override reset(): void {
    this.freqTimeZero = 0;
    this.curcount = 0;
  }

  override getPostCount(): number {
    return 1;
  }
  override stamp(): void {
    this.sim.stampVoltageSource(this.sim.ground, this.nodes[0]!, this.voltSource!);
  }
  override doStep(): void {
    this.sim.updateVoltageSource(this.sim.ground, this.nodes[0]!, this.voltSource!, this.getVoltage());
  }

  getVoltage(): number {
    const w = 2 * Math.PI * (this.sim.t - this.freqTimeZero);
    return ((Math.sin(w * this.signalfreq) + 1) / 2) * Math.sin(w * this.carrierfreq) * this.maxVoltage;
  }

  override setPoints(): void {
    super.setPoints();
    this.lead1 = interpPoint(this.point1, this.point2, 1 - AMElm.circleSize / this.dn);
  }

  override getVoltageDiff(): number {
    return this.volts[0];
  }
  override validate(): boolean {
    return validateRailNode(this, 0);
  }
  override hasGroundConnection(_n1: number): boolean {
    return true;
  }
  override getVoltageSourceCount(): number {
    return 1;
  }
  override getPower(): number {
    return -this.getVoltageDiff() * this.current;
  }
}

/** Frequency-modulated source (to ground). */
export class FMElm extends AMElm {
  static override dumpType = 201;
  deviation = 200;
  lasttime = 0;
  funcx = 0;

  override initNew(): void {
    super.initNew();
    this.deviation = 200;
    this.carrierfreq = 800;
  }

  override readTokens(st: TokenStream): void {
    this.carrierfreq = st.nextDouble();
    this.signalfreq = st.nextDouble();
    this.maxVoltage = st.nextDouble();
    this.deviation = st.nextDouble();
    if ((this.flags & AMElm.FLAG_COS) !== 0) this.flags &= ~AMElm.FLAG_COS;
    this.reset();
  }

  override dumpValues(): string {
    return `${super.dumpValues()} ${this.deviation}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["dv", String(this.deviation)]);
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.deviation = xml.double("dv", this.deviation);
  }

  /** Integrates the instantaneous frequency (so it has state: call once per step… as upstream does). */
  override getVoltage(): number {
    const t = this.sim.t;
    const deltaT = t - this.lasttime;
    this.lasttime = t;
    const signalamplitude = Math.sin(2 * Math.PI * (t - this.freqTimeZero) * this.signalfreq);
    this.funcx += deltaT * (this.carrierfreq + signalamplitude * this.deviation);
    const w = 2 * Math.PI * this.funcx;
    return Math.sin(w) * this.maxVoltage;
  }
}

/** Rail driven by numbers from a data file (one voltage per line), one per sample interval. */
export class DataInputElm extends RailElm {
  static override dumpType = 424;
  static override get xmlTag(): string {
    return "DataInput";
  }
  static readonly FLAG_REPEAT = 1 << 8;
  static fileNumCounter = 1;
  /** Loaded files by number, for this session (upstream keeps the data out of the circuit text). */
  static fileMap = new Map<number, { fileName: string | null; data: number[] }>();
  data: number[] | null = null;
  sampleLength = 1e-3;
  scaleFactor = 1;
  timeOffset = 0;
  fileNum = 0;
  fileName: string | null = null;

  override initNew(): void {
    super.initNew();
    this.waveform = Waveform.ac;
    this.scaleFactor = 1;
    this.sampleLength = 1e-3;
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.waveform = Waveform.ac;
    this.sampleLength = st.nextDouble();
    this.scaleFactor = st.nextDouble();
    this.fileNum = st.nextInt();
    this.lookupFile();
  }

  override dumpValues(): string {
    return `${super.dumpValues()} ${this.sampleLength} ${this.scaleFactor} ${this.fileNum}`;
  }
  override textLossless(): boolean {
    return false;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["sl", String(this.sampleLength)], ["sf", String(this.scaleFactor)]);
  }

  override dumpXmlState(a: XmlAttrs): void {
    if (this.data === null) return;
    if (this.fileNum === 0) this.fileNum = DataInputElm.fileNumCounter++;
    DataInputElm.fileMap.set(this.fileNum, { fileName: this.fileName, data: this.data });
    a.push(["fn", String(this.fileNum)]);
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.sampleLength = xml.double("sl", this.sampleLength);
    this.scaleFactor = xml.double("sf", this.scaleFactor);
    this.fileNum = xml.int("fn", 0);
    this.lookupFile();
  }

  private lookupFile(): void {
    const ent = DataInputElm.fileMap.get(this.fileNum);
    if (ent) {
      this.fileName = ent.fileName;
      this.data = ent.data;
    }
  }

  /** Load a data file's text: one number per line; '#' lines are comments. Returns false on errors. */
  loadData(text: string, fileName: string): boolean {
    this.fileName = fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]*$/, "");
    const data: number[] = [];
    let parseError = false;
    for (const line of text.split(/\r*\n/)) {
      if (line.length === 0 || line[0] === "#") continue;
      try {
        data.push(JavaNumber.parseDouble(line));
      } catch {
        parseError = true;
      }
    }
    this.data = data;
    return data.length > 0 && !parseError;
  }

  override reset(): void {
    this.timeOffset = 0;
  }

  get railText(): string {
    return this.fileName ?? "No file";
  }

  doesRepeat(): boolean {
    return (this.flags & DataInputElm.FLAG_REPEAT) !== 0;
  }

  override getVoltage(): number {
    const data = this.data;
    if (data === null || data.length === 0) return 0;
    let ptr = Math.trunc(this.timeOffset / this.sampleLength);
    if (ptr < 0) ptr = 0;
    if (ptr >= data.length) {
      if (this.doesRepeat()) {
        ptr = 0;
        this.timeOffset = 0;
      } else ptr = data.length - 1;
    }
    return data[ptr] * this.scaleFactor;
  }

  override stepFinished(): void {
    this.timeOffset += this.sim.timeStep;
  }
}

/** Rail driven by a sound file's samples. The app decodes the file and passes the samples in. */
export class AudioInputElm extends RailElm {
  static override dumpType = 411;
  static override get xmlTag(): string {
    return "ain";
  }
  static fileNumCounter = 1;
  static lastSamplingRate = 44100;
  static fileMap = new Map<number, { fileName: string | null; data: Float32Array | number[] }>();
  data: Float32Array | number[] | null = null;
  timeOffset = 0;
  samplingRate = 44100;
  fileNum = 0;
  fileName: string | null = null;
  startPosition = 0;

  override initNew(): void {
    super.initNew();
    this.waveform = Waveform.ac;
    this.maxVoltage = 5;
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.waveform = Waveform.ac;
    this.maxVoltage = st.nextDouble();
    this.startPosition = st.nextDouble();
    this.fileNum = st.nextInt();
    this.lookupFile();
    this.samplingRate = AudioInputElm.lastSamplingRate;
  }

  private genFileNumber(): void {
    if (this.data === null) return;
    if (this.fileNum === 0) this.fileNum = AudioInputElm.fileNumCounter++;
    AudioInputElm.fileMap.set(this.fileNum, { fileName: this.fileName, data: this.data });
  }

  private lookupFile(): void {
    const ent = AudioInputElm.fileMap.get(this.fileNum);
    if (ent) {
      this.fileName = ent.fileName;
      this.data = ent.data;
    }
  }

  override dump(): string {
    this.genFileNumber();
    return super.dump();
  }
  override dumpValues(): string {
    return `${super.dumpValues()} ${this.maxVoltage} ${this.startPosition} ${this.fileNum}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["ma", String(this.maxVoltage)], ["st", String(this.startPosition)]);
    this.genFileNumber();
    a.push(["fi", String(this.fileNum)]);
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.maxVoltage = xml.double("ma", this.maxVoltage);
    this.startPosition = xml.double("st", this.startPosition);
    this.fileNum = xml.int("fi", this.fileNum);
    this.lookupFile();
    this.samplingRate = AudioInputElm.lastSamplingRate;
  }

  /** Samples (−1…1) decoded from a sound file. */
  loadAudio(samples: Float32Array | number[], samplingRate: number, fileName: string): void {
    this.data = samples;
    this.samplingRate = AudioInputElm.lastSamplingRate = samplingRate;
    this.fileName = fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]*$/, "");
  }

  get railText(): string {
    return this.fileName ?? "No file";
  }

  override reset(): void {
    this.timeOffset = this.startPosition;
  }

  override getVoltage(): number {
    const data = this.data;
    if (data === null) return 0;
    if (this.timeOffset < this.startPosition) this.timeOffset = this.startPosition;
    const dptr = this.timeOffset * this.samplingRate;
    const iptr = Math.trunc(dptr);
    const frac = dptr - iptr;
    if (iptr >= data.length) return 0;
    const value1 = data[iptr];
    const value2 = iptr + 1 < data.length ? data[iptr + 1] : 0;
    return (value1 * (1 - frac) + value2 * frac) * this.maxVoltage;
  }

  override stepFinished(): void {
    this.timeOffset += this.sim.timeStep;
  }
}

/** Ohmmeter: a current source whose voltage gives the resistance between its leads. */
export class OhmMeterElm extends CurrentElm {
  static override dumpType = 216;

  override setPoints(): void {
    super.setPoints();
    this.calcLeads(26);
  }

  /** V/I, or infinity with no current. */
  get resistance(): number {
    return this.current === 0 ? Infinity : this.getVoltageDiff() / this.current;
  }

  override getScopeValue(x: number): number {
    return x === 2 ? this.getVoltageDiff() / this.current : super.getScopeValue(x);
  }
}

/** Wattmeter (old style): current through one pair of posts, voltage across the other. */
export class WattmeterElm extends CircuitElm {
  /** NodeForge display geometry: preserve terminal identity when turning or mirroring. */
  static readonly FLAG_GEOMETRY_FLIP = 1 << 20;
  static override dumpType = 420;
  static readonly PM_INST = 0;
  static readonly PM_AVG = 1;
  width = 32;
  meter = 0;
  voltSources: (VoltageSource | null)[] = [null, null];
  currents = [0, 0];
  avgPower = 0;
  totalEnergy = 0;
  cycleTime = 0;
  lastCycleTime = 0;
  runEnergy = 0;
  runTime = 0;
  zeroTime = 0;
  peak = 0;
  trough = 0;
  wasAboveMid = false;
  haveFullCycle = false;
  posts: GridPoint[] = [];
  inner: GridPoint[] = [];
  rect: GridPoint[] = [];
  center: GridPoint = pt(0, 0);

  override readTokens(st: TokenStream): void {
    this.width = st.nextInt();
    this.meter = st.tryInt() ?? this.meter;
  }

  override dumpValues(): string {
    return ` ${this.width} ${this.meter}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["w", String(this.width)], ["meter", String(this.meter)]);
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.width = xml.int("w", this.width);
    this.meter = xml.int("meter", this.meter);
  }

  override getVoltageSourceCount(): number {
    return 2;
  }
  override getPostCount(): number {
    return 4;
  }

  /** The order of the posts (the old meter and the true-power meter differ). */
  postOrder(p3: GridPoint, p4: GridPoint, inner: GridPoint[]): void {
    this.posts = [p3, p4, this.point1, this.point2];
    this.inner = inner;
  }

  override setPoints(): void {
    super.setPoints();
    const ds = (this.dy === 0 ? sign(this.dx) : -sign(this.dy)) * (this.hasFlag(WattmeterElm.FLAG_GEOMETRY_FLIP) ? -1 : 1);
    const p1 = this.point1, p2 = this.point2, w = this.width;
    const p3 = interpPointPerp(p1, p2, 0, -w * ds), p4 = interpPointPerp(p1, p2, 1, -w * ds);
    const sep = grid.size;
    const p5 = interpPoint(p1, p2, sep / this.dn), p6 = interpPoint(p1, p2, 1 - sep / this.dn);
    const p7 = interpPoint(p3, p4, sep / this.dn), p8 = interpPoint(p3, p4, 1 - sep / this.dn);
    this.postOrder(p3, p4, [p7, p8, p5, p6]);
    const r1 = interpPointPerp(p1, p2, sep / this.dn, ds * sep), r2 = interpPointPerp(p1, p2, 1 - sep / this.dn, ds * sep);
    const r3 = interpPointPerp(p1, p2, sep / this.dn, -ds * (sep + w)), r4 = interpPointPerp(p1, p2, 1 - sep / this.dn, -ds * (sep + w));
    this.rect = [r1, r2, r4, r3];
    this.center = interpPoint(r1, r4, 0.5);
  }

  override getPost(n: number): GridPoint {
    return this.posts[n];
  }

  override stamp(): void {
    const nd = this.nodes;
    this.sim.stampVoltageSource(nd[0]!, nd[1]!, this.voltSources[0]!, 0);
    this.sim.stampVoltageSource(nd[2]!, nd[3]!, this.voltSources[1]!, 0);
  }

  override setVoltageSource(j: number, vs: VoltageSource): void {
    this.voltSources[j] = vs;
    vs.setNodes(this.nodes[j * 2]!, this.nodes[j * 2 + 1]!);
  }

  override stepFinished(): void {
    const p = this.getPower();
    const dt = this.sim.timeStep;
    this.cycleTime += dt;
    this.totalEnergy += p * dt;
    this.runTime += dt;
    this.runEnergy += p * dt;
    const mid = this.runEnergy / this.runTime;
    if (p > this.peak) this.peak = p;
    if (p < this.trough) this.trough = p;
    const band = (this.peak - this.trough) * 0.05 + Math.abs(this.peak) * 1e-9;
    const above = this.wasAboveMid ? p > mid - band : p > mid + band;
    if (above && !this.wasAboveMid) {
      if (this.haveFullCycle) {
        this.avgPower = this.totalEnergy / this.cycleTime;
        if (Number.isNaN(this.avgPower)) this.avgPower = 0;
        this.lastCycleTime = this.cycleTime;
      } else this.haveFullCycle = true;
      this.totalEnergy = 0;
      this.cycleTime = 0;
    } else if (this.lastCycleTime > 0 && this.cycleTime > this.lastCycleTime * 8) {
      this.avgPower = this.totalEnergy / this.cycleTime;
      if (Number.isNaN(this.avgPower)) this.avgPower = 0;
      this.totalEnergy = 0;
      this.cycleTime = 0;
    }
    this.wasAboveMid = above;
    if (this.lastCycleTime === 0) this.avgPower = mid;
    if (p === 0) {
      this.zeroTime += dt;
      if (this.lastCycleTime > 0 && this.zeroTime > this.lastCycleTime * 1.5) {
        this.avgPower = 0;
        this.totalEnergy = 0;
        this.cycleTime = 0;
      }
    } else this.zeroTime = 0;
  }

  /** The reading: instantaneous or average power. */
  get reading(): number {
    return this.meter === WattmeterElm.PM_AVG ? this.avgPower : this.getPower();
  }

  override getPower(): number {
    return this.getVoltageDiff() * this.getCurrent();
  }
  override setCurrent(vs: VoltageSource, c: number): void {
    this.currents[vs === this.voltSources[0] ? 0 : 1] = c;
  }
  override getCurrentIntoNode(n: number): number {
    return n % 2 === 0 ? -this.currents[Math.trunc(n / 2)] : this.currents[Math.trunc(n / 2)];
  }
  override getConnection(n1: number, n2: number): boolean {
    return Math.trunc(n1 / 2) === Math.trunc(n2 / 2);
  }
  override hasGroundConnection(_n1: number): boolean {
    return false;
  }
  override getCurrent(): number {
    return this.currents[1];
  }
  override getVoltageDiff(): number {
    return this.volts[2] - this.volts[0];
  }
}

/** Wattmeter: current through the M–L posts, voltage sensed by a 100MΩ resistor. XML only. */
export class WattmeterTrueElm extends WattmeterElm {
  static override dumpType = 0;
  static override get xmlTag(): string {
    return "WattmeterTrue";
  }
  count = 0;
  totalPower = 0;
  zerocount = 0;
  maxP = 0;
  lastMaxP = 0;
  minP = 0;
  lastMinP = 0;
  increasingP = true;
  decreasingP = true;

  override textLossless(): boolean {
    return false;
  }

  override getVoltageSourceCount(): number {
    return 1;
  }

  override postOrder(p3: GridPoint, p4: GridPoint, inner: GridPoint[]): void {
    this.posts = [p4, p3, this.point1, this.point2];
    this.inner = [inner[1], inner[0], inner[2], inner[3]];
  }

  override stamp(): void {
    const nd = this.nodes;
    this.sim.stampVoltageSource(nd[2]!, nd[3]!, this.voltSources[0]!, 0);
    this.sim.stampResistor(nd[0]!, nd[1]!, 1e8);
  }

  override setVoltageSource(j: number, vs: VoltageSource): void {
    this.voltSources[j] = vs;
  }

  override stepFinished(): void {
    const p = this.getPower();
    this.count++;
    this.totalPower += p;
    if (p > this.maxP && this.increasingP) {
      this.maxP = p;
      this.increasingP = true;
      this.decreasingP = false;
    }
    if (p < this.maxP && this.increasingP) {
      this.lastMaxP = this.maxP;
      this.minP = p;
      this.increasingP = false;
      this.decreasingP = true;
      this.avgPower = this.totalPower / this.count;
      if (Number.isNaN(this.avgPower)) this.avgPower = 0;
      this.count = 0;
      this.totalPower = 0;
    }
    if (p < this.minP && this.decreasingP) {
      this.minP = p;
      this.increasingP = false;
      this.decreasingP = true;
    }
    if (p > this.minP && this.decreasingP) {
      this.lastMinP = this.minP;
      this.maxP = p;
      this.increasingP = true;
      this.decreasingP = false;
      this.avgPower = this.totalPower / this.count;
      if (Number.isNaN(this.avgPower)) this.avgPower = 0;
      this.count = 0;
      this.totalPower = 0;
    }
    if (p === 0) {
      this.zerocount++;
      if (this.zerocount > 5) {
        this.totalPower = 0;
        this.avgPower = 0;
        this.maxP = 0;
        this.minP = 0;
      }
    } else this.zerocount = 0;
  }

  override setCurrent(vs: VoltageSource, c: number): void {
    this.currents[vs === this.voltSources[1] ? 0 : 1] = c;
  }

  override getVoltageDiff(): number {
    return this.volts[1] - this.volts[0];
  }
}

/** Test point: a labeled probe that measures (V, rms, peak, frequency, duty cycle…). */
export class TestPointElm extends CircuitElm {
  static override dumpType = 368;
  static readonly FLAG_LABEL = 1;
  static readonly meterNames = ["V", "V(rms)", "Vmax", "Vmin", "Peak to peak", "Binary", "Frequency", "Period", "Pulse width", "Duty cycle", "V(avg)"];
  static readonly TP_VOL = 0;
  static readonly TP_RMS = 1;
  static readonly TP_MAX = 2;
  static readonly TP_MIN = 3;
  static readonly TP_P2P = 4;
  static readonly TP_BIN = 5;
  static readonly TP_FRQ = 6;
  static readonly TP_PER = 7;
  static readonly TP_PWI = 8;
  static readonly TP_DUT = 9;
  static readonly TP_AVG = 10;
  meter = 0;
  label = "TP";
  zerocount = 0;
  rmsV = 0;
  total = 0;
  count = 0;
  avgV = 0;
  totalV = 0;
  maxV = 0;
  lastMaxV = 0;
  minV = 0;
  lastMinV = 0;
  frequency = 0;
  period = 0;
  binaryLevel = 0;
  pulseWidth = 0;
  dutyCycle = 0;
  selectedValue = 0;
  lastStepCount = 0;
  increasingV = true;
  decreasingV = true;
  started = false;
  periodStart = 0;
  periodLength = 0;
  pulseStart = 0;

  override initNew(): void {
    this.meter = TestPointElm.TP_VOL;
    this.label = "TP";
  }

  override readTokens(st: TokenStream): void {
    this.meter = st.nextInt();
    this.label = (this.flags & TestPointElm.FLAG_LABEL) !== 0 ? CircuitText.unescape(st.next()) : "TP";
  }

  override dumpValues(): string {
    if (this.label !== "TP") this.flags |= TestPointElm.FLAG_LABEL;
    return ` ${this.meter}${(this.flags & TestPointElm.FLAG_LABEL) !== 0 ? " " + CircuitText.escape(this.label) : ""}`;
  }
  override textLossless(): boolean {
    return false;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["me", String(this.meter)]);
    if (this.label !== "TP") a.push(["lb", this.label]);
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.meter = xml.int("me", this.meter);
    this.label = xml.string("lb", "TP") ?? "TP";
  }

  override getPostCount(): number {
    return 1;
  }
  override setPoints(): void {
    super.setPoints();
    this.lead1 = pt(0, 0);
  }

  override reset(): void {
    super.reset();
    this.zerocount = 0;
    this.rmsV = this.total = this.count = 0;
    this.avgV = this.totalV = 0;
    this.maxV = this.lastMaxV = 0;
    this.minV = this.lastMinV = 0;
    this.binaryLevel = 0;
    this.period = this.pulseWidth = this.dutyCycle = 0;
    this.selectedValue = 0;
    this.periodStart = this.periodLength = this.pulseStart = 0;
    this.increasingV = true;
    this.decreasingV = true;
    this.started = false;
    this.lastStepCount = 0;
  }

  override stepFinished(): void {
    const sim = this.sim;
    if (sim.timeStepCount === this.lastStepCount) return;
    this.lastStepCount = sim.timeStepCount;
    const v = this.volts[0];
    this.count++;
    this.total += v * v;
    this.totalV += v;
    this.binaryLevel = v < 2.5 ? 0 : 1;
    if (!this.started) {
      this.started = true;
      this.maxV = this.minV = v;
      this.increasingV = true;
      this.decreasingV = false;
      this.periodStart = this.pulseStart = sim.t;
    }
    if (v > this.maxV && this.increasingV) {
      this.maxV = v;
      this.increasingV = true;
      this.decreasingV = false;
    }
    if (v < this.maxV && this.increasingV) {
      // change of direction: now going down
      this.lastMaxV = this.maxV;
      this.periodLength = sim.t - this.periodStart;
      this.periodStart = sim.t;
      this.period = this.periodLength;
      this.pulseWidth = sim.t - this.pulseStart;
      this.dutyCycle = this.pulseWidth / this.periodLength;
      this.minV = v;
      this.increasingV = false;
      this.decreasingV = true;
      this.endCycle();
    }
    if (v < this.minV && this.decreasingV) {
      this.minV = v;
      this.increasingV = false;
      this.decreasingV = true;
    }
    if (v > this.minV && this.decreasingV) {
      // change of direction: now going up
      this.lastMinV = this.minV;
      this.pulseStart = sim.t;
      this.maxV = v;
      this.increasingV = true;
      this.decreasingV = false;
      this.endCycle();
    }
    if (v === 0) {
      this.zerocount++;
      if (this.zerocount > 5) {
        this.total = 0;
        this.rmsV = 0;
        this.avgV = 0;
        this.maxV = 0;
        this.minV = 0;
      }
    } else this.zerocount = 0;
    this.selectedValue = this.meterValue(this.meter);
  }

  private endCycle(): void {
    this.total = this.total / this.count;
    this.rmsV = Math.sqrt(this.total);
    if (Number.isNaN(this.rmsV)) this.rmsV = 0;
    this.avgV = this.totalV / this.count;
    if (Number.isNaN(this.avgV)) this.avgV = 0;
    this.count = 0;
    this.total = 0;
    this.totalV = 0;
  }

  meterValue(m: number): number {
    const T = TestPointElm;
    switch (m) {
      case T.TP_VOL: return this.volts[0];
      case T.TP_RMS: return this.rmsV;
      case T.TP_AVG: return this.avgV;
      case T.TP_MAX: return this.lastMaxV;
      case T.TP_MIN: return this.lastMinV;
      case T.TP_P2P: return this.lastMaxV - this.lastMinV;
      case T.TP_BIN: return this.binaryLevel;
      case T.TP_FRQ: return this.frequency;
      case T.TP_PER: return this.period;
      case T.TP_PWI: return this.pulseWidth;
      case T.TP_DUT: return this.dutyCycle;
    }
    return 0;
  }

  override getScopeValue(_x: number): number {
    return this.selectedValue;
  }
  override getVoltageDiff(): number {
    return this.volts[0];
  }
}

/** Pauses the simulation when its voltage crosses a level (after a delay / count / duration). */
export class StopTriggerElm extends CircuitElm {
  static override dumpType = 408;
  triggerVoltage = 1;
  type = 0;
  delay = 0;
  count = 1;
  requiredDuration = 0;
  triggered = false;
  stopped = false;
  conditionActive = false;
  durationMet = false;
  triggerTime = 0;
  conditionStartTime = 0;
  triggerCount = 0;

  override initNew(): void {
    this.triggerVoltage = 1;
    this.count = 1;
  }

  override readTokens(st: TokenStream): void {
    this.triggerVoltage = st.nextDouble();
    this.type = st.nextInt();
    this.delay = st.nextDouble();
    this.count = 1;
  }

  override dumpValues(): string {
    return ` ${this.triggerVoltage} ${this.type} ${this.delay}`;
  }
  override textLossless(): boolean {
    return this.count === 1 && this.requiredDuration === 0;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["tv", String(this.triggerVoltage)], ["tp", String(this.type)], ["dl", String(this.delay)], ["ct", String(this.count)],
      ["rd", String(this.requiredDuration)]);
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.triggerVoltage = xml.double("tv", this.triggerVoltage);
    this.type = xml.int("tp", this.type);
    this.delay = xml.double("dl", this.delay);
    this.count = Math.max(1, xml.int("ct", 1));
    this.requiredDuration = xml.double("rd", 0);
  }

  override reset(): void {
    this.triggered = false;
    this.conditionActive = false;
    this.durationMet = false;
    this.triggerCount = 0;
  }

  override getPostCount(): number {
    return 1;
  }
  override setPoints(): void {
    super.setPoints();
    this.lead1 = interpPoint(this.point1, this.point2, 1 - 8 / this.dn);
  }

  override stepFinished(): void {
    const sim = this.sim;
    this.stopped = false;
    const v = this.volts[0];
    const condition = (this.type === 0 && v >= this.triggerVoltage) || (this.type === 1 && v <= this.triggerVoltage);
    if (!this.conditionActive && condition) {
      this.conditionActive = true;
      this.conditionStartTime = sim.t;
      this.durationMet = false;
    }
    if (this.conditionActive && condition && !this.durationMet && sim.t - this.conditionStartTime >= this.requiredDuration) {
      this.durationMet = true;
      this.triggerCount++;
      if (!this.triggered && this.triggerCount >= this.count) {
        this.triggered = true;
        this.triggerTime = sim.t;
      }
    }
    if (this.conditionActive && !condition) this.conditionActive = false;
    if (this.triggered && sim.t >= this.triggerTime + this.delay) {
      this.triggered = false;
      this.triggerCount = 0;
      this.stopped = true;
      sim.simRunning = false;
    }
  }

  override getVoltageDiff(): number {
    return this.volts[0];
  }
}

/** Records its voltage each time step, for exporting. */
export class DataRecorderElm extends CircuitElm {
  static override dumpType = 210;
  dataCount = 0;
  dataPtr = 0;
  lastTimeStepCount = 0;
  data: Float64Array = new Float64Array(0);
  dataFull = false;

  override initNew(): void {
    this.setDataCount(10240);
  }

  override readTokens(st: TokenStream): void {
    this.setDataCount(st.nextInt());
  }

  override dumpValues(): string {
    return ` ${this.dataCount}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["dc", String(this.dataCount)]);
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.setDataCount(xml.int("dc", this.dataCount));
  }

  override getPostCount(): number {
    return 1;
  }

  override reset(): void {
    this.dataPtr = 0;
    this.dataFull = false;
    this.lastTimeStepCount = 0;
  }

  override setPoints(): void {
    super.setPoints();
    this.lead1 = interpPoint(this.point1, this.point2, 1 - 8 / this.dn);
  }

  override getVoltageDiff(): number {
    return this.volts[0];
  }

  override stepFinished(): void {
    if (this.lastTimeStepCount === this.sim.timeStepCount) return;
    this.data[this.dataPtr++] = this.volts[0];
    this.lastTimeStepCount = this.sim.timeStepCount;
    if (this.dataPtr >= this.dataCount) {
      this.dataPtr = 0;
      this.dataFull = true;
    }
  }

  setDataCount(ct: number): void {
    this.dataCount = ct;
    this.data = new Float64Array(ct);
    this.dataPtr = 0;
    this.dataFull = false;
  }

  /** The recording as text, oldest first (the export file). */
  exportText(timeStep: number): string {
    let s = `# time step = ${timeStep} sec\n`;
    if (this.dataFull) for (let i = 0; i !== this.dataCount; i++) s += this.data[(i + this.dataPtr) % this.dataCount] + "\n";
    else for (let i = 0; i !== this.dataPtr; i++) s += this.data[i] + "\n";
    return s;
  }
}
