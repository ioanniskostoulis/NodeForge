// LAPLACE controlled sources (E and G), as PSpice and LTspice write them: a transfer function H(s)
// of an input expression. H(s) is worked out to a ratio of polynomials in s; the engine simulates it
// as a state-space system (an integrator chain on inner nodes, see devices/subckt.ts), and the
// ngspice export writes the same network in ngspice's own elements, since ngspice has no LAPLACE
// form (its XSPICE s_xfer block has no operating point: its integrators start at their int_ic).
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { bind, type Expr, ParamScope, parseExpr } from "./expr";
import { addParams, libraryScope } from "./params";
import { parseSpice } from "./parse";

/** Polynomial coefficients in s, lowest power first. */
export type Poly = number[];

/** H(s) = num(s) / den(s). */
export interface Rational {
  num: Poly;
  den: Poly;
}

/** The parts of a LAPLACE line (after the element name): its output nodes, input and H(s), as text. */
export interface LaplaceLine {
  out: [string, string];
  input: string;
  h: string;
}

/**
 * Read a LAPLACE line's fields: PSpice's `n+ n- LAPLACE {input} [=] {H(s)}`, or LTspice's
 * `n+ n- nc+ nc- Laplace=H(s)` (the input V(nc+, nc−); its window / nfft / mtol options ignored).
 * Null when the line isn't a LAPLACE form.
 */
export function laplaceLine(rest: string): LaplaceLine | null {
  const f = rest.trim().split(/\s+/);
  const pspice = /^(\S+)\s+(\S+)\s+laplace\s*(\{.*)$/i.exec(rest.trim());
  if (pspice) {
    const [input, after] = braced(pspice[3]);
    const h = after.replace(/^=/, "").trim();
    if (!h.startsWith("{")) throw new Error("LAPLACE needs {input} = {H(s)}");
    return { out: [pspice[1], pspice[2]], input, h: braced(h)[0] };
  }
  const lt = /\blaplace\s*=\s*(.*)$/i.exec(rest);
  if (lt && f.length >= 5 && !/=/.test(f.slice(0, 4).join(" "))) {
    const h = lt[1].replace(/\s+(window|nfft|mtol)\s*=\s*\S+/gi, "").trim();
    return { out: [f[0], f[1]], input: `V(${f[2]},${f[3]})`, h: h.startsWith("{") ? braced(h)[0] : h };
  }
  return null;
}

/** A braced group at the start of text, and what follows it. */
function braced(text: string): [string, string] {
  let depth = 0;
  for (let k = 0; k < text.length; k++) {
    if (text[k] === "{") depth++;
    else if (text[k] === "}" && --depth === 0) return [text.slice(0, k + 1), text.slice(k + 1).trim()];
  }
  throw new Error("unbalanced braces");
}

// MARK: polynomials

const trim = (p: Poly): Poly => {
  let n = p.length;
  while (n > 1 && p[n - 1] === 0) n--;
  return p.slice(0, n);
};
const add = (a: Poly, b: Poly, sign = 1): Poly => {
  const r = new Array<number>(Math.max(a.length, b.length)).fill(0);
  a.forEach((x, k) => (r[k] += x));
  b.forEach((x, k) => (r[k] += sign * x));
  return trim(r);
};
const mul = (a: Poly, b: Poly): Poly => {
  const r = new Array<number>(a.length + b.length - 1).fill(0);
  a.forEach((x, i) => b.forEach((y, j) => (r[i + j] += x * y)));
  return trim(r);
};

/** Does an expression read s? */
function readsS(e: Expr): boolean {
  switch (e.k) {
    case "id":
      return e.name === "s";
    case "neg":
    case "not":
      return readsS(e.a);
    case "bin":
      return readsS(e.a) || readsS(e.b);
    case "cond":
      return readsS(e.c) || readsS(e.a) || readsS(e.b);
    case "call":
      return e.args.some(readsS);
    default:
      return false;
  }
}

/** H(s) as a ratio of polynomials, its parameters taken from a scope. Throws on what isn't rational in s. */
export function rational(e: Expr, params: ParamScope): Rational {
  const r = ratio(e, params);
  let { num, den } = r;
  // common powers of s cancel (s/(s·(1+s)) is 1/(1+s))
  while (num.length > 1 && den.length > 1 && num[0] === 0 && den[0] === 0) {
    num = num.slice(1);
    den = den.slice(1);
  }
  if (den.every((x) => x === 0)) throw new Error("H(s) divides by zero");
  return { num, den };
}

function ratio(e: Expr, params: ParamScope): Rational {
  if (!readsS(e)) {
    const b = bind(e, params, null);
    if (b.k !== "num") throw new Error("H(s) isn't a constant apart from s");
    return { num: [b.v], den: [1] };
  }
  switch (e.k) {
    case "id":
      return { num: [0, 1], den: [1] };
    case "neg": {
      const a = ratio(e.a, params);
      return { num: a.num.map((x) => -x), den: a.den };
    }
    case "bin": {
      const a = ratio(e.a, params);
      if (e.op === "^") {
        const b = bind(e.b, params, null);
        if (readsS(e.b) || b.k !== "num" || !Number.isInteger(b.v)) throw new Error("H(s): powers of s must be whole numbers");
        let r: Rational = { num: [1], den: [1] };
        for (let k = 0; k < Math.abs(b.v); k++) r = { num: mul(r.num, a.num), den: mul(r.den, a.den) };
        return b.v < 0 ? { num: r.den, den: r.num } : r;
      }
      const b = ratio(e.b, params);
      switch (e.op) {
        case "+":
        case "-":
          return { num: add(mul(a.num, b.den), mul(b.num, a.den), e.op === "+" ? 1 : -1), den: mul(a.den, b.den) };
        case "*":
          return { num: mul(a.num, b.num), den: mul(a.den, b.den) };
        case "/":
          return { num: mul(a.num, b.den), den: mul(a.den, b.num) };
      }
    }
  }
  throw new Error("H(s) isn't a ratio of polynomials in s (delays and functions of s aren't supported)");
}

/**
 * The state-space form the engine simulates, with time scaled by ω0 so the coefficients are near 1:
 * s = ω0·p, H = (Σ b_k p^k) / (p^n + Σ a_k p^k), k < n. `b` has n + 1 entries (b_n: the direct part).
 */
export function scaled(h: Rational): { w0: number; a: number[]; b: number[] } {
  const n = h.den.length - 1;
  if (h.num.length - 1 > n) throw new Error("H(s): the numerator's degree is above the denominator's");
  // ω0 from the lowest nonzero denominator term and the highest: the filter's geometric mean frequency
  const j = h.den.findIndex((x) => x !== 0);
  const w0 = n > 0 && j < n ? Math.pow(Math.abs(h.den[j] / h.den[n]), 1 / (n - j)) : 1;
  const lead = h.den[n] * Math.pow(w0, n);
  const a = h.den.slice(0, n).map((x, k) => (x * Math.pow(w0, k)) / lead);
  const b = Array.from({ length: n + 1 }, (_, k) => ((h.num[k] ?? 0) * Math.pow(w0, k)) / lead);
  return { w0, a, b };
}

// MARK: ngspice export

/** A number as ngspice reads it (full precision). */
const num = (x: number) => (Object.is(x, -0) ? "0" : String(x));

/** One LAPLACE source as ngspice lines: states <name>_x1…xn, as devices/subckt.ts builds them. */
function stateSpace(name: string, voltage: boolean, l: LaplaceLine, h: Rational): string[] {
  const { w0, a, b } = scaled(h);
  const n = a.length, x = (k: number) => `${name}_x${k + 1}`;
  const u = l.input.replace(/^\{(.*)\}$/s, "$1");
  const terms = (cs: number[]) => cs.map((c, k) => (c === 0 ? "" : ` + (${num(c)})*V(${x(k)})`)).join("");
  const lines: string[] = [];
  for (let k = 0; k < n; k++) lines.push(`C${x(k)} ${x(k)} 0 ${num(1 / w0)}`);
  for (let k = 0; k + 1 < n; k++) lines.push(`G${x(k)} 0 ${x(k)} ${x(k + 1)} 0 1`);
  if (n > 0) lines.push(`B${x(n - 1)} 0 ${x(n - 1)} I=(${u})${terms(a.map((c) => -c))}`);
  if (n > 0 && a[0] === 0) lines.push(`R${x(0)} ${x(0)} 0 1e9`);
  const direct = b[n] !== 0 ? `(${num(b[n])})*(${u})` : "0";
  lines.push(`B${name} ${l.out[0]} ${l.out[1]} ${voltage ? "V" : "I"}=${direct}${terms(a.map((c, k) => b[k] - c * b[n]))}`);
  return lines;
}

/**
 * SPICE text with its LAPLACE sources rewritten for ngspice, each as the engine's state-space
 * network (capacitors, VCCSs and B sources). Parameters come from the text's `.param` lines and
 * each subcircuit's defaults. Text without LAPLACE comes back as it is.
 */
export function laplaceForNgspice(text: string): string {
  if (!/\blaplace\b/i.test(text)) return text;
  const lib = parseSpice(text);
  const top = libraryScope(lib);
  // logical lines (continuations joined), so a source written on several lines is one
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*\+/.test(raw) && lines.length) lines[lines.length - 1] += " " + raw.replace(/^\s*\+/, "");
    else lines.push(raw);
  }
  const out: string[] = [];
  let scope = top;
  for (const line of lines) {
    const t = line.trim();
    const sub = /^\.subckt\s+(\S+)/i.exec(t);
    if (sub) {
      const s = lib.subckts.get(sub[1].toLowerCase());
      scope = new ParamScope(top);
      if (s) {
        for (const [k, v] of s.params) scope.set(k, v);
        addParams(scope, s.locals, s.funcs, []);
      }
    } else if (/^\.ends\b/i.test(t)) scope = top;
    const kind = t[0]?.toUpperCase();
    const l = (kind === "E" || kind === "G") && /\blaplace\b/i.test(t) ? laplaceLine(t.slice(t.split(/\s+/)[0].length)) : null;
    if (!l) {
      out.push(line);
      continue;
    }
    const name = t.split(/\s+/)[0];
    out.push(`* ${name}: LAPLACE as a state-space network`, ...stateSpace(name, kind === "E", l, rational(parseExpr(l.h), scope)));
  }
  return out.join("\n");
}
