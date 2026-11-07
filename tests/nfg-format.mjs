// The .nfg format: a circuit saved as .nfg and read back is the same circuit (its XML form is
// byte-identical, so scopes, sliders, models, tolerances and settings all came back), a second save
// is the same text, and what a file says about itself and keys this build doesn't know survive.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: 'export { Circuit, Simulator, toSpice, writeNfg, writeXml, isLossless, chooseFormat } from "./source/engine"; export { simTemperature } from "./source/engine/nodeforge/devices/device";', resolveDir: ".", loader: "ts" },
  bundle: true, platform: "node", format: "esm", write: false, logLevel: "error", keepNames: true,
});
const { Circuit, Simulator, simTemperature, toSpice, writeNfg, writeXml, isLossless, chooseFormat } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);

// New and legacy circuits without a temperature use 25 °C; an explicit setting survives.
const plain = Circuit.parse("$ 1 0.000005 10 50 5 50\nr 64 64 64 128 0 1000\n");
assert.equal(new Simulator().temperature, 298.15);
assert.equal(simTemperature(undefined), 298.15);
assert.equal(plain.options.temperature, 25);
assert.doesNotMatch(writeXml(plain), /nftemp=/);
assert.match(toSpice(plain).text, /^\.temp 25$/m);
const warm = Circuit.parse(writeXml(plain).replace("<cir ", '<cir nftemp="27" '));
assert.equal(warm.options.temperature, 27);
assert.match(writeXml(warm), /nftemp="27"/);

// every sample circuit (library, accuracy and device checks): CircuitJS text and XML, with sliders,
// scopes, custom models, subcircuits and NodeForge's settings among them
let checked = 0;
for (const dir of ["public/circuits", "tests/accuracy", "tests/devices"]) {
  for (const f of readdirSync(dir).filter((n) => /\.(txt|xml)$/.test(n) && n !== "setuplist.txt")) {
    const a = Circuit.parse(readFileSync(`${dir}/${f}`, "utf8"));
    if (!isLossless(a, "nfg")) continue;
    const saved = writeNfg(a);
    const b = Circuit.parse(saved);
    assert.equal(b.format, "nfg", `${f}: read back as .nfg`);
    assert.equal(writeXml(b), writeXml(a), `${f}: the circuit is the same after .nfg`);
    assert.equal(writeNfg(b), saved, `${f}: a second save is the same text`);
    checked++;
  }
}
assert.ok(checked > 400, `${checked} circuits checked`);

// the file is JSON with a header, named settings and one part per line
const zvs = Circuit.parse(readFileSync("tests/accuracy/zvs-mazzilli.xml", "utf8"));
const text = writeNfg(zvs);
const doc = JSON.parse(text);
assert.equal(doc.format, "nodeforge");
assert.equal(doc.version, 1);
assert.equal(doc.engine.timeStep, zvs.options.maxTimeStep);
assert.equal(doc.parts.length, zvs.elements.length);
assert.ok(doc.parts.some((p) => p.type === "resistor" && typeof p.props.resistance === "number"), "readable types and properties");
assert.equal(doc.types.resistor, "r");
assert.ok(text.split("\n").length > doc.parts.length, "one part per line");

// what the file says about itself, and keys this build doesn't know, survive a save
doc.meta = { title: "ZVS", author: "someone" };
doc.future = { note: "from a newer build" };
doc.version = 99;
const c = Circuit.parse(JSON.stringify(doc));
assert.equal(c.meta.title, "ZVS");
assert.ok(c.warnings.some((w) => /newer NodeForge/.test(w)), "a newer file is noted");
const again = JSON.parse(writeNfg(c));
assert.deepEqual(again.meta, { title: "ZVS", author: "someone" });
assert.deepEqual(again.future, { note: "from a newer build" });
assert.equal(again.version, 1, "saved with this build's version");

// things that aren't circuit files are refused
assert.throws(() => Circuit.parse('{"format":"other"}'), /not a NodeForge circuit file/);
assert.throws(() => Circuit.parse("{ nope"), /not a NodeForge circuit file/);

// a part only the CircuitJS text format can keep: .nfg and XML refuse it (callers see the format they
// get back is "text" and don't name it .nfg), rather than dropping the part
const unported = Circuit.parse("$ 1 0.000005 10 50 5 50\nr 64 64 64 128 0 1000\n999 160 64 224 64 0 1 2\n");
assert.equal(isLossless(unported, "nfg"), false);
assert.equal(isLossless(unported, "xml"), false);
assert.equal(chooseFormat(unported, "nfg"), "text");

console.log(`nfg-format: ${checked} circuits round-tripped`);
