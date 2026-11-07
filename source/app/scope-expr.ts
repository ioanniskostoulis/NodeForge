// Expressions for scope traces typed in the terminal: V(D1)*I(D1), Vgs(M1) - 2, abs(I(L1)), …
// A quantity is its label and a part, as in the scope's legend (V, I, P, Vgs, Vds, Id, Ig, Vbe, Vbc,
// Vce, Ib, Ic, Ie, R, Q); numbers take SI prefixes (10k, 4.7u); + − × ÷ ^ and a few functions.

export interface ExprRef {
  label: string;
  part: string;
}

export type Ast =
  | { kind: "num"; value: number }
  | { kind: "ref"; ref: ExprRef }
  | { kind: "neg"; arg: Ast }
  | { kind: "bin"; op: "+" | "-" | "*" | "/" | "^"; a: Ast; b: Ast }
  | { kind: "call"; fn: string; args: Ast[] };

const FUNCTIONS: Record<string, { arity: number; f: (...x: number[]) => number }> = {
  abs: { arity: 1, f: Math.abs }, sqrt: { arity: 1, f: Math.sqrt }, exp: { arity: 1, f: Math.exp },
  ln: { arity: 1, f: Math.log }, log10: { arity: 1, f: Math.log10 },
  sin: { arity: 1, f: Math.sin }, cos: { arity: 1, f: Math.cos }, tan: { arity: 1, f: Math.tan },
  min: { arity: 2, f: Math.min }, max: { arity: 2, f: Math.max }, pow: { arity: 2, f: Math.pow },
};
const SI: Record<string, number> = { T: 1e12, G: 1e9, M: 1e6, k: 1e3, m: 1e-3, u: 1e-6, "µ": 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 };

/** Parse an expression; throws an Error saying what's wrong and where. */
export function parseExpr(text: string): Ast {
  const tokens = text.match(/\d*\.?\d+(?:e[+-]?\d+)?[TGMkmuµnpf]?|[A-Za-z_#][\w#]*|\*\*|[-+*/^(),]|\S/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const take = (t?: string) => {
    const tok = tokens[i];
    if (t !== undefined && tok !== t) throw new Error(tok === undefined ? `Expected "${t}" at the end.` : `Expected "${t}" before "${tok}".`);
    i++;
    return tok;
  };
  const primary = (): Ast => {
    const tok = peek();
    if (tok === undefined) throw new Error("The expression ends too early.");
    if (tok === "(") { take("("); const e = sum(); take(")"); return e; }
    if (tok === "-") { take(); return { kind: "neg", arg: power() }; }
    if (tok === "+") { take(); return power(); }
    if (/^\d|^\./.test(tok)) {
      take();
      const last = tok.slice(-1), mult = SI[last];
      const value = mult !== undefined && !/\d/.test(last) ? Number(tok.slice(0, -1)) * mult : Number(tok);
      if (!Number.isFinite(value)) throw new Error(`"${tok}" isn't a number.`);
      return { kind: "num", value };
    }
    if (/^[A-Za-z_]/.test(tok)) {
      take();
      if (tok.toLowerCase() === "pi") return { kind: "num", value: Math.PI };
      if (peek() !== "(") throw new Error(`"${tok}" needs brackets: ${tok}(part) for a quantity, or a function call.`);
      take("(");
      const fn = FUNCTIONS[tok.toLowerCase()];
      if (fn) {
        const args = [sum()];
        while (peek() === ",") { take(","); args.push(sum()); }
        take(")");
        if (args.length !== fn.arity) throw new Error(`${tok} takes ${fn.arity === 1 ? "one value" : `${fn.arity} values`}.`);
        return { kind: "call", fn: tok.toLowerCase(), args };
      }
      // a quantity of a part: V(R1)
      const part = take();
      if (part === undefined || !/^[A-Za-z_#][\w#]*$/.test(part)) throw new Error(`${tok}( needs a part name, e.g. ${tok}(R1).`);
      take(")");
      return { kind: "ref", ref: { label: tok, part } };
    }
    throw new Error(`Unexpected "${tok}".`);
  };
  // ^ binds tightest and to the right; a leading minus applies to the power (−x^2 = −(x^2))
  const power = (): Ast => {
    const base = primary();
    if (peek() === "^" || peek() === "**") { take(); return { kind: "bin", op: "^", a: base, b: unary() }; }
    return base;
  };
  const unary = (): Ast => (peek() === "-" ? (take(), { kind: "neg", arg: unary() }) : power());
  const product = (): Ast => {
    let a = unary();
    while (peek() === "*" || peek() === "/") { const op = take() as "*" | "/"; a = { kind: "bin", op, a, b: unary() }; }
    return a;
  };
  const sum = (): Ast => {
    let a = product();
    while (peek() === "+" || peek() === "-") { const op = take() as "+" | "-"; a = { kind: "bin", op, a, b: product() }; }
    return a;
  };
  if (!tokens.length) throw new Error("Enter an expression, e.g. V(D1)*I(D1).");
  const ast = sum();
  if (i < tokens.length) throw new Error(`Unexpected "${tokens[i]}".`);
  return ast;
}

/** The quantities an expression reads, each once, in order. */
export function refsOf(ast: Ast): ExprRef[] {
  const out: ExprRef[] = [];
  const visit = (n: Ast) => {
    if (n.kind === "ref") { if (!out.some((r) => r.label === n.ref.label && r.part === n.ref.part)) out.push(n.ref); }
    else if (n.kind === "neg") visit(n.arg);
    else if (n.kind === "bin") { visit(n.a); visit(n.b); }
    else if (n.kind === "call") n.args.forEach(visit);
  };
  visit(ast);
  return out;
}

/** A function of the referenced quantities' values (in refsOf order). */
export function compileExpr(ast: Ast): (values: ArrayLike<number>) => number {
  const refs = refsOf(ast);
  const index = (r: ExprRef) => refs.findIndex((x) => x.label === r.label && x.part === r.part);
  const build = (n: Ast): ((v: ArrayLike<number>) => number) => {
    switch (n.kind) {
      case "num": { const c = n.value; return () => c; }
      case "ref": { const k = index(n.ref); return (v) => v[k]; }
      case "neg": { const a = build(n.arg); return (v) => -a(v); }
      case "bin": {
        const a = build(n.a), b = build(n.b);
        switch (n.op) {
          case "+": return (v) => a(v) + b(v);
          case "-": return (v) => a(v) - b(v);
          case "*": return (v) => a(v) * b(v);
          case "/": return (v) => a(v) / b(v);
          case "^": return (v) => Math.pow(a(v), b(v));
        }
      }
      // falls through only for exhaustiveness
      case "call": {
        const call = n as Extract<Ast, { kind: "call" }>;
        const f = FUNCTIONS[call.fn].f, args = call.args.map(build);
        return args.length === 1 ? (v) => f(args[0](v)) : (v) => f(...args.map((g) => g(v)));
      }
    }
  };
  return build(ast);
}

/** The unit of the result, from the quantities' units (V × A = W, V ÷ A = Ω; functions are plain). */
export function unitOf(ast: Ast, refUnit: (r: ExprRef) => string): string {
  const u = (n: Ast): string => {
    switch (n.kind) {
      case "num": return "";
      case "ref": return refUnit(n.ref);
      case "neg": return u(n.arg);
      case "bin": {
        const a = u(n.a), b = u(n.b);
        if (n.op === "+" || n.op === "-") return a || b;
        if (n.op === "^") return "";
        if (n.op === "*") return !a ? b : !b ? a : (a === "V" && b === "A") || (a === "A" && b === "V") ? "W" : `${a}·${b}`;
        return !b ? a : a === b ? "" : a === "V" && b === "A" ? "Ω" : a === "W" && b === "A" ? "V" : a === "W" && b === "V" ? "A" : `${a}/${b}`;
      }
      case "call": return n.fn === "abs" || n.fn === "min" || n.fn === "max" ? u(n.args[0]) : "";
    }
  };
  return u(ast);
}

/** The expression as text, each quantity written by `ref` (designators for display, indices for files). */
export function printExpr(ast: Ast, ref: (r: ExprRef) => string): string {
  const prec = (n: Ast) => n.kind === "bin" ? { "+": 1, "-": 1, "*": 2, "/": 2, "^": 4 }[n.op] : n.kind === "neg" ? 3 : 5;
  const p = (n: Ast): string => {
    switch (n.kind) {
      case "num": return String(Number(n.value.toPrecision(6)));
      case "ref": return ref(n.ref);
      case "neg": return `-${prec(n.arg) < 3 ? `(${p(n.arg)})` : p(n.arg)}`;
      case "bin": {
        const pa = prec(n.a) < prec(n) || (n.op === "^" && prec(n.a) <= prec(n)) ? `(${p(n.a)})` : p(n.a);
        const pb = prec(n.b) < prec(n) || (n.op !== "^" && n.op !== "+" && n.op !== "*" && prec(n.b) <= prec(n)) ? `(${p(n.b)})` : p(n.b);
        return n.op === "^" ? `${pa}^${pb}` : `${pa}${n.op === "*" ? "×" : n.op === "/" ? "/" : ` ${n.op === "-" ? "−" : "+"} `}${pb}`;
      }
      case "call": return `${n.fn}(${n.args.map(p).join(", ")})`;
    }
  };
  return p(ast);
}

/** Text that re-parses (ASCII operators): what files keep. */
export function sourceExpr(ast: Ast, ref: (r: ExprRef) => string): string {
  return printExpr(ast, ref).replace(/×/g, "*").replace(/−/g, "-");
}
