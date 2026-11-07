// Scope measurements on synthetic waveforms with known answers: levels, timing, edges, phase, energy.
import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({ entryPoints: ["source/app/scope-measure.ts"], bundle: true, platform: "node", format: "esm", write: false, logLevel: "error" });
const { measure, phase } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);

/** Cells of one or more traces sampled every dt from 0 to T (each cell a point: min = max). */
function cells(T, dt, ...fs) {
  const n = Math.round(T / dt), ts = [], te = [], v = [];
  for (let i = 0; i < n; i++) {
    ts.push(i * dt); te.push((i + 1) * dt);
    for (const f of fs) { const x = f((i + 0.5) * dt); v.push(x, x); }
  }
  return { count: n, traces: fs.length, ts, te, v };
}
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

// a 1 kHz square wave, 0…5 V, 30% duty, with 10 µs linear edges
const period = 1e-3, edge = 10e-6, duty = 0.3;
const square = (t) => {
  const p = ((t % period) + period) % period, hi = duty * period;
  if (p < edge) return 5 * (p / edge);
  if (p < hi) return 5;
  if (p < hi + edge) return 5 * (1 - (p - hi) / edge);
  return 0;
};
const sq = measure(cells(10e-3, 0.2e-6, square), 0, 0, 10e-3, true);
near(sq.period, 1e-3, 1e-7, "period");
near(sq.max, 5, 1e-9, "peak");
near(sq.min, 0, 1e-9, "minimum");
near(sq.duty, 0.3, 0.01, "duty cycle");
near(sq.width, 0.3e-3, 2e-6, "pulse width");
near(sq.rise, 8e-6, 0.5e-6, "rise time 10–90% of a 10 µs edge");
near(sq.fall, 8e-6, 0.5e-6, "fall time");
near(sq.overshoot, 0, 0.01, "no overshoot");
near(sq.avg, 5 * (duty), 0.05, "average over whole cycles");

// a 50 Hz sine of 10 V peak: RMS 7.07 V, average 0, energy of its square over whole cycles
const sine = (t) => 10 * Math.sin(2 * Math.PI * 50 * t);
const si = measure(cells(0.105, 10e-6, sine, (t) => sine(t) ** 2 / 10), 0, 0, 0.105, true);
near(si.rms, 10 / Math.SQRT2, 0.01, "sine RMS");
near(si.avg, 0, 0.01, "sine average over whole cycles");
near(1 / si.period, 50, 0.01, "frequency");
const pw = measure(cells(0.105, 10e-6, sine, (t) => sine(t) ** 2 / 10), 1, 0, 0.105, true);
near(pw.avg, 5, 0.01, "average power of V²/R");
near(pw.cycleEnergy, 5 / 100, 0.001, "energy per cycle (cycles of the power trace: 100 Hz)");

// phase: the second sine lags the first by 90°, a quarter-period delay
const both = cells(0.1, 10e-6, (t) => Math.sin(2 * Math.PI * 50 * t), (t) => Math.sin(2 * Math.PI * 50 * t - Math.PI / 2));
const a = measure(both, 0, 0, 0.1, false), b = measure(both, 1, 0, 0.1, false);
const ph = phase(b.rises, a.rises, a.period);
near(ph.degrees, 90, 0.5, "lagging by a quarter period");
near(ph.delay, 5e-3, 0.05e-3, "the delay");

// overshoot: a step that rings 20% above its top before settling
const ring = (t) => { const p = t % 1e-3; return p < 0.5e-3 ? 0 : 1 + 0.2 * Math.exp(-(p - 0.5e-3) / 20e-6) * Math.cos((2 * Math.PI * (p - 0.5e-3)) / 40e-6); };
const os = measure(cells(5e-3, 0.1e-6, ring), 0, 0, 5e-3, true);
near(os.overshoot, 0.2, 0.03, "overshoot");

// a 100 ns edge seen in a 10 ms window: coarse cells (10 µs) can't time it; the finest detail can
{
  const fast = (t) => { const p = ((t % 1e-3) + 1e-3) % 1e-3; return p < 100e-9 ? 5 * p / 100e-9 : p < 0.5e-3 ? 5 : p < 0.5e-3 + 100e-9 ? 5 * (1 - (p - 0.5e-3) / 100e-9) : 0; };
  /** cells of `fast` from a to b, each `dt` long, holding their min and max like the recording */
  const span = (a, b, dt) => {
    const n = Math.ceil((b - a) / dt), ts = [], te = [], v = [];
    for (let i = 0; i < n; i++) {
      const s0 = a + i * dt, s1 = s0 + dt;
      let lo = Infinity, hi = -Infinity;
      for (let k = 0; k <= 20; k++) { const x = fast(s0 + (s1 - s0) * k / 20); lo = Math.min(lo, x); hi = Math.max(hi, x); }
      ts.push(s0); te.push(s1); v.push(lo, hi);
    }
    return { count: n, traces: 1, ts, te, v };
  };
  const coarse = span(0, 10e-3, 10e-6);
  const rough = measure(coarse, 0, 0, 10e-3, true);
  const sharp = measure(coarse, 0, 0, 10e-3, true, (a, b) => span(a, b, 1e-9));
  assert.ok(rough.rise > 1e-6, `coarse cells can't see a 100 ns edge (${rough.rise})`);
  near(sharp.rise, 80e-9, 5e-9, "rise time from the finest detail");
  near(sharp.fall, 80e-9, 5e-9, "fall time from the finest detail");
  near(sharp.width, 0.5e-3, 50e-9, "pulse width at 50%");
  near(sharp.period, 1e-3, 1e-9, "period");
}

// nothing in the window
assert.ok(Number.isNaN(measure(cells(1e-3, 1e-6, square), 0, 2, 3, false).max));
console.log("Scope measurements passed: levels, period, duty, width, edges, overshoot, phase, power and energy.");
