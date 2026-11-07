// Scope expressions typed in the terminal: parsing, values, units and printing.
import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({ entryPoints: ["source/app/scope-expr.ts"], bundle: true, platform: "node", format: "esm", write: false });
const { compileExpr, parseExpr, printExpr, refsOf, sourceExpr, unitOf } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);

const value = (text, vals) => compileExpr(parseExpr(text))(vals);
assert.equal(value("V(D1)*I(D1)", [0.7, 2]), 1.4);
assert.equal(value("V(R1) - V(R2)", [5, 3]), 2);
assert.equal(value("-V(R1)^2", [3]), -9, "a leading minus applies after the power");
assert.equal(value("2^3^2", [0]), 512, "powers bind to the right");
assert.equal(value("abs(I(L1)) * 10k", [-0.002]), 20, "SI prefixes on numbers");
assert.equal(value("max(V(A1), 4.7u*1e6)", [3]), 4.7);
assert.ok(Math.abs(value("sin(pi/2) + V(X)", [1]) - 2) < 1e-12);
assert.deepEqual(refsOf(parseExpr("V(R1)*I(R1) + V(R1)")).map((r) => `${r.label}(${r.part})`), ["V(R1)", "I(R1)"], "each quantity once");
// units from the quantities
const u = (text) => unitOf(parseExpr(text), (r) => ({ V: "V", I: "A", Vgs: "V", P: "W" })[r.label]);
assert.equal(u("V(D1)*I(D1)"), "W");
assert.equal(u("V(R1)/I(R1)"), "Ω");
assert.equal(u("Vgs(M1) - 2"), "V");
assert.equal(u("V(A)/V(B)"), "");
// printing: display and the form files keep (which parses back)
const ast = parseExpr("(V(R1)-V(R2))*2");
assert.equal(printExpr(ast, (r) => `${r.label}(${r.part})`), "(V(R1) − V(R2))×2");
const saved = sourceExpr(ast, (r) => `${r.label}(#${r.part === "R1" ? 3 : 4})`);
assert.equal(saved, "(V(#3) - V(#4))*2");
assert.equal(compileExpr(parseExpr(saved))([5, 3]), 4);
// mistakes say what's wrong
for (const [text, message] of [["V(", /part name/], ["foo(R1", /Expected/], ["V(R1) +", /ends too early/], ["sqrt(1, 2)", /one value/], ["R1", /brackets/]]) {
  assert.throws(() => parseExpr(text), message, text);
}
console.log("Scope expressions passed: parsing, precedence, SI numbers, functions, units, printing and errors.");
