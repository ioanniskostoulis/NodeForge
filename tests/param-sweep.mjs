// Parameter sweeps: a run per value, each from the start on a copy of the circuit, the runs overlaid
// in one scope. Checked on an RC charge, whose curve for each R is known: 10·(1 − e^(−t/RC)).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: 'export { SimulationModel } from "./source/app/model.ts"; export { prepareProperty } from "./source/app/console-edit.ts";', resolveDir: ".", loader: "ts" },
  bundle: true, platform: "node", format: "esm", write: false, logLevel: "error", keepNames: true,
  define: { "import.meta.url": JSON.stringify("http://localhost/app.js") },
});
const { SimulationModel, prepareProperty } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);

// V1 a 100 Hz square, 10 V for its first 5 ms, through R1 (1 kΩ) into C1 (1 µF)
const m = new SimulationModel(readFileSync("tests/accuracy/rc.txt", "utf8"));
const part = (name) => m.circuit.elements.find((e) => m.designator(e) === name);
const before = m.serialize("xml").text;
const values = [1000, 2000, 4700];
const scope = m.paramSweep(part("R1"), values, String, (copy, v) => prepareProperty(copy, [String(v)])(), 0.004, [m.traceFor("V(C1)")]);
assert.equal(typeof scope, "object", String(scope));
const sw = scope.sweep;
assert.equal(sw.title, "R1 stepped");
assert.deepEqual(sw.runs, ["1000", "2000", "4700"]);
assert.equal(sw.x.length, 1001);
assert.deepEqual(sw.failed, []);
// each run its own time constant, at 1, 2 and 4 ms (the grid's points 250, 500, 1000)
values.forEach((r, k) => {
  for (const i of [250, 500, 1000]) {
    const t = sw.x[i], want = 10 * (1 - Math.exp(-t / (r * 1e-6))), got = Math.abs(sw.series[k][i]);
    assert.ok(Math.abs(got - want) < 0.01, `R1 = ${r}, t = ${t}: ${got} vs ${want}`);
  }
});
// the running circuit untouched (R1 still 1 kΩ), the result not saved with it
assert.equal(part("R1").resistance, 1000);
assert.equal(m.sim.t, 0);
assert.equal(m.serialize("xml").text, before);
// run again after an edit (Run and Reset do): C1 at 2 µF doubles each run's time constant
part("C1").capacitance = 2e-6;
assert.deepEqual(m.rerunSweeps(), []);
values.forEach((r, k) => {
  const t = scope.sweep.x[500], want = 10 * (1 - Math.exp(-t / (r * 2e-6)));
  assert.ok(Math.abs(Math.abs(scope.sweep.series[k][500]) - want) < 0.01, `rerun, R1 = ${r}`);
});
part("C1").capacitance = 1e-6;
// nothing to plot, or too many values: a reason
assert.equal(typeof m.paramSweep(part("R1"), values, String, () => {}, 0.004, []), "string");
assert.equal(typeof m.paramSweep(part("R1"), Array.from({ length: 60 }, (_, i) => i + 1), String, () => {}, 0.004, [m.traceFor("V(C1)")]), "string");
console.log("parameter sweep: 6 checks passed");
