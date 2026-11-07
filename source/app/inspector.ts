// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { InspectorSections, SECTION_CHEVRON } from "forge-shell/app/inspector-sections";
import { createButton, createField, createRow, setButtonBusy } from "forge-shell/app/builders";
import type { RenameOptions } from "forge-shell/app/rename";
import { createUnitField } from "forge-shell/app/unit-field";
import { setTip } from "forge-shell/app/tips";
import { editableValue, makeSlider, sliderRow, type SliderExtras, type SliderStop } from "forge-shell/app/inspector-widgets";
export { makeSlider } from "forge-shell/app/inspector-widgets";
import {
  adjustablePosition, AudioInputElm, type CircuitElm, DataInputElm, type EditInfo, type EditInput, editInfos, getEditInfo, PlaceholderElm, setEditInput,
  SpiceMosfetElm, spiceModelKind, type SpiceModelKind, spiceModelOf, spicePolarity, WireElm,
} from "../engine";
import { parseSI, si } from "./format";
import { formatTemperature, parseTemperature } from "./temperature";
import { actionIcons } from "./icons";
import { MAX_SPEED_RATIO, MIN_SPEED_RATIO, type SimulationModel, unitForEditName } from "./model";
import { onSettingsChange, settings, updateSettings } from "./settings";
import { DEFAULT_TOLERANCES, tolerancePercent, toleranceParams } from "./tolerance";
import { newSeed } from "./document";
import { checkPercent, displayName, KIND_LABELS, modelLabel } from "./model-catalog";
import { modelParams } from "./model-params";
import { type FieldPresentation, isCoveredByLabels, isLegacySymbolField, presentChoice, presentField, takesPower } from "./properties";
import { modelLibrary, saveCustomModel } from "./model-library";
import { configureSlider, removeSlider, sliderFields, sliderFor, sliderNumbers } from "./sliders";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

type SectionKey = "simulation" | "circuit" | "tolerance" | "adjust" | "properties" | "pointer";
export const SECTION_KEYS: SectionKey[] = ["simulation", "circuit", "tolerance", "adjust", "properties", "pointer"];
const SAVED_SECTIONS = { adjust: "adjustExpanded", properties: "propertiesExpanded", pointer: "pointerExpanded" } as const;
/** Folds of the always-open-at-launch sections, for this session only. */
const sessionOpen = new Map<SectionKey, boolean>();
const sectionOpen = (k: SectionKey): boolean =>
  k in SAVED_SECTIONS ? settings[SAVED_SECTIONS[k as keyof typeof SAVED_SECTIONS]] : sessionOpen.get(k) ?? true;
function setSectionOpen(k: SectionKey, open: boolean): void {
  if (k in SAVED_SECTIONS) {
    const name = SAVED_SECTIONS[k as keyof typeof SAVED_SECTIONS];
    if (settings[name] !== open) updateSettings({ [name]: open });
  } else sessionOpen.set(k, open);
}

/** 1-2-5 steps from 10⁻⁸ to 100 × real time, ticked at each decade, real time marked (log₁₀ values). */
const SPEED_STOPS: SliderStop[] = (() => {
  const stops: SliderStop[] = [];
  const lo = Math.log10(MIN_SPEED_RATIO), hi = Math.log10(MAX_SPEED_RATIO);
  for (let d = lo; d <= hi; d++) {
    stops.push({ value: d, tick: d === 0 || d === lo || d === hi ? "major" : "minor" });
    if (d < hi) stops.push({ value: d + Math.log10(2) }, { value: d + Math.log10(5) });
  }
  return stops;
})();
/** Scale labels under the speed dial: every other decade, real time and the top. */
const SPEED_LABELS = [-8, -6, -4, -2, 0, 2].map((d) => ({ value: d, text: d === 0 ? "1×" : d === 2 ? "100×" : `10${superscript(d)}` }));

function superscript(n: number): string {
  return String(n).replace(/[-0-9]/g, (c) => "⁻⁰¹²³⁴⁵⁶⁷⁸⁹"["-0123456789".indexOf(c)]);
}

/**
 * A typed speed: a multiple of real time ("1", "0.01×", "1/1000", "2·10⁻⁶", "10%") or circuit time
 * per second ("2 ms/s"). NaN if it isn't one.
 */
function parseSpeed(text: string): number {
  let s = text.trim().replace(/\s*(×|x|real ?time)$/i, "");
  if (s.endsWith("%")) return parseSI(s.slice(0, -1)) / 100;
  const perSecond = s.match(/^(.*?)\s*\/\s*s$/);
  if (perSecond) return parseSI(perSecond[1], "s");
  const fraction = s.match(/^([\d.e+-]+)\s*\/\s*([\d.e+-]+)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  // superscript powers of ten: "10⁻⁶", "2·10⁻⁶"
  s = s.replace(/[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => "e" + m.replace(/./g, (c) => "-0123456789"["⁻⁰¹²³⁴⁵⁶⁷⁸⁹".indexOf(c)]));
  s = s.replace(/^(\d*\.?\d*)\s*[·*]?\s*10e/, (_, m: string) => `${m || "1"}e`);
  return parseSI(s);
}

/** The start-up ramp's time when it's switched on (LTspice's `startup`: 20 µs). */
export const DEFAULT_STARTUP_RAMP = 20e-6;

/** NodeForge solver tolerances offered (relative error per step). */
const RELTOL_CHOICES: [number, string][] = [
  [1e-3, "0.1%"],
  [1e-4, "0.01%"],
  [1e-5, "0.001%"],
  [1e-6, "0.0001%"],
];

/** Dot speed range and its scale labels. */
const DOT_MIN = 0.1, DOT_MAX = 5;
const DOT_LABELS = [0.1, 0.2, 0.5, 1, 2, 5].map((m) => ({ value: Math.log10(m), text: `${m}×` }));

/** Dot speed multipliers (log₁₀ values). */
const DOT_STOPS: SliderStop[] = [0.1, 0.2, 0.5, 1, 2, 5].map((m) => ({ value: Math.log10(m), tick: m === 1 ? "major" : "minor" }));

/** A circuit-time ratio as a multiple of real time: 100×, 1×, 0.004×, 2·10⁻⁶×. */
export function timesRealTime(r: number): string {
  if (!(r > 0)) return "0×";
  if (r >= 0.001) return `${+r.toPrecision(2)}×`;
  const e = Math.floor(Math.log10(r));
  const sup = String(e).replace(/[-0-9]/g, (c) => "⁻⁰¹²³⁴⁵⁶⁷⁸⁹"["-0123456789".indexOf(c)]);
  const m = +(r / 10 ** e).toPrecision(2);
  return `${m === 1 ? "" : `${m}·`}10${sup}×`;
}

/** Units already scaled, or compound: shown as plain numbers (no SI prefix). */
const PLAIN_UNITS = /^(%|°|°C|°C\/W|nm|Ah|V\/µs|V\/ns|kg·m²|N·m\/A|N·m·s|µm²\/V·s|A\/V²|1\/V)$/;

/** A value as a field shows it: SI prefix and unit ("300 nF"), or a plain number and unit ("45°"). */
function showValue(value: number, unit: string): string {
  if (!PLAIN_UNITS.test(unit)) return si(value, unit, true, 6);
  return `${+value.toPrecision(6)}${unit === "%" || unit === "°" ? "" : " "}${unit}`;
}

export type RecommendState = "ready" | "waiting" | "analyzing" | "empty";

export interface InspectorHost {
  run(id: string): void;
  /** Apply a change to the circuit as one undoable step. */
  edit(change: () => void): void;
  /** A change made over time (a slider dragged): from begin to end, one undoable step. */
  beginChange(): void;
  endChange(): void;
  /** Circuit name for the Circuit section. */
  circuitName(): string;
  /** Why the circuit cannot take this name, or null. */
  circuitNameProblem(name: string): string | null;
  /** Give the circuit this name (it has passed `circuitNameProblem`). */
  renameCircuit(name: string): void;
  /** A message for the Messages log (the inspector shows none of its own, so it never changes size). */
  report(kind: "error" | "warning", text: string): void;
}

/**
 * The notes about the circuit's settings and run that the inspector used to show under its
 * fields, as [key, kind, text]: they go to the Messages log, logged when they appear.
 */
export function circuitNotes(model: SimulationModel): [string, "warning" | "info", string][] {
  const notes: [string, "warning" | "info", string][] = [];
  const r = model.speedRatio, reached = model.achievedRatio;
  if (model.running && reached !== null && reached < 0.7 * r && model.circuit.simulatedElements.length > 0 && !model.sim.stopMessage) {
    notes.push(["speed limited", "info", `Simulation speed limited to ${si(reached, "s", true)} per second (${timesRealTime(reached)}).`]);
  }
  if (model.running && settings.showCurrent && model.circuit.simulatedElements.length && !model.currentsVisible) {
    notes.push(["currents small", "info", "All currents are below the 1 nA display threshold."]);
  }
  const step = stepWarningText(model);
  if (step) notes.push([`step ${step}`, "warning", step]);
  const loose = model.sim.looseSteps;
  if (loose) notes.push(["loose steps", "warning", "Steps accepted without full convergence (as CircuitJS would), so results there are less certain."]);
  if (settings.solver !== "nodeforge" && !model.sim.adjustTimeStep && model.circuit.elements.some((e) => spiceModelOf(e))) {
    notes.push(["fixed steps", "warning", "Use the NodeForge solver for SPICE models. Fixed steps may fail during fast switching."]);
  }
  return notes;
}

/** A warning when the time step is too long for the fastest source to be followed (fewer than ~20 steps a cycle). */
function stepWarningText(model: SimulationModel): string | null {
  const src = model.fastestSource();
  const dt = model.sim.maxTimeStep;
  if (src === null || dt <= 1 / (20 * src.frequency)) return null;
  const name = model.designator(src.elm);
  const need = si(1 / (20 * src.frequency), "s", true, 2);
  return dt >= 1 / src.frequency
    ? `Longer than a cycle of the ${si(src.frequency, "Hz", true)} source${name ? ` ${name}` : ""}: it can't be followed. Use ≤ ${need}.`
    : `Too coarse for the ${si(src.frequency, "Hz", true)} source${name ? ` ${name}` : ""}: use ≤ ${need} for an accurate waveform.`;
}

/** Right-hand panel, after CircuitJS's side panel: run controls and speeds, circuit details,
 * the circuit's sliders, properties of the selected part, and the info box for the part in focus. */
export class Inspector {
  private runButton!: HTMLButtonElement;
  private stepButton!: HTMLButtonElement;
  private speedText!: HTMLElement;
  private currentText!: HTMLElement;
  private speedSlider!: ReturnType<typeof makeSlider>;
  private recommendButton!: HTMLButtonElement;
  private recommendState: RecommendState = "ready";
  private toleranceSection!: HTMLElement;
  private electronBox!: HTMLInputElement;
  private timeText!: HTMLElement;
  private partsText!: HTMLElement;
  private sliderTexts: [import("./model").Slider, HTMLElement][] = [];
  private adjust!: HTMLElement;
  /** Parts with their own sliders (pots, adjustable rails…), as shown. */
  private partSliders: [CircuitElm, HTMLElement][] = [];
  private props!: HTMLElement;
  private propsFor: CircuitElm | null | undefined = undefined;
  private sliderConfigOpen = settings.sliderConfigExpanded;
  private infoTitle!: HTMLElement;
  private infoBody!: HTMLElement;
  private readonly sections: InspectorSections<SectionKey>;

  constructor(private readonly root: HTMLElement, private model: SimulationModel, private readonly host: InspectorHost) {
    // Simulation, Circuit and Tolerance folds last for this session; the others persist.
    this.sections = new InspectorSections({ root, keys: SECTION_KEYS, isOpen: sectionOpen, setOpen: setSectionOpen });
    this.build();
    onSettingsChange(() => {
      this.electronBox.checked = !settings.conventionalCurrent;
      if (this.currentText) this.showSpeeds();
    });
  }

  setModel(model: SimulationModel): void {
    this.model = model;
    this.build();
  }

  private applySections(smooth = false): void { this.sections.applyAll(smooth); }

  private button(label: string, icon: string, id: string, primary = false): HTMLButtonElement {
    const b = createButton({ label, primary, onClick: () => this.host.run(id) });
    b.innerHTML = `${icon}<span>${label}</span>`;
    return b;
  }

  /** Speed as a multiple of real time, circuit time per second, and the speed reached when the computer can't keep up. */
  private showSpeeds(): void {
    const { model } = this;
    const r = model.speedRatio;
    this.speedText.textContent = timesRealTime(r);
    const reached = model.achievedRatio;
    // an empty circuit, or one stopped by an error, doesn't advance: that's not the computer's limit
    const limited = model.running && reached !== null && reached < 0.7 * r && model.circuit.simulatedElements.length > 0 && !model.sim.stopMessage;
    // where it really runs, on the dial (the note itself goes to the Messages log: circuitNotes)
    this.speedSlider?.marker(limited && reached > 0 ? Math.log10(reached) : null);
    this.currentText.textContent = `${+settings.dotSpeed.toPrecision(2)}×`;
  }


  /** Component tolerances: off, or each part varied from its nominal value by a seeded amount. */
  private buildTolerance(): void {
    const t = this.model.tolerance;
    const s = this.toleranceSection;
    s.replaceChildren(s.firstElementChild!);
    // these are part of the circuit (saved with it), so they're undoable edits
    const set = (on: boolean, seed: number) => {
      this.host.edit(() => this.model.setTolerance(on, seed));
      this.buildTolerance();
    };
    const ideal = this.checkField("Ideal parts", !t.enabled, (v) => this.model.setTolerance(!v, t.seed));
    ideal.addEventListener("change", () => this.buildTolerance());
    setTip(ideal, "Use nominal component values. Disable to apply tolerances set in each component's properties.");
    s.append(ideal);
    if (!t.enabled) return;
    const seed = this.numberField("Seed", t.seed, "", (v) => this.model.setTolerance(true, Math.max(0, Math.round(v))));
    // a seed is an integer, not a quantity: no SI prefixes
    const input = seed.querySelector("input")!;
    input.value = String(t.seed);
    input.addEventListener("change", () => (input.value = String(this.model.tolerance.seed)));
    s.append(seed);
    const reroll = createButton({
      label: "New seed", title: "Generate another set of component values within their tolerances.", onClick: () => set(true, newSeed()),
    });
    const row = el("div", "buttons");
    row.append(reroll);
    s.append(row);
    setTip(seed, "Set the random seed for reproducible component variation.");
  }

  /** Availability of the on-demand recommendation while background analysis runs. */
  setRecommendState(state: RecommendState): void {
    this.recommendState = state;
    const button = this.recommendButton;
    if (!button) return;
    button.disabled = state !== "ready" && state !== "analyzing";
    setButtonBusy(button, state === "analyzing" ? "Analyzing circuit…" : null);
    setTip(button, {
      ready: "Recommend time step, simulation speed and scope scale.",
      waiting: "Waiting for editing to finish.",
      analyzing: "Analyzing the circuit.",
      empty: "Add components to analyze the circuit.",
    }[state]);
  }



  /** Dots move with conventional current (+ to −) unless electron flow is ticked. */
  private currentDirection(): HTMLElement {
    const r = el("label", "field check");
    this.electronBox = el("input");
    this.electronBox.type = "checkbox";
    this.electronBox.checked = !settings.conventionalCurrent;
    this.electronBox.addEventListener("change", () => updateSettings({ conventionalCurrent: !this.electronBox.checked }));
    r.append(this.electronBox, el("span", "label", "Electron flow"));
    return r;
  }

  /** Rebuild everything (new document, or sliders changed). */
  build(): void {
    const { model } = this;
    this.root.replaceChildren();
    this.sliderTexts = [];
    this.propsFor = undefined;

    const sim = this.sections.create("Simulation", "simulation");
    const buttons = el("div", "buttons");
    this.runButton = this.button("Pause", actionIcons.stop, "sim.toggle", true);
    this.stepButton = this.button("Step", actionIcons.step, "sim.step");
    buttons.append(this.runButton, this.button("Reset", actionIcons.reset, "sim.reset"), this.stepButton);
    sim.append(buttons);
    // speed on a log scale around real time, snapping to 1-2-5 steps, ticks at each decade and
    // labels at every other one; the readout can be typed into, double-click goes back to the
    // circuit's own speed
    const speed = sliderRow("Simulation speed", Math.log10(model.speedRatio), Math.log10(MIN_SPEED_RATIO), Math.log10(MAX_SPEED_RATIO), (v) => {
      model.speedRatio = 10 ** v;
      this.showSpeeds();
    }, true, SPEED_STOPS, { labels: SPEED_LABELS, reset: () => (model.fileSpeedRatio > 0 ? Math.log10(model.fileSpeedRatio) : null), undo: this.sliderUndo() });
    this.speedText = speed.valueText;
    this.speedSlider = speed.slider;
    editableValue(speed.valueText, () => timesRealTime(model.speedRatio), (text) => {
      const r = parseSpeed(text);
      if (!(r > 0)) return false;
      this.host.edit(() => { model.speedRatio = r; });
      speed.slider.set(Math.log10(model.speedRatio));
      this.showSpeeds();
      return true;
    }, "Enter a speed ratio, such as 0.01, or a rate, such as 2 ms/s");
    setTip(speed.row, "Set simulation speed relative to real time. 1× is real time.");
    const current = sliderRow("Current marker speed", Math.log10(settings.dotSpeed), Math.log10(DOT_MIN), Math.log10(DOT_MAX), (v) => {
      updateSettings({ dotSpeed: 10 ** v });
      this.showSpeeds();
    }, true, DOT_STOPS, { labels: DOT_LABELS, reset: () => 0 });
    this.currentText = current.valueText;
    editableValue(current.valueText, () => `${+settings.dotSpeed.toPrecision(2)}×`, (text) => {
      const v = parseSI(text.trim().replace(/\s*(×|x)$/i, ""));
      if (!(v > 0)) return false;
      updateSettings({ dotSpeed: Math.min(DOT_MAX, Math.max(DOT_MIN, v)) });
      current.slider.set(Math.log10(settings.dotSpeed));
      this.showSpeeds();
      return true;
    }, "Set marker speed from 0.1× to 5×");
    setTip(current.row, "Set animation speed. The largest current sets the reference speed; smaller currents move proportionally slower.");
    sim.append(speed.row, current.row, this.currentDirection());
    this.showSpeeds();

    const circuit = this.sections.create("Circuit", "circuit");
    const row = (label: string, value: string, rename?: RenameOptions) => {
      const r = createRow(label, value, document, rename);
      circuit.append(r);
      return r.querySelector<HTMLElement>(".value")!;
    };
    const name = row("Name", this.host.circuitName(), this.host.circuitName() ? {
      label: "Circuit name",
      current: () => this.host.circuitName(),
      validate: (text) => this.host.circuitNameProblem(text),
      apply: (text) => { this.host.renameCircuit(text); name.textContent = this.host.circuitName(); },
      onError: (message) => this.host.report("error", message),
    } : undefined);
    this.timeText = row("Time", "0 s");
    // solver: NodeForge's error-controlled steps, or CircuitJS's fixed ones (app settings)
    const solver = this.choiceField("Solver", [["nodeforge", "NodeForge"], ["circuitjs", "CircuitJS"]], settings.solver, (v) => {
      updateSettings({ solver: v as "nodeforge" | "circuitjs" });
      this.build();
    }, false);
    setTip(solver, "NodeForge controls the step by its error. CircuitJS uses fixed steps, as the original does.");
    circuit.append(solver);
    const accurate = settings.solver === "nodeforge";
    if (accurate) {
      const tol = this.choiceField("Relative tolerance", RELTOL_CHOICES.map(([v, t]) => [String(v), t]), String(settings.relTol), (v) => updateSettings({ relTol: Number(v) }), false);
      setTip(tol, "Set the solver's relative error tolerance. Smaller values require more computation.");
      circuit.append(tol);
    }
    // stored in °C; shown and typed in the app's unit (°C, °F or K; a typed suffix wins)
    const temperature = this.numberField("Temperature", model.circuit.options.temperature, "°C", (v) => {
      if (v > -273.15) model.setTemperature(v);
    }, true, { show: (c) => formatTemperature(c), parse: (text) => parseTemperature(text) });
    setTip(temperature, "Set the temperature of SPICE device models. CircuitJS models follow it in the NodeForge solver only.");
    circuit.append(temperature);
    const selfHeating = this.checkField("Self-heating", model.circuit.options.selfHeating, (v) => model.setSelfHeating(v));
    setTip(selfHeating, "Heat devices by the power they dissipate. Applies to SPICE models with a thermal resistance (diode RTH0, VDMOS RTHJC).");
    circuit.append(selfHeating);
    if (accurate) {
      // the start-up ramp: sources rise from 0 over its time at the start of a run from rest
      const ramp = model.circuit.options.startupRamp;
      const rampOn = this.checkField("Start-up ramp", ramp > 0, (v) => {
        model.setStartupRamp(v ? DEFAULT_STARTUP_RAMP : 0);
        this.setModel(model);
      });
      setTip(rampOn, "Raise every source from 0 at the start of a run, as if switched on (not after an operating point).");
      circuit.append(rampOn);
      if (ramp > 0) {
        const rampTime = this.numberField("Ramp time", ramp, "s", (v) => {
          if (v > 0) model.setStartupRamp(v);
        });
        setTip(rampTime, "How long the sources take to reach their values.");
        circuit.append(rampTime);
      }
    }
    const step = this.numberField(accurate ? "Maximum time step" : "Time step", model.sim.maxTimeStep, "s", (v) => {
      if (!(v > 0)) return;
      model.setTimeStep(v);
      this.showSpeeds();
    });
    setTip(step, accurate
      ? "Limit the solver time step and set the recording interval."
      : "Set the time interval per calculation. Smaller steps require more computation.");
    this.recommendButton = createButton({ label: "Recommend settings…", onClick: () => this.host.run("sim.recommend") });
    this.setRecommendState(this.recommendState);
    const recommendRow = el("div", "buttons");
    recommendRow.append(this.recommendButton);
    circuit.append(step, recommendRow);
    this.partsText = row("Parts", "0");

    this.toleranceSection = this.sections.create("Tolerance", "tolerance");
    this.buildTolerance();

    this.adjust = this.sections.create("Adjust", "adjust");
    this.buildSliders();

    this.props = this.sections.create("Properties", "properties");
    this.props.hidden = true;

    const info = this.sections.create("Part under pointer", "pointer");
    this.infoTitle = info.firstElementChild!.lastElementChild as HTMLElement;
    this.infoBody = el("div", "info-lines");
    info.append(this.infoBody);
  }

  /** A labeled field for a number with SI prefixes, shown with its unit; commits on Enter or when focus leaves. */
  private numberField(label: string, value: number, unit: string, commit: (v: number) => void, undoable = true, codec?: { show(v: number): string; parse(text: string): number }): HTMLElement {
    let current = value;
    const field = createUnitField({
      label, unit, value,
      format: (v, u) => (codec ? codec.show(v) : showValue(v, u)),
      parse: (text, u) => (codec ? codec.parse(text) : parseSI(text, u)),
      apply: (v) => {
        // (a value typed in another form, such as 1k for 1 kΩ, is not a change)
        if (v === current) return;
        if (undoable) this.host.edit(() => commit(v));
        else commit(v);
        current = v;
      },
      reportError: (message) => this.host.report("error", message),
      invalidMessage: `Invalid ${label.toLowerCase()}. Enter a number${unit ? ` in ${unit}` : ""}.`,
    });
    return field.row;
  }

  private choiceField(label: string, options: [string, string][], selected: string, commit: (v: string) => void, undoable = true): HTMLElement {
    const select = el("select");
    for (const [value, text] of options) {
      const o = el("option", "", text);
      o.value = value;
      o.selected = value === selected;
      select.append(o);
    }
    select.addEventListener("change", () => (undoable ? this.host.edit(() => commit(select.value)) : commit(select.value)));
    return createField(label, select);
  }

  private checkField(label: string, checked: boolean, commit: (v: boolean) => void, undoable = true): HTMLElement {
    const r = el("label", "field check");
    const box = el("input");
    box.type = "checkbox";
    box.checked = checked;
    box.addEventListener("change", () => (undoable ? this.host.edit(() => commit(box.checked)) : commit(box.checked)));
    r.append(box, el("span", "label", label));
    return r;
  }

  private textField(label: string, value: string, commit: (v: string) => void): HTMLElement {
    const input = el("input");
    input.type = "text";
    input.spellcheck = false;
    input.value = value;
    const done = () => {
      if (input.value !== value) this.host.edit(() => commit(input.value));
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") done();
      else if (e.key === "Escape") {
        input.value = value;
        input.blur();
      }
    });
    input.addEventListener("change", done);
    return createField(label, input);
  }

  private textAreaField(label: string, value: string, commit: (v: string) => void): HTMLElement {
    const area = el("textarea");
    area.spellcheck = false;
    area.rows = Math.min(10, Math.max(3, value.split("\n").length + 1));
    area.value = value;
    area.addEventListener("change", () => {
      if (area.value !== value) this.host.edit(() => commit(area.value));
    });
    const r = createField(label, area);
    r.classList.add("area");
    return r;
  }

  private fileField(label: string, accept: string, load: (f: File) => void): HTMLElement {
    const input = el("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", () => {
      const f = input.files?.[0];
      if (f) load(f);
    });
    return createField(label, input);
  }

  /** A data or audio file for an input part: read (and decode) it, then hand it over. */
  private loadPartFile(e: CircuitElm, f: File): void {
    if (e instanceof DataInputElm) {
      f.text().then((t) => this.host.edit(() => {
        if (!e.loadData(t, f.name)) this.showError("Expected one number per line (lines starting with # are comments).");
      }));
    } else if (e instanceof AudioInputElm) {
      f.arrayBuffer()
        .then((buf) => new AudioContext().decodeAudioData(buf))
        .then((audio) => this.host.edit(() => e.loadAudio(audio.getChannelData(0), audio.sampleRate, f.name)))
        .catch(() => this.showError("Couldn't read that audio file."));
    }
  }

  /** A property that couldn't be set: to the Messages log, so the panel keeps its size. */
  private showError(msg: string | null): void {
    if (msg) this.host.report("error", msg);
  }

  /** One property field. Fields that change which properties exist rebuild the section. */
  private editField(e: CircuitElm, n: number, ei: EditInfo, pres: FieldPresentation): HTMLElement {
    const field = this.editFieldBare(e, n, ei, pres);
    if (pres.hint) setTip(field, pres.hint);
    return field;
  }

  private editFieldBare(e: CircuitElm, n: number, ei: EditInfo, pres: FieldPresentation): HTMLElement {
    const input = (o: Partial<EditInput>): EditInput => ({ value: ei.value, checked: ei.checked, selected: ei.selected, text: ei.text, ...o });
    const apply = (o: Partial<EditInput>, rebuild: boolean) => {
      let err = setEditInput(e, n, input(o)) ?? null;
      // a number the part didn't take (out of its range, not a whole number…): say so, rather than
      // the field just going back to what it was
      if (!err && o.value !== undefined) {
        const back = getEditInfo(e, n);
        if (back && back.name === ei.name && !(Math.abs(back.value - o.value) <= 1e-9 * Math.abs(o.value) + 1e-15)) {
          const why = ei.positive && o.value <= 0 ? ", it must be more than 0" : ei.nonNegative && o.value < 0 ? ", it can't be negative" : "";
          err = `${pres.label}: ${showValue(o.value, pres.unit)} isn't accepted${why} (kept ${showValue(back.value, pres.unit)})`;
        }
      }
      this.showError(err);
      if (rebuild) queueMicrotask(() => this.buildProperties(e));
    };
    switch (ei.kind) {
      case "check":
        return this.checkField(pres.label, ei.checked, (v) => apply({ checked: v }, true));
      case "choice":
        return this.choiceField(pres.label, ei.choices.map((c, i) => [String(i), presentChoice(c, ei.name)]), String(ei.selected), (v) => apply({ selected: Number(v) }, true));
      case "text":
        return this.textField(pres.label, ei.text, (v) => apply({ text: v }, true));
      case "textarea":
        return this.textAreaField(pres.label, ei.text, (v) => apply({ text: v }, true));
      case "file":
        return this.fileField(pres.label, ei.text, (f) => this.loadPartFile(e, f));
      default:
        return this.numberField(pres.label, ei.value, pres.unit, (v) => apply({ value: v }, true));
    }
  }

  /** The editable properties of the selected part (CircuitJS's Edit dialog). */
  private buildProperties(e: CircuitElm | null): void {
    this.propsFor = e;
    const body = this.props;
    body.replaceChildren(body.firstElementChild!);
    body.hidden = !e || (e instanceof WireElm && !editInfos(e).length);
    if (!e) return;
    if (e instanceof PlaceholderElm) {
      body.append(el("div", "muted", "This component is unsupported. Properties are unavailable."));
      return;
    }
    const fields: HTMLElement[] = [];
    // electrical properties first; display options (shown values, symbols, labels) under Display
    const display: HTMLElement[] = [];
    // a diode or MOSFET: one model, CircuitJS's own or one from the library
    const spiceKind = spiceModelKind(e);
    const spice = spiceKind ? spiceModelOf(e) : null;
    for (const [n, ei] of editInfos(e)) {
      if (isLegacySymbolField(ei) || isCoveredByLabels(e, ei)) continue;
      // A single wire has current/voltage labels; a bus has decimal/hex bit values.
      if (e instanceof WireElm && (e.busWidth > 1 ? n < 2 : n >= 2)) continue;
      const pres = presentField(e, ei, unitForEditName);
      const isModel = ei.kind === "choice" && ei.name === "Model";
      if (spiceKind && isModel) {
        fields.push(...this.modelFields(e, spiceKind));
        continue;
      }
      // a transistor on a library or custom model takes its gain from the model's BF
      if (spiceKind === "bjt" && spice && ei.name === "Beta/hFE") continue;
      const f = this.editField(e, n, ei, pres);
      // a choice that decides which other properties exist (waveform, type) comes first
      if (/^(Waveform|Type)$/.test(pres.label)) fields.unshift(f);
      else (pres.display ? display : fields).push(f);
    }
    // tolerances: this part's own, or its type's default (a library MOSFET's: its model's threshold and gain)
    for (const p of toleranceParams(e)) {
      const field = this.numberField(p.label, tolerancePercent(e, p), "%", (v) => {
        if (!(v >= 0)) return;
        const own = { ...(e.tolerance ?? {}) };
        if (v === DEFAULT_TOLERANCES[p.kind]) delete own[p.kind];
        else own[p.kind] = v;
        e.tolerance = Object.keys(own).length ? own : null;
        this.model.toleranceChanged();
      });
      setTip(field, `Variation from the nominal value (default ± ${DEFAULT_TOLERANCES[p.kind]}%)${this.model.tolerance.enabled ? "" : ". Enable component variation in Tolerance to apply it"}`);
      fields.push(field);
    }
    // a library power MOSFET with a thermal model: its heatsink (case to ambient), free air by default
    const freeAir = e instanceof SpiceMosfetElm ? e.freeAirRthca() : null;
    if (e instanceof SpiceMosfetElm && freeAir !== null) {
      const field = this.numberField("Heatsink", e.heatsink ?? freeAir, "°C/W", (v) => {
        if (!(v > 0)) return;
        e.heatsink = v === freeAir ? null : v;
        this.model.toleranceChanged();
      });
      setTip(field, `Thermal resistance from the case to ambient, mounting included (free air: ${showValue(freeAir, "°C/W")})${this.model.circuit.options.selfHeating ? "" : ". Enable Self-heating in Circuit to apply it"}`);
      fields.push(field);
    }
    // a part that takes power: counted as the circuit's output when marked (the power report)
    if (takesPower(e)) {
      const load = this.checkField("Load", e.powerLoad, (v) => (e.powerLoad = v));
      setTip(load, "Count this part's power as the circuit's output (power report efficiency).");
      fields.push(load);
    }
    if (display.length) fields.push(el("div", "subhead", "Display"), ...display);
    if (sliderFields(e).length) fields.push(...this.sliderConfiguration(e));
    if (!fields.length) fields.push(el("div", "muted", "No editable properties."));
    body.append(...fields);
  }

  /** Configure a selected part's adjustable property; the live dial remains in Adjust. */
  private sliderConfiguration(e: CircuitElm): HTMLElement[] {
    const fields = sliderFields(e);
    const heading = el("button", "subhead subhead-toggle");
    heading.type = "button";
    heading.innerHTML = SECTION_CHEVRON;
    heading.append(el("span", "", "Slider"));
    heading.setAttribute("aria-controls", "slider-config-fields");
    const content = el("div", "slider-config-content");
    content.id = "slider-config-fields";
    const setOpen = (open: boolean) => {
      const changed = this.sliderConfigOpen !== open;
      this.sliderConfigOpen = open;
      heading.setAttribute("aria-expanded", String(open));
      content.hidden = !open;
      if (changed) updateSettings({ sliderConfigExpanded: open });
    };
    heading.addEventListener("click", () => setOpen(!this.sliderConfigOpen));
    setOpen(this.sliderConfigOpen);
    const property = el("select");
    for (const field of fields) {
      const option = el("option", "", field.name);
      option.value = String(field.index);
      property.append(option);
    }
    const chooser = createField("Property", property);
    const inputs = ["Minimum", "Maximum", "Value", "Step"].map((label) => {
      const input = el("input");
      input.type = "text";
      input.spellcheck = false;
      input.setAttribute("aria-label", `Slider ${label.toLowerCase()}`);
      return { row: createField(label, input), input };
    });
    const actions = el("div", "buttons");
    const save = createButton({ label: "Add slider" });
    const remove = createButton({ label: "Remove" });
    actions.append(save, remove);
    const selected = () => fields.find((field) => field.index === Number(property.value))!;
    const populate = () => {
      const field = selected(), slider = sliderFor(this.model, e, field.index);
      const span = Math.max(Math.abs(field.value), 1e-9);
      const min = slider?.adj.minValue ?? (field.positive ? Math.max(span / 10, Number.MIN_VALUE) : field.nonNegative ? 0 : field.value - span);
      const max = slider?.adj.maxValue ?? (field.value > 0 ? field.value * 2 : field.value + span);
      const values = [min, max, field.value, slider?.adj.step ?? 0];
      inputs.forEach(({ input }, index) => { input.value = showValue(values[index], field.unit); });
      save.textContent = slider ? "Update slider" : "Add slider";
      remove.hidden = !slider;
    };
    property.addEventListener("change", populate);
    save.addEventListener("click", () => {
      let before: ReturnType<SimulationModel["snapshot"]> | null = null;
      try {
        const field = selected();
        const [min, max, value, step] = sliderNumbers(field, inputs.map(({ input }) => input.value));
        before = this.model.snapshot();
        this.host.edit(() => configureSlider(this.model, e, field, min, max, value, step));
        setSectionOpen("adjust", true);
        this.applySections();
        this.buildSliders();
        this.buildProperties(e);
      } catch (error) {
        if (before) {
          this.model.restore(before);
          this.buildSliders();
          this.buildProperties(this.model.selected);
        }
        this.showError((error as Error).message);
      }
    });
    remove.addEventListener("click", () => {
      try {
        const field = selected();
        this.host.edit(() => removeSlider(this.model, e, field));
        this.buildSliders();
        this.buildProperties(e);
      } catch (error) { this.showError((error as Error).message); }
    });
    populate();
    content.append(chooser, ...inputs.map(({ row }) => row), actions);
    return [heading, content];
  }

  /**
   * A diode's, MOSFET's, JFET's or transistor's model: one list, Custom first, then every model (the library's, CircuitJS's,
   * the circuit's own). On Custom the part has a model of its own, and its parameters are
   * properties under it, dialled like a resistor's resistance.
   */
  private modelFields(e: CircuitElm, kind: SpiceModelKind): HTMLElement[] {
    const part = e as CircuitElm & { modelName: string; spiceProblem?: string | null; spiceWarnings?: string[] };
    const pnp = spicePolarity(e);
    const library = modelLibrary.forPart(kind, pnp);
    const circuitJS = modelLibrary.circuitJS(kind, pnp);
    const libName = spiceModelOf(e);
    const custom = this.model.isCustomModel(e);
    const current = custom ? "custom" : libName ? `lib:${libName}` : `cjs:${part.modelName}`;

    // Custom, then the models by manufacturer: CircuitJS's own, Generic (NodeForge's), the makers
    // of imported parts alphabetically, then any without one
    const select = el("select");
    const option = (value: string, text: string, parent: HTMLElement) => {
      const o = el("option", "", text);
      o.value = value;
      o.selected = value === current;
      parent.append(o);
    };
    option("custom", "Custom", select);
    const groups = new Map<string, [string, string][]>();
    const add = (maker: string | undefined, value: string, text: string) => {
      const k = maker || "Other";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push([value, text]);
    };
    for (const m of circuitJS) add("CircuitJS", `cjs:${m.name}`, displayName(m));
    for (const m of library) add(m.manufacturer, `lib:${m.name}`, displayName(m));
    if (libName && !custom && !library.some((m) => m.name.toLowerCase() === libName.toLowerCase())) {
      add(modelLibrary.describe(libName)?.manufacturer, `lib:${libName}`, modelLabel(libName));
    }
    const rank = (k: string) => (k === "CircuitJS" ? 0 : k === "Generic" ? 1 : k === "Other" ? 3 : 2);
    for (const k of [...groups.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))) {
      const g = el("optgroup");
      g.label = k;
      for (const [value, text] of groups.get(k)!.sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }))) option(value, text, g);
      select.append(g);
    }
    select.addEventListener("change", () => {
      const v = select.value;
      this.host.edit(() => {
        if (v === "custom") this.model.useCustomModel(e);
        else if (v.startsWith("cjs:")) this.model.useCircuitJSModel(e, v.slice(4));
        else this.model.setSpiceModel(e, v.slice(4));
      });
    });
    const field = createField("Model", select);
    // what the model is and how it was checked
    const entry = custom ? null : libName ? modelLibrary.describe(libName) : circuitJS.find((m) => m.name === part.modelName) ?? null;
    if (entry) {
      const about = [[KIND_LABELS[entry.kind], entry.manufacturer, ...Object.entries(entry.specs).slice(0, 5).map(([k, v]) => `${k} ${v}`)].filter(Boolean).join("\n")];
      if (entry.check) about.push(entry.check.error === null ? `Not checked: ${entry.check.note ?? ""}` : `Matches ngspice within ${checkPercent(entry.check.error)}${entry.check.note ?? ""}`);
      setTip(field, about.join("\n"));
    } else if (custom) setTip(field, "Edit this component's model parameters below.");
    const out: HTMLElement[] = [field];

    // the model's parameters: dialled on a custom model, shown greyed out on any other (a
    // subcircuit has none to show)
    const card = this.model.modelCard(e);
    if (card) {
      for (const p of modelParams(card.type, pnp)) {
        const value = card.params.get(p.key) ?? p.def;
        const f = this.numberField(p.label, value, p.unit, (v) => this.model.setCustomParam(e, p.key, p.zeroIsNone && v === 0 ? null : v));
        setTip(f, `SPICE ${p.key.toUpperCase()}${p.zeroIsNone ? " (0: none)" : ""}${custom ? "" : ". Choose Custom to edit this parameter"}`);
        if (!custom) {
          f.classList.add("disabled");
          f.querySelector("input")!.disabled = true;
        }
        out.push(f);
      }
    }

    // a custom model can be kept: saved to the library under a name, and the part put on it
    if (custom && card) {
      const name = el("input");
      name.type = "text";
      name.spellcheck = false;
      name.placeholder = "Model name";
      const nameField = createField("Library name", name);
      setTip(nameField, "Name this custom model to save it to your model library.");
      const save = createButton({ label: "Save to library" });
      save.addEventListener("click", async () => {
        const problem = await saveCustomModel(card, name.value.trim());
        if (problem) {
          this.host.report("error", problem);
          return;
        }
        this.host.edit(() => this.model.setSpiceModel(e, name.value.trim()));
      });
      const row = el("div", "buttons");
      row.append(save);
      out.push(nameField, row);
    }

    // its problems and warnings are in the Messages log (and its badge on the schematic)
    return out;
  }

  /** The Adjust section: the circuit's sliders, then the sliders parts have of their own. */
  private buildSliders(): void {
    const { model } = this;
    const adjust = this.adjust;
    adjust.replaceChildren(adjust.firstElementChild!);
    this.sliderTexts = [];
    this.partSliders = [];
    for (const s of model.sliders) {
      const field = sliderFields(s.elm).find((f) => f.index === s.adj.editItem);
      const unit = field?.unit ?? "";
      const labels = [
        { value: 0, text: showValue(s.adj.minValue, unit) },
        { value: 100, text: showValue(s.adj.maxValue, unit) },
      ];
      const r = sliderRow(s.adj.label || "Value", s.position, 0, 100, (v) => {
        model.setSlider(s, v);
        r.valueText.textContent = model.sliderValueText(s);
      }, true, [{ value: 0, tick: "major" }, { value: 100, tick: "major" }], { labels, undo: this.sliderUndo() });
      r.valueText.textContent = model.sliderValueText(s);
      if (field) editableValue(r.valueText, () => model.sliderValueText(s), (text) => {
        const value = parseSI(text, unit);
        if (!Number.isFinite(value) || value < s.adj.minValue || value > s.adj.maxValue) return false;
        const position = adjustablePosition(s.adj, value);
        this.host.edit(() => model.setSlider(s, position));
        r.slider.set(position);
        r.valueText.textContent = model.sliderValueText(s);
        return true;
      }, `Enter ${field.name} from ${labels[0].text} to ${labels[1].text}`);
      this.sliderTexts.push([s, r.valueText]);
      adjust.append(r.row);
    }
    for (const e of model.circuit.elements) {
      const ps = e.partSlider();
      if (!ps) continue;
      const des = model.designator(e);
      const r = sliderRow(des ? `${ps.label} (${des})` : ps.label, ps.value, 0, 100, (v) => {
        e.partSlider()?.set(v);
        model.partSliderMoved();
      }, true, [], { undo: this.sliderUndo() });
      this.partSliders.push([e, r.valueText]);
      adjust.append(r.row);
    }
    adjust.hidden = this.sliderTexts.length + this.partSliders.length === 0;
  }

  /** Undo for a slider of the circuit's: each drag or step one change. */
  private sliderUndo(): SliderExtras["undo"] {
    return { begin: () => this.host.beginChange(), end: () => this.host.endChange() };
  }

  /** Focus the first field of the properties (double-click on a part). */
  focusProperties(): void {
    setSectionOpen("properties", true);
    this.applySections();
    this.buildProperties(this.model.selected);
    const f = this.props.querySelector("input:not(:disabled), select:not(:disabled), textarea:not(:disabled)") as HTMLElement | null;
    f?.focus();
    if (f instanceof HTMLInputElement) f.select();
  }

  /** The selection changed or the part was edited elsewhere (undo): show its current values. */
  refreshProperties(force = false): void {
    const sel = this.model.selected;
    if (force || sel !== this.propsFor) {
      if (!force && this.props.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
      this.buildProperties(sel);
    }
  }

  /** Refresh the live values (called a few times per second). */
  update(time: string, focusLines: string[], pinned: boolean): void {
    const { model } = this;
    this.runButton.innerHTML = `${model.running ? actionIcons.stop : actionIcons.play}<span>${model.running ? "Pause" : "Run"}</span>`;
    this.stepButton.disabled = model.running;
    this.showSpeeds();
    this.timeText.textContent = time;
    this.partsText.textContent = String(model.circuit.elements.filter((e) => !(e instanceof WireElm)).length);
    for (const [s, t] of this.sliderTexts) t.textContent = model.sliderValueText(s);
    const owners = model.circuit.elements.filter((e) => e.partSlider());
    if (owners.length !== this.partSliders.length || owners.some((e, i) => this.partSliders[i][0] !== e)) this.buildSliders();
    for (const [e, t] of this.partSliders) t.textContent = e.partSlider()?.valueText ?? "";
    this.refreshProperties();
    this.infoTitle.textContent = pinned ? "Selected part" : "Part under pointer";
    const key = focusLines.join("\n");
    if (this.infoBody.dataset.key === key) return;
    this.infoBody.dataset.key = key;
    this.infoBody.replaceChildren();
    if (!focusLines.length) {
      const n = model.selection.size;
      this.infoBody.append(el("span", "muted", n > 1 ? `${n} parts selected` : "Hover or click a part"));
      return;
    }
    focusLines.forEach((l, i) => this.infoBody.append(el("span", i === 0 ? "first" : "", l)));
  }
}
