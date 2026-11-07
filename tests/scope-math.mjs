// Scope numbers: 1-2-5 scales, recorded-cell statistics and the FFT.
import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({ entryPoints: ["source/app/scope-math.ts"], bundle: true, platform: "node", format: "esm", write: false });
const { centeredScale, fft, fitScale, harmonics, spectrum, holdEnvelope, holdScale, originScale, niceCeil, niceFloor, SHRINK_DELAY, stats, stepScale } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);

assert.equal(niceCeil(0.13), 0.2);
assert.equal(niceCeil(5), 5);
assert.equal(niceCeil(5.1), 10);
assert.equal(niceFloor(0.13), 0.1);
assert.equal(niceFloor(7), 5);
assert.equal(stepScale(1, 1), 2);
assert.equal(stepScale(2, 1), 5);
assert.equal(stepScale(1, -1), 0.5);

// a ±5 swing at 8 divisions: 2 per division, centered on zero
const s = fitScale(-5, 5);
assert.equal(s.perDiv, 2);
assert.equal(s.center, 0);
assert.deepEqual(fitScale(0, 0), { perDiv: 1, center: 0 });
assert.deepEqual(fitScale(NaN, 1), { perDiv: 1, center: 0 });
// the fit always shows the whole range
for (const [lo, hi] of [[0.2, 0.9], [-3, 40], [1e-6, 3e-6], [-0.7, -0.1]]) {
  const f = fitScale(lo, hi);
  assert.ok(f.center - 4 * f.perDiv <= lo && f.center + 4 * f.perDiv >= hi, `range ${lo}…${hi}`);
}

// held auto scale: still while the data fits, grows at once, shrinks one step only after a delay
{
  let held = holdScale(undefined, fitScale(-5, 5), -5, 5, 0);
  assert.equal(held.perDiv, 2);
  held = holdScale(held, fitScale(-4, 3), -4, 3, 10);
  assert.deepEqual([held.perDiv, held.center], [2, 0], "a smaller swing inside keeps the scale");
  held = holdScale(held, fitScale(-3, 3), -3, 3, 20);
  assert.equal(held.perDiv, 2, "one step smaller is held at first");
  held = holdScale(held, fitScale(-3, 3), -3, 3, 20 + SHRINK_DELAY);
  assert.equal(held.perDiv, 1, "and followed once it has lasted");
  held = holdScale(held, fitScale(-9, 9), -9, 9, 5000);
  assert.ok(held.center - 4 * held.perDiv <= -9 && held.center + 4 * held.perDiv >= 9, "outgrown: at once");
  held = holdScale(held, fitScale(-1, 1), -1, 1, 5001);
  assert.ok(held.perDiv <= 0.5, "two steps smaller: at once");
  assert.equal(holdScale(held, fitScale(NaN, NaN), NaN, NaN, 6000), held, "no data keeps the scale");
}

// X-Y: the gathered range grows at once, shrinks only after a delay; scales center on it or on zero
{
  let e = holdEnvelope(undefined, -1, 1, 0);
  e = holdEnvelope(e, -1.7, 1.2, 10);
  assert.deepEqual([e.lo, e.hi], [-1.7, 1.2], "grows to take in new points");
  e = holdEnvelope(e, -1, 1, 20);
  assert.deepEqual([e.lo, e.hi], [-1.7, 1.2], "held while the data is inside");
  e = holdEnvelope(e, -1, 1, 20 + SHRINK_DELAY);
  assert.deepEqual([e.lo, e.hi], [-1, 1], "shrinks once that has lasted");
  const c = centeredScale(-1.7, 1.7, 10);
  assert.deepEqual([c.perDiv, c.center], [0.5, 0], "a symmetric figure is centered, no room left over on one side");
  const y = centeredScale(0.7, 4.4, 8);
  assert.ok(Math.abs(y.center - 2.55) <= 0.025 + 1e-9 && y.perDiv === 0.5, "centered on the figure, to a tenth of a division, filling it");
  assert.deepEqual(originScale(4.4, 8), { perDiv: 2, center: 0 });
}

// spectrum: each window reads a sinusoid's amplitude at its peak (flat-top exactly, between bins too)
{
  const n = 1024, sig = (f, a) => Float64Array.from({ length: n }, (_, k) => a * Math.sin(2 * Math.PI * f * k / n));
  for (const w of ["hann", "flattop", "rect"]) {
    const m = spectrum(sig(64, 3), w);
    assert.ok(Math.abs(m[64] - 3) < 0.01, `${w}: 3 V on a bin reads ${m[64]}`);
  }
  const between = spectrum(sig(64.5, 3), "flattop");
  assert.ok(Math.abs(Math.max(...between) - 3) < 0.01, "flat-top: 3 V between bins still reads 3 V");
  // harmonics and THD: 10% second and 5% third harmonic → THD √(0.1² + 0.05²) ≈ 11.18%
  const x = Float64Array.from({ length: n }, (_, k) => {
    const p = 2 * Math.PI * 50 * k / n;
    return Math.sin(p) + 0.1 * Math.sin(2 * p) + 0.05 * Math.sin(3 * p);
  });
  const h = harmonics(spectrum(x, "flattop"));
  assert.deepEqual(h.bins.slice(0, 3), [50, 100, 150]);
  assert.ok(Math.abs(h.thd - Math.hypot(0.1, 0.05)) < 0.002, `THD ${h.thd}`);
  assert.ok(Math.abs(h.fundamental - 50) < 0.01);
}

// FFT: a sine of 8 cycles in 64 samples peaks in bin 8
const n = 64, re = new Float64Array(n), im = new Float64Array(n);
for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 8 * i) / n);
fft(re, im);
const mag = Array.from(re, (r, i) => Math.hypot(r, im[i]));
assert.equal(mag.indexOf(Math.max(...mag.slice(0, n / 2))), 8);
assert.ok(Math.abs(mag[8] - n / 2) < 1e-9);

// statistics of a 1 kHz square-ish wave recorded in 10 µs cells (min = max per cell)
const cells = { count: 400, traces: 1, ts: [], te: [], v: [] };
for (let i = 0; i < 400; i++) {
  const v = Math.sin((2 * Math.PI * 1000 * (i * 1e-5))) > 0 ? 1 : -1;
  cells.ts.push(i * 1e-5); cells.te.push((i + 1) * 1e-5); cells.v.push(v, v);
}
const st = stats(cells, 0, 0, 1);
assert.equal(st.max, 1);
assert.equal(st.min, -1);
assert.ok(Math.abs(st.rms - 1) < 1e-9);
assert.ok(Math.abs(st.freq - 1000) < 10, `freq ${st.freq}`);
assert.deepEqual(stats({ count: 0, traces: 1, ts: [], te: [], v: [] }, 0, 0, 1), { max: 0, min: 0, rms: 0, freq: 0 });
console.log("Scope math passed: 1-2-5 scales, fit ranges, FFT bin, stats and frequency.");
