// Scope navigation as ranges: zooming and panning an axis, and the round grid lines across one.
import type { ScopeScale } from "./model";
import { niceCeil } from "./scope-math";

/** What an axis shows, from lo to hi. */
export interface Range {
  lo: number;
  hi: number;
}

/** Zoom by k (below 1: in) keeping the value at fraction f of the range (0: lo, 1: hi) in place. */
export function zoomRange(r: Range, k: number, f: number): Range {
  const at = r.lo + f * (r.hi - r.lo), w = (r.hi - r.lo) * k;
  return { lo: at - f * w, hi: at + (1 - f) * w };
}

/** Move by a fraction of the range (positive: toward higher values). */
export function panRange(r: Range, f: number): Range {
  const d = f * (r.hi - r.lo);
  return { lo: r.lo + d, hi: r.hi + d };
}

/** The part of a range between fractions a and b (a box). */
export function subRange(r: Range, a: number, b: number): Range {
  const w = r.hi - r.lo;
  return { lo: r.lo + Math.min(a, b) * w, hi: r.lo + Math.max(a, b) * w };
}

/** A per-division scale (`divisions` across) as the range it shows, and back. */
export function rangeOf(sc: ScopeScale, divisions: number): Range {
  return { lo: sc.center - (sc.perDiv * divisions) / 2, hi: sc.center + (sc.perDiv * divisions) / 2 };
}

export function scaleOf(r: Range, divisions: number): ScopeScale {
  return { perDiv: (r.hi - r.lo) / divisions, center: (r.lo + r.hi) / 2 };
}

/**
 * Grid lines on round values across a range: a 1-2-5 step giving about `divisions` of them (the
 * axis's per-division value) and the multiples of it inside lo…hi. Zoomed or panned anywhere, the
 * lines stay on round numbers, as on a graphing calculator.
 */
export function ticks(r: Range, divisions: number): { step: number; values: number[] } {
  const w = r.hi - r.lo;
  if (!(w > 0) || !Number.isFinite(w)) return { step: 1, values: [] };
  const step = niceCeil((w / divisions) * 0.999);
  const values: number[] = [];
  const first = Math.ceil(r.lo / step - 1e-9);
  for (let n = first; n * step <= r.hi + w * 1e-9 && values.length < 200; n++) values.push(Math.abs(n) < 1e-12 ? 0 : n * step);
  return { step, values };
}
