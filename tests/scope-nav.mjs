// Scope navigation: zooming, panning and boxes as ranges, and grid lines on round values.
import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({ entryPoints: ["source/app/scope-nav.ts"], bundle: true, platform: "node", format: "esm", write: false });
const { panRange, rangeOf, scaleOf, subRange, ticks, zoomRange } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);

const close = (a, b) => Math.abs(a - b) < 1e-9;
// zoom keeps the value under the pointer in place
const z = zoomRange({ lo: 0, hi: 10 }, 0.5, 0.2);
assert.ok(close(z.lo, 1) && close(z.hi, 6), "zoom in at 2 (a fifth across)");
assert.ok(close(z.lo + 0.2 * (z.hi - z.lo), 2));
// pan by a fraction of the range
assert.deepEqual(panRange({ lo: 0, hi: 10 }, 0.25), { lo: 2.5, hi: 12.5 });
// a box, in either drag direction
assert.deepEqual(subRange({ lo: 0, hi: 10 }, 0.6, 0.2), { lo: 2, hi: 6 });
// scales and ranges round-trip
const r = rangeOf({ perDiv: 0.5, center: 1 }, 8);
assert.deepEqual(r, { lo: -1, hi: 3 });
assert.deepEqual(scaleOf(r, 8), { perDiv: 0.5, center: 1 });
// grid lines on round values, wherever the range sits
const t = ticks({ lo: -0.37, hi: 3.6 }, 8);
assert.equal(t.step, 0.5);
assert.deepEqual(t.values.map((v) => Number(v.toFixed(9))), [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
assert.ok(ticks({ lo: 2.3, hi: 2.3 }, 8).values.length === 0, "an empty range has no lines");
assert.ok(ticks({ lo: -4, hi: 4 }, 8).values.includes(0), "zero is a line (drawn stronger)");
// axis labels: one form of the unit across the axis, decimals from the step
const fb = await build({ entryPoints: ["source/app/format.ts"], bundle: true, platform: "node", format: "esm", write: false });
const { axisFormat, si, parseSI } = await import(`data:text/javascript;base64,${Buffer.from(fb.outputFiles[0].contents).toString("base64")}`);
const volts = axisFormat(1.5, 0.5, "V");
assert.deepEqual([-0.5, 0, 0.5, 1, 1.5].map(volts), ["-0.5 V", "0.0 V", "0.5 V", "1.0 V", "1.5 V"], "never 500mV beside 1V");
const milli = axisFormat(0.8, 0.2, "V");
assert.deepEqual([0, 0.2, 0.8].map(milli), ["0 mV", "200 mV", "800 mV"]);
assert.deepEqual([0.98, 1, 1.02].map(axisFormat(1.02, 0.01, "s")), ["0.98 s", "1.00 s", "1.02 s"], "a time axis across 1 s");
assert.equal(axisFormat(1, 0.5, "V")(-1e-17), "0.0 V", "no negative zero");
console.log("Scope navigation passed: zoom, pan, box, scale round-trip, round grid lines and one unit per axis.");

// Display uses spaced units; both old compact values and spaced values remain editable.
for (const [value, unit, shown] of [[4700, "Ω", "4.7 kΩ"], [300e-9, "F", "300 nF"], [5, "°C/W", "5 °C/W"], [0, "V", "0 V"], [-0.002, "A", "-2 mA"]]) {
  assert.equal(si(value, unit), shown);
  for (const text of [shown, shown.replaceAll(" ", "")]) assert.ok(Math.abs(parseSI(text, unit) - value) <= Math.abs(value) * 1e-12);
}
assert.equal(si(5, ""), "5", "unitless numbers have no trailing space");
