// Drawing geometry helpers (CircuitElm.interpPoint and friends, unrounded).
// Licensed under the GNU General Public License v2 or later. See LICENSE.

export type P = { x: number; y: number };

/** Four inductor arches, normalized to a 32-unit body and a 6-unit top height. */
const INDUCTOR_CURVES: readonly (readonly [number, number, number, number, number, number])[] = [
  [0.183, -3.349, 2.499, -6, 5.324, -6],
  [8.28, -6, 10.671, -3.12, 10.671, 0.428],
  [10.671, 2.013, 10.194, 3.464, 9.404, 4.586],
  [9.28, 4.752, 9.091, 4.849, 8.892, 4.849],
  [8.693, 4.849, 8.505, 4.752, 8.38, 4.586],
  [7.59, 3.464, 7.114, 2.013, 7.114, 0.428],
  [7.114, -3.12, 9.504, -6, 12.449, -6],
  [15.394, -6, 17.784, -3.12, 17.784, 0.428],
  [17.784, 2.013, 17.308, 3.464, 16.518, 4.586],
  [16.393, 4.752, 16.205, 4.849, 16.006, 4.849],
  [15.807, 4.849, 15.618, 4.752, 15.494, 4.586],
  [14.704, 3.464, 14.227, 2.013, 14.227, 0.428],
  [14.227, -3.12, 16.618, -6, 19.563, -6],
  [22.507, -6, 24.898, -3.12, 24.898, 0.428],
  [24.898, 2.013, 24.421, 3.464, 23.631, 4.586],
  [23.507, 4.752, 23.319, 4.849, 23.119, 4.849],
  [22.92, 4.849, 22.732, 4.752, 22.608, 4.586],
  [21.818, 3.464, 21.341, 2.013, 21.341, 0.428],
  [21.341, -3.12, 23.732, -6, 26.676, -6],
  [29.502, -6, 31.817, -3.349, 32, 0],
];

export function inductorCurves(length: number, height = 6): [P, P, P][] {
  const scale = length / 32;
  const verticalScale = height / 6;
  return INDUCTOR_CURVES.map(([x1, y1, x2, y2, x3, y3]) => [
    { x: x1 * scale, y: y1 * verticalScale },
    { x: x2 * scale, y: y2 * verticalScale },
    { x: x3 * scale, y: y3 * verticalScale },
  ]);
}

export function dist(a: P, b: P): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function lerp(a: P, b: P, f: number): P {
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

export function unit(a: P, b: P): P {
  const d = Math.max(dist(a, b), 1e-9);
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
}

/** Two points fraction f along a→b, offset perpendicular by ±g (interpPoint2). */
export function perp(a: P, b: P, f: number, g: number): [P, P] {
  const base = lerp(a, b, f);
  const u = unit(a, b);
  return [{ x: base.x + u.y * g, y: base.y - u.x * g }, { x: base.x - u.y * g, y: base.y + u.x * g }];
}

/**
 * The two ends in reading order: left to right, or top to bottom when upright. Symbols whose
 * drawing has a direction of its own (zigzags, waves, coil loops) are built along this, so they
 * look the same whichever way the part was dragged out.
 */
export function readingOrder(a: P, b: P): [P, P] {
  return b.x < a.x || (b.x === a.x && b.y < a.y) ? [b, a] : [a, b];
}

/** Maps local coordinates (x along a→b, origin at a) to world coordinates. */
export function frame(a: P, b: P): (p: P) => P {
  const u = unit(a, b);
  return (p) => ({ x: a.x + u.x * p.x - u.y * p.y, y: a.y + u.y * p.x + u.x * p.y });
}

/** Point fraction f along a→b, offset perpendicular by g (CircuitElm.interpPoint with g). */
export function perpPoint(a: P, b: P, f: number, g: number): P {
  return perp(a, b, f, g)[0];
}

/** Arrowhead pointing at b, `al` long and `aw` half-wide (CircuitElm.calcArrow). */
export function arrow(a: P, b: P, al: number, aw: number): P[] {
  const d = dist(a, b);
  const [p1, p2] = perp(a, b, 1 - al / d, aw);
  return [b, p1, p2];
}
