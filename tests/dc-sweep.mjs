// The DC sweep scope: the model sweeps a source on a copy of the circuit (the running one left as
// it is), gives each trace's values against the swept one, and leaves the result out of the file.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: 'export { SimulationModel } from "./source/app/model.ts";', resolveDir: ".", loader: "ts" },
  bundle: true, platform: "node", format: "esm", write: false, logLevel: "error", keepNames: true,
  define: { "import.meta.url": JSON.stringify("http://localhost/app.js") },
});
const { SimulationModel } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);

// the transistor switch test: V1 drives the base through 1 kΩ, R2 (100 Ω) loads the collector from 12 V
const m = new SimulationModel(readFileSync("tests/devices/bjt-switch.xml", "utf8"));
const part = (name) => m.circuit.elements.find((e) => m.designator(e) === name);
const before = m.serialize("xml").text;
const scope = m.dcSweep(part("V1"), 0, 5, 0.05, [m.traceFor("Ic(Q1)"), m.traceFor("V(R2)")]);
assert.equal(typeof scope, "object", String(scope));
const sw = scope.sweep;
assert.equal(sw.label, "V1");
assert.equal(sw.x.length, 101);
assert.deepEqual(sw.failed, []);
const [ic, vr2] = sw.series;
// off at 0 V; saturated at 5 V: R2 drops nearly all of the 12 V, Ic = V(R2) / 100 Ω (the sign of
// V(R2) is CircuitJS's, from its first post)
assert.ok(Math.abs(ic[0]) < 1e-6, `Ic at 0 V: ${ic[0]}`);
assert.ok(Math.abs(vr2[100]) > 11.5 && Math.abs(vr2[100]) < 12, `V(R2) at 5 V: ${vr2[100]}`);
for (let i = 0; i < 101; i++) assert.ok(Math.abs(Math.abs(vr2[i]) / 100 - ic[i]) <= 1e-6 + 1e-6 * ic[i], `Ic = V(R2)/R2 at ${sw.x[i]}`);
// Ic never falls as the base drive rises
for (let i = 1; i < 101; i++) assert.ok(ic[i] >= ic[i - 1] - 1e-9, `Ic monotonic at ${sw.x[i]}`);
// the running circuit is untouched, and the result isn't saved with it
assert.equal(m.sim.t, 0);
assert.equal(m.serialize("xml").text, before);
// run again (Run and Reset do): the same result, in the same scope
const again = m.scopes.length;
assert.deepEqual(m.rerunSweeps(), []);
assert.equal(m.scopes.length, again);
assert.deepEqual(scope.sweep.series[1], vr2);
// not a source, or no sweep: a reason
assert.equal(typeof m.dcSweep(part("R1"), 0, 5, 0.05, [m.traceFor("V(R2)")]), "string");
assert.equal(typeof m.dcSweep(part("V1"), 0, 5, 0, [m.traceFor("V(R2)")]), "string");
console.log("dc sweep: 6 checks passed");
