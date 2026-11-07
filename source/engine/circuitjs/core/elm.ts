// Ported from CircuitJS1 (CircuitElm.java) by Paul Falstad and Iain Sharp.
// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Licensed under the GNU General Public License v2 or later. See LICENSE.
//
// Only the simulation and geometry parts of CircuitElm live here; drawing is the renderer's job.
//
// Construction differs from Java: TypeScript initializes subclass fields after the base
// constructor, so the constructor only stores the position, and the Java constructor bodies
// become initNew() (a newly placed element) and readTokens() (loaded from the text format).
// The factories in io/registry.ts call them in the right order.

import { type GridPoint, type GridRect, interpPoint, pt, pointKey, samePoint, sign, snapGrid } from "./geometry";
import type { CircuitNode, VoltageSource } from "./nodes";
import type { Simulator, WireSegment } from "./simulator";
import type { TokenStream, XmlNode } from "../io/tokens";
import { JavaNumber, CircuitParseError } from "../io/tokens";

/** A slider a part owns (CircuitJS adds these to its side panel): position 0–100. */
export interface PartSlider {
  label: string;
  value: number;
  /** The quantity it sets, for display. */
  valueText: string;
  set(v: number): void;
}

/** XML attributes in output order. */
export type XmlAttrs = [string, string][];

/** Scope value selectors (Scope.VAL_*). */
export const ScopeValue = {
  voltage: 0,
  current: 3,
  power: 7,
  charge: 8,
} as const;

export abstract class CircuitElm {
  /** Type code in the text format (a character code, or a number). */
  static dumpType = 0;
  /** Tag in the XML format (defaults to the dump type character). */
  static get xmlTag(): string {
    const t = this.dumpType;
    return t > 64 && t < 127 ? String.fromCharCode(t) : this.name.replace("Elm", "");
  }

  // placement: (x, y) is where the user started, (x2, y2) where they dragged to
  x: number;
  y: number;
  x2: number;
  y2: number;
  flags: number;

  // derived geometry (recomputed by setPoints)
  dx = 0;
  dy = 0;
  dsign = 0;
  dn = 0;
  dpx1 = 0;
  dpy1 = 0;
  point1: GridPoint;
  point2: GridPoint;
  /** Ends of the wire stubs drawn inside simple two-terminal elements. */
  lead1: GridPoint | null = null;
  lead2: GridPoint | null = null;
  boundingBox: GridRect = { x: 0, y: 0, width: 0, height: 0 };
  noDiagonal = false;

  // simulation state
  sim!: Simulator;
  voltSource: VoltageSource | null = null;
  nodes: (CircuitNode | null)[] = [];
  /** Voltage at each node (posts first, then internal nodes). */
  volts: number[] = [];
  current = 0;
  /** Position of the animated current markers along the element. */
  curcount = 0;
  selected = false;
  /** The composite element (subcircuit chip) this element belongs to, if any. */
  parent: CircuitElm | null = null;

  constructor(xa: number, ya: number, xb: number, yb: number, f: number) {
    this.x = xa;
    this.y = ya;
    this.x2 = xb;
    this.y2 = yb;
    this.flags = f;
    this.point1 = pt(xa, ya);
    this.point2 = pt(xb, yb);
  }

  /** Defaults for a newly placed element (the Java "new element" constructor body). */
  initNew(): void {}

  /** Read the remaining fields of a text-format line (the Java undump constructor body). */
  readTokens(_st: TokenStream): void {}

  /** Read XML attributes; the element was created with initNew() beforehand. */
  undumpXml(xml: XmlNode): void {
    this.flags = xml.int("f", this.flags);
  }

  /** The element's line in the text format. */
  dump(): string {
    const t = (this.constructor as typeof CircuitElm).dumpType;
    return `${t < 127 ? String.fromCharCode(t) : t} ${this.x} ${this.y} ${this.x2} ${this.y2} ${this.flags}${this.dumpValues()}`;
  }

  /** Tokens after the common fields, each with a leading space. */
  dumpValues(): string {
    return "";
  }

  /** XML tag for saving. */
  xmlTag(): string {
    return (this.constructor as typeof CircuitElm).xmlTag;
  }

  /** XML attributes (x and f come first; subclasses append theirs). */
  dumpXml(attrs: XmlAttrs): void {
    attrs.push(["x", `${this.x} ${this.y} ${this.x2} ${this.y2}`], ["f", String(this.flags)]);
  }

  /**
   * State attributes (charges, currents, latched outputs): written after dumpXml() at the top
   * level, and alone (with "ix") for the children of a composite.
   */
  dumpXmlState(_a: XmlAttrs): void {}

  /** Child elements of the element's XML tag (kept verbatim: scope definitions, unported parts). */
  xmlChildren(): XmlNode[] {
    return [];
  }

  /** Text content of the element's XML tag, if it has any (routed wires store their route there). */
  xmlText(): string | null {
    return null;
  }

  /** Text content written as state (after xmlText(); memory contents). */
  xmlStateText(): string | null {
    return null;
  }

  /** False if the text format can't hold all of this element's settings (some are XML-only). */
  textLossless(): boolean {
    return true;
  }

  setPositionFromXml(xml: XmlNode): void {
    const s = xml.get("x");
    if (s === undefined) return;
    const xs = s.split(" ");
    if (xs.length < 4) throw new CircuitParseError(`bad x attribute '${s}'`);
    this.setPosition(JavaNumber.parseInt(xs[0]), JavaNumber.parseInt(xs[1]), JavaNumber.parseInt(xs[2]), JavaNumber.parseInt(xs[3]));
  }

  getDefaultFlags(): number {
    return 0;
  }

  /** NodeForge display-only reflection; legacy flags leave upstream geometry unchanged. */
  get geometryFlip(): number { return this.hasFlag(1 << 20) ? -1 : 1; }

  hasFlag(f: number): boolean {
    return (this.flags & f) !== 0;
  }

  initBoundingBox(): void {
    this.boundingBox = {
      x: Math.min(this.x, this.x2),
      y: Math.min(this.y, this.y2),
      width: Math.abs(this.x2 - this.x) + 1,
      height: Math.abs(this.y2 - this.y) + 1,
    };
  }

  /** Allocate the nodes/volts arrays, preserving voltages if the count did not change. */
  allocNodes(): void {
    const n = this.getNodeCount();
    if (this.nodes.length !== n) {
      this.nodes = new Array<CircuitNode | null>(n).fill(null);
      this.volts = new Array<number>(n).fill(0);
    }
  }

  /** Calculate post locations and other convenience values. Called whenever the element moves. */
  setPoints(): void {
    this.dx = this.x2 - this.x;
    this.dy = this.y2 - this.y;
    this.dn = Math.sqrt(this.dx * this.dx + this.dy * this.dy);
    this.dpx1 = this.dy / this.dn;
    this.dpy1 = -this.dx / this.dn;
    this.dsign = this.dy === 0 ? sign(this.dx) : sign(this.dy);
    this.point1 = pt(this.x, this.y);
    this.point2 = pt(this.x2, this.y2);
  }

  /** Calculate lead points for an element body of length `len`. */
  calcLeads(len: number): void {
    if (this.dn < len || len === 0) {
      this.lead1 = this.point1;
      this.lead2 = this.point2;
      return;
    }
    this.lead1 = interpPoint(this.point1, this.point2, (this.dn - len) / (2 * this.dn));
    this.lead2 = interpPoint(this.point1, this.point2, (this.dn + len) / (2 * this.dn));
  }

  /** Move the leads so the element body is centered on the grid. */
  adjustLeadsToGrid(flipX: boolean, flipY: boolean): void {
    const cx = Math.trunc((this.point1.x + this.point2.x) / 2), cy = Math.trunc((this.point1.y + this.point2.y) / 2);
    // when flipping, it changes the rounding direction.  need to adjust for this
    const adjx = snapGrid(cx + (flipX ? 1 : -1)) - cx, adjy = snapGrid(cy + (flipY ? 1 : -1)) - cy;
    this.lead1 = pt(this.lead1!.x + adjx, this.lead1!.y + adjy);
    this.lead2 = pt(this.lead2!.x + adjx, this.lead2!.y + adjy);
  }

  setPosition(x: number, y: number, x2: number, y2: number): void {
    this.x = x;
    this.y = y;
    this.x2 = x2;
    this.y2 = y2;
    this.initBoundingBox();
    this.setPoints();
  }

  getPostCount(): number {
    return 2;
  }
  getInternalNodeCount(): number {
    return 0;
  }
  getNodeCount(): number {
    return this.getPostCount() + this.getInternalNodeCount();
  }
  getVoltageSourceCount(): number {
    return 0;
  }
  getPostWidth(_n: number): number {
    return 1;
  }
  getBusWidth(): number {
    return 1;
  }
  /** Wires and labeled nodes take their bus width from what they're connected to. */
  setBusWidth(_w: number): void {}
  /** The label of a labeled node (labels with the same name share a bus width). */
  busLabel(): string | null {
    return null;
  }
  /** The bus side of a bus splitter: its post and width. */
  busSide(): { post: GridPoint; width: number } | null {
    return null;
  }

  getPost(n: number): GridPoint {
    return n === 0 ? this.point1 : this.point2;
  }

  /** The post a wire-like element connects through to (so wires can be merged out of the matrix). */
  getConnectedPost(_n = 0): GridPoint | null {
    return this.point2;
  }

  getNode(n: number): CircuitNode | null {
    return this.nodes[n] ?? null;
  }
  setNode(p: number, n: CircuitNode): void {
    this.nodes[p] = n;
  }

  /** The default only works for elements with exactly one voltage source. */
  setVoltageSource(_n: number, v: VoltageSource): void {
    this.voltSource = v;
  }

  getNodeAtPoint(p: GridPoint): number {
    for (let i = 0; i < this.getPostCount(); i++) if (samePoint(this.getPost(i), p)) return i;
    return 0;
  }

  /** Are posts n1 and n2 connected by this element? Used to find unconnected nodes and loops. */
  getConnection(_n1: number, _n2: number): boolean {
    return true;
  }
  /** Are n1 and n2 in the same matrix? Can differ from getConnection (e.g. MOSFET gates). */
  getMatrixConnection(n1: number, n2: number): boolean {
    return this.getConnection(n1, n2);
  }
  hasGroundConnection(_n1: number): boolean {
    return false;
  }
  isWireEquivalent(): boolean {
    return false;
  }
  isRemovableWire(): boolean {
    return false;
  }
  isIdealCapacitor(): boolean {
    return false;
  }
  nonLinear(): boolean {
    return false;
  }
  /** The part's own slider, if it has one. */
  partSlider(): PartSlider | null {
    return null;
  }

  /** Logic high level, for parts inside a subcircuit with its own setting. */
  setHighVoltage(_hv: number): void {}
  getChildElmList(): CircuitElm[] | null {
    return null;
  }
  setParentList(_list: CircuitElm[]): void {}

  // Kind tests (instead of instanceof, which would make the element modules import each other).
  isGround(): boolean {
    return false;
  }
  isWire(): boolean {
    return false;
  }
  /** VoltageElm and its subclasses (including rails). */
  isVoltageElm(): boolean {
    return false;
  }
  isRail(): boolean {
    return false;
  }
  isCurrentSource(): boolean {
    return false;
  }
  isInductor(): boolean {
    return false;
  }
  isSwitch(): boolean {
    return false;
  }
  isPlaceholder(): boolean {
    return false;
  }
  isLogicInput(): boolean {
    return false;
  }
  isBattery(): boolean {
    return false;
  }

  /** Wire-segment bookkeeping for wire-like elements. */
  getWireSegments(list: WireSegment[]): void {
    for (let b = 0; b < this.getBusWidth(); b++) {
      const p0 = this.getPost(b);
      const p1 = this.getConnectedPost(b);
      const ep1 = p1 && !samePoint(p1, p0) ? pointKey(p1) : null;
      list.push({ wire: this, bit: b, endpoint0: pointKey(p0), endpoint1: ep1, neighbors: [], labelNeighbors: [], post: 0, current: 0 });
    }
  }

  /** Handle the reset button. */
  reset(): void {
    for (let i = 0; i < this.getNodeCount(); i++) this.volts[i] = 0;
    this.curcount = 0;
  }

  /** Called before node allocation so composites can set up internal node counts. */
  preStamp(): void {}
  /** Stamp matrix values for linear elements (and the constant part of nonlinear ones). */
  stamp(): void {}
  /** Called once per timestep before the subiterations. */
  startIteration(): void {}
  /** Stamp the per-iteration (nonlinear / time-varying) parts of the matrix. */
  doStep(): void {}
  /** Called once the timestep has converged. */
  stepFinished(): void {}

  /**
   * NodeForge: this part's own tolerances (± percent by parameter: resistance, capacitance,
   * inductance, threshold, gain), where they differ from its type's defaults. Saved as an XML
   * attribute CircuitJS ignores.
   */
  tolerance: Record<string, number> | null = null;
  /**
   * NodeForge: a load: its power counts as the circuit's output in the power report (efficiency).
   * Saved as `nfload` (CircuitJS ignores it); nothing in the simulation reads it.
   */
  powerLoad = false;

  /** Check the element against the analyzed circuit. Return false to request re-analysis. */
  validate(): boolean {
    return true;
  }

  setNodeVoltage(n: number, c: number): void {
    this.volts[n] = c;
    this.calculateCurrent();
  }

  calculateCurrent(): void {}

  setCurrent(_vs: VoltageSource, c: number): void {
    this.current = c;
  }
  setWireCurrent(_bit: number, c: number): void {
    this.current = c;
  }

  getCurrent(): number {
    return this.current;
  }
  getVoltageDiff(): number {
    return this.volts[0] - this.volts[1];
  }
  getPower(): number {
    return this.getVoltageDiff() * this.current;
  }

  /** Current flowing into node n out of this element. */
  getCurrentIntoNode(n: number): number {
    // without the getPostCount() == 2 check rails give the wrong value
    if (n === 0 && this.getPostCount() === 2) return -this.current;
    return this.current;
  }

  getScopeValue(x: number): number {
    if (x === ScopeValue.current) return this.getCurrent();
    if (x === ScopeValue.power) return this.getPower();
    return this.getVoltageDiff();
  }
}
