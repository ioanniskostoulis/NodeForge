// Ported from CircuitJS1 (GraphicElm.java, TextElm.java, LineElm.java, BoxElm.java, OutputElm.java,
// ProbeElm.java, LabeledNodeElm.java, RoutedWireElm.java) by Paul Falstad and Iain Sharp.
// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { CircuitElm, type XmlAttrs } from "../core/elm";
import { type GridPoint, pointKey, pt } from "../core/geometry";
import type { CircuitNode } from "../core/nodes";
import type { WireSegment } from "../core/simulator";
import { CircuitText, JavaNumber, type TokenStream, type XmlNode } from "../io/tokens";
import { WireElm } from "./basic";

const ch = (c: string) => c.charCodeAt(0);

/** Display scale for voltage readouts (CircuitElm.SCALE_*). */
export const Scale = { auto: 0, volts: 1, milli: 2, micro: 3 } as const;

/** Drawings on the sheet: no posts, not simulated. */
export abstract class GraphicElm extends CircuitElm {
  override getPostCount(): number {
    return 0;
  }
  isGraphic(): boolean {
    return true;
  }
}

export class TextElm extends GraphicElm {
  static override dumpType = ch("x");
  static readonly FLAG_BAR = 2;
  static readonly FLAG_ESCAPE = 4;
  text = "hello";
  lines: string[] = ["hello"];
  size = 24;
  color: string | null = null;

  override initNew(): void {
    this.text = "hello";
    this.size = 24;
    this.split();
  }

  override readTokens(st: TokenStream): void {
    this.size = st.nextInt();
    let text = st.next();
    if ((this.flags & TextElm.FLAG_ESCAPE) === 0) {
      while (st.hasMoreTokens) text += " " + st.next();
      text = text.replace(/%2[bB]/g, "+");
    } else {
      text = CircuitText.unescape(text);
    }
    this.text = text;
    this.split();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.size = xml.int("si", this.size);
    this.text = xml.string("te", this.text) ?? this.text;
    this.color = xml.string("co", this.color);
    this.split();
  }

  /** "\n" (backslash, n) separates lines; other backslashes escape the next character. */
  split(): void {
    const lines: string[] = [];
    let cur = "";
    for (let i = 0; i < this.text.length; i++) {
      let c = this.text[i];
      if (c === "\\" && i + 1 < this.text.length) {
        c = this.text[++i];
        if (c === "n") {
          lines.push(cur);
          cur = "";
          continue;
        }
      }
      cur += c;
    }
    lines.push(cur);
    this.lines = lines;
  }

  setText(text: string): void {
    this.text = text;
    this.split();
  }

  override dump(): string {
    this.flags |= TextElm.FLAG_ESCAPE;
    return super.dump();
  }

  override dumpValues(): string {
    return ` ${this.size} ${CircuitText.escape(this.text)}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["si", String(this.size)], ["te", this.text]);
    if (this.color !== null) a.push(["co", this.color]);
  }

  override textLossless(): boolean {
    return this.color === null;
  }

  get hasBar(): boolean {
    return (this.flags & TextElm.FLAG_BAR) !== 0;
  }
}

/** A drawn line (no electrical meaning). */
export class LineElm extends GraphicElm {
  static override dumpType = 423;
}

/** A drawn rectangle (no electrical meaning). */
export class BoxElm extends GraphicElm {
  static override dumpType = ch("b");
}

/** A labeled output terminal showing the voltage at its post. */
export class OutputElm extends CircuitElm {
  static override dumpType = ch("O");
  static readonly FLAG_VALUE = 1;
  static readonly FLAG_FIXED = 2;
  scale: number = Scale.auto;

  override readTokens(st: TokenStream): void {
    this.scale = st.tryInt() ?? Scale.auto;
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.scale = xml.int("sc", this.scale);
  }

  override dumpValues(): string {
    return ` ${this.scale}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["sc", String(this.scale)]);
  }

  override getPostCount(): number {
    return 1;
  }

  override getVoltageDiff(): number {
    return this.volts[0];
  }

  get showsVoltage(): boolean {
    return (this.flags & OutputElm.FLAG_VALUE) !== 0;
  }
}

/** Voltmeter probe between two points, with optional series resistance and running measurements. */
export class ProbeElm extends CircuitElm {
  static override dumpType = ch("p");
  static readonly FLAG_SHOWVOLTAGE = 1;
  static readonly FLAG_CIRCLE = 2;
  static readonly Meter = { voltage: 0, rms: 1, max: 2, min: 3, p2p: 4, binary: 5, frequency: 6, period: 7, pulseWidth: 8, dutyCycle: 9, average: 10 } as const;

  meter = 0;
  scale: number = Scale.auto;
  resistance = 0;

  rmsV = 0;
  total = 0;
  count = 0;
  avgV = 0;
  totalV = 0;
  binaryLevel = 0;
  zerocount = 0;
  maxV = 0;
  lastMaxV = 0;
  minV = 0;
  lastMinV = 0;
  frequency = 0;
  period = 0;
  pulseWidth = 0;
  dutyCycle = 0;
  increasingV = true;
  decreasingV = true;
  started = false;
  lastStepCount = 0;
  periodStart = 0;
  periodLength = 0;
  pulseStart = 0;

  override initNew(): void {
    this.flags = ProbeElm.FLAG_SHOWVOLTAGE | ProbeElm.FLAG_CIRCLE;
    this.resistance = 1e7;
  }

  override readTokens(st: TokenStream): void {
    // all optional, read in one go as upstream does
    const m = st.tryInt();
    if (m === undefined) return;
    this.meter = m;
    const s = st.tryInt();
    if (s === undefined) return;
    this.scale = s;
    this.resistance = st.tryDouble() ?? 0;
  }

  override undumpXml(xml: XmlNode): void {
    this.flags = 0;
    super.undumpXml(xml);
    this.meter = xml.int("me", this.meter);
    this.scale = xml.int("sc", this.scale);
    this.resistance = xml.double("re", 0);
  }

  override dumpValues(): string {
    return ` ${this.meter} ${this.scale} ${this.resistance}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["me", String(this.meter)], ["sc", String(this.scale)], ["re", String(this.resistance)]);
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
    this.periodStart = this.periodLength = this.pulseStart = 0;
    this.increasingV = true;
    this.decreasingV = true;
    this.started = false;
    this.lastStepCount = 0;
  }

  get drawAsCircle(): boolean {
    return (this.flags & ProbeElm.FLAG_CIRCLE) !== 0;
  }

  override stepFinished(): void {
    const sim = this.sim;
    if (sim.timeStepCount === this.lastStepCount) return;
    this.lastStepCount = sim.timeStepCount;
    this.count++;
    const v = this.getVoltageDiff();
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
      // change of direction: V now going down, at the start of the waveform
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
      // change of direction: V now going up
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

  override calculateCurrent(): void {
    this.current = this.resistance === 0 ? 0 : (this.volts[0] - this.volts[1]) / this.resistance;
  }

  override stamp(): void {
    if (this.resistance !== 0) this.sim.stampResistor(this.nodes[0]!, this.nodes[1]!, this.resistance);
  }

  override getConnection(): boolean {
    return this.resistance !== 0;
  }

  /** The measurement the probe is set to show. */
  meterValue(): number {
    const M = ProbeElm.Meter;
    switch (this.meter) {
      case M.rms: return this.rmsV;
      case M.average: return this.avgV;
      case M.max: return this.lastMaxV;
      case M.min: return this.lastMinV;
      case M.p2p: return this.lastMaxV - this.lastMinV;
      case M.binary: return this.binaryLevel;
      case M.frequency: return this.frequency;
      case M.period: return this.period;
      case M.pulseWidth: return this.pulseWidth;
      case M.dutyCycle: return this.dutyCycle;
      default: return this.getVoltageDiff();
    }
  }
}

/**
 * A named node: every labeled node with the same text is connected, like an invisible wire.
 * Merged out of the matrix with the wires.
 */
export class LabeledNodeElm extends CircuitElm {
  static override dumpType = 207;
  static override get xmlTag(): string {
    return "ln";
  }
  static readonly FLAG_INTERNAL = 1;
  static readonly FLAG_ESCAPE = 4;
  static readonly FLAG_ROTATE_TEXT = 8;
  static readonly circleSize = 17;
  text = "label";
  busWidth = 1;
  currents: number[] | null = null;

  override readTokens(st: TokenStream): void {
    let text = st.next();
    if ((this.flags & LabeledNodeElm.FLAG_ESCAPE) === 0) {
      // old-style dump before escape/unescape
      while (st.hasMoreTokens) text += " " + st.next();
    } else {
      text = CircuitText.unescape(text);
    }
    this.text = text;
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.text = xml.string("te", this.text) ?? this.text;
  }

  override dump(): string {
    this.flags |= LabeledNodeElm.FLAG_ESCAPE;
    return super.dump();
  }

  override dumpValues(): string {
    return ` ${CircuitText.escape(this.text)}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["te", this.text]);
  }

  get isInternal(): boolean {
    return (this.flags & LabeledNodeElm.FLAG_INTERNAL) !== 0;
  }

  override setPoints(): void {
    super.setPoints();
    this.lead1 = pt(
      Math.floor(this.point1.x * (LabeledNodeElm.circleSize / this.dn) + this.point2.x * (1 - LabeledNodeElm.circleSize / this.dn) + 0.48),
      Math.floor(this.point1.y * (LabeledNodeElm.circleSize / this.dn) + this.point2.y * (1 - LabeledNodeElm.circleSize / this.dn) + 0.48),
    );
  }

  private key(n: number): string {
    return this.busWidth > 1 ? `${this.text}:${n}` : this.text;
  }

  /** The post of the first node with this label; the first one seen returns null (CircuitJS's labelList). */
  override getConnectedPost(n = 0): GridPoint | null {
    const list = this.sim.labelList;
    const le = list.get(this.key(n));
    if (le) return le.point;
    list.set(this.key(n), { point: this.getPost(n), node: null });
    return null;
  }

  override setNode(p: number, n: CircuitNode): void {
    super.setNode(p, n);
    const le = this.sim?.labelList.get(this.key(p));
    if (le) le.node = n;
  }

  override getPostCount(): number {
    return this.busWidth;
  }
  override getPostWidth(): number {
    return this.busWidth;
  }
  override getBusWidth(): number {
    return this.busWidth;
  }
  override setBusWidth(w: number): void {
    this.busWidth = w;
    this.currents = w > 1 ? new Array<number>(w).fill(0) : null;
    this.allocNodes();
  }
  override busLabel(): string {
    return this.text;
  }

  override getPost(n: number): GridPoint {
    return this.busWidth === 1 ? this.point1 : pt(this.point1.x, this.point1.y, n);
  }

  override getWireSegments(list: WireSegment[]): void {
    for (let b = 0; b < this.busWidth; b++) {
      const ep1 = this.busWidth > 1 ? `label:${this.text}:${b}` : `label:${this.text}`;
      list.push({ wire: this, bit: b, endpoint0: pointKey(this.getPost(b)), endpoint1: ep1, neighbors: [], labelNeighbors: [], post: 0, current: 0 });
    }
  }

  override isWireEquivalent(): boolean {
    return true;
  }
  override isRemovableWire(): boolean {
    return true;
  }
  override getConnection(n1: number, n2: number): boolean {
    return n1 === n2;
  }

  override getCurrentIntoNode(n: number): number {
    if (this.currents) return -this.currents[n];
    return -this.current;
  }

  override setWireCurrent(bit: number, c: number): void {
    if (this.currents) this.currents[bit] = c;
    else this.current = c;
  }

  override getVoltageDiff(): number {
    return this.volts[0];
  }
}

/** A wire drawn along a route of points; electrically the same as a wire between its ends. */
export class RoutedWireElm extends WireElm {
  static override dumpType = 0;
  static override get xmlTag(): string {
    return "rw";
  }
  routePoints: GridPoint[] | null = null;

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    const contents = xml.text.trim();
    if (!contents) return;
    try {
      const points = contents.split(";").map((pair) => {
        const [x, y] = pair.split(",");
        return pt(JavaNumber.parseInt(x.trim()), JavaNumber.parseInt(y.trim()));
      });
      if (points.length >= 2) this.routePoints = points;
    } catch {
      // keep the straight route
    }
  }

  override setPoints(): void {
    super.setPoints();
    const rp = this.routePoints;
    if (rp && rp.length >= 2) {
      const first = rp[0], last = rp[rp.length - 1];
      if (first.x === this.x && first.y === this.y && last.x === this.x2 && last.y === this.y2) return;
      // an end moved: keep the inner route and connect the new ends to it
      const inner = rp.slice(1, -1);
      if (inner.length) {
        this.routePoints = [this.point1, ...manhattan(this.point1, inner[0]), ...inner, ...manhattan(inner[inner.length - 1], this.point2), this.point2];
        return;
      }
    }
    this.routePoints = [this.point1, ...manhattan(this.point1, this.point2), this.point2];
  }

  /** The text format has no routed wires: they're saved as plain wires. */
  override dump(): string {
    return `w ${this.x} ${this.y} ${this.x2} ${this.y2} ${this.flags}`;
  }

  override textLossless(): boolean {
    return false;
  }

  /** Route as XML element text: "x,y;x,y;…". */
  override xmlText(): string {
    return (this.routePoints ?? []).map((p) => `${p.x},${p.y}`).join(";");
  }
}

/** The corner between two points, if they aren't on a line. */
function manhattan(a: GridPoint, b: GridPoint): GridPoint[] {
  return a.x === b.x || a.y === b.y ? [] : [pt(b.x, a.y)];
}
