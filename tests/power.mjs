// The power report: averages, energy balance over whole cycles, MOSFET split, loads and efficiency.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: 'export { PowerMeter } from "./source/app/power.ts"; export { Circuit, Simulator, writeXml } from "./source/engine";', resolveDir: ".", loader: "ts" },
  bundle: true, platform: "node", format: "esm", write: false, logLevel: "error",
});
const { PowerMeter, Circuit, Simulator, writeXml } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);

/** Run a circuit for `seconds` with a power meter; returns the circuit and the report. */
function run(text, seconds, setup = () => {}) {
  const c = Circuit.parse(text);
  setup(c);
  const sim = new Simulator();
  sim.accurate = true;
  sim.maxTimeStep = sim.timeStep = c.options.maxTimeStep;
  sim.useCircuitOptions(c.options);
  sim.setElements(c.simulatedElements);
  const meter = new PowerMeter();
  sim.onTimeStep = () => meter.sample(sim, c.elements);
  sim.resetTime();
  while (sim.t < seconds && sim.stopMessage === null) sim.update(() => sim.t >= seconds);
  return { c, r: meter.report() };
}
const close = (a, b, rel, what) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${what}: ${a} vs ${b}`);

// 10 V across 10 Ω: 10 W in, 10 W in the resistor, marked as the load: 100%
{
  const text = "$ 1 0.000005 10 50 5 50\nv 100 200 100 100 0 0 40 10 0 0 0.5\nr 100 100 200 100 0 10\nw 200 100 200 200 0\nw 100 200 200 200 0\n";
  const { c, r } = run(text, 0.001, (c) => (c.elements.find((e) => e.constructor.name.includes("Resistor")).powerLoad = true));
  // the mark is saved (XML) and read back
  const again = Circuit.parse(writeXml(c));
  assert.deepEqual(again.elements.map((e) => e.powerLoad), c.elements.map((e) => e.powerLoad));
  assert.ok(again.elements.some((e) => e.powerLoad));
  assert.equal(r.marker, null);
  close(r.input, 10, 1e-9, "input");
  close(r.output, 10, 1e-9, "output");
  close(r.parts[0].power, 10, 1e-9, "resistor");
}

// the library's buck converter: whole cycles found, energy balanced, the MOSFET's loss split
{
  const { r } = run(readFileSync("public/circuits/conv-buck.txt", "utf8"), 0.02);
  assert.ok(r.marker?.constructor.name === "SpiceMosfetElm" && r.cycles >= 10, `cycles: ${r.cycles}`);
  const taken = r.parts.reduce((s, x) => s + x.power, 0);
  // what the sources deliver goes into the parts (those storing it included)
  close(taken, r.input, 1e-3, "balance");
  close(r.seconds * r.cycles ** -1, 1e-3, 1e-3, "period");
  for (const x of r.parts.filter((p) => p.switching !== undefined)) assert.ok(x.switching >= -1e-12 && x.switching <= Math.max(x.power, 0) + 1e-9, "switching part of the loss");
  assert.equal(r.output, null);
}
// the Mazzilli driver: every cycle counted, though its start-up overshoots twice the steady swing
// (the middle is the previous cycle's: its drain period is 11.14 µs, measured by crossings of 20 V)
{
  const { r } = run(readFileSync("tests/accuracy/zvs-mazzilli.xml", "utf8"), 0.001);
  assert.equal(r.cycles, 20);
  close(r.cycles / r.seconds, 1 / 11.14e-6, 0.02, "ZVS frequency");
}
console.log("power report: 4 checks passed");
