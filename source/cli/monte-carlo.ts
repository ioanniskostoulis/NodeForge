// nfsim montecarlo: run a circuit many times, each with its parts varied within their tolerances
// by a different seed, and report how the measurements spread (and which seeds are the extremes).
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { CircuitElm } from "../engine";
import { SimulationModel } from "../app/model";

export interface MonteCarloOptions {
  runs: number;
  /** First seed (runs use seed, seed + 1, …). */
  seed: number;
  /** Circuit time per run (default: 4000 of the circuit's max steps). */
  seconds?: number;
  /** Parts to measure, by designator (default: every part with a designator, up to 12). */
  probes: string[];
  /** Called after each run (progress). */
  progress?: (done: number, total: number) => void;
}

/** What's measured on each probe: its voltage over the settled second half of the run. */
export interface Measures {
  pp: number;
  min: number;
  max: number;
  mean: number;
  rms: number;
  /** Fundamental frequency, from the autocorrelation (0 if it doesn't repeat). */
  freq: number;
  /** When the swing first reached half its final size (start-up), or NaN. */
  start: number;
}

export const MEASURES: (keyof Measures)[] = ["pp", "min", "max", "mean", "rms", "freq", "start"];
export const MEASURE_UNITS: Record<keyof Measures, string> = { pp: "V", min: "V", max: "V", mean: "V", rms: "V", freq: "Hz", start: "s" };

export interface MonteCarloResult {
  probes: string[];
  /** The ideal circuit (no tolerances). */
  nominal: Measures[];
  runs: { seed: number; measures: Measures[]; stopped: string | null }[];
  seconds: number;
  /** Probes asked for that aren't in the circuit. */
  missing: string[];
}

/** Simulate once (ideal, or with tolerances by a seed) and measure the probes. */
function runOnce(text: string, seconds: number | undefined, probes: string[], seed: number | null) {
  const model = new SimulationModel(text);
  const sim = model.sim;
  model.tolerance.enabled = seed !== null;
  if (seed !== null) model.tolerance.seed = seed;
  const byName = new Map<string, CircuitElm>();
  for (const element of model.circuit.elements) {
    const designator = model.designator(element);
    if (designator) byName.set(designator, element);
  }
  const elms = probes.map((p) => byName.get(p) ?? null);
  const end = seconds ?? sim.maxTimeStep * 4000;
  const t: number[] = [];
  const v: number[][] = probes.map(() => []);
  while (sim.t < end && sim.stopMessage === null) {
    model.tolerance.apply(model.circuit.elements, (element) => model.designator(element));
    try {
      sim.update(() => true);
    } finally {
      model.tolerance.restore();
    }
    t.push(sim.t);
    elms.forEach((e, j) => v[j].push(e ? e.getVoltageDiff() : 0));
  }
  return { measures: v.map((series) => measure(t, series)), stopped: sim.stopMessage, end };
}

function measure(t: number[], v: number[]): Measures {
  const n = t.length;
  const nan: Measures = { pp: NaN, min: NaN, max: NaN, mean: NaN, rms: NaN, freq: NaN, start: NaN };
  if (n < 4) return nan;
  // the settled part: the second half of the run, weighted by time (steps vary)
  const tHalf = t[n - 1] / 2;
  let lo = Infinity, hi = -Infinity, sum = 0, sum2 = 0, span = 0;
  for (let i = 1; i < n; i++) {
    if (t[i] < tHalf) continue;
    const dt = t[i] - t[i - 1];
    lo = Math.min(lo, v[i]);
    hi = Math.max(hi, v[i]);
    sum += v[i] * dt;
    sum2 += v[i] * v[i] * dt;
    span += dt;
  }
  const mean = sum / span;
  // start-up: the running swing from the start first reaching half the settled swing
  let start = NaN, rlo = Infinity, rhi = -Infinity;
  if (hi - lo > 1e-9) {
    for (let i = 0; i < n; i++) {
      rlo = Math.min(rlo, v[i]);
      rhi = Math.max(rhi, v[i]);
      if (rhi - rlo >= (hi - lo) / 2) {
        start = t[i];
        break;
      }
    }
  }
  return { pp: hi - lo, min: lo, max: hi, mean, rms: Math.sqrt(sum2 / span), freq: hi - lo > 1e-9 ? fundamental(t, v, tHalf) : 0, start };
}

/**
 * The fundamental frequency of the settled part (0 if it doesn't repeat), from its autocorrelation:
 * resampled evenly, the first lag where it repeats strongly (past the first dip), refined between
 * samples. Unlike counting mean crossings, harmonics and lopsided waveforms don't fool it.
 */
function fundamental(t: number[], v: number[], from: number): number {
  const N = 2048;
  const t0 = from, t1 = t[t.length - 1], dt = (t1 - t0) / (N - 1);
  if (!(dt > 0)) return 0;
  const x = new Float64Array(N);
  let k = 0;
  for (let i = 0; i < N; i++) {
    const ti = t0 + i * dt;
    while (k + 1 < t.length && t[k + 1] < ti) k++;
    const a = t[k], b = t[Math.min(k + 1, t.length - 1)];
    x[i] = b > a ? v[k] + ((v[Math.min(k + 1, t.length - 1)] - v[k]) * (ti - a)) / (b - a) : v[k];
  }
  let m = 0;
  for (const y of x) m += y;
  m /= N;
  for (let i = 0; i < N; i++) x[i] -= m;
  // autocorrelation up to half the window (at least two periods must fit)
  const maxLag = N >> 1;
  const ac = new Float64Array(maxLag);
  for (let lag = 0; lag < maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < N; i++) s += x[i] * x[i + lag];
    ac[lag] = s / (N - lag);
  }
  if (!(ac[0] > 0)) return 0;
  // past the first dip below zero: the first peak at least half as high as the highest one (a
  // slightly modulated wave repeats best over several periods, but its period is the first
  // strong repeat), and a clear one (over 10% of the zero-lag value)
  let lag = 1;
  while (lag < maxLag && ac[lag] > 0) lag++;
  const peaks: number[] = [];
  for (let i = lag + 1; i < maxLag - 1; i++) if (ac[i] >= ac[i - 1] && ac[i] >= ac[i + 1] && ac[i] > 0.1 * ac[0]) peaks.push(i);
  if (!peaks.length) return 0;
  const top = Math.max(...peaks.map((i) => ac[i]));
  const best = peaks.find((i) => ac[i] >= 0.5 * top)!;
  // parabolic refinement of the peak
  const y0 = ac[best - 1], y1 = ac[best], y2 = ac[best + 1];
  const d = y0 - 2 * y1 + y2;
  const peak = best + (d !== 0 ? (0.5 * (y0 - y2)) / d : 0);
  return 1 / (peak * dt);
}

export function monteCarlo(text: string, opts: MonteCarloOptions): MonteCarloResult {
  // which parts: as asked, or every part with a designator (wires and grounds have none)
  const probe = new SimulationModel(text);
  const names = probe.circuit.elements.map((e) => probe.designator(e)).filter((d): d is string => !!d);
  const probes = opts.probes.length ? opts.probes.filter((p) => names.includes(p)) : names.slice(0, 12);
  const missing = opts.probes.filter((p) => !names.includes(p));
  const nominal = runOnce(text, opts.seconds, probes, null);
  const runs: MonteCarloResult["runs"] = [];
  for (let i = 0; i < opts.runs; i++) {
    const seed = opts.seed + i;
    const r = runOnce(text, opts.seconds, probes, seed);
    runs.push({ seed, measures: r.measures, stopped: r.stopped });
    opts.progress?.(i + 1, opts.runs);
  }
  return { probes, nominal: nominal.measures, runs, seconds: nominal.end, missing };
}

/** Mean, standard deviation, extremes (with their seeds) of one measure of one probe over the runs. */
export function spread(result: MonteCarloResult, probe: number, key: keyof Measures) {
  const vals = result.runs.map((r) => ({ seed: r.seed, v: r.measures[probe][key] })).filter((x) => Number.isFinite(x.v));
  if (!vals.length) return null;
  const mean = vals.reduce((a, x) => a + x.v, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, x) => a + (x.v - mean) ** 2, 0) / Math.max(1, vals.length - 1));
  const min = vals.reduce((a, x) => (x.v < a.v ? x : a));
  const max = vals.reduce((a, x) => (x.v > a.v ? x : a));
  return { mean, sd, min, max, count: vals.length };
}
