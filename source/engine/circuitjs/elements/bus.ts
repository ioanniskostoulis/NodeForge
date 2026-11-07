// Ported from CircuitJS1 (BusSplitterElm.java, BusLogicInputElm.java, InstructionDisplayElm.java,
// SRAMElm.java, ROMElm.java) by Paul Falstad.
// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Licensed under the GNU General Public License v2 or later. See LICENSE.
//
// Parts that use buses: several bits on one post, told apart by the post's z coordinate.

import { CircuitElm, type XmlAttrs } from "../core/elm";
import { ExprParser, ExprState } from "../core/expr";
import { type GridPoint, pt } from "../core/geometry";
import type { VoltageSource } from "../core/nodes";
import { JavaNumber, type TokenStream, type XmlNode } from "../io/tokens";
import { SwitchElm } from "./basic";
import { ChipElm, Side } from "./chips";

/** Java's String.split (regex separator, trailing empty strings dropped). */
function javaSplit(s: string, re: RegExp): string[] {
  const parts = s.split(re);
  while (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
  if (parts.length === 1 && parts[0] === "" && s.length > 0) return [];
  return parts;
}

/** Integer.parseInt with a radix (throws on anything else). */
function parseIntRadix(s: string, radix: number): number {
  const ok = radix === 16 ? /^[+-]?[0-9a-fA-F]+$/ : radix === 2 ? /^[+-]?[01]+$/ : /^[+-]?\d+$/;
  if (!ok.test(s)) throw new Error(`bad number '${s}'`);
  return parseInt(s, radix);
}

/** Splits a bus into single wires (bus side on the left, one pin per bit on the right). */
export class BusSplitterElm extends ChipElm {
  static override dumpType = 433;
  static override get xmlTag(): string {
    return "bs";
  }
  currents: number[] = [];

  override chipName(): string {
    return "Bus Splitter";
  }
  override needsBits(): boolean {
    return true;
  }

  setupPins(): void {
    const bits = this.bits;
    this.sizeX = 2;
    this.sizeY = bits;
    this.currents = new Array<number>(bits).fill(0);
    this.pins = [];
    // bus side: all pins at the same position
    for (let i = 0; i !== bits; i++) {
      const p = (this.pins[i] = this.newPin(0, Side.W, "Bus"));
      p.busWidth = bits;
      p.busZ = i;
    }
    // individual side: one pin per bit
    for (let i = 0; i !== bits; i++) this.pins[i + bits] = this.newPin(bits - 1 - i, Side.E, String(i));
  }

  override getPostCount(): number {
    return this.bits * 2;
  }
  override getBusWidth(): number {
    return this.bits;
  }
  override getVoltageSourceCount(): number {
    return 0;
  }
  /** Bus pin i connects to individual pin i+bits. */
  override getConnection(n1: number, n2: number): boolean {
    return Math.abs(n1 - n2) === this.bits;
  }
  override isWireEquivalent(): boolean {
    return true;
  }
  override isRemovableWire(): boolean {
    return true;
  }
  override getConnectedPost(n = 0): GridPoint {
    return this.getPost(n + this.bits);
  }
  override busSide(): { post: GridPoint; width: number } {
    return { post: this.pins[0].post, width: this.bits };
  }
  override getCurrentIntoNode(n: number): number {
    if (n < this.bits) return -this.currents[n];
    return this.currents[n - this.bits];
  }
  override setWireCurrent(bit: number, c: number): void {
    this.currents[bit] = c;
    this.pins[bit + this.bits].current = c;
    // total bus current on pin 0 (the only bus-side pin that gets drawn)
    let total = 0;
    for (let i = 0; i < this.bits; i++) total += this.currents[i];
    this.pins[0].current = -total;
  }

  setBits(n: number): void {
    if (n < 2) return;
    this.bits = n;
    this.setupPins();
    this.allocNodes();
    this.setPoints();
  }
}

/** A clickable number driving a bus (each bit is a voltage source to ground). XML only. */
export class BusLogicInputElm extends SwitchElm {
  static override dumpType = 0;
  static override get xmlTag(): string {
    return "bli";
  }
  busWidth = 4;
  value = 0;
  hiV = 5;
  loV = 0;
  voltageSources: (VoltageSource | null)[] = [];
  currents: number[] = [];

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["bw", String(this.busWidth)]);
    if (this.value !== 0) a.push(["va", String(this.value)]);
    if (this.hiV !== 5) a.push(["hi", String(this.hiV)]);
    if (this.loV !== 0) a.push(["lo", String(this.loV)]);
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.busWidth = xml.int("bw", this.busWidth);
    this.value = xml.int("va", 0);
    this.hiV = xml.double("hi", this.hiV);
    this.loV = xml.double("lo", this.loV);
  }

  override textLossless(): boolean {
    return false;
  }

  override getPostCount(): number {
    return this.busWidth;
  }
  override getPostWidth(_n: number): number {
    return this.busWidth;
  }
  override getVoltageSourceCount(): number {
    return this.busWidth;
  }
  override getPost(n: number): GridPoint {
    return pt(this.x, this.y, n);
  }

  override setVoltageSource(n: number, v: VoltageSource): void {
    if (this.voltageSources.length !== this.busWidth) {
      this.voltageSources = new Array<VoltageSource | null>(this.busWidth).fill(null);
      this.currents = new Array<number>(this.busWidth).fill(0);
    }
    this.voltageSources[n] = v;
  }

  override setCurrent(vs: VoltageSource, c: number): void {
    for (let i = 0; i < this.busWidth; i++) {
      if (this.voltageSources[i] === vs) {
        this.currents[i] = this.current = c;
        break;
      }
    }
  }

  override getCurrentIntoNode(n: number): number {
    return this.currents[n] ?? 0;
  }

  override setPoints(): void {
    super.setPoints();
    this.lead1 = pt(0, 0);
  }

  override toggle(): void {
    this.value++;
    if (this.value >= 2 ** this.busWidth) this.value = 0;
  }

  override stamp(): void {
    for (let i = 0; i < this.busWidth; i++) {
      const v = (this.value & (1 << i)) !== 0 ? this.hiV : this.loV;
      this.sim.stampVoltageSource(this.sim.ground, this.nodes[i]!, this.voltageSources[i]!, v);
    }
  }

  override calculateCurrent(): void {}
  override hasGroundConnection(_n: number): boolean {
    return true;
  }
  override isWireEquivalent(): boolean {
    return false;
  }
  override isRemovableWire(): boolean {
    return false;
  }
}

/** One line of an instruction display's lookup table: a value range and its text template. */
class LookupEntry {
  constructor(public lo: number, public hi: number, public template: string) {}

  /** The text, with each {expression} evaluated (a = the input value). */
  getText(value: number): string {
    const t = this.template;
    let sb = "";
    let pos = 0;
    while (pos < t.length) {
      const open = t.indexOf("{", pos);
      if (open < 0) {
        sb += t.substring(pos);
        break;
      }
      sb += t.substring(pos, open);
      const close = t.indexOf("}", open);
      if (close < 0) {
        sb += t.substring(open);
        break;
      }
      const exprStr = t.substring(open + 1, close);
      const ep = new ExprParser(exprStr);
      const expr = ep.parseExpression();
      if (ep.gotError() === null) {
        const es = new ExprState(1);
        es.values[0] = value; // a = input value
        const result = expr.eval(es);
        sb += String(result === Math.trunc(result) ? Math.trunc(result) : result);
      } else sb += "{" + exprStr + "}";
      pos = close + 1;
    }
    return sb;
  }
}

/** Shows text for the value on a bus, from a lookup table ("0x2-0xF=other ({a})"). XML only. */
export class InstructionDisplayElm extends CircuitElm {
  static override get xmlTag(): string {
    return "ins";
  }
  busWidth = 4;
  threshold = 2.5;
  lookupText = "";
  entries: LookupEntry[] = [];

  override initNew(): void {
    this.lookupText = "0=text0\n1=text1\n0x2-0xF=other ({a})\n";
    this.parseEntries();
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["bw", String(this.busWidth)]);
    if (this.threshold !== 2.5) a.push(["th", String(this.threshold)]);
  }
  override xmlText(): string | null {
    return this.lookupText.length > 0 ? this.lookupText : null;
  }
  override textLossless(): boolean {
    return false;
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.busWidth = xml.int("bw", this.busWidth);
    this.threshold = xml.double("th", this.threshold);
    this.lookupText = xml.text;
    this.parseEntries();
  }

  override getPostCount(): number {
    return this.busWidth;
  }
  override getPostWidth(_n: number): number {
    return this.busWidth;
  }
  override getVoltageSourceCount(): number {
    return 0;
  }
  override getPost(n: number): GridPoint {
    return pt(this.x, this.y, n);
  }
  override setPoints(): void {
    super.setPoints();
    this.lead1 = pt(0, 0);
  }
  override getConnection(_n1: number, _n2: number): boolean {
    return false;
  }
  override getVoltageDiff(): number {
    return this.volts[0];
  }

  readInputValue(): number {
    let value = 0;
    for (let i = 0; i !== this.busWidth; i++) if (this.volts[i] > this.threshold) value |= 1 << i;
    return value;
  }

  getDisplayText(): string {
    const value = this.readInputValue();
    for (const entry of this.entries) if (value >= entry.lo && value <= entry.hi) return entry.getText(value);
    return String(value);
  }

  setLookupText(s: string): void {
    this.lookupText = s;
    this.parseEntries();
  }

  parseEntries(): void {
    this.entries = [];
    if (this.lookupText.length === 0) return;
    for (const raw of javaSplit(this.lookupText, /\n/)) {
      const line = raw.trim();
      if (line.length === 0) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.substring(0, eq).trim();
      const val = line.substring(eq + 1);
      try {
        const dash = InstructionDisplayElm.findDash(key);
        if (dash >= 0) {
          const lo = InstructionDisplayElm.parseNumber(key.substring(0, dash));
          const hi = InstructionDisplayElm.parseNumber(key.substring(dash + 1));
          this.entries.push(new LookupEntry(lo, hi, val));
        } else {
          const k = InstructionDisplayElm.parseNumber(key);
          this.entries.push(new LookupEntry(k, k, val));
        }
      } catch {
        // skip bad lines
      }
    }
  }

  private static findDash(s: string): number {
    const start = /^0[xXbB]/.test(s) ? 2 : 0;
    return s.indexOf("-", start);
  }

  private static parseNumber(str: string): number {
    const s = str.trim();
    if (s.startsWith("0x") || s.startsWith("0X")) return parseIntRadix(s.substring(2), 16);
    if (s.startsWith("0b") || s.startsWith("0B")) return parseIntRadix(s.substring(2), 2);
    return JavaNumber.parseInt(s);
  }
}

/** Static RAM: write enable, output enable, address and data pins. */
export class SRAMElm extends ChipElm {
  static override dumpType = 413;
  static readonly FLAG_RELOAD_ON_RESET = 2;
  static readonly FLAG_HEX_DISPLAY = 4;
  addressNodes = 0;
  dataNodes = 0;
  internalNodes = 0;
  addressBits = 0;
  dataBits = 0;
  map = new Map<number, number>();
  /** Initial contents, restored on reset (with FLAG_RELOAD_ON_RESET). */
  initialMap: Map<number, number> | null = null;
  address = 0;

  override initNew(): void {
    this.addressBits = this.dataBits = 4;
    this.map = new Map();
    super.initNew();
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.map = new Map();
    this.addressBits = st.nextInt();
    this.dataBits = st.nextInt();
    this.setupPins();
    // contents: addr val(addr) val(addr+1) ... -1 addr val val ... -1 ... -2
    try {
      for (;;) {
        let a = st.nextInt();
        if (a < 0) break;
        let v = st.nextInt();
        this.map.set(a, v);
        for (;;) {
          v = st.nextInt();
          if (v < 0) break;
          this.map.set(++a, v);
        }
      }
    } catch {
      // end of the contents
    }
    if ((this.flags & SRAMElm.FLAG_RELOAD_ON_RESET) !== 0) this.initialMap = new Map(this.map);
  }

  // upstream has no text writer for these parts; the fields are written so text files stay readable
  override dumpChipValues(): string {
    let s = ` ${this.addressBits} ${this.dataBits}`;
    const addrs = [...this.map.keys()].sort((a, b) => a - b);
    let last = -2;
    for (const a of addrs) {
      if (a !== last + 1) s += (last >= 0 ? " -1" : "") + ` ${a}`;
      s += ` ${this.map.get(a)}`;
      last = a;
    }
    if (last >= 0) s += " -1";
    return s + " -2";
  }
  override textLossless(): boolean {
    return false;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["ab", String(this.addressBits)], ["db", String(this.dataBits)]);
  }
  /** The contents are saved as state (the tag's text). */
  override xmlStateText(): string | null {
    return this.map.size > 0 ? this.contentsToString() : null;
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.addressBits = xml.int("ab", this.addressBits);
    this.dataBits = xml.int("db", this.dataBits);
    this.map = new Map();
    this.parseContentsString(xml.text);
    this.setupPins();
  }

  override reset(): void {
    super.reset();
    if ((this.flags & SRAMElm.FLAG_RELOAD_ON_RESET) !== 0 && this.initialMap !== null) this.map = new Map(this.initialMap);
  }

  override nonLinear(): boolean {
    return true;
  }
  override allowBus(): boolean {
    return true;
  }
  override chipName(): string {
    return "Static RAM";
  }

  setupPins(): void {
    this.sizeX = 2;
    const addrY = this.useBus() ? 1 : this.addressBits;
    const dataY = this.useBus() ? 1 : this.dataBits;
    this.sizeY = Math.max(addrY, dataY) + 1;
    this.bits = this.addressBits;
    this.pins = [];
    this.pins[0] = this.newPin(0, Side.W, "WE");
    this.pins[0].lineOver = true;
    this.pins[1] = this.newPin(0, Side.E, "OE");
    this.pins[1].lineOver = true;
    this.addressNodes = 2;
    this.dataNodes = 2 + this.addressBits;
    this.internalNodes = 2 + this.addressBits + this.dataBits;
    this.makeBitPins(this.addressBits, this.sizeY - addrY, Side.W, this.addressNodes, "A", false, false, true);
    this.makeBitPins(this.dataBits, this.sizeY - dataY, Side.E, this.dataNodes, "D", true, false, true);
    this.allocNodes();
  }

  override getPostCount(): number {
    return 2 + this.addressBits + this.dataBits;
  }

  contentsToString(): string {
    const hex = this.hasFlag(SRAMElm.FLAG_HEX_DISPLAY);
    let s = "";
    const maxI = 1 << this.addressBits;
    for (let i = 0; i < maxI; i++) {
      let val = this.map.get(i);
      if (val === undefined || val === 0) continue;
      s += (hex ? i.toString(16).toUpperCase() : String(i)) + ": " + (hex ? this.toHex(val) : String(val));
      let ct = 1;
      for (;;) {
        val = this.map.get(++i);
        if (val === undefined || val === 0) break;
        s += " " + (hex ? this.toHex(val) : String(val));
        if (++ct === 8) break;
      }
      s += "\n";
    }
    return s;
  }

  private toHex(val: number): string {
    const mask = (1 << this.dataBits) - 1;
    const h = ((val & mask) >>> 0).toString(16).toUpperCase();
    return h.length < 2 ? "0" + h : h;
  }

  parseContentsString(s: string): void {
    this.map.clear();
    for (const line of javaSplit(s, /\n/)) {
      try {
        const args = javaSplit(line, /: */);
        let addr = this.parseNumber(args[0]);
        for (const v of javaSplit(args[1], / +/)) this.map.set(addr++, this.parseNumber(v));
      } catch {
        // skip bad lines (values before the error are kept, as upstream)
      }
    }
  }

  private parseNumber(str: string): number {
    if (str === undefined) throw new Error("missing number");
    if (str.startsWith("0x")) return parseIntRadix(str.substring(2), 16);
    if (this.hasFlag(SRAMElm.FLAG_HEX_DISPLAY)) return parseIntRadix(str, 16);
    if (str.startsWith("0b")) return parseIntRadix(str.substring(2), 2);
    return JavaNumber.parseInt(str);
  }

  override getVoltageSourceCount(): number {
    return this.dataBits;
  }
  override getInternalNodeCount(): number {
    return this.dataBits;
  }

  override setVoltageSource(j: number, vs: VoltageSource): void {
    super.setVoltageSource(j, vs);
    vs.setNodes(this.sim.ground, this.nodes[this.internalNodes + j]!);
  }

  /** Each internal node connects to its data pin. */
  override getMatrixConnection(n1: number, n2: number): boolean {
    for (let i = 0; i !== this.dataBits; i++) {
      const a = this.internalNodes + i, b = this.dataNodes + i;
      if ((n1 === a && n2 === b) || (n1 === b && n2 === a)) return true;
    }
    return false;
  }

  override stamp(): void {
    for (let i = 0; i !== this.dataBits; i++) {
      const p = this.pins[i + this.dataNodes];
      this.sim.stampVoltageSource(this.sim.ground, this.nodes[this.internalNodes + i]!, p.voltSource!);
    }
  }

  /** Is the output enabled this step? */
  outputEnabled(): boolean {
    const writeEnabled = this.volts[0] < this.getThreshold();
    return this.volts[1] < this.getThreshold() && !writeEnabled;
  }

  override doStep(): void {
    const outputEnabled = this.outputEnabled();
    this.address = 0;
    for (let i = 0; i !== this.addressBits; i++)
      this.address |= this.volts[this.addressNodes + i] > this.getThreshold() ? 1 << (this.addressBits - 1 - i) : 0;
    this.driveData(outputEnabled);
  }

  /** Drive the data pins from the addressed word (through 1Ω when enabled, else 1e8Ω pulldowns). */
  protected driveData(outputEnabled: boolean): void {
    const data = this.map.get(this.address) ?? 0;
    const sim = this.sim;
    for (let i = 0; i !== this.dataBits; i++) {
      const p = this.pins[i + this.dataNodes];
      const internal = this.nodes[this.internalNodes + i]!, pin = this.nodes[this.dataNodes + i]!;
      sim.updateVoltageSource(sim.ground, internal, p.voltSource!, (data & (1 << (this.dataBits - 1 - i))) === 0 ? 0 : this.highVoltage);
      if (outputEnabled) sim.stampResistor(internal, pin, 1);
      else sim.stampResistor(pin, sim.ground, 1e8);
    }
  }

  override stepFinished(): void {
    const writeEnabled = this.volts[0] < this.getThreshold();
    if (!writeEnabled) return;
    let data = 0;
    for (let i = 0; i !== this.dataBits; i++) data |= this.volts[this.dataNodes + i] > this.getThreshold() ? 1 << (this.dataBits - 1 - i) : 0;
    this.map.set(this.address, data);
  }
}

/** Read-only memory: output enable, address and data pins. */
export class ROMElm extends SRAMElm {
  static override dumpType = 436;

  override chipName(): string {
    return "ROM";
  }

  // no WE pin; just OE + address + data
  override setupPins(): void {
    if (this.addressBits === 0) this.addressBits = this.dataBits = 4;
    this.sizeX = 2;
    const addrY = this.useBus() ? 1 : this.addressBits;
    const dataY = this.useBus() ? 1 : this.dataBits;
    this.sizeY = Math.max(addrY, dataY) + 1;
    this.bits = this.addressBits;
    this.pins = [];
    // OE (active low) at top-left
    this.pins[0] = this.newPin(0, Side.W, "OE");
    this.pins[0].lineOver = true;
    this.addressNodes = 1;
    this.dataNodes = 1 + this.addressBits;
    this.internalNodes = 1 + this.addressBits + this.dataBits;
    this.makeBitPins(this.addressBits, this.sizeY - addrY, Side.W, this.addressNodes, "A", false, false, true);
    this.makeBitPins(this.dataBits, this.sizeY - dataY, Side.E, this.dataNodes, "D", true, false, true);
    this.allocNodes();
  }

  override getPostCount(): number {
    return 1 + this.addressBits + this.dataBits;
  }

  override outputEnabled(): boolean {
    return this.volts[0] < this.getThreshold();
  }

  // no writing
  override stepFinished(): void {}
}
