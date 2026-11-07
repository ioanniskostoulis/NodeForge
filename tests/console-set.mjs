// The console's set: every property the inspector shows, by its name or symbol (tolerances,
// heatsink, Load, model, custom parameters included), and a placed MOSFET created as the class a
// file's MOSFET is (so it has them).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: 'export { SimulationModel } from "./source/app/model.ts"; export { prepareProperty, settableProperties, settableName } from "./source/app/console-edit.ts"; export { addPart } from "./source/app/document.ts"; export { classForName, SpiceMosfetElm, SpiceDiodeElm } from "./source/engine";', resolveDir: ".", loader: "ts" },
  bundle: true, platform: "node", format: "esm", write: false, logLevel: "error", keepNames: true,
  define: { "import.meta.url": JSON.stringify("http://localhost/app.js") },
});
const { SimulationModel, prepareProperty, settableProperties, settableName, addPart, classForName, SpiceMosfetElm, SpiceDiodeElm } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);

const m = new SimulationModel(readFileSync("tests/devices/selfheat-generic.xml", "utf8"));
const part = (name) => m.circuit.elements.find((e) => m.designator(e) === name);
const set = (name, ...words) => prepareProperty(part(name), words, m)();

// a resistor: its value by name, by symbol, and alone; its tolerance by name and by ΔR
set("R1", "Resistance", "2k");
assert.equal(part("R1").resistance, 2000);
set("R1", "R", "3.3k");
assert.equal(part("R1").resistance, 3300);
set("R1", "10");
assert.equal(part("R1").resistance, 10);
set("R1", "Tolerance", "5");
assert.equal(part("R1").tolerance.resistance, 5);
set("R1", "ΔR", "2%");
assert.equal(part("R1").tolerance.resistance, 2);

// a library power MOSFET: tolerances by name and symbol, heatsink, load
const q = part("Q1");
assert.ok(q instanceof SpiceMosfetElm);
set("Q1", "Beta tolerance", "10");
assert.equal(q.tolerance.gain, 10);
set("Q1", "Δβ", "12");
assert.equal(q.tolerance.gain, 12);
set("Q1", "beta tolerance", "13");
assert.equal(q.tolerance.gain, 13);
set("Q1", "ΔVt", "3");
assert.equal(q.tolerance.threshold, 3);
set("Q1", "Heatsink", "5");
assert.equal(q.heatsink, 5);
set("Q1", "Rth", "6");
assert.equal(q.heatsink, 6);
set("Q1", "Load", "on");
assert.equal(q.powerLoad, true);
// the model, then a custom model's parameter by its SPICE name and by its label
set("Q1", "Model", "custom");
assert.ok(m.isCustomModel(q));
set("Q1", "vto", "2.5");
assert.equal(m.modelCard(q).params.get("vto"), 2.5);
set("Q1", "Threshold", "2.7");
assert.equal(m.modelCard(q).params.get("vto"), 2.7);
// unknown: the list of names with their symbols
assert.throws(() => set("Q1", "nonsense", "1"), /Available: .*Beta tolerance \(Δβ\)/);
assert.ok(settableProperties(q, m).map(settableName).includes("Heatsink (Rth)"));

// a MOSFET and a diode placed on a new circuit: the SPICE classes, as from a file
const n = new SimulationModel("$ 1 0.000005 10 50 5 50 5e-11\n");
const placed = addPart(n, classForName("NMosfetElm"), 0, 0, 64, 0, "NMosfetElm");
assert.ok(placed instanceof SpiceMosfetElm, placed.constructor.name);
assert.equal(n.kindName(placed).includes("null"), false, n.kindName(placed));
assert.ok(addPart(n, classForName("DiodeElm"), 0, 64, 64, 64, "DiodeElm") instanceof SpiceDiodeElm);
console.log("console set: 6 checks passed");
