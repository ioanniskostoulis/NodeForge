// NodeForge command registry: menu labels, shortcuts, terminal syntax, help and completion.
// Licensed under the GNU General Public License v2 or later. See LICENSE.
// Menu-only actions and terminal-only commands live here alongside actions shared by both.
import { MEASURES } from "./scope-measure";
import type { CommandSpec, MenuCommandSpec } from "forge-shell/app/command-spec";
import { sharedCommands, sharedHelpGroups, STANDARD_ACTIONS, type StandardAction } from "forge-shell/app/shared-commands";
import { standardItem } from "forge-shell/app/standard-items";
import { forgeApp } from "./profile";
export type { CommandSpec, MenuCommandSpec } from "forge-shell/app/command-spec";

/** The shell's standard actions NodeForge has; their menu items, keys and Terminal commands come from the shell. */
export const STANDARD: StandardAction[] = [
  "file.new", "file.newWindow", "file.open", "file.save", "file.saveAs", "file.close",
  "app.settings",
  "edit.undo", "edit.redo", "edit.cut", "edit.copy", "edit.paste", "edit.duplicate", "edit.delete", "edit.selectAll",
  "view.zoomIn", "view.zoomOut", "view.fit", "view.actualSize", "view.inspector", "view.bottomPanel", "tab.next", "tab.prev",
  "about", "about.whatsNew", "about.shortcuts", "about.licenses",
];
export const isStandardAction = (id: string): id is StandardAction => (STANDARD_ACTIONS as readonly string[]).includes(id) && STANDARD.includes(id as StandardAction);
/** The standard item's label and key, as the registry records them. */
const standardCommand = (action: StandardAction): MenuCommandSpec => {
  const { label, key, hint } = standardItem(action, { noun: forgeApp.document.noun, product: forgeApp.identity.name });
  return { id: action, label: label ?? action, ...(key ? { key } : {}), ...(hint ? { hint } : {}) };
};

/** Shortcuts kept by a convention of other applications (`CONVENTIONAL_SHORTCUTS`), outside the tiers. */
export const SHORTCUT_CONVENTIONS: Record<string, string> = { "sim.toggle": "run", "sim.reset": "reload" };

/** The shell's shared Terminal commands for these actions (`new`, `undo`, `zoom`, `settings`, `about`, `terminal`…). */
export const SHARED = sharedCommands(STANDARD, { autosave: true });
/** Shared commands NodeForge gives further forms: a library circuit or a path to open, a name to save as, a tab number
 * to close, and a magnification in percent. The shared forms are run by the shell. */
const EXTENDED: Record<string, Partial<CommandSpec>> = {
  open: { syntax: "open [file]", description: "Open a library circuit or choose a local file", args: /^.*$/ },
  save: { syntax: "save [action]", description: "Save a circuit (download in browser)", args: /^(as(?: .+)?)?$/ },
  close: { syntax: "close [number]", description: "Close a circuit tab", args: /^\d*$/ },
  zoom: { syntax: "zoom [choice]", description: "Zoom in or out, fit, show at actual size, or set a percentage", args: /^(?:in|out|fit|actual|\d+(?:\.\d+)?%)?$/, example: "zoom 150%" },
  panel: { syntax: "panel <action>", description: "Show, hide or switch the bottom panel", args: /^(on|off|terminal|scopes|messages)$/, choices: ["on", "off", "terminal", "scopes", "messages"] },
};
const SHARED_SPECS: CommandSpec[] = SHARED.map((entry) => ({ ...entry.spec, ...EXTENDED[entry.spec.name] }));
/** The shared commands that need no circuit. */
export const SHARED_WITHOUT_DOCUMENT = SHARED.filter((entry) => !entry.document).map((entry) => entry.spec.name);
export const SHARED_HELP_GROUPS = sharedHelpGroups(SHARED);

/** `scope`: where the scopes sit in the panel. */
export const SCOPE_SUBCOMMANDS = [
  { syntax: "scope stack", description: "Stack all scopes in one column" },
  { syntax: "scope unstack", description: "Give each scope its own column" },
  { syntax: "scope combine", description: "Combine all traces into one scope" },
  { syntax: "scope separate", description: "Separate traces into individual scopes" },
  { syntax: "scope move <number> <side> <number>", description: "Place a scope above, below, left or right of another" },
  { syntax: "scope clear", description: "Remove all scopes" },
  { syntax: "scope linked [state]", description: "Show or change linked scope readout" },
];

/** `plot`: make graphs, and change what one shows. The older `scope <verb>` forms still work. */
export const PLOT_SUBCOMMANDS = [
  { syntax: "plot <expression>", description: "Plot quantities or an expression of them over time in a new scope" },
  { syntax: "plot <expression> vs <expression>", description: "Plot Y against X in a new scope" },
  { syntax: "plot fft <expression>", description: "Plot a spectrum in a new scope" },
  { syntax: "plot <part> [quantity]", description: "Plot a part's quantity (V, I, P, Vgs, Ic…) or its default traces" },
  { syntax: "plot <expression> in <number>", description: "Add a quantity or expression to a scope" },
  { syntax: "plot mode <number> <type>", description: "Choose time, FFT or X-Y" },
  { syntax: "plot list", description: "List scopes, numbered traces and trigger settings" },
  { syntax: "plot remove <number>", description: "Remove one scope" },
  { syntax: "plot live [number]", description: "Return to live view; defaults to scope 1" },
  { syntax: "plot span <number> <time>", description: "Set the full time-window duration" },
  { syntax: "plot scale <number>", description: "Show vertical scale settings" },
  { syntax: "plot scale <number> auto", description: "Fit the vertical scale automatically" },
  { syntax: "plot scale <number> <unit> <per-division> [center]", description: "Set a manual vertical scale" },
  { syntax: "plot measure <number>", description: "List measurement visibility" },
  { syntax: "plot measure <number> <measurement> <state>", description: "Show or hide a measurement" },
  { syntax: "plot trigger <number>", description: "Show trigger settings" },
  { syntax: "plot trigger <number> <edge>", description: "Set the trigger edge" },
  { syntax: "plot trigger <number> level <value>", description: "Set the threshold; use midpoint for automatic level" },
  { syntax: "plot trigger <number> trace <trace>", description: "Select a numbered trace; resets the level to midpoint" },
  { syntax: "plot audio <number>", description: "Show audio settings" },
  { syntax: "plot audio <number> <state>", description: "Enable or disable audio" },
  { syntax: "plot audio <number> mode <mode>", description: "Choose waveform, pitch or realtime audio" },
  { syntax: "plot audio <number> trace <trace>", description: "Choose a numbered trace" },
  { syntax: "plot export <number> csv", description: "Export recorded trace envelopes" },
];

/** What follows `plot` when it changes an existing scope (the rest are made as expressions). */
const PLOT_VERBS = ["list", "remove", "live", "span", "scale", "measure", "trigger", "audio", "export"];

/**
 * `plot`'s forms that act on an existing scope, as the `scope` command's older words:
 * `plot trigger 1 rising` → `scope trigger 1 rising`, `plot mode 1 fft` → `scope plot 1 fft`,
 * `plot V(R1) in 2` → `scope trace 2 V(R1)`, `plot R1 I` → `scope add R1 I`. Null for a plot to create.
 */
export function plotToScope(words: string[], isPart: (name: string) => boolean): string[] | null {
  const [first, second] = words;
  if (!first) return null;
  const verb = first.toLowerCase();
  if (PLOT_VERBS.includes(verb) && !second?.startsWith("(")) return ["scope", verb, ...words.slice(1)];
  if (verb === "mode" && words.length >= 2) return ["scope", "plot", ...words.slice(1)];
  const text = words.join(" ");
  const into = text.match(/^(.+?)\s+in\s+(\d+)$/i);
  if (into) return ["scope", "trace", into[2], ...into[1].split(" ")];
  if (words.length <= 2 && /^\w+$/.test(first) && isPart(first) && (words.length === 1 || /^\w+$/.test(second))) return ["scope", "add", ...words];
  return null;
}

export const CONSOLE_COMMANDS: CommandSpec[] = [
  ...SHARED_SPECS,
  { name: "switch", syntax: "switch <part> [state]", description: "Toggle or set a switch", args: /^\w+(?: (?:on|off|status|\d+))?$/, example: "switch SW1 on" },
  { name: "status", syntax: "status", description: "Show simulation state and settings", args: /^$/ },
  { name: "reltol", syntax: "reltol [percent]", description: "Show or set the solver's relative tolerance", args: /^(?:\d*\.?\d+(?:e[-+]?\d+)?%)?$/i, choices: ["0.1%", "0.01%", "0.001%", "0.0001%"], example: "reltol 0.001%" },
  { name: "compare", syntax: "compare", description: "Compare the circuit with ngspice", args: /^$/ },
  { name: "delete", syntax: "delete <part>", description: "Delete a component", args: /^\w+$/, example: "delete R1" },
  { name: "duplicate", syntax: "duplicate <part>", description: "Duplicate a component", args: /^\w+$/, example: "duplicate R1" },
  { name: "rotate", syntax: "rotate <part>", description: "Rotate a component 90° clockwise", args: /^\w+$/, example: "rotate R1" },
  { name: "tabs", syntax: "tabs", description: "List circuit tabs", args: /^$/ },
  { name: "tab", syntax: "tab <number>", description: "Switch to a circuit tab", args: /^\d+$/, example: "tab 2" },
  { name: "run", syntax: "run [action]", description: "Resume simulation or run for a duration", args: /^(?:for \S+)?$/, choices: ["for"], example: "run for 10ms" },
  { name: "pause", syntax: "pause", description: "Pause simulation", args: /^$/ },
  { name: "step", syntax: "step [number]", description: "Advance 1–1000 steps while paused", args: /^(\d+)?$/, example: "step 10" },
  { name: "reset", syntax: "reset", description: "Reset the simulation", args: /^$/, action: "sim.reset", menu: { id: "sim.reset", label: "Reset", key: "CmdOrCtrl+R" } },
  { name: "op", syntax: "op", description: "Find the DC operating point", args: /^$/ },
  { name: "solver", syntax: "solver [engine]", description: "Show or choose the simulation engine", args: /^(nodeforge|circuitjs|accurate)?$/, choices: ["nodeforge", "circuitjs"] },
  { name: "accuracy", legacy: true, syntax: "accuracy [value]", description: "Set relative tolerance or compare with ngspice", args: /^(?:\d*\.?\d+(?:e[-+]?\d+)?%|check)?$/i, example: "accuracy 0.001%", choices: ["0.1%", "0.01%", "0.001%", "0.0001%", "check"] },
  { name: "selfheat", syntax: "selfheat [state]", description: "Toggle self-heating of devices with thermal models", args: /^(on|off)?$/, choices: ["on", "off"] },
  { name: "ramp", syntax: "ramp [time]", description: "Show or set the start-up ramp of the sources", args: /^(?:off|\d*\.?\d+(?:e[-+]?\d+)?\s*(?:[munpµμ]?s)?)?$/i, choices: ["off"], example: "ramp 1ms" },
  { name: "temp", syntax: "temp [value]", description: "Show or set the circuit's temperature, or the unit it is shown in", args: /^(?:[-+]?\d*\.?\d+(?:e[-+]?\d+)?\s*(?:°?\s*[CFK])?|unit\s+(?:°?[CFK]|celsius|fahrenheit|kelvin))?$/i, example: "temp 85" },
  { name: "maxstep", syntax: "maxstep [time]", description: "Show or set maximum time step", args: /^(?:\d*\.?\d+(?:e[-+]?\d+)?(?:[TGMkKmuµμnpf]?s?))?$/i, example: "maxstep 50ns" },
  { name: "speed", syntax: "speed [multiple]", description: "Show or set simulation speed", args: /^(?:\d*\.?\d+(?:e[-+]?\d+)?[x×]?)?$/i, example: "speed 0.01x" },
  { name: "analyze", syntax: "analyze [action]", description: "Report settings or control idle analysis", args: /^(?:apply|auto(?: (?:on|off))?)?$/, choices: ["apply", "auto"] },
  { name: "tolerance", syntax: "tolerance [state]", description: "Toggle variation or set a part's tolerance", args: /^(on|off|\w+ \d*\.?\d+%)?$/, choices: ["on", "off"] },
  { name: "seed", syntax: "seed [value]", description: "Read or change the tolerance seed", args: /^(\d+|new)?$/, choices: ["new"] },
  { name: "list", syntax: "list [type]", description: "List named parts, optionally by type", args: /^[\w -]*$/, example: "list resistor" },
  { name: "info", syntax: "info <part>", description: "Read a part's values", args: /^\w+$/, example: "info R1" },
  { name: "dcsweep", syntax: "dcsweep <source> <start> <stop> <step> <quantity>…", description: "Sweep a source's DC value and plot the results", args: /^\w+ \S+ \S+ \S+( \S+)+$/, example: "dcsweep V1 0 10 0.1 V(R1) Ic(Q1)" },
  { name: "ac", syntax: "ac <source> <fstart> <fstop> [points per decade] <quantity>…", description: "Sweep a source's AC frequency and plot a Bode plot", args: /^\w+ \S+ \S+( \S+)+$/, example: "ac V1 10 1Meg V(R2)" },
  { name: "stepsweep", syntax: "stepsweep <part> [property] <values> for <time> <quantity>…", description: "Run once per value of a part's property and overlay the results", args: /^\w+ .+ for \S+( \S+)+$/, example: "stepsweep R1 1k,4.7k,10k for 2ms V(C1)" },
  { name: "power", syntax: "power [action]", description: "Report average power, losses and efficiency", args: /^(?:reset|load \w+(?: (?:on|off))?)?$/i, choices: ["reset", "load"], example: "power load R1 on" },
  { name: "select", syntax: "select <part>", description: "Select a part on the sheet", args: /^\w+$/, example: "select R1" },
  { name: "scope", syntax: "scope <action>", description: "Place scopes: stack, combine, move", args: /^(?:add \w+(?: \w+)?|trace \d+ .+|remove \d+|live(?: \d+)?|span \d+ \S+|scale \d+(?: (?:auto|[VAWC] \S+(?: \S+)?))?|plot \d+ (?:time|fft|xy)|measure \d+(?: (?:peak|minimum|p2p|average|rms|overshoot|frequency|period|duty|width|rise|fall|phase|energy|cycleenergy|efficiency) (?:on|off))?|export \d+ csv|list|clear|stack|unstack|combine|separate|trigger \d+(?: (?:rising|falling|off|level \S+|trace \d+))?|audio \d+(?: (?:on|off|mode (?:waveform|pitch|realtime)|trace \d+))?|linked(?: (?:on|off))?|move \d+ (?:above|below|left|right) \d+|help(?: \w+)?)?$/, example: "scope stack", choices: ["stack", "unstack", "combine", "separate", "move", "clear", "linked", "help"], subcommands: SCOPE_SUBCOMMANDS },
  { name: "plot", syntax: "plot <what>", description: "Create graphs and change what they show", args: /^.+$/, example: "plot V(D1) vs I(D1)", choices: ["fft", "mode", ...PLOT_VERBS], subcommands: PLOT_SUBCOMMANDS },
  { name: "show", syntax: "show [setting] [state]", description: "Configure schematic displays and current markers", args: /^(?:(?:current(?: (?:on|off|dots?|arrows?|squares?|steady(?: (?:on|off))?|direction (?:on|off)))?|(?:voltage|values|readout|jumps)(?: (?:on|off))?))?$/, choices: ["current", "voltage", "values", "readout", "jumps"], example: "show current steady on" },
  { name: "symbols", syntax: "symbols <style>", description: "Choose ANSI or IEC schematic symbols", args: /^(ansi|us|iec|eu)$/i, choices: ["ansi", "iec"] },
  { name: "electron", syntax: "electron [state]", description: "Toggle electron-flow direction", args: /^(on|off)?$/, choices: ["on", "off"] },
  { name: "wheel", syntax: "wheel <mode>", description: "Choose scroll-wheel behavior", args: /^(zoom|auto)$/, choices: ["zoom", "auto"] },
  { name: "health", syntax: "health [reminder] [hours]", description: "Show or set the daily break reminder", args: /^(?:reminder(?: (?:off|[2-6]))?)?$/, example: "health reminder 3", choices: ["reminder"] },
  { name: "set", syntax: "set <part> [property] <value>", description: "Edit a part using inspector property names", args: /^\w+( .+)?$/, example: "set R1 4.7k" },
  { name: "slider", syntax: "slider [action]", description: "List, configure or remove adjustable part sliders", args: /^.*$/, example: "slider R1 Resistance 1k 10k 4.7k 100", choices: ["remove", "help"], subcommands: [
    { syntax: "slider", description: "List configured sliders" },
    { syntax: "slider <part> <property> <minimum> <maximum> <value> <step>", description: "Add or update a slider; 0 step is continuous" },
    { syntax: "slider remove <part> <property>", description: "Remove a slider" },
  ] },
  { name: "model", syntax: "model <part> <model>", description: "Assign a model or edit a custom parameter", args: /^\w+ .+$/, example: "model Q1 custom" },
  { name: "models", syntax: "models [kind] [search]", description: "Search, import or check library models", args: /^.*$/, choices: ["diode", "zener", "nmos", "pmos", "njf", "pjf", "npn", "pnp", "import", "check"] },
  { name: "export", syntax: "export <format>", description: "Export the active circuit", args: /^(nfg|xml|txt|spice)$/, choices: ["nfg", "xml", "txt", "spice"] },
  { name: "spice", syntax: "spice", description: "Print the active circuit's SPICE netlist", args: /^$/ },
  { name: "bench", syntax: "bench [steps]", description: "Benchmark a copy of the active circuit", args: /^(\d+)?$/, example: "bench 4000" },
  { name: "montecarlo", syntax: "montecarlo [runs]", description: "Measure tolerance spread on a circuit copy", args: /^(\d+)?$/, example: "montecarlo 20" },
];

// Native menus, HTML menus and shortcuts already dispatch these IDs through run().
// Parameter-free console commands use that same action route, not a second implementation.
const sharedActions: Record<string, string> = {
  run: "sim.start", pause: "sim.pause",
};
for (const command of CONSOLE_COMMANDS) command.action ??= sharedActions[command.name];

/** Actions not exposed as a direct one-word console command. Dynamic tool/circuit entries are generated separately. */
export const MENU_ONLY_COMMANDS: MenuCommandSpec[] = [
  // App tier (Cmd+] and Cmd+[ are the shell's Arrange keys): R for right, L for left
  { id: "edit.rotateCW", label: "Rotate clockwise", key: "CmdOrCtrl+Shift+R" },
  { id: "edit.rotateCCW", label: "Rotate counterclockwise", key: "CmdOrCtrl+Shift+L" },
  { id: "edit.flipH", label: "Flip horizontal" },
  { id: "edit.flipV", label: "Flip vertical" },
  { id: "edit.properties", label: "Properties" },
  { id: "appearance.light", label: "Light" },
  { id: "appearance.dark", label: "Dark" },
  { id: "tool.select", label: "Select", hint: "Escape" },
  { id: "scope.add", label: "View selected part in scope" },
  { id: "scopes.stack", label: "Stack all" },
  { id: "scopes.unstack", label: "Unstack all" },
  { id: "scopes.combine", label: "Combine all" },
  { id: "scopes.separate", label: "Separate all" },
  { id: "scopes.clear", label: "Remove all scopes" },
  { id: "toggle.showCurrent", label: "Show current" },
  { id: "toggle.showVoltage", label: "Show voltage" },
  { id: "toggle.showValues", label: "Show values" },
  { id: "toggle.showReadout", label: "Show readout under pointer" },
  { id: "toggle.showWireJumps", label: "Show wire jumps" },
  { id: "toggle.linkedReadout", label: "Linked scope readout" },
  { id: "temperature.C", label: "Celsius (°C)" },
  { id: "temperature.F", label: "Fahrenheit (°F)" },
  { id: "temperature.K", label: "Kelvin (K)" },
  { id: "symbols.us", label: "ANSI symbols" },
  { id: "symbols.iec", label: "IEC symbols" },
  { id: "toggle.whiteBackground", label: "White background" },
  { id: "current.electron", label: "Electron flow" },
  { id: "current.shape.dots", label: "Dots" },
  { id: "current.shape.arrows", label: "Arrows" },
  { id: "current.shape.squares", label: "Squares" },
  { id: "current.steadyBand", label: "Steady band for fast current" },
  { id: "current.steadyArrows", label: "Steady direction arrows" },
  { id: "toggle.wheelZooms", label: "Scroll wheel always zooms" },
  { id: "sim.toggle", label: "Run / pause", key: "CmdOrCtrl+Enter" },
  // App tier: Cmd+Right moves to the end of a line in every text field
  { id: "sim.step", label: "Step", key: "CmdOrCtrl+Shift+T" },
  { id: "sim.operatingPoint", label: "Find DC operating point" },
  { id: "solver.nodeforge", label: "NodeForge solver" },
  { id: "solver.circuitjs", label: "CircuitJS solver" },
  { id: "sim.power", label: "Power report" },
  { id: "file.exportNfg", label: "NodeForge circuit…" },
  { id: "file.exportXml", label: "CircuitJS XML…" },
  { id: "file.exportText", label: "CircuitJS text…" },
  { id: "file.exportSpice", label: "SPICE netlist…" },
  { id: "sim.recommend", label: "Recommend settings…" },
  { id: "toggle.backgroundAnalysis", label: "Analyze circuits in background" },
  { id: "models.library", label: "Model library…" },
];

export const MENU_COMMANDS: MenuCommandSpec[] = [
  ...STANDARD.map(standardCommand),
  ...CONSOLE_COMMANDS.flatMap((command) => command.menu ? [command.menu] : []),
  ...MENU_ONLY_COMMANDS,
];
const menuById = new Map(MENU_COMMANDS.map((command) => [command.id, command]));
export function menuCommand(id: string): MenuCommandSpec {
  const command = menuById.get(id);
  if (!command) throw new Error(`Unregistered menu command: ${id}`);
  return command;
}

// Keep the command catalogue in workflow order for maintainers, but present help alphabetically.
export const HELP_COMMANDS = CONSOLE_COMMANDS.filter((c) => !c.legacy).sort((a, b) => a.name.localeCompare(b.name));

/** Commands usable on the welcome screen. Some commands only have an app-setting form there. */
export const NO_CIRCUIT_COMMANDS = new Set([
  ...SHARED_WITHOUT_DOCUMENT.filter((name) => name !== "panel"),
  "electron", "models", "reltol", "show", "solver", "symbols", "tabs", "wheel", "health",
]);

export function availableWithoutCircuit(name: string, arg = ""): boolean {
  if (NO_CIRCUIT_COMMANDS.has(name)) return true;
  if (name === "analyze") return /^auto(?: (?:on|off))?$/.test(arg);
  if (name === "scope") return /^linked(?: (?:on|off))?$/.test(arg);
  if (name === "temp") return /^unit\s+(?:°?[CFK]|celsius|fahrenheit|kelvin)$/i.test(arg);
  if (name === "panel") return /^(on|off|terminal)$/.test(arg);
  return false;
}

/** Completions are complete input prefixes, so the command is never lost. */
export function completeConsole(line: string, parts: string[], models: string[] = [], context: { scopeTraces?: number[]; tabs?: number; noCircuit?: boolean } = {}): string[] {
  const words = line.trimStart().split(/\s+/);
  const partial = words.pop() ?? "";
  const welcome = context.noCircuit;
  const rootNames = welcome ? [...NO_CIRCUIT_COMMANDS, "analyze", "panel", "scope", "temp"].sort() : HELP_COMMANDS.map((c) => c.name);
  if (welcome && words.length && words[0] !== "help" && !rootNames.includes(words[0])) return [];
  if (welcome && words[0] === "help" && words.length > 1) return [];
  if (welcome && words.length) {
    const [name, action] = words;
    if (["analyze", "scope", "temp", "panel"].includes(name)) {
      const choices = name === "analyze" ? words.length === 1 ? ["auto"] : action === "auto" && words.length === 2 ? ["on", "off"] : []
        : name === "scope" ? words.length === 1 ? ["linked"] : action === "linked" && words.length === 2 ? ["on", "off"] : []
        : name === "temp" ? words.length === 1 ? ["unit"] : action === "unit" && words.length === 2 ? ["C", "F", "K", "celsius", "fahrenheit", "kelvin"] : []
        : words.length === 1 ? ["on", "off", "terminal"] : [];
      return choices.filter((c) => c.toLowerCase().startsWith(partial.toLowerCase())).map((c) => [...words, c].join(" "));
    }
  }
  // plot's verbs act on a scope: complete them as the scope command's, then say them as plot's
  if (words[0] === "plot" && words.length >= 2 && (PLOT_VERBS.includes(words[1]) || words[1] === "mode")) {
    const mode = words[1] === "mode";
    const alias = ["scope", ...(mode ? ["plot"] : [words[1]]), ...words.slice(2), partial].join(" ");
    return completeConsole(alias, parts, models, context)
      .map((c) => c.split(" ")).map((w) => ["plot", ...(mode ? ["mode"] : [w[1]]), ...w.slice(2)].join(" "));
  }
  let choices: string[] = [];
  if (!words.length || (words[0] === "help" && words.length === 1)) choices = rootNames;
  else if ((words.length === 1 && ["info", "select", "set", "model", "slider", "delete", "duplicate", "rotate", "switch"].includes(words[0])) || (words.length === 2 && words[0] === "scope" && words[1] === "add") || (words.length === 2 && words[0] === "slider" && words[1] === "remove")) choices = parts;
  else if (words[0] === "plot" && words.length === 1) choices = ["fft", "mode", ...PLOT_VERBS, ...parts];
  else if (words[0] === "plot" && words.length === 2 && parts.some((p) => p.toLowerCase() === words[1].toLowerCase())) choices = ["V", "I", "P"];
  else if (words[0] === "scope" && words[1] === "move" && words.length === 3) choices = ["above", "below", "left", "right"];
  else if (words[0] === "scope" && words[1] === "move" && (words.length === 2 || words.length === 4))
    choices = (context.scopeTraces ?? []).map((_, i) => String(i + 1));
  else if (words[0] === "model" && words.length === 2) choices = ["custom", ...models];
  else if (words[0] === "models" && words[1] === "check" && words.length === 2) choices = models;
  else if (words[0] === "scope" && words[1] === "add" && words.length === 3) choices = ["V", "I", "P"];
  else if (words[0] === "switch" && words.length === 2) choices = ["on", "off", "status"];
  else if (words[0] === "power" && words[1] === "load" && words.length === 2) choices = parts;
  else if ((words[0] === "dcsweep" || words[0] === "stepsweep" || words[0] === "ac") && words.length === 1) choices = parts;
  else if (words[0] === "power" && words[1] === "load" && words.length === 3) choices = ["on", "off"];
  else if (words[0] === "scope" && words[1] === "plot" && words.length === 3) choices = ["time", "fft", "xy"];
  else if (words[0] === "scope" && words[1] === "measure" && words.length === 3) choices = MEASURES.map((m) => m.key);
  else if (words[0] === "scope" && words[1] === "measure" && words.length === 4) choices = ["on", "off"];
  else if (words[0] === "scope" && words[1] === "export" && words.length === 3) choices = ["csv"];
  else if (words[0] === "scope" && words[1] === "scale" && words.length === 3) choices = ["auto", "V", "A", "W", "C"];
  else if (words[0] === "scope" && words[1] === "trigger" && words.length === 3) choices = ["rising", "falling", "off", "level", "trace"];
  else if (words[0] === "scope" && words[1] === "audio" && words.length === 3) choices = ["on", "off", "mode", "trace"];
  else if (words[0] === "scope" && words[1] === "audio" && words[3] === "mode" && words.length === 4) choices = ["waveform", "pitch", "realtime"];
  else if (words[0] === "scope" && words[1] === "trigger" && words[3] === "level" && words.length === 4) choices = ["midpoint"];
  else if (words[0] === "scope" && ["audio", "trigger"].includes(words[1]) && words[3] === "trace" && words.length === 4)
    choices = Array.from({ length: context.scopeTraces?.[Number(words[2]) - 1] ?? 0 }, (_, i) => String(i + 1));
  else if (words[0] === "scope" && ["remove", "live", "trigger", "audio", "span", "scale", "plot", "measure", "export", "trace"].includes(words[1]) && words.length === 2)
    choices = (context.scopeTraces ?? []).map((_, i) => String(i + 1));
  else if (["tab", "close"].includes(words[0]) && words.length === 1)
    choices = Array.from({ length: context.tabs ?? 0 }, (_, i) => String(i + 1));
  else if ((words[0] === "help" && words.length === 2) || (words[0] === "scope" && words[1] === "help" && words.length === 2)) {
    const topic = words[0] === "help" ? words[1] : "scope";
    choices = [...new Set(CONSOLE_COMMANDS.find((c) => c.name === topic)?.subcommands?.map((c) => c.syntax.split(" ")[1]).filter((c) => c && !c.startsWith("<")) ?? [])];
  }
  else if (words[0] === "scope" && words[1] === "linked" && words.length === 2) choices = ["on", "off"];
  else if (words[0] === "analyze" && words[1] === "auto" && words.length === 2) choices = ["on", "off"];
  else if (words[0] === "show" && words.length === 3 && words[1] === "current" && ["direction", "steady"].includes(words[2])) choices = ["on", "off"];
  else if (words[0] === "show" && words.length === 2) choices = words[1] === "current" ? ["on", "off", "dots", "arrows", "squares", "steady", "direction"] : ["on", "off"];
  else if (words.length === 1) choices = CONSOLE_COMMANDS.find((c) => c.name === words[0])?.choices ?? [];
  return choices.filter((c) => c.toLowerCase().startsWith(partial.toLowerCase())).map((c) => [...words, c].join(" "));
}
