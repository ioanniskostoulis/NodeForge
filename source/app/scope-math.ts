// Pure numbers behind the scopes: recorded cells, statistics, 1-2-5 scales and the FFT.
import type { ScopeScale } from "./model";
import type { CellVisitor, Recording } from "./recording";

export const DIVS_Y = 8;

export interface Stats {
  max: number;
  min: number;
  rms: number;
  freq: number;
}

/** Max, min, RMS and frequency (from mean crossings) within the time window. */
export function stats(cells: Cells, j: number, x0: number, x1: number): Stats {
  let max = -Infinity, min = Infinity, sum = 0, sum2 = 0, count = 0;
  const inView = (i: number) => cells.te[i] > x0 && cells.ts[i] < x1;
  for (let i = 0; i < cells.count; i++) {
    if (!inView(i)) continue;
    const o = (i * cells.traces + j) * 2;
    max = Math.max(max, cells.v[o + 1]);
    min = Math.min(min, cells.v[o]);
    const mid = (cells.v[o] + cells.v[o + 1]) / 2;
    sum += mid;
    sum2 += mid * mid;
    count++;
  }
  if (!count) return { max: 0, min: 0, rms: 0, freq: 0 };
  const mean = sum / count;
  // rising crossings of the mean, with hysteresis, timed by the cells' start times
  const hyst = (max - min) * 0.1;
  let crossings = 0, first = 0, last = 0, armed = false;
  for (let i = 0; i < cells.count; i++) {
    if (!inView(i)) continue;
    const o = (i * cells.traces + j) * 2;
    const v = (cells.v[o] + cells.v[o + 1]) / 2;
    if (v < mean - hyst) armed = true;
    else if (armed && v > mean + hyst) {
      armed = false;
      if (crossings === 0) first = cells.ts[i];
      last = cells.ts[i];
      crossings++;
    }
  }
  const freq = crossings >= 2 && last > first ? (crossings - 1) / (last - first) : 0;
  return { max, min, rms: Math.sqrt(sum2 / count), freq };
}

/** A recording's cells read for one frame: their time spans and, per trace, min and max. */
export interface Cells {
  count: number;
  traces: number;
  ts: number[];
  te: number[];
  /** v[(cell * traces + trace) * 2] = min, + 1 = max. */
  v: number[];
}

export const EMPTY_CELLS: Cells = { count: 0, traces: 0, ts: [], te: [], v: [] };

export function collect(rec: Recording, read: (cb: CellVisitor) => void): Cells {
  const c: Cells = { count: 0, traces: rec.traces, ts: [], te: [], v: [] };
  read((tStart, tEnd, data, offset) => {
    c.ts.push(tStart);
    c.te.push(tEnd);
    for (let k = 0; k < rec.traces * 2; k++) c.v.push(data[offset + k]);
    c.count++;
  });
  return c;
}

/** A level's cells overlapping [t0, t1]. */
export function readCells(rec: Recording, level: number, t0: number, t1: number): Cells {
  return collect(rec, (cb) => rec.visit(level, t0, t1, cb));
}

/** A level's newest n cells. */
export function readTail(rec: Recording, level: number, n: number): Cells {
  return collect(rec, (cb) => rec.tail(level, n, cb));
}

/**
 * A scale showing lo…hi at 1-2-5 per division. Time plots keep the middle on a labeled line
 * and nearby zero in view; X-Y plots can center more closely on their data.
 */
export function fitScale(lo: number, hi: number, divisions = DIVS_Y, includeNearbyZero = true, centerStep = 2): ScopeScale {
  if (!(lo <= hi)) return { perDiv: 1, center: 0 };
  if (lo === 0 && hi === 0) return { perDiv: 1, center: 0 };
  const swing = hi - lo;
  if (includeNearbyZero && lo > 0 && lo <= swing) lo = 0;
  if (includeNearbyZero && hi < 0 && -hi <= swing) hi = 0;
  const range = hi - lo || Math.max(Math.abs(hi) * 0.2, 1e-12);
  const centerFor = (perDiv: number) => Math.round((lo + hi) / 2 / (centerStep * perDiv)) * centerStep * perDiv;
  let perDiv = niceCeil(range / (divisions * 0.9));
  for (let i = 0; i < 4; i++) {
    const center = centerFor(perDiv);
    if (center - (divisions / 2) * perDiv <= lo && center + (divisions / 2) * perDiv >= hi) return { perDiv, center };
    perDiv = niceCeil(perDiv * 1.01);
  }
  return { perDiv, center: centerFor(perDiv) };
}

/** An automatic scale being held, and since when (ms) a smaller one would have done. */
export interface HeldScale extends ScopeScale {
  smallerSince?: number;
}

/** How long (ms) data must fit one 1-2-5 step smaller before the scale follows it. */
export const SHRINK_DELAY = 3000;

/**
 * An automatic scale that holds still: it grows at once when lo…hi leaves it, shrinks at once to
 * data two 1-2-5 steps smaller (a quarter of the range), and one step only after the data has fit
 * that for SHRINK_DELAY (so a start-up transient is forgotten, but nothing twitches).
 */
export function holdScale(held: HeldScale | undefined, fit: ScopeScale, lo: number, hi: number, now: number, divisions = DIVS_Y): HeldScale {
  if (!held) return { ...fit };
  if (!(lo <= hi)) return held;
  const half = (held.perDiv * divisions) / 2;
  if (lo < held.center - half || hi > held.center + half || fit.perDiv * 4 <= held.perDiv) return { ...fit };
  if (fit.perDiv < held.perDiv) {
    held.smallerSince ??= now;
    return now - held.smallerSince >= SHRINK_DELAY ? { ...fit } : held;
  }
  held.smallerSince = undefined;
  return held;
}

/** The range an X-Y axis has gathered, and since when (ms) its data has been well inside it. */
export interface Envelope {
  lo: number;
  hi: number;
  shrinkSince?: number;
}

/**
 * The range gathered so far on an X-Y axis: it grows at once to take in lo…hi, and shrinks to
 * lo…hi only after the data has stayed more than a tenth of the range inside it for SHRINK_DELAY.
 */
export function holdEnvelope(held: Envelope | undefined, lo: number, hi: number, now: number): Envelope | undefined {
  if (!(lo <= hi)) return held;
  if (!held) return { lo, hi };
  if (lo < held.lo || hi > held.hi) return { lo: Math.min(lo, held.lo), hi: Math.max(hi, held.hi) };
  if (lo - held.lo + (held.hi - hi) > 0.1 * (held.hi - held.lo)) {
    held.shrinkSince ??= now;
    if (now - held.shrinkSince >= SHRINK_DELAY) return { lo, hi };
  } else held.shrinkSince = undefined;
  return held;
}

/** A scale centered on lo…hi (to a tenth of a division), 1-2-5 per division, with 5% room. */
export function centeredScale(lo: number, hi: number, divisions: number): ScopeScale {
  if (!(lo <= hi)) return { perDiv: 1, center: 0 };
  const range = hi - lo || Math.max(Math.abs(hi) * 0.2, 1e-12);
  const perDiv = niceCeil(range / (divisions * 0.95));
  const step = perDiv / 10;
  return { perDiv, center: Math.round((lo + hi) / 2 / step) * step };
}

/** A scale with zero in the middle that shows ±max, 1-2-5 per division. */
export function originScale(max: number, divisions: number): ScopeScale {
  return { perDiv: niceCeil((max || 1) / ((divisions / 2) * 0.9)), center: 0 };
}

/** One 1-2-5 step up (dir > 0) or down from a per-division value. */
export function stepScale(perDiv: number, dir: number): number {
  return dir > 0 ? niceCeil(perDiv * 1.01) : niceFloor(perDiv * 0.99);
}

export function niceFloor(v: number): number {
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [5, 2, 1]) if (m * e <= v * 1.0001) return m * e;
  return e / 2;
}

/** FFT windows: Hann (clean peaks), flat-top (accurate amplitudes), rectangular (none). */
export type FFTWindow = "hann" | "flattop" | "rect";

/**
 * The amplitude spectrum of x (power-of-two length): DC removed, windowed, and scaled by the
 * window's coherent gain so a sinusoid of amplitude A reads A at its bin (any window).
 */
export function spectrum(x: ArrayLike<number>, window: FFTWindow): Float64Array {
  const n = x.length, re = new Float64Array(n), im = new Float64Array(n);
  let mean = 0;
  for (let k = 0; k < n; k++) mean += x[k];
  mean /= n;
  let gain = 0;
  for (let k = 0; k < n; k++) {
    const p = (2 * Math.PI * k) / (n - 1);
    const w = window === "rect" ? 1 : window === "hann" ? 0.5 - 0.5 * Math.cos(p)
      // the standard five-term flat-top (amplitude error under 0.01 dB)
      : 0.21557895 - 0.41663158 * Math.cos(p) + 0.277263158 * Math.cos(2 * p) - 0.083578947 * Math.cos(3 * p) + 0.006947368 * Math.cos(4 * p);
    re[k] = (x[k] - mean) * w;
    gain += w;
  }
  fft(re, im);
  const mags = new Float64Array(n / 2);
  for (let k = 1; k < n / 2; k++) mags[k] = (2 * Math.hypot(re[k], im[k])) / gain;
  return mags;
}

/**
 * The fundamental (the strongest bin, refined between bins) and its harmonics 2…count: each the
 * strongest bin within ±2 of its multiple. THD is their RMS over the fundamental.
 */
export function harmonics(mags: Float64Array, count = 10): { fundamental: number; bins: number[]; amps: number[]; thd: number } {
  let peak = 1;
  for (let k = 1; k < mags.length; k++) if (mags[k] > mags[peak]) peak = k;
  // a parabola through the peak and its neighbours (in dB) places the fundamental between bins
  const a = Math.log(mags[peak - 1] || 1e-300), b = Math.log(mags[peak] || 1e-300), c = Math.log(mags[peak + 1] || 1e-300);
  const delta = peak > 1 && peak + 1 < mags.length && a - 2 * b + c !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / (a - 2 * b + c))) : 0;
  const f1 = peak + delta;
  const bins = [peak], amps = [mags[peak]];
  let sum = 0;
  for (let h = 2; h <= count; h++) {
    const center = Math.round(h * f1);
    if (center + 2 >= mags.length) break;
    let best = center;
    for (let k = center - 2; k <= center + 2; k++) if (k > 0 && mags[k] > mags[best]) best = k;
    bins.push(best);
    amps.push(mags[best]);
    sum += mags[best] ** 2;
  }
  return { fundamental: f1, bins, amps, thd: mags[peak] > 0 ? Math.sqrt(sum) / mags[peak] : NaN };
}

/** In-place radix-2 FFT (length must be a power of two). */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export function niceCeil(v: number): number {
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 5, 10]) if (m * e >= v * 0.9999) return m * e;
  return 10 * e;
}
