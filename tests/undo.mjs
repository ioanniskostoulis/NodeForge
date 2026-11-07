// Undo and redo: one step per change, restoring the circuit exactly; a change that changed nothing
// isn't a step; scope views are the view (as the schematic's zoom), so undo leaves them alone.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: 'export { CircuitDocument } from "./source/app/document.ts"; export { SwitchElm } from "./source/engine";', resolveDir: ".", loader: "ts" },
  bundle: true, platform: "node", format: "esm", write: false, logLevel: "error", keepNames: true,
  define: { "import.meta.url": JSON.stringify("http://localhost/app.js") },
});
const { CircuitDocument, SwitchElm } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);

const doc = new CircuitDocument(readFileSync("tests/accuracy/rc.txt", "utf8"), { name: "rc.txt" });
const m = doc.model;
const part = (name) => m.circuit.elements.find((e) => m.designator(e) === name);
const text = () => m.snapshot().text;

// a value set to what it was: no step
doc.edit(() => { part("R1").resistance = 1000; });
assert.equal(doc.canUndo, false, "an edit that changed nothing is not a step");

// an edit, undone and redone exactly
const t0 = text();
doc.edit(() => { part("R1").resistance = 2200; });
const t1 = text();
assert.notEqual(t1, t0);
doc.undo();
assert.equal(text(), t0);
assert.equal(part("R1").resistance, 1000);
doc.redo();
assert.equal(text(), t1);

// a scope added is a step; its view, zoomed afterwards, survives undoing a later edit
doc.edit(() => m.addScope(part("C1")));
const scope = m.scopes[0];
scope.view.liveSpan = 0.002;
scope.view.autoY = false;
scope.view.scales.set("V", { perDiv: 2, center: 0 });
const zoomed = scope.encodeView();
doc.edit(() => { part("R1").resistance = 4700; });
doc.undo();
assert.equal(part("R1").resistance, 2200);
assert.equal(m.scopes[0].encodeView(), zoomed, "the scope's view is left as it was");
doc.undo();
assert.equal(m.scopes.length, 0, "undoing the scope's addition removes it");
doc.redo();
assert.equal(m.scopes.length, 1);

// a switch flipped (as a click does): one step, undone
const sw = new CircuitDocument("$ 1 0.000005 10 50 5 50 5e-11\ns 64 64 128 64 0 0 false\nr 64 64 64 128 0 1000\n", { name: "sw.txt" });
const s1 = sw.model.circuit.elements.find((e) => e instanceof SwitchElm);
const p0 = s1.position;
sw.edit(() => sw.model.toggle(s1));
assert.notEqual(sw.model.circuit.elements.find((e) => e instanceof SwitchElm).position, p0);
sw.undo();
assert.equal(sw.model.circuit.elements.find((e) => e instanceof SwitchElm).position, p0);
// an .nfg circuit keeps what its file says about itself through undo and redo
const nfg = new CircuitDocument(m.serialize("nfg").text, { name: "rc.nfg" });
nfg.model.circuit.meta = { title: "RC", author: "someone" };
assert.equal(nfg.format, "nfg");
nfg.edit(() => { nfg.model.circuit.elements.find((e) => nfg.model.designator(e) === "R1").resistance = 3300; });
nfg.undo();
assert.deepEqual(nfg.model.circuit.meta, { title: "RC", author: "someone" }, "undo keeps the file's details");
nfg.redo();
assert.equal(nfg.model.circuit.format, "nfg");
console.log("undo: 6 checks passed");
