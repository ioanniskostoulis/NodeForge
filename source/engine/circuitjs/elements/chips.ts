// Ported from CircuitJS1 (ChipElm.java and its digital / mixed-signal chips: DFlipFlopElm,
// JKFlipFlopElm, TFlipFlopElm, CounterElm, Counter2Elm, RingCounterElm, LatchElm, FullAdderElm,
// HalfAdderElm, MultiplexerElm, DeMultiplexerElm, SevenSegElm, SevenSegDecoderElm, DACElm, ADCElm,
// TimerElm, VCOElm, PhaseCompElm, MonostableElm, SipoShiftElm, PisoShiftElm, DecimalDisplayElm,
// SeqGenElm) by Paul Falstad, Iain Sharp and contributors.
// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { CircuitElm, type XmlAttrs } from "../core/elm";
import { validateRailNode } from "../core/findpath";
import { type GridPoint, pt } from "../core/geometry";
import type { CircuitNode, VoltageSource } from "../core/nodes";
import { JavaNumber, type TokenStream, type XmlNode } from "../io/tokens";
import { Diode, DiodeModel } from "./diode";

export const Side = { N: 0, S: 1, W: 2, E: 3 } as const;
const sideFlipXY = [Side.W, Side.E, Side.N, Side.S];

/** One pin of a chip: where it is on the outline, and its logic state. */
export class Pin {
  post: GridPoint = pt(0, 0);
  stub: GridPoint = pt(0, 0);
  textloc: GridPoint = pt(0, 0);
  side: number;
  side0: number;
  bubbleX = 0;
  bubbleY = 0;
  voltSource: VoltageSource | null = null;
  lineOver = false;
  bubble = false;
  clock = false;
  output = false;
  value = false;
  /** Saved with the circuit (outputs that hold state, like flip-flop Q). */
  state = false;
  curcount = 0;
  current = 0;
  busWidth = 1;
  busZ = 0;
  clockPoints: GridPoint[] | null = null;

  constructor(private readonly chip: ChipElm, public pos: number, s: number, public text: string) {
    this.side0 = this.side = s;
  }

  setPoint(px: number, py: number, dx: number, dy: number, dax: number, day: number, sx: number, sy: number): void {
    const c = this.chip;
    if (c.isFlippedX) {
      dx = -dx;
      dax = -dax;
      px += c.cspc2 * (c.flippedSizeX - 1);
      sx = -sx;
    }
    if (c.isFlippedY) {
      dy = -dy;
      day = -day;
      py += c.cspc2 * (c.flippedSizeY - 1);
      sy = -sy;
    }
    const xa = px + c.cspc2 * dx * this.pos + sx;
    const ya = py + c.cspc2 * dy * this.pos + sy;
    const physicalSide = day < 0 ? Side.N : day > 0 ? Side.S : dax < 0 ? Side.W : Side.E;
    const extension = c.leadExtensions[physicalSide] ?? 0;
    this.post = pt(xa + dax * (c.cspc2 + extension), ya + day * (c.cspc2 + extension), this.busZ);
    const busExtra = this.busWidth > 1 ? 2 : 0;
    this.stub = pt(xa + dax * (c.cspc + busExtra), ya + day * (c.cspc + busExtra));
    let tx = xa, ty = ya;
    if (this.bubble) {
      this.bubbleX = xa + dax * 10 * c.csize;
      this.bubbleY = ya + day * 10 * c.csize;
    }
    if (this.clock) {
      const half = Math.trunc(c.cspc / 2);
      const p0 = pt(xa + dax * c.cspc - dx * half, ya + day * c.cspc - dy * half);
      let p1 = pt(xa, ya);
      const p2 = pt(xa + dax * c.cspc + dx * half, ya + day * c.cspc + dy * half);
      if (this.text.length > 0) {
        p1 = pt(xa + dax * half, ya + day * half);
        tx -= dax * half;
        ty -= day * Math.trunc(c.cspc / 4);
      }
      this.clockPoints = [p0, p1, p2];
    } else this.clockPoints = null;
    this.textloc = pt(tx, ty);
  }
}

/** Pin.fixName: "/x" draws a line over the name, "#x" or "INV:" a bubble, "CLK:" or "clk" a clock. */
export function fixPinName(p: Pin): void {
  if (p.text.startsWith("/")) {
    p.text = p.text.substring(1);
    p.lineOver = true;
  } else if (p.text.startsWith("#")) {
    p.text = p.text.substring(1);
    p.bubble = true;
  }
  let result = p.text.replaceAll("CLK:", "");
  if (result.length !== p.text.length) {
    p.clock = true;
    p.text = result;
  }
  result = p.text.replaceAll("INV:", "");
  if (result.length !== p.text.length) {
    p.bubble = true;
    p.text = result;
  }
  if (p.text.toLowerCase() === "clk") {
    p.text = "";
    p.clock = true;
  }
}

/** Integrated circuits: a box with pins; outputs are voltage sources driven from ground. */
export abstract class ChipElm extends CircuitElm {
  static readonly FLAG_SMALL = 1;
  static readonly FLAG_FLIP_X = 1 << 10;
  static readonly FLAG_FLIP_Y = 1 << 11;
  static readonly FLAG_FLIP_XY = 1 << 12;
  static readonly FLAG_CUSTOM_VOLTAGE = 1 << 13;
  static readonly BIT_ORDER_MSB_FIRST = 0;
  static readonly BIT_ORDER_LSB_FIRST = 1;
  static readonly BIT_ORDER_BUS = 2;

  csize = 2;
  cspc = 16;
  cspc2 = 32;
  bits = 0;
  highVoltage = 5;
  bitOrder = 0;
  pins: Pin[] = [];
  /** Extra straight pin length by physical side (N, S, W, E). */
  leadExtensions = [0, 0, 0, 0];
  sizeX = 0;
  sizeY = 0;
  flippedSizeX = 0;
  flippedSizeY = 0;
  lastClock = false;
  /** Outline corners (x0, y0, x1, y1) and label center. */
  rect = { x: 0, y: 0, w: 0, h: 0 };
  labelX = 0;
  labelY = 0;

  needsBits(): boolean {
    return false;
  }
  get hasCustomVoltage(): boolean {
    return (this.flags & ChipElm.FLAG_CUSTOM_VOLTAGE) !== 0;
  }
  useBus(): boolean {
    return this.bitOrder === ChipElm.BIT_ORDER_BUS;
  }
  isDigitalChip(): boolean {
    return true;
  }
  getThreshold(): number {
    return this.highVoltage / 2;
  }
  defaultBitCount(): number {
    return 4;
  }
  allowBus(): boolean {
    return false;
  }
  get isFlippedX(): boolean {
    return this.hasFlag(ChipElm.FLAG_FLIP_X);
  }
  get isFlippedY(): boolean {
    return this.hasFlag(ChipElm.FLAG_FLIP_Y);
  }
  get isFlippedXY(): boolean {
    return this.hasFlag(ChipElm.FLAG_FLIP_XY);
  }

  /** Display name drawn in the box. */
  chipName(): string {
    return "";
  }

  abstract setupPins(): void;

  newPin(pos: number, side: number, text: string): Pin {
    return new Pin(this, pos, side, text);
  }

  override initNew(): void {
    if (this.needsBits()) this.bits = this.defaultBitCount();
    this.highVoltage = 5;
    this.noDiagonal = true;
    this.setupPins();
    this.setSize(2);
    this.allocNodes();
  }

  override readTokens(st: TokenStream): void {
    this.leadExtensions = [0, 0, 0, 0];
    if (this.needsBits()) this.bits = st.hasMoreTokens ? st.nextInt() : this.defaultBitCount();
    this.highVoltage = this.hasCustomVoltage ? st.nextDouble() : 5;
    this.noDiagonal = true;
    this.setupPins();
    this.setSize((this.flags & ChipElm.FLAG_SMALL) !== 0 ? 1 : 2);
    this.allocNodes();
    for (let i = 0; i !== this.getPostCount(); i++) {
      if (this.pins[i]?.state) {
        this.volts[i] = st.nextDouble();
        this.pins[i].value = this.volts[i] > this.getThreshold();
      }
    }
  }

  override undumpXml(xml: XmlNode): void {
    const stateRestore = xml.get("ix") !== undefined;
    // the flags might have been set by setSize() for a new element
    if (!stateRestore) this.flags = 0;
    super.undumpXml(xml);
    this.noDiagonal = true;
    this.bits = xml.int("bi", this.bits);
    this.highVoltage = xml.double("hv", this.highVoltage);
    this.bitOrder = xml.int("bo", this.bitOrder);
    this.leadExtensions = (xml.string("le", "") ?? "").split(",").map(Number);
    if (this.leadExtensions.length !== 4 || this.leadExtensions.some((v) => !Number.isFinite(v) || v < 0)) this.leadExtensions = [0, 0, 0, 0];
    if (!stateRestore) {
      this.setupPins();
      this.setSize((this.flags & ChipElm.FLAG_SMALL) !== 0 ? 1 : 2);
    }
    this.allocNodes();
    for (let i = 0; i !== this.getPostCount(); i++) {
      this.volts[i] = xml.double("v" + i, 0);
      if (this.pins[i]) this.pins[i].value = this.volts[i] > this.getThreshold();
    }
  }

  override dump(): string {
    if (this.highVoltage === 5) this.flags &= ~ChipElm.FLAG_CUSTOM_VOLTAGE;
    else this.flags |= ChipElm.FLAG_CUSTOM_VOLTAGE;
    return super.dump();
  }

  override dumpValues(): string {
    let s = "";
    if (this.needsBits()) s += " " + this.bits;
    if (this.hasCustomVoltage) s += " " + this.highVoltage;
    for (let i = 0; i !== this.getPostCount(); i++) if (this.pins[i].state) s += " " + this.volts[i];
    return s + this.dumpChipValues();
  }

  /** Text-format fields after the chip's own (subclasses). */
  dumpChipValues(): string {
    return "";
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    if (this.bits > 0) a.push(["bi", String(this.bits)]);
    if (this.highVoltage !== 5) a.push(["hv", String(this.highVoltage)]);
    if (this.bitOrder !== 0) a.push(["bo", String(this.bitOrder)]);
    if (this.leadExtensions.some((v) => v !== 0)) a.push(["le", this.leadExtensions.join(",")]);
  }

  override dumpXmlState(a: XmlAttrs): void {
    for (let i = 0; i !== this.getPostCount(); i++) if (this.pins[i].state && this.volts[i] > 0) a.push(["v" + i, String(this.volts[i])]);
  }

  override textLossless(): boolean {
    return this.bitOrder === 0 && this.leadExtensions.every((v) => v === 0);
  }

  setSize(s: number): void {
    this.csize = s;
    this.cspc = 8 * s;
    this.cspc2 = this.cspc * 2;
    this.flags &= ~ChipElm.FLAG_SMALL;
    this.flags |= s === 1 ? ChipElm.FLAG_SMALL : 0;
  }

  override setPoints(): void {
    super.setPoints();
    const x0 = this.x + this.cspc2, y0 = this.y;
    const xr = x0 - this.cspc, yr = y0 - this.cspc;
    this.flippedSizeX = this.sizeX;
    this.flippedSizeY = this.sizeY;
    if (this.isFlippedXY) {
      this.flippedSizeX = this.sizeY;
      this.flippedSizeY = this.sizeX;
    }
    const xs = this.flippedSizeX * this.cspc2, ys = this.flippedSizeY * this.cspc2;
    for (let i = 0; i !== this.getPostCount(); i++) {
      const p = this.pins[i];
      p.side = p.side0;
      if (this.isFlippedXY) p.side = sideFlipXY[p.side];
      switch (p.side) {
        case Side.N: p.setPoint(x0, y0, 1, 0, 0, -1, 0, 0); break;
        case Side.S: p.setPoint(x0, y0, 1, 0, 0, 1, 0, ys - this.cspc2); break;
        case Side.W: p.setPoint(x0, y0, 0, 1, -1, 0, 0, 0); break;
        case Side.E: p.setPoint(x0, y0, 0, 1, 1, 0, xs - this.cspc2, 0); break;
      }
    }
    this.rect = { x: xr, y: yr, w: xs, h: ys };
    this.labelX = xr + xs / 2;
    this.labelY = yr + ys / 2;
    this.boundingBox = { x: xr, y: yr, width: xs + 1, height: ys + 1 };
    this.includePinPosts();
  }

  override initBoundingBox(): void {
    super.initBoundingBox();
    if (!this.pins.length || this.cspc === 0) return;
    const xr = this.x + this.cspc2 - this.cspc, yr = this.y - this.cspc;
    const fsx = this.isFlippedXY ? this.sizeY : this.sizeX, fsy = this.isFlippedXY ? this.sizeX : this.sizeY;
    this.boundingBox = { x: xr, y: yr, width: fsx * this.cspc2 + 1, height: fsy * this.cspc2 + 1 };
    this.includePinPosts();
  }

  private includePinPosts(): void {
    if (!this.pins.length) return;
    const b = this.boundingBox;
    const x0 = Math.min(b.x, ...this.pins.map((p) => p.post.x));
    const y0 = Math.min(b.y, ...this.pins.map((p) => p.post.y));
    const x1 = Math.max(b.x + b.width - 1, ...this.pins.map((p) => p.post.x));
    const y1 = Math.max(b.y + b.height - 1, ...this.pins.map((p) => p.post.y));
    this.boundingBox = { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  }

  override getPost(n: number): GridPoint {
    return this.pins[n].post;
  }

  override getPostWidth(n: number): number {
    return this.pins[n].busWidth;
  }

  override setVoltageSource(j: number, vs: VoltageSource): void {
    for (let i = 0; i !== this.getPostCount(); i++) {
      const p = this.pins[i];
      if (p.output && j-- === 0) {
        p.voltSource = vs;
        vs.setNodes(this.sim.ground, this.nodes[i]!);
        return;
      }
    }
  }

  override stamp(): void {
    for (let i = 0; i !== this.getPostCount(); i++) {
      const p = this.pins[i];
      if (p.output) this.sim.stampVoltageSource(this.sim.ground, this.nodes[i]!, p.voltSource!);
    }
  }

  execute(): void {}

  override startIteration(): void {
    for (let i = 0; i !== this.getPostCount(); i++) {
      const p = this.pins[i];
      if (!p.output) p.value = this.volts[i] > this.getThreshold();
    }
    this.execute();
  }

  override doStep(): void {
    for (let i = 0; i !== this.getPostCount(); i++) {
      const p = this.pins[i];
      if (p.output) this.sim.updateVoltageSource(this.sim.ground, this.nodes[i]!, p.voltSource!, p.value ? this.highVoltage : 0);
    }
  }

  override reset(): void {
    for (let i = 0; i !== this.getPostCount(); i++) {
      this.pins[i].value = false;
      this.pins[i].curcount = 0;
      this.volts[i] = 0;
    }
    this.lastClock = false;
  }

  override setHighVoltage(hv: number): void {
    this.highVoltage = hv;
  }

  writeOutput(n: number, value: boolean): void {
    this.pins[n].value = value;
  }

  override setCurrent(vs: VoltageSource, c: number): void {
    for (let i = 0; i !== this.getPostCount(); i++) if (this.pins[i].output && this.pins[i].voltSource === vs) this.pins[i].current = c;
  }

  override validate(): boolean {
    for (let i = 0; i !== this.getPostCount(); i++) if (this.pins[i].output && !validateRailNode(this, i)) return false;
    return true;
  }

  override getConnection(_n1: number, _n2: number): boolean {
    return false;
  }
  override hasGroundConnection(n1: number): boolean {
    return this.pins[n1].output;
  }
  override getCurrentIntoNode(n: number): number {
    if (n < 0 || n >= this.pins.length) return 0;
    return this.pins[n].current;
  }

  /** Pins for a group of bits (CircuitJS's makeBitPins). */
  makeBitPins(count: number, pos: number, side: number, offset: number, name: string, output: boolean, state: boolean, reversed: boolean): void {
    for (let i = 0; i !== count; i++) {
      const ii = reversed ? offset + count - 1 - i : offset + i;
      let p: Pin;
      if (this.useBus()) {
        p = this.newPin(pos, side, name);
        p.busWidth = count;
        p.busZ = i;
      } else if (this.bitOrder === ChipElm.BIT_ORDER_LSB_FIRST) {
        p = this.newPin(pos + i, side, name + i);
      } else {
        p = this.newPin(pos + (count - 1 - i), side, name + i);
      }
      p.output = output;
      p.state = state;
      this.pins[ii] = p;
    }
  }
}

/** Bits packed into 32-bit integers (ChipElm.readBits / writeBits). */
function readBits(st: TokenStream, output: boolean[]): void {
  let integer = 0, bitIndex = Number.MAX_SAFE_INTEGER;
  for (let i = 0; i < output.length; i++) {
    if (bitIndex >= 32) {
      if (!st.hasMoreTokens) break;
      integer = st.nextInt();
      bitIndex = 0;
    }
    output[i] = (integer & (1 << bitIndex)) !== 0;
    bitIndex++;
  }
}

function writeBits(data: boolean[]): string {
  const words: number[] = [];
  let integer = 0, bitIndex = 0;
  for (const d of data) {
    if (bitIndex >= 32) {
      words.push(integer);
      integer = 0;
      bitIndex = 0;
    }
    if (d) integer |= 1 << bitIndex;
    bitIndex++;
  }
  words.push(integer);
  return words.join(" ");
}

function readBitsFromString(s: string, output: boolean[]): void {
  const words = s.trim().split(/\s+/).filter(Boolean);
  let w = 0, integer = 0, bitIndex = Number.MAX_SAFE_INTEGER;
  for (let i = 0; i < output.length; i++) {
    if (bitIndex >= 32) {
      if (w >= words.length) break;
      integer = JavaNumber.parseInt(words[w++]);
      bitIndex = 0;
    }
    output[i] = (integer & (1 << bitIndex)) !== 0;
    bitIndex++;
  }
}


export class DFlipFlopElm extends ChipElm {
  static override dumpType = 155;
  static readonly FLAG_RESET = 2;
  static readonly FLAG_SET = 4;
  static readonly FLAG_INVERT_SET_RESET = 8;
  justLoaded = false;

  hasReset(): boolean {
    return (this.flags & DFlipFlopElm.FLAG_RESET) !== 0 || this.hasSet();
  }
  hasSet(): boolean {
    return (this.flags & DFlipFlopElm.FLAG_SET) !== 0;
  }
  invertSetReset(): boolean {
    return (this.flags & DFlipFlopElm.FLAG_INVERT_SET_RESET) !== 0;
  }
  override chipName(): string {
    return "D flip-flop";
  }

  override initNew(): void {
    super.initNew();
    this.pins[2].value = !this.pins[1].value;
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.pins[2].value = !this.pins[1].value;
    this.justLoaded = true;
  }

  setupPins(): void {
    this.sizeX = 2;
    this.sizeY = 3;
    const pins = (this.pins = new Array<Pin>(this.getPostCount()));
    pins[0] = this.newPin(0, Side.W, "D");
    pins[1] = this.newPin(0, Side.E, "Q");
    pins[1].output = pins[1].state = true;
    pins[2] = this.newPin(this.hasSet() ? 1 : 2, Side.E, "Q");
    pins[2].output = true;
    pins[2].lineOver = true;
    pins[3] = this.newPin(1, Side.W, "");
    pins[3].clock = true;
    if (!this.hasSet()) {
      if (this.hasReset()) {
        pins[4] = this.newPin(2, Side.W, "R");
        pins[4].bubble = this.invertSetReset();
      }
    } else {
      pins[5] = this.newPin(2, Side.W, "S");
      pins[4] = this.newPin(2, Side.E, "R");
      pins[4].bubble = pins[5].bubble = this.invertSetReset();
    }
  }

  override getPostCount(): number {
    return 4 + (this.hasReset() ? 1 : 0) + (this.hasSet() ? 1 : 0);
  }
  override getVoltageSourceCount(): number {
    return 2;
  }

  override reset(): void {
    super.reset();
    this.volts[2] = this.highVoltage;
    this.pins[2].value = true;
  }

  override execute(): void {
    // if we just loaded then the volts[] array is likely to be all zeroes, which might force us
    // to do a reset, so defer execution until the next iteration
    if (this.justLoaded) {
      this.justLoaded = false;
      return;
    }
    const pins = this.pins;
    let isSet = false, isReset = false;
    if (this.hasSet() && pins[5].value !== this.invertSetReset()) isSet = true;
    if (this.hasReset() && pins[4].value !== this.invertSetReset()) isReset = true;
    if (isSet || isReset) {
      this.writeOutput(1, false);
      this.writeOutput(2, false);
      if (isSet) this.writeOutput(1, true);
      if (isReset) this.writeOutput(2, true);
    } else {
      if (pins[3].value && !this.lastClock) this.writeOutput(1, pins[0].value);
      this.writeOutput(2, !pins[1].value);
    }
    this.lastClock = pins[3].value;
  }
}

export class JKFlipFlopElm extends ChipElm {
  static override dumpType = 156;
  static readonly FLAG_RESET = 2;
  static readonly FLAG_POSITIVE_EDGE = 4;
  static readonly FLAG_INVERT_RESET = 8;
  justLoaded = false;

  hasReset(): boolean {
    return (this.flags & JKFlipFlopElm.FLAG_RESET) !== 0;
  }
  positiveEdgeTriggered(): boolean {
    return (this.flags & JKFlipFlopElm.FLAG_POSITIVE_EDGE) !== 0;
  }
  invertReset(): boolean {
    return (this.flags & JKFlipFlopElm.FLAG_INVERT_RESET) !== 0;
  }
  override chipName(): string {
    return "JK flip-flop";
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.pins[4].value = !this.pins[3].value;
    this.justLoaded = true;
  }

  setupPins(): void {
    this.sizeX = 2;
    this.sizeY = 3;
    const pins = (this.pins = new Array<Pin>(this.getPostCount()));
    pins[0] = this.newPin(0, Side.W, "J");
    pins[1] = this.newPin(1, Side.W, "");
    pins[1].clock = true;
    pins[1].bubble = !this.positiveEdgeTriggered();
    pins[2] = this.newPin(2, Side.W, "K");
    pins[3] = this.newPin(0, Side.E, "Q");
    pins[3].output = pins[3].state = true;
    pins[4] = this.newPin(2, Side.E, "Q");
    pins[4].output = true;
    pins[4].lineOver = true;
    if (this.hasReset()) {
      pins[5] = this.newPin(1, Side.E, "R");
      pins[5].bubble = this.invertReset();
    }
  }

  override getPostCount(): number {
    return 5 + (this.hasReset() ? 1 : 0);
  }
  override getVoltageSourceCount(): number {
    return 2;
  }

  override execute(): void {
    if (this.justLoaded) {
      this.justLoaded = false;
      return;
    }
    const pins = this.pins;
    const transition = this.positiveEdgeTriggered() ? pins[1].value && !this.lastClock : !pins[1].value && this.lastClock;
    if (transition) {
      let q = pins[3].value;
      if (pins[0].value) {
        if (pins[2].value) q = !q;
        else q = true;
      } else if (pins[2].value) q = false;
      this.writeOutput(3, q);
    }
    this.lastClock = pins[1].value;
    if (this.hasReset() && pins[5].value !== this.invertReset()) this.writeOutput(3, false);
    this.writeOutput(4, !pins[3].value);
  }
}

export class TFlipFlopElm extends ChipElm {
  static override dumpType = 193;
  static readonly FLAG_RESET = 2;
  static readonly FLAG_SET = 4;

  hasReset(): boolean {
    return (this.flags & TFlipFlopElm.FLAG_RESET) !== 0 || this.hasSet();
  }
  hasSet(): boolean {
    return (this.flags & TFlipFlopElm.FLAG_SET) !== 0;
  }
  override chipName(): string {
    return "T flip-flop";
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.pins[2].value = !this.pins[1].value;
  }

  setupPins(): void {
    this.sizeX = 2;
    this.sizeY = 3;
    const pins = (this.pins = new Array<Pin>(this.getPostCount()));
    pins[0] = this.newPin(0, Side.W, "T");
    pins[1] = this.newPin(0, Side.E, "Q");
    pins[1].output = pins[1].state = true;
    pins[2] = this.newPin(this.hasSet() ? 1 : 2, Side.E, "Q");
    pins[2].output = true;
    pins[2].lineOver = true;
    pins[3] = this.newPin(1, Side.W, "");
    pins[3].clock = true;
    if (!this.hasSet()) {
      if (this.hasReset()) pins[4] = this.newPin(2, Side.W, "R");
    } else {
      pins[5] = this.newPin(2, Side.W, "S");
      pins[4] = this.newPin(2, Side.E, "R");
    }
  }

  override getPostCount(): number {
    return 4 + (this.hasReset() ? 1 : 0) + (this.hasSet() ? 1 : 0);
  }
  override getVoltageSourceCount(): number {
    return 2;
  }

  override reset(): void {
    super.reset();
    this.volts[2] = this.highVoltage;
    this.pins[2].value = true;
  }

  override execute(): void {
    const pins = this.pins;
    if (pins[3].value && !this.lastClock && pins[0].value) pins[1].value = !pins[1].value;
    if (this.hasSet() && pins[5].value) pins[1].value = true;
    if (this.hasReset() && pins[4].value) pins[1].value = false;
    pins[2].value = !pins[1].value;
    this.lastClock = pins[3].value;
  }
}


export class CounterElm extends ChipElm {
  static override dumpType = 164;
  static override get xmlTag(): string {
    return "ctr";
  }
  static readonly FLAG_UP_DOWN = 4;
  static readonly FLAG_NEGATIVE_EDGE = 8;
  invertreset = false;
  modulus = 0;

  override needsBits(): boolean {
    return true;
  }
  override allowBus(): boolean {
    return true;
  }
  hasUpDown(): boolean {
    return (this.flags & CounterElm.FLAG_UP_DOWN) !== 0;
  }
  negativeEdgeTriggered(): boolean {
    return (this.flags & CounterElm.FLAG_NEGATIVE_EDGE) !== 0;
  }
  override chipName(): string {
    return "Counter";
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.invertreset = true;
    const t = st.hasMoreTokens ? st.next() : null;
    if (t !== null) {
      this.invertreset = JavaNumber.parseBool(t);
      this.modulus = st.tryInt() ?? 0;
    }
    this.pins[1].bubble = this.invertreset;
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.invertreset = xml.bool("in", this.invertreset);
    this.modulus = xml.int("mo", this.modulus);
    this.pins[1].bubble = this.invertreset;
  }

  override dumpChipValues(): string {
    return ` ${this.invertreset} ${this.modulus}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["in", String(this.invertreset)], ["mo", String(this.modulus)]);
  }

  setupPins(): void {
    this.sizeX = 2;
    this.sizeY = this.useBus() ? 3 : this.bits;
    const pins = (this.pins = new Array<Pin>(this.getPostCount()));
    pins[0] = this.newPin(0, Side.W, "");
    pins[0].clock = true;
    pins[0].bubble = this.negativeEdgeTriggered();
    pins[1] = this.newPin(this.sizeY - 1, Side.W, "R");
    pins[1].bubble = this.invertreset;
    this.makeBitPins(this.bits, 0, Side.E, 2, "Q", true, true, true);
    if (this.hasUpDown()) pins[this.bits + 2] = this.newPin(this.sizeY - 2, Side.W, "U/D");
    this.allocNodes();
  }

  override getPostCount(): number {
    return this.hasUpDown() ? this.bits + 3 : this.bits + 2;
  }
  override getVoltageSourceCount(): number {
    return this.bits;
  }

  override execute(): void {
    const pins = this.pins, bits = this.bits;
    const neg = this.negativeEdgeTriggered();
    if (pins[0].value !== neg && this.lastClock === neg) {
      let value = 0;
      const dir = this.hasUpDown() && pins[bits + 2].value ? -1 : 1;
      const lastBit = 2 + bits - 1;
      for (let i = 0; i !== bits; i++) if (pins[lastBit - i].value) value |= 1 << i;
      value += dir;
      if (this.modulus !== 0) value = (value + this.modulus) % this.modulus;
      for (let i = 0; i !== bits; i++) pins[lastBit - i].value = (value & (1 << i)) !== 0;
    }
    if (!pins[1].value === this.invertreset) for (let i = 0; i !== bits; i++) pins[i + 2].value = false;
    this.lastClock = pins[0].value;
  }
}

/** 74x163-style synchronous counter with load, enables and ripple carry. */
export class Counter2Elm extends ChipElm {
  static override dumpType = 421;
  static override get xmlTag(): string {
    return "ctr2";
  }
  modulus = 0;
  clk = 0;
  clr = 0;
  enp = 0;
  ent = 0;
  rco = 0;
  load = 0;
  carry = false;

  override needsBits(): boolean {
    return true;
  }
  override allowBus(): boolean {
    return true;
  }
  override chipName(): string {
    return "Counter";
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.modulus = st.tryInt() ?? this.modulus;
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.modulus = xml.int("mo", this.modulus);
    this.pins[this.clr].value = true;
    this.volts[this.clr] = this.highVoltage;
  }

  override dumpChipValues(): string {
    return ` ${this.modulus}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["mo", String(this.modulus)]);
  }

  setupPins(): void {
    this.sizeX = 2;
    const bitsY = this.useBus() ? 1 : this.bits;
    this.sizeY = bitsY + 3;
    const pins = (this.pins = new Array<Pin>(this.getPostCount()));
    this.makeBitPins(this.bits, 1, Side.E, 0, "Q", true, true, true);
    this.makeBitPins(this.bits, 1, Side.W, this.bits, "I", false, false, true);
    const p = this.bits * 2;
    this.clk = p;
    this.clr = p + 1;
    this.enp = p + 2;
    this.rco = p + 3;
    this.load = p + 4;
    this.ent = p + 5;
    pins[this.clk] = this.newPin(0, Side.W, "");
    pins[this.clk].clock = true;
    pins[this.clr] = this.newPin(bitsY + 1, Side.W, "CLR");
    pins[this.clr].bubble = true;
    pins[this.enp] = this.newPin(bitsY + 2, Side.W, "EnP");
    pins[this.rco] = this.newPin(0, Side.E, "RCO");
    pins[this.rco].output = true;
    pins[this.load] = this.newPin(bitsY + 1, Side.E, "LOAD");
    pins[this.load].bubble = true;
    pins[this.ent] = this.newPin(bitsY + 2, Side.E, "EnT");
  }

  override getPostCount(): number {
    return this.bits * 2 + 6;
  }
  override getVoltageSourceCount(): number {
    return this.bits + 1;
  }

  override execute(): void {
    const pins = this.pins, bits = this.bits;
    const lastBit = bits - 1;
    const realmod = this.modulus === 0 ? 1 << bits : this.modulus;
    if (pins[this.clk].value && !this.lastClock) {
      if (pins[this.enp].value && pins[this.ent].value) {
        let value = 0;
        for (let i = 0; i !== bits; i++) if (pins[lastBit - i].value) value |= 1 << i;
        value++;
        value %= realmod;
        for (let i = 0; i !== bits; i++) this.writeOutput(lastBit - i, (value & (1 << i)) !== 0);
        this.carry = value === realmod - 1;
      }
      if (!pins[this.load].value) {
        for (let i = 0; i !== bits; i++) this.writeOutput(i, pins[i + bits].value);
        let value = 0;
        for (let i = 0; i !== bits; i++) if (pins[lastBit - i].value) value |= 1 << i;
        this.carry = value === realmod - 1;
      }
    }
    if (!pins[this.clr].value) {
      for (let i = 0; i !== bits; i++) this.writeOutput(i, false);
      this.carry = false;
    }
    this.lastClock = pins[this.clk].value;
    this.writeOutput(this.rco, this.carry && pins[this.ent].value);
  }
}

/** Decade / ring counter (CD4017-style). */
export class RingCounterElm extends ChipElm {
  static override dumpType = 163;
  static readonly FLAG_CLOCK_INHIBIT = 2;
  static readonly FLAG_RESET_HIGH = 4;
  justLoaded = false;
  clockInhibit = -1;

  override needsBits(): boolean {
    return true;
  }
  override defaultBitCount(): number {
    return 10;
  }
  hasClockInhibit(): boolean {
    return (this.flags & RingCounterElm.FLAG_CLOCK_INHIBIT) !== 0 && this.bits >= 3;
  }
  hasInvertReset(): boolean {
    return (this.flags & RingCounterElm.FLAG_RESET_HIGH) === 0;
  }
  override chipName(): string {
    return "Ring Counter";
  }

  override initNew(): void {
    super.initNew();
    this.flags |= RingCounterElm.FLAG_CLOCK_INHIBIT;
    this.setupPins();
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.justLoaded = true;
  }

  setupPins(): void {
    this.sizeX = this.bits > 2 ? this.bits : 2;
    this.sizeY = 2;
    const pins = (this.pins = new Array<Pin>(this.getPostCount()));
    pins[0] = this.newPin(1, Side.W, "");
    pins[0].clock = true;
    pins[1] = this.newPin(this.sizeX - 1, Side.S, "R");
    pins[1].lineOver = this.hasInvertReset();
    for (let i = 0; i !== this.bits; i++) {
      const ii = i + 2;
      pins[ii] = this.newPin(i, Side.N, "Q" + i);
      pins[ii].output = pins[ii].state = true;
    }
    if (this.hasClockInhibit()) {
      this.clockInhibit = pins.length - 1;
      pins[this.clockInhibit] = this.newPin(1, Side.S, "CE");
      pins[this.clockInhibit].lineOver = true;
    } else this.clockInhibit = -1;
    this.allocNodes();
  }

  override getPostCount(): number {
    return this.hasClockInhibit() ? this.bits + 3 : this.bits + 2;
  }
  override getVoltageSourceCount(): number {
    return this.bits;
  }

  override execute(): void {
    if (this.justLoaded) {
      this.justLoaded = false;
      return;
    }
    const pins = this.pins, bits = this.bits;
    let running = true;
    if (this.hasClockInhibit() && pins[this.clockInhibit].value) running = false;
    let i: number;
    for (i = 0; i !== bits; i++) if (pins[i + 2].value) break;
    if (pins[0].value && !this.lastClock && running) {
      if (i < bits) pins[i++ + 2].value = false;
      i %= bits;
      pins[i + 2].value = true;
    }
    if (pins[1].value !== this.hasInvertReset() || i === bits) {
      for (i = 1; i !== bits; i++) pins[i + 2].value = false;
      pins[2].value = true;
    }
    this.lastClock = pins[0].value;
  }
}


export class LatchElm extends ChipElm {
  static override dumpType = 168;
  static readonly FLAG_STATE = 2;
  static readonly FLAG_NO_EDGE = 4;
  static readonly FLAG_RESET = 8;
  static readonly FLAG_SET = 16;
  static readonly FLAG_ENABLE_MASK = 32 | 64;
  static readonly FLAG_ENABLE_SHIFT = 5;
  static readonly FLAG_RESET_INVERT = 128;
  loadPin = 0;
  resetPin = 0;
  setPin = 0;
  ie1Pin = 0;
  ie2Pin = 0;
  oe1Pin = 0;
  oe2Pin = 0;
  intNodes = 0;
  vSources: VoltageSource[] = [];
  lastLoad = false;
  outputValues: boolean[] | null = null;

  hasReset(): boolean {
    return (this.flags & LatchElm.FLAG_RESET) !== 0;
  }
  hasSet(): boolean {
    return (this.flags & LatchElm.FLAG_SET) !== 0;
  }
  resetActiveLow(): boolean {
    return (this.flags & LatchElm.FLAG_RESET_INVERT) !== 0;
  }
  enableMode(): number {
    return (this.flags & LatchElm.FLAG_ENABLE_MASK) >> LatchElm.FLAG_ENABLE_SHIFT;
  }
  hasOutputEnable(): boolean {
    return this.enableMode() > 0;
  }
  isEdgeTriggered(): boolean {
    return (this.flags & LatchElm.FLAG_NO_EDGE) === 0;
  }
  override needsBits(): boolean {
    return true;
  }
  override allowBus(): boolean {
    return true;
  }
  override nonLinear(): boolean {
    return this.hasOutputEnable();
  }
  override chipName(): string {
    return "Latch";
  }

  override initNew(): void {
    super.initNew();
    this.flags |= LatchElm.FLAG_STATE;
    this.setupPins();
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    if ((this.flags & LatchElm.FLAG_STATE) === 0) {
      this.flags |= LatchElm.FLAG_STATE;
      this.setupPins();
    }
    this.restoreOutputValues();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.restoreOutputValues();
  }

  setupPins(): void {
    this.sizeX = 2;
    const ieCount = this.enableMode(), oeCount = this.enableMode();
    const extraLeftPins = (this.hasReset() ? 1 : 0) + (this.hasSet() ? 1 : 0) + ieCount;
    const bitsY = this.useBus() ? 1 : this.bits;
    this.sizeY = Math.max(bitsY + 1 + extraLeftPins, bitsY + oeCount);
    const pins = (this.pins = new Array<Pin>(this.getPostCount()));
    this.makeBitPins(this.bits, 0, Side.W, 0, "I", false, false, false);
    this.makeBitPins(this.bits, 0, Side.E, this.bits, "O", !this.hasOutputEnable(), (this.flags & LatchElm.FLAG_STATE) !== 0, false);
    let pinIndex = this.bits * 2;
    let leftPos = bitsY;
    pins[(this.loadPin = pinIndex++)] = this.newPin(leftPos++, Side.W, this.isEdgeTriggered() ? "" : "Ld");
    pins[this.loadPin].clock = this.isEdgeTriggered();
    if (this.hasReset()) {
      pins[(this.resetPin = pinIndex++)] = this.newPin(leftPos++, Side.W, "R");
      pins[this.resetPin].lineOver = this.resetActiveLow();
    }
    if (this.hasSet()) pins[(this.setPin = pinIndex++)] = this.newPin(leftPos++, Side.W, "S");
    let rightPos = leftPos;
    if (ieCount >= 1) {
      pins[(this.ie1Pin = pinIndex++)] = this.newPin(leftPos++, Side.W, "IE");
      pins[this.ie1Pin].lineOver = true;
    }
    if (ieCount >= 2) {
      pins[(this.ie2Pin = pinIndex++)] = this.newPin(leftPos++, Side.W, "IE");
      pins[this.ie2Pin].lineOver = true;
    }
    if (oeCount >= 1) {
      pins[(this.oe1Pin = pinIndex++)] = this.newPin(rightPos++, Side.E, "OE");
      pins[this.oe1Pin].lineOver = true;
    }
    if (oeCount >= 2) {
      pins[(this.oe2Pin = pinIndex++)] = this.newPin(rightPos++, Side.E, "OE");
      pins[this.oe2Pin].lineOver = true;
    }
    this.intNodes = pinIndex;
    this.allocNodes();
  }

  lastOutputValues(): boolean[] {
    this.outputValues ??= new Array<boolean>(this.bits).fill(false);
    return this.outputValues;
  }

  restoreOutputValues(): void {
    const ov = this.lastOutputValues();
    for (let i = 0; i !== this.bits; i++) ov[i] = this.pins[i + this.bits].value;
  }

  override reset(): void {
    super.reset();
    this.outputValues = null;
  }

  override execute(): void {
    this.doLoad();
    for (let i = 0; i !== this.bits; i++) this.pins[i + this.bits].value = this.lastOutputValues()[i];
  }

  doLoad(): void {
    const pins = this.pins, ov = this.lastOutputValues();
    if (this.hasSet() && pins[this.setPin].value) {
      ov.fill(true);
      this.lastLoad = pins[this.loadPin].value;
      return;
    }
    if (this.hasReset() && pins[this.resetPin].value !== this.resetActiveLow()) {
      ov.fill(false);
      this.lastLoad = pins[this.loadPin].value;
      return;
    }
    let inputEnabled = true;
    if (this.enableMode() >= 1 && pins[this.ie1Pin].value) inputEnabled = false;
    if (this.enableMode() >= 2 && pins[this.ie2Pin].value) inputEnabled = false;
    if (inputEnabled && pins[this.loadPin].value && (!this.isEdgeTriggered() || !this.lastLoad)) for (let i = 0; i !== this.bits; i++) ov[i] = pins[i].value;
    this.lastLoad = pins[this.loadPin].value;
  }

  override startIteration(): void {
    if (!this.hasOutputEnable()) return super.startIteration();
    for (let i = 0; i < this.getPostCount(); i++) {
      const p = this.pins[i];
      if (!p.output) p.value = this.volts[i] > this.getThreshold();
    }
    this.doLoad();
  }

  override doStep(): void {
    if (!this.hasOutputEnable()) return super.doStep();
    const pins = this.pins, sim = this.sim;
    let outputEnabled = true;
    if (this.enableMode() >= 1 && pins[this.oe1Pin].value) outputEnabled = false;
    if (this.enableMode() >= 2 && pins[this.oe2Pin].value) outputEnabled = false;
    for (let i = 0; i < this.bits; i++) {
      const v = this.lastOutputValues()[i] ? this.highVoltage : 0;
      sim.updateVoltageSource(sim.ground, this.nodes[this.intNodes + i]!, this.vSources[i], v);
      if (outputEnabled) sim.stampResistor(this.nodes[this.intNodes + i]!, this.nodes[this.bits + i]!, 1);
      else sim.stampResistor(this.nodes[this.bits + i]!, sim.ground, 1e8);
    }
  }

  override stamp(): void {
    if (!this.hasOutputEnable()) return super.stamp();
    for (let i = 0; i < this.bits; i++) this.sim.stampVoltageSource(this.sim.ground, this.nodes[this.intNodes + i]!, this.vSources[i]);
  }

  override getVoltageSourceCount(): number {
    return this.bits;
  }
  override getInternalNodeCount(): number {
    return this.hasOutputEnable() ? this.bits : 0;
  }

  override setVoltageSource(j: number, vs: VoltageSource): void {
    if (this.hasOutputEnable()) {
      this.vSources[j] = vs;
      vs.setNodes(this.sim.ground, this.nodes[this.intNodes + j]!);
    } else super.setVoltageSource(j, vs);
  }

  override getMatrixConnection(n1: number, n2: number): boolean {
    if (this.hasOutputEnable()) {
      for (let i = 0; i < this.bits; i++) {
        const a = this.intNodes + i, b = this.bits + i;
        if ((n1 === a && n2 === b) || (n1 === b && n2 === a)) return true;
      }
    }
    return false;
  }

  override hasGroundConnection(n1: number): boolean {
    if (this.hasOutputEnable()) return n1 >= this.bits && n1 < this.bits * 2;
    return this.pins[n1].output;
  }

  override getPostCount(): number {
    return this.bits * 2 + 1 + (this.hasReset() ? 1 : 0) + (this.hasSet() ? 1 : 0) + this.enableMode() * 2;
  }
}

export class FullAdderElm extends ChipElm {
  static override dumpType = 196;
  static readonly FLAG_BITS = 2;
  carryIn = 0;
  carryOut = 0;

  override needsBits(): boolean {
    return (this.flags & FullAdderElm.FLAG_BITS) !== 0;
  }
  override allowBus(): boolean {
    return this.needsBits();
  }
  override chipName(): string {
    return "Adder";
  }

  override initNew(): void {
    this.flags |= FullAdderElm.FLAG_BITS;
    super.initNew();
    this.bits = 4;
    this.setupPins();
    this.allocNodes();
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    if (!this.needsBits()) this.bits = 1;
    this.setupPins();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    if (!this.needsBits()) {
      this.bits = 1;
      this.setupPins();
    }
  }

  setupPins(): void {
    if (!this.needsBits() && this.bits === 0) this.bits = 1;
    this.sizeX = 2;
    const bitsY = this.useBus() ? 1 : this.bits;
    this.sizeY = bitsY * 2 + 1;
    const pins = (this.pins = new Array<Pin>(this.getPostCount()));
    this.makeBitPins(this.bits, 0, Side.W, 0, "A", false, false, false);
    this.makeBitPins(this.bits, bitsY, Side.W, this.bits, "B", false, false, false);
    this.makeBitPins(this.bits, 2, Side.E, this.bits * 2, "S", true, false, false);
    this.carryIn = this.bits * 3;
    this.carryOut = this.bits * 3 + 1;
    pins[this.carryOut] = this.newPin(0, Side.E, "C");
    pins[this.carryOut].output = true;
    pins[this.carryIn] = this.newPin(bitsY * 2, Side.W, "Cin");
    this.allocNodes();
  }

  override getPostCount(): number {
    return this.bits * 3 + 2;
  }
  override getVoltageSourceCount(): number {
    return this.bits + 1;
  }

  override execute(): void {
    let c = this.pins[this.carryIn].value ? 1 : 0;
    for (let i = 0; i !== this.bits; i++) {
      const v = (this.pins[i].value ? 1 : 0) + (this.pins[i + this.bits].value ? 1 : 0) + c;
      c = v > 1 ? 1 : 0;
      this.writeOutput(i + this.bits * 2, (v & 1) === 1);
    }
    this.writeOutput(this.carryOut, c === 1);
  }
}

export class HalfAdderElm extends ChipElm {
  static override dumpType = 195;
  override chipName(): string {
    return "Half Adder";
  }
  setupPins(): void {
    this.sizeX = 2;
    this.sizeY = 2;
    const pins = (this.pins = new Array<Pin>(4));
    pins[0] = this.newPin(0, Side.E, "S");
    pins[0].output = true;
    pins[1] = this.newPin(1, Side.E, "C");
    pins[1].output = true;
    pins[2] = this.newPin(0, Side.W, "A");
    pins[3] = this.newPin(1, Side.W, "B");
  }
  override getPostCount(): number {
    return 4;
  }
  override getVoltageSourceCount(): number {
    return 2;
  }
  override execute(): void {
    const p = this.pins;
    p[0].value = p[2].value !== p[3].value;
    p[1].value = p[2].value && p[3].value;
  }
}

export class MultiplexerElm extends ChipElm {
  static override dumpType = 184;
  static override get xmlTag(): string {
    return "mux";
  }
  static readonly FLAG_INVERTED_OUTPUT = 1 << 1;
  static readonly FLAG_STROBE = 1 << 2;
  static readonly FLAG_BUS_SELECT = 1 << 3;
  selectBitCount = 2;
  outputCount = 4;
  inputMode = 0;
  dataBusWidth = 4;
  strobe = -1;
  outputPin = 0;
  selectPin = 0;

  busSelect(): boolean {
    return this.hasFlag(MultiplexerElm.FLAG_BUS_SELECT);
  }
  override chipName(): string {
    return "Multiplexer";
  }

  override initNew(): void {
    this.selectBitCount = 2;
    super.initNew();
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.selectBitCount = st.tryInt() ?? 2;
    this.setupPins();
    this.allocNodes();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.selectBitCount = xml.int("se", this.selectBitCount);
    this.inputMode = xml.int("im", 0);
    this.dataBusWidth = xml.int("dw", 4);
    this.setupPins();
    this.allocNodes();
  }

  override dumpChipValues(): string {
    return ` ${this.selectBitCount}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["se", String(this.selectBitCount)]);
    if (this.inputMode !== 0) a.push(["im", String(this.inputMode)]);
    if (this.dataBusWidth !== 4) a.push(["dw", String(this.dataBusWidth)]);
  }

  override textLossless(): boolean {
    return super.textLossless() && this.inputMode === 0;
  }

  private selectPins(start: number): void {
    for (let i = 0; i < this.selectBitCount; i++) {
      const n = start + i;
      if (this.busSelect()) {
        this.pins[n] = this.newPin(0, Side.S, "S");
        this.pins[n].busWidth = this.selectBitCount;
        this.pins[n].busZ = i;
      } else this.pins[n] = this.newPin(i + 1, Side.S, "S" + i);
    }
  }

  setupPins(): void {
    this.outputCount = 1 << this.selectBitCount;
    const inv = this.hasFlag(MultiplexerElm.FLAG_INVERTED_OUTPUT), str = this.hasFlag(MultiplexerElm.FLAG_STROBE);
    this.pins = new Array<Pin>(this.getPostCount());
    const pins = this.pins;
    if (this.inputMode === 2) {
      const dw = this.dataBusWidth, inputPinCount = this.outputCount * dw;
      this.sizeX = this.selectBitCount + 1;
      this.sizeY = this.outputCount + 1;
      for (let g = 0; g < this.outputCount; g++) {
        for (let i = 0; i < dw; i++) {
          const n = g * dw + i;
          pins[n] = this.newPin(g, Side.W, "I" + g);
          pins[n].busWidth = dw;
          pins[n].busZ = i;
        }
      }
      this.selectPin = inputPinCount;
      this.selectPins(this.selectPin);
      this.outputPin = this.selectPin + this.selectBitCount;
      for (let i = 0; i < dw; i++) {
        const n = this.outputPin + i;
        pins[n] = this.newPin(0, Side.E, "Q");
        pins[n].output = true;
        pins[n].busWidth = dw;
        pins[n].busZ = i;
      }
      if (inv) {
        for (let i = 0; i < dw; i++) {
          const n = this.outputPin + dw + i;
          pins[n] = this.newPin(1, Side.E, "Q");
          pins[n].lineOver = true;
          pins[n].output = true;
          pins[n].bubble = i === 0;
          pins[n].busWidth = dw;
          pins[n].busZ = i;
        }
      }
      if (str) {
        const n = this.outputPin + dw + (inv ? dw : 0);
        pins[n] = this.newPin(0, Side.S, "STR");
        this.strobe = n;
      } else this.strobe = -1;
    } else {
      this.sizeX = this.selectBitCount + 1;
      this.sizeY = this.inputMode === 1 ? 3 : this.outputCount + 1;
      for (let i = 0; i < this.outputCount; i++) {
        if (this.inputMode === 1) {
          pins[i] = this.newPin(0, Side.W, "I");
          pins[i].busWidth = this.outputCount;
          pins[i].busZ = i;
        } else pins[i] = this.newPin(i, Side.W, "I" + i);
      }
      this.selectPin = this.outputCount;
      this.selectPins(this.selectPin);
      let n = this.selectPin + this.selectBitCount;
      pins[n] = this.newPin(0, Side.E, "Q");
      pins[n].output = true;
      this.outputPin = n;
      if (inv) {
        n++;
        pins[n] = this.newPin(1, Side.E, "Q");
        pins[n].lineOver = true;
        pins[n].output = true;
        pins[n].bubble = true;
      }
      if (str) {
        n++;
        pins[n] = this.newPin(0, Side.S, "STR");
        this.strobe = n;
      } else this.strobe = -1;
    }
    this.allocNodes();
  }

  override getPostCount(): number {
    const inv = this.hasFlag(MultiplexerElm.FLAG_INVERTED_OUTPUT), str = this.hasFlag(MultiplexerElm.FLAG_STROBE) ? 1 : 0;
    const oc = 1 << this.selectBitCount;
    if (this.inputMode === 2) return oc * this.dataBusWidth + this.selectBitCount + this.dataBusWidth + (inv ? this.dataBusWidth : 0) + str;
    return oc + this.selectBitCount + 1 + (inv ? 1 : 0) + str;
  }

  override getVoltageSourceCount(): number {
    const inv = this.hasFlag(MultiplexerElm.FLAG_INVERTED_OUTPUT);
    if (this.inputMode === 2) return this.dataBusWidth * (inv ? 2 : 1);
    return inv ? 2 : 1;
  }

  override execute(): void {
    let sel = 0;
    for (let i = 0; i < this.selectBitCount; i++) if (this.pins[this.selectPin + i].value) sel |= 1 << i;
    const pins = this.pins, strobed = this.strobe !== -1 && pins[this.strobe].value;
    if (this.inputMode === 2) {
      const dw = this.dataBusWidth;
      for (let i = 0; i < dw; i++) pins[this.outputPin + i].value = strobed ? false : pins[sel * dw + i].value;
      if (this.hasFlag(MultiplexerElm.FLAG_INVERTED_OUTPUT)) for (let i = 0; i < dw; i++) pins[this.outputPin + dw + i].value = !pins[this.outputPin + i].value;
    } else {
      let val = pins[sel].value;
      if (strobed) val = false;
      pins[this.outputPin].value = val;
      if (this.hasFlag(MultiplexerElm.FLAG_INVERTED_OUTPUT)) pins[this.outputPin + 1].value = !val;
    }
  }
}

export class DeMultiplexerElm extends ChipElm {
  static override dumpType = 185;
  static override get xmlTag(): string {
    return "dmux";
  }
  static readonly FLAG_BUS_SELECT = 1 << 3;
  static readonly FLAG_INVERT_OUTPUTS = 1 << 4;
  selectBitCount = 0;
  outputCount = 4;
  outputMode = 0;
  dataBusWidth = 4;
  inputPin = 0;
  selectPin = 0;
  outputPin = 0;

  busSelect(): boolean {
    return this.hasFlag(DeMultiplexerElm.FLAG_BUS_SELECT);
  }
  override chipName(): string {
    return "Demultiplexer";
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    const s = st.tryInt();
    if (s !== undefined) {
      this.selectBitCount = s;
      this.setupPins();
      this.allocNodes();
    }
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.selectBitCount = xml.int("se", this.selectBitCount);
    this.outputMode = xml.int("om", 0);
    this.dataBusWidth = xml.int("dw", 4);
    this.setupPins();
    this.allocNodes();
  }

  override dumpChipValues(): string {
    return ` ${this.selectBitCount}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["se", String(this.selectBitCount)]);
    if (this.outputMode !== 0) a.push(["om", String(this.outputMode)]);
    if (this.dataBusWidth !== 4) a.push(["dw", String(this.dataBusWidth)]);
  }

  override textLossless(): boolean {
    return super.textLossless() && this.outputMode === 0;
  }

  private selectPins(start: number, offset: number): void {
    for (let i = 0; i < this.selectBitCount; i++) {
      const n = start + i;
      if (this.busSelect()) {
        this.pins[n] = this.newPin(0, Side.S, "S");
        this.pins[n].busWidth = this.selectBitCount;
        this.pins[n].busZ = i;
      } else this.pins[n] = this.newPin(i + offset, Side.S, "S" + i);
    }
  }

  setupPins(): void {
    if (this.selectBitCount === 0) this.selectBitCount = 2;
    this.outputCount = 1 << this.selectBitCount;
    this.pins = new Array<Pin>(this.getPostCount());
    const pins = this.pins;
    if (this.outputMode === 2) {
      const dw = this.dataBusWidth;
      this.sizeX = this.selectBitCount + 1;
      this.sizeY = this.outputCount + 1;
      this.inputPin = 0;
      for (let i = 0; i < dw; i++) {
        pins[i] = this.newPin(0, Side.W, "Q");
        pins[i].busWidth = dw;
        pins[i].busZ = i;
      }
      this.selectPin = dw;
      this.selectPins(this.selectPin, 1);
      this.outputPin = this.selectPin + this.selectBitCount;
      for (let g = 0; g < this.outputCount; g++) {
        for (let i = 0; i < dw; i++) {
          const n = this.outputPin + g * dw + i;
          pins[n] = this.newPin(g, Side.E, "Q" + g);
          pins[n].output = true;
          pins[n].busWidth = dw;
          pins[n].busZ = i;
        }
      }
    } else if (this.outputMode === 1) {
      this.sizeX = this.selectBitCount + 1;
      this.sizeY = 3;
      this.inputPin = 0;
      pins[0] = this.newPin(0, Side.W, "Q");
      this.selectPin = 1;
      this.selectPins(this.selectPin, 1);
      this.outputPin = this.selectPin + this.selectBitCount;
      for (let i = 0; i < this.outputCount; i++) {
        const n = this.outputPin + i;
        pins[n] = this.newPin(1, Side.E, "Q");
        pins[n].output = true;
        pins[n].busWidth = this.outputCount;
        pins[n].busZ = i;
      }
    } else {
      this.sizeX = 1 + this.selectBitCount;
      this.sizeY = 1 + this.outputCount;
      this.outputPin = 0;
      for (let i = 0; i < this.outputCount; i++) {
        pins[i] = this.newPin(i, Side.E, "Q" + i);
        pins[i].output = true;
      }
      this.selectPin = this.outputCount;
      this.selectPins(this.selectPin, 0);
      this.inputPin = this.outputCount + this.selectBitCount;
      pins[this.inputPin] = this.newPin(0, Side.W, "Q");
    }
    this.allocNodes();
  }

  override getPostCount(): number {
    const sb = this.selectBitCount || 2, oc = 1 << sb;
    if (this.outputMode === 2) return this.dataBusWidth + sb + oc * this.dataBusWidth;
    return 1 + sb + oc;
  }

  override getVoltageSourceCount(): number {
    return this.outputMode === 2 ? this.outputCount * this.dataBusWidth : this.outputCount;
  }

  override execute(): void {
    let sel = 0;
    for (let i = 0; i < this.selectBitCount; i++) if (this.pins[this.selectPin + i].value) sel |= 1 << i;
    const width = this.outputMode === 2 ? this.dataBusWidth : 1;
    const idle = this.hasFlag(DeMultiplexerElm.FLAG_INVERT_OUTPUTS);
    for (let i = 0; i < this.outputCount * width; i++) this.pins[this.outputPin + i].value = idle;
    for (let i = 0; i < width; i++) this.pins[this.outputPin + sel * width + i].value = this.pins[this.inputPin + i].value;
  }
}


export class SevenSegElm extends ChipElm {
  static override dumpType = 157;
  static override get xmlTag(): string {
    return "ssd";
  }
  static readonly ES_NONE = 0;
  static readonly ES_DP = 1;
  static readonly ES_COLON = 2;
  /** Segment end points on a 2×2 (7-seg) or 2×2 (14/16-seg) grid, x1 y1 x2 y2 per segment. */
  static readonly display7 = [0, 0, 2, 0, 2, 0, 2, 1, 2, 1, 2, 2, 0, 2, 2, 2, 0, 1, 0, 2, 0, 0, 0, 1, 0, 1, 2, 1];
  static readonly display14 = [0, 0, 2, 0, 2, 0, 2, 1, 2, 1, 2, 2, 2, 2, 0, 2, 0, 2, 0, 1, 0, 1, 0, 0, 0, 0, 1, 1, 1, 0, 1, 1, 2, 0, 1, 1, 1, 1, 2, 1, 1, 1, 2, 2, 1, 1, 1, 2, 1, 1, 0, 2, 0, 1, 1, 1];
  static readonly display16 = [0, 0, 1, 0, 1, 0, 2, 0, 2, 0, 2, 1, 2, 1, 2, 2, 2, 2, 1, 2, 1, 2, 0, 2, 0, 2, 0, 1, 0, 1, 0, 0, 0, 0, 1, 1, 1, 0, 1, 1, 2, 0, 1, 1, 1, 1, 2, 1, 1, 1, 2, 2, 1, 1, 1, 2, 1, 1, 0, 2, 0, 1, 1, 1];
  baseSegmentCount = 7;
  segmentCount = 7;
  extraSegment = 0;
  pinCount = 0;
  commonPin = -1;
  diodeDirection = 0;
  diodes: Diode[] = [];

  override allowBus(): boolean {
    return this.diodeDirection === 0;
  }
  override isDigitalChip(): boolean {
    return false;
  }
  override nonLinear(): boolean {
    return this.diodeDirection !== 0;
  }

  override initNew(): void {
    this.baseSegmentCount = this.segmentCount = 7;
    this.diodeDirection = 0;
    this.setPinCount();
    super.initNew();
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.baseSegmentCount = this.segmentCount = 7;
    this.diodeDirection = 0;
    const b = st.tryInt();
    if (b !== undefined) {
      this.baseSegmentCount = b;
      const e = st.tryInt();
      if (e !== undefined) {
        this.extraSegment = e;
        this.diodeDirection = st.tryInt() ?? 0;
      }
    }
    this.setPinCount();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.baseSegmentCount = xml.int("ba", this.baseSegmentCount);
    this.extraSegment = xml.int("ex", this.extraSegment);
    this.diodeDirection = xml.int("di", this.diodeDirection);
    this.setPinCount();
  }

  override dumpChipValues(): string {
    return ` ${this.baseSegmentCount} ${this.extraSegment} ${this.diodeDirection}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["ba", String(this.baseSegmentCount)], ["ex", String(this.extraSegment)], ["di", String(this.diodeDirection)]);
  }

  setPinCount(): void {
    this.segmentCount = this.baseSegmentCount + (this.extraSegment > 0 ? 1 : 0);
    if (this.diodeDirection === 0) {
      this.pinCount = this.segmentCount;
      this.commonPin = -1;
    } else {
      this.pinCount = this.segmentCount + 1;
      this.commonPin = this.pinCount - 1;
    }
    this.setupPins();
    this.allocNodes();
    if (this.sizeX) this.setPoints();
  }

  setupPins(): void {
    if (this.pinCount === 0) return;
    this.bits = this.segmentCount;
    this.pins = new Array<Pin>(this.pinCount);
    const pins = this.pins;
    if (this.useBus()) {
      this.sizeX = this.baseSegmentCount === 7 ? 4 : 5;
      this.sizeY = this.baseSegmentCount === 7 ? 4 : 6;
      this.makeBitPins(this.segmentCount, 0, Side.W, 0, "I", false, false, false);
      if (this.commonPin > 0) pins[this.commonPin] = this.newPin(1, Side.W, this.diodeDirection === 1 ? "gnd" : "Vcc");
      return;
    }
    const left = Math.trunc((this.baseSegmentCount + 1) / 2);
    this.sizeY = left;
    this.sizeX = this.baseSegmentCount === 7 ? (this.pinCount > 7 ? 5 : 4) : 5;
    if (this.pinCount > this.sizeY * 2) this.sizeY++;
    let i: number;
    for (i = 0; i !== left; i++) pins[i] = this.newPin(i, Side.W, String.fromCharCode(97 + i));
    const backwardCompatibility = this.segmentCount === 7 && this.diodeDirection === 0 && this.extraSegment === SevenSegElm.ES_NONE;
    let s = backwardCompatibility ? 1 : 0;
    for (; i !== this.segmentCount; i++) pins[i] = this.newPin(s++, backwardCompatibility ? Side.S : Side.E, String.fromCharCode(97 + i));
    if (this.extraSegment === SevenSegElm.ES_DP) pins[this.segmentCount - 1].text = "dp";
    if (this.commonPin > 0) {
      let side: number = Side.E;
      if (this.segmentCount !== 7) {
        side = Side.W;
        s = left;
      }
      pins[this.commonPin] = this.newPin(s++, side, this.diodeDirection === 1 ? "gnd" : "Vcc");
    }
  }

  override stamp(): void {
    super.stamp();
    if (this.diodeDirection === 0) return;
    const model = DiodeModel.getModelWithName("default-led");
    this.diodes = [];
    for (let i = 0; i !== this.segmentCount; i++) {
      const d = new Diode(this);
      d.setup(model);
      if (this.diodeDirection === 1) d.stamp(this.nodes[i]!, this.nodes[this.commonPin]!);
      else d.stamp(this.nodes[this.commonPin]!, this.nodes[i]!);
      this.diodes.push(d);
    }
  }

  override doStep(): void {
    super.doStep();
    if (this.diodeDirection === 0) return;
    for (let i = 0; i !== this.segmentCount; i++) this.diodes[i].doStep(this.diodeDirection * (this.volts[i] - this.volts[this.commonPin]));
  }

  override calculateCurrent(): void {
    if (this.diodeDirection === 0 || !this.diodes.length) {
      for (let i = 0; i !== this.pinCount; i++) this.pins[i].current = 0;
      return;
    }
    this.pins[this.commonPin].current = 0;
    for (let i = 0; i !== this.segmentCount; i++) {
      this.pins[i].current = -this.diodeDirection * this.diodes[i].calculateCurrent(this.diodeDirection * (this.volts[i] - this.volts[this.commonPin]));
      this.pins[this.commonPin].current -= this.pins[i].current;
    }
  }

  override getConnection(): boolean {
    return this.diodeDirection !== 0;
  }

  override stepFinished(): void {
    if (this.commonPin > 0 && Math.abs(this.pins[this.commonPin].current) > 1e12) this.sim.stop("max current exceeded", this);
  }

  override getPostCount(): number {
    return this.pinCount;
  }
  override getVoltageSourceCount(): number {
    return 0;
  }

  /** Brightness 0–1 of segment p. */
  segmentLevel(p: number): number {
    if (this.diodeDirection === 0) return this.pins[p].value ? 1 : 0;
    let w = (-this.diodeDirection * this.pins[p].current) / 0.01;
    if (w > 0) w = 1 + 0.2 * Math.log(w);
    return Math.max(0, Math.min(1, w));
  }
}

export class SevenSegDecoderElm extends ChipElm {
  static override dumpType = 197;
  static readonly FLAG_ENABLE = 1 << 1;
  static readonly FLAG_BLANK_F = 1 << 2;
  static readonly symbols = [
    "1111110", "0110000", "1101101", "1111001", "0110011", "1011011", "1011111", "1110000",
    "1111111", "1110011", "1110111", "0011111", "1001110", "0111101", "1001111", "1000111",
  ];
  static readonly symbols14 = [
    "11111100010001", "01100000100000", "11011000000101", "11110000000101", "01100100000101", "10110100000101", "10111100000101", "10000000100100",
    "11111100000101", "11110100000101", "11101100000101", "11110001010100", "10011100000000", "11110001000100", "10011100000101", "10001100000101",
  ];
  static readonly symbols16 = [
    "1111111100100010", "0011000000100000", "1110111000010001", "1111110000010001", "0011000100010001", "1101110100010001", "1101111100010001", "1100000000100100",
    "1111111100010001", "1111110100010001", "1111001100010001", "1111110001010100", "1100111100000000", "1111110001000100", "1100111100010001", "1100001100010001",
  ];
  segmentType = 0;

  override allowBus(): boolean {
    return true;
  }
  override chipName(): string {
    return "7-Segment Decoder";
  }
  hasBlank(): boolean {
    return (this.flags & SevenSegDecoderElm.FLAG_ENABLE) !== 0;
  }
  blankOnF(): boolean {
    return (this.flags & SevenSegDecoderElm.FLAG_BLANK_F) !== 0;
  }
  getSegmentCount(): number {
    return this.segmentType === 1 ? 14 : this.segmentType === 2 ? 16 : 7;
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    const t = st.tryInt();
    if (t !== undefined) {
      this.segmentType = t;
      this.setupPins();
    }
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.segmentType = xml.int("sgt", this.segmentType);
    this.setupPins();
  }

  override dumpChipValues(): string {
    return ` ${this.segmentType}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["sgt", String(this.segmentType)]);
  }

  setupPins(): void {
    const segCount = this.getSegmentCount();
    this.bits = 4;
    this.sizeX = 3;
    const inputPinsY = this.useBus() ? 1 : 4, outputPinsY = this.useBus() ? 1 : segCount;
    this.sizeY = Math.max(outputPinsY, inputPinsY + (this.hasBlank() ? 1 : 0));
    this.pins = new Array<Pin>(this.getPostCount());
    this.makeBitPins(4, 0, Side.W, segCount, "I", false, false, true);
    if (this.useBus()) this.makeBitPins(segCount, 0, Side.E, 0, "seg", true, false, false);
    else {
      for (let i = 0; i < segCount; i++) {
        this.pins[i] = this.newPin(i, Side.E, String.fromCharCode(97 + i));
        this.pins[i].output = true;
      }
    }
    if (this.hasBlank()) {
      this.pins[segCount + 4] = this.newPin(inputPinsY, Side.W, "BI");
      this.pins[segCount + 4].bubble = true;
    }
    this.allocNodes();
  }

  override getPostCount(): number {
    return this.getSegmentCount() + 4 + (this.hasBlank() ? 1 : 0);
  }
  override getVoltageSourceCount(): number {
    return this.getSegmentCount();
  }

  override execute(): void {
    const segCount = this.getSegmentCount(), p = this.pins;
    let input = 0;
    if (p[segCount].value) input += 8;
    if (p[segCount + 1].value) input += 4;
    if (p[segCount + 2].value) input += 2;
    if (p[segCount + 3].value) input += 1;
    const en = !(this.hasBlank() && !p[segCount + 4].value);
    if (!en || (input === 15 && this.blankOnF())) {
      for (let i = 0; i !== segCount; i++) this.writeOutput(i, false);
    } else {
      const sym = segCount === 14 ? SevenSegDecoderElm.symbols14 : segCount === 16 ? SevenSegDecoderElm.symbols16 : SevenSegDecoderElm.symbols;
      for (let i = 0; i < segCount; i++) this.writeOutput(i, sym[input][i] === "1");
    }
  }
}

/** Shows the value on its input pins as a number. */
export class DecimalDisplayElm extends ChipElm {
  static override dumpType = 419;
  static override get xmlTag(): string {
    return "dd";
  }
  bitCount = 4;
  displayMode = 0;

  override allowBus(): boolean {
    return true;
  }

  override initNew(): void {
    this.bitCount = 4;
    super.initNew();
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.bitCount = 4;
    const b = st.tryInt();
    if (b !== undefined) {
      this.bitCount = b;
      this.displayMode = st.tryInt() ?? 0;
    }
    this.setupPins();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.bitCount = xml.int("bc", this.bitCount);
    this.displayMode = xml.int("dm", this.displayMode);
    this.setupPins();
  }

  override dumpChipValues(): string {
    return ` ${this.bitCount} ${this.displayMode}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["bc", String(this.bitCount)], ["dm", String(this.displayMode)]);
  }

  setupPins(): void {
    this.sizeX = 3;
    this.sizeY = this.useBus() ? 2 : this.bitCount;
    this.pins = new Array<Pin>(this.bitCount);
    this.makeBitPins(this.bitCount, 0, Side.W, 0, "I", false, false, false);
    this.allocNodes();
  }

  override getPostCount(): number {
    return this.bitCount;
  }
  override getVoltageSourceCount(): number {
    return 0;
  }

  get displayText(): string {
    let value = 0;
    for (let i = 0; i < this.bitCount; i++) if (this.pins[i].value) value |= 1 << i;
    return this.displayMode === 1 ? value.toString(16).toUpperCase() : this.displayMode === 2 ? value.toString(8) : String(value);
  }
}


export class DACElm extends ChipElm {
  static override dumpType = 166;
  override needsBits(): boolean {
    return true;
  }
  override allowBus(): boolean {
    return true;
  }
  override isDigitalChip(): boolean {
    return false;
  }
  override chipName(): string {
    return "DAC";
  }
  setupPins(): void {
    this.sizeX = 2;
    const bitsY = this.useBus() ? 1 : this.bits > 2 ? this.bits : 2;
    this.sizeY = bitsY > 2 ? bitsY : 2;
    this.pins = new Array<Pin>(this.getPostCount());
    this.makeBitPins(this.bits, 0, Side.W, 0, "D", false, false, false);
    this.pins[this.bits] = this.newPin(0, Side.E, "O");
    this.pins[this.bits].output = true;
    this.pins[this.bits + 1] = this.newPin(this.sizeY - 1, Side.E, "V+");
    this.allocNodes();
  }
  override doStep(): void {
    let ival = 0;
    for (let i = 0; i !== this.bits; i++) if (this.volts[i] > this.getThreshold()) ival |= 1 << i;
    const ivalmax = (1 << this.bits) - 1;
    const v = (ival * this.volts[this.bits + 1]) / ivalmax;
    this.sim.updateVoltageSource(this.sim.ground, this.nodes[this.bits]!, this.pins[this.bits].voltSource!, v);
  }
  override getVoltageSourceCount(): number {
    return 1;
  }
  override getPostCount(): number {
    return this.bits + 2;
  }
}

export class ADCElm extends ChipElm {
  static override dumpType = 167;
  override needsBits(): boolean {
    return true;
  }
  override allowBus(): boolean {
    return true;
  }
  override isDigitalChip(): boolean {
    return false;
  }
  override chipName(): string {
    return "ADC";
  }
  setupPins(): void {
    this.sizeX = 2;
    const bitsY = this.useBus() ? 1 : this.bits > 2 ? this.bits : 2;
    this.sizeY = bitsY > 2 ? bitsY : 2;
    this.pins = new Array<Pin>(this.getPostCount());
    this.makeBitPins(this.bits, 0, Side.E, 0, "D", true, false, false);
    this.pins[this.bits] = this.newPin(0, Side.W, "In");
    this.pins[this.bits + 1] = this.newPin(this.sizeY - 1, Side.W, "V+");
    this.allocNodes();
  }
  override execute(): void {
    const imax = (1 << this.bits) - 1;
    const val = (imax * this.volts[this.bits]) / this.volts[this.bits + 1];
    // Java's (int) cast: truncate toward zero, NaN → 0
    let ival = Number.isNaN(val) ? 0 : Math.trunc(Math.max(-2147483648, Math.min(2147483647, val)));
    ival = Math.min(imax, Math.max(0, ival));
    for (let i = 0; i !== this.bits; i++) this.pins[i].value = (ival & (1 << i)) !== 0;
  }
  override getVoltageSourceCount(): number {
    return this.bits;
  }
  override getPostCount(): number {
    return this.bits + 2;
  }
}


/** 555 timer. */
export class TimerElm extends ChipElm {
  static override dumpType = 165;
  static readonly FLAG_RESET = 2;
  static readonly FLAG_GROUND = 4;
  static readonly FLAG_NUMBERS = 8;
  static readonly N_DIS = 0;
  static readonly N_TRIG = 1;
  static readonly N_THRES = 2;
  static readonly N_VCC = 3;
  static readonly N_CTL = 4;
  static readonly N_OUT = 5;
  static readonly N_RST = 6;
  static readonly N_GND = 7;
  groundNode: CircuitNode | null = null;
  out = false;
  triggerSuppressed = false;

  override getDefaultFlags(): number {
    return TimerElm.FLAG_RESET | TimerElm.FLAG_GROUND;
  }
  override nonLinear(): boolean {
    return true;
  }
  override isDigitalChip(): boolean {
    return false;
  }
  hasReset(): boolean {
    return (this.flags & TimerElm.FLAG_RESET) !== 0 || this.hasGroundPin();
  }
  hasGroundPin(): boolean {
    return (this.flags & TimerElm.FLAG_GROUND) !== 0;
  }
  usePinNames(): boolean {
    return (this.flags & TimerElm.FLAG_NUMBERS) === 0;
  }
  override chipName(): string {
    return "555 Timer";
  }

  setupPins(): void {
    this.sizeX = 3;
    this.sizeY = 5;
    const n = this.usePinNames();
    const pins = (this.pins = new Array<Pin>(8));
    pins[TimerElm.N_DIS] = this.newPin(1, Side.W, n ? "dis" : "7");
    pins[TimerElm.N_TRIG] = this.newPin(3, Side.W, n ? "tr" : "2");
    if (n) pins[TimerElm.N_TRIG].lineOver = true;
    pins[TimerElm.N_THRES] = this.newPin(4, Side.W, n ? "th" : "6");
    pins[TimerElm.N_VCC] = this.newPin(1, Side.N, n ? "Vcc" : "8");
    pins[TimerElm.N_CTL] = this.newPin(1, Side.S, n ? "ctl" : "5");
    pins[TimerElm.N_OUT] = this.newPin(2, Side.E, n ? "out" : "3");
    pins[TimerElm.N_OUT].state = true;
    pins[TimerElm.N_RST] = this.newPin(1, Side.E, n ? "rst" : "4");
    if (n) pins[TimerElm.N_RST].lineOver = true;
    pins[TimerElm.N_GND] = this.newPin(2, Side.S, n ? "gnd" : "1");
  }

  override stamp(): void {
    const sim = this.sim, nd = this.nodes;
    const ground = (this.groundNode = this.hasGroundPin() ? nd[TimerElm.N_GND]! : sim.ground);
    sim.stampResistor(nd[TimerElm.N_VCC]!, nd[TimerElm.N_CTL]!, 5000);
    sim.stampResistor(nd[TimerElm.N_CTL]!, ground, 10000);
  }

  override calculateCurrent(): void {
    const v = this.volts, p = this.pins, T = TimerElm;
    p[T.N_VCC].current = (v[T.N_CTL] - v[T.N_VCC]) / 5000;
    const groundVolts = this.hasGroundPin() ? v[T.N_GND] : 0;
    p[T.N_CTL].current = -(v[T.N_CTL] - groundVolts) / 10000 - p[T.N_VCC].current;
    p[T.N_DIS].current = !this.out ? -(v[T.N_DIS] - groundVolts) / 10 : 0;
    p[T.N_OUT].current = -(v[T.N_OUT] - (this.out ? v[T.N_VCC] : groundVolts));
    if (this.out) p[T.N_VCC].current -= p[T.N_OUT].current;
    if (this.hasGroundPin()) {
      p[T.N_GND].current = (v[T.N_CTL] - groundVolts) / 10000;
      if (!this.out) p[T.N_GND].current += (v[T.N_DIS] - groundVolts) / 10 + (v[T.N_OUT] - groundVolts);
    }
  }

  override startIteration(): void {
    const v = this.volts, T = TimerElm;
    const groundVolts = this.hasGroundPin() ? v[T.N_GND] : 0;
    this.out = v[T.N_OUT] > (v[T.N_VCC] + groundVolts) / 2;
    // if threshold is higher than control voltage, output goes low
    if (v[T.N_THRES] > v[T.N_CTL]) this.out = false;
    // if trigger is lower than control voltage, output goes high
    const triggered = (v[T.N_CTL] + groundVolts) / 2 > v[T.N_TRIG];
    if (triggered || this.triggerSuppressed) this.out = true;
    if (this.hasReset() && v[T.N_RST] < 0.7 + groundVolts) {
      this.out = false;
      this.triggerSuppressed = triggered;
    } else this.triggerSuppressed = false;
  }

  override doStep(): void {
    const sim = this.sim, nd = this.nodes, T = TimerElm, ground = this.groundNode!;
    if (!this.out) sim.stampResistor(nd[T.N_DIS]!, ground, 10);
    sim.stampResistor(this.out ? nd[T.N_VCC]! : ground, nd[T.N_OUT]!, 1);
  }

  override getPostCount(): number {
    return this.hasGroundPin() ? 8 : this.hasReset() ? 7 : 6;
  }
  override getVoltageSourceCount(): number {
    return 0;
  }
  override getMatrixConnection(): boolean {
    return true;
  }
}

export class MonostableElm extends ChipElm {
  static override dumpType = 194;
  prevInputValue = false;
  retriggerable = false;
  triggered = false;
  lastRisingEdge = 0;
  delay = 0.01;

  override chipName(): string {
    return "Monostable";
  }

  override initNew(): void {
    super.initNew();
    this.reset();
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.retriggerable = st.nextBool();
    this.delay = st.nextDouble();
    this.reset();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.retriggerable = xml.bool("rt", this.retriggerable);
    this.delay = xml.double("dl", this.delay);
    this.reset();
  }

  override dumpChipValues(): string {
    return ` ${this.retriggerable} ${this.delay}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["rt", String(this.retriggerable)], ["dl", String(this.delay)]);
  }

  setupPins(): void {
    this.sizeX = 2;
    this.sizeY = 2;
    const pins = (this.pins = new Array<Pin>(3));
    pins[0] = this.newPin(0, Side.W, "");
    pins[0].clock = true;
    pins[1] = this.newPin(0, Side.E, "Q");
    pins[1].output = true;
    pins[2] = this.newPin(1, Side.E, "Q");
    pins[2].output = true;
    pins[2].lineOver = true;
  }

  override reset(): void {
    super.reset();
    this.pins[2].value = true;
    this.triggered = this.prevInputValue = false;
  }

  override getPostCount(): number {
    return 3;
  }
  override getVoltageSourceCount(): number {
    return 2;
  }

  override execute(): void {
    const p = this.pins, t = this.sim.t;
    if (p[0].value && this.prevInputValue !== p[0].value && (this.retriggerable || !this.triggered)) {
      this.lastRisingEdge = t;
      p[1].value = true;
      p[2].value = false;
      this.triggered = true;
    }
    if (this.triggered && t > this.lastRisingEdge + this.delay) {
      p[1].value = false;
      p[2].value = true;
      this.triggered = false;
    }
    this.prevInputValue = p[0].value;
  }
}

/** Voltage-controlled oscillator (charges an external capacitor between thresholds). */
export class VCOElm extends ChipElm {
  static override dumpType = 158;
  static readonly cResistance = 1e6;
  cDir = 0;

  override nonLinear(): boolean {
    return true;
  }
  override isDigitalChip(): boolean {
    return false;
  }
  override chipName(): string {
    return "VCO";
  }

  setupPins(): void {
    this.sizeX = 2;
    this.sizeY = 4;
    const pins = (this.pins = new Array<Pin>(6));
    pins[0] = this.newPin(0, Side.W, "Vi");
    pins[1] = this.newPin(3, Side.W, "Vo");
    pins[1].output = true;
    pins[2] = this.newPin(0, Side.E, "C");
    pins[3] = this.newPin(1, Side.E, "C");
    pins[4] = this.newPin(2, Side.E, "R1");
    pins[4].output = true;
    pins[5] = this.newPin(3, Side.E, "R2");
    pins[5].output = true;
  }

  override stamp(): void {
    const sim = this.sim, nd = this.nodes, p = this.pins;
    // output pin
    sim.stampVoltageSource(sim.ground, nd[1]!, p[1].voltSource!);
    // attach Vi to R1 pin so its current is proportional to Vi
    sim.stampVoltageSource(nd[0]!, nd[4]!, p[4].voltSource!, 0);
    // attach 5V to R2 pin so we get a current going
    sim.stampVoltageSource(sim.ground, nd[5]!, p[5].voltSource!, 5);
    // put resistor across cap pins to give current somewhere to go in case cap is not connected
    sim.stampResistor(nd[2]!, nd[3]!, VCOElm.cResistance);
  }

  override doStep(): void {
    const v = this.volts, sim = this.sim, nd = this.nodes, p = this.pins;
    const vc = v[3] - v[2];
    let vo = v[1];
    let dir = vo < 2.5 ? 1 : -1;
    // switch direction of current through cap as we oscillate
    if (vo < 2.5 && vc > 4.5) {
      vo = 5;
      dir = -1;
    }
    if (vo > 2.5 && vc < 0.5) {
      vo = 0;
      dir = 1;
    }
    // generate output voltage
    sim.updateVoltageSource(sim.ground, nd[1]!, p[1].voltSource!, vo);
    // now we set the current through the cap to be equal to the current through R1 and R2, so we
    // can measure the voltage across the cap
    sim.stampMatrixNV(nd[2]!, p[4].voltSource!, dir);
    sim.stampMatrixNV(nd[2]!, p[5].voltSource!, dir);
    sim.stampMatrixNV(nd[3]!, p[4].voltSource!, -dir);
    sim.stampMatrixNV(nd[3]!, p[5].voltSource!, -dir);
    this.cDir = dir;
  }

  override calculateCurrent(): void {
    const p = this.pins;
    const c = this.cDir * (p[4].current + p[5].current) + (this.volts[3] - this.volts[2]) / VCOElm.cResistance;
    p[2].current = -c;
    p[3].current = c;
    p[0].current = -p[4].current;
  }

  override getPostCount(): number {
    return 6;
  }
  override getVoltageSourceCount(): number {
    return 3;
  }
  override getMatrixConnection(): boolean {
    return true;
  }
}

/** Phase comparator (CD4046 type II): a tri-state output from two edge flip-flops. */
export class PhaseCompElm extends ChipElm {
  static override dumpType = 161;
  ff1 = false;
  ff2 = false;

  override nonLinear(): boolean {
    return true;
  }
  override chipName(): string {
    return "Phase Comp";
  }

  setupPins(): void {
    this.sizeX = 2;
    this.sizeY = 2;
    const pins = (this.pins = new Array<Pin>(3));
    pins[0] = this.newPin(0, Side.W, "I1");
    pins[1] = this.newPin(1, Side.W, "I2");
    pins[2] = this.newPin(0, Side.E, "O");
    pins[2].output = true;
  }

  override stamp(): void {}

  override startIteration(): void {
    const v1 = this.volts[0] > this.getThreshold(), v2 = this.volts[1] > this.getThreshold();
    if (v1 && !this.pins[0].value) this.ff1 = true;
    if (v2 && !this.pins[1].value) this.ff2 = true;
    if (this.ff1 && this.ff2) this.ff1 = this.ff2 = false;
    this.pins[0].value = v1;
    this.pins[1].value = v2;
  }

  override doStep(): void {
    const out = this.ff1 ? this.highVoltage : this.ff2 ? 0 : -1;
    const vs = this.pins[2].voltSource!;
    if (out !== -1) this.sim.stampVoltageSource(this.sim.ground, this.nodes[2]!, vs, out);
    else this.sim.stampMatrixVV(vs, vs, 1); // tie current through output pin to 0
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


export class SipoShiftElm extends ChipElm {
  static override dumpType = 189;
  static readonly DATA_PIN_INDEX = 2;
  clockstate = false;

  override needsBits(): boolean {
    return true;
  }
  override defaultBitCount(): number {
    return 8;
  }
  override chipName(): string {
    return "SIPO shift register";
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    const data = new Array<boolean>(this.bits).fill(false);
    readBits(st, data);
    for (let i = 0; i < this.bits; i++) this.pins[SipoShiftElm.DATA_PIN_INDEX + i].value = data[i];
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    const dt = xml.string("dt", null);
    if (dt !== null) {
      const data = new Array<boolean>(this.bits).fill(false);
      readBitsFromString(dt, data);
      for (let i = 0; i < this.bits; i++) this.pins[SipoShiftElm.DATA_PIN_INDEX + i].value = data[i];
    }
  }

  private data(): boolean[] {
    return Array.from({ length: this.bits }, (_, i) => this.pins[SipoShiftElm.DATA_PIN_INDEX + i].value);
  }

  override dumpChipValues(): string {
    return " " + writeBits(this.data());
  }

  override dumpXmlState(a: XmlAttrs): void {
    super.dumpXmlState(a);
    a.push(["dt", writeBits(this.data())]);
  }

  setupPins(): void {
    this.sizeX = this.bits + 1;
    this.sizeY = 3;
    const old = this.pins;
    const pins = (this.pins = new Array<Pin>(this.getPostCount()));
    pins[0] = this.newPin(1, Side.W, "D");
    pins[1] = this.newPin(2, Side.W, "");
    pins[1].clock = true;
    for (let i = 0; i < this.bits; i++) {
      const value = old[SipoShiftElm.DATA_PIN_INDEX + i]?.value ?? false;
      const pin = (pins[SipoShiftElm.DATA_PIN_INDEX + i] = this.newPin(i + 1, Side.N, "Q" + i));
      pin.value = value;
      pin.output = true;
    }
    this.allocNodes();
  }

  override getPostCount(): number {
    return 2 + this.bits;
  }
  override getVoltageSourceCount(): number {
    return this.bits;
  }

  override execute(): void {
    const p = this.pins, D = SipoShiftElm.DATA_PIN_INDEX;
    if (p[1].value !== this.clockstate) {
      this.clockstate = p[1].value;
      if (this.clockstate && this.bits > 0) {
        for (let i = this.bits - 2; i >= 0; i--) p[D + i + 1].value = p[D + i].value;
        p[2].value = p[0].value;
      }
    }
  }
}

export class PisoShiftElm extends ChipElm {
  static override dumpType = 186;
  static readonly FLAG_NEW_BEHAVIOR = 2;
  data: boolean[] = [];
  dataIndex = 0;
  clockState = false;
  loadState = false;
  dataPinIndex = 0;

  override needsBits(): boolean {
    return true;
  }
  override defaultBitCount(): number {
    return 8;
  }
  hasNewBhvr(): boolean {
    return (this.flags & PisoShiftElm.FLAG_NEW_BEHAVIOR) !== 0;
  }
  override chipName(): string {
    return "PISO shift register";
  }

  override initNew(): void {
    super.initNew();
    this.data = new Array<boolean>(this.bits).fill(false);
    this.flags |= PisoShiftElm.FLAG_NEW_BEHAVIOR;
    this.setupPins();
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.data = new Array<boolean>(this.bits).fill(false);
    readBits(st, this.data);
    this.setupPins();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.data = new Array<boolean>(this.bits).fill(false);
    this.dataIndex = 0;
    const dt = xml.string("dt", null);
    if (dt !== null) readBitsFromString(dt, this.data);
  }

  private rotated(): boolean[] {
    return this.data.map((_, i) => this.data[(i + this.dataIndex + this.data.length) % this.data.length]);
  }

  override dumpChipValues(): string {
    return " " + writeBits(this.rotated());
  }

  override dumpXmlState(a: XmlAttrs): void {
    super.dumpXmlState(a);
    a.push(["dt", writeBits(this.rotated())]);
  }

  override reset(): void {
    super.reset();
    this.data = new Array<boolean>(this.bits).fill(false);
  }

  setupPins(): void {
    this.sizeX = this.bits + 2;
    this.sizeY = 3;
    const pins = (this.pins = new Array<Pin>(this.getPostCount()));
    pins[0] = this.newPin(1, Side.W, "LD");
    pins[1] = this.newPin(2, Side.W, "");
    pins[1].clock = true;
    pins[2] = this.newPin(1, Side.E, "Q" + (this.hasNewBhvr() ? this.bits - 1 : this.bits));
    pins[2].output = true;
    if (this.hasNewBhvr()) {
      pins[3] = this.newPin(0, Side.W, "SER");
      if (this.data.length > 0) pins[2].value = this.data[0];
      this.dataPinIndex = 4;
    } else this.dataPinIndex = 3;
    for (let i = 0; i < this.bits; i++) pins[this.dataPinIndex + i] = this.newPin(this.bits - i, Side.N, "D" + (this.bits - (i + 1)));
    this.allocNodes();
  }

  override getPostCount(): number {
    return (this.hasNewBhvr() ? 4 : 3) + this.bits;
  }
  override getVoltageSourceCount(): number {
    return 1;
  }

  override execute(): void {
    const p = this.pins;
    if (p[0].value !== this.loadState) {
      this.loadState = p[0].value;
      if (this.loadState && this.data.length > 0) {
        if (this.hasNewBhvr()) {
          p[2].value = p[this.dataPinIndex].value;
          this.dataIndex = 0;
        } else this.dataIndex = -1;
        for (let i = 0; i < this.data.length; i++) this.data[i] = p[this.dataPinIndex + i].value;
      }
    }
    if (p[1].value !== this.clockState) {
      this.clockState = p[1].value;
      if (this.clockState) {
        if (this.dataIndex >= 0) this.data[this.dataIndex] = this.hasNewBhvr() && p[3].value;
        this.dataIndex++;
        if (this.dataIndex >= this.data.length) this.dataIndex = 0;
        p[2].value = this.data[this.dataIndex];
      }
    }
  }
}

/** Plays a stored bit sequence, one bit per clock. */
export class SeqGenElm extends ChipElm {
  static override dumpType = 188;
  static readonly FLAG_NEW_VERSION = 2;
  static readonly FLAG_PLAY_ONCE = 4;
  static readonly FLAG_HAS_RESET = 8;
  bitPosition = 0;
  bitCount = 0;
  data: number[] = [0];
  clockstate = false;

  hasPlayOnce(): boolean {
    return (this.flags & SeqGenElm.FLAG_PLAY_ONCE) !== 0;
  }
  hasReset(): boolean {
    return (this.flags & SeqGenElm.FLAG_HAS_RESET) !== 0;
  }
  override chipName(): string {
    return "Sequence Generator";
  }

  override initNew(): void {
    this.flags |= SeqGenElm.FLAG_NEW_VERSION | SeqGenElm.FLAG_HAS_RESET;
    super.initNew();
    this.bitCount = 8;
    this.data = [0];
    this.setupPins();
    this.allocNodes();
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    if (!st.hasMoreTokens) return;
    if ((this.flags & SeqGenElm.FLAG_NEW_VERSION) === 0) {
      // old version: 8 bits in one byte
      this.flags |= SeqGenElm.FLAG_NEW_VERSION;
      const oldData = st.nextInt() & 0xff;
      this.bitCount = 8;
      this.data = [oldData];
    } else {
      this.bitCount = st.nextInt();
      const n = Math.trunc(this.bitCount / 32) + (this.bitCount % 32 !== 0 ? 1 : 0);
      this.data = [];
      for (let i = 0; i < n && st.hasMoreTokens; i++) this.data.push(st.nextInt());
    }
    if (this.bitCount > this.data.length * 32) this.bitCount = this.data.length * 32;
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.bitCount = xml.int("bc", this.bitCount);
    const dt = xml.string("dt", null);
    if (dt !== null) this.data = dt.trim().split(/\s+/).filter(Boolean).map((w) => JavaNumber.parseInt(w));
    if (this.bitCount > this.data.length * 32) this.bitCount = this.data.length * 32;
  }

  override dumpChipValues(): string {
    return ` ${this.bitCount} ${this.data.join(" ")}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["bc", String(this.bitCount)], ["dt", this.data.join(" ")]);
  }

  setupPins(): void {
    this.sizeX = 2;
    this.sizeY = 2;
    const pins = (this.pins = new Array<Pin>(this.getPostCount()));
    pins[0] = this.newPin(0, Side.W, "");
    pins[0].clock = true;
    pins[1] = this.newPin(1, Side.E, "Q");
    pins[1].output = true;
    if (this.hasReset()) pins[2] = this.newPin(1, Side.W, "R");
  }

  override getVoltageDiff(): number {
    return this.volts[1];
  }
  override getPostCount(): number {
    return this.hasReset() ? 3 : 2;
  }
  override getVoltageSourceCount(): number {
    return 1;
  }

  override reset(): void {
    super.reset();
    this.bitPosition = 0;
  }

  nextBit(): void {
    const p = this.pins;
    if (this.data.length > 0 && this.bitCount > 0) {
      if (this.bitPosition >= this.bitCount) {
        if (this.hasPlayOnce()) {
          p[1].value = false;
          return;
        }
        this.bitPosition = 0;
      }
      p[1].value = (this.data[Math.trunc(this.bitPosition / 32)] & (1 << (this.bitPosition % 32))) !== 0;
      this.bitPosition++;
    } else p[1].value = false;
  }

  override execute(): void {
    const p = this.pins;
    if (this.hasReset() && p[2].value) {
      this.bitPosition = 0;
      this.clockstate = p[0].value;
      this.nextBit();
    } else if (p[0].value !== this.clockstate) {
      this.clockstate = p[0].value;
      if (this.clockstate) this.nextBit();
    }
  }
}
