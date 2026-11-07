// Scope measurements: which there are, which a scope shows, and how each is worked out from the
// recorded cells of a window (the visible one, the stretch between cursors A and B, or whole cycles).
import { ScopeFlag } from "../engine";
import { si } from "./format";
import type { ScopeRuntime } from "./model";
import type { Cells } from "./scope-math";

export interface MeasureDef {
  /** The console's name. */
  key: string;
  /** In the menu. */
  name: string;
  /** Before its value in a legend. */
  short: string;
  group: "Level" | "Timing" | "Power";
  /** CircuitJS's scope flag for it (saved in its files); the others save as NodeForge metadata. */
  flag?: number;
  /** The flag hides it (peak, shown by default as in CircuitJS). */
  inverted?: boolean;
}

export const MEASURES: MeasureDef[] = [
  { key: "peak", name: "Peak", short: "max", group: "Level", flag: ScopeFlag.hideMax, inverted: true },
  { key: "minimum", name: "Minimum", short: "min", group: "Level", flag: ScopeFlag.showMin },
  { key: "p2p", name: "Peak-to-peak", short: "p-p", group: "Level", flag: ScopeFlag.showP2P },
  { key: "average", name: "Average", short: "avg", group: "Level", flag: ScopeFlag.showAverage },
  { key: "rms", name: "RMS", short: "rms", group: "Level", flag: ScopeFlag.showRMS },
  { key: "overshoot", name: "Overshoot", short: "ovs", group: "Level" },
  { key: "frequency", name: "Frequency", short: "f", group: "Timing", flag: ScopeFlag.showFreq },
  { key: "period", name: "Period", short: "T", group: "Timing" },
  { key: "duty", name: "Duty cycle", short: "duty", group: "Timing", flag: ScopeFlag.showDutyCycle },
  { key: "width", name: "Pulse width", short: "width", group: "Timing" },
  { key: "rise", name: "Rise time", short: "rise", group: "Timing" },
  { key: "fall", name: "Fall time", short: "fall", group: "Timing" },
  { key: "phase", name: "Phase to the first trace", short: "φ", group: "Timing" },
  { key: "energy", name: "Energy", short: "E", group: "Power" },
  { key: "cycleenergy", name: "Energy per cycle", short: "E/cycle", group: "Power" },
  { key: "efficiency", name: "Efficiency to the first power trace", short: "η", group: "Power" },
];

/** The option to measure over whole cycles (first to last rising crossing in the window). */
export const WHOLE_CYCLES = "cycles";

export function measureOn(scope: ScopeRuntime, key: string): boolean {
  const def = MEASURES.find((m) => m.key === key);
  if (!def) return scope.measures.has(key);
  if (def.flag === undefined) return scope.measures.has(key);
  return def.inverted ? !scope.has(def.flag) : scope.has(def.flag);
}

export function setMeasure(scope: ScopeRuntime, key: string, on: boolean): void {
  if (measureOn(scope, key) === on) return;
  const def = MEASURES.find((m) => m.key === key);
  if (def?.flag !== undefined) scope.toggle(def.flag);
  else if (on) scope.measures.add(key);
  else scope.measures.delete(key);
}

export function anyMeasure(scope: ScopeRuntime): boolean {
  return MEASURES.some((m) => measureOn(scope, m.key));
}

/** What one trace measured over a window (NaN where it can't be told). */
export interface Measured {
  max: number;
  min: number;
  avg: number;
  rms: number;
  period: number;
  duty: number;
  width: number;
  rise: number;
  fall: number;
  overshoot: number;
  energy: number;
  cycleEnergy: number;
  /** Rising crossings of the 50% level (for phase between traces). */
  rises: number[];
}

/**
 * Measure trace j of recorded cells over x0…x1. Each cell counts as its mid value over the part of
 * its time inside the window. The levels either side of the mean (base and top, time-weighted medians)
 * give the 50% level, whose crossings (with 10% hysteresis) give the period, pulse width and duty
 * cycle, and the 10% and 90% levels for rise and fall times; overshoot is the peak past the top. With `wholeCycles`, the levels, averages and energy are taken from
 * the first to the last rising crossing, so a part-cycle at either end doesn't bias them.
 */
export function measure(cells: Cells, j: number, x0: number, x1: number, wholeCycles: boolean, fine?: (t0: number, t1: number) => Cells): Measured {
  const t0: number[] = [], t1: number[] = [], v: number[] = [];
  let max = -Infinity, min = Infinity;
  for (let i = 0; i < cells.count; i++) {
    const a = Math.max(cells.ts[i], x0), b = Math.min(cells.te[i], x1);
    if (!(b > a)) continue;
    const o = (i * cells.traces + j) * 2, lo = cells.v[o], hi = cells.v[o + 1];
    if (!(lo <= hi)) continue;
    t0.push(a); t1.push(b); v.push((lo + hi) / 2);
    max = Math.max(max, hi);
    min = Math.min(min, lo);
  }
  const none: Measured = { max: NaN, min: NaN, avg: NaN, rms: NaN, period: NaN, duty: NaN, width: NaN, rise: NaN, fall: NaN, overshoot: NaN, energy: NaN, cycleEnergy: NaN, rises: [] };
  const n = v.length;
  if (!n) return none;
  const tm = (k: number) => (t0[k] + t1[k]) / 2;
  // time-weighted sums over a window
  const over = (w0: number, w1: number) => {
    let s = 0, s2 = 0, T = 0;
    const low: [number, number][] = [], high: [number, number][] = [];
    for (let k = 0; k < n; k++) {
      const dt = Math.min(t1[k], w1) - Math.max(t0[k], w0);
      if (!(dt > 0)) continue;
      s += v[k] * dt; s2 += v[k] * v[k] * dt; T += dt;
    }
    const mean = T > 0 ? s / T : NaN;
    for (let k = 0; k < n; k++) {
      const dt = Math.min(t1[k], w1) - Math.max(t0[k], w0);
      if (!(dt > 0)) continue;
      (v[k] > mean ? high : low).push([v[k], dt]);
    }
    return { s, s2, T, mean, base: median(low, mean), top: median(high, mean) };
  };
  const all = over(-Infinity, Infinity);
  // crossings of the 50% level, armed past the hysteresis on the other side, timed by interpolation
  // (hysteresis a tenth of the swing between the levels, so a start-up transient in the window
  // doesn't hide the cycles)
  const mean = all.top > all.base ? (all.base + all.top) / 2 : all.mean, hyst = (all.top > all.base ? all.top - all.base : max - min) * 0.1;
  const rises: number[] = [], falls: number[] = [], riseAt: number[] = [], fallAt: number[] = [];
  if (max > min) {
    let armedUp = false, armedDown = false;
    for (let k = 1; k < n; k++) {
      if (v[k] < mean - hyst) armedUp = true;
      if (v[k] > mean + hyst) armedDown = true;
      const cross = () => tm(k - 1) + ((mean - v[k - 1]) / (v[k] - v[k - 1] || 1)) * (tm(k) - tm(k - 1));
      if (armedUp && v[k - 1] < mean && v[k] >= mean) { rises.push(cross()); riseAt.push(k); armedUp = false; }
      if (armedDown && v[k - 1] > mean && v[k] <= mean) { falls.push(cross()); fallAt.push(k); armedDown = false; }
    }
  }
  const cycles = rises.length - 1;
  const span = wholeCycles && cycles >= 1 ? over(rises[0], rises[cycles]) : all;
  const avg = span.T > 0 ? span.s / span.T : NaN;
  const rms = span.T > 0 ? Math.sqrt(span.s2 / span.T) : NaN;
  const cyc = cycles >= 1 ? over(rises[0], rises[cycles]) : null;
  // each edge: its 10%, 50% and 90% crossings of base…top, from these cells, then (given `fine`)
  // again from the recording's finest detail around it, so a fast edge in a wide view is timed
  // to the solver's resolution rather than the window's
  const { base, top } = span;
  const l10 = base + 0.1 * (top - base), l90 = base + 0.9 * (top - base);
  const at = (k: number, level: number) => tm(k - 1) + ((level - v[k - 1]) / (v[k] - v[k - 1] || 1)) * (tm(k) - tm(k - 1));
  const edges = (indices: number[], crossings: number[], up: boolean) => {
    const from = up ? l10 : l90, to = up ? l90 : l10;
    const durations: number[] = [];
    indices.forEach((k, e) => {
      let a = k;
      while (a > 1 && (up ? v[a - 1] > from : v[a - 1] < from)) a--;
      let b = k;
      while (b < n - 1 && (up ? v[b] < to : v[b] > to)) b++;
      if (a < 1 || (up ? v[a - 1] > from : v[a - 1] < from) || (up ? v[b] < to : v[b] > to)) return;
      let ta = at(a, from), tb = at(b, to);
      if (fine && top > base && e < 64) {
        const f = fineCrossings(fine(tm(Math.max(0, a - 2)), tm(Math.min(n - 1, b + 1))), j, [from, mean, to], up);
        if (f) { [ta, crossings[e], tb] = f; }
      }
      if (tb > ta) durations.push(tb - ta);
    });
    return durations.length ? durations.reduce((x, y) => x + y, 0) / durations.length : NaN;
  };
  const rise = top > base ? edges(riseAt, rises, true) : NaN;
  const fall = top > base ? edges(fallAt, falls, false) : NaN;
  // from the (refined) crossings: period, and pulse width as each rise to the next fall before the
  // following rise
  const period = cycles >= 1 ? (rises[cycles] - rises[0]) / cycles : NaN;
  const widths: number[] = [];
  rises.forEach((r, i) => {
    const f = falls.find((x) => x > r);
    if (f !== undefined && (i + 1 >= rises.length || f < rises[i + 1])) widths.push(f - r);
  });
  const mean0 = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
  return {
    max, min, avg, rms, period,
    duty: period > 0 && widths.length ? mean0(widths) / period : NaN,
    width: mean0(widths),
    rise, fall,
    overshoot: top > base ? Math.max(0, (max - top) / (top - base)) : NaN,
    energy: span.s,
    cycleEnergy: cyc ? cyc.s / cycles : NaN,
    rises,
  };
}

/** Times trace j crosses each level in turn (rising, or falling), in finer cells; null if it doesn't. */
function fineCrossings(cells: Cells, j: number, levels: number[], up: boolean): number[] | null {
  const out: number[] = [];
  let pt = NaN, pv = NaN, li = 0;
  for (let i = 0; i < cells.count && li < levels.length; i++) {
    const o = (i * cells.traces + j) * 2, vv = (cells.v[o] + cells.v[o + 1]) / 2, tt = (cells.ts[i] + cells.te[i]) / 2;
    while (li < levels.length && Number.isFinite(pv) && (up ? pv < levels[li] && vv >= levels[li] : pv > levels[li] && vv <= levels[li])) {
      out.push(pt + ((levels[li] - pv) / (vv - pv || 1)) * (tt - pt));
      li++;
    }
    pt = tt;
    pv = vv;
  }
  return li === levels.length ? out : null;
}

/** The time-weighted median of (value, duration) pairs: a level edges and ringing don't shift. */
function median(xs: [number, number][], fallback: number): number {
  if (!xs.length) return fallback;
  xs.sort((a, b) => a[0] - b[0]);
  const half = xs.reduce((sum, x) => sum + x[1], 0) / 2;
  let acc = 0;
  for (const [value, dt] of xs) if ((acc += dt) >= half) return value;
  return xs[xs.length - 1][0];
}

/** Phase of `rises` after the reference's (degrees, −180…180) and the delay it stands for. */
export function phase(rises: number[], refRises: number[], refPeriod: number): { degrees: number; delay: number } | null {
  if (!(refPeriod > 0) || !rises.length || !refRises.length) return null;
  const delays: number[] = [];
  for (const r of rises) {
    let best = NaN;
    for (const q of refRises) if (q <= r) best = q;
    if (Number.isFinite(best)) delays.push(r - best);
  }
  if (!delays.length) return null;
  let d = delays.reduce((a, b) => a + b, 0) / delays.length;
  d = ((d % refPeriod) + refPeriod) % refPeriod;
  if (d > refPeriod / 2) d -= refPeriod;
  return { degrees: (d / refPeriod) * 360, delay: d };
}

/** The legend text of a trace's measurements, in MEASURES order ("max 10 V  f 52 Hz…"). */
export function measurementText(scope: ScopeRuntime, m: Measured, unit: string, extra: { phase?: { degrees: number; delay: number } | null; efficiency?: number | null }): string {
  const parts: string[] = [];
  const val = (x: number, u: string) => Number.isFinite(x) ? si(x, u, true, 4) : "–";
  const energyUnit = unit === "W" ? "J" : `${unit}·s`;
  for (const def of MEASURES) {
    if (!measureOn(scope, def.key)) continue;
    let text: string | null;
    switch (def.key) {
      case "peak": text = val(m.max, unit); break;
      case "minimum": text = val(m.min, unit); break;
      case "p2p": text = val(m.max - m.min, unit); break;
      case "average": text = val(m.avg, unit); break;
      case "rms": text = val(m.rms, unit); break;
      case "overshoot": text = Number.isFinite(m.overshoot) ? `${(m.overshoot * 100).toFixed(1)}%` : "–"; break;
      case "frequency": text = m.period > 0 ? val(1 / m.period, "Hz") : "–"; break;
      case "period": text = val(m.period, "s"); break;
      case "duty": text = Number.isFinite(m.duty) ? `${(m.duty * 100).toFixed(1)}%` : "–"; break;
      case "width": text = val(m.width, "s"); break;
      case "rise": text = val(m.rise, "s"); break;
      case "fall": text = val(m.fall, "s"); break;
      // phase and efficiency only where there's something to compare with
      case "phase": text = extra.phase === undefined ? null : extra.phase ? `${extra.phase.degrees.toFixed(1)}° (${si(extra.phase.delay, "s", true, 3)})` : "–"; break;
      case "energy": text = val(m.energy, energyUnit); break;
      case "cycleenergy": text = val(m.cycleEnergy, energyUnit); break;
      case "efficiency": text = extra.efficiency === undefined ? null : extra.efficiency !== null && Number.isFinite(extra.efficiency) ? `${(extra.efficiency * 100).toFixed(1)}%` : "–"; break;
      default: text = null;
    }
    if (text !== null) parts.push(`${def.short} ${text}`);
  }
  return parts.join("  ");
}
