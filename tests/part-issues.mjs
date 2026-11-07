// Model problems and ignored parameters (the schematic's warning badges): a misspelt parameter is
// reported, the ones the device reads aren't, and an unknown model is a problem.
import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: 'export { Circuit, Simulator, ignoredParams } from "./source/engine";', resolveDir: ".", loader: "ts" },
  bundle: true, platform: "node", format: "esm", write: false, logLevel: "error", keepNames: true,
});
const { Circuit, Simulator, ignoredParams } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);

const circuit = (card, model) => `<cir f="1" ts="1e-6" ic="10" cb="50" pb="50" vr="5" mts="5e-11">
  ${card ? `<nfmodel n="DX">${card}</nfmodel>` : ""}
  <v x="96 304 96 160" f="0" wf="1" fr="1000" maxv="5" bias="0" phaseShift="0" dutyCycle="0.5"/>
  <r x="96 160 224 160" f="0" r="1000"/>
  <d x="224 160 224 304" f="2" mo="default" nfm="${model}"/>
  <w x="224 304 96 304" f="0"/>
  <g x="96 304 96 336" f="0"/>
</cir>`;
function run(text) {
  const c = Circuit.parse(text);
  const sim = new Simulator();
  sim.accurate = true;
  sim.maxTimeStep = sim.timeStep = c.options.maxTimeStep;
  sim.useCircuitOptions(c.options);
  sim.setElements(c.simulatedElements);
  sim.resetTime();
  sim.update(() => true);
  return { diode: c.elements.find((e) => "spiceModel" in e), sim };
}

// BVV (meant BV) isn't read by the diode; IS, N, RS, CJO, TT, KF (noise, informational) aren't flagged
{
  const { diode } = run(circuit(".model DX D(IS=1n N=1.8 RS=0.1 CJO=10p TT=10n BVV=50 KF=1e-16)", "DX"));
  assert.deepEqual(ignoredParams(diode), ["BVV"]);
}
// Thermal parameters are recognized even when self-heating is off.
{
  const { diode } = run(circuit(".model DX D(IS=1n RTH0=50 CTH0=1m)", "DX"));
  assert.deepEqual(ignoredParams(diode), []);
}
// an unknown model: a problem, no device (and nothing reported as ignored)
{
  const { diode, sim } = run(circuit("", "NOPE"));
  assert.match(diode.spiceProblem, /NOPE isn't defined/);
  assert.deepEqual(ignoredParams(diode), []);
  assert.match(sim.stopMessage ?? "", /NOPE/);
}
console.log("part issues: 3 checks passed");
