// Document model and loaders for CircuitJS text and XML, NodeForge .nfg, and the sliders
// (Adjustable.java) and scopes (ScopeSerializer.java) stored in them.
// Ported from CircuitJS1 by Paul Falstad and Iain Sharp.
// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { type CircuitElm, ScopeValue } from "../core/elm";
import { grid } from "../core/geometry";
import { SolverType } from "../core/simulator";
import { PlaceholderElm } from "../elements/basic";
import { CustomCompositeModel } from "../elements/composite";
import { CustomLogicModel } from "../elements/customlogic";
import { DiodeModel } from "../elements/diode";
import { MosfetModel } from "../elements/mosfet";
import { TransistorModel } from "../elements/semis";
import { RelayModel } from "../elements/relays";
import { editItem } from "../core/edititems";
import { classForXmlTag, createFromText, createNew, createPlaceholder, type ElmClass, partClass } from "./registry";
import { isNfgText, parseNfg } from "./nfg";
import { CircuitParseError, CircuitText, JavaNumber, parseXml, TokenStream, type XmlNode } from "./tokens";

/** The circuit temperature (°C) when a file sets none. */
export const DEFAULT_TEMPERATURE = 25;

/** Global circuit options stored in the file header (`$` line / `<cir>` attributes). */
export interface CircuitOptions {
  showDots: boolean;
  smallGrid: boolean;
  showVoltage: boolean;
  showPower: boolean;
  showValues: boolean;
  adjustTimeStep: boolean;
  autoDCOnReset: boolean;
  maxTimeStep: number;
  minTimeStep: number;
  /** Simulation speed as an iteration count (the "Simulation Speed" slider). */
  iterCount: number;
  currentBar: number;
  powerBar: number;
  voltageRange: number;
  solverType: number;
  /**
   * NodeForge: component tolerances for this circuit (parts vary from their values, by a seed),
   * or null in files without NodeForge's settings (CircuitJS files: ideal parts).
   */
  tolerance: { on: boolean; seed: number } | null;
  /**
   * NodeForge engine: the circuit's temperature (°C) for its SPICE devices; 25 unless set
   * (SPICE's own nominal temperature is 27). CircuitJS has none.
   */
  temperature: number;
  /**
   * NodeForge engine: self-heating (devices whose models give a thermal resistance heat up with the
   * power they dissipate); off unless set.
   */
  selfHeating: boolean;
  /**
   * NodeForge engine: the start-up ramp (s): every independent source rises linearly from 0 over
   * it at the start of a run from rest, as LTspice's `startup`; 0 (off) unless set.
   */
  startupRamp: number;
}

export function defaultOptions(): CircuitOptions {
  return {
    showDots: false, smallGrid: false, showVoltage: true, showPower: false, showValues: true,
    adjustTimeStep: false, autoDCOnReset: false, maxTimeStep: 5e-6, minTimeStep: 50e-12,
    iterCount: 10, currentBar: 50, powerBar: 50, voltageRange: 5, solverType: SolverType.auto, tolerance: null, temperature: DEFAULT_TEMPERATURE, selfHeating: false, startupRamp: 0,
  };
}

function applyFlags(o: CircuitOptions, flags: number): void {
  o.showDots = (flags & 1) !== 0;
  o.smallGrid = (flags & 2) !== 0;
  o.showVoltage = (flags & 4) === 0;
  o.showPower = (flags & 8) === 8;
  o.showValues = (flags & 16) === 0;
  o.adjustTimeStep = (flags & 64) !== 0;
  o.autoDCOnReset = (flags & 128) !== 0;
}

/** Reference data recorded by upstream's TestManager. */
export interface CircuitTest {
  length: number;
  switchEvents: { t: number; elementIndex: number }[];
  scopeData: {
    scopeIndex: number;
    plotIndex: number;
    elementIndex: number;
    value: number;
    units: number;
    speed: number;
    ts: number;
    values: number[];
  }[];
}

/** A slider bound to one numeric edit item of an element. */
export interface Adjustable {
  elementIndex: number;
  editItem: number;
  minValue: number;
  maxValue: number;
  label: string;
  logarithmic: boolean;
  step: number;
  /** Index of another adjustable whose slider this one follows. */
  sharedWith: number | null;
}

/** Slider position (0–100) → value, honoring log scale and step. */
export function adjustableValue(a: Adjustable, pos: number): number {
  let result =
    a.logarithmic && a.minValue > 0
      ? Math.exp(Math.log(a.minValue) + ((Math.log(a.maxValue) - Math.log(a.minValue)) * pos) / 100)
      : a.minValue + ((a.maxValue - a.minValue) * pos) / 100;
  if (a.step > 0) result = a.minValue + Math.round((result - a.minValue) / a.step) * a.step;
  return result;
}

/** Value → slider position (0–100). */
export function adjustablePosition(a: Adjustable, value: number): number {
  if (a.logarithmic && a.minValue > 0) {
    const lo = Math.log(a.minValue), hi = Math.log(a.maxValue);
    return ((Math.log(value) - lo) / (hi - lo)) * 100;
  }
  return ((value - a.minValue) * 100) / (a.maxValue - a.minValue);
}

export interface ScopePlotSpec {
  elementIndex: number;
  /** Scope value selector (ScopeValue.*). */
  value: number;
}

export interface ScopeSpec {
  plots: ScopePlotSpec[];
  /** Timesteps per horizontal sample. */
  speed: number;
  showVoltage: boolean;
  showCurrent: boolean;
  position: number;
  text: string | null;
  /** Display flags (ScopeSerializer.getFlags: 64 = 2D plot, 128 = XY, 1024 = FFT, …). */
  flags: number;
  /** NodeForge-only edge trigger; absent in ordinary CircuitJS scope files. */
  trigger?: { edge: 0 | 1 | -1; trace: number; level: number | null };
  /** NodeForge-only math traces (op on plots a and b, by index), after the plots: `nfmt="sub:0:1;int:2"`. */
  math?: { op: string; a: number; b: number | null }[];
  /** NodeForge-only measurements beyond CircuitJS's flags: `nfme="rise,fall,cycles"`. */
  measures?: string[];
  /** NodeForge-only view (scales, time per division, ranges), opaque to the engine: `nfv`. */
  view?: string;
  /** NodeForge-only expression traces and their places among the traces: `nfx="1:V(#2)*I(#2)|…"`. */
  expr?: { position: number; text: string }[];
  /** The plots only stand in for a scope of expressions (`nfxo="1"`). */
  exprOnly?: boolean;
}

/** Scope display flags, as stored in files (ScopeSerializer.getFlags). */
export const ScopeFlag = {
  showCurrent: 1, showVoltage: 2, hideMax: 4, showFreq: 8, manualScale: 16, plot2d: 64, plotXY: 128, showMin: 256,
  showScale: 512, fft: 1024, plots: 4096, maxScale: 8192, showRMS: 16384, showDutyCycle: 32768, logSpectrum: 65536,
  showAverage: 1 << 17, showElmInfo: 1 << 20, showP2P: 1 << 22,
} as const;

/** Plots after applying the voltage/current visibility flags. */
export function visiblePlots(s: ScopeSpec): ScopePlotSpec[] {
  return s.plots.filter((p) =>
    p.value === ScopeValue.voltage ? s.showVoltage : p.value === ScopeValue.current ? s.showCurrent : true,
  );
}

export const FLAG_SHARED = 1, FLAG_LOG = 2;
const FLAG_YELM = 32, FLAG_PLOT2D = 64, FLAG_IVALUE = 2048, FLAG_PLOTS = 4096;
export { FLAG_PLOTS };
const FLAG_PERPLOTFLAGS = 1 << 18, FLAG_PERPLOT_MAN_SCALE = 1 << 19, FLAG_DIVISIONS = 1 << 21;

function importDecOrHex(s: string): number {
  return s.startsWith("x") ? JavaNumber.parseInt(s.slice(1), 16) : JavaNumber.parseInt(s);
}

/** Plot values whose units beyond V and A carry an extra scale token in files. */
export function hasExtraScale(value: number): boolean {
  return value === ScopeValue.power || value === ScopeValue.charge || value === 2; // VAL_R
}

/**
 * NodeForge engine: what a NodeForge circuit file carries beyond CircuitJS (which skips it),
 * registered by source/engine/nodeforge: SPICE models (<nfmodel>) and parts that use them.
 */
export const circuitExtensions = {
  /** Readers for root elements CircuitJS doesn't have, by tag. */
  readers: new Map<string, (xml: XmlNode) => void>(),
  /** The class to create for a part instead of the usual one (null: the usual). */
  elementClass: [] as ((C: ElmClass, xml: XmlNode) => ElmClass | null)[],
  /** Root elements to write, before the parts. */
  writers: [] as ((c: Circuit) => XmlNode[])[],
};

export class Circuit {
  /** Elements in file order. Indices are significant (scopes, sliders and tests refer to them). */
  elements: CircuitElm[] = [];
  options = defaultOptions();
  test: CircuitTest | null = null;
  adjustables: Adjustable[] = [];
  scopes: ScopeSpec[] = [];
  /** Non-fatal problems found while loading. */
  warnings: string[] = [];
  /** The format the circuit was loaded from. */
  format: "text" | "xml" | "nfg" = "text";
  /** What an .nfg file says about itself (title, author, notes, dates); empty for CircuitJS files. */
  meta: Record<string, unknown> = {};
  /** Top-level keys of an .nfg file that this build doesn't know, kept for saving. */
  nfgExtra: Record<string, unknown> = {};

  static parse(text: string): Circuit {
    const c = new Circuit();
    // subcircuit models defined by a file are local to it
    CustomCompositeModel.clearLocalModels();
    if (isNfgText(text)) {
      c.format = "nfg";
      c.readNfg(text);
    } else if (text.trimStart().startsWith("<")) {
      c.format = "xml";
      c.readXml(text);
    } else c.readText(text);
    grid.size = c.options.smallGrid ? 8 : 16;
    for (const ce of c.elements) ce.setPoints();
    return c;
  }

  /** Element type codes (or XML tags) that this build can't simulate yet, with counts. */
  get unsupportedTypes(): Map<string, number> {
    const m = new Map<string, number>();
    for (const e of this.elements) if (e instanceof PlaceholderElm) m.set(e.typeName, (m.get(e.typeName) ?? 0) + 1);
    return m;
  }

  get isFullySupported(): boolean {
    return !this.elements.some((e) => e.isPlaceholder());
  }

  /** Elements the simulator should run (placeholders are left out). */
  get simulatedElements(): CircuitElm[] {
    return this.elements.filter((e) => !e.isPlaceholder());
  }

  private readText(text: string): void {
    for (const line of text.split(/[\r\n]+/)) {
      if (line.length === 0) continue;
      const st = new TokenStream(line);
      if (!st.hasMoreTokens) continue;
      const type = st.next();
      const first = type[0];

      if (first === "o") {
        this.readScopeText(st);
        continue;
      }
      if ("h%?B".includes(first)) continue; // hints and afilter-specific lines
      if (first === "$") {
        this.readOptions(st);
        continue;
      }
      if (first === "!") {
        try {
          CustomLogicModel.undumpModel(st);
        } catch (err) {
          this.warnings.push(`couldn't read custom logic model: ${(err as Error).message}`);
        }
        continue;
      }
      if (first === ".") {
        try {
          CustomCompositeModel.undumpModel(st);
        } catch (err) {
          this.warnings.push(`couldn't read subcircuit model: ${(err as Error).message}`);
        }
        continue;
      }

      let tint = first.charCodeAt(0);
      if (first >= "0" && first <= "9") {
        const n = Number.parseInt(type, 10);
        if (Number.isNaN(n)) continue;
        tint = n;
      }
      if (tint === 38) {
        this.readAdjustableText(st);
        continue;
      }
      if (tint === 34) {
        try {
          DiodeModel.undumpModel(st);
        } catch (err) {
          this.warnings.push(`couldn't read diode model '${line}': ${(err as Error).message}`);
        }
        continue;
      }
      if (tint === 32) {
        try {
          TransistorModel.undumpModel(st);
        } catch (err) {
          this.warnings.push(`couldn't read transistor model '${line}': ${(err as Error).message}`);
        }
        continue;
      }

      try {
        const x1 = st.nextInt(), y1 = st.nextInt(), x2 = st.nextInt(), y2 = st.nextInt(), f = st.nextInt();
        const e = createFromText(tint, x1, y1, x2, y2, f, st, true);
        this.elements.push(e ?? createPlaceholder(type, x1, y1, x2, y2, f, line));
      } catch (err) {
        this.warnings.push(`couldn't read '${line}': ${(err as Error).message}`);
      }
    }
  }

  private readOptions(st: TokenStream): void {
    const o = this.options;
    try {
      applyFlags(o, st.nextInt());
      o.maxTimeStep = st.nextDouble();
      o.iterCount = st.nextDouble();
      o.currentBar = st.nextInt();
      o.voltageRange = st.nextDouble();
    } catch (err) {
      this.warnings.push(`bad options line: ${(err as Error).message}`);
      return;
    }
    const pb = st.tryInt();
    if (pb !== undefined) {
      o.powerBar = pb;
      const mts = st.tryDouble();
      if (mts !== undefined) o.minTimeStep = mts;
    }
  }

  /** `38 elm [F<flags>] editItem min max [sharedIndex] label [step]` */
  private readAdjustableText(st: TokenStream): void {
    const e = st.tryInt();
    if (e === undefined || e === -1) return;
    const adj: Adjustable = { elementIndex: e, editItem: 0, minValue: 1, maxValue: 1000, label: "", logarithmic: false, step: 0, sharedWith: null };
    let flags = 0;
    try {
      let ei = st.next();
      // the flags field was added later, marked with an F prefix
      if (ei.startsWith("F")) {
        flags = JavaNumber.parseInt(ei.slice(1));
        ei = st.next();
      }
      adj.editItem = JavaNumber.parseInt(ei);
      adj.minValue = st.nextDouble();
      adj.maxValue = st.nextDouble();
      if (flags & FLAG_SHARED) {
        const ano = st.nextInt();
        adj.sharedWith = ano === -1 ? null : ano;
      }
      adj.label = CircuitText.unescape(st.next());
    } catch {
      // keep what parsed
    }
    adj.logarithmic = (flags & FLAG_LOG) !== 0;
    const step = st.tryDouble();
    if (step !== undefined) adj.step = step;
    this.adjustables.push(adj);
  }

  /** `o elm speed value flags scaleV scaleA ...` (ScopeSerializer.undump) */
  private readScopeText(st: TokenStream): void {
    try {
      const spec = parseScopeText(st);
      if (spec) this.scopes.push(spec);
    } catch (err) {
      this.warnings.push(`couldn't read scope: ${(err as Error).message}`);
    }
  }

  private readXml(text: string): void {
    const root = parseXml(text);
    const o = this.options;
    applyFlags(o, root.int("f", 0));
    o.maxTimeStep = root.double("ts", o.maxTimeStep);
    o.iterCount = root.double("ic", o.iterCount);
    o.currentBar = root.int("cb", o.currentBar);
    o.voltageRange = root.double("vr", o.voltageRange);
    o.powerBar = root.int("pb", o.powerBar);
    o.minTimeStep = root.double("mts", o.minTimeStep);
    o.solverType = root.int("st", o.solverType);
    // NodeForge's tolerance settings (CircuitJS ignores these attributes)
    if (root.get("nft") !== undefined) o.tolerance = { on: root.int("nft", 0) !== 0, seed: root.int("nfs", 1) };
    // NodeForge engine: the circuit's temperature (CircuitJS ignores it too)
    o.temperature = root.double("nftemp", o.temperature);
    o.selfHeating = root.int("nfsh", 0) !== 0;
    o.startupRamp = Math.max(0, Number(root.get("nframp") ?? 0) || 0);

    this.readXmlNodes(root.children);
  }

  /** An .nfg file: its settings, then the same root elements the XML format has. */
  private readNfg(text: string): void {
    const file = parseNfg(text);
    Object.assign(this.options, file.options);
    this.meta = file.meta;
    this.nfgExtra = file.extra;
    if (file.newer) this.warnings.push("this file was saved by a newer NodeForge; what this version doesn't know is kept but not used");
    this.readXmlNodes(file.nodes);
    this.scopes.push(...file.scopes);
    this.adjustables.push(...file.adjustables);
  }

  private readXmlNodes(nodes: XmlNode[]): void {
    for (const elem of nodes) {
      // NodeForge engine: NodeForge's own root elements
      const extension = circuitExtensions.readers.get(elem.tag);
      if (extension) {
        extension(elem);
        continue;
      }
      switch (elem.tag) {
        case "o":
          this.readScopeXml(elem);
          continue;
        case "adj":
          this.readAdjustableXml(elem);
          continue;
        case "dm":
          DiodeModel.undumpModelXml(elem);
          continue;
        case "mm":
          MosfetModel.undumpModelXml(elem);
          continue;
        case "tm":
          TransistorModel.undumpModelXml(elem);
          continue;
        case "rlm":
          RelayModel.undumpModelXml(elem);
          continue;
        case "ccm":
          CustomCompositeModel.undumpModelXml(elem);
          continue;
        case "clm":
          CustomLogicModel.undumpModelXml(elem);
          continue;
        case "h":
          continue;
        case "test":
          this.test = { length: elem.double("len", -1), switchEvents: [], scopeData: [] };
          continue;
        case "switchevent":
          this.test?.switchEvents.push({ t: elem.double("t", 0), elementIndex: elem.int("en", -1) });
          continue;
        case "scopedata":
          this.test?.scopeData.push({
            scopeIndex: elem.int("si", -1), plotIndex: elem.int("pi", -1), elementIndex: elem.int("en", -1),
            value: elem.int("v", 0), units: elem.int("u", 0), speed: elem.int("sp", 1), ts: elem.double("ts", 0),
            values: elem.text.trim().length ? elem.text.split(",").map((v) => JavaNumber.parseDouble(v)) : [],
          });
          continue;
      }
      if (elem.get("x") === undefined) continue;
      let C = classForXmlTag(elem.tag);
      // NodeForge engine: parts it simulates its own way get its classes
      if (C) C = partClass(C);
      for (const choose of circuitExtensions.elementClass) if (C) C = choose(C, elem) ?? C;
      if (C) {
        const e = createNew(C, 0, 0);
        e.undumpXml(elem);
        e.setPositionFromXml(elem);
        e.tolerance = parseTolerances(elem.get("nftol"));
        e.powerLoad = elem.get("nfload") === "1";
        this.elements.push(e);
      } else {
        const p = createPlaceholder(elem.tag, 0, 0, 0, 0, elem.int("f", 0), `<${elem.tag}>`);
        p.xml = elem;
        p.setPositionFromXml(elem);
        this.elements.push(p);
      }
    }
  }

  private readAdjustableXml(xml: XmlNode): void {
    const e = xml.int("e", -1);
    if (e < 0) return;
    let ei = xml.int("ei", 0);
    const name = xml.string("en", null);
    if (name && e < this.elements.length) {
      for (let i = 0; i < 16; i++) {
        if (editItem(this.elements[e], i)?.name === name) {
          ei = i;
          break;
        }
      }
    }
    const ss = xml.int("ss", -1);
    this.adjustables.push({
      elementIndex: e, editItem: ei, minValue: xml.double("mn", 1), maxValue: xml.double("mx", 1000),
      label: xml.string("st", "") ?? "", logarithmic: xml.int("log", 0) !== 0, step: xml.double("stp", 0),
      sharedWith: ss === -1 ? null : ss,
    });
  }

  private readScopeXml(xml: XmlNode): void {
    const spec = parseScopeXml(xml);
    if (spec) this.scopes.push(spec);
  }

}


/** One scope from the text format (after the `o`), or null if it has no element. */
export function parseScopeText(st: TokenStream): ScopeSpec | null {
  const e = st.tryInt();
  if (e === undefined || e === -1) return null;
  const speed = st.nextInt();
  let value = st.nextInt();
  if (value === 1) value = ScopeValue.power; // VAL_POWER_OLD
  const flags = importDecOrHex(st.next());
  st.nextDouble(); // voltage scale
  st.nextDouble(); // current scale
  const spec: ScopeSpec = { plots: [], speed, showVoltage: (flags & 2) !== 0, showCurrent: (flags & 1) !== 0, position: 0, text: null, flags };
  if (flags & FLAG_PLOTS) {
    // new-style dump: explicit plot list
    spec.position = st.tryInt() ?? 0;
    const count = st.tryInt() ?? 1;
    if (flags & FLAG_DIVISIONS) st.tryDouble();
    if (hasExtraScale(value)) st.tryDouble();
    spec.plots.push({ elementIndex: e, value });
    for (let i = 0; i < count; i++) {
      if (flags & FLAG_PERPLOTFLAGS) st.next();
      if (i !== 0) {
        const ne = st.tryInt(), val = st.tryInt();
        if (ne === undefined || val === undefined) break;
        if (hasExtraScale(val)) st.tryDouble();
        spec.plots.push({ elementIndex: ne, value: val });
      }
      if (flags & FLAG_PERPLOT_MAN_SCALE) {
        st.tryDouble();
        st.tryInt();
      }
    }
  } else {
    // old-style dump: voltage (plus current), or value + ivalue
    spec.position = st.tryInt() ?? 0;
    // an X-Y plot's second part (Scope.setValues: only with the 2-D plot flag; sinediode.txt sets
    // one without it)
    let ye = -1;
    if (flags & FLAG_YELM) ye = st.tryInt() ?? -1;
    if (!(flags & FLAG_PLOT2D)) ye = -1;
    const ivalue = flags & FLAG_IVALUE ? st.tryInt() ?? 0 : 0;
    spec.plots =
      ivalue > 0
        ? [{ elementIndex: e, value }, { elementIndex: e, value: ivalue }]
        : ye >= 0
          ? [{ elementIndex: e, value: ScopeValue.voltage }, { elementIndex: ye, value: ScopeValue.voltage }]
          : value === ScopeValue.voltage
            ? [{ elementIndex: e, value }, { elementIndex: e, value: ScopeValue.current }]
            : [{ elementIndex: e, value }];
  }
  const words: string[] = [];
  while (st.hasMoreTokens) words.push(st.next());
  if (words.length) spec.text = CircuitText.unescape(words.join(" "));
  return spec;
}

/** One scope from the XML format (an <o> element). */
export function parseScopeXml(xml: XmlNode): ScopeSpec | null {
  const e = xml.int("en", -1);
  if (e < 0) return null;
  const flags = importDecOrHex(xml.string("f", "0") ?? "0");
  const spec: ScopeSpec = {
    plots: [], speed: xml.int("sp", 64), showVoltage: (flags & 2) !== 0, showCurrent: (flags & 1) !== 0,
    position: xml.int("p", 0), text: xml.string("x", null), flags,
  };
  for (const p of xml.children) if (p.tag === "p") spec.plots.push({ elementIndex: p.int("e", e), value: p.int("v", 0) });
  const edge = xml.int("nftr", 0);
  const trace = xml.int("nftt", 0);
  const levelText = xml.get("nftl");
  const level = levelText === undefined ? null : Number(levelText);
  if (xml.get("nftr") !== undefined && (edge === 0 || edge === 1 || edge === -1) &&
      trace >= 0 && trace < spec.plots.length + (xml.string("nfmt", "") ?? "").split(";").filter(Boolean).length + (xml.string("nfx", "") ?? "").split("|").filter(Boolean).length && (level === null || Number.isFinite(level))) {
    spec.trigger = { edge, trace, level };
  }
  const expr = (xml.string("nfx", "") ?? "").split("|").filter(Boolean).map((e) => {
    const colon = e.indexOf(":");
    return { position: Number(e.slice(0, colon)), text: e.slice(colon + 1) };
  }).filter((e) => Number.isInteger(e.position) && e.position >= 0 && e.text);
  if (expr.length) spec.expr = expr;
  if (xml.get("nfxo") === "1") spec.exprOnly = true;
  const all = spec.plots.length + expr.length;
  const math = (xml.string("nfmt", "") ?? "").split(";").filter(Boolean).map((m) => {
    const [op, a, b] = m.split(":");
    return { op, a: Number(a), b: b === undefined || b === "" ? null : Number(b) };
  }).filter((m) => Number.isInteger(m.a) && m.a >= 0 && m.a < all && (m.b === null || (Number.isInteger(m.b) && m.b >= 0 && m.b < all)));
  if (math.length) spec.math = math;
  const measures = (xml.string("nfme", "") ?? "").split(",").filter((k) => /^[a-z][a-z0-9]*$/i.test(k));
  if (measures.length) spec.measures = measures;
  const view = xml.string("nfv", null);
  if (view) spec.view = view;
  return spec;
}

export { CircuitParseError, createNew };

/** NodeForge's per-part tolerances attribute: "resistance:2;threshold:5" (± percent). */
export function parseTolerances(text: string | undefined): Record<string, number> | null {
  if (!text) return null;
  const out: Record<string, number> = {};
  for (const item of text.split(";")) {
    const [k, v] = item.split(":");
    if (k && Number.isFinite(Number(v))) out[k.trim()] = Number(v);
  }
  return Object.keys(out).length ? out : null;
}

export function formatTolerances(t: Record<string, number> | null): string | null {
  if (!t || !Object.keys(t).length) return null;
  return Object.entries(t).map(([k, v]) => `${k}:${v}`).join(";");
}
