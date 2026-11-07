// The AC sweep scope: the model linearizes a copy of the circuit (the running one left as it is)
// and gives each voltage's magnitude (dB) and phase (degrees) per frequency, for a Bode plot.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: 'export { SimulationModel } from "./source/app/model.ts";', resolveDir: ".", loader: "ts" },
  bundle: true, platform: "node", format: "esm", write: false, logLevel: "error", keepNames: true,
  define: { "import.meta.url": JSON.stringify("http://localhost/app.js") },
});
const { SimulationModel } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);

// the RC test: V1 through R1 (1 kΩ) into C1 (1 µF), a low-pass at 159 Hz
const m = new SimulationModel(readFileSync("tests/accuracy/rc.txt", "utf8"));
const part = (name) => m.circuit.elements.find((e) => m.designator(e) === name);
const before = m.serialize("xml").text;
const scope = m.acSweep(part("V1"), 10, 1e5, 10, [m.traceFor("V(C1)"), m.traceFor("V(R1)")]);
assert.equal(typeof scope, "object", String(scope));
const sw = scope.sweep;
assert.equal(sw.unit, "Hz");
assert.equal(sw.x.length, 41);
assert.ok(Math.abs(sw.x[40] - 1e5) < 1e-6);
// V(C1) = 1/(1 + jωRC), V(R1) = jωRC/(1 + jωRC)
sw.x.forEach((f, i) => {
  const wrc = 2 * Math.PI * f * 1e-3, den = Math.hypot(1, wrc);
  const cases = [[sw.series[0][i], -20 * Math.log10(den), sw.phase[0][i], -Math.atan(wrc) * 180 / Math.PI],
    [sw.series[1][i], 20 * Math.log10(wrc / den), sw.phase[1][i], 90 - Math.atan(wrc) * 180 / Math.PI]];
  for (const [db, dbWant, deg, degWant] of cases) {
    assert.ok(Math.abs(db - dbWant) < 1e-6, `${f} Hz: ${db} dB, not ${dbWant}`);
    assert.ok(Math.abs(deg - degWant) < 1e-5, `${f} Hz: ${deg}°, not ${degWant}`);
  }
});
// the running circuit is untouched, and the result isn't saved with it
assert.equal(m.sim.t, 0);
assert.equal(m.serialize("xml").text, before);
// Run and Reset run it again on the circuit as it is: R1 at 2 kΩ moves the corner, in the same scope
const scopes = m.scopes.length;
part("R1").resistance = 2000;
assert.deepEqual(m.rerunSweeps(), []);
assert.equal(m.scopes.length, scopes);
const w = 2 * Math.PI * scope.sweep.x[20] * 2e-3;
assert.ok(Math.abs(scope.sweep.series[0][20] + 10 * Math.log10(1 + w * w)) < 1e-6, `after the edit: ${scope.sweep.series[0][20]} dB`);
part("R1").resistance = 1000;
m.rerunSweeps();
// a transistor stage at its operating point: finite values throughout, phase unwrapped (no jumps)
const b = new SimulationModel(readFileSync("tests/devices/bjt-switch.xml", "utf8"));
const bs = b.acSweep(b.circuit.elements.find((e) => b.designator(e) === "V1"), 1, 1e9, 5, [b.traceFor("V(R2)")]);
assert.equal(typeof bs, "object", String(bs));
assert.ok(bs.sweep.series[0].every(Number.isFinite) && bs.sweep.phase[0].every(Number.isFinite));
for (let i = 1; i < bs.sweep.x.length; i++) assert.ok(Math.abs(bs.sweep.phase[0][i] - bs.sweep.phase[0][i - 1]) < 180);
// not a source, not a voltage, or no sweep: a reason
assert.equal(typeof m.acSweep(part("R1"), 10, 1e5, 10, [m.traceFor("V(C1)")]), "string");
assert.equal(typeof m.acSweep(part("V1"), 10, 1e5, 10, [m.traceFor("I(C1)")]), "string");
assert.equal(typeof m.acSweep(part("V1"), 1e5, 10, 10, [m.traceFor("V(C1)")]), "string");
console.log("ac sweep: 7 checks passed");
