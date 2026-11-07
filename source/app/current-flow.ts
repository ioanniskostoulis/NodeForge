// Current-flow presentation, independent of solver state and display theme.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import {
  ChipElm, type CircuitElm, CustomTransformerElm, type GridPoint, GateElm, GroundElm, InverterElm, MosfetElm, PotElm, RailElm,
  RoutedWireElm, TappedTransformerElm, TransformerElm, TransistorElm, WireElm,
} from "../engine";
import { windingPoints } from "./transformer-geometry";
import type { P } from "./geom";

export type CurrentShape = "dots" | "arrows" | "squares";
export const CURRENT_SHAPES: CurrentShape[] = ["dots", "arrows", "squares"];
export const FLOW_SPACING = 24; // normalized phase period
export const MARKER_SPACING = FLOW_SPACING * 1.2; // circuit units; zoom never changes population
const BASE_SPEED = 50; // phase units per second at 1× for the reference current
const MARKER_TO_WIRE = 1.8;
const DOT_DIAMETER = 4.2;
const FAST_ENTER = 160;
const FAST_EXIT = 130;
const CURRENT_FLOOR = 1e-9;

export interface FlowPath {
  id: string;
  points: GridPoint[];
  /** Conventional current along points, in amps. */
  current: number;
  /** Segment indexes to display (omit the body of a two-terminal symbol). */
  segments?: number[];
  /** Every segment is a lead captured from the symbol renderer. */
  visibleConductor?: boolean;
}
export interface VisibleLead { terminal: number; a: P; b: P }
export interface FlowMarker { x: number; y: number; dx: number; dy: number; }
type FlowPoint = Pick<FlowMarker, "x" | "y">;
interface PathEntry { elm: CircuitElm; path: FlowPath; length: number; }
interface PathLink { entry: PathEntry; end: number; }
interface FlowConnection { root: PathEntry; sign: number; offset: number; loopLength: number; }
const positionKey = (p: FlowPoint): string => `${p.x},${p.y}`;

/** Original chevron: 2.6 long and 4.8 wide, centered on the conductor. */
export function chevronPoints(m: FlowMarker, size: number): [FlowPoint, FlowPoint, FlowPoint] {
  const halfLength = 1.3 * size, halfWidth = 2.4 * size;
  const bx = m.x - m.dx * halfLength, by = m.y - m.dy * halfLength;
  return [
    { x: bx - m.dy * halfWidth, y: by + m.dx * halfWidth },
    { x: m.x + m.dx * halfLength, y: m.y + m.dy * halfLength },
    { x: bx + m.dy * halfWidth, y: by - m.dx * halfWidth },
  ];
}

export function currentShape(value: string): CurrentShape | null {
  const plural = value.endsWith("s") ? value : value + "s";
  return CURRENT_SHAPES.includes(plural as CurrentShape) ? plural as CurrentShape : null;
}

/** World dimensions: the same marker-to-wire proportion at every zoom (including thin light strokes). */
export function markerMetrics(zoom: number, wireWidth: number): { size: number; dotRadius: number; chevronSize: number; spacing: number; bandWidth: number } {
  const size = wireWidth * MARKER_TO_WIRE / DOT_DIAMETER;
  // Chevron width includes the round stroke: 4.8 geometry + 1.4 stroke.
  return { size, dotRadius: wireWidth, chevronSize: wireWidth * 3 / 6.2,
    spacing: MARKER_SPACING, bandWidth: Math.max(2.8 / zoom, wireWidth * 1.35) };
}

/** Only actual visible, conducting segments; never run a band through the symbol body. */
export function pathSegments(path: FlowPath): [GridPoint, GridPoint][] {
  if (!Number.isFinite(path.current) || Math.abs(path.current) < CURRENT_FLOOR) return [];
  return path.points.slice(0, -1).flatMap((a, n): [GridPoint, GridPoint][] => {
    const b = path.points[n + 1];
    if (!a || !b || (path.segments && !path.segments.includes(n)) || !Number.isFinite(Math.hypot(b.x - a.x, b.y - a.y)) || (a.x === b.x && a.y === b.y)) return [];
    return [[a, b]];
  });
}

/** One stationary direction cue per visible straight segment; never crowd a short lead. */
export function steadyMarkers(path: FlowPath, electron: boolean, minimumLength: number): FlowMarker[] {
  const sign = Math.sign(path.current) * (electron ? -1 : 1);
  return pathSegments(path).flatMap(([a, b]) => {
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (length < minimumLength) return [];
    return [{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, dx: dx / length * sign, dy: dy / length * sign }];
  });
}

/** Terminal APIs report current OUT of a part; paths from the terminal toward its body use -I. */
export function currentPaths(elm: CircuitElm): FlowPath[] {
  const lead = (n: number, points: GridPoint[]): FlowPath => ({ id: `terminal:${n}`, points, current: -elm.getCurrentIntoNode(n) });
  if (elm instanceof GateElm) {
    const last = elm.inputCount;
    // Ideal logic inputs draw no current. The output source's lead can conduct.
    return elm.lead2 ? [lead(last, [elm.point2, elm.lead2])] : [];
  }
  if (elm instanceof InverterElm) return elm.lead2 ? [lead(1, [elm.point2, elm.lead2])] : [];
  if (elm instanceof RoutedWireElm) return [lead(0, elm.routePoints ?? [elm.point1, elm.point2])];
  if (elm instanceof WireElm) return [lead(0, [elm.point1, elm.point2])];
  if (elm instanceof MosfetElm) {
    if (elm.src.length < 2 || elm.drn.length < 2 || elm.gate.length < 2) return [];
    const paths = [lead(0, [elm.point1, elm.gate[1]]), lead(1, elm.src.slice(0, 2)), lead(2, elm.drn.slice(0, 2))];
    if (elm.body && elm.getPostCount() > 3) paths.push(lead(3, elm.body));
    return paths;
  }
  if (elm instanceof TransistorElm) {
    if (elm.coll.length < 2 || elm.emit.length < 2) return [];
    return [lead(0, [elm.point1, elm.base]), lead(1, elm.coll), lead(2, elm.emit)];
  }
  if (elm instanceof ChipElm) return elm.pins.slice(0, elm.getPostCount()).map((p, n) => lead(n, [p.post, p.stub]));
  if (elm instanceof TransformerElm || elm instanceof TappedTransformerElm) {
    const drawn = windingPoints(elm);
    return elm.ptEnds.map((p, n) => lead(n, [p, drawn[n]]));
  }
  if (elm instanceof CustomTransformerElm) {
    const drawn = windingPoints(elm);
    return elm.nodePoints.slice(0, elm.getPostCount()).map((p, n) => lead(n, [p, drawn[n]]));
  }
  if (elm instanceof PotElm && elm.lead1 && elm.lead2) return [
    lead(0, [elm.point1, elm.lead1]), lead(1, [elm.point2, elm.lead2]), lead(2, [elm.post3, elm.corner2, elm.arrowPoint]),
  ];
  if (elm instanceof RailElm) return elm.lead1 ? [lead(0, [elm.point1, elm.lead1])] : [];
  if (elm instanceof GroundElm) return [lead(0, [elm.point1, elm.point2])];
  if (elm.getPostCount() === 1 && elm.lead1) return [lead(0, [elm.point1, elm.lead1])];
  if (elm.getPostCount() === 2) {
    if (elm.lead1 && elm.lead2) return [{ ...lead(0, [elm.point1, elm.lead1, elm.lead2, elm.point2]), segments: [0, 2] }];
    return [lead(0, [elm.point1, elm.point2])];
  }
  // No invented diagonal through multi-terminal symbols whose visible leads aren't mapped.
  return [];
}

export function advancePhase(phase: number, distance: number): number {
  if (!Number.isFinite(phase) || !Number.isFinite(distance)) return 0;
  return ((phase + distance) % FLOW_SPACING + FLOW_SPACING) % FLOW_SPACING;
}

/** Walk the actual polyline, retaining phase through bends and hidden symbol-body segments. */
export function pathMarkers(path: FlowPath, phase: number, zoom: number, electron: boolean, spacing = FLOW_SPACING, includeEnd = false): FlowMarker[] {
  if (!Number.isFinite(path.current) || Math.abs(path.current) < CURRENT_FLOOR || !Number.isFinite(zoom) || zoom <= 0 || !Number.isFinite(phase) || !Number.isFinite(spacing) || spacing <= 0) return [];
  const markers: FlowMarker[] = [];
  const sign = Math.sign(path.current) * (electron ? -1 : 1);
  let traveled = 0;
  for (let n = 0; n + 1 < path.points.length; n++) {
    const a = path.points[n], b = path.points[n + 1];
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length === 0) continue;
    if (!path.segments || path.segments.includes(n)) {
      const start = ((phase - traveled) % spacing + spacing) % spacing;
      const ownsEnd = includeEnd && n === path.points.length - 2;
      for (let distance = start; distance < length || (ownsEnd && Math.abs(distance - length) < 1e-8); distance += spacing) {
        const fraction = distance / length;
        markers.push({ x: a.x + dx * fraction, y: a.y + dy * fraction, dx: dx / length * sign, dy: dy / length * sign });
      }
    }
    traveled += length;
  }
  return markers;
}

/** Per-circuit presentation state. Never writes curcount or any other simulation field. */
export class CurrentFlow {
  private phases = new WeakMap<CircuitElm, Map<string, number>>();
  private fastPaths = new WeakMap<CircuitElm, Set<string>>();
  private connections = new WeakMap<CircuitElm, Map<string, FlowConnection>>();
  private junctions = new Set<string>();
  private endpointOwners = new Map<string, PathEntry>();
  private visibleLeads = new WeakMap<CircuitElm, VisibleLead[]>();
  private leadSignatures = new WeakMap<CircuitElm, string>();
  leadRevision = 0;
  private reference = 0;
  private active = false;
  get currentsVisible(): boolean { return this.active; }
  reset(): void {
    this.phases = new WeakMap(); this.fastPaths = new WeakMap();
    this.connections = new WeakMap(); this.junctions.clear(); this.endpointOwners.clear(); this.reference = 0; this.active = false;
  }
  isFast(elm: CircuitElm, pathId: string): boolean { return this.fastPaths.get(elm)?.has(pathId) ?? false; }

  /** Use the same lead geometry that was drawn, including multi-terminal symbols. */
  setVisibleLeads(elm: CircuitElm, leads: readonly VisibleLead[]): void {
    const signature = leads.map(({ terminal, a, b }) => `${terminal}:${a.x},${a.y}:${b.x},${b.y}`).join("|");
    if (this.leadSignatures.get(elm) === signature) return;
    this.leadSignatures.set(elm, signature);
    this.visibleLeads.set(elm, leads.map(({ terminal, a, b }) => ({
      terminal, a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y },
    })));
    this.leadRevision++;
  }

  pathsFor(elm: CircuitElm): FlowPath[] {
    const captured = this.visibleLeads.get(elm) ?? [];
    const replaceGeneric = captured.length > 0 && elm.getPostCount() === 2 && !elm.lead1 && !elm.lead2 && !(elm instanceof WireElm);
    const paths = replaceGeneric ? [] : currentPaths(elm);
    const covered = new Set(paths.map((path) => /^terminal:(\d+)$/.exec(path.id)?.[1]).filter((id) => id !== undefined));
    for (let n = 0; n < elm.getPostCount(); n++) {
      if (covered.has(String(n))) continue;
      const post = elm.getPost(n), current = -elm.getCurrentIntoNode(n);
      let index = 0;
      for (const lead of captured) {
        if (lead.terminal !== n || lead.a.x === lead.b.x && lead.a.y === lead.b.y) continue;
        const da = Math.hypot(lead.a.x - post.x, lead.a.y - post.y);
        const db = Math.hypot(lead.b.x - post.x, lead.b.y - post.y);
        const a = { ...lead.a, z: (lead.a as GridPoint).z ?? 0 }, b = { ...lead.b, z: (lead.b as GridPoint).z ?? 0 };
        paths.push({ id: `terminal:${n}:segment:${index++}`, points: da <= db ? [a, b] : [b, a],
          current, visibleConductor: true });
      }
    }
    return paths;
  }

  advance(elements: CircuitElm[], elapsed: number, speed: number, electron: boolean): void {
    if (!Number.isFinite(elapsed) || elapsed <= 0 || !Number.isFinite(speed) || speed < 0) return;
    const paths = elements.map((elm) => ({ elm, paths: this.pathsFor(elm) }));
    this.connectPaths(paths);
    let largest = 0;
    for (const item of paths) for (const path of item.paths) if (Number.isFinite(path.current)) largest = Math.max(largest, Math.abs(path.current));
    this.active = largest >= CURRENT_FLOOR;
    this.reference = Math.max(largest, this.reference * Math.exp(-elapsed / 4));
    // Integrate real elapsed time; a per-frame clamp changes speed when frame rate drops.
    const perAmp = BASE_SPEED * speed * elapsed / Math.max(this.reference, CURRENT_FLOOR);
    for (const item of paths) {
      let phases = this.phases.get(item.elm);
      if (!phases) this.phases.set(item.elm, phases = new Map());
      let fast = this.fastPaths.get(item.elm);
      if (!fast) this.fastPaths.set(item.elm, fast = new Set());
      for (const path of item.paths) {
        // Speed-based hysteresis, not distance/frame: frame jitter must not toggle the band.
        const rate = Math.abs(path.current) * BASE_SPEED * speed / Math.max(this.reference, CURRENT_FLOOR);
        const conducting = Number.isFinite(rate) && Math.abs(path.current) >= CURRENT_FLOOR;
        const tooFast = conducting && rate >= (fast.has(path.id) ? FAST_EXIT : FAST_ENTER);
        if (tooFast) fast.add(path.id); else fast.delete(path.id);
        const delta = Math.abs(path.current) >= CURRENT_FLOOR ? path.current * perAmp * (electron ? -1 : 1) : 0;
        phases.set(path.id, advancePhase(phases.get(path.id) ?? 0, delta));
      }
    }
  }

  markers(elm: CircuitElm, zoom: number, electron: boolean, spacing = FLOW_SPACING): FlowMarker[] {
    return this.pathsFor(elm).flatMap((path) => this.markersForPath(elm, path, zoom, electron, spacing));
  }

  markersForPath(elm: CircuitElm, path: FlowPath, zoom: number, electron: boolean, spacing = FLOW_SPACING): FlowMarker[] {
    const connection = this.connections.get(elm)?.get(path.id);
    const phases = this.phases.get(connection?.root.elm ?? elm);
    if (!phases) return [];
    // A closed loop must contain a whole number of intervals; otherwise its seam bunches up.
    const period = connection?.loopLength ? connection.loopLength / Math.max(1, Math.round(connection.loopLength / spacing)) : spacing;
    const rootPhase = (phases.get(connection?.root.path.id ?? path.id) ?? 0) * period / FLOW_SPACING;
    const phase = (connection?.sign ?? 1) * rootPhase + (connection?.offset ?? 0);
    const markers = pathMarkers(path, phase, zoom, electron, period, true);
    const first = path.points[0], last = path.points[path.points.length - 1];
    const seen = new Set<string>();
    return markers.filter((m) => {
      for (const p of [first, last]) {
        if (!p) continue;
        const key = positionKey(p), distance = Math.hypot(m.x - p.x, m.y - p.y);
        if (this.junctions.has(key) && distance < period * 0.2) return false;
        const owner = this.endpointOwners.get(key);
        if (distance < 1e-8 && owner && (owner.elm !== elm || owner.path.id !== path.id)) return false;
      }
      const key = `${m.x.toFixed(8)},${m.y.toFixed(8)}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  }

  /** Continue the lattice across degree-two endpoints; branching currents remain independent. */
  private connectPaths(items: { elm: CircuitElm; paths: FlowPath[] }[]): void {
    const entries: PathEntry[] = [];
    const nodes = new Map<string, PathLink[]>();
    for (const { elm, paths } of items) for (const path of paths) {
      let length = 0;
      for (let n = 1; n < path.points.length; n++) {
        const a = path.points[n - 1], b = path.points[n];
        if (a && b) length += Math.hypot(b.x - a.x, b.y - a.y);
      }
      if (!Number.isFinite(length) || length <= 0) continue;
      const entry = { elm, path, length }; entries.push(entry);
      for (const end of [0, 1]) {
        const p = path.points[end === 0 ? 0 : path.points.length - 1];
        const key = positionKey(p), links = nodes.get(key) ?? [];
        links.push({ entry, end }); nodes.set(key, links);
      }
    }
    this.junctions = new Set([...nodes].filter(([, links]) => links.length > 2).map(([key]) => key));
    this.endpointOwners = new Map([...nodes].filter(([, links]) => links.length === 2).map(([key, links]) => [key, links[0].entry]));
    this.connections = new WeakMap();
    const assigned = new Map<PathEntry, FlowConnection>();
    for (const root of entries) {
      if (assigned.has(root)) continue;
      const initial = { root, sign: 1, offset: 0, loopLength: 0 };
      assigned.set(root, initial);
      const queue = [root], group: FlowConnection[] = [];
      let length = 0, closed = true;
      for (let i = 0; i < queue.length; i++) {
        const entry = queue[i], connection = assigned.get(entry)!;
        group.push(connection); length += entry.length;
        let map = this.connections.get(entry.elm);
        if (!map) this.connections.set(entry.elm, map = new Map());
        map.set(entry.path.id, connection);
        for (const end of [0, 1]) {
          const p = entry.path.points[end === 0 ? 0 : entry.path.points.length - 1];
          const links = nodes.get(positionKey(p))!;
          if (links.length !== 2) { closed = false; continue; }
          const other = links.find((link) => link.entry !== entry);
          if (!other || assigned.has(other.entry)) continue;
          // Both paths may be drawn toward (or away from) their common endpoint.
          const sign = end === other.end ? -1 : 1;
          const offset = (other.end ? other.entry.length : 0) + sign * (connection.offset - (end ? entry.length : 0));
          assigned.set(other.entry, { root, sign: sign * connection.sign, offset, loopLength: 0 });
          queue.push(other.entry);
        }
      }
      if (closed) for (const connection of group) connection.loopLength = length;
    }
  }
}
