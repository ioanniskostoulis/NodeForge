// One open circuit (a tab): its model, file, view, and the edit operations with undo/redo.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import {
  BatteryElm, BoxElm, ChipElm, Circuit, type CircuitElm, type CircuitFormat, constructElement, createNew, partClass, CrossSwitchElm, CustomTransformerElm, DCMotorElm, type ElmClass, GroundElm, GyratorElm, MosfetElm, RailElm, SwitchElm, ThreePhaseMotorElm, TappedTransformerElm, TransformerElm, TransLineElm, VoltageElm, WireElm, writeCircuit,
  AnalogSwitchElm, ComparatorElm, DarlingtonElm, DPDTSwitchElm, GateElm, MBBSwitchElm, NortonAmpElm, OpAmpElm, OpAmpRealElm, PotElm, RelayElm, SCRElm, Switch2Elm, TransistorElm, TriacElm, TriodeElm, TriStateElm, UnijunctionElm,
  chooseFormat, WattmeterElm, OTAElm, OptocouplerElm, MotorProtectionSwitchElm, SYMBOL_FLIP_X, SYMBOL_FLIP_Y, SYMBOL_SWAP_XY,
} from "../engine";
import { type ScopeRuntime, SimulationModel, type Snapshot } from "./model";
import { isTransformer, transformerHandles, type TransformerPart } from "./transformer-geometry";
import { chipLeadHandles, isLeadPart, type LeadPart } from "./chip-handles";
import { Viewport } from "forge-shell/app/viewport";
import { ConditionWatch, MessageLog } from "./messages";
import { untitledName } from "forge-shell/app/documents";

let nextDocId = 1;

/** Grid spacing in world units (CircuitJS gridSize; 8 with the small grid). */
export function gridSize(model: SimulationModel): number {
  return model.circuit.options.smallGrid ? 8 : 16;
}

export function snap(v: number, grid: number): number {
  return Math.round(v / grid) * grid;
}

/** Keep a component's span large enough for its symbol. Wires can still be one grid step. */
export function partEndAtMinimumSpan(e: CircuitElm, fixedX: number, fixedY: number,
  endX: number, endY: number, grid: number, fallbackX = endX, fallbackY = endY): [number, number] {
  if (isTransformer(e)) {
    const dx = endX - fixedX, dy = endY - fixedY;
    const vertical = Math.abs(dy) > Math.abs(dx);
    const distance = vertical ? dy : dx;
    const span = Math.max(2 * grid, 32, Math.abs(snap(distance, 2 * grid)));
    return vertical ? [fixedX, fixedY + (Math.sign(distance) || 1) * span]
      : [fixedX + (Math.sign(distance) || 1) * span, fixedY];
  }
  if (e instanceof WireElm) return [endX, endY];
  const minimum = e instanceof GroundElm || e.getPostCount() === 0 ? grid
    : Math.max(e instanceof ThreePhaseMotorElm || e instanceof OTAElm ? 96 : e instanceof DCMotorElm ? 48 : e instanceof CrossSwitchElm ? 64 : 32, 2 * grid);
  let dx = endX - fixedX, dy = endY - fixedY;
  const distance = Math.hypot(dx, dy);
  if (distance >= minimum) return [endX, endY];
  if (distance === 0) {
    dx = fallbackX - fixedX;
    dy = fallbackY - fixedY;
  }
  let directionLength = Math.hypot(dx, dy);
  if (directionLength === 0) {
    const [defaultX, defaultY] = defaultEnd(e.constructor as ElmClass, fixedX, fixedY);
    dx = defaultX - fixedX;
    dy = defaultY - fixedY;
    directionLength = Math.hypot(dx, dy);
  }
  if (directionLength === 0) return [endX, endY];
  let sx = snap(dx * minimum / directionLength, grid);
  let sy = snap(dy * minimum / directionLength, grid);
  if (Math.hypot(sx, sy) < minimum) {
    if (Math.abs(dx) >= Math.abs(dy)) sx += Math.sign(dx) * grid;
    else sy += Math.sign(dy) * grid;
  }
  return [fixedX + sx, fixedY + sy];
}

export class CircuitDocument {
  readonly id = nextDocId++;
  readonly model: SimulationModel;
  /** File the circuit was opened from or saved to (null for new or library circuits). */
  path: string | null;
  /** Tab name. */
  name: string;
  /** CircuitJS title for library circuits. */
  circuitTitle: string | null;
  format: CircuitFormat;
  dirty = false;
  /** Goes up with every change to the circuit (edits, undo, redo): what background analysis keys on. */
  revision = 0;
  /** The view of this tab: null keeps the circuit fitted to the window. */
  viewport: Viewport | null;
  /** What the app reported about this circuit (the Messages tab). */
  readonly messages = new MessageLog();
  /** Its part problems and stop message, logged once each as they appear. */
  readonly conditions = new ConditionWatch();
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  /** Snapshot taken when a drag started, committed when it ends. */
  private pending: Snapshot | null = null;

  constructor(text: string, opts: { path?: string | null; name?: string; title?: string | null; sample?: boolean } = {}) {
    this.model = new SimulationModel(text);
    // sample circuits start with every scope in a column of its own
    if (opts.sample) this.model.unstackScopes();
    this.path = opts.path ?? null;
    this.circuitTitle = opts.title ?? null;
    this.name = opts.name ?? (this.path ? this.path.split(/[\\/]/).pop()! : "Untitled 1");
    this.format = this.model.circuit.format;
    // an empty sheet starts at 100%; a loaded circuit is fitted to the window
    this.viewport = this.model.circuit.elements.length ? null : new Viewport(1, 40, 40);
  }

  /** A new empty sheet, numbered with the lowest "Untitled n" not used by the open tabs. */
  static empty(open: readonly CircuitDocument[] = []): CircuitDocument {
    const d = new CircuitDocument("", { name: untitledName(open) });
    // new circuits are built from real parts: each varies within its tolerance, by its own seed
    d.model.setTolerance(true, newSeed());
    // and saved as NodeForge's own file format
    d.format = d.model.circuit.format = "nfg";
    return d;
  }

  get isBlank(): boolean {
    return !this.dirty && !this.path && this.model.circuit.elements.length === 0;
  }

  get displayTitle(): string {
    return this.circuitTitle && this.circuitTitle !== this.name ? `${this.name}: ${this.circuitTitle}` : this.name;
  }

  /** Make a change as one undoable step. */
  edit(change: () => void): void {
    const before = this.model.snapshot();
    change();
    this.commit(before);
  }

  /** Start a change that happens over time (a drag); `endChange` records it. */
  beginChange(): void {
    this.pending ??= this.model.snapshot();
  }

  endChange(changed: boolean): void {
    const before = this.pending;
    this.pending = null;
    if (before && changed) this.commit(before);
    else this.model.circuitChanged();
  }

  private commit(before: Snapshot): void {
    // a change that changed nothing (a value set to what it was) isn't a step to undo
    const now = this.model.snapshot();
    if (now.text === before.text && JSON.stringify(now.designators) === JSON.stringify(before.designators)
      && JSON.stringify(now.triggers) === JSON.stringify(before.triggers)) {
      this.model.circuitChanged();
      return;
    }
    this.revision++;
    this.undoStack.push(before);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.dirty = true;
    this.model.circuitChanged();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.model.snapshot());
    this.model.restore(s);
    this.dirty = true;
    this.revision++;
  }

  redo(): void {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.model.snapshot());
    this.model.restore(s);
    this.dirty = true;
    this.revision++;
  }

  /** The file contents to save, in the document's format unless that would lose something. */
  serialize(): { text: string; format: CircuitFormat } {
    return this.model.serialize(this.format);
  }

  markSaved(path: string | null, format: CircuitFormat): void {
    if (path) {
      this.path = path;
      this.name = path.split(/[\\/]/).pop()!;
      this.circuitTitle = null;
    }
    this.format = format;
    this.model.circuit.format = format;
    this.dirty = false;
  }
}

/** Where a newly placed part ends when it's clicked rather than dragged out. */
export function defaultEnd(C: ElmClass, x: number, y: number): [number, number] {
  const isa = (Base: abstract new (...a: never[]) => CircuitElm) => C === Base || C.prototype instanceof Base;
  if (isa(GroundElm)) return [x, y + 32];
  // 1-terminal sources lie horizontally like most parts: terminal on the left, symbol on the right
  if (isa(RailElm)) return [x + 48, y];
  if (isa(VoltageElm)) return [x, y - 64];
  if (isa(MosfetElm)) return [x + 32, y];
  // a box is drawn corner to corner: give it height as well
  if (isa(BoxElm)) return [x + 64, y + 64];
  return [x + 64, y];
}

/**
 * Transformers and gyrators keep one axis (a vertical flag): set it from the part's
 * direction, so placing one vertically or rotating it doesn't collapse it to a point.
 */
export function alignAxis(e: CircuitElm): void {
  const flag = e instanceof TransformerElm ? TransformerElm.FLAG_VERTICAL : e instanceof GyratorElm ? GyratorElm.FLAG_VERTICAL
    : e instanceof CustomTransformerElm ? CustomTransformerElm.FLAG_VERTICAL : 0;
  if (!flag) return;
  const vertical = e.x === e.x2 && e.y !== e.y2, horizontal = e.y === e.y2 && e.x !== e.x2;
  if (!vertical && !horizontal) return;
  const flags = vertical ? e.flags | flag : e.flags & ~flag;
  if (flags === e.flags) return;
  e.flags = flags;
  e.setPoints();
}

/**
 * A part being dragged out from (x, y) to the grid point (ex, ey), as the mouse places it: parts
 * without diagonals keep the longer axis, every part keeps its minimum span, and transformers and
 * gyrators follow the direction.
 */
export function dragPart(e: CircuitElm, C: ElmClass, x: number, y: number, ex: number, ey: number, grid: number): void {
  if (e instanceof TransLineElm) {
    // TransLineElm.drag: the sideways extent of the drag is the width (one grid step at least);
    // with no width its two ends would each be one shorted terminal
    const across = Math.max(grid, Math.abs(ey - y)), along = Math.max(grid, Math.abs(ex - x));
    if (across > along) { ex = x; e.width = along; } else { ey = y; e.width = across; }
  }
  if (e instanceof BoxElm) {
    // drawn corner to corner: a straight drag would make it a line, so keep one grid step across
    if (Math.abs(ex - x) < grid) ex = x + (ex < x ? -grid : grid);
    if (Math.abs(ey - y) < grid) ey = y + (ey < y ? -grid : grid);
  }
  if (e.noDiagonal) {
    if (Math.abs(ex - x) > Math.abs(ey - y)) ey = y;
    else ex = x;
  }
  const [defaultX, defaultY] = defaultEnd(C, x, y);
  [ex, ey] = partEndAtMinimumSpan(e, x, y, ex, ey, grid, defaultX, defaultY);
  if (plusFirst(e)) e.setPosition(ex, ey, x, y);
  else e.setPosition(x, y, ex, ey);
  alignAxis(e);
}

/**
 * Voltage sources and batteries are placed + first: their + terminal (point2 in CircuitJS) goes
 * where the drag starts, so they read + − in the drag direction.
 */
function plusFirst(e: CircuitElm): boolean {
  return (e instanceof VoltageElm && !(e instanceof RailElm)) || e instanceof BatteryElm;
}

/** Create a part from (x1, y1) to (x2, y2) and add it to the circuit. */
export function addPart(model: SimulationModel, C: ElmClass, x1: number, y1: number, x2: number, y2: number, className?: string): CircuitElm {
  // by class name when given: it also covers aliases and built-in subcircuits ("CustomCompositeElm:~TL431")
  // as the class a circuit's own part is created as when read from a file (a diode, MOSFET, transistor
  // or JFET as the NodeForge engine's SPICE class, with its models, heatsink and Tj), not CircuitJS's own
  const built = className ? constructElement(className, x1, y1) : null;
  const S = built && partClass(built.constructor as ElmClass);
  const e = built && S === built.constructor ? built : createNew(S ?? C, x1, y1);
  // a new switch starts open, as its icon shows (CircuitJS places it closed; files keep their state)
  if (e.constructor === SwitchElm) (e as SwitchElm).position = 1;
  e.setPosition(x1, y1, x2, y2);
  if (x1 !== x2 || y1 !== y2) {
    const [endX, endY] = partEndAtMinimumSpan(e, x1, y1, x2, y2, gridSize(model));
    if (plusFirst(e)) e.setPosition(endX, endY, x1, y1);
    else if (endX !== x2 || endY !== y2) e.setPosition(x1, y1, endX, endY);
  }
  alignAxis(e);
  model.circuit.elements.push(e);
  return e;
}

/** Wires drawn diagonally become an L: horizontal first, then vertical. */
export function addWire(model: SimulationModel, x1: number, y1: number, x2: number, y2: number): CircuitElm[] {
  if (x1 === x2 || y1 === y2) return [addPart(model, WireElm, x1, y1, x2, y2)];
  return [addPart(model, WireElm, x1, y1, x2, y1), addPart(model, WireElm, x2, y1, x2, y2)];
}

export function deleteSelection(model: SimulationModel): void {
  model.circuit.elements = model.circuit.elements.filter((e) => !model.selection.has(e));
  model.selection.clear();
}

/** Remove parts with both ends in one place (a click with the wire tool, or a part dragged onto itself). */
export function removeDegenerate(model: SimulationModel): void {
  model.circuit.elements = model.circuit.elements.filter((e) => e.x !== e.x2 || e.y !== e.y2);
}

/**
 * A move in progress: the selected parts move by the drag offset and nothing else does, so a
 * part dragged away leaves its connections behind (as in CircuitJS).
 */
export class MoveOperation {
  private readonly start = new Map<CircuitElm, [number, number, number, number]>();

  constructor(private readonly model: SimulationModel, private readonly moving: CircuitElm[]) {
    for (const e of moving) this.start.set(e, [e.x, e.y, e.x2, e.y2]);
  }

  apply(dx: number, dy: number): void {
    dx = snap(dx, gridSize(this.model)); dy = snap(dy, gridSize(this.model));
    for (const e of this.moving) {
      const [x, y, x2, y2] = this.start.get(e)!;
      e.setPosition(x + dx, y + dy, x2 + dx, y2 + dy);
    }
    this.model.geometryChanged();
  }

  get moved(): boolean {
    return this.moving.some((e) => this.start.get(e)![0] !== e.x || this.start.get(e)![1] !== e.y);
  }
}

/** Dragging one end of a two-terminal part (stretching a wire, re-routing a resistor). */
export class EndpointOperation {
  private readonly startX: number;
  private readonly startY: number;
  private readonly handleX: number;
  private readonly handleY: number;
  private readonly original: [number, number, number, number];

  constructor(private readonly model: SimulationModel, readonly elm: CircuitElm, readonly end: 1 | 2,
    handle?: { x: number; y: number }) {
    this.original = [elm.x, elm.y, elm.x2, elm.y2];
    this.startX = end === 1 ? elm.x : elm.x2;
    this.startY = end === 1 ? elm.y : elm.y2;
    this.handleX = handle?.x ?? this.startX;
    this.handleY = handle?.y ?? this.startY;
  }

  apply(x: number, y: number): void {
    const e = this.elm;
    const grid = gridSize(this.model);
    x = this.startX + snap(x - this.handleX, grid);
    y = this.startY + snap(y - this.handleY, grid);
    if (isFixedBody(e)) {
      const [x1, y1, x2, y2] = this.original, dx = x - this.startX, dy = y - this.startY;
      e.setPosition(x1 + dx, y1 + dy, x2 + dx, y2 + dy);
      this.model.geometryChanged();
      return;
    }
    if (e.noDiagonal) {
      const [ox, oy] = this.end === 1 ? [e.x2, e.y2] : [e.x, e.y];
      if (Math.abs(x - ox) > Math.abs(y - oy)) y = oy;
      else x = ox;
    }
    const [ox, oy] = this.end === 1 ? [e.x2, e.y2] : [e.x, e.y];
    [x, y] = partEndAtMinimumSpan(e, ox, oy, x, y, grid,
      this.startX, this.startY);
    if (this.end === 1) e.setPosition(x, y, e.x2, e.y2);
    else e.setPosition(e.x, e.y, x, y);
    this.model.geometryChanged();
  }

  get moved(): boolean {
    const e = this.elm;
    return (this.end === 1 ? [e.x, e.y] : [e.x2, e.y2]).some((v, i) => v !== [this.startX, this.startY][i]);
  }
}

/** Resize the visible windings along the core, keeping the opposite core end fixed. */
export class TransformerResizeOperation {
  private readonly startX: number;
  private readonly startY: number;
  private readonly startX2: number;
  private readonly startY2: number;
  private readonly startWidth: number;
  private readonly startHandle: { x: number; y: number };
  private readonly fixedBottom: { x: number; y: number };
  private readonly axis: { x: number; y: number };
  private readonly normal: { x: number; y: number };
  private readonly widthSide: number;
  private readonly widthScale: number;

  constructor(private readonly model: SimulationModel, readonly elm: TransformerPart,
    readonly handle: { kind: "top" | "bottom" }) {
    this.startX = elm.x;
    this.startY = elm.y;
    this.startX2 = elm.x2;
    this.startY2 = elm.y2;
    this.startWidth = elm.width;
    const dx = elm.point2.x - elm.point1.x, dy = elm.point2.y - elm.point1.y;
    const distance = Math.hypot(dx, dy) || 1;
    this.axis = { x: dx / distance, y: dy / distance };
    this.normal = { x: -this.axis.y, y: this.axis.x };
    const handles = transformerHandles(elm);
    this.startHandle = handles[handle.kind];
    this.fixedBottom = handles.bottom;
    this.widthSide = handles.widthSide;
    this.widthScale = handles.widthScale;
  }

  apply(x: number, y: number): void {
    const dx = x - this.startHandle.x, dy = y - this.startHandle.y;
    this.resizeWinding(this.handle.kind, dx * this.normal.x + dy * this.normal.y);
    this.model.geometryChanged();
  }

  private resizeWinding(edge: "top" | "bottom", distance: number): void {
    const e = this.elm;
    const direction = edge === "top" ? -this.widthSide : this.widthSide;
    const delta = Math.round(distance * direction / (this.widthScale * 16)) * 16;
    const width = Math.max(e instanceof CustomTransformerElm ? 16 : 32, Math.abs(this.startWidth) + delta);
    e.width = (Math.sign(this.startWidth) || 1) * width;
    if (edge === "top") {
      e.setPosition(this.startX, this.startY, this.startX2, this.startY2);
      const bottom = transformerHandles(e).bottom;
      const dx = this.fixedBottom.x - bottom.x, dy = this.fixedBottom.y - bottom.y;
      e.setPosition(this.startX + dx, this.startY + dy, this.startX2 + dx, this.startY2 + dy);
    } else e.setPoints();
  }

  get moved(): boolean {
    return this.elm.x !== this.startX || this.elm.y !== this.startY || this.elm.x2 !== this.startX2
      || this.elm.y2 !== this.startY2 || this.elm.width !== this.startWidth;
  }
}

/**
 * A transformer dragged by a lead's end. Taken out around the part, it turns (in quarter turns, about
 * its center as Rotate does) so the lead's side faces the pointer; along the leads, it changes its
 * width (the span between primary and secondary leads) in grid steps. The other side stays put; the
 * core and windings stay in the middle. The windings' height is the core handles'.
 */
export class TransformerLeadOperation {
  private readonly start: { x: number; y: number; x2: number; y2: number; flags: number };
  /** The part's turning center. */
  private readonly center: [number, number];
  /** The part's outline at the start: inside it the pointer only changes the width. */
  private readonly box: { x0: number; y0: number; x1: number; y1: number };
  /** Whether the lead is on the point1 (x, y) side. */
  private readonly firstSide: boolean;
  /** The angle the lead's side faces at the start (outward along the leads). */
  private readonly angle: number;

  constructor(private readonly model: SimulationModel, readonly elm: TransformerPart, readonly index: number) {
    this.start = { x: elm.x, y: elm.y, x2: elm.x2, y2: elm.y2, flags: elm.flags };
    const grid = gridSize(model), p = elm.getPost(index), a = unitAxis(elm);
    const mx = (elm.point1.x + elm.point2.x) / 2, my = (elm.point1.y + elm.point2.y) / 2;
    this.firstSide = (p.x - mx) * a.x + (p.y - my) * a.y < 0;
    const out = this.firstSide ? -1 : 1;
    this.angle = Math.atan2(a.y * out, a.x * out);
    this.center = partCenter(elm, grid, true);
    const posts = Array.from({ length: elm.getPostCount() }, (_, i) => elm.getPost(i));
    const xs = posts.map((q) => q.x), ys = posts.map((q) => q.y), m = grid / 2;
    this.box = { x0: Math.min(...xs) - m, y0: Math.min(...ys) - m, x1: Math.max(...xs) + m, y1: Math.max(...ys) + m };
  }

  apply(x: number, y: number): void {
    const e = this.elm, s = this.start, grid = gridSize(this.model), b = this.box;
    e.flags = s.flags;
    e.setPosition(s.x, s.y, s.x2, s.y2);
    // outside the part, the quarter turns that bring the lead's side round to face the pointer
    const [cx, cy] = this.center;
    const inside = x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
    const turns = inside ? 0 : (((Math.round((Math.atan2(y - cy, x - cx) - this.angle) / (Math.PI / 2))) % 4) + 4) % 4;
    for (let i = 0; i < turns; i++) turnPart(e, (px, py) => [cx - (py - cy), cy + (px - cx)], true);
    // then the width: the lead's side moves out or in along the leads as far as the pointer is past the lead
    const a = unitAxis(e), lead = e.getPost(this.index);
    const past = ((x - lead.x) * a.x + (y - lead.y) * a.y) * (this.firstSide ? -1 : 1);
    const p1 = e.point1, p2 = e.point2, span = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    // in grid steps; the core stays in the middle, between grid dots when the span is an odd number of steps
    const width = Math.abs(past) < grid / 2 ? span : Math.max(2 * grid, 32, span + snap(past, grid));
    if (width !== span) {
      if (this.firstSide) e.setPosition(p2.x - a.x * width, p2.y - a.y * width, p2.x, p2.y);
      else e.setPosition(p1.x, p1.y, p1.x + a.x * width, p1.y + a.y * width);
      alignAxis(e);
    }
    this.model.geometryChanged();
  }

  get moved(): boolean {
    const e = this.elm, s = this.start;
    return e.x !== s.x || e.y !== s.y || e.x2 !== s.x2 || e.y2 !== s.y2 || e.flags !== s.flags;
  }
}

/** A transformer's lead-to-lead direction, as a unit vector. */
function unitAxis(e: TransformerPart): { x: number; y: number } {
  const dx = e.point2.x - e.point1.x, dy = e.point2.y - e.point1.y, d = Math.hypot(dx, dy) || 1;
  return { x: dx / d, y: dy / d };
}

/** Extend every pin lead on one physical side without changing the chip box. */
export class ChipLeadResizeOperation {
  private readonly start: number;
  private readonly x: number;
  private readonly y: number;

  constructor(private readonly model: SimulationModel, readonly elm: LeadPart, readonly side: number, readonly index: number) {
    this.start = elm.leadExtensions[side] ?? 0;
    const handle = chipLeadHandles(elm).find((h) => h.index === index)!;
    this.x = handle.x;
    this.y = handle.y;
  }

  apply(x: number, y: number): void {
    const direction = this.side === 0 ? -1 : this.side === 1 ? 1 : this.side === 2 ? -1 : 1;
    const distance = this.side < 2 ? y - this.y : x - this.x;
    this.elm.leadExtensions[this.side] = Math.max(0, this.start + Math.round(distance * direction / 16) * 16);
    this.elm.setPoints();
    this.model.geometryChanged();
  }

  get moved(): boolean { return this.elm.leadExtensions[this.side] !== this.start; }
}

/**
 * The center a single (non-chip) part turns about. An odd number of grid cells needs a half-cell
 * pivot on both axes; its offset follows the part's normal, so repeated quarter turns don't walk
 * across the sheet.
 */
function partCenter(e: CircuitElm, grid: number, rotating = false): [number, number] {
  const points = e.getPostCount() > 2 ? Array.from({ length: e.getPostCount() }, (_, i) => e.getPost(i)) : [e.point1, e.point2];
  let cx = (Math.min(...points.map(p => p.x)) + Math.max(...points.map(p => p.x))) / 2;
  let cy = (Math.min(...points.map(p => p.y)) + Math.max(...points.map(p => p.y))) / 2;
  if (rotating && Math.abs(cx / grid % 1) !== Math.abs(cy / grid % 1)) {
    if (e.dy === 0) cy += Math.sign(e.dx) * grid / 2;
    else if (e.dx === 0) cx -= Math.sign(e.dy) * grid / 2;
    else return [snap(cx, grid), snap(cy, grid)];
  }
  return [cx, cy];
}

function selectionCenter(model: SimulationModel, grid: number, rotating = false): [number, number] {
  const els = [...model.selection];
  if (els.length === 1 && !isLeadPart(els[0]) && !isFixedBody(els[0])) return partCenter(els[0], grid, rotating);
  if (els.length === 1 && isLeadPart(els[0])) {
    const e = els[0], b = e.boundingBox;
    let cx = b.x + (b.width - 1) / 2, cy = b.y + (b.height - 1) / 2;
    if (rotating && Math.abs(cx / grid % 1) !== Math.abs(cy / grid % 1)) {
      if (cx % grid) cy += (e.flags & ChipElm.FLAG_FLIP_Y ? -1 : 1) * grid / 2;
      else cx += (e.flags & ChipElm.FLAG_FLIP_X ? -1 : 1) * grid / 2;
    }
    return [cx, cy];
  }
  // a chip is placed by one corner; its box is what turns
  const xs = els.flatMap((e) => (isLeadPart(e) || isFixedBody(e) ? [e.boundingBox.x, e.boundingBox.x + e.boundingBox.width - 1] : [e.x, e.x2]));
  const ys = els.flatMap((e) => (isLeadPart(e) || isFixedBody(e) ? [e.boundingBox.y, e.boundingBox.y + e.boundingBox.height - 1] : [e.y, e.y2]));
  return [snap((Math.min(...xs) + Math.max(...xs)) / 2, grid), snap((Math.min(...ys) + Math.max(...ys)) / 2, grid)];
}

// These symbols historically choose a perpendicular side from the drawing direction.
function isFixedBody(e: CircuitElm): boolean { return e instanceof OptocouplerElm || e instanceof MotorProtectionSwitchElm; }

/** The perpendicular-side convention of each non-chip symbol, before its display flip. */
function normalRule(e: CircuitElm): { side: number; flag: number } | null {
  const direction = Math.sign(e.dy === 0 ? e.dx : e.dy), geometry = 1 << 20;
  if (e instanceof TransLineElm || e instanceof WattmeterElm) return { side: e.dy === 0 ? Math.sign(e.dx) : -Math.sign(e.dy), flag: geometry };
  if (e instanceof ThreePhaseMotorElm) return { side: Math.abs(e.dy) > Math.abs(e.dx) ? -1 : 1, flag: geometry };
  const flag = e instanceof TransformerElm ? TransformerElm.FLAG_FLIP
    : e instanceof GyratorElm ? GyratorElm.FLAG_FLIP
    : e instanceof MosfetElm ? MosfetElm.FLAG_FLIP
    : e instanceof TransistorElm ? TransistorElm.FLAG_FLIP
    : e instanceof RelayElm ? RelayElm.FLAG_FLIP
    : e instanceof UnijunctionElm ? UnijunctionElm.FLAG_FLIP
    : e instanceof OpAmpElm ? OpAmpElm.FLAG_SWAP
    : e instanceof ComparatorElm ? ComparatorElm.FLAG_SWAP
    : e instanceof NortonAmpElm ? NortonAmpElm.FLAG_SWAP
    : e instanceof OTAElm ? OTAElm.FLAG_INPUT_FLIP
    : e instanceof DarlingtonElm || e instanceof OpAmpRealElm ? geometry : 0;
  if (flag) return { side: direction, flag };
  if (e instanceof TriodeElm) return { side: e.hasFlag(TriodeElm.FLAG_DSIGN_FIX) ? direction : 1, flag: TriodeElm.FLAG_FLIP };
  if (e instanceof CustomTransformerElm) return { side: 1, flag: CustomTransformerElm.FLAG_FLIP };
  if (e instanceof TappedTransformerElm) return { side: 1, flag: TappedTransformerElm.FLAG_FLIP };
  if (e instanceof Switch2Elm || e instanceof DPDTSwitchElm || e instanceof MBBSwitchElm || e instanceof CrossSwitchElm || e instanceof GateElm || e instanceof PotElm || e instanceof SCRElm || e instanceof TriacElm) return { side: 1, flag: geometry };
  return null;
}

/** Grid-rounded control leads use the same physical X/Y orientation as chip pins. */
function orientControlLead(e: CircuitElm, cw: boolean | null, horizontal = false): void {
  const analog = e instanceof AnalogSwitchElm;
  if (!analog && !(e instanceof TriStateElm)) return;
  const x = analog ? AnalogSwitchElm.FLAG_FLIPPED_X : TriStateElm.FLAG_FLIP_X;
  const y = analog ? AnalogSwitchElm.FLAG_FLIPPED_Y : TriStateElm.FLAG_FLIP_Y;
  if (cw === null) e.flags ^= horizontal ? x : y;
  else {
    const fx = !!(e.flags & x), fy = !!(e.flags & y);
    e.flags = (e.flags & ~(x | y)) | ((cw ? !fy : fy) ? x : 0) | ((cw ? fx : !fx) ? y : 0);
  }
  if (analog && cw !== null) e.flags ^= AnalogSwitchElm.FLAG_FLIPPED;
  if (!analog && cw === null) e.flags ^= TriStateElm.FLAG_FLIP;
  e.setPoints();
}

/** Rotate the selection 90° about its center (clockwise on screen when `cw`). */
export function rotateSelection(model: SimulationModel, cw: boolean, grid: number): void {
  const [cx, cy] = selectionCenter(model, grid, true);
  const rot = (x: number, y: number): [number, number] => (cw ? [cx - (y - cy), cy + (x - cx)] : [cx + (y - cy), cy - (x - cx)]);
  for (const e of model.selection) {
    if (isFixedBody(e)) {
      const fx = !!(e.flags & SYMBOL_FLIP_X), fy = !!(e.flags & SYMBOL_FLIP_Y);
      e.flags ^= SYMBOL_SWAP_XY;
      e.flags = (e.flags & ~(SYMBOL_FLIP_X | SYMBOL_FLIP_Y)) | ((cw ? !fy : fy) ? SYMBOL_FLIP_X : 0) | ((cw ? fx : !fx) ? SYMBOL_FLIP_Y : 0);
      keepChipCenter(e, rot, grid);
      continue;
    }
    if (isLeadPart(e)) {
      // swap axes, then flip X / Y (CircuitJS's chip flags): a quarter turn of the box and pins
      const fx = !!(e.flags & ChipElm.FLAG_FLIP_X), fy = !!(e.flags & ChipElm.FLAG_FLIP_Y);
      const xy = !!(e.flags & ChipElm.FLAG_FLIP_XY);
      const [n, s, w, east] = e.leadExtensions;
      e.leadExtensions = cw ? [w, east, s, n] : [east, w, n, s];
      setChipFlags(e, !xy, cw ? !fy : fy, cw ? fx : !fx);
      keepChipCenter(e, rot, grid);
      continue;
    }
    turnPart(e, rot, cw);
  }
}

/** A quarter turn of a two-point part by `rot`, keeping the side its symbol faces. */
function turnPart(e: CircuitElm, rot: (x: number, y: number) => [number, number], cw: boolean): void {
  const rule = normalRule(e);
  const [x, y] = rot(e.x, e.y), [x2, y2] = rot(e.x2, e.y2);
  e.setPosition(x, y, x2, y2);
  alignAxis(e);
  if (rule && rule.side !== normalRule(e)!.side) { e.flags ^= rule.flag; e.setPoints(); }
  orientControlLead(e, cw);
}

function setChipFlags(e: LeadPart, xy: boolean, x: boolean, y: boolean): void {
  const bits = (on: boolean, flag: number) => (on ? flag : 0);
  e.flags = (e.flags & ~(ChipElm.FLAG_FLIP_X | ChipElm.FLAG_FLIP_Y | ChipElm.FLAG_FLIP_XY))
    | bits(xy, ChipElm.FLAG_FLIP_XY) | bits(x, ChipElm.FLAG_FLIP_X) | bits(y, ChipElm.FLAG_FLIP_Y);
}

/** After a chip's flags change, move it so its center goes where `map` sends the old center. */
function keepChipCenter(e: CircuitElm, map: (x: number, y: number) => [number, number], grid: number): void {
  const center = (): [number, number] => {
    const b = e.boundingBox;
    return [b.x + (b.width - 1) / 2, b.y + (b.height - 1) / 2];
  };
  const [tx, ty] = map(...center());
  e.setPoints();
  const [nx, ny] = center();
  const dx = snap(tx - nx, grid), dy = snap(ty - ny, grid);
  e.setPosition(e.x + dx, e.y + dy, e.x2 + dx, e.y2 + dy);
}

/** Mirror the selection left-right (or top-bottom). */
export function flipSelection(model: SimulationModel, horizontal: boolean, grid: number): void {
  const [cx, cy] = selectionCenter(model, grid);
  const mirror = (x: number, y: number): [number, number] => (horizontal ? [2 * cx - x, y] : [x, 2 * cy - y]);
  for (const e of model.selection) {
    if (isFixedBody(e)) {
      e.flags ^= horizontal ? SYMBOL_FLIP_X : SYMBOL_FLIP_Y;
      keepChipCenter(e, mirror, grid);
      continue;
    }
    if (isLeadPart(e)) {
      const fx = !!(e.flags & ChipElm.FLAG_FLIP_X), fy = !!(e.flags & ChipElm.FLAG_FLIP_Y);
      const [n, s, w, east] = e.leadExtensions;
      e.leadExtensions = horizontal ? [n, s, east, w] : [s, n, w, east];
      setChipFlags(e, !!(e.flags & ChipElm.FLAG_FLIP_XY), horizontal ? !fx : fx, horizontal ? fy : !fy);
      keepChipCenter(e, mirror, grid);
      continue;
    }
    const rule = normalRule(e);
    if (horizontal) e.setPosition(2 * cx - e.x, e.y, 2 * cx - e.x2, e.y2);
    else e.setPosition(e.x, 2 * cy - e.y, e.x2, 2 * cy - e.y2);
    if (rule && rule.side === normalRule(e)!.side) e.flags ^= rule.flag;
    if (e instanceof OTAElm) e.flags ^= OTAElm.FLAG_BIAS_FLIP;
    e.setPoints();
    orientControlLead(e, null, horizontal);
  }
}

/** The selection as circuit text (CircuitJS's clipboard format), or null if nothing is selected. */
export function copySelection(model: SimulationModel): string | null {
  const els = model.circuit.elements.filter((e) => model.selection.has(e));
  if (!els.length) return null;
  const c = new Circuit();
  c.options = { ...model.circuit.options };
  c.elements = els;
  return writeCircuit(c, chooseFormat(c, "text"));
}

/** Add clipboard text to the circuit, offset by (dx, dy), and select what was added. */
export function pasteText(model: SimulationModel, text: string, dx: number, dy: number): CircuitElm[] {
  const c = Circuit.parse(text);
  for (const e of c.elements) e.setPosition(e.x + dx, e.y + dy, e.x2 + dx, e.y2 + dy);
  model.circuit.elements.push(...c.elements);
  model.selection.clear();
  for (const e of c.elements) model.selection.add(e);
  return c.elements;
}

/** Where pasted parts go: next to the originals, or (with a point) centered there. */
export function pasteOffset(text: string, at: [number, number] | null, grid: number): [number, number] {
  if (!at) return [grid * 2, grid * 2];
  const c = Circuit.parse(text);
  const xs = c.elements.flatMap((e) => [e.x, e.x2]), ys = c.elements.flatMap((e) => [e.y, e.y2]);
  if (!xs.length) return [0, 0];
  return [snap(at[0] - (Math.min(...xs) + Math.max(...xs)) / 2, grid), snap(at[1] - (Math.min(...ys) + Math.max(...ys)) / 2, grid)];
}

export type { ScopeRuntime };

/** A seed for a circuit's tolerances (1–99999). */
export function newSeed(): number {
  return 1 + Math.floor(Math.random() * 99999);
}
