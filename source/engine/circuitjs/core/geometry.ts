// Ported from CircuitJS1 (Point.java, CircuitElm.java helpers) by Paul Falstad and Iain Sharp.
// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

/** Integer grid point. `z` distinguishes the bits of a bus at the same (x, y). */
export interface GridPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * The editor grid spacing (CirSim.gridSize): 8 with the small-grid option, otherwise 16. Some
 * element geometry snaps to it, so it must match the circuit's option while points are computed.
 */
export const grid = { size: 16 };

/** Round to the nearest grid line (CirSim.snapGrid). */
export function snapGrid(x: number): number {
  return (x + (grid.size / 2 - 1)) & ~(grid.size - 1);
}

export function pt(x: number, y: number, z = 0): GridPoint {
  return { x, y, z };
}

/** Map key for a point (also the key format of SimulationManager.pointKey). */
export function pointKey(p: GridPoint): string {
  return `${p.x},${p.y},${p.z}`;
}

export function samePoint(a: GridPoint, b: GridPoint): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

export interface GridRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function rectContains(r: GridRect, px: number, py: number): boolean {
  return px >= r.x && py >= r.y && px < r.x + r.width && py < r.y + r.height;
}

// Interpolation helpers: exact ports, since rounding must match upstream for grid alignment.

/** Point fraction `f` of the way from `a` to `b`. */
export function interpPoint(a: GridPoint, b: GridPoint, f: number): GridPoint {
  return pt(Math.floor(a.x * (1 - f) + b.x * f + 0.48), Math.floor(a.y * (1 - f) + b.y * f + 0.48));
}

/** Point fraction `f` along a→b, offset perpendicular by `g`. */
export function interpPointPerp(a: GridPoint, b: GridPoint, f: number, g: number): GridPoint {
  const gx = b.y - a.y;
  const gy = a.x - b.x;
  const gs = g / Math.sqrt(gx * gx + gy * gy);
  return pt(Math.floor(a.x * (1 - f) + b.x * f + gs * gx + 0.48), Math.floor(a.y * (1 - f) + b.y * f + gs * gy + 0.48));
}

export function distance(p1: GridPoint, p2: GridPoint): number {
  const x = p1.x - p2.x;
  const y = p1.y - p2.y;
  return Math.sqrt(x * x + y * y);
}

export function sign(x: number): number {
  return x < 0 ? -1 : x === 0 ? 0 : 1;
}

/** NodeForge display orientation for fixed-layout symbols; zero preserves upstream geometry. */
export const SYMBOL_FLIP_X = 1 << 21, SYMBOL_FLIP_Y = 1 << 22, SYMBOL_SWAP_XY = 1 << 23;
export function orientSymbolPoint(origin: { x: number; y: number; flags: number }, p: GridPoint): GridPoint {
  let x = p.x - origin.x, y = p.y - origin.y;
  if (origin.flags & SYMBOL_SWAP_XY) [x, y] = [y, x];
  if (origin.flags & SYMBOL_FLIP_X) x = -x;
  if (origin.flags & SYMBOL_FLIP_Y) y = -y;
  return { ...p, x: origin.x + x, y: origin.y + y };
}
