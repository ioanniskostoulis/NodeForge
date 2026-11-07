// SPICE models of real parts, with their specifications, origin and comparison against ngspice.
// Built-in entries ship with the app; the user's own are kept in their app data.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { hasExpressions, libraryScope, parseSpice, resolveModel, type SpiceModel, type SpiceSubckt } from "../engine";

export type ModelKind = "diode" | "zener" | "nmos" | "pmos" | "njf" | "pjf" | "npn" | "pnp";

export const KIND_LABELS: Record<ModelKind, string> = {
  diode: "Diode",
  zener: "Zener",
  nmos: "N-channel MOSFET",
  pmos: "P-channel MOSFET",
  njf: "N-channel JFET",
  pjf: "P-channel JFET",
  npn: "NPN transistor",
  pnp: "PNP transistor",
};

/** The library kinds a part takes models of (pnp: −1 for p-channel and PNP parts). */
export function kindsForPart(kind: "diode" | "mosfet" | "jfet" | "bjt", pnp = 1): ModelKind[] {
  if (kind === "diode") return ["diode", "zener"];
  if (kind === "jfet") return [pnp > 0 ? "njf" : "pjf"];
  if (kind === "bjt") return [pnp > 0 ? "npn" : "pnp"];
  return [pnp > 0 ? "nmos" : "pmos"];
}

/** One part in the library. */
export interface LibraryModel {
  /** The SPICE name (what parts refer to). */
  name: string;
  kind: ModelKind;
  manufacturer?: string;
  description?: string;
  /** Key specifications, as text with units ("Vds": "200 V"). */
  specs: Record<string, string>;
  /** Self-contained SPICE text (the card or subcircuit, with what it uses). */
  spice: string;
  /** Where it came from (a file name or URL), and its licence note. */
  source?: string;
  license?: string;
  /** When it was added (ISO date). */
  added?: string;
  /** Shipped with NodeForge (can't be removed). */
  builtIn?: boolean;
  /** The name shown for it (else its SPICE name, as modelLabel gives it). */
  label?: string;
  /**
   * One of CircuitJS's own models (its SPICE equivalent shown): a part on it is a plain CircuitJS
   * part (CircuitJS opens it the same, and the CircuitJS solver runs CircuitJS's own code).
   */
  circuitJS?: boolean;
  /** NodeForge against ngspice on the kind's test circuit: worst shape error (%), when. */
  check?: { error: number | null; date: string; note?: string };
}

const formatSpec = (value: number, unit: string): string => {
  const magnitude = Math.abs(value);
  if (magnitude === 0) return unit ? `0 ${unit}` : "0";
  if (!unit && magnitude >= 0.01 && magnitude < 1000) return String(+value.toPrecision(3));
  const pre: [number, string][] = [[1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"], [1e-15, "f"]];
  for (const [scale, prefix] of pre) if (magnitude >= scale * 0.9995) return `${+(value / scale).toPrecision(3)} ${prefix}${unit}`;
  return `${value.toExponential(2)} ${unit}`;
};

/** The kind a model card is, from its type and parameters (zeners: a low breakdown, or the name). */
export function modelKind(m: SpiceModel): ModelKind | null {
  if (m.type === "D") {
    // a zener by its name, or by a low breakdown with a zener's test current (mA, not the µA of a
    // rectifier's or Schottky's leakage rating)
    const bv = m.params.get("bv"), ibv = m.params.get("ibv") ?? 1e-3;
    const zenerName = /zener|^(gen_)?1n4[67]\d\d|^1n5[23]\d\d|^bz[xvt]|^zm|^mmsz|^zpd|^dz/i.test(m.name);
    // a Schottky (low junction potential, a near-ideal junction) isn't one, whatever its rating
    const schottky = (m.params.get("vj") ?? 1) < 0.5 && (m.params.get("n") ?? 1) < 1.15;
    return zenerName || (!schottky && bv !== undefined && bv <= 75 && ibv >= 2e-3) ? "zener" : "diode";
  }
  if (m.type === "VDMOS") return m.flags.has("pchan") || m.flags.has("vdmosp") ? "pmos" : "nmos";
  if (m.type === "NMOS") return "nmos";
  if (m.type === "PMOS") return "pmos";
  if (m.type === "NJF") return "njf";
  if (m.type === "PJF") return "pjf";
  if (m.type === "NPN") return "npn";
  if (m.type === "PNP") return "pnp";
  return null;
}

/** Key specifications from a model card (what the card states, or its main parameters). */
export function modelSpecs(m: SpiceModel): Record<string, string> {
  const p = m.params, out: Record<string, string> = {};
  const put = (label: string, key: string, unit: string) => {
    const v = p.get(key);
    if (v !== undefined && Number.isFinite(v)) out[label] = formatSpec(v, unit);
  };
  if (m.type === "VDMOS" || m.type === "NMOS" || m.type === "PMOS") {
    // LTspice's information parameters
    put("Vds", "vds", "V");
    put("Ron", "ron", "Ω");
    put("Qg", "qg", "C");
    put("Vto", "vto", "V");
    put("Kp", "kp", "A/V²");
    put("Cgs", "cgs", "F");
    put("Cgd max", "cgdmax", "F");
    put("Rd", "rd", "Ω");
  } else if (m.type === "D") {
    put("BV", "bv", "V");
    put("IS", "is", "A");
    put("N", "n", "");
    put("RS", "rs", "Ω");
    put("CJO", "cjo", "F");
    put("TT", "tt", "s");
  } else if (m.type === "NPN" || m.type === "PNP") {
    // LTspice's information parameters, then the main ones
    put("Vceo", "vceo", "V");
    put("Ic", "icrating", "A");
    put("BF", "bf", "");
    put("IS", "is", "A");
    put("VAF", "vaf", "V");
    put("IKF", "ikf", "A");
    put("CJC", "cjc", "F");
    put("TF", "tf", "s");
  } else if (m.type === "NJF" || m.type === "PJF") {
    put("Vto", "vto", "V");
    put("Beta", "beta", "A/V²");
    const lambda = p.get("lambda");
    if (lambda !== undefined && Number.isFinite(lambda)) out["Lambda"] = `${+lambda.toPrecision(3)} /V`;
    put("Cgs", "cgs", "F");
    put("Cgd", "cgd", "F");
  }
  return out;
}

/** The manufacturer a card names (LTspice's `mfg=`). */
export function modelManufacturer(m: SpiceModel): string | undefined {
  return m.text.get("mfg")?.replace(/_/g, " ");
}

/** A subcircuit's likely kind: MOSFETs are the 3-pin (or more) parts manufacturers publish. */
export function subcktKind(sub: SpiceSubckt): ModelKind | null {
  if (sub.pins.length === 2) return "diode";
  if (sub.pins.length < 3) return null;
  const text = `${sub.name} ${sub.comments.join(" ")}`;
  if (/p-?channel|pmos|pchan/i.test(text)) return "pmos";
  return "nmos";
}

/**
 * The name a model is shown by: short, the part it is. Real parts by their part number, as their
 * maker names them; NodeForge's generic models by the part they're typical of (their SPICE names
 * start GEN_, which is dropped); CircuitJS's by what they are (see circuitJSLabel).
 */
export function modelLabel(spiceName: string): string {
  const name = spiceName.replace(/^GEN_/i, "");
  // the generic LEDs by colour ("GEN_LED_RED" → "LED red")
  const led = /^LED_(\w+)$/i.exec(name);
  if (led) return `LED ${led[1].toUpperCase() === "IR" ? "infrared" : led[1].toLowerCase()}`;
  return name.replace(/_/g, " ");
}

/** A library entry's name as shown. */
export function displayName(m: LibraryModel): string {
  return m.label ?? modelLabel(m.name);
}

const short = (x: number) => String(+x.toPrecision(3));

const CIRCUITJS_DIODES: Record<string, string> = {
  "default": "Diode", "default-zener": "Zener 5.6 V", "default-led": "LED", "default-optocoupler-led": "LED (optocoupler)",
  "spice-default": "SPICE diode",
};
const CIRCUITJS_TRANSISTORS: Record<string, string> = { "default": "Transistor", "spice-default": "SPICE transistor" };
const CIRCUITJS_MOSFETS: Record<string, string> = {
  "default-jfet": "JFET",
  "default": "MOSFET", "default-body": "MOSFET, body pin", "default-digital": "MOSFET, logic", "default-nodiode": "MOSFET, no body diode",
};

/**
 * A CircuitJS model's name as shown: its defaults by what they are ("Zener 5.6 V", "MOSFET, no body
 * diode"), an old file's inline models by their values ("Diode 0.81V", "MOSFET Vt 3V"), part
 * numbers as they are.
 */
export function circuitJSLabel(name: string, model: { breakdownVoltage?: number; fwdrop?: number; threshold?: number } | null, kind: "diode" | "mosfet" | "bjt"): string {
  if (kind === "bjt") return CIRCUITJS_TRANSISTORS[name] ?? name;
  if (kind === "mosfet") {
    if (name in CIRCUITJS_MOSFETS) return CIRCUITJS_MOSFETS[name];
    if (/^old-mosfet/.test(name) && model?.threshold !== undefined) return `MOSFET Vt ${short(model.threshold)} V`;
    return name;
  }
  if (name in CIRCUITJS_DIODES) return CIRCUITJS_DIODES[name];
  if (/^fwdrop=/.test(name) && model) return model.breakdownVoltage ? `Zener ${short(model.breakdownVoltage)} V` : `Diode ${short(model.fwdrop ?? 0)} V`;
  return name;
}

/** Is it a CircuitJS model that's just "the" diode, MOSFET or JFET (the part's type says it all)? */
export function isPlainCircuitJSModel(name: string): boolean {
  return name === "default" || name === "default-jfet" || /^fwdrop=[\d.]+$/.test(name);
}

/** What an import found: each model and subcircuit, with its kind and specs (not yet in the library). */
export function findModels(text: string, source?: string): { models: LibraryModel[]; skipped: string[] } {
  const lib = parseSpice(text);
  const out: LibraryModel[] = [];
  const today = new Date().toISOString().slice(0, 10);
  // models a subcircuit uses aren't parts of their own
  const used = new Set<string>();
  for (const s of lib.subckts.values()) for (const e of s.elements) for (const f of e.fields) used.add(f.toLowerCase());
  const scope = libraryScope(lib);
  for (const card of lib.models.values()) {
    // values given as expressions over the file's .param lines, worked out
    const m = resolveModel(card, scope);
    const kind = modelKind(m);
    if (!kind || used.has(m.name.toLowerCase())) continue;
    const spice = hasExpressions(card) ? [...lib.globals, card.source].join("\n") : card.source;
    out.push({ name: m.name, kind, manufacturer: modelManufacturer(m), specs: modelSpecs(m), spice, source, added: today });
  }
  for (const s of lib.subckts.values()) {
    const kind = subcktKind(s);
    if (!kind) continue;
    // the top-level .param / .func lines (it may use them), the subcircuit, the outside models it uses
    const parts = [...lib.globals, s.source];
    for (const e of s.elements) for (const f of e.fields) {
      const m = lib.models.get(f.toLowerCase());
      if (m && !s.models.has(f.toLowerCase()) && !parts.includes(m.source)) parts.push(m.source);
    }
    const description = s.comments.find((c) => c.length > 8 && !/^\s*[-=*]+\s*$/.test(c));
    out.push({ name: s.name, kind, description, specs: { Pins: s.pins.join(" ") }, spice: parts.join("\n"), source, added: today });
  }
  return { models: out, skipped: lib.skipped };
}

/**
 * A test circuit for checking a model (XML, the model included): what each kind does in use.
 * Diodes: a ±10 V, 50 kHz square through 10 Ω (forward conduction and reverse recovery). Zeners:
 * a 20 V sine through 1 kΩ (both directions, the knee). MOSFETs: switching a 10 Ω load from 24 V
 * with a 12 V gate drive through 10 Ω (the Miller plateau, the edges). Transistors: switching
 * 100 Ω from 12 V with a 5 V, 100 kHz base drive through 1 kΩ (saturation, storage time).
 * JFETs: a common-source amplifier (4.7 kΩ from 15 V, 470 Ω source) on a 0.3 V, 50 kHz sine.
 * P-channel and PNP parts the same, supplies and drive negated.
 */
export function checkCircuit(m: LibraryModel): { xml: string; seconds: number } {
  const model = `<nfmodel n="${m.name}">${m.spice.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</nfmodel>`;
  if (m.kind === "diode" || m.kind === "zener") {
    const zener = m.kind === "zener";
    return {
      seconds: zener ? 3e-3 : 6e-5,
      xml: `<cir f="1" ts="${zener ? 2e-6 : 1e-8}" ic="10" cb="50" pb="50" vr="5" mts="5e-14">
  ${model}
  <v x="96 304 96 160" f="0" wf="${zener ? 1 : 2}" fr="${zener ? 1000 : 50000}" maxv="${zener ? 20 : 10}" bias="0" phaseShift="0" dutyCycle="0.5"/>
  <r x="96 160 224 160" f="0" r="${zener ? 1000 : 10}"/>
  ${zener ? `<z x="224 304 224 160" f="2" mo="default-zener" nfm="${m.name}"/>` : `<d x="224 160 224 304" f="2" mo="default" nfm="${m.name}"/>`}
  <w x="224 304 96 304" f="0"/>
  <g x="96 304 96 336" f="0"/>
</cir>`,
    };
  }
  if (m.kind === "npn" || m.kind === "pnp") {
    const s = m.kind === "pnp" ? -1 : 1;
    return {
      seconds: 3e-5,
      xml: `<cir f="1" ts="1e-8" ic="10" cb="50" pb="50" vr="5" mts="5e-14">
  ${model}
  <v x="240 304 240 240" f="0" wf="2" fr="100000" maxv="${2.5 * s}" bias="${2.5 * s}" phaseShift="0" dutyCycle="0.5" riseTime="1e-8"/>
  <r x="240 240 304 240" f="0" r="1000"/>
  <t x="304 240 352 240" f="0" pn="${s}" be="100" mo="default" nfm="${m.name}"/>
  <g x="240 304 240 320" f="0"/>
  <w x="352 256 352 304" f="0"/>
  <g x="352 304 352 320" f="0"/>
  <r x="352 224 352 160" f="0" r="100"/>
  <R x="352 160 352 128" f="0" wf="0" fr="40" maxv="${12 * s}" bias="0" phaseShift="0" dutyCycle="0.5"/>
</cir>`,
    };
  }
  if (m.kind === "njf" || m.kind === "pjf") {
    const s = m.kind === "pjf" ? -1 : 1;
    return {
      seconds: 2e-4,
      xml: `<cir f="1" ts="1e-7" ic="10" cb="50" pb="50" vr="5" mts="5e-14">
  ${model}
  <v x="96 304 96 240" f="0" wf="1" fr="50000" maxv="0.3" bias="0" phaseShift="0" dutyCycle="0.5"/>
  <r x="96 240 224 240" f="0" r="10000"/>
  <r x="224 240 224 304" f="0" r="1000000"/>
  <j x="224 240 272 240" f="${s < 0 ? 1 : 0}" mo="default-jfet" nfm="${m.name}"/>
  <r x="272 256 272 304" f="0" r="470"/>
  <r x="272 224 272 160" f="0" r="4700"/>
  <R x="272 160 272 128" f="0" wf="0" fr="40" maxv="${15 * s}" bias="0" phaseShift="0" dutyCycle="0.5"/>
  <g x="96 304 96 320" f="0"/>
  <w x="224 304 272 304" f="0"/>
  <g x="272 304 272 320" f="0"/>
</cir>`,
    };
  }
  const p = m.kind === "pmos";
  // a p-channel part: gate driven 0 to −12 V, the load to −24 V
  return {
    seconds: 3e-5,
    xml: `<cir f="1" ts="1e-8" ic="10" cb="50" pb="50" vr="5" mts="5e-14">
  ${model}
  <f x="304 240 352 240" f="${p ? 1 : 0}" mo="default" nfm="${m.name}"/>
  <r x="240 240 304 240" f="0" r="10"/>
  <v x="240 304 240 240" f="0" wf="2" fr="100000" maxv="${p ? -6 : 6}" bias="${p ? -6 : 6}" phaseShift="0" dutyCycle="0.5" riseTime="1e-8"/>
  <g x="240 304 240 320" f="0"/>
  <w x="352 ${p ? 224 : 256} 352 ${p ? 192 : 304}" f="0"/>
  <g x="352 ${p ? 192 : 304} 352 ${p ? 176 : 320}" f="0"/>
  <r x="352 ${p ? 256 : 224} 352 ${p ? 320 : 160}" f="0" r="10"/>
  <R x="352 ${p ? 320 : 160} 352 ${p ? 352 : 128}" f="0" wf="0" fr="40" maxv="${p ? -24 : 24}" bias="0" phaseShift="0" dutyCycle="0.5"/>
</cir>`,
  };
}

/** A check result as text: "0.0088%", or "<0.001%" for a negligible difference. */
export function checkPercent(error: number): string {
  return error < 0.001 ? "<0.001%" : `${+error.toPrecision(2)}%`;
}
