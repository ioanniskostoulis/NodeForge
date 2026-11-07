// Visual bridges at unconnected conductor crossings. Geometry only; simulation is unchanged.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { P } from "./geom";

export interface WireSegment<T> { owner: T; a: P; b: P; segment?: number; wire?: boolean }
export interface WireJump<T> { x: number; y: number; over: WireSegment<T>; under: WireSegment<T> }

// At the app's 12× maximum zoom, each chord differs from the 8-unit arc by less than 0.06 px.
const BRIDGE_STEPS = 48;
const cross = (a: P, b: P): number => a.x * b.y - a.y * b.x;
const pointKey = (p: P): string => `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`;
const samePoint = (a: P, b: P): boolean => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
const sameSegment = <T>(s: WireSegment<T>, a: P, b: P): boolean =>
  samePoint(s.a, a) && samePoint(s.b, b) || samePoint(s.a, b) && samePoint(s.b, a);

/** Bridges need room on one conductor; a passing line remains separate from terminals it crosses. */
export function findWireJumps<T>(segments: readonly WireSegment<T>[], connected: readonly P[], halfHeight: number): WireJump<T>[] {
  const connectedPositions = new Set(connected.map(pointKey));
  const candidates: WireJump<T>[] = [];
  const margin = halfHeight + 2;
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
    const first = segments[i], second = segments[j];
    if (first.owner === second.owner) continue;
    const u = { x: first.b.x - first.a.x, y: first.b.y - first.a.y };
    const v = { x: second.b.x - second.a.x, y: second.b.y - second.a.y };
    const denominator = cross(u, v);
    if (Math.abs(denominator) < 1e-8) continue;
    const between = { x: second.a.x - first.a.x, y: second.a.y - first.a.y };
    const t = cross(between, v) / denominator, s = cross(between, u) / denominator;
    if (t < -1e-8 || t > 1 + 1e-8 || s < -1e-8 || s > 1 + 1e-8) continue;
    const x = first.a.x + t * u.x, y = first.a.y + t * u.y;
    const firstEndsHere = Math.min(Math.abs(t), Math.abs(1 - t)) < 1e-8;
    const secondEndsHere = Math.min(Math.abs(s), Math.abs(1 - s)) < 1e-8;
    if (firstEndsHere && secondEndsHere && connectedPositions.has(pointKey({ x, y }))) continue;
    const firstRoom = Math.min(t, 1 - t) * Math.hypot(u.x, u.y) >= margin;
    const secondRoom = Math.min(s, 1 - s) * Math.hypot(v.x, v.y) >= margin;
    if (!firstRoom && !secondRoom) continue;
    const firstPreferred = !!first.wire !== !!second.wire ? !!first.wire
      : Math.abs(u.y) / Math.hypot(u.x, u.y) >= Math.abs(v.y) / Math.hypot(v.x, v.y);
    const over = firstPreferred ? firstRoom ? first : second : secondRoom ? second : first;
    const under = over === first ? second : first;
    candidates.push({ x, y, over, under });
  }
  const distance = (jump: WireJump<T>): number => Math.hypot(jump.x - jump.over.a.x, jump.y - jump.over.a.y);
  candidates.sort((a, b) => segments.indexOf(a.over) - segments.indexOf(b.over) || distance(a) - distance(b));
  const spaced: WireJump<T>[] = [];
  for (const jump of candidates) {
    const last = spaced.at(-1);
    if (!last || jump.over !== last.over || distance(jump) - distance(last) >= halfHeight * 2 + 2) spaced.push(jump);
  }
  return spaced;
}

/** Replace each crossed straight span with a circular arc on the same conductor. */
export function bridgePath<T>(points: readonly P[], jumps: readonly WireJump<T>[], radius: number, halfAngle: number): P[] {
  if (!points.length) return [];
  const halfSpan = radius * Math.sin(halfAngle), offset = radius * Math.cos(halfAngle);
  const out: P[] = [points[0]];
  for (let segment = 0; segment + 1 < points.length; segment++) {
    const a = points[segment], b = points[segment + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!length) { out.push(b); continue; }
    const u = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    let normal = { x: u.y, y: -u.x };
    if (Math.abs(u.y) >= Math.abs(u.x) ? normal.x < 0 : normal.y > 0)
      normal = { x: -normal.x, y: -normal.y };
    const crossings = jumps.filter((jump) => sameSegment(jump.over, a, b))
      .sort((left, right) => (left.x - right.x) * u.x + (left.y - right.y) * u.y);
    for (const jump of crossings) {
      out.push({ x: jump.x - u.x * halfSpan, y: jump.y - u.y * halfSpan });
      for (let step = 1; step <= BRIDGE_STEPS; step++) {
        const angle = -halfAngle + 2 * halfAngle * step / BRIDGE_STEPS;
        const along = radius * Math.sin(angle), bulge = radius * Math.cos(angle) - offset;
        out.push({ x: jump.x + u.x * along + normal.x * bulge,
          y: jump.y + u.y * along + normal.y * bulge });
      }
    }
    out.push(b);
  }
  return out;
}

/** Keep current markers on the curved conductor, with their direction tangent to it. */
export function bridgeMarker<T, M extends P & { dx: number; dy: number }>(marker: M, jumps: readonly WireJump<T>[], radius: number, halfAngle: number): M {
  const halfSpan = radius * Math.sin(halfAngle);
  for (const jump of jumps) {
    const a = jump.over.a, b = jump.over.b;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!length) continue;
    const u = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    const position = { x: marker.x - jump.x, y: marker.y - jump.y };
    const along = position.x * u.x + position.y * u.y;
    const offLine = Math.abs(cross(position, u));
    if (Math.abs(along) >= halfSpan || offLine > 1e-6) continue;
    let normal = { x: u.y, y: -u.x };
    if (Math.abs(u.y) >= Math.abs(u.x) ? normal.x < 0 : normal.y > 0)
      normal = { x: -normal.x, y: -normal.y };
    const run = Math.sqrt(radius * radius - along * along);
    const bulge = run - radius * Math.cos(halfAngle);
    const slope = -along / run;
    const sign = Math.sign(marker.dx * u.x + marker.dy * u.y) || 1;
    const tangentLength = Math.hypot(1, slope);
    return { ...marker, x: jump.x + u.x * along + normal.x * bulge,
      y: jump.y + u.y * along + normal.y * bulge,
      dx: sign * (u.x + normal.x * slope) / tangentLength,
      dy: sign * (u.y + normal.y * slope) / tangentLength };
  }
  return marker;
}
