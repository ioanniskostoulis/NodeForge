// SPICE expressions, as manufacturers' models use them: `{…}` values, `.param` and `.func`, and the
// behavioral sources (B, E/G VALUE / TABLE / POLY). Parsed once, parameters folded in, then
// differentiated symbolically (Newton needs the derivatives) and compiled to JavaScript.
// Functions and operators follow ngspice (and LTspice / PSpice where they add to it).
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { spiceNumber } from "./parse";

export type Expr =
  | { k: "num"; v: number }
  /** A parameter, `time` or `temper`. */
  | { k: "id"; name: string }
  /** A voltage or current the expression reads (index into the variables): only after binding. */
  | { k: "x"; i: number }
  | { k: "neg"; a: Expr }
  | { k: "not"; a: Expr }
  | { k: "bin"; op: string; a: Expr; b: Expr }
  | { k: "cond"; c: Expr; a: Expr; b: Expr }
  | { k: "call"; f: string; args: Expr[] }
  /** V(a) or V(a, b): node names as written. */
  | { k: "v"; a: string; b: string | null }
  /** I(Vname): a branch current. */
  | { k: "i"; name: string };

/** A user function (`.func name(args) {body}`). */
export interface SpiceFunc {
  args: string[];
  body: Expr;
}

// MARK: parsing

const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[a-zA-Zµ]*/;
const IDENT = /^[A-Za-z_][\w.$#]*/;
const OPS = ["**", "==", "!=", "<>", "<=", ">=", "&&", "||", "+", "-", "*", "/", "%", "^", "<", ">", "!", "?", ":", "(", ")", ",", "{", "}", "="];

/** Parse an expression (with or without its braces). Throws on a syntax error. */
export function parseExpr(text: string): Expr {
  const s = text.trim();
  let pos = 0;
  const fail = (what: string): never => {
    throw new Error(`${what} at "${s.slice(pos, pos + 12)}" in ${text.trim()}`);
  };
  const skip = () => {
    while (pos < s.length && /\s/.test(s[pos])) pos++;
  };
  const peek = (): string => {
    skip();
    for (const op of OPS) if (s.startsWith(op, pos)) return op;
    return "";
  };
  const take = (op: string): boolean => {
    if (peek() !== op) return false;
    pos += op.length;
    return true;
  };
  const expect = (op: string) => {
    if (!take(op)) fail(`expected "${op}"`);
  };
  /** A node or source name inside V( ) / I( ): anything up to a comma or the closing parenthesis. */
  const rawName = (): string => {
    skip();
    const m = /^[^\s,()]+/.exec(s.slice(pos));
    if (!m) fail("expected a name");
    pos += m![0].length;
    return m![0];
  };

  const primary = (): Expr => {
    skip();
    const rest = s.slice(pos);
    const num = NUMBER.exec(rest);
    if (num) {
      pos += num[0].length;
      return { k: "num", v: spiceNumber(num[0]) };
    }
    if (take("(")) {
      const e = ternary();
      expect(")");
      return e;
    }
    if (take("{")) {
      const e = ternary();
      expect("}");
      return e;
    }
    const id = IDENT.exec(rest);
    if (!id) return fail("expected a value");
    pos += id[0].length;
    const name = id[0].toLowerCase();
    if (peek() !== "(") return { k: "id", name };
    pos++;
    if (name === "v") {
      const a = rawName();
      const b = take(",") ? rawName() : null;
      expect(")");
      return { k: "v", a, b };
    }
    if (name === "i") {
      const n = rawName();
      expect(")");
      return { k: "i", name: n };
    }
    const args: Expr[] = [];
    if (!take(")")) {
      do args.push(ternary());
      while (take(","));
      expect(")");
    }
    return { k: "call", f: name, args };
  };
  // -x^2 is −(x²); the power is right-associative and takes a signed exponent (2^-1)
  const unary = (): Expr => {
    if (take("-")) return { k: "neg", a: unary() };
    if (take("+")) return unary();
    if (take("!")) return { k: "not", a: unary() };
    return power();
  };
  const power = (): Expr => {
    const a = primary();
    if (take("^") || take("**")) return { k: "bin", op: "^", a, b: unary() };
    return a;
  };
  const binary = (next: () => Expr, ops: string[]) => (): Expr => {
    let a = next();
    for (;;) {
      const op = peek();
      // "**" is power (handled lower down), not two "*"
      if (!ops.includes(op)) return a;
      pos += op.length;
      a = { k: "bin", op: op === "<>" ? "!=" : op, a, b: next() };
    }
  };
  const product = binary(unary, ["*", "/", "%"]);
  const sum = binary(product, ["+", "-"]);
  const compare = binary(sum, ["<", ">", "<=", ">="]);
  const equal = binary(compare, ["==", "!=", "<>"]);
  const and = binary(equal, ["&&"]);
  const or = binary(and, ["||"]);
  function ternary(): Expr {
    const c = or();
    if (!take("?")) return c;
    const a = ternary();
    expect(":");
    return { k: "cond", c, a, b: ternary() };
  }
  const e = ternary();
  skip();
  if (pos < s.length) fail("unexpected text");
  return e;
}

// MARK: parameters

/** Parameter values by (lower-case) name, looked up through enclosing scopes. */
export class ParamScope {
  private values = new Map<string, number>();
  private funcs = new Map<string, SpiceFunc>();
  constructor(readonly parent: ParamScope | null = null) {}

  get(name: string): number | undefined {
    return this.values.get(name) ?? this.parent?.get(name);
  }
  func(name: string): SpiceFunc | undefined {
    return this.funcs.get(name) ?? this.parent?.func(name);
  }
  /** Set a parameter from its text (a number or an expression over the parameters known so far). */
  set(name: string, text: string): void {
    this.values.set(name.toLowerCase(), this.eval(text));
  }
  setValue(name: string, v: number): void {
    this.values.set(name.toLowerCase(), v);
  }
  define(name: string, args: string[], body: string): void {
    this.funcs.set(name.toLowerCase(), { args: args.map((a) => a.toLowerCase()), body: parseExpr(body) });
  }
  /** A value as written: a number ("4.7k") or an expression ("{rg*2}", "rg*2"). Throws if it can't. */
  eval(text: string): number {
    const e = bind(parseExpr(text), this, null);
    if (e.k !== "num") throw new Error(`${text.trim()} isn't a constant`);
    return e.v;
  }
}

// MARK: binding and folding

/** The variables a bound expression reads: node voltages and branch currents, by index. */
export interface Variables {
  /** Index for a node name (V(n)), or for a branch (I(name)). */
  node(name: string): number;
  branch(name: string): number;
}

const CONSTANTS: Record<string, number> = { pi: Math.PI, boltz: 1.380649e-23, echarge: 1.602176634e-19, kelvin: -273.15, planck: 6.62607015e-34 };

/**
 * Fold in the parameters and user functions, so what's left reads only variables (`x`), `time`
 * and `temper`; constant parts are computed. `vars` is null for a constant expression.
 */
export function bind(e: Expr, scope: ParamScope, vars: Variables | null, locals?: Map<string, Expr>): Expr {
  const rec = (x: Expr): Expr => bind(x, scope, vars, locals);
  switch (e.k) {
    case "num":
    case "x":
      return e;
    case "id": {
      const local = locals?.get(e.name);
      if (local) return local;
      const v = scope.get(e.name);
      if (v !== undefined) return { k: "num", v };
      if (e.name === "time" || e.name === "temper") {
        if (!vars) throw new Error(`${e.name} isn't a constant`);
        return e;
      }
      if (e.name in CONSTANTS) return { k: "num", v: CONSTANTS[e.name] };
      throw new Error(`unknown parameter ${e.name}`);
    }
    case "v": {
      if (!vars) throw new Error("V() isn't a constant");
      const a: Expr = { k: "x", i: vars.node(e.a) };
      return e.b === null ? a : fold({ k: "bin", op: "-", a, b: { k: "x", i: vars.node(e.b) } });
    }
    case "i":
      if (!vars) throw new Error("I() isn't a constant");
      return { k: "x", i: vars.branch(e.name) };
    case "neg":
      return fold({ k: "neg", a: rec(e.a) });
    case "not":
      return fold({ k: "not", a: rec(e.a) });
    case "bin":
      return fold({ k: "bin", op: e.op, a: rec(e.a), b: rec(e.b) });
    case "cond":
      return fold({ k: "cond", c: rec(e.c), a: rec(e.a), b: rec(e.b) });
    case "call": {
      const args = e.args.map(rec);
      const user = scope.func(e.f);
      if (user) {
        if (user.args.length !== args.length) throw new Error(`${e.f}() takes ${user.args.length} arguments`);
        const inner = new Map(user.args.map((a, i) => [a, args[i]] as [string, Expr]));
        return bind(user.body, scope, vars, inner);
      }
      if (!(e.f in FUNCS)) throw new Error(`unknown function ${e.f}()`);
      const f = FUNCS[e.f];
      if (args.length < f.min || args.length > f.max) throw new Error(`${e.f}() takes ${f.min === f.max ? f.min : `${f.min}–${f.max}`} arguments`);
      return fold({ k: "call", f: e.f, args });
    }
  }
}

/** Compute what's constant; simplify 0 and 1 (derivatives are full of them). */
function fold(e: Expr): Expr {
  const num = (x: Expr): x is { k: "num"; v: number } => x.k === "num";
  switch (e.k) {
    case "neg":
      if (num(e.a)) return { k: "num", v: -e.a.v };
      if (e.a.k === "neg") return e.a.a;
      return e;
    case "not":
      return num(e.a) ? { k: "num", v: e.a.v ? 0 : 1 } : e;
    case "cond":
      return num(e.c) ? (e.c.v ? e.a : e.b) : e;
    case "bin": {
      const { a, b, op } = e;
      if (num(a) && num(b)) return { k: "num", v: BIN[op](a.v, b.v) };
      const zero = (x: Expr) => num(x) && x.v === 0, one = (x: Expr) => num(x) && x.v === 1;
      if (op === "+") return zero(a) ? b : zero(b) ? a : e;
      if (op === "-") return zero(b) ? a : zero(a) ? fold({ k: "neg", a: b }) : e;
      if (op === "*") return zero(a) || zero(b) ? { k: "num", v: 0 } : one(a) ? b : one(b) ? a : e;
      if (op === "/") return zero(a) ? { k: "num", v: 0 } : one(b) ? a : e;
      if (op === "^") return zero(b) ? { k: "num", v: 1 } : one(b) ? a : e;
      return e;
    }
    case "call":
      if (e.args.every(num)) return { k: "num", v: FUNCS[e.f].fn(...e.args.map((x) => (x as { v: number }).v)) };
      return e;
    default:
      return e;
  }
}

// MARK: functions

/** x^y as ngspice: a negative base with a non-integer power uses |x|. */
function power(x: number, y: number): number {
  return x < 0 && !Number.isInteger(y) ? Math.pow(-x, y) : Math.pow(x, y);
}
/** Piecewise-linear lookup (TABLE, table()): flat beyond the ends. */
function table(x: number, ...pts: number[]): number {
  const n = pts.length >> 1;
  if (!n) return 0;
  if (x <= pts[0]) return pts[1];
  for (let k = 1; k < n; k++) {
    const x1 = pts[2 * k];
    if (x <= x1) {
      const x0 = pts[2 * k - 2], y0 = pts[2 * k - 1], y1 = pts[2 * k + 1];
      return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return pts[2 * n - 1];
}
function tableSlope(x: number, ...pts: number[]): number {
  const n = pts.length >> 1;
  if (n < 2 || x <= pts[0] || x >= pts[2 * n - 2]) return 0;
  for (let k = 1; k < n; k++) {
    if (x <= pts[2 * k]) {
      const dx = pts[2 * k] - pts[2 * k - 2];
      return dx ? (pts[2 * k + 1] - pts[2 * k - 1]) / dx : 0;
    }
  }
  return 0;
}
const sgn = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0);

/** Built-in functions: the value, and the derivative by each argument (chain rule applied by diff). */
const FUNCS: Record<string, { min: number; max: number; fn: (...a: number[]) => number; js: string }> = {
  abs: { min: 1, max: 1, fn: Math.abs, js: "Math.abs" },
  sqrt: { min: 1, max: 1, fn: (x) => (x < 0 ? 0 : Math.sqrt(x)), js: "H.sqrt" },
  exp: { min: 1, max: 1, fn: Math.exp, js: "Math.exp" },
  ln: { min: 1, max: 1, fn: Math.log, js: "Math.log" },
  log: { min: 1, max: 1, fn: Math.log, js: "Math.log" },
  log10: { min: 1, max: 1, fn: Math.log10, js: "Math.log10" },
  sin: { min: 1, max: 1, fn: Math.sin, js: "Math.sin" },
  cos: { min: 1, max: 1, fn: Math.cos, js: "Math.cos" },
  tan: { min: 1, max: 1, fn: Math.tan, js: "Math.tan" },
  asin: { min: 1, max: 1, fn: Math.asin, js: "Math.asin" },
  acos: { min: 1, max: 1, fn: Math.acos, js: "Math.acos" },
  atan: { min: 1, max: 1, fn: Math.atan, js: "Math.atan" },
  arctan: { min: 1, max: 1, fn: Math.atan, js: "Math.atan" },
  atan2: { min: 2, max: 2, fn: Math.atan2, js: "Math.atan2" },
  sinh: { min: 1, max: 1, fn: Math.sinh, js: "Math.sinh" },
  cosh: { min: 1, max: 1, fn: Math.cosh, js: "Math.cosh" },
  tanh: { min: 1, max: 1, fn: Math.tanh, js: "Math.tanh" },
  min: { min: 2, max: 2, fn: Math.min, js: "Math.min" },
  max: { min: 2, max: 2, fn: Math.max, js: "Math.max" },
  pow: { min: 2, max: 2, fn: power, js: "H.power" },
  pwr: { min: 2, max: 2, fn: (x, y) => Math.pow(Math.abs(x), y), js: "H.pwr" },
  pwrs: { min: 2, max: 2, fn: (x, y) => sgn(x) * Math.pow(Math.abs(x), y), js: "H.pwrs" },
  sgn: { min: 1, max: 1, fn: sgn, js: "H.sgn" },
  sign: { min: 1, max: 1, fn: sgn, js: "H.sgn" },
  u: { min: 1, max: 1, fn: (x) => (x > 0 ? 1 : 0), js: "H.u" },
  step: { min: 1, max: 1, fn: (x) => (x > 0 ? 1 : 0), js: "H.u" },
  uramp: { min: 1, max: 1, fn: (x) => (x > 0 ? x : 0), js: "H.uramp" },
  int: { min: 1, max: 1, fn: Math.trunc, js: "Math.trunc" },
  floor: { min: 1, max: 1, fn: Math.floor, js: "Math.floor" },
  ceil: { min: 1, max: 1, fn: Math.ceil, js: "Math.ceil" },
  round: { min: 1, max: 1, fn: Math.round, js: "Math.round" },
  limit: { min: 3, max: 3, fn: (x, a, b) => Math.min(Math.max(x, Math.min(a, b)), Math.max(a, b)), js: "H.limit" },
  if: { min: 3, max: 3, fn: (c, a, b) => (c ? a : b), js: "H.iff" },
  table: { min: 3, max: 999, fn: table, js: "H.table" },
  tableslope: { min: 3, max: 999, fn: tableSlope, js: "H.tableSlope" },
};

const BIN: Record<string, (a: number, b: number) => number> = {
  "+": (a, b) => a + b,
  "-": (a, b) => a - b,
  "*": (a, b) => a * b,
  "/": (a, b) => a / b,
  "%": (a, b) => a % b,
  "^": power,
  "<": (a, b) => +(a < b),
  ">": (a, b) => +(a > b),
  "<=": (a, b) => +(a <= b),
  ">=": (a, b) => +(a >= b),
  "==": (a, b) => +(a === b),
  "!=": (a, b) => +(a !== b),
  "&&": (a, b) => +(!!a && !!b),
  "||": (a, b) => +(!!a || !!b),
};

/** Helpers the compiled functions call. */
const H = {
  sqrt: FUNCS.sqrt.fn, power, pwr: FUNCS.pwr.fn, pwrs: FUNCS.pwrs.fn, sgn, u: FUNCS.u.fn, uramp: FUNCS.uramp.fn,
  limit: FUNCS.limit.fn, iff: FUNCS.if.fn, table, tableSlope,
};

// MARK: derivatives

const n = (v: number): Expr => ({ k: "num", v });
const add = (a: Expr, b: Expr) => fold({ k: "bin", op: "+", a, b });
const sub = (a: Expr, b: Expr) => fold({ k: "bin", op: "-", a, b });
const mul = (a: Expr, b: Expr) => fold({ k: "bin", op: "*", a, b });
const div = (a: Expr, b: Expr) => fold({ k: "bin", op: "/", a, b });
const call = (f: string, ...args: Expr[]): Expr => fold({ k: "call", f, args });

/** d e / d x_i, symbolically (a bound expression). */
export function diff(e: Expr, i: number): Expr {
  switch (e.k) {
    case "num":
    case "id":
    case "not":
    case "v":
    case "i":
      return n(0);
    case "x":
      return n(e.i === i ? 1 : 0);
    case "neg":
      return fold({ k: "neg", a: diff(e.a, i) });
    case "cond":
      return fold({ k: "cond", c: e.c, a: diff(e.a, i), b: diff(e.b, i) });
    case "bin": {
      const { a, b } = e;
      const da = diff(a, i), db = diff(b, i);
      switch (e.op) {
        case "+":
          return add(da, db);
        case "-":
          return sub(da, db);
        case "*":
          return add(mul(da, b), mul(a, db));
        case "/":
          return div(sub(mul(da, b), mul(a, db)), mul(b, b));
        case "%":
          return da;
        case "^":
          if (b.k === "num") return mul(mul(n(b.v), fold({ k: "bin", op: "^", a, b: n(b.v - 1) })), da);
          // a^b (db ln|a| + b da / a)
          return mul(e, add(mul(db, call("ln", call("abs", a))), div(mul(b, da), a)));
        default:
          // comparisons and logic: flat
          return n(0);
      }
    }
    case "call": {
      const [a, b, c] = e.args;
      const da = diff(a, i);
      switch (e.f) {
        case "abs":
          return mul(call("sgn", a), da);
        case "sqrt":
          return fold({ k: "cond", c: { k: "bin", op: ">", a, b: n(0) }, a: div(da, mul(n(2), e)), b: n(0) });
        case "exp":
          return mul(e, da);
        case "ln":
        case "log":
          return div(da, a);
        case "log10":
          return div(da, mul(a, n(Math.LN10)));
        case "sin":
          return mul(call("cos", a), da);
        case "cos":
          return mul(fold({ k: "neg", a: call("sin", a) }), da);
        case "tan":
          return div(da, mul(call("cos", a), call("cos", a)));
        case "asin":
          return div(da, call("sqrt", sub(n(1), mul(a, a))));
        case "acos":
          return fold({ k: "neg", a: div(da, call("sqrt", sub(n(1), mul(a, a)))) });
        case "atan":
        case "arctan":
          return div(da, add(n(1), mul(a, a)));
        case "atan2": {
          // d atan2(y, x) = (x dy − y dx) / (x² + y²)
          const db = diff(b, i);
          return div(sub(mul(b, da), mul(a, db)), add(mul(a, a), mul(b, b)));
        }
        case "sinh":
          return mul(call("cosh", a), da);
        case "cosh":
          return mul(call("sinh", a), da);
        case "tanh":
          return mul(sub(n(1), mul(e, e)), da);
        case "min":
          return fold({ k: "cond", c: { k: "bin", op: "<=", a, b }, a: da, b: diff(b, i) });
        case "max":
          return fold({ k: "cond", c: { k: "bin", op: ">=", a, b }, a: da, b: diff(b, i) });
        case "pow":
          return diff({ k: "bin", op: "^", a, b }, i);
        case "pwr":
        case "pwrs": {
          // |a|^b (db ln|a| + b da / a), with the sign for pwrs
          const db = diff(b, i);
          if (b.k === "num") {
            const d = mul(mul(n(b.v), call("pwr", a, n(b.v - 1))), da);
            return e.f === "pwr" ? mul(call("sgn", a), d) : d;
          }
          return mul(e, add(mul(db, call("ln", call("abs", a))), div(mul(b, da), a)));
        }
        case "uramp":
          return mul(call("u", a), da);
        case "limit": {
          const lo = call("min", b, c), hi = call("max", b, c);
          const inside: Expr = { k: "bin", op: "&&", a: { k: "bin", op: ">", a, b: lo }, b: { k: "bin", op: "<", a, b: hi } };
          return fold({ k: "cond", c: inside, a: da, b: n(0) });
        }
        case "if":
          return fold({ k: "cond", c: a, a: diff(b, i), b: diff(c, i) });
        case "table":
          return mul(call("tableslope", ...e.args), da);
        default:
          // sgn, u, step, int, floor, ceil, round, tableslope: piecewise flat
          return n(0);
      }
    }
  }
}

/** Does an expression read variable i? */
export function reads(e: Expr, i: number): boolean {
  switch (e.k) {
    case "x":
      return e.i === i;
    case "neg":
    case "not":
      return reads(e.a, i);
    case "bin":
      return reads(e.a, i) || reads(e.b, i);
    case "cond":
      return reads(e.c, i) || reads(e.a, i) || reads(e.b, i);
    case "call":
      return e.args.some((a) => reads(a, i));
    default:
      return false;
  }
}

// MARK: compiling

/** A compiled expression: its value from the variables, the time and the temperature (°C). */
export type Compiled = (x: Float64Array, time: number, temper: number) => number;

function js(e: Expr): string {
  switch (e.k) {
    case "num":
      return Number.isFinite(e.v) ? `(${e.v})` : e.v > 0 ? "Infinity" : e.v < 0 ? "-Infinity" : "NaN";
    case "x":
      return `x[${e.i}]`;
    case "id":
      return e.name === "time" ? "t" : "temper";
    case "neg":
      return `(-${js(e.a)})`;
    case "not":
      return `(${js(e.a)} ? 0 : 1)`;
    case "cond":
      return `(${js(e.c)} ? ${js(e.a)} : ${js(e.b)})`;
    case "bin": {
      const a = js(e.a), b = js(e.b);
      if (e.op === "^") return `H.power(${a}, ${b})`;
      if (["+", "-", "*", "/", "%"].includes(e.op)) return `(${a} ${e.op} ${b})`;
      if (e.op === "==") return `(${a} === ${b} ? 1 : 0)`;
      if (e.op === "!=") return `(${a} !== ${b} ? 1 : 0)`;
      if (e.op === "&&" || e.op === "||") return `((${a} ${e.op === "&&" ? "&&" : "||"} ${b}) ? 1 : 0)`;
      return `(${a} ${e.op} ${b} ? 1 : 0)`;
    }
    case "call":
      return `${FUNCS[e.f].js}(${e.args.map(js).join(", ")})`;
    default:
      throw new Error("unbound expression");
  }
}

/** Compile a bound expression. */
export function compile(e: Expr): Compiled {
  const make = new Function("H", `return (x, t, temper) => ${js(e)};`) as (h: typeof H) => Compiled;
  return make(H);
}

/** A value and its derivatives by each of n variables, compiled. */
export function compileWithDerivatives(e: Expr, count: number): { f: Compiled; df: Compiled[] } {
  return { f: compile(e), df: Array.from({ length: count }, (_, i) => compile(diff(e, i))) };
}

/**
 * SPICE's POLY(n) as an expression over the controlling values: the coefficients in SPICE's order,
 * p0 + Σ pi·xi + Σi≤j pij·xi·xj + Σi≤j≤k pijk·xi·xj·xk + …
 */
export function polyExpr(xs: Expr[], coeffs: number[]): Expr {
  const terms: Expr[] = [];
  let k = 0;
  const monomials = (degree: number, from: number, prefix: Expr[]): void => {
    if (k >= coeffs.length) return;
    if (prefix.length === degree) {
      const c = coeffs[k++];
      if (c) terms.push(prefix.reduce<Expr>((acc, x) => mul(acc, x), n(c)));
      return;
    }
    for (let i = from; i < xs.length && k < coeffs.length; i++) monomials(degree, i, [...prefix, xs[i]]);
  };
  for (let degree = 0; k < coeffs.length; degree++) monomials(degree, 0, []);
  return terms.reduce<Expr>((acc, t) => add(acc, t), n(0));
}
