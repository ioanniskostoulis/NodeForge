// Saving circuits in both CircuitJS1 formats: the classic text format (CirSim.dumpCircuit before
// XML, readable by every CircuitJS version) and the XML format current CircuitJS writes
// (XMLSerializer.java). Ported from CircuitJS1 by Paul Falstad and Iain Sharp.
// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { CircuitElm, XmlAttrs } from "../core/elm";
import { PlaceholderElm } from "../elements/basic";
import { CustomCompositeModel } from "../elements/composite";
import { CustomLogicElm, type CustomLogicModel } from "../elements/customlogic";
import { DiodeElm, type DiodeModel } from "../elements/diode";
import { MosfetElm, type MosfetModel } from "../elements/mosfet";
import { TransistorElm, type TransistorModel } from "../elements/semis";
import { RelayElm, type RelayModel } from "../elements/relays";
import { type Circuit, circuitExtensions, type CircuitOptions, DEFAULT_TEMPERATURE, FLAG_LOG, FLAG_PLOTS, FLAG_SHARED, formatTolerances, hasExtraScale, type ScopeSpec } from "./circuit";
import type { ScopeElm } from "../elements/more";
import { CircuitText, parseXml, TokenStream, XmlNode } from "./tokens";
import { formatNfg, MODEL_TAGS } from "./nfg";
import { parseScopeText, parseScopeXml } from "./circuit";

export type CircuitFormat = "text" | "xml" | "nfg";

/** The `$` line flags / `<cir f>` attribute (CirSim.dumpOptions). */
function optionFlags(o: CircuitOptions): number {
  return (o.showDots ? 1 : 0) | (o.smallGrid ? 2 : 0) | (o.showVoltage ? 0 : 4) | (o.showPower ? 8 : 0) | (o.showValues ? 0 : 16) |
    (o.adjustTimeStep ? 64 : 0) | (o.autoDCOnReset ? 128 : 0);
}

/** Can the circuit be saved in `format` without losing anything? */
export function isLossless(c: Circuit, format: CircuitFormat): boolean {
  // NodeForge's tolerance settings do not fit in CircuitJS text.
  if (format === "text") return !c.options.tolerance?.on && c.options.temperature === DEFAULT_TEMPERATURE && !c.options.selfHeating && !(c.options.startupRamp > 0) && c.scopes.every((s) => !s.trigger && !s.math?.length && !s.measures?.length && !s.view && !s.expr?.length) && c.elements.every((e) => e.textLossless() && !e.tolerance && !e.powerLoad);
  return c.elements.every((e) => !(e instanceof PlaceholderElm) || e.xmlLossless);
}

/**
 * The format to save in: the preferred one (usually the one the file was loaded from), unless it
 * would lose something the other keeps.
 */
export function chooseFormat(c: Circuit, preferred: CircuitFormat): CircuitFormat {
  const other: CircuitFormat = preferred === "text" ? "xml" : "text";
  return isLossless(c, preferred) || !isLossless(c, other) ? preferred : other;
}

export function writeCircuit(c: Circuit, format: CircuitFormat): string {
  return format === "nfg" ? writeNfg(c) : format === "xml" ? writeXml(c) : writeText(c);
}

/** Diode and MOSFET models used by the circuit that aren't built in (they must be saved with it). */
function customModels(elements: CircuitElm[]): {
  diodes: DiodeModel[]; mosfets: MosfetModel[]; transistors: TransistorModel[]; relays: RelayModel[]; logic: CustomLogicModel[];
} {
  const diodes = new Set<DiodeModel>(), mosfets = new Set<MosfetModel>(), transistors = new Set<TransistorModel>(), relays = new Set<RelayModel>();
  const logic = new Set<CustomLogicModel>();
  const visit = (e: CircuitElm) => {
    // parts of composites (subcircuits, built-in composites) can use custom models too
    e.getChildElmList()?.forEach(visit);
    if (e instanceof DiodeElm && e.model && !e.model.builtIn) diodes.add(e.model);
    if (e instanceof MosfetElm && e.model && !e.model.builtIn) mosfets.add(e.model);
    if (e instanceof TransistorElm && e.model && !e.model.builtIn) transistors.add(e.model);
    if (e instanceof RelayElm && e.model && !e.model.builtIn) relays.add(e.model);
    if (e instanceof CustomLogicElm && e.model) logic.add(e.model);
  };
  elements.forEach(visit);
  return { diodes: [...diodes], mosfets: [...mosfets], transistors: [...transistors], relays: [...relays], logic: [...logic] };
}

// MARK: text format

export function writeText(c: Circuit): string {
  const o = c.options;
  const lines = [`$ ${optionFlags(o)} ${o.maxTimeStep} ${o.iterCount} ${o.currentBar} ${o.voltageRange} ${o.powerBar} ${o.minTimeStep}`];
  // MOSFET models are stored per element in the text format (see MosfetElm.dump)
  const models = customModels(c.elements);
  for (const m of models.diodes) lines.push(m.dump());
  for (const m of models.transistors) lines.push(m.dump());
  for (const e of c.elements) lines.push(e.dump());
  for (const a of c.adjustables) {
    const flags = (a.sharedWith !== null ? FLAG_SHARED : 0) | (a.logarithmic ? FLAG_LOG : 0);
    let line = `38 ${a.elementIndex} F${flags} ${a.editItem} ${a.minValue} ${a.maxValue}`;
    if (a.sharedWith !== null) line += ` ${a.sharedWith}`;
    lines.push(`${line} ${CircuitText.escape(a.label)} ${a.step}`);
  }
  for (const s of c.scopes) {
    const line = scopeText(s);
    if (line) lines.push(line);
  }
  return lines.join("\n") + "\n";
}

/** `o elm speed value flags scaleV scaleA position count [elm value]... [text]` (new-style plot list). */
function scopeText(s: ScopeSpec): string | null {
  const [first, ...rest] = s.plots;
  if (!first) return null;
  const flags = (s.flags & ~(1 << 18 | 1 << 19 | 1 << 21 | 1 << 24 | 16)) | FLAG_PLOTS | (s.showVoltage ? 2 : 0) | (s.showCurrent ? 1 : 0);
  let line = `o ${first.elementIndex} ${s.speed} ${first.value} ${flags} 5 0.1 ${s.position} ${s.plots.length}`;
  if (hasExtraScale(first.value)) line += " 1";
  for (const p of rest) {
    line += ` ${p.elementIndex} ${p.value}`;
    if (hasExtraScale(p.value)) line += " 1";
  }
  if (s.text) line += ` ${CircuitText.escape(s.text)}`;
  return line;
}

/** A scope as an XML `<o>` element (with a `<p>` per plot), or null if it has no plot. */
function scopeXml(s: ScopeSpec): XmlNode | null {
  const [first] = s.plots;
  if (!first) return null;
  const f = (s.flags & ~(1 << 18 | 1 << 19 | FLAG_PLOTS | 1 << 24 | 16)) | (s.showVoltage ? 2 : 0) | (s.showCurrent ? 1 : 0);
  const o = new XmlNode("o", { en: String(first.elementIndex), sp: String(s.speed), f: String(f), p: String(s.position) });
  if (s.trigger) {
    o.attributes.nftr = String(s.trigger.edge);
    o.attributes.nftt = String(s.trigger.trace);
    if (s.trigger.level !== null) o.attributes.nftl = String(s.trigger.level);
  }
  if (s.math?.length) o.attributes.nfmt = s.math.map((m) => [m.op, m.a, ...(m.b === null ? [] : [m.b])].join(":")).join(";");
  if (s.measures?.length) o.attributes.nfme = s.measures.join(",");
  if (s.view) o.attributes.nfv = s.view;
  if (s.expr?.length) o.attributes.nfx = s.expr.map((e) => `${e.position}:${e.text}`).join("|");
  if (s.exprOnly) o.attributes.nfxo = "1";
  if (s.text) o.attributes.x = s.text;
  for (const p of s.plots) {
    const pa: Record<string, string> = {};
    if (p.elementIndex !== first.elementIndex) pa.e = String(p.elementIndex);
    pa.v = String(p.value);
    o.children.push(new XmlNode("p", pa));
  }
  return o;
}

/** The scope a scope drawn on the sheet shows (its stored definition), or null. */
export function scopeElmSpec(e: ScopeElm): ScopeSpec | null {
  try {
    if (e.specXml) return parseScopeXml(e.specXml);
    // the text format joins the scope's tokens with "_" (CircuitJS ScopeElm.dump)
    return e.specText ? parseScopeText(new TokenStream(e.specText, /_+/)) : null;
  } catch {
    return null;
  }
}

/** Store a scope in a scope drawn on the sheet, for both file formats. */
export function setScopeElmSpec(e: ScopeElm, s: ScopeSpec): void {
  const line = scopeText(s);
  if (!line) return;
  e.specText = line.replace(/^o /, "").replace(/ /g, "_");
  e.specXml = scopeXml(s);
}

// MARK: XML format

const escapeAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function tag(name: string, attrs: XmlAttrs, indent: string, children = "", text = ""): string {
  const a = attrs.map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join("");
  if (text) return `${indent}<${name}${a}>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</${name}>\n`;
  return children ? `${indent}<${name}${a}>\n${children}${indent}</${name}>\n` : `${indent}<${name}${a}/>\n`;
}

function rawXml(n: XmlNode, indent: string): string {
  const children = n.children.map((ch) => rawXml(ch, indent + "  ")).join("");
  return tag(n.tag, Object.entries(n.attributes), indent, children, children ? "" : n.text.trim());
}

export function writeXml(c: Circuit): string {
  const o = c.options;
  const root: XmlAttrs = [["f", String(optionFlags(o))], ["ts", String(o.maxTimeStep)], ["ic", String(o.iterCount)], ["cb", String(o.currentBar)],
    ["pb", String(o.powerBar)], ["vr", String(o.voltageRange)], ["mts", String(o.minTimeStep)]];
  if (o.solverType !== 0) root.push(["st", String(o.solverType)]);
  if (o.tolerance) root.push(["nft", o.tolerance.on ? "1" : "0"], ["nfs", String(o.tolerance.seed)]);
  // NodeForge engine: the circuit's temperature, when it isn't the default 25 °C
  if (o.temperature !== DEFAULT_TEMPERATURE) root.push(["nftemp", String(o.temperature)]);
  if (o.selfHeating) root.push(["nfsh", "1"]);
  if (o.startupRamp > 0) root.push(["nframp", String(o.startupRamp)]);
  let body = "";
  const models = customModels(c.elements);
  for (const m of models.diodes) body += tag("dm", m.dumpXml(), "  ");
  for (const m of models.mosfets) body += tag("mm", m.dumpXml(), "  ");
  for (const m of models.transistors) body += tag("tm", m.dumpXml(), "  ");
  for (const m of models.relays) body += tag("rlm", m.dumpXml(), "  ");
  for (const m of models.logic) body += rawXml(m.toXml(), "  ");
  for (const m of CustomCompositeModel.modelsUsedBy(c.elements)) body += rawXml(m.toXml(), "  ");
  // NodeForge engine: NodeForge's own root elements (SPICE models)
  for (const w of circuitExtensions.writers) for (const n of w(c)) body += rawXml(n, "  ");
  for (const e of c.elements) {
    const a: XmlAttrs = [];
    e.dumpXml(a);
    e.dumpXmlState(a);
    const tol = formatTolerances(e.tolerance);
    if (tol) a.push(["nftol", tol]);
    if (e.powerLoad) a.push(["nfload", "1"]);
    const children = e.xmlChildren().map((ch) => rawXml(ch, "    ")).join("");
    const text = e.xmlText() ?? e.xmlStateText() ?? (e instanceof PlaceholderElm && e.xml ? e.xml.text.trim() : "");
    body += tag(e.xmlTag(), a, "  ", children, text);
  }
  for (const s of c.scopes) {
    const node = scopeXml(s);
    if (node) body += rawXml(node, "  ");
  }
  for (const a of c.adjustables) {
    const attrs: XmlAttrs = [["e", String(a.elementIndex)], ["ei", String(a.editItem)], ["mn", String(a.minValue)], ["mx", String(a.maxValue)],
      ["st", a.label]];
    if (a.logarithmic) attrs.push(["log", "1"]);
    if (a.step > 0) attrs.push(["stp", String(a.step)]);
    if (a.sharedWith !== null) attrs.push(["ss", String(a.sharedWith)]);
    body += tag("adj", attrs, "  ");
  }
  return tag("cir", root, "", body);
}

// MARK: NodeForge format (.nfg)

/**
 * The circuit as an .nfg file: the XML format's models and parts under names, the settings, scopes
 * and sliders from the circuit itself (see nfg.ts and documentation/FILE_FORMAT.md).
 */
export function writeNfg(c: Circuit): string {
  const nodes = parseXml(writeXml(c)).children;
  // NodeForge engine: its own root elements are models too
  const isModel = (n: XmlNode) => MODEL_TAGS.has(n.tag) || circuitExtensions.readers.has(n.tag) || n.get("x") === undefined;
  return formatNfg({
    meta: c.meta, options: c.options,
    models: nodes.filter((n) => isModel(n) && n.tag !== "o" && n.tag !== "adj"),
    parts: nodes.filter((n) => !isModel(n) && n.tag !== "o" && n.tag !== "adj"),
    scopes: c.scopes, adjustables: c.adjustables, extra: c.nfgExtra,
  });
}
