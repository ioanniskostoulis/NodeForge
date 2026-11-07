// Reading SPICE text as manufacturers publish it (.lib / .mod / .spi files): `.model` cards,
// `.subckt` blocks with their element lines, continuation lines, comments and number suffixes.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

/**
 * A card's parameters, remembering which the devices read (`read`, shared with copies made by
 * `copyParams`), so the ones a model sets but nothing simulates can be pointed out.
 */
export class ParamMap extends Map<string, number> {
  read: Set<string>;
  constructor(entries?: Iterable<readonly [string, number]> | null, read?: Set<string>) {
    super(entries ?? undefined);
    this.read = read ?? new Set();
  }
  override get(key: string): number | undefined {
    this.read?.add(key);
    return super.get(key);
  }
  override has(key: string): boolean {
    this.read?.add(key);
    return super.has(key);
  }
}

/** A copy of a card's parameters that reports reads to the original (any Map: a plain copy). */
export function copyParams(params: Map<string, number>): Map<string, number> {
  return params instanceof ParamMap ? new ParamMap(params, params.read) : new Map(params);
}

/** A `.model` card: name, type (D, NMOS, VDMOS, …) and its parameters (lower-case names). */
export interface SpiceModel {
  name: string;
  type: string;
  params: Map<string, number>;
  /** Parameters given without a value (VDMOS's `pchan`) or with a text value. */
  flags: Set<string>;
  text: Map<string, string>;
  /** The card as written (one logical line). */
  source: string;
}

/** An element line inside a subcircuit: its name (first letter = kind), nodes and the rest. */
export interface SpiceElement {
  name: string;
  /** Upper-case first letter: R, C, L, D, M, Q, J, E, F, G, H, V, I, B, X, S, W, K. */
  kind: string;
  /** Whitespace-separated fields after the name (nodes, then values / model / parameters). */
  fields: string[];
  line: string;
}

export interface SpiceSubckt {
  name: string;
  pins: string[];
  /** `params:` defaults on the .subckt line. */
  params: Map<string, string>;
  /** `.param` lines inside the block, in order (name, value as written). */
  locals: [string, string][];
  /** `.func` lines inside the block. */
  funcs: SpiceFuncDef[];
  elements: SpiceElement[];
  /** Models defined inside the subcircuit (local to it). */
  models: Map<string, SpiceModel>;
  /** Comment lines inside the block (often name the pins). */
  comments: string[];
  /** The block as written (logical lines, .subckt to .ends). */
  source: string;
}

/** A `.func name(args) {body}` line. */
export interface SpiceFuncDef {
  name: string;
  args: string[];
  body: string;
}

export interface SpiceLibrary {
  models: Map<string, SpiceModel>;
  subckts: Map<string, SpiceSubckt>;
  /** Top-level `.param` lines, in order (name, value as written). */
  params: [string, string][];
  funcs: SpiceFuncDef[];
  /** The top-level `.param` and `.func` lines as written (models and subcircuits may use them). */
  globals: string[];
  /** Lines that weren't understood (for import reports). */
  skipped: string[];
}

const SCALE: [string, number][] = [
  ["meg", 1e6], ["mil", 25.4e-6], ["t", 1e12], ["g", 1e9], ["k", 1e3], ["m", 1e-3], ["u", 1e-6],
  ["µ", 1e-6], ["n", 1e-9], ["p", 1e-12], ["f", 1e-15], ["a", 1e-18],
];

/** A SPICE number: "4.7k", "10meg", "2.2uF", "1e-9" (letters after the scale are ignored); NaN if none. */
export function spiceNumber(text: string): number {
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([a-zA-Zµ]*)/.exec(text);
  if (!m) return NaN;
  const x = Number(m[1]);
  const suffix = m[2].toLowerCase();
  for (const [s, f] of SCALE) if (suffix.startsWith(s)) return x * f;
  return x;
}

/** Is the text a whole SPICE number ("4.7k", "1e-9", "10meg")? */
export function isNumber(text: string): boolean {
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[a-zA-Zµ]*$/.test(text.trim());
}

/** Split into logical lines: continuations ('+') joined, comments dropped (kept separately). */
function logicalLines(text: string): { lines: string[]; comments: Map<number, string[]> } {
  const lines: string[] = [];
  const comments = new Map<number, string[]>();
  let pendingComments: string[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const t = raw.trim();
    if (!t) continue;
    if (t.startsWith("*")) {
      pendingComments.push(t.replace(/^\*+\s?/, ""));
      continue;
    }
    // inline comments: ';' anywhere, or ' $ ' (ngspice)
    const body = t.replace(/\s*;.*$/, "").replace(/\s\$\s.*$/, "").trim();
    if (!body) continue;
    if (body.startsWith("+") && lines.length) {
      lines[lines.length - 1] += " " + body.slice(1).trim();
      continue;
    }
    if (pendingComments.length) {
      comments.set(lines.length, pendingComments);
      pendingComments = [];
    }
    lines.push(body);
  }
  return { lines, comments };
}

/**
 * Split at spaces, keeping `{…}` and `(…)` groups whole and `name = value` together:
 * "R1 a b {rg * 2}" → R1, a, b, {rg * 2}; "M=2 W = {w}" → M=2, W={w}.
 */
export function splitFields(text: string): string[] {
  const raw: string[] = [];
  let depth = 0, cur = "";
  for (const ch of text) {
    if (ch === "{" || ch === "(") depth++;
    else if ((ch === "}" || ch === ")") && depth > 0) depth--;
    if (depth === 0 && /\s/.test(ch)) {
      if (cur) raw.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) raw.push(cur);
  // join "name =", "= value" and "=" with their neighbours
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    let t = raw[i];
    if (t.startsWith("=") && !t.startsWith("==") && out.length) t = out.pop()! + t;
    while ((t.endsWith("=") && !t.endsWith("==")) && i + 1 < raw.length) t += raw[++i];
    out.push(t);
  }
  return out;
}

/** `name=value` pairs and bare words of a parameter list (parentheses and commas outside braces separate). */
function paramPairs(text: string): { pairs: [string, string][]; words: string[] } {
  let t = "", depth = 0;
  for (const ch of text) {
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    t += depth === 0 && /[(),]/.test(ch) ? " " : ch;
  }
  const pairs: [string, string][] = [];
  const words: string[] = [];
  for (const tok of splitFields(t)) {
    const i = tok.indexOf("=");
    if (i > 0) pairs.push([tok.slice(0, i).toLowerCase(), tok.slice(i + 1)]);
    else words.push(tok.toLowerCase());
  }
  return { pairs, words };
}

/** A `.func` line: `.func name(a, b) {body}` (or `= {body}`, or an unbraced body). */
function parseFunc(line: string): SpiceFuncDef | null {
  const m = /^\.func\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*=?\s*(.+)$/i.exec(line.trim());
  if (!m) return null;
  return { name: m[1].toLowerCase(), args: m[2].split(/[\s,]+/).filter(Boolean).map((a) => a.toLowerCase()), body: m[3] };
}

/** Parse a `.model` line. */
export function parseModel(line: string): SpiceModel | null {
  const m = /^\.model\s+(\S+)\s+([A-Za-z]+)\s*(.*)$/i.exec(line.trim());
  if (!m) return null;
  const model: SpiceModel = { name: m[1], type: m[2].toUpperCase(), params: new ParamMap(), flags: new Set(), text: new Map(), source: line.trim() };
  const { pairs, words } = paramPairs(m[3]);
  for (const [k, v] of pairs) {
    // a number ("2n", "{2n}"); anything else (an expression, a name) is kept as text
    const t = v.replace(/^\{\s*|\s*\}$/g, "");
    if (isNumber(t)) model.params.set(k, spiceNumber(t));
    else model.text.set(k, v);
  }
  for (const w of words) model.flags.add(w);
  return model;
}

/** Parse SPICE text (a model file, a library, a netlist): its models and subcircuits. */
export function parseSpice(text: string): SpiceLibrary {
  const lib: SpiceLibrary = { models: new Map(), subckts: new Map(), params: [], funcs: [], globals: [], skipped: [] };
  const { lines, comments } = logicalLines(text);
  let sub: SpiceSubckt | null = null;
  lines.forEach((line, i) => {
    const lower = line.toLowerCase();
    if (sub) for (const c of comments.get(i) ?? []) sub.comments.push(c);
    if (lower.startsWith(".subckt")) {
      const parts = splitFields(line);
      const name = parts[1] ?? "";
      const pins: string[] = [];
      const params = new Map<string, string>();
      let inParams = false;
      for (const tok of parts.slice(2)) {
        if (/^params:/i.test(tok)) {
          inParams = true;
          const rest = tok.slice(7);
          if (rest) for (const [k, v] of paramPairs(rest).pairs) params.set(k, v);
          continue;
        }
        if (tok.includes("=")) inParams = true;
        if (inParams) for (const [k, v] of paramPairs(tok).pairs) params.set(k, v);
        else pins.push(tok);
      }
      sub = { name, pins, params, locals: [], funcs: [], elements: [], models: new Map(), comments: [...(comments.get(i) ?? [])], source: line };
      return;
    }
    if (sub) sub.source += "\n" + line;
    if (lower.startsWith(".ends")) {
      if (sub) lib.subckts.set(sub.name.toLowerCase(), sub);
      sub = null;
      return;
    }
    if (lower.startsWith(".model")) {
      const m = parseModel(line);
      if (!m) lib.skipped.push(line);
      else (sub ? sub.models : lib.models).set(m.name.toLowerCase(), m);
      return;
    }
    if (/^\.param\b/i.test(line)) {
      const pairs = paramPairs(line.slice(6)).pairs;
      if (sub) sub.locals.push(...pairs);
      else {
        lib.params.push(...pairs);
        lib.globals.push(line);
      }
      return;
    }
    if (/^\.func\b/i.test(line)) {
      const f = parseFunc(line);
      if (!f) lib.skipped.push(line);
      else if (sub) sub.funcs.push(f);
      else {
        lib.funcs.push(f);
        lib.globals.push(line);
      }
      return;
    }
    if (line.startsWith(".")) {
      // .lib, .end, .include, .options …
      if (!/^\.(end|endl|lib)\b/i.test(line)) lib.skipped.push(line);
      return;
    }
    if (sub) {
      const parts = splitFields(line);
      sub.elements.push({ name: parts[0], kind: parts[0][0].toUpperCase(), fields: parts.slice(1), line });
    } else lib.skipped.push(line);
  });
  return lib;
}

/** A `.model` card as SPICE text (under another name if given): parameters, text values, flags. */
export function modelText(m: SpiceModel, name = m.name): string {
  const num = (x: number) => String(+x.toPrecision(10));
  const parts = [
    ...[...m.params].map(([k, v]) => `${k.toUpperCase()}=${num(v)}`),
    ...[...m.text].map(([k, v]) => `${k.toUpperCase()}=${v}`),
    ...[...m.flags].map((f) => f.toUpperCase()),
  ];
  return `.model ${name} ${m.type}(${parts.join(" ")})`;
}
