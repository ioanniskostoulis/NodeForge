// Console edits use the same property names and setters as the inspector.
// Licensed under the GNU General Public License v2 or later. See LICENSE.
import { editInfos, getEditInfo, setEditInput, type CircuitElm, type EditInfo, type EditInput, spiceModelKind, spicePolarity, SpiceMosfetElm, WireElm, GroundElm } from "../engine";
import { type FieldPresentation, isCoveredByLabels, isLegacySymbolField, presentField, presentChoice, PROPERTY_SYMBOLS, takesPower } from "./properties";
import { parseSI } from "./format";
import { type SimulationModel, unitForEditName } from "./model";
import { displayName } from "./model-catalog";
import { modelParams } from "./model-params";
import { modelLibrary } from "./model-library";
import { DEFAULT_TOLERANCES, toleranceParams } from "./tolerance";

const normalized = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
export function partsForList(model: SimulationModel, filter = ""): CircuitElm[] {
  return model.circuit.elements.filter((e) => model.designator(e) !== null && !(e instanceof WireElm || e instanceof GroundElm) && (!filter || model.kindName(e).toLowerCase().includes(filter.toLowerCase())));
}
export function partNamed(model: SimulationModel, name: string): CircuitElm {
  const e = model.circuit.elements.find((e) => model.designator(e)?.toLowerCase() === name.toLowerCase());
  if (!e) throw new Error(`${name}: no such part`);
  return e;
}

/** One property the console can set: the inspector's label, other names for it, and the change. */
interface Settable {
  label: string;
  symbols: string[];
  /** The part's main value, set by `set PART value` alone. */
  main?: boolean;
  prepare(raw: string): () => void;
}

/** Names compared loosely: case, spaces and punctuation don't matter; Greek letters do (β, φ, Δ). */
const loose = (s: string) => s.toLowerCase().replace(/[^a-z0-9βφδμ]/g, "") + (/[+-]$/.test(s.trim()) ? s.trim().slice(-1) : "");

/**
 * Every property the inspector shows for a part, as the console sets it: the part's own fields
 * (CircuitJS's Edit dialog), its model (a diode, MOSFET, transistor or JFET), each tolerance, a
 * library power MOSFET's heatsink, Load, and a custom model's parameters. `model` is needed for
 * the model, the tolerances' and heatsink's effect, and custom parameters; without it (a parameter
 * sweep's copy) only the part's own fields, tolerances, heatsink and Load are offered.
 */
export function settableProperties(e: CircuitElm, model?: SimulationModel): Settable[] {
  const out: Settable[] = [];
  const fields = editInfos(e).filter(([, info]) => !isLegacySymbolField(info) && !isCoveredByLabels(e, info));
  const kind = spiceModelKind(e);
  let mainTaken = false;
  for (const [index, info] of fields) {
    const presentation = presentField(e, info, unitForEditName);
    // the model: chosen as the inspector's Model list does (by name, or custom)
    if (kind && info.kind === "choice" && info.name === "Model") {
      if (model) out.push({ label: "Model", symbols: [], prepare: (raw) => prepareModel(model, e, [raw]) });
      continue;
    }
    const main = !mainTaken && info.kind === "number" && !presentation.display;
    if (main) mainTaken = true;
    out.push({ label: presentation.label, symbols: PROPERTY_SYMBOLS[presentation.label] ?? [], main, prepare: (raw) => prepareField(e, index, info, presentation, raw) });
  }
  // tolerances: ΔR, ΔVt, Δβ… in percent; the type's default clears the part's own
  for (const p of toleranceParams(e)) {
    out.push({ label: p.label, symbols: [`Δ${p.symbol}`, `${p.symbol} tolerance`, ...(p.symbol === "β" ? ["Δbeta", "beta tolerance"] : [])], prepare: (raw) => {
      const v = Number(raw.replace(/%$/, ""));
      if (!Number.isFinite(v) || v < 0 || v > 100) throw new Error(`${p.label}: use a percentage from 0 to 100`);
      return () => {
        const own = { ...(e.tolerance ?? {}) };
        if (v === DEFAULT_TOLERANCES[p.kind]) delete own[p.kind];
        else own[p.kind] = v;
        e.tolerance = Object.keys(own).length ? own : null;
        model?.toleranceChanged();
      };
    } });
  }
  // a library power MOSFET with a thermal model: its heatsink in °C/W (free air clears it)
  const freeAir = e instanceof SpiceMosfetElm ? e.freeAirRthca() : null;
  if (e instanceof SpiceMosfetElm && freeAir !== null) {
    out.push({ label: "Heatsink", symbols: PROPERTY_SYMBOLS.Heatsink, prepare: (raw) => {
      const v = parseSI(raw, "°C/W");
      if (!(v > 0)) throw new Error("Heatsink: use a thermal resistance above 0 °C/W");
      return () => { e.heatsink = v === freeAir ? null : v; model?.toleranceChanged(); };
    } });
  }
  if (takesPower(e)) {
    out.push({ label: "Load", symbols: [], prepare: (raw) => {
      if (!/^(on|off)$/i.test(raw)) throw new Error("Load: use on or off");
      return () => { e.powerLoad = raw.toLowerCase() === "on"; };
    } });
  }
  // a custom model's parameters, by their label or SPICE name (Threshold or vto)
  const card = model?.isCustomModel(e) ? model.modelCard(e) : null;
  if (model && card) {
    for (const param of modelParams(card.type, spicePolarity(e))) {
      out.push({ label: param.label, symbols: [param.key], prepare: (raw) => prepareModel(model, e, [param.key, raw]) });
    }
  }
  return out;
}

/** A label with its symbols, as lists show it: "Beta tolerance (Δβ)". */
export const settableName = (p: Settable) => p.symbols.length ? `${p.label} (${p.symbols[0]})` : p.label;

/** Prepare before opening an undo transaction; reject malformed values without dirtying the sheet. */
export function prepareProperty(e: CircuitElm, words: string[], model?: SimulationModel): () => void {
  const props = settableProperties(e, model);
  const key = loose(words.slice(0, -1).join(" "));
  const prop = words.length === 1 ? props.find((p) => p.main)
    : props.find((p) => loose(p.label) === key) ?? props.find((p) => p.symbols.some((s) => loose(s) === key));
  if (!prop) throw new Error(`Property not found. Available: ${props.map(settableName).join(", ")}. Quote multi-word values.`);
  return prop.prepare(words.at(-1)!);
}

/** One of the part's own fields (CircuitJS's Edit dialog), set as its inspector field does. */
function prepareField(e: CircuitElm, index: number, info: EditInfo, presentation: FieldPresentation, raw: string): () => void {
  const input: EditInput = { value: info.value, text: info.text, checked: info.checked, selected: info.selected };
  if (info.kind === "number") {
    input.value = parseSI(raw, presentation.unit);
    if (!Number.isFinite(input.value) || (info.positive && input.value <= 0) || (info.nonNegative && input.value < 0)) throw new Error(`${presentation.label}: invalid value`);
  } else if (info.kind === "check") {
    if (!/^(on|off)$/.test(raw)) throw new Error(`${presentation.label}: use on or off`);
    input.checked = raw === "on";
  } else if (info.kind === "choice") {
    input.selected = info.choices.findIndex((v) => normalized(v) === normalized(raw) || normalized(presentChoice(v, info.name)) === normalized(raw));
    if (input.selected < 0) throw new Error(`Choose: ${info.choices.map((v) => presentChoice(v, info.name)).join(", ")}`);
  } else if (info.kind === "file") throw new Error("Use the inspector's file picker for this property.");
  else input.text = raw.replace(/\\n/g, "\n");
  return () => {
    const error = setEditInput(e, index, input);
    if (error) throw new Error(error);
    if (info.kind === "number") {
      const back = getEditInfo(e, index);
      if (back && Math.abs(back.value - input.value) > Math.abs(input.value) * 1e-9 + 1e-15) throw new Error(`${presentation.label}: value rejected by this part`);
    }
  };
}

export function prepareModel(model: SimulationModel, e: CircuitElm, words: string[]): () => void {
  const kind = spiceModelKind(e);
  if (!kind) throw new Error("This part does not support library models yet.");
  if (words.length === 1) {
    const name = words[0];
    if (name === "custom") return () => model.useCustomModel(e);
    const pnp = spicePolarity(e);
    const compatible = [...modelLibrary.forPart(kind, pnp), ...modelLibrary.circuitJS(kind, pnp)];
    // by its SPICE name or the name the Model list shows (GEN_J310 or J310)
    const entry = compatible.find((m) => [m.name, displayName(m)].some((v) => v.toLowerCase() === name.toLowerCase()));
    if (!entry) throw new Error(`${name}: not a compatible model; use models to list the library`);
    return () => entry.circuitJS ? model.useCircuitJSModel(e, entry.name) : void model.setSpiceModel(e, entry.name);
  }
  if (words.length !== 2 || !model.isCustomModel(e)) throw new Error("Use model PART custom before editing parameters.");
  const card = model.modelCard(e);
  const param = card && modelParams(card.type, spicePolarity(e)).find((p) => p.key === words[0].toLowerCase());
  if (!param) throw new Error("Unknown custom model parameter.");
  const value = parseSI(words[1], param.unit);
  if (!Number.isFinite(value)) throw new Error("Model parameter must be a finite number.");
  return () => model.setCustomParam(e, param.key, value === 0 && param.zeroIsNone ? null : value);
}

export function prepareTolerance(e: CircuitElm, raw: string): () => void {
  const params = toleranceParams(e);
  const value = Number(raw.replace(/%$/, ""));
  if (!params.length) throw new Error("This part/model has no supported tolerance parameters.");
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error("Tolerance must be from 0% to 100%.");
  return () => { e.tolerance = { ...e.tolerance, ...Object.fromEntries(params.map((p) => [p.kind, value])) }; };
}

/** Shell-like quoting for names and paths, without shell expansion or execution. */
export function tokenizeConsole(line: string): string[] {
  const words: string[] = [];
  let word = "", quote = "", started = false;
  for (const c of line.trim()) {
    if (quote) { if (c === quote) quote = ""; else word += c; started = true; }
    else if (c === '"' || c === "'") { quote = c; started = true; }
    else if (/\s/.test(c)) { if (started) { words.push(word); word = ""; started = false; } }
    else { word += c; started = true; }
  }
  if (quote) throw new Error("Unclosed quote.");
  if (started) words.push(word);
  return words;
}
