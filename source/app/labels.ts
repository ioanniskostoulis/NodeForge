// Licensed under the GNU General Public License v2 or later. See LICENSE.

/**
 * Automatic placement of the text the schematic prints beside parts and wires: designators,
 * values, live readings and wire readouts.
 *
 * Every label group (a part's designator and value, or a wire's readout) gets a list of candidate
 * positions around its part, conventional ones first. Each candidate costs what it covers of what
 * is drawn (wires, leads, part bodies, the parts' own text, junctions), measured from the drawing
 * itself, plus how far it strays from the conventional spot. All groups are then placed together:
 * hardest first, then improved one group and one overlapping pair at a time until nothing gets
 * better, so a part early in the file doesn't take the place a later one needed. Parts in a row
 * (or side by side) of the same orientation prefer the same side, so labels read alike across
 * the sheet.
 *
 * Pure geometry: the renderer measures text and records the obstacles (`renderer.ts`).
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface P {
  x: number;
  y: number;
}

/** Where label text may not go, from cheapest to cover to dearest. */
export type ObstacleKind = "annotation" | "wire" | "lead" | "body" | "text";

/** Something drawn: a stroked segment (with its half width) or a filled box. */
export interface Obstacle<T = unknown> {
  owner: T;
  kind: ObstacleKind;
  seg?: { ax: number; ay: number; bx: number; by: number; hw: number };
  rect?: Rect;
}

export type LabelKind = "designator" | "value" | "readout";

export interface LabelLine {
  text: string;
  kind: LabelKind;
  /** Width reserved (at least the text's; more for live readings that change). */
  w: number;
  h: number;
}

/** What a group is placed around. */
export type LabelAnchor =
  /** A two-terminal part from a to b; `clear` is how far its body reaches on each side (+normal, −normal). */
  | { kind: "axis"; a: P; b: P; clear: [number, number] }
  /** A part with a box-shaped body (chips, transistors, amplifiers). */
  | { kind: "box"; box: Rect }
  /** A wire's route, for its readout. */
  | { kind: "wire"; points: P[] };

export interface LabelGroup<T> {
  owner: T;
  lines: LabelLine[];
  anchor: LabelAnchor;
}

export interface PlacedLabel {
  text: string;
  kind: LabelKind;
  isDesignator: boolean;
  /** The text's anchor: its left edge, centre or right edge (`align`), world units. */
  x: number;
  /** Top of the line, world units. */
  y: number;
  align: "left" | "center" | "right";
  /** The space reserved for it. */
  rect: Rect;
}

interface Candidate {
  rects: Rect[];
  /** Around all its lines. */
  box: Rect;
  align: PlacedLabel["align"];
  /** Which side of the part, for consistency between neighbours. */
  side: string;
  penalty: number;
  cost: number;
}

/** A candidate as generated, before it is measured against the sheet. */
type Draft = Omit<Candidate, "box" | "cost">;

interface Group<T> {
  spec: LabelGroup<T>;
  index: number;
  candidates: Candidate[];
  /** Candidates from cheapest alone (a bound: neighbours only add to it). */
  byCost: number[];
  envelope: Rect;
  neighbours: Group<T>[];
  /** Parts lined up with this one: they prefer the same side. */
  peers: { group: Group<T>; weight: number }[];
  choice: number;
  /** Horizontal, upright, diagonal, a box, or a wire. */
  orientation: "h" | "v" | "d" | "b" | null;
  mid: P;
}

// what covering each kind of drawing costs; a part's own drawing is worse to cover than another's
const COVER: Record<ObstacleKind, [other: number, own: number]> = {
  annotation: [1, 1],
  wire: [2, 6],
  lead: [3, 8],
  body: [14, 25],
  text: [16, 25],
};
const JUNCTION = 3;
/** A label nearer another part than its own reads as the other's. */
const ASSOCIATION = 8;
/** Two labels touching: a fixed cost plus one growing with the area they share (text on text is the worst to read). */
const LABEL_OVERLAP = 16, LABEL_OVERLAP_AREA = 120;
/** Clearance kept around drawing and between labels. */
const PAD = 1.5, LABEL_GAP = 2;
/** Gap between a part's body and its label. */
const GAP = 4;
/**
 * Work allowed for improving a layout, in label pairs compared (a few milliseconds): a sheet
 * packed too tight for every label stops improving there, so dragging stays smooth. Counted, not
 * timed, so a circuit always gets the same layout.
 */
const WORK = 400_000;
let work = 0;

export function layoutLabels<T>(
  specs: LabelGroup<T>[], obstacles: Obstacle<T>[], junctions: P[] = [],
): Map<T, PlacedLabel[]> {
  const index = new ObstacleIndex(obstacles);
  const dots = new Grid<P>(48);
  for (const j of junctions) dots.insert({ x: j.x, y: j.y, w: 0, h: 0 }, j);
  const groups: Group<T>[] = specs.filter((s) => s.lines.length).map((spec, i) => {
    const candidates: Candidate[] = candidatesFor(spec).map((d) => ({ ...d, box: union(d.rects), cost: 0 }));
    const envelope = union(candidates.map((c) => c.box));
    // what is drawn anywhere this group might go, looked up once
    const near = index.near(envelope, 24), nearDots = [...dots.query(inflate(envelope, 3))];
    for (const c of candidates) c.cost = c.penalty + staticCost(c, spec.owner, near, nearDots) + association(c, spec, near);
    const byCost = candidates.map((_, k) => k).sort((a, b) => candidates[a].cost - candidates[b].cost || a - b);
    return { spec, index: i, candidates, byCost, envelope, neighbours: [], peers: [], choice: -1, ...geometry(spec.anchor) };
  }).filter((g) => g.candidates.length);
  linkNeighbours(groups);
  linkPeers(groups);
  solve(groups);
  const out = new Map<T, PlacedLabel[]>();
  for (const g of groups) {
    const c = g.candidates[g.choice];
    out.set(g.spec.owner, g.spec.lines.map((l, i) => {
      const r = c.rects[i];
      const x = c.align === "left" ? r.x : c.align === "right" ? r.x + r.w : r.x + r.w / 2;
      return { text: l.text, kind: l.kind, isDesignator: l.kind === "designator", x, y: r.y, align: c.align, rect: r };
    }));
  }
  return out;
}

function geometry(anchor: LabelAnchor): { orientation: Group<unknown>["orientation"]; mid: P } {
  if (anchor.kind === "box") return { orientation: "b", mid: { x: anchor.box.x + anchor.box.w / 2, y: anchor.box.y + anchor.box.h / 2 } };
  if (anchor.kind === "wire") return { orientation: null, mid: anchor.points[0] };
  const { a, b } = anchor;
  const orientation = a.y === b.y ? "h" : a.x === b.x ? "v" : "d";
  return { orientation, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
}

/** Lines stacked under each other, aligned on x, starting at `top`. */
function stack(lines: LabelLine[], x: number, top: number, align: PlacedLabel["align"]): Rect[] {
  let y = top;
  return lines.map((l) => {
    const r = { x: align === "left" ? x : align === "right" ? x - l.w : x - l.w / 2, y, w: l.w, h: l.h };
    y += l.h;
    return r;
  });
}

const heightOf = (lines: LabelLine[]) => lines.reduce((s, l) => s + l.h, 0);

function candidatesFor<T>(spec: LabelGroup<T>): Draft[] {
  const { lines, anchor } = spec;
  const out: Draft[] = [];
  const add = (rects: Rect[], align: PlacedLabel["align"], side: string, penalty: number) =>
    out.push({ rects, align, side, penalty });
  const height = heightOf(lines);

  if (anchor.kind === "box") {
    const { x, y, w, h } = anchor.box, cx = x + w / 2, cy = y + h / 2;
    for (const [extra, ep] of [[0, 0], [10, 1.5]]) {
      const above = y - GAP - extra - height, below = y + h + GAP + extra;
      const right = x + w + GAP + 2 + extra, left = x - GAP - 2 - extra;
      add(stack(lines, cx, above, "center"), "center", "above", ep);
      add(stack(lines, cx, below, "center"), "center", "below", ep + 0.2);
      add(stack(lines, right, cy - height / 2, "left"), "left", "right", ep + 0.4);
      add(stack(lines, left, cy - height / 2, "right"), "right", "left", ep + 0.4);
      // the same sides, at the box's corners
      add(stack(lines, x, above, "left"), "left", "above", ep + 0.7);
      add(stack(lines, x + w, above, "right"), "right", "above", ep + 0.7);
      add(stack(lines, x, below, "left"), "left", "below", ep + 0.9);
      add(stack(lines, x + w, below, "right"), "right", "below", ep + 0.9);
      add(stack(lines, right, y, "left"), "left", "right", ep + 1.1);
      add(stack(lines, right, y + h - height, "left"), "left", "right", ep + 1.1);
      add(stack(lines, left, y, "right"), "right", "left", ep + 1.1);
      add(stack(lines, left, y + h - height, "right"), "right", "left", ep + 1.1);
    }
    return out;
  }

  if (anchor.kind === "wire") return wireCandidates(lines, anchor.points);

  const { a, b, clear } = anchor;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(len > 0)) return out;
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  // the normal on the conventional side: up, or right for an upright part
  let nx = uy, ny = -ux, flipped = false;
  if (ny > 1e-9 || (Math.abs(ny) <= 1e-9 && nx < 0)) {
    nx = -nx;
    ny = -ny;
    flipped = true;
  }
  // `clear` is given for the normal (uy, −ux) first
  const clearOn = (s: 1 | -1) => (s === 1) !== flipped ? clear[0] : clear[1];
  // slides along the part, kept within its length
  const slides = (steps: number[]) => steps.filter((t) => Math.abs(t) <= Math.max(len / 2, 14));

  if (Math.abs(uy) < 1e-9) {
    // horizontal: designator above and value below, then both above, then both below
    const up = m.y - clearOn(1) - GAP, down = m.y + clearOn(-1) + GAP;
    if (lines.length === 2) {
      add([stack([lines[0]], m.x, up - lines[0].h, "center")[0], stack([lines[1]], m.x, down, "center")[0]], "center", "split", 0);
    }
    for (const [extra, ep] of [[0, 0.05], [8, 1.2], [18, 2.7], [32, 4.8]]) {
      for (const t of slides(extra ? [0] : [0, -12, 12, -24, 24])) {
        const tp = Math.abs(t) / 12;
        add(stack(lines, m.x + t, up - extra - height, "center"), "center", "above", ep + tp);
        add(stack(lines, m.x + t, down + extra, "center"), "center", "below", ep + tp + 0.3);
      }
    }
  } else if (Math.abs(ux) < 1e-9) {
    // upright: to the right, then to the left; then nudged along the part, then further out
    const right = m.x + clearOn(1) + GAP, left = m.x - clearOn(-1) - GAP;
    for (const [extra, ep] of [[0, 0], [10, 1.5], [22, 3.3]]) {
      for (const t of slides([0, -14, 14, -28, 28])) {
        const tp = Math.abs(t) / 17.5;
        add(stack(lines, right + extra, m.y + t - height / 2, "left"), "left", "right", ep + tp);
        add(stack(lines, left - extra, m.y + t - height / 2, "right"), "right", "left", ep + tp + 0.3);
      }
    }
  } else {
    // diagonal: a centred block on either side, its corner clear of the part
    const w = Math.max(...lines.map((l) => l.w));
    const reach = (Math.abs(nx) * w) / 2 + (Math.abs(ny) * height) / 2;
    for (const [extra, ep] of [[0, 0], [10, 1.5], [24, 3.6], [40, 6]]) {
      for (const t of slides(extra ? [0] : [0, -14, 14])) {
        const tp = Math.abs(t) / 14;
        for (const s of [1, -1] as const) {
          const d = clearOn(s) + GAP + reach + extra;
          const cx = m.x + nx * d * s + ux * t, cy = m.y + ny * d * s + uy * t;
          add(stack(lines, cx, cy - height / 2, "center"), "center", s === 1 ? "plus" : "minus", ep + tp + (s === 1 ? 0 : 0.3));
        }
      }
    }
  }
  return out;
}

/** A wire's readout: beside the middle of its route, then further along it. */
function wireCandidates(lines: LabelLine[], points: P[]): Draft[] {
  const out: Draft[] = [];
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  const total = lengths.reduce((s, l) => s + l, 0);
  if (!(total > 0)) return out;
  const height = heightOf(lines);
  for (const f of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9]) {
    let remaining = total * f, i = 0;
    while (i < lengths.length - 1 && remaining > lengths[i]) remaining -= lengths[i++];
    const a = points[i], b = points[i + 1], len = lengths[i];
    if (!(len > 0)) continue;
    const p = { x: a.x + ((b.x - a.x) * remaining) / len, y: a.y + ((b.y - a.y) * remaining) / len };
    const penalty = Math.abs(f - 0.5) * 6;
    if (Math.abs(b.x - a.x) / len < 0.5) {
      out.push({ rects: stack(lines, p.x + 8, p.y - height / 2, "left"), align: "left", side: "right", penalty });
      out.push({ rects: stack(lines, p.x - 8, p.y - height / 2, "right"), align: "right", side: "left", penalty: penalty + 0.3 });
    } else {
      out.push({ rects: stack(lines, p.x, p.y - 7 - height, "center"), align: "center", side: "above", penalty });
      out.push({ rects: stack(lines, p.x, p.y + 7, "center"), align: "center", side: "below", penalty: penalty + 0.3 });
    }
  }
  return out;
}

function staticCost<T>(c: Candidate, owner: T, near: Indexed<T>[], junctions: P[]): number {
  let cost = 0;
  for (const r of c.rects) {
    const area = r.w * r.h;
    for (const { o, box } of near) {
      if (!intersects(box, inflate(r, PAD))) continue;
      const weight = COVER[o.kind][o.owner === owner ? 1 : 0];
      if (o.seg) {
        const s = o.seg;
        if (segmentHitsRect(s.ax, s.ay, s.bx, s.by, inflate(r, s.hw + PAD))) cost += weight;
      } else {
        const shared = overlapArea(box, r);
        if (shared > 0) cost += weight * (1 + (3 * shared) / Math.max(1, area));
      }
    }
    const around = inflate(r, 3);
    for (const j of junctions) if (contains(around, j.x, j.y)) cost += JUNCTION;
  }
  return cost;
}

/**
 * A label belongs to the part it is nearest: one clearly nearer another part's drawing (body or
 * text) than its own part's costs as much as covering a little of a body.
 */
function association<T>(c: Candidate, spec: LabelGroup<T>, near: Indexed<T>[]): number {
  const r = c.box, p = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  // how far its own part's drawing is (the axis less the body's reach, the box, the wire)
  const a = spec.anchor;
  const own = a.kind === "box" ? rectDistance(p, a.box)
    : a.kind === "axis" ? Math.max(0, segmentDistance(p, { ax: a.a.x, ay: a.a.y, bx: a.b.x, by: a.b.y }) - Math.max(...a.clear))
    : Math.min(...a.points.slice(1).map((q, i) => segmentDistance(p, { ax: a.points[i].x, ay: a.points[i].y, bx: q.x, by: q.y })));
  const limit = own * 0.8 - 2;
  if (limit <= 0) return 0;
  for (const { o, box } of near) {
    if (o.owner === spec.owner || (o.kind !== "body" && o.kind !== "text") || rectDistance(p, box) >= limit) continue;
    const d = o.seg ? segmentDistance(p, o.seg) - o.seg.hw : rectDistance(p, o.rect!);
    if (d < limit) return ASSOCIATION;
  }
  return 0;
}

function pairCost(a: Candidate, b: Candidate): number {
  const p = a.box, q = b.box;
  if (p.x + p.w + LABEL_GAP <= q.x || q.x + q.w + LABEL_GAP <= p.x || p.y + p.h + LABEL_GAP <= q.y || q.y + q.h + LABEL_GAP <= p.y) return 0;
  let cost = 0;
  for (const r of a.rects) {
    for (const s of b.rects) {
      // the area they share, each widened by half the gap (symmetric, and without allocating: this runs most)
      const w = Math.min(r.x + r.w, s.x + s.w) - Math.max(r.x, s.x) + LABEL_GAP;
      if (w <= 0) continue;
      const h = Math.min(r.y + r.h, s.y + s.h) - Math.max(r.y, s.y) + LABEL_GAP;
      if (h <= 0) continue;
      cost += LABEL_OVERLAP + (LABEL_OVERLAP_AREA * w * h) / Math.max(1, Math.min(r.w * r.h, s.w * s.h));
    }
  }
  return cost;
}

/** What candidate i of g costs given where everything else is. */
function costOf<T>(g: Group<T>, i: number, skip?: Group<T>): number {
  const c = g.candidates[i];
  work += g.neighbours.length + 1;
  let cost = c.cost;
  for (const h of g.neighbours) if (h !== skip && h.choice >= 0) cost += pairCost(c, h.candidates[h.choice]);
  for (const { group, weight } of g.peers) if (group !== skip && group.choice >= 0 && group.candidates[group.choice].side !== c.side) cost += weight;
  return cost;
}

function linkNeighbours<T>(groups: Group<T>[]): void {
  const grid = new Grid<Group<T>>(96);
  for (const g of groups) grid.insert(inflate(g.envelope, LABEL_GAP), g);
  for (const g of groups) {
    for (const h of grid.query(inflate(g.envelope, LABEL_GAP))) {
      if (h !== g && intersects(inflate(g.envelope, LABEL_GAP), h.envelope)) g.neighbours.push(h);
    }
  }
}

/**
 * Parts of one orientation in a line (end to end) or side by side prefer the same side; so do
 * parts with boxes of one size (transistors, amplifiers) level with or above each other.
 */
function linkPeers<T>(groups: Group<T>[]): void {
  const lined = groups.filter((g) => g.orientation === "h" || g.orientation === "v" || g.orientation === "b");
  const grid = new Grid<Group<T>>(128);
  for (const g of lined) grid.insert({ x: g.mid.x - 1, y: g.mid.y - 1, w: 2, h: 2 }, g);
  const size = (g: Group<T>) => g.spec.anchor.kind === "box" ? g.spec.anchor.box : null;
  for (const g of lined) {
    const reach = g.orientation === "b" ? 320 : 112;
    for (const o of grid.query({ x: g.mid.x - reach, y: g.mid.y - reach, w: 2 * reach, h: 2 * reach })) {
      if (o === g || o.orientation !== g.orientation) continue;
      const dx = Math.abs(o.mid.x - g.mid.x), dy = Math.abs(o.mid.y - g.mid.y);
      if (g.orientation === "b") {
        const a = size(g)!, b = size(o)!;
        if (Math.abs(a.w - b.w) < 1 && Math.abs(a.h - b.h) < 1 && (dx < 0.5 || dy < 0.5)) g.peers.push({ group: o, weight: 0.8 });
        continue;
      }
      const along = g.orientation === "h" ? dx : dy, across = g.orientation === "h" ? dy : dx;
      if (across < 0.5 && along <= 112) g.peers.push({ group: o, weight: 1.5 });
      else if (along < 0.5 && across <= 96) g.peers.push({ group: o, weight: 0.8 });
    }
  }
}

function solve<T>(groups: Group<T>[]): void {
  // most constrained first: groups with the fewest unobstructed places choose before the rest
  const free = new Map(groups.map((g) => [g, g.candidates.filter((c) => c.cost < 1).length]));
  const order = [...groups].sort((a, b) => free.get(a)! - free.get(b)! || a.index - b.index);
  for (const g of order) g.choice = best(g);
  work = 0;
  for (let round = 0; round < 3; round++) {
    // each group moves to its best place given the others; a move rechecks its neighbours
    const queue = [...order], queued = new Set(order);
    let changed = false;
    for (let budget = 20 * groups.length; queue.length && budget > 0 && (round === 0 || work < WORK); budget--) {
      const g = queue.shift()!;
      queued.delete(g);
      const i = best(g);
      if (i === g.choice || !(costOf(g, i) < costOf(g, g.choice) - 1e-9)) continue;
      g.choice = i;
      changed = true;
      for (const h of [...g.neighbours, ...g.peers.map((p) => p.group)]) {
        if (!queued.has(h)) {
          queued.add(h);
          queue.push(h);
        }
      }
    }
    // two labels in each other's way, or one kept from a better place by another's: try moving
    // both at once (a bounded number of times: on a sheet packed tight everything is in the way)
    let pairs = 200;
    for (const g of order) {
      if (pairs <= 0 || work >= WORK) break;
      const now = costOf(g, g.choice);
      const better = g.byCost.filter((i) => g.candidates[i].cost < now - 0.5).slice(0, 12);
      for (const h of g.neighbours) {
        const hc = h.candidates[h.choice];
        const overlapping = h.index > g.index && pairCost(g.candidates[g.choice], hc) > 0;
        if (!overlapping && !better.some((i) => pairCost(g.candidates[i], hc) > 0)) continue;
        pairs--;
        if (improvePair(g, h)) changed = true;
      }
    }
    // the groups furthest from their best place first, a few dozen at most
    const unhappy = order.map((g) => ({ g, by: costOf(g, g.choice) - g.candidates[g.byCost[0]].cost }))
      .filter((u) => u.by > 1).sort((a, b) => b.by - a.by || a.g.index - b.g.index).slice(0, 40);
    for (const { g } of unhappy) if (work < WORK && eject(g)) changed = true;
    if (!changed || work >= WORK) break;
  }
}

/**
 * A group kept from a better place: put it there anyway, let the groups it pushes find new places
 * (and those they push), and keep the result if the whole layout costs less. Untangles chains a
 * single or paired move can't (A wants B's place, B wants C's, C has room elsewhere).
 */
function eject<T>(g: Group<T>): boolean {
  const now = costOf(g, g.choice);
  const tries = g.byCost.filter((i) => g.candidates[i].cost < now - 1).slice(0, 4);
  for (const i of tries) {
    const saved = new Map<Group<T>, number>();
    // moving one group changes the layout's total cost by exactly the change in its own cost
    let delta = 0;
    const move = (x: Group<T>, j: number) => {
      if (!saved.has(x)) saved.set(x, x.choice);
      delta += costOf(x, j) - costOf(x, x.choice);
      x.choice = j;
    };
    move(g, i);
    const queue = [...g.neighbours], queued = new Set(queue);
    for (let budget = 40; queue.length && budget > 0; budget--) {
      const h = queue.shift()!;
      queued.delete(h);
      // g stays where it was put: the others make way for it if they can
      const j = best(h, g.candidates[i]);
      if (j === h.choice || !(costOf(h, j) < costOf(h, h.choice) - 1e-9)) continue;
      move(h, j);
      for (const n of h.neighbours) {
        if (n !== g && !queued.has(n)) {
          queued.add(n);
          queue.push(n);
        }
      }
    }
    if (delta < -1e-9) return true;
    for (const [x, j] of saved) x.choice = j;
  }
  return false;
}

/** g's cheapest place given the others; clear of `avoid` where g has such a place. */
function best<T>(g: Group<T>, avoid?: Candidate): number {
  if (avoid) {
    const clear = g.byCost.filter((i) => pairCost(g.candidates[i], avoid) === 0);
    if (clear.length) return bestOf(g, clear);
  }
  return bestOf(g, g.byCost);
}

function bestOf<T>(g: Group<T>, sorted: number[]): number {
  let bi = sorted[0], bc = Infinity;
  for (const i of sorted) {
    // what's left costs more alone than the best so far does with its neighbours
    if (g.candidates[i].cost >= bc) break;
    const c = costOf(g, i);
    if (c < bc - 1e-9) {
      bc = c;
      bi = i;
    }
  }
  return bi;
}

function improvePair<T>(g: Group<T>, h: Group<T>): boolean {
  // each one's cost apart from the other, and its best few places by that
  // (among the cheapest by themselves: the rest are covered already)
  const alone = (x: Group<T>, other: Group<T>) => {
    const costs = new Map<number, number>();
    for (const i of [x.choice, ...x.byCost.slice(0, 12)]) costs.set(i, costOf(x, i, other));
    return costs;
  };
  const cg = alone(g, h), ch = alone(h, g);
  const top = (costs: Map<number, number>) => [...costs.keys()].sort((i, j) => costs.get(i)! - costs.get(j)! || i - j).slice(0, 8);
  const gi = g.choice, hi = h.choice;
  const peer = (i: number, j: number) => g.peers.some((p) => p.group === h) && g.candidates[i].side !== h.candidates[j].side
    ? g.peers.find((p) => p.group === h)!.weight + (h.peers.find((p) => p.group === g)?.weight ?? 0) : 0;
  const total = (i: number, j: number) => cg.get(i)! + ch.get(j)! + pairCost(g.candidates[i], h.candidates[j]) + peer(i, j);
  let bc = total(gi, hi), bg = gi, bh = hi;
  for (const i of top(cg)) {
    for (const j of top(ch)) {
      const c = total(i, j);
      if (c < bc - 1e-9) {
        bc = c;
        bg = i;
        bh = j;
      }
    }
  }
  g.choice = bg;
  h.choice = bh;
  return bg !== gi || bh !== hi;
}

class Grid<V> {
  private readonly cells = new Map<number, V[]>();
  constructor(private readonly size: number) {}

  private keys(r: Rect): number[] {
    const s = this.size, out: number[] = [];
    const x0 = Math.floor(r.x / s), x1 = Math.floor((r.x + r.w) / s);
    const y0 = Math.floor(r.y / s), y1 = Math.floor((r.y + r.h) / s);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push((x + 32768) * 65536 + (y + 32768));
    return out;
  }

  insert(r: Rect, v: V): void {
    for (const k of this.keys(r)) {
      const cell = this.cells.get(k);
      if (cell) cell.push(v);
      else this.cells.set(k, [v]);
    }
  }

  query(r: Rect): Set<V> {
    const out = new Set<V>();
    for (const k of this.keys(r)) for (const v of this.cells.get(k) ?? []) out.add(v);
    return out;
  }
}

/** An obstacle and its bounding box (a stroke's includes its width). */
interface Indexed<T> {
  o: Obstacle<T>;
  box: Rect;
}

class ObstacleIndex<T> {
  private readonly grid = new Grid<Indexed<T>>(48);
  constructor(obstacles: Obstacle<T>[]) {
    for (const o of obstacles) {
      const s = o.seg;
      const box = o.rect ? inflate(o.rect, PAD)
        : s ? inflate({ x: Math.min(s.ax, s.bx), y: Math.min(s.ay, s.by), w: Math.abs(s.bx - s.ax), h: Math.abs(s.by - s.ay) }, s.hw)
        : null;
      if (box) this.grid.insert(box, { o, box });
    }
  }

  near(r: Rect, margin: number): Indexed<T>[] {
    return [...this.grid.query(inflate(r, margin))];
  }
}

export function inflate(r: Rect, d: number): Rect {
  return { x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function union(rs: Rect[]): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rs) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function rectDistance(p: P, r: Rect): number {
  return Math.hypot(Math.max(r.x - p.x, 0, p.x - r.x - r.w), Math.max(r.y - p.y, 0, p.y - r.y - r.h));
}

function segmentDistance(p: P, s: { ax: number; ay: number; bx: number; by: number }): number {
  const dx = s.bx - s.ax, dy = s.by - s.ay, l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - s.ax) * dx + (p.y - s.ay) * dy) / l2)) : 0;
  return Math.hypot(p.x - s.ax - t * dx, p.y - s.ay - t * dy);
}

function contains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** Liang–Barsky: does segment a→b touch rectangle r? */
export function segmentHitsRect(ax: number, ay: number, bx: number, by: number, r: Rect): boolean {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  const checks: [number, number][] = [[-dx, ax - r.x], [dx, r.x + r.w - ax], [-dy, ay - r.y], [dy, r.y + r.h - ay]];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) return false;
        t0 = Math.max(t0, t);
      } else {
        if (t < t0) return false;
        t1 = Math.min(t1, t);
      }
    }
  }
  return t0 <= t1;
}
