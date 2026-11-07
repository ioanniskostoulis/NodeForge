// Pure command-language regression checks. Run with node scripts/test-console.mjs.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";

const bundle = await build({ entryPoints: ["source/app/commands.ts"], bundle: true, write: false, format: "esm", platform: "node" });
const { CONSOLE_COMMANDS: commands, HELP_COMMANDS: helpCommands, MENU_COMMANDS: menuCommands, menuCommand, completeConsole: complete, plotToScope, availableWithoutCircuit } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
const parts = ["R1", "R2", "C1"];
assert.deepEqual(complete("info r", parts), ["info R1", "info R2"]);
assert.deepEqual(complete("scope add C", parts), ["scope add C1"]);
assert.deepEqual(complete("show current ", parts), ["show current on", "show current off", "show current dots", "show current arrows", "show current squares", "show current steady", "show current direction"]);
assert.ok(commands.find((c) => c.name === "show").args.test("jumps on"));
assert.deepEqual(complete("show jum", parts), ["show jumps"]);
assert.deepEqual(complete("solver ", parts), ["solver nodeforge", "solver circuitjs"]);
assert.deepEqual(complete("help ma", parts), ["help maxstep"]);
assert.deepEqual(complete("info R1 ", parts), []);
assert.deepEqual(complete("scope add C1 ", parts), ["scope add C1 V", "scope add C1 I", "scope add C1 P"]);
assert.deepEqual(complete("scope linked ", parts), ["scope linked on", "scope linked off"]);
assert.deepEqual(complete("slider R", parts), ["slider R1", "slider R2"]);
assert.deepEqual(complete("scope h", parts), ["scope help"]);
assert.deepEqual(complete("model Q1 IR", parts, ["IRFP260N"]), ["model Q1 IRFP260N"]);
assert.ok(complete("help plot ", parts).includes("help plot audio"));
assert.ok(complete("help scope ", parts).includes("help scope move"));
assert.ok(!complete("help scope ", parts).includes("help scope audio"), "scope is placement only");
assert.deepEqual(complete("analyze auto ", parts), ["analyze auto on", "analyze auto off"]);
assert.equal(new Set(commands.map((c) => c.name)).size, commands.length);
assert.equal(new Set(menuCommands.map((c) => c.id)).size, menuCommands.length);
for (const command of commands.filter((c) => c.menu)) {
  assert.equal(menuCommand(command.menu.id), command.menu);
  assert.equal(command.action, command.menu.id);
}
for (const redundant of ["light", "dark", "diag", "verify"]) assert.equal(commands.some((c) => c.name === redundant), false, `${redundant} is not a duplicate command`);
assert.deepEqual(helpCommands.map((c) => c.name), commands.filter((c) => !c.legacy).map((c) => c.name).sort((a, b) => a.localeCompare(b)));
for (const [name, invalid] of [["step", "Infinity"], ["step", "1.5"], ["show", "current garbage"], ["run", "extra"], ["speed", "1junk"], ["accuracy", "NaN%"], ["maxstep", "5V"], ["scope", "remove -1"], ["analyze", "auto maybe"]]) {
  assert.equal(commands.find((c) => c.name === name).args.test(invalid), false, `${name} rejects ${invalid}`);
}
for (const valid of ["", "apply", "auto", "auto on", "auto off"]) assert.ok(commands.find((c) => c.name === "analyze").args.test(valid));
for (const valid of ["", "help", "linked", "linked on", "linked off"]) assert.ok(commands.find((c) => c.name === "scope").args.test(valid));
assert.equal(commands.find((c) => c.name === "scope").args.test("linked maybe"), false);
for (const syntax of ["scope clear", "scope move <number> <side> <number>", "scope stack"]) {
  assert.ok(commands.find((c) => c.name === "scope").subcommands.some((c) => c.syntax === syntax));
}
for (const syntax of ["plot list", "plot trigger <number> level <value>", "plot trigger <number> trace <trace>", "plot audio <number> mode <mode>", "plot <expression> in <number>", "plot mode <number> <type>", "plot <part> [quantity]"]) {
  assert.ok(commands.find((c) => c.name === "plot").subcommands.some((c) => c.syntax === syntax), syntax);
}
// plot's forms for an existing scope run as the scope command's; the others make a graph
const isPart = (name) => ["R1", "M1"].includes(name);
assert.deepEqual(plotToScope(["trigger", "1", "rising"], isPart), ["scope", "trigger", "1", "rising"]);
assert.deepEqual(plotToScope(["mode", "1", "fft"], isPart), ["scope", "plot", "1", "fft"]);
assert.deepEqual(plotToScope(["V(R1)*I(R1)", "in", "2"], isPart), ["scope", "trace", "2", "V(R1)*I(R1)"]);
assert.deepEqual(plotToScope(["R1", "I"], isPart), ["scope", "add", "R1", "I"]);
assert.deepEqual(plotToScope(["M1"], isPart), ["scope", "add", "M1"]);
assert.equal(plotToScope(["V(R1)"], isPart), null);
assert.equal(plotToScope(["fft", "V(R1)"], isPart), null);
assert.equal(plotToScope(["Id(M1)", "vs", "Vds(M1)"], isPart), null);
assert.equal(plotToScope(["scale(R1)"], isPart), null);
assert.ok(commands.find((c) => c.name === "scope").args.test("move 2 right 1"));
assert.equal(commands.find((c) => c.name === "scope").args.test("move 2 diagonal 1"), false);
assert.deepEqual(complete("scope move 1 ", parts), ["scope move 1 above", "scope move 1 below", "scope move 1 left", "scope move 1 right"]);
assert.deepEqual(complete("plot trigger 1 trace ", parts, [], { scopeTraces: [2] }), ["plot trigger 1 trace 1", "plot trigger 1 trace 2"]);
assert.deepEqual(complete("plot mode 1 ", parts), ["plot mode 1 time", "plot mode 1 fft", "plot mode 1 xy"]);
assert.deepEqual(complete("plot R1 ", parts), ["plot R1 V", "plot R1 I", "plot R1 P"]);
const scopeArgs = commands.find((c) => c.name === "scope").args;
for (const valid of ["list", "clear", "trigger 1", "trigger 1 level -20mA", "trigger 1 level midpoint", "trigger 1 trace 2", "audio 1", "audio 1 on", "audio 1 off", "audio 1 mode waveform", "audio 1 mode pitch", "audio 1 mode realtime", "audio 1 trace 2", "help audio"]) assert.ok(scopeArgs.test(valid), valid);
for (const invalid of ["audio 1 maybe", "audio 1 mode signal", "trigger 1 trace -1", "audio 1 on extra", "trigger 1 rising extra"]) assert.equal(scopeArgs.test(invalid), false, invalid);
for (const name of ["solver", "speed", "maxstep", "zoom", "reltol"]) assert.ok(commands.find((c) => c.name === name).args.test(""));
assert.deepEqual(complete("delete R", parts), ["delete R1", "delete R2"]);
assert.deepEqual(complete("scope audio 1 mode ", parts), ["scope audio 1 mode waveform", "scope audio 1 mode pitch", "scope audio 1 mode realtime"]);
assert.deepEqual(complete("scope trigger 1 trace ", parts, [], { scopeTraces: [2] }), ["scope trigger 1 trace 1", "scope trigger 1 trace 2"]);
assert.deepEqual(complete("tab ", parts, [], { tabs: 2 }), ["tab 1", "tab 2"]);
assert.ok(commands.find((c) => c.name === "theme").args.test("pride"));
assert.deepEqual(complete("theme ", parts), ["theme dark", "theme light"]);
assert.deepEqual(complete("symbols ", parts), ["symbols ansi", "symbols iec"]);
const empty = { noCircuit: true, tabs: 0 };
assert.ok(availableWithoutCircuit("open") && availableWithoutCircuit("models") && availableWithoutCircuit("scope", "linked on"));
assert.ok(availableWithoutCircuit("analyze", "auto") && availableWithoutCircuit("temp", "unit F"));
assert.ok(!availableWithoutCircuit("run") && !availableWithoutCircuit("analyze") && !availableWithoutCircuit("panel", "scopes"));
assert.deepEqual(complete("r", [], [], empty), ["recent", "reltol"]);
assert.deepEqual(complete("help r", [], [], empty), ["help recent", "help reltol"]);
assert.deepEqual(complete("scope ", [], [], empty), ["scope linked"]);
assert.deepEqual(complete("analyze auto ", [], [], empty), ["analyze auto on", "analyze auto off"]);
assert.deepEqual(complete("panel ", [], [], empty), ["panel on", "panel off", "panel terminal"]);
assert.deepEqual(complete("run ", [], [], empty), []);
assert.ok(commands.find((c) => c.name === "symbols").args.test("us"));
assert.ok(commands.find((c) => c.name === "symbols").args.test("eu"));
const settingsBundle = await build({ entryPoints: ["source/app/settings.ts"], bundle: true, write: false, format: "esm", platform: "node" });
const { restoreSettings } = await import("data:text/javascript;base64," + Buffer.from(settingsBundle.outputFiles[0].text).toString("base64"));
assert.equal(restoreSettings({ symbolStyle: "eu" }).symbolStyle, "iec");
assert.equal(restoreSettings({ symbolStyle: "iec" }).symbolStyle, "iec");
const helpBundle = await build({ entryPoints: ["source/app/command-help.ts"], bundle: true, write: false, format: "esm", platform: "node" });
const { commandHelp, generalHelp } = await import("data:text/javascript;base64," + Buffer.from(helpBundle.outputFiles[0].text).toString("base64"));
for (const command of commands) {
  const help = JSON.stringify(commandHelp(command.name));
  assert.ok(!help.includes("|"), `${command.name} help has no pipe separators`);
}
assert.ok(!JSON.stringify(commandHelp("theme")).includes("pride"), "theme help lists only the documented appearances");
const welcomeHelp = generalHelp(true);
const welcomeLabels = welcomeHelp.groups.flatMap((g) => g.items.map((i) => i.label));
assert.ok(welcomeLabels.includes("open") && welcomeLabels.includes("analyze") && welcomeLabels.includes("scope"));
assert.ok(welcomeLabels.every((label) => !/[<>\[\]|]/.test(label)), "welcome help lists command names only");
assert.ok(!welcomeLabels.includes("run") && !welcomeLabels.includes("save") && !welcomeLabels.includes("status"));
assert.match(JSON.stringify(commandHelp("scope", true)), /scope linked/);
assert.deepEqual(commandHelp("run", true).lines, ["Open a circuit first."]);
// help lists every command once, in its group (none left for Other)
{
  const groups = generalHelp().groups;
  assert.deepEqual(groups.map((g) => g.title), ["File", "Edit", "View", "Scopes", "Simulation", "Help", "Analysis", "Console"]);
  const names = groups.flatMap((g) => g.items.map((i) => i.label));
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes("set") && names.includes("ac") && names.includes("help"));
}
assert.match(JSON.stringify(commandHelp("plot audio")), /plot audio <number> mode <mode>/);
assert.match(JSON.stringify(commandHelp("plot trigger")), /midpoint/);
assert.match(JSON.stringify(commandHelp("scope move")), /dragging a scope/);
assert.match(JSON.stringify(commandHelp("accuracy")), /Legacy command/);
assert.equal(menuCommand("toggle.linkedReadout").label, "Linked scope readout");
for (const command of commands) {
  assert.ok(command.syntax.startsWith(command.name));
  if (command.example) assert.ok(command.args.test(command.example.split(" ").slice(1).join(" ")), command.example);
}
// the shell's shared commands, with NodeForge's further forms of open, save, close and zoom
for (const name of ["new", "open", "recent", "save", "close", "autosave", "undo", "redo", "fit", "zoom", "font", "about", "version", "changes", "shortcuts", "licenses", "updates"]) assert.ok(commands.some((c) => c.name === name), name);
for (const valid of ["in", "out", "fit", "actual", "150%", ""]) assert.ok(commands.find((c) => c.name === "zoom").args.test(valid), `zoom ${valid}`);
assert.ok(availableWithoutCircuit("version") && availableWithoutCircuit("font") && !availableWithoutCircuit("fit"));
console.log("Console catalogue, validation and completion checks passed.");

// The static menus and their accelerators must resolve from the same registry as terminal actions.
Object.defineProperty(globalThis, "navigator", { value: { platform: "MacIntel" }, configurable: true });
const menuBundle = await build({ entryPoints: ["source/app/menus.ts"], bundle: true, write: false, format: "esm", platform: "node" });
const { buildMenus, collectShortcuts } = await import("data:text/javascript;base64," + Buffer.from(menuBundle.outputFiles[0].text).toString("base64"));
const state = { canUndo: true, canRedo: false, hasSelection: true, tool: null, hasDocument: true, recent: [] };
const visit = (nodes) => nodes.flatMap((node) => [node, ...visit(node.submenu ?? [])]);
for (const desktop of [false, true]) {
  const nodes = visit(buildMenus([], { root: [] }, desktop, state));
  // the About menu title acts at once, so it is shorter than its command's label
  // (File › Open recent and Autosave are built by the shell, with its own labels)
  for (const node of nodes.filter((n) => n.id && !(n.id === "about" && n.label === "About") && !/^file\.(recent|autosave)\./.test(n.id))) {
    assert.equal(node.label, menuCommand(node.id).label);
    assert.equal(node.key, menuCommand(node.id).key);
  }
  assert.deepEqual(collectShortcuts(buildMenus([], { root: [] }, desktop, state)).find((s) => s.id === "sim.reset"), { id: "sim.reset", key: "CmdOrCtrl+R" });
}
console.log("Browser and desktop menus resolve labels and shortcuts from the shared registry.");

const formatBundle = await build({ entryPoints: ["source/app/console-format.ts"], bundle: true, write: false, format: "esm", platform: "node" });
const { numberedTable, formatPartInfo, formatVerification } = await import("data:text/javascript;base64," + Buffer.from(formatBundle.outputFiles[0].text).toString("base64"));
assert.deepEqual(numberedTable(["Part", "Type"], [["R1", "resistor"]]).rows, [["   [1]   ", "R1", "resistor"]]);
assert.deepEqual(formatPartInfo(["R1  resistor", "I = 1 mA", "Vd = 2 V"]).tables[0].rows, [["I", "1 mA"], ["Vd", "2 V"]]);
assert.deepEqual(formatPartInfo(["Q1  MOSFET", "Vt = 1.5 V, β = 0.02"]).tables[0].rows, [["Vt", "1.5 V"], ["β", "0.02"]]);
const checked = formatVerification("circuit.xml: worst shape error 0.001%\n  node        raw max      shape        rms      swing   raw %   shape %\n  1          0.012      0.001      0.002      5.00     0.200     0.020");
assert.deepEqual(checked.tables[0].rows, [["1", "0.012", "0.001", "0.002", "5.00", "0.200", "0.020"]]);
assert.deepEqual(formatVerification("circuit.xml: skipped (unsupported part)").lines, ["circuit.xml: skipped (unsupported part)"]);
console.log("Tabular console reports preserve columns and diagnostics.");

const modelBundle = await build({ stdin: { contents: 'export * from "./source/app/model"; export * from "./source/app/console-edit"; export * from "./source/app/sliders"; export * from "./source/app/wire-readout"; export * from "./source/app/geom"; export * from "./source/app/console-scope"; export * from "./source/app/document"; export * from "./source/app/console-run"; export * from "./source/app/console-switch"; export * from "./source/app/recording";', resolveDir: process.cwd() }, bundle: true, write: false, format: "esm", platform: "node" });
const { SimulationModel, prepareProperty, prepareTolerance, tokenizeConsole, partNamed, partsForList, inductorCurves, sliderFieldNamed, sliderNumbers, configureSlider, sliderFor, removeSlider, wireReadout, numberedItem, prepareTrigger, triggerRows, CircuitDocument, copySelection, pasteText, rotateSelection, deleteSelection, runFor, prepareSwitch, switchState, scopeQuantity, preparePlot, scopeCSV, Recording } = await import("data:text/javascript;base64," + Buffer.from(modelBundle.outputFiles[0].text).toString("base64"));
const model = new SimulationModel(await readFile("public/circuits/capmultcaps.txt", "utf8"));
const before = model.snapshot();
const speed = model.speedRatio;
const step = model.sim.maxTimeStep;
model.setTimeStep(50e-9);
assert.ok(Math.abs(model.speedRatio - speed) < 1e-12);
model.restore(before);
assert.equal(model.sim.maxTimeStep, step);
assert.ok(Math.abs(model.speedRatio - speed) < 1e-12, "undo restores speed along with time step");
model.speedRatio = 0.02;
const changed = model.snapshot();
model.restore(before);
model.restore(changed);
assert.ok(Math.abs(model.speedRatio - 0.02) < 1e-12, "redo restores speed");
console.log("Circuit-setting snapshot/restore checks passed.");
assert.deepEqual(tokenizeConsole('set V1 waveform "AC"'), ["set", "V1", "waveform", "AC"]);
assert.deepEqual(tokenizeConsole('save as "test circuit.xml"'), ["save", "as", "test circuit.xml"]);
assert.throws(() => tokenizeConsole('set V1 "oops'), /Unclosed/);
const resistor = partNamed(model, "R1");
const sliderField = sliderFieldNamed(resistor, "Resistance");
assert.deepEqual(sliderNumbers(sliderField, ["1k", "10k", "4.7k", "100"]), [1000, 10000, 4700, 100]);
assert.throws(() => sliderNumbers(sliderField, ["10k", "1k", "4.7k", "100"]));
const sliderBefore = model.snapshot();
configureSlider(model, resistor, sliderField, 1000, 10000, 4700, 100);
assert.equal(sliderFor(model, resistor, sliderField.index)?.adj.step, 100);
assert.equal(resistor.resistance, 4700);
const sliderSaved = model.serialize("xml").text;
assert.match(sliderSaved, /<adj\b/);
const sliderReloaded = new SimulationModel(sliderSaved);
assert.equal(sliderReloaded.sliders.length, 1);
assert.equal(sliderReloaded.sliders[0].adj.step, 100);
const sliderText = model.serialize("txt").text;
assert.match(sliderText, /^38 /m);
assert.equal(new SimulationModel(sliderText).sliders[0].adj.step, 100);
removeSlider(model, resistor, sliderField);
assert.equal(model.sliders.length, 0);
model.restore(sliderBefore);
assert.equal(model.sliders.length, 0);
console.log("Slider configuration, persistence, removal and undo checks passed.");
const resistor2 = partNamed(model, "R1");
prepareProperty(resistor2, ["4.7k"])();
assert.equal(resistor2.resistance, 4700);
assert.throws(() => prepareProperty(resistor2, ["Infinity"]));
assert.throws(() => prepareProperty(resistor2, ["-4"])());
prepareProperty(resistor2, ["4.7k"])();
prepareTolerance(resistor2, "2%")();
assert.equal(resistor2.tolerance.resistance, 2);
assert.throws(() => prepareTolerance(resistor2, "101%"));
model.addScope(resistor2);
model.scopes[0].view.trigger.edge = 1;
const triggered = model.snapshot();
model.scopes[0].view.trigger.edge = -1;
model.restore(triggered);
assert.equal(model.scopes[0].view.trigger.edge, 1);
model.scopes[0].view.trigger.trace = 1;
model.scopes[0].view.trigger.level = 0.125;
const savedTrigger = model.serialize("text");
assert.equal(savedTrigger.format, "xml", "a trigger needs NodeForge XML metadata");
assert.match(savedTrigger.text, /nftr="1" nftt="1" nftl="0\.125"/);
const reopenedTrigger = new SimulationModel(savedTrigger.text);
assert.deepEqual(reopenedTrigger.scopes[0].view.trigger, { edge: 1, trace: 1, level: 0.125 });
reopenedTrigger.scopes[0].view.trigger.edge = 0;
assert.deepEqual(new SimulationModel(reopenedTrigger.serialize("xml").text).scopes[0].view.trigger,
  { edge: 0, trace: 1, level: 0.125 }, "turning triggering off keeps its trace and level for re-enabling");
assert.equal(new SimulationModel(savedTrigger.text.replace(' nftt="1"', ' nftt="999"')).scopes[0].view.trigger.edge, 0,
  "invalid trace references do not restore a trigger");
// Math traces and NodeForge measurements save as XML metadata and come back; a stale operand drops the trace.
{
  const m = new SimulationModel(savedTrigger.text);
  const sc = m.scopes[0];
  const [v, i] = sc.traces;
  m.addMathTrace(sc, "sub", v, i);
  m.addMathTrace(sc, "int", v, null);
  sc.measures.add("rise");
  sc.measures.add("cycles");
  const saved = m.serialize("text");
  assert.equal(saved.format, "xml", "math traces need NodeForge XML metadata");
  assert.match(saved.text, /nfmt="sub:0:1;int:0"/);
  assert.match(saved.text, /nfme="rise,cycles"/);
  const back = new SimulationModel(saved.text).scopes[0];
  assert.deepEqual(back.traces.map((t) => t.op ?? t.value), [0, 3, "sub", "int"]);
  assert.equal(back.traces[2].a, back.traces[0]);
  assert.deepEqual([...back.measures], ["rise", "cycles"]);
  assert.equal(new SimulationModel(saved.text.replace('nfmt="sub:0:1;int:0"', 'nfmt="sub:0:9"')).scopes[0].traces.length, 2,
    "a math trace naming a missing plot is dropped");
  // removing an operand removes the math traces built on it
  m.removeTrace(sc, v);
  assert.deepEqual(sc.traces.map((t) => t.op ?? t.value), [3]);
}
console.log("Math trace and measurement persistence checks passed.");
// Terminal plots: quantities and expressions resolve against parts, save by part number and come back.
{
  const m = new SimulationModel(savedTrigger.text);
  assert.throws(() => m.traceFor("Vgs(R1)"), /R1 has no Vgs; it offers V, I, P/);
  assert.throws(() => m.traceFor("V(R99)"), /R99: no such part/);
  assert.equal(m.traceFor("I(R1)").constructor.name, "ScopeTrace", "one quantity is an ordinary trace");
  const power = m.traceFor("V(R1)*I(R1)");
  assert.equal(power.unit, "W");
  const xy = m.addPlotScope([m.traceFor("I(R1)"), power], "xy");
  xy.view.liveSpan = 0.002;
  xy.view.fftX = { lo: 1, hi: 100 };
  m.addPlotScope([m.traceFor("V(R1)*2")], "time");
  const saved = m.serialize("text");
  assert.equal(saved.format, "xml");
  assert.match(saved.text, /nfx="1:V\(#\d+\)\*I\(#\d+\)"/);
  assert.match(saved.text, /nfxo="1"/, "a scope of expressions alone is marked");
  const back = new SimulationModel(saved.text);
  const [bxy, bonly] = back.scopes.slice(-2);
  assert.equal(bxy.traces.length, 2);
  assert.equal(bxy.traces[1].unit, "W");
  assert.ok(bxy.isXY && bxy.xyTraces[1] === bxy.traces[1], "Y is the expression, as plotted");
  assert.equal(bxy.view.liveSpan, 0.002, "the view saves with the circuit");
  assert.deepEqual(bxy.view.fftX, { lo: 1, hi: 100 });
  assert.equal(bonly.traces.length, 1, "the stand-in plot is dropped again");
  assert.equal(bonly.traces[0].constructor.name, "ExprTrace");
  assert.equal(back.scopes[0].encodeView(), undefined, "an automatic view adds nothing to the file");
}
console.log("Terminal plot and saved view checks passed.");
for (const length of [8, 32, 64]) {
  const curves = inductorCurves(length);
  assert.equal(curves.length, 20, "the SVG-derived inductor retains every cubic segment");
  assert.equal(curves.at(-1)[2].x, length);
  assert.equal(curves.at(-1)[2].y, 0);
}
console.log("Property edits, tolerance, quoting, trigger undo/save/reopen and inductor geometry passed.");
const wired = new SimulationModel(await readFile("public/circuits/nmosfet.txt", "utf8"));
assert.equal(partsForList(wired).length, 1);
assert.ok(partsForList(wired).every((e) => wired.designator(e) && !["wire", "ground"].includes(wired.kindName(e))));
assert.deepEqual(partsForList(wired, "wire"), []);
assert.deepEqual(partsForList(wired, "ground"), []);
console.log("Part listings contain only named components, not wires or ground.");
const named = new SimulationModel("$ 1 0.000005 10 50 5 50\nr 0 0 64 0 0 1000\nr 0 64 64 64 0 1000\nr 0 128 64 128 0 1000\n");
const [r1, r2, r3] = named.circuit.elements;
assert.deepEqual([r1, r2, r3].map((e) => named.designator(e)), ["R1", "R2", "R3"]);
named.selection.add(r2);
deleteSelection(named);
named.circuitChanged();
assert.deepEqual([r1, r3].map((e) => named.designator(e)), ["R1", "R3"]);
const [r4, r5] = pasteText(named, "$ 1 0.000005 10 50 5 50\nr 0 192 64 192 0 1000\nr 0 256 64 256 0 1000\n", 0, 0);
named.circuitChanged();
assert.deepEqual([r1, r3, r4, r5].map((e) => named.designator(e)), ["R1", "R3", "R2", "R4"]);
console.log("A new part takes the lowest free designator; existing parts keep theirs.");
const wire = { flags: 3, busWidth: 1, volts: [-3.5], getCurrent: () => -0.002 };
assert.equal(wireReadout(wire), "2 mA -3.5 V");
wire.flags = 0;
assert.equal(wireReadout(wire), null);
const bus = { flags: 12, busWidth: 4, volts: [5, 0, 5, 5], getCurrent: () => 0 };
assert.equal(wireReadout(bus), "13 0xD");
bus.flags = 8;
assert.equal(wireReadout(bus), "0xD");
bus.busWidth = 1;
assert.equal(wireReadout(bus), null);
console.log("Wire current, voltage and bus readout flags produce the expected labels.");

// Trigger commands number visible traces, validate units and mutate only after validation.
const triggeredScope = model.scopes[0];
const oldTrigger = { ...triggeredScope.view.trigger };
for (const value of ["NaN", "Infinity", "1e999V", "2s", "garbage"]) {
  assert.throws(() => prepareTrigger(triggeredScope, "level", value));
  assert.deepEqual(triggeredScope.view.trigger, oldTrigger);
}
assert.throws(() => numberedItem([1, 2], "0", "Scope"));
assert.throws(() => numberedItem([1, 2], "9007199254740993", "Scope"));
assert.throws(() => numberedItem([1, 2], "3", "Scope"));
assert.equal(numberedItem([1, 2], "2", "Scope"), 2);
prepareTrigger(triggeredScope, "trace", "1")();
prepareTrigger(triggeredScope, "level", "-2.5mA")();
assert.equal(triggeredScope.view.trigger.level, -0.0025);
assert.throws(() => prepareTrigger(triggeredScope, "level", "2V"));
assert.match(triggerRows(triggeredScope)[2][1], /-2.5 mA/);
prepareTrigger(triggeredScope, "level", "midpoint")();
assert.equal(triggeredScope.view.trigger.level, null);
// Selection actions used by console commands retain the document undo/redo behavior.
const editDoc = new CircuitDocument(await readFile("public/circuits/lrc.txt", "utf8"));
const initialCount = editDoc.model.circuit.elements.length;
editDoc.model.selection.add(partNamed(editDoc.model, "R1"));
const copy = copySelection(editDoc.model);
editDoc.edit(() => pasteText(editDoc.model, copy, 32, 32));
assert.equal(editDoc.model.circuit.elements.length, initialCount + 1);
editDoc.undo();
assert.equal(editDoc.model.circuit.elements.length, initialCount);
editDoc.redo();
assert.equal(editDoc.model.circuit.elements.length, initialCount + 1);
editDoc.model.selection.clear();
editDoc.model.selection.add(partNamed(editDoc.model, "R1"));
const original = editDoc.model.snapshot();
editDoc.edit(() => rotateSelection(editDoc.model, true, 16));
assert.notEqual(editDoc.model.snapshot().text, original.text);
editDoc.undo();
assert.equal(editDoc.model.snapshot().text, original.text);
editDoc.model.selection.add(partNamed(editDoc.model, "R1"));
editDoc.edit(() => deleteSelection(editDoc.model));
assert.equal(editDoc.model.circuit.elements.length, initialCount);
editDoc.undo();
assert.equal(editDoc.model.circuit.elements.length, initialCount + 1);
console.log("Trigger command validation and component edit undo/redo checks passed.");

const timed = new SimulationModel(await readFile("public/circuits/lrc.txt", "utf8"));
const duration = 1e-4;
const elapsed = await runFor(timed, duration);
assert.ok(elapsed >= duration && elapsed < duration + timed.sim.maxTimeStep * 1.01);
assert.equal(timed.running, false);
assert.ok(timed.scopes[0].recording);
const csv = await scopeCSV(timed.scopes[0], ["L1 voltage", "L1 current"]);
assert.match(csv, /^"Time start \(s\)","Time end \(s\)","L1 voltage minimum \(V\)"/);
assert.ok(csv.split("\r\n").length > 2);
assert.equal(csv.split("\r\n")[1].split(",").length, 6);
const abortRun = new AbortController(); abortRun.abort();
const priorTime = timed.sim.t;
await assert.rejects(runFor(timed, 1, abortRun.signal), /cancelled/);
assert.equal(timed.sim.t, priorTime);
await assert.rejects(runFor(timed, Infinity));
await assert.rejects(runFor(timed, 1, undefined, () => false), /changed/);
await assert.rejects(scopeCSV(timed.scopes[0], ["V", "I"], abortRun.signal), /cancelled/);
const sw = partNamed(timed, "SW1");
prepareSwitch(timed, sw, "on")(); assert.equal(switchState(sw), "Closed");
prepareSwitch(timed, sw, "off")(); assert.equal(switchState(sw), "Open");
prepareSwitch(timed, sw)(); assert.equal(switchState(sw), "Closed");
assert.throws(() => prepareSwitch(timed, partNamed(timed, "R1"), "on"));
assert.throws(() => prepareSwitch(timed, sw, "3"));
assert.equal(scopeQuantity("20mA", "A", true), 0.02);
assert.throws(() => scopeQuantity("20V", "A", true));
assert.throws(() => scopeQuantity("-2V", "V", true));
preparePlot(timed.scopes[0], "fft")();
assert.equal(timed.scopes[0].isXY, false);
preparePlot(timed.scopes[0], "xy")();
assert.equal(timed.scopes[0].isXY, true);
preparePlot(timed.scopes[0], "time")();
assert.equal(timed.scopes[0].isXY, false);
for (const valid of ["span 1 10ms", "scale 1", "scale 1 auto", "scale 1 V 2V -5V", "plot 1 fft", "measure 1 rms on", "export 1 csv"]) assert.ok(scopeArgs.test(valid), valid);
for (const invalid of ["plot 1 bad", "measure 1 rms maybe", "export 1 xml", "scale 1 s 2s"]) assert.equal(scopeArgs.test(invalid), false, invalid);
console.log("Timed runs, cancellation, scope CSV, plot validation and switch controls passed.");
