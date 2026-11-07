// The .nfg file format: NodeForge's own circuit file, a JSON document (documentation/FILE_FORMAT.md).
// It holds what the CircuitJS XML format holds, under names (settings, parts, models, scopes,
// sliders), so a file reads on its own and diffs line by line. This module is the format itself;
// writer.ts (writeNfg) and circuit.ts (Circuit.parse) connect it to a circuit.
// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { Adjustable, CircuitOptions, ScopeSpec } from "./circuit";
import { classForXmlTag } from "./registry";
import { CircuitParseError, XmlNode } from "./tokens";

/** The schema version this build writes. Files with a higher one still open (what it knows is read). */
export const NFG_VERSION = 1;
export const NFG_FORMAT = "nodeforge";

/** Does the text look like an .nfg file (JSON) rather than CircuitJS text or XML? */
export function isNfgText(text: string): boolean {
  return text.trimStart().startsWith("{");
}

/** What a file holds, ready to be put into a circuit. */
export interface NfgContents {
  options: Partial<CircuitOptions>;
  /** Root elements as the XML reader takes them: models first, then parts, in file order. */
  nodes: XmlNode[];
  scopes: ScopeSpec[];
  adjustables: Adjustable[];
  meta: Record<string, unknown>;
  /** Top-level keys this build doesn't know (kept, so saving doesn't drop them). */
  extra: Record<string, unknown>;
  /** The file was saved by a newer schema. */
  newer: boolean;
}

/** What goes into a file. */
export interface NfgInput {
  meta: Record<string, unknown>;
  options: CircuitOptions;
  models: XmlNode[];
  parts: XmlNode[];
  scopes: ScopeSpec[];
  adjustables: Adjustable[];
  extra: Record<string, unknown>;
}

const KNOWN = new Set(["format", "version", "meta", "types", "engine", "display", "models", "parts", "scopes", "sliders"]);

/** Readable names for the model nodes of the XML format. */
const MODEL_NAMES: Record<string, string> = {
  dm: "diode-model", mm: "mosfet-model", tm: "transistor-model", rlm: "relay-model", ccm: "subcircuit-model", clm: "logic-model",
  nfmodel: "spice-model",
};

/** Root tags that are models, not parts. */
export const MODEL_TAGS = new Set(Object.keys(MODEL_NAMES));

/**
 * Names for the properties of the common parts, by XML tag (what the XML format calls them in
 * short). Any property not listed keeps its XML name; a name is only used when the part doesn't
 * already have a property of that name.
 */
const SOURCE_PROPERTIES = {
  wf: "waveform", fr: "frequency", maxv: "maxVoltage", bias: "bias", phaseShift: "phaseShift", dutyCycle: "dutyCycle",
  riseTime: "riseTime", ir: "internalResistance",
};
const PROPERTY_NAMES: Record<string, Record<string, string>> = {
  "*": { f: "flags" },
  r: { r: "resistance" },
  c: { c: "capacitance", iv: "initialVoltage", sr: "seriesResistance", vd: "voltage" },
  l: { l: "inductance", ic: "initialCurrent", i: "current", isat: "saturationCurrent" },
  v: SOURCE_PROPERTIES,
  R: SOURCE_PROPERTIES,
  VarRail: SOURCE_PROPERTIES,
};
const NAMES_TO_PROPERTIES = new Map<string, Map<string, string>>(
  Object.entries(PROPERTY_NAMES).map(([tag, names]) => [tag, new Map(Object.entries(names).map(([short, long]) => [long, short]))]),
);

/** The name a property is written under in a file for a part with this tag. */
function propertyName(tag: string, key: string, taken: Record<string, string>): string {
  const long = PROPERTY_NAMES[tag]?.[key] ?? PROPERTY_NAMES["*"][key];
  return long && !(long in taken) ? long : key;
}

/** The XML name of a property written as `key`. */
function xmlPropertyName(tag: string, key: string, attributes: Record<string, string>): string {
  const short = NAMES_TO_PROPERTIES.get(tag)?.get(key) ?? NAMES_TO_PROPERTIES.get("*")!.get(key);
  return short && !(short in attributes) ? short : key;
}

/** `DCVoltageElm` → `dc-voltage`. */
function kebab(className: string): string {
  return className.replace(/Elm$/, "").replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2").toLowerCase();
}

/** A number when the text is exactly how that number prints (so it comes back unchanged), else the text. */
function toValue(v: string): string | number {
  if (v === "") return v;
  const n = Number(v);
  return Number.isFinite(n) && String(n) === v ? n : v;
}

function fromValue(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
}

const POSITION = /^-?\d+( -?\d+)*$/;

function isPosition(v: string): boolean {
  return POSITION.test(v) && v.split(" ").every((t) => String(Number(t)) === t);
}

const finiteNumberOr = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const booleanOr = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;
const objectOrEmpty = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** The readable type for each tag in a file, and what to put in the file's `types` table. */
class TypeNames {
  readonly byTag = new Map<string, string>();
  private readonly taken = new Map<string, string>();

  name(tag: string): string {
    const known = this.byTag.get(tag);
    if (known) return known;
    const C = classForXmlTag(tag);
    let name = MODEL_NAMES[tag] ?? (C ? kebab(C.name) : tag);
    // two tags never share a name (a name that is taken falls back to the tag)
    if (this.taken.has(name) && this.taken.get(name) !== tag) name = tag;
    this.taken.set(name, tag);
    this.byTag.set(tag, name);
    return name;
  }

  /** The names that differ from their tag: name → tag. */
  get table(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [tag, name] of [...this.byTag].sort((a, b) => a[1].localeCompare(b[1]))) if (name !== tag) out[name] = tag;
    return out;
  }
}

function nodeToJson(n: XmlNode, names: TypeNames): Record<string, unknown> {
  const out: Record<string, unknown> = { type: names.name(n.tag) };
  const props: Record<string, string | number> = {};
  const first = Object.keys(n.attributes)[0];
  for (const [k, v] of Object.entries(n.attributes)) {
    // the position leads the part when it leads the attributes (otherwise it stays where it was, so the order is kept)
    if (k === "x" && k === first && isPosition(v)) out.at = v.split(" ").map(Number);
    else props[propertyName(n.tag, k, n.attributes)] = toValue(v);
  }
  if (Object.keys(props).length) out.props = props;
  if (n.children.length) {
    out.children = n.children.map((c) => nodeToJson(c, names));
    if (n.text.trim()) out.text = n.text;
  } else if (n.text !== "") out.text = n.text;
  return out;
}

/** A plain wire (no properties but its position and zero flags) is written as just its position. */
function wireToJson(n: XmlNode): number[] | null {
  const keys = Object.keys(n.attributes);
  if (n.tag !== "w" || n.children.length || n.text !== "" || keys.length !== 2 || keys[0] !== "x" || keys[1] !== "f" || n.attributes.f !== "0") return null;
  return isPosition(n.attributes.x) && n.attributes.x.split(" ").length === 4 ? n.attributes.x.split(" ").map(Number) : null;
}

function nodeFromJson(j: unknown, tags: Record<string, string>): XmlNode {
  if (Array.isArray(j)) {
    // a wire: its position
    const wire = new XmlNode("w", { x: j.map((v) => fromValue(v)).join(" "), f: "0" });
    return wire;
  }
  const o = objectOrEmpty(j);
  const type = typeof o.type === "string" ? o.type : "";
  if (!type) throw new CircuitParseError("a part without a type");
  const tag = Object.hasOwn(tags, type) ? tags[type] : type;
  const attributes: Record<string, string> = {};
  if (Array.isArray(o.at)) attributes.x = o.at.map((v) => fromValue(v)).join(" ");
  const props = objectOrEmpty(o.props);
  for (const [k, v] of Object.entries(props)) attributes[xmlPropertyName(tag, k, props as Record<string, string>)] = fromValue(v);
  const n = new XmlNode(tag, attributes);
  if (typeof o.text === "string") n.text = o.text;
  if (Array.isArray(o.children)) n.children = o.children.map((c) => nodeFromJson(c, tags));
  return n;
}

function optionsToJson(o: CircuitOptions): { engine: Record<string, unknown>; display: Record<string, unknown> } {
  const engine: Record<string, unknown> = {
    timeStep: o.maxTimeStep, minTimeStep: o.minTimeStep, speed: o.iterCount, solver: o.solverType,
    adjustTimeStep: o.adjustTimeStep, autoDCOnReset: o.autoDCOnReset, temperature: o.temperature, selfHeating: o.selfHeating,
    startupRamp: o.startupRamp,
  };
  if (o.tolerance) engine.tolerance = { on: o.tolerance.on, seed: o.tolerance.seed };
  return {
    engine,
    display: {
      dots: o.showDots, smallGrid: o.smallGrid, voltage: o.showVoltage, power: o.showPower, values: o.showValues,
      currentBar: o.currentBar, powerBar: o.powerBar, voltageRange: o.voltageRange,
    },
  };
}

function optionsFromJson(engineJson: unknown, displayJson: unknown): Partial<CircuitOptions> {
  const e = objectOrEmpty(engineJson), d = objectOrEmpty(displayJson);
  const o: Partial<CircuitOptions> = {};
  const set = <K extends keyof CircuitOptions>(key: K, value: CircuitOptions[K] | undefined) => {
    if (value !== undefined) o[key] = value;
  };
  const n = (src: Record<string, unknown>, k: string) => (typeof src[k] === "number" && Number.isFinite(src[k]) ? (src[k] as number) : undefined);
  const b = (src: Record<string, unknown>, k: string) => (typeof src[k] === "boolean" ? (src[k] as boolean) : undefined);
  set("maxTimeStep", n(e, "timeStep"));
  set("minTimeStep", n(e, "minTimeStep"));
  set("iterCount", n(e, "speed"));
  set("solverType", n(e, "solver"));
  set("adjustTimeStep", b(e, "adjustTimeStep"));
  set("autoDCOnReset", b(e, "autoDCOnReset"));
  set("temperature", n(e, "temperature"));
  set("selfHeating", b(e, "selfHeating"));
  const ramp = n(e, "startupRamp");
  if (ramp !== undefined) o.startupRamp = Math.max(0, ramp);
  if (e.tolerance && typeof e.tolerance === "object") {
    const t = objectOrEmpty(e.tolerance);
    o.tolerance = { on: booleanOr(t.on, false), seed: finiteNumberOr(t.seed, 1) };
  }
  set("showDots", b(d, "dots"));
  set("smallGrid", b(d, "smallGrid"));
  set("showVoltage", b(d, "voltage"));
  set("showPower", b(d, "power"));
  set("showValues", b(d, "values"));
  set("currentBar", n(d, "currentBar"));
  set("powerBar", n(d, "powerBar"));
  set("voltageRange", n(d, "voltageRange"));
  return o;
}

function scopeToJson(s: ScopeSpec): Record<string, unknown> {
  const out: Record<string, unknown> = {
    plots: s.plots.map((p) => ({ part: p.elementIndex, value: p.value })),
    speed: s.speed, voltage: s.showVoltage, current: s.showCurrent, position: s.position, flags: s.flags,
  };
  if (s.text) out.text = s.text;
  if (s.trigger) out.trigger = { edge: s.trigger.edge, trace: s.trigger.trace, level: s.trigger.level };
  if (s.math?.length) out.math = s.math.map((m) => ({ op: m.op, a: m.a, b: m.b }));
  if (s.measures?.length) out.measures = s.measures;
  if (s.view) out.view = s.view;
  if (s.expr?.length) out.expressions = s.expr.map((e) => ({ position: e.position, text: e.text }));
  if (s.exprOnly) out.expressionsOnly = true;
  return out;
}

function scopeFromJson(j: unknown): ScopeSpec | null {
  const o = objectOrEmpty(j);
  if (!Array.isArray(o.plots)) return null;
  const plots = o.plots.map((p) => ({ elementIndex: finiteNumberOr(objectOrEmpty(p).part, -1), value: finiteNumberOr(objectOrEmpty(p).value, 0) })).filter((p) => p.elementIndex >= 0);
  if (!plots.length) return null;
  const spec: ScopeSpec = {
    plots, speed: finiteNumberOr(o.speed, 64), showVoltage: booleanOr(o.voltage, true), showCurrent: booleanOr(o.current, false), position: finiteNumberOr(o.position, 0),
    text: typeof o.text === "string" ? o.text : null, flags: finiteNumberOr(o.flags, 0),
  };
  const t = objectOrEmpty(o.trigger);
  if (o.trigger && (t.edge === 0 || t.edge === 1 || t.edge === -1)) {
    spec.trigger = { edge: t.edge, trace: finiteNumberOr(t.trace, 0), level: typeof t.level === "number" && Number.isFinite(t.level) ? t.level : null };
  }
  if (Array.isArray(o.math)) {
    const math = o.math.map((m) => ({ op: String(objectOrEmpty(m).op), a: finiteNumberOr(objectOrEmpty(m).a, -1), b: typeof objectOrEmpty(m).b === "number" ? (objectOrEmpty(m).b as number) : null })).filter((m) => m.a >= 0);
    if (math.length) spec.math = math;
  }
  if (Array.isArray(o.measures)) {
    const measures = o.measures.filter((m): m is string => typeof m === "string");
    if (measures.length) spec.measures = measures;
  }
  if (typeof o.view === "string" && o.view) spec.view = o.view;
  if (Array.isArray(o.expressions)) {
    const expr = o.expressions.map((e) => ({ position: finiteNumberOr(objectOrEmpty(e).position, -1), text: String(objectOrEmpty(e).text ?? "") })).filter((e) => e.position >= 0 && e.text);
    if (expr.length) spec.expr = expr;
  }
  if (o.expressionsOnly === true) spec.exprOnly = true;
  return spec;
}

function sliderToJson(a: Adjustable): Record<string, unknown> {
  const out: Record<string, unknown> = { part: a.elementIndex, item: a.editItem, min: a.minValue, max: a.maxValue, label: a.label };
  if (a.logarithmic) out.log = true;
  if (a.step > 0) out.step = a.step;
  if (a.sharedWith !== null) out.sharedWith = a.sharedWith;
  return out;
}

function sliderFromJson(j: unknown): Adjustable | null {
  const o = objectOrEmpty(j);
  const part = finiteNumberOr(o.part, -1);
  if (part < 0) return null;
  return {
    elementIndex: part, editItem: finiteNumberOr(o.item, 0), minValue: finiteNumberOr(o.min, 1), maxValue: finiteNumberOr(o.max, 1000),
    label: typeof o.label === "string" ? o.label : "", logarithmic: o.log === true, step: finiteNumberOr(o.step, 0),
    sharedWith: typeof o.sharedWith === "number" ? o.sharedWith : null,
  };
}

/** Read a file's text. Throws a CircuitParseError when it isn't an .nfg file. */
export function parseNfg(text: string): NfgContents {
  let doc: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    doc = parsed as Record<string, unknown>;
  } catch (err) {
    throw new CircuitParseError(`not a NodeForge circuit file: ${(err as Error).message}`);
  }
  if (doc.format !== NFG_FORMAT) throw new CircuitParseError("not a NodeForge circuit file (its \"format\" isn't \"nodeforge\")");
  const version = finiteNumberOr(doc.version, 1);
  const tags: Record<string, string> = {};
  for (const [name, tag] of Object.entries(objectOrEmpty(doc.types))) if (typeof tag === "string") tags[name] = tag;
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) if (!KNOWN.has(k)) extra[k] = v;
  return {
    options: optionsFromJson(doc.engine, doc.display),
    nodes: [...list(doc.models), ...list(doc.parts)].map((n) => nodeFromJson(n, tags)),
    scopes: list(doc.scopes).map(scopeFromJson).filter((s): s is ScopeSpec => s !== null),
    adjustables: list(doc.sliders).map(sliderFromJson).filter((s): s is Adjustable => s !== null),
    meta: objectOrEmpty(doc.meta),
    extra,
    newer: version > NFG_VERSION,
  };
}

/**
 * The file's text: sections in a fixed order, one part, model or scope per line (so a file diffs
 * line by line and the same circuit always gives the same text).
 */
export function formatNfg(input: NfgInput): string {
  const names = new TypeNames();
  const models = input.models.map((n) => nodeToJson(n, names));
  const parts = input.parts.map((n) => wireToJson(n) ?? nodeToJson(n, names));
  const { engine, display } = optionsToJson(input.options);
  const lines: string[] = [];
  const field = (key: string, value: unknown) => lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  const list = (key: string, items: unknown[]) =>
    lines.push(items.length ? `  ${JSON.stringify(key)}: [\n${items.map((i) => `    ${JSON.stringify(i)}`).join(",\n")}\n  ]` : `  ${JSON.stringify(key)}: []`);
  field("format", NFG_FORMAT);
  field("version", NFG_VERSION);
  if (Object.keys(input.meta).length) field("meta", input.meta);
  field("types", names.table);
  field("engine", engine);
  field("display", display);
  list("models", models);
  list("parts", parts);
  list("scopes", input.scopes.filter((s) => s.plots.length).map(scopeToJson));
  list("sliders", input.adjustables.map(sliderToJson));
  for (const [k, v] of Object.entries(input.extra)) if (!KNOWN.has(k)) field(k, v);
  return `{\n${lines.join(",\n")}\n}\n`;
}
