// Console help uses the command registry for syntax, validation and discoverable choices.
// Licensed under the GNU General Public License v2 or later. See LICENSE.
import { MEASURES } from "./scope-measure";
import { CONSOLE_COMMANDS, HELP_COMMANDS, NO_CIRCUIT_COMMANDS, SHARED, SHARED_HELP_GROUPS } from "./commands";
import { sharedHelpDetails } from "forge-shell/app/shared-commands";
import { commandHelp as formatCommandHelp, generalHelp as formatGeneralHelp, type HelpCatalog, type HelpDetails } from "forge-shell/app/command-help";
export { invalidUsage } from "forge-shell/app/command-help";
import type { ConsoleResult } from "./terminal";

const details: Record<string, HelpDetails> = {
  help: { forms: ["help", "help <command>", "help <command> <action>"], notes: ["<value> is required. [value] is optional. Do not type the brackets.", "Enter runs a command. Tab completes. Up/Down browse history. Escape leaves the prompt.", "Ctrl or ⌘ with +/− changes text size. Ctrl+C cancels a running command. Quote names containing spaces.", "Legacy accuracy commands remain supported. See help accuracy."], example: "help plot audio" },
  run: { forms: ["run", "run for <duration>"], notes: ["Without arguments, resumes continuous simulation. Timed runs ignore the speed setting and pause at the first solver step at or after the requested duration.", "Ctrl+C cancels. Circuit edits stop the timed run. Partial progress is retained. Limit: 120 seconds of computation."], example: "run for 10ms" },
  switch: { forms: ["switch <part>", "switch <part> <state>", "switch <part> <position>", "switch <part> status"], choices: [["on", "Close a two-terminal switch"], ["off", "Open a two-terminal switch"]], notes: ["Without a state, advances to the next position. Positions start at 1; use positions for multi-throw switches and logic inputs.", "Linked switches operate together. Changes support undo. Momentary switches remain in the selected state until changed again."], example: "switch SW1 on" },
  "plot span": { notes: ["Sets the full live time-window duration, not time per division. Requires a time plot and at least one maximum time step.", "Session-only. Native time-scale changes clear this override."], example: "plot span 1 10ms" },
  "plot scale": { choices: [["auto", "Fit the visible data"], ["V", "Voltage scale"], ["A", "Current scale"], ["W", "Power scale"], ["C", "Charge scale"]], notes: ["Manual scale applies to time plots and the selected unit. Per-division must be positive; center defaults to 0.", "Session-only. Without a value, reports automatic or manual settings."], example: "plot scale 1 V 2V 5V" },
  "plot mode": { choices: [["time", "Trace values over time"], ["fft", "Frequency spectrum"], ["xy", "First visible trace against the second"]], notes: ["X-Y requires two visible traces. Supports undo and saves with the circuit."], example: "plot mode 1 fft" },
  "plot measure": { choices: [...MEASURES.map((m): [string, string] => [m.key, m.name]), ["on", "Show measurement"], ["off", "Hide measurement"]], notes: ["Without a measurement, lists visibility states. Measurements appear on time plots beside each trace and describe the visible data, or the stretch between cursors A and B when both are placed.", "Supports undo and saves with the circuit."], example: "plot measure 1 rise on" },
  "plot export": { notes: ["Pauses simulation. Exports all recorded time intervals for visible traces as CSV, with minimum and maximum columns in SI units.", "Data is the stored envelope, not individual adaptive solver samples. No silent downsampling or omission of expired data.", "Limits: 1000000 cells and 64 MB. Ctrl+C cancels. Browser downloads a file; desktop opens a save dialog."], example: "plot export 1 csv" },
  status: { notes: ["Shows the active circuit, simulation state, time, solver, relative tolerance and maximum time step."] },
  solver: { forms: ["solver", "solver <engine>"], notes: ["Without an argument, shows the current engine. This is an app setting."], choices: [["nodeforge", "NodeForge's engine: adaptive, error-controlled steps"], ["circuitjs", "CircuitJS: fixed steps, exactly as CircuitJS"]] },
  reltol: { forms: ["reltol", "reltol <percent>"], notes: ["Without an argument, shows the current tolerance. This app setting applies to the NodeForge solver.", "Smaller values require more computation. Relative tolerance does not guarantee total circuit accuracy."] },
  compare: { notes: ["Requires ngspice in the desktop app. Compares a copy of the active circuit.", "Ctrl+C cancels the comparison."] },
  accuracy: { forms: ["accuracy <percent>", "accuracy check", "accuracy"], notes: ["Legacy command. Use reltol <percent> to set tolerance or compare to compare with ngspice.", "Without an argument, runs the ngspice comparison."] },
  step: { notes: ["Defaults to 1 step. Accepts 1–1000. Pauses the simulation before stepping."] },
  reset: { notes: ["Resets simulation time and circuit state."] },
  op: { notes: ["Finds a DC operating point and resets simulation time. May fail if no solution is found."] },
  selfheat: { forms: ["selfheat", "selfheat <state>"], choices: [["on", "Heat devices by their dissipated power"], ["off", "Keep devices at the circuit temperature"]], notes: ["Without an argument, toggles self-heating. Applies to SPICE models with a thermal resistance (diode RTH0, VDMOS RTHJC). It's saved with the circuit."] },
  ramp: { forms: ["ramp", "ramp <time>", "ramp off"], notes: ["Without an argument, shows the start-up ramp. With a time, every source rises from 0 over it at the start of a run from rest, as if switched on (as LTspice's startup); off (the default) starts them at their values. A run from an operating point has no ramp.", "NodeForge solver only. It's saved with the circuit."], example: "ramp 20us" },
  temp: { forms: ["temp", "temp <value>", "temp unit <unit>"], notes: ["Without an argument, shows the circuit's temperature (25 °C unless set). A bare number is in the unit shown (View › Temperature unit); add C, F or K to use another, as in 185F or 358K. It's saved with the circuit, always in °C.", "SPICE device models follow it; parts on CircuitJS models follow it on the NodeForge solver only."] },
  maxstep: { forms: ["maxstep", "maxstep <time>"], notes: ["Without an argument, shows the current value. Use a positive time, such as 50ns.", "Limits adaptive steps in the NodeForge solver; sets the fixed step in CircuitJS mode. Also sets the recording interval."] },
  speed: { forms: ["speed", "speed <multiple>"], notes: ["Without an argument, shows the current value. 1x is real time; 0.01x is 100 times slower."] },
  zoom: { forms: ["zoom", "zoom <choice>", "zoom <percent>"], choices: [["in", "Zoom in"], ["out", "Zoom out"], ["fit", "Fit the schematic in view"], ["actual", "Show the schematic at actual size"]], notes: ["Without an argument, shows the current magnification. The view clamps percentages to its supported range."], example: "zoom 150%" },
  analyze: { forms: ["analyze", "analyze apply", "analyze auto", "analyze auto <state>"], choices: [["on", "Enable automatic analysis"], ["off", "Disable automatic analysis"]], notes: ["analyze reports recommended settings; apply runs analysis and applies its recommendations.", "analyze auto shows the saved app preference. Automatic analysis starts after 1.5 seconds without edits."] },
  tolerance: { forms: ["tolerance", "tolerance <state>", "tolerance <part> <percent>"], choices: [["on", "Apply component tolerance variation"], ["off", "Use nominal component values"]], notes: ["Without an argument, toggles component variation. Component percentages must be between 0% and 100%."] },
  seed: { forms: ["seed", "seed <number>", "seed new"], notes: ["Without an argument, shows the current seed. Accepts 1–99999.", "The same seed reproduces component variation. new generates another seed."] },
  list: { notes: ["Lists named components. Wires, ground and other unnamed elements are omitted."] },
  info: { notes: ["Use a designator from list, such as R1. Reports component properties and current simulation values."] },
  dcsweep: { notes: ["Steps a voltage source's, rail's or current source's DC value from start to stop and finds the operating point at each (from the last), on a copy of the circuit: the running simulation is left as it is.", "Plots each quantity (V(R1), I(V1), Ic(Q1)… as in plot) against the swept value in a new scope; points without an operating point are gaps. A source's right-click DC sweep… writes the command for you to edit. NodeForge solver; the result isn't saved with the circuit."], example: "dcsweep V1 0 10 0.1 V(R1) Ic(Q1)" },
  ac: { notes: ["Small-signal analysis (SPICE's .ac): linearizes the circuit at its operating point and drives it with 1 V (or 1 A) of the source at each frequency, 20 points per decade unless given, on a copy of the circuit: the running simulation is left as it is.", "Plots each voltage (V(R2), Vgs(M1)… as in plot) in a new scope as a Bode plot: magnitude in dB (relative to 1 V) on the left, phase in degrees dashed on the right. A source's right-click AC sweep… writes the command for you to edit. NodeForge solver; the result isn't saved with the circuit."], example: "ac V1 10 1Meg V(R2)" },
  stepsweep: { notes: ["Runs the circuit from the start once per value of the part's property (its main value when none is named, as set does) for the given time, each on a copy: the running simulation is left as it is.", "Values: a list (1k,4.7k,10k) or a range (start:stop:step), up to 50 runs. Plots each quantity (as in plot) for every run in one scope, the runs from faint (the first value) to strong (the last). The result isn't saved with the circuit."], example: "stepsweep C1 capacitance 1u:10u:3u for 5ms V(C1)" },
  power: { forms: ["power", "power reset", "power load <part>", "power load <part> <state>"], choices: [["on", "Count the part's power as output"], ["off", "Stop counting it as output"]], notes: ["Averages each part's power over the latest whole cycles (up to 20) of the switch or rectifier whose voltage swings most, or over the run when nothing repeats. MOSFETs split into conduction and switching (both drain voltage and current above 10% of their peaks).", "Input is what the sources deliver; output is what the parts marked as loads take; efficiency is output over input. power load <part> shows or sets a part's mark (saved with the circuit, supports undo). power reset starts the averages over."] },
  select: { notes: ["Replaces the current selection with the named component."] },
  delete: { notes: ["Deletes only the named component. Supports undo."] },
  duplicate: { notes: ["Creates and selects a copy two grid spaces diagonally from the original. Supports undo."] },
  rotate: { notes: ["Rotates and selects the named component. Supports undo."] },
  tabs: { notes: ["Tab numbers start at 1. Lists the active tab and unsaved changes."] },
  tab: { notes: ["Use a number from tabs. Switching tabs stops scope audio."] },
  close: { forms: ["close", "close <number>"], notes: ["Without an argument, closes the active tab. Prompts before discarding unsaved changes."] },
  scope: { notes: ["Scope numbers start at 1; plot list shows them. scope places the scopes in the bottom panel; plot makes graphs and changes what one shows.", "Use help scope <action> for focused help."] },
  "scope stack": { notes: ["Puts every scope in one column. Supports undo."] },
  "scope unstack": { notes: ["Gives each scope its own column. Supports undo."] },
  "scope combine": { notes: ["Moves every trace into one scope. Supports undo."] },
  "scope separate": { notes: ["Gives each trace its own scope. Supports undo."] },
  "scope move": { choices: [["above", "Stack it above the other scope"], ["below", "Stack it below the other scope"], ["left", "Put it in a column to the left"], ["right", "Put it in a column to the right"]], notes: ["Does what dragging a scope's title does. Use plot list for the numbers. Supports undo."], example: "scope move 2 right 1" },
  plot: { notes: ["Makes a graph in a new scope: plot <expression> over time; plot <Y> vs <X> as Y against X; plot fft <expression> as a spectrum; plot <part> [quantity] for a part's quantity, or its default traces without one.", "Quantities are written as in scope legends: V(R1), I(L1), P(M1), Vgs(M1), Ic(Q1)…; any a part offers in its scope menu: V, I, P; Vbe, Vbc, Vce, Ib, Ic, Ie on a transistor; Vds, Id, Vgs, Ig on a MOSFET; Tj (junction temperature in °C; TjF in °F, TjK in K, to plot it in two units at once) on a diode or MOSFET with a thermal model; R, Q where parts have them.", "Expressions combine them: V(D1)*I(D1), abs(I(L1)), Vgs(M1) - 2; + - * / ^, numbers with SI prefixes (10k, 4.7u), pi, and abs, sqrt, exp, ln, log10, sin, cos, tan, min, max, pow.", "plot <expression> in <number> adds one to an existing scope. The other forms (list, remove, live, span, scale, measure, trigger, audio, export, mode) change a scope that exists; help plot <form> for each. Supports undo and saves with the circuit (XML)."], example: "plot Vds(M1) vs Id(M1)" },
  "plot list": { notes: ["Lists visible traces in display order. Trace numbers are local to each scope."] },
  "scope clear": { notes: ["Removes all docked scopes and stops their audio. Supports undo."] },
  "plot remove": { notes: ["Removes the numbered scope. Supports undo."] },
  "plot trigger": { choices: [["rising", "Trigger on a rising edge"], ["falling", "Trigger on a falling edge"], ["off", "Disable triggering"]], notes: ["Without an action, shows the trigger settings. Applies to time plots.", "Use trace numbers from plot list. Changing the trace resets the level to midpoint.", "Level accepts signed values in the trace's unit, such as -20mA, or midpoint for an automatic threshold.", "Changes support undo and are saved with the circuit."], example: "plot trigger 1 level 2.5V" },
  "plot audio": { choices: [["on", "Start or resume audio"], ["off", "Stop audio"], ["waveform", "Play at simulation speed"], ["pitch", "Map values to pitch"], ["realtime", "Play recent waveform at real-time speed"]], notes: ["Without an action, shows audio settings. Mode and trace changes preserve the on/off state.", "First use selects the first visible trace in waveform mode. Use trace numbers from plot list.", "Realtime needs at least 20 ms of recorded circuit time. It loops recent samples while the solver runs slower than 1×.", "Only one scope plays at a time. Pausing silences playback. Settings last for the session and are not saved."], example: "plot audio 1 mode realtime" },
  "scope linked": { choices: [["on", "Show the same hovered time across scopes"], ["off", "Show only the hovered scope's readout"]], notes: ["Without a state, shows the saved app preference. Off by default."] },
  show: { forms: ["show", "show <setting> [state]", "show current <shape>", "show current steady [state]", "show current direction <state>"], choices: [["current", "Animated current markers"], ["voltage", "Wire voltage coloring"], ["values", "Component values"], ["readout", "Values under the pointer"], ["jumps", "Bridge unconnected conductor crossings"], ["on", "Enable the setting"], ["off", "Disable the setting"], ["dot", "Round current markers"], ["arrow", "Directional current markers"], ["square", "Square current markers"]], notes: ["Without arguments, lists display settings. A setting without a state toggles it.", "steady controls the stationary band for fast current; direction controls its direction arrows."] },
  symbols: { choices: [["ansi", "ANSI schematic symbols"], ["iec", "IEC schematic symbols"]], notes: ["Applies to the schematic and toolbar across the app. us and eu remain aliases."] },
  electron: { choices: [["on", "Electron-flow direction"], ["off", "Conventional-current direction"]], notes: ["Without an argument, toggles direction."] },
  wheel: { choices: [["zoom", "Always zoom with the scroll wheel"], ["auto", "Use the automatic scroll behavior"]] },
  clear: { notes: ["Clears the transcript. Keeps the banner and command history."] },
  history: { forms: ["history", "history <number>", "history clear"], notes: ["Shows earlier commands, optionally limited to the last N. Stores up to 100 unique commands.", "Opening a circuit clears history. History is not saved between sessions."] },
  set: { notes: ["Every property the inspector shows, by its name or symbol: set R1 R 4.7k, set M1 \"Beta tolerance\" 10, set M1 Δβ 10, set M1 heatsink 5, set M1 model IRF540, set M1 vto 2.5 (a custom model's parameter). Without a property, edits the component's primary value; set <part> alone lists what it accepts.", 'Quote names or values containing spaces. Use \\n inside quoted text for multiple lines.', "File-valued properties use the inspector's file picker."] },
  slider: { notes: ["Without arguments, lists adjustable sliders. Use inspector property names; quote names with spaces.", "Step 0 is continuous. Otherwise, the step must evenly divide the range and include the current value."] },
  model: { forms: ["model <part> <model>", "model <part> custom", "model <part> <parameter> <value>", "model <part> save <name>"], notes: ["Use models to find model names. Parameter edits require a custom model.", "save keeps a custom model in the model library under a name, and puts the part on it."] },
  models: { forms: ["models [kind] [search]", "models import", "models import <url>", "models check <name>"], notes: ["Import without a URL opens a file picker. Browser URLs require CORS permission.", "Checks require desktop ngspice. Review replacements of existing models in the Model library dialog."] },
  open: { notes: ["Without an argument, opens a file picker. Accepts bundled circuit filenames.", "Arbitrary local paths require the desktop app. Quote filenames containing spaces."] },
  autosave: { choices: [["off", "Save only with Save"], ["1m", "Save 1 minute after the last edit"], ["5m", "Save 5 minutes after the last edit"], ["focus", "Save when the window loses focus"]], notes: ["Desktop only. A circuit is autosaved once it has an .nfg file; an untitled circuit or a CircuitJS file waits for Save."], example: "autosave focus" },
  save: { forms: ["save", "save as", "save as <name>"], notes: ["Use a filename, not a path. The desktop save dialog chooses the folder.", "The browser downloads a copy and keeps the document marked unsaved."] },
  export: { choices: [["nfg", "NodeForge circuit file"], ["xml", "CircuitJS XML file"], ["txt", "CircuitJS text file"], ["spice", "SPICE netlist"]], notes: ["Unsupported SPICE components are reported. The browser downloads the export."] },
  panel: { choices: [["on", "Show the bottom panel"], ["off", "Hide the bottom panel"], ["terminal", "Show the terminal"], ["scopes", "Show scopes"], ["messages", "Show the Messages log"]] },
  bench: { notes: ["Defaults to 4000 steps. Accepts 1–1000000, with a 10-second computation limit.", "Runs on a circuit copy. Ctrl+C cancels."] },
  montecarlo: { notes: ["Defaults to 20 runs. Accepts 1–200. Measures component tolerance variation on a circuit copy.", "Ctrl+C cancels."] },
};

const welcomeForms: Record<string, { syntax: string; description: string }> = {
  analyze: { syntax: "analyze auto [on|off]", description: "Show or change automatic analysis" },
  panel: { syntax: "panel <on|off|terminal>", description: "Show or hide the bottom panel, or show the terminal" },
  scope: { syntax: "scope linked [on|off]", description: "Show or change linked scope readout" },
  temp: { syntax: "temp unit <C|F|K>", description: "Choose the temperature display unit" },
};
const welcomeTopics: Record<string, string> = { analyze: "analyze auto", panel: "panel", scope: "scope linked", temp: "temp unit" };

/**
 * `help`'s groups: the shell's shared commands first (File, Edit, View), then NodeForge's in the menu bar's order
 * (Scopes, Simulation), Help, what has no menu of its own (Analysis), and Console last. A command missing here is listed
 * under Other. Each group's commands are listed alphabetically.
 */
const NODEFORGE_GROUPS: [string, string[]][] = [
  ["File", ["export", "spice", "tabs", "tab"]],
  ["Edit", ["list", "info", "select", "set", "delete", "duplicate", "rotate", "switch", "model", "models", "slider", "tolerance", "seed"]],
  ["View", ["show", "symbols", "electron", "wheel"]],
  ["Help", ["health"]],
  ["Scopes", ["scope", "plot"]],
  ["Simulation", ["run", "pause", "step", "reset", "status", "solver", "reltol", "maxstep", "speed", "temp", "selfheat", "ramp", "op", "analyze"]],
  ["Analysis", ["dcsweep", "stepsweep", "ac", "power", "montecarlo", "compare", "bench"]],
];
const GROUP_ORDER = ["File", "Edit", "View", "Scopes", "Simulation", "Help", "Analysis", "Console"];
export const HELP_GROUPS: [string, string[]][] = GROUP_ORDER.map((name): [string, string[]] => [name, [
  ...(SHARED_HELP_GROUPS.find(([group]) => group === name)?.[1] ?? []),
  ...(NODEFORGE_GROUPS.find(([group]) => group === name)?.[1] ?? []),
]]).filter(([, names]) => names.length);

const helpCatalog = {
  commands: CONSOLE_COMMANDS,
  helpCommands: HELP_COMMANDS,
  availableOnWelcome: NO_CIRCUIT_COMMANDS,
  // The shared commands' help first, so that they read the same as in every Forge app; NodeForge's own entries follow.
  details: { ...sharedHelpDetails(SHARED), ...details },
  welcomeForms,
  welcomeTopics,
  groups: HELP_GROUPS,
  alwaysChoices: new Set(["reltol", "accuracy"]),
  noDocumentMessage: "Open a circuit first.",
} satisfies HelpCatalog;

export function commandHelp(topic: string, noCircuit = false): ConsoleResult {
  return formatCommandHelp(topic, noCircuit, helpCatalog);
}

export function generalHelp(noCircuit = false): ConsoleResult {
  return formatGeneralHelp(noCircuit, helpCatalog);
}
