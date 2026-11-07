// Ported from CircuitJS1 (Expr.java: ExprState, Expr, ExprParser) by Paul Falstad.
// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Licensed under the GNU General Public License v2 or later. See LICENSE.
//
// Expressions for controlled sources and other parts: variables a–i (inputs), da/dt … di/dt,
// lasta … lasti, t, timestep, lastoutput, pi, and a set of functions (sin, pwl, clamp, …).

import { JavaNumber } from "../io/tokens";

/** Values an expression reads: inputs, their previous values, the time and the last output. */
export class ExprState {
  values = new Array<number>(9).fill(0);
  lastValues = new Array<number>(9).fill(0);
  lastOutput = 0;
  t = 0;
  /** The simulator's time step (upstream reads the global simulator). */
  timeStep = 5e-6;

  constructor(_n = 0) {
    this.values[4] = Math.E;
  }

  updateLastValues(lastOut: number): void {
    this.lastOutput = lastOut;
    for (let i = 0; i !== this.values.length; i++) this.lastValues[i] = this.values[i];
  }

  reset(): void {
    for (let i = 0; i !== this.values.length; i++) this.lastValues[i] = 0;
    this.lastOutput = 0;
  }
}

/** Java's (int) cast of a double: truncate, saturate, NaN → 0. */
function toInt(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x >= 2147483647) return 2147483647;
  if (x <= -2147483648) return -2147483648;
  return Math.trunc(x);
}

function posmod(x: number, y: number): number {
  x %= y;
  return x >= 0 ? x : x + y;
}

export const E = {
  ADD: 1, SUB: 2, T: 3, VAL: 6, MUL: 7, DIV: 8, POW: 9, UMINUS: 10, SIN: 11, COS: 12, ABS: 13,
  EXP: 14, LOG: 15, SQRT: 16, TAN: 17, R: 18, MAX: 19, MIN: 20, CLAMP: 21, PWL: 22, TRIANGLE: 23,
  SAWTOOTH: 24, MOD: 25, STEP: 26, SELECT: 27, PWR: 28, PWRS: 29, LASTOUTPUT: 30, TIMESTEP: 31,
  TERNARY: 32, OR: 33, AND: 34, EQUALS: 35, LEQ: 36, GEQ: 37, LESS: 38, GREATER: 39, NEQ: 40,
  NOT: 41, FLOOR: 42, CEIL: 43, ASIN: 44, ACOS: 45, ATAN: 46, SINH: 47, COSH: 48, TANH: 49,
  BITAND: 50, BITOR: 51, RSHIFT: 52, A: 53, DADT: 63, LASTA: 73,
} as const;

export class Expr {
  children: Expr[] | null = null;
  value = 0;

  constructor(public type: number, value = 0) {
    this.value = value;
  }

  static op(e1: Expr, e2: Expr | null, type: number): Expr {
    const e = new Expr(type);
    e.children = e2 ? [e1, e2] : [e1];
    return e;
  }

  /** The expression compiled to a JavaScript function (built on first use), or false if it can't be. */
  private compiled: ((es: ExprState) => number) | false | null = null;

  eval(es: ExprState): number {
    if (this.compiled === null) this.compiled = compileExpr(this);
    return this.compiled ? this.compiled(es) : this.interpret(es);
  }

  /** Evaluate by walking the tree (what compiled expressions do in one function). */
  interpret(es: ExprState): number {
    const ch = this.children;
    const left = ch && ch.length > 0 ? ch[0] : null;
    const right = ch && ch.length === 2 ? ch[1] : null;
    switch (this.type) {
      case E.ADD: return left!.eval(es) + right!.eval(es);
      case E.SUB: return left!.eval(es) - right!.eval(es);
      case E.MUL: return left!.eval(es) * right!.eval(es);
      case E.DIV: return left!.eval(es) / right!.eval(es);
      case E.POW: return Math.pow(left!.eval(es), right!.eval(es));
      case E.OR: return left!.eval(es) !== 0 || right!.eval(es) !== 0 ? 1 : 0;
      case E.AND: return left!.eval(es) !== 0 && right!.eval(es) !== 0 ? 1 : 0;
      case E.EQUALS: return left!.eval(es) === right!.eval(es) ? 1 : 0;
      case E.NEQ: return left!.eval(es) !== right!.eval(es) ? 1 : 0;
      case E.LEQ: return left!.eval(es) <= right!.eval(es) ? 1 : 0;
      case E.GEQ: return left!.eval(es) >= right!.eval(es) ? 1 : 0;
      case E.LESS: return left!.eval(es) < right!.eval(es) ? 1 : 0;
      case E.GREATER: return left!.eval(es) > right!.eval(es) ? 1 : 0;
      case E.TERNARY: return ch![left!.eval(es) !== 0 ? 1 : 2].eval(es);
      case E.UMINUS: return -left!.eval(es);
      case E.NOT: return left!.eval(es) === 0 ? 1 : 0;
      case E.VAL: return this.value;
      case E.T: return es.t;
      case E.SIN: return Math.sin(left!.eval(es));
      case E.COS: return Math.cos(left!.eval(es));
      case E.ABS: return Math.abs(left!.eval(es));
      case E.EXP: return Math.exp(left!.eval(es));
      case E.LOG: return Math.log(left!.eval(es));
      case E.SQRT: return Math.sqrt(left!.eval(es));
      case E.TAN: return Math.tan(left!.eval(es));
      case E.ASIN: return Math.asin(left!.eval(es));
      case E.ACOS: return Math.acos(left!.eval(es));
      case E.ATAN: return Math.atan(left!.eval(es));
      case E.SINH: return Math.sinh(left!.eval(es));
      case E.COSH: return Math.cosh(left!.eval(es));
      case E.TANH: return Math.tanh(left!.eval(es));
      case E.BITAND: return toInt(left!.eval(es)) & toInt(right!.eval(es));
      case E.BITOR: return toInt(left!.eval(es)) | toInt(right!.eval(es));
      case E.RSHIFT: return toInt(left!.eval(es)) >> toInt(right!.eval(es));
      case E.FLOOR: return Math.floor(left!.eval(es));
      case E.CEIL: return Math.ceil(left!.eval(es));
      case E.MIN: {
        let x = left!.eval(es);
        for (let i = 1; i < ch!.length; i++) x = Math.min(x, ch![i].eval(es));
        return x;
      }
      case E.MAX: {
        let x = left!.eval(es);
        for (let i = 1; i < ch!.length; i++) x = Math.max(x, ch![i].eval(es));
        return x;
      }
      case E.CLAMP:
        return Math.min(Math.max(left!.eval(es), ch![1].eval(es)), ch![2].eval(es));
      case E.STEP: {
        const x = left!.eval(es);
        if (right === null) return x < 0 ? 0 : 1;
        return x > right.eval(es) ? 0 : x < 0 ? 0 : 1;
      }
      case E.SELECT: {
        const x = left!.eval(es);
        return ch![x > 0 ? 2 : 1].eval(es);
      }
      case E.TRIANGLE: {
        const x = posmod(left!.eval(es), Math.PI * 2) / Math.PI;
        return x < 1 ? -1 + x * 2 : 3 - x * 2;
      }
      case E.SAWTOOTH: {
        const x = posmod(left!.eval(es), Math.PI * 2) / Math.PI;
        return x - 1;
      }
      case E.MOD: return left!.eval(es) % right!.eval(es);
      case E.PWL: return Expr.pwl(es, ch!);
      case E.PWR: return Math.pow(Math.abs(left!.eval(es)), right!.eval(es));
      case E.PWRS: {
        const x = left!.eval(es);
        if (x < 0) return -Math.pow(-x, right!.eval(es));
        return Math.pow(x, right!.eval(es));
      }
      case E.LASTOUTPUT: return es.lastOutput;
      case E.TIMESTEP: return es.timeStep;
      default:
        if (this.type >= E.LASTA) return es.lastValues[this.type - E.LASTA];
        if (this.type >= E.DADT) return (es.values[this.type - E.DADT] - es.lastValues[this.type - E.DADT]) / es.timeStep;
        if (this.type >= E.A) return es.values[this.type - E.A];
    }
    return 0;
  }

  private static pwl(es: ExprState, args: Expr[]): number {
    const x = args[0].eval(es);
    let x0 = args[1].eval(es);
    let y0 = args[2].eval(es);
    if (x < x0) return y0;
    let x1 = args[3].eval(es);
    let y1 = args[4].eval(es);
    let i = 5;
    for (;;) {
      if (x < x1) return y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
      if (i + 1 >= args.length) break;
      x0 = x1;
      y0 = y1;
      x1 = args[i].eval(es);
      y1 = args[i + 1].eval(es);
      i += 2;
    }
    return y1;
  }
}

/**
 * Compile an expression to a JavaScript function: the same operations in the same order (so the
 * same results to the last bit), without walking the tree and dispatching on each node every time.
 * Rarely used, variable-length functions call back into the tree.
 */
function compileExpr(root: Expr): ((es: ExprState) => number) | false {
  const nodes: Expr[] = [];
  const lit = (x: number) => (Object.is(x, -0) ? "-0" : Number.isNaN(x) ? "NaN" : String(x));
  const tree = (e: Expr) => {
    nodes.push(e);
    return `nodes[${nodes.length - 1}].interpret(es)`;
  };
  const math: Record<number, string> = {
    [E.SIN]: "sin", [E.COS]: "cos", [E.ABS]: "abs", [E.EXP]: "exp", [E.LOG]: "log", [E.SQRT]: "sqrt",
    [E.TAN]: "tan", [E.ASIN]: "asin", [E.ACOS]: "acos", [E.ATAN]: "atan", [E.SINH]: "sinh",
    [E.COSH]: "cosh", [E.TANH]: "tanh", [E.FLOOR]: "floor", [E.CEIL]: "ceil",
  };
  const binary: Record<number, string> = { [E.ADD]: "+", [E.SUB]: "-", [E.MUL]: "*", [E.DIV]: "/", [E.MOD]: "%" };
  const compare: Record<number, string> = { [E.EQUALS]: "===", [E.NEQ]: "!==", [E.LEQ]: "<=", [E.GEQ]: ">=", [E.LESS]: "<", [E.GREATER]: ">" };
  const gen = (e: Expr): string => {
    const ch = e.children ?? [];
    const c = (i: number) => gen(ch[i]);
    const t = e.type;
    if (binary[t] && ch.length === 2) return `(${c(0)} ${binary[t]} ${c(1)})`;
    if (compare[t] && ch.length === 2) return `(${c(0)} ${compare[t]} ${c(1)} ? 1 : 0)`;
    if (math[t] && ch.length >= 1) return `Math.${math[t]}(${c(0)})`;
    switch (t) {
      case E.VAL: return `(${lit(e.value)})`;
      case E.T: return "es.t";
      case E.POW: return `Math.pow(${c(0)}, ${c(1)})`;
      case E.OR: return `(${c(0)} !== 0 || ${c(1)} !== 0 ? 1 : 0)`;
      case E.AND: return `(${c(0)} !== 0 && ${c(1)} !== 0 ? 1 : 0)`;
      case E.TERNARY: return `(${c(0)} !== 0 ? ${c(1)} : ${c(2)})`;
      case E.UMINUS: return `(-${c(0)})`;
      case E.NOT: return `(${c(0)} === 0 ? 1 : 0)`;
      case E.BITAND: return `(toInt(${c(0)}) & toInt(${c(1)}))`;
      case E.BITOR: return `(toInt(${c(0)}) | toInt(${c(1)}))`;
      case E.RSHIFT: return `(toInt(${c(0)}) >> toInt(${c(1)}))`;
      case E.CLAMP: return `Math.min(Math.max(${c(0)}, ${c(1)}), ${c(2)})`;
      case E.PWR: return `Math.pow(Math.abs(${c(0)}), ${c(1)})`;
      case E.LASTOUTPUT: return "es.lastOutput";
      case E.TIMESTEP: return "es.timeStep";
      case E.MIN:
      case E.MAX:
      case E.STEP:
      case E.SELECT:
      case E.TRIANGLE:
      case E.SAWTOOTH:
      case E.PWL:
      case E.PWRS:
        return tree(e);
    }
    if (t >= E.LASTA) return `es.lastValues[${t - E.LASTA}]`;
    if (t >= E.DADT) return `((es.values[${t - E.DADT}] - es.lastValues[${t - E.DADT}]) / es.timeStep)`;
    if (t >= E.A) return `es.values[${t - E.A}]`;
    return "0";
  };
  try {
    const body = gen(root);
    const make = new Function("nodes", "toInt", `return (es) => ${body};`) as (n: Expr[], ti: typeof toInt) => (es: ExprState) => number;
    return make(nodes, toInt);
  } catch {
    // code generation not allowed (or a very deep expression): walk the tree
    return false;
  }
}

const SIMPLE_FUNCS: Record<string, number> = {
  sin: E.SIN, cos: E.COS, asin: E.ASIN, acos: E.ACOS, atan: E.ATAN, sinh: E.SINH, cosh: E.COSH,
  tanh: E.TANH, abs: E.ABS, exp: E.EXP, log: E.LOG, sqrt: E.SQRT, tan: E.TAN, tri: E.TRIANGLE,
  saw: E.SAWTOOTH, floor: E.FLOOR, ceil: E.CEIL,
};
const MULTI_FUNCS: Record<string, [number, number, number]> = {
  min: [E.MIN, 2, 1000], max: [E.MAX, 2, 1000], pwl: [E.PWL, 2, 1000], mod: [E.MOD, 2, 2],
  step: [E.STEP, 1, 2], select: [E.SELECT, 3, 3], clamp: [E.CLAMP, 3, 3], pwr: [E.PWR, 2, 2],
  pwrs: [E.PWRS, 2, 2],
};

const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";
const isLower = (c: string | undefined) => c !== undefined && c >= "a" && c <= "z";

/** Recursive-descent parser; errors are collected rather than thrown. */
export class ExprParser {
  private readonly text: string;
  private token = "";
  private pos = 0;
  private readonly tlen: number;
  private err: string | null = null;

  constructor(s: string) {
    this.text = s.toLowerCase();
    this.tlen = this.text.length;
    this.getToken();
  }

  gotError(): string | null {
    return this.err;
  }

  private getToken(): void {
    const text = this.text, tlen = this.tlen;
    while (this.pos < tlen && text[this.pos] === " ") this.pos++;
    if (this.pos === tlen) {
      this.token = "";
      return;
    }
    let i = this.pos;
    const c = text[i];
    if (isDigit(c) || c === ".") {
      for (i = this.pos; i !== tlen; i++) {
        if (text[i] === "e" || text[i] === "E") {
          i++;
          if (i < tlen && (text[i] === "+" || text[i] === "-")) i++;
        }
        if (!(isDigit(text[i]) || text[i] === ".")) break;
      }
    } else if (isLower(c)) {
      for (i = this.pos; i !== tlen; i++) if (!isLower(text[i])) break;
    } else {
      i++;
      if (i < tlen) {
        // ||, &&, <<, >>, ==
        if (text[i] === c && (c === "|" || c === "&" || c === "<" || c === ">" || c === "=")) i++;
        // <=, >=, !=
        else if ((c === "<" || c === ">" || c === "!") && text[i] === "=") i++;
      }
    }
    // the exponent skip can step past the end of the text
    if (i > tlen) i = tlen;
    this.token = text.substring(this.pos, i);
    this.pos = i;
  }

  private skip(s: string): boolean {
    if (this.token !== s) return false;
    this.getToken();
    return true;
  }

  private setError(s: string): void {
    if (this.err === null) this.err = s;
  }

  private skipOrError(s: string): void {
    if (!this.skip(s)) this.setError(`expected ${s}, got ${this.token}`);
  }

  parseExpression(): Expr {
    if (this.token.length === 0) return new Expr(E.VAL, 0);
    const e = this.parse();
    if (this.token.length > 0) this.setError("unexpected token: " + this.token);
    return e;
  }

  private parse(): Expr {
    const e = this.parseOr();
    if (this.skip("?")) {
      const e2 = this.parseOr();
      this.skipOrError(":");
      const e3 = this.parse();
      const ret = Expr.op(e, e2, E.TERNARY);
      ret.children!.push(e3);
      return ret;
    }
    return e;
  }

  private parseOr(): Expr {
    let e = this.parseAnd();
    while (this.skip("||")) e = Expr.op(e, this.parseAnd(), E.OR);
    return e;
  }

  private parseAnd(): Expr {
    let e = this.parseBitOr();
    while (this.skip("&&")) e = Expr.op(e, this.parseBitOr(), E.AND);
    return e;
  }

  private parseBitOr(): Expr {
    let e = this.parseBitAnd();
    while (this.skip("|")) e = Expr.op(e, this.parseBitAnd(), E.BITOR);
    return e;
  }

  private parseBitAnd(): Expr {
    let e = this.parseEquals();
    while (this.skip("&")) e = Expr.op(e, this.parseEquals(), E.BITAND);
    return e;
  }

  private parseEquals(): Expr {
    const e = this.parseCompare();
    if (this.skip("==")) return Expr.op(e, this.parseCompare(), E.EQUALS);
    return e;
  }

  private parseCompare(): Expr {
    const e = this.parseShift();
    if (this.skip("<=")) return Expr.op(e, this.parseShift(), E.LEQ);
    if (this.skip(">=")) return Expr.op(e, this.parseShift(), E.GEQ);
    if (this.skip("!=")) return Expr.op(e, this.parseShift(), E.NEQ);
    if (this.skip("<")) return Expr.op(e, this.parseShift(), E.LESS);
    if (this.skip(">")) return Expr.op(e, this.parseShift(), E.GREATER);
    return e;
  }

  private parseShift(): Expr {
    let e = this.parseAdd();
    while (this.skip(">>")) e = Expr.op(e, this.parseAdd(), E.RSHIFT);
    return e;
  }

  private parseAdd(): Expr {
    let e = this.parseMult();
    for (;;) {
      if (this.skip("+")) e = Expr.op(e, this.parseMult(), E.ADD);
      else if (this.skip("-")) e = Expr.op(e, this.parseMult(), E.SUB);
      else break;
    }
    return e;
  }

  private parseMult(): Expr {
    let e = this.parseUminus();
    for (;;) {
      if (this.skip("*")) e = Expr.op(e, this.parseUminus(), E.MUL);
      else if (this.skip("/")) e = Expr.op(e, this.parseUminus(), E.DIV);
      else break;
    }
    return e;
  }

  private parseUminus(): Expr {
    this.skip("+");
    if (this.skip("!")) return Expr.op(this.parseUminus(), null, E.NOT);
    if (this.skip("-")) return Expr.op(this.parseUminus(), null, E.UMINUS);
    return this.parsePow();
  }

  private parsePow(): Expr {
    let e = this.parseTerm();
    while (this.skip("^")) e = Expr.op(e, this.parseTerm(), E.POW);
    return e;
  }

  private parseFunc(t: number): Expr {
    this.skipOrError("(");
    const e = this.parse();
    this.skipOrError(")");
    return Expr.op(e, null, t);
  }

  private parseFuncMulti(t: number, minArgs: number, maxArgs: number): Expr {
    let args = 1;
    this.skipOrError("(");
    const e = Expr.op(this.parse(), null, t);
    while (this.skip(",")) {
      e.children!.push(this.parse());
      args++;
    }
    this.skipOrError(")");
    if (args < minArgs || args > maxArgs) this.setError("bad number of function args: " + args);
    return e;
  }

  private parseTerm(): Expr {
    if (this.skip("(")) {
      const e = this.parse();
      this.skipOrError(")");
      return e;
    }
    if (this.skip("t")) return new Expr(E.T);
    const tok = this.token;
    if (tok.length === 1 && tok >= "a" && tok <= "i") {
      this.getToken();
      return new Expr(E.A + (tok.charCodeAt(0) - 97));
    }
    if (tok.startsWith("last") && tok.length === 5) {
      const c = tok[4];
      if (c >= "a" && c <= "i") {
        this.getToken();
        return new Expr(E.LASTA + (c.charCodeAt(0) - 97));
      }
    }
    if (tok.endsWith("dt") && tok.startsWith("d") && tok.length === 4) {
      const c = tok[1];
      if (c >= "a" && c <= "i") {
        this.getToken();
        return new Expr(E.DADT + (c.charCodeAt(0) - 97));
      }
    }
    if (this.skip("lastoutput")) return new Expr(E.LASTOUTPUT);
    if (this.skip("timestep")) return new Expr(E.TIMESTEP);
    if (this.skip("pi")) return new Expr(E.VAL, 3.14159265358979323846);
    if (Object.hasOwn(SIMPLE_FUNCS, tok) && this.skip(tok)) return this.parseFunc(SIMPLE_FUNCS[tok]);
    if (Object.hasOwn(MULTI_FUNCS, tok) && this.skip(tok)) {
      const [t, min, max] = MULTI_FUNCS[tok];
      return this.parseFuncMulti(t, min, max);
    }
    try {
      const e = new Expr(E.VAL, JavaNumber.parseDouble(tok));
      this.getToken();
      return e;
    } catch {
      if (tok.length === 0) this.setError("unexpected end of input");
      else this.setError("unrecognized token: " + tok);
      return new Expr(E.VAL, 0);
    }
  }
}
