// LC resonances from part values (Recommend Settings' step limit), against closed forms.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: 'export { resonances } from "./source/app/resonance.ts"; export { Circuit } from "./source/engine";', resolveDir: ".", loader: "ts" },
  bundle: true, platform: "node", format: "esm", write: false, logLevel: "error",
});
const { resonances, Circuit } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);
const f = (text) => resonances(Circuit.parse(text));
const lc = (L, C) => 1 / (2 * Math.PI * Math.sqrt(L * C));
const close = (a, b, what) => assert.ok(Math.abs(a - b) <= 1e-6 * b, `${what}: ${a} vs ${b}`);

// series RLC driven by a source (resistor shorted for the mode): 1 mH, 1 µF
close(f(readFileSync("tests/accuracy/rlc.txt", "utf8"))[0], lc(1e-3, 1e-6), "series RLC");
// the Mazzilli driver: the tank (4.7 µH ∥ 680 nF) with the two 100 µH chokes in series across it
close(f(readFileSync("tests/accuracy/zvs-mazzilli.xml", "utf8"))[0], lc(1 / (1 / 4.7e-6 + 1 / 200e-6), 680e-9), "Mazzilli tank");
// two LC sections in a ladder: v1 –L– n1 –L– n2, C from each node to ground: ω² = (3 ± √5)/2 / LC
{
  const text = "$ 1 0.000001 10 50 5 50\nv 100 300 100 100 0 0 40 5 0 0 0.5\nl 100 100 200 100 0 0.001 0\nl 200 100 300 100 0 0.001 0\nc 200 100 200 300 0 0.000001 0\nc 300 100 300 300 0 0.000001 0\nw 100 300 200 300 0\nw 200 300 300 300 0\n";
  const got = f(text);
  assert.equal(got.length, 2);
  close(got[0], Math.sqrt((3 + Math.sqrt(5)) / 2) * lc(1e-3, 1e-6), "ladder, upper mode");
  close(got[1], Math.sqrt((3 - Math.sqrt(5)) / 2) * lc(1e-3, 1e-6), "ladder, lower mode");
}
// no inductors: nothing
assert.deepEqual(f(readFileSync("tests/accuracy/rc.txt", "utf8")), []);
console.log("resonances: 4 checks passed");
