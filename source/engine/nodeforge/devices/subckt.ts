// Imported subcircuits: a `.subckt` turned into devices on its part's nodes (pins on the part's
// posts, inner nodes as extra internal nodes, node 0 as ground), nested X calls expanded with their
// parameters, and the group run as one device.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { VoltageSource } from "../../circuitjs/core/nodes";
import { bind, compileWithDerivatives, type Expr, ParamScope, parseExpr, polyExpr } from "../spice/expr";
import { laplaceLine, type Rational, rational, scaled } from "../spice/laplace";
import { addParams, libraryScope, resolveModel } from "../spice/params";
import { isNumber, parseSpice, type SpiceElement, type SpiceModel, type SpiceSubckt } from "../spice/parse";
import { BehavioralDevice, type Variable } from "./behavioral";
import { BjtDevice, bjtParams } from "./bjt";
import { JfetDevice, jfetParams } from "./jfet";
import { Device, type DeviceHost, simSelfHeating, T_DEFAULT } from "./device";
import { DiodeDevice, diodeParams } from "./diode";
import { type Branch, CapacitorDevice, CccsDevice, CcvsDevice, CurrentDevice, InductorDevice, ResistorDevice, VccsDevice, VcvsDevice, VoltageDevice } from "./linear";
import { Mos1Device, mos1Params } from "./mos1";
import { Mos2Device, mos2Params } from "./mos2";
import { Mos3Device, mos3Params } from "./mos3";
import { VdmosDevice, vdmosParams } from "./vdmos";

/** Several devices run as one (a subcircuit's contents). */
export class DeviceGroup extends Device {
  /** Which device each of the group's voltage sources belongs to. */
  private owners = new Map<VoltageSource, Device>();
  private vsSlots: [Device, number][] = [];

  constructor(host: DeviceHost, readonly devices: Device[]) {
    super(host);
    for (const d of devices) for (let i = 0; i < d.voltageSourceCount(); i++) this.vsSlots.push([d, i]);
  }
  override voltageSourceCount(): number {
    return this.vsSlots.length;
  }
  override setVoltageSource(i: number, vs: VoltageSource): void {
    const [d, k] = this.vsSlots[i];
    d.setVoltageSource(k, vs);
    this.owners.set(vs, d);
  }
  override setCurrent(vs: VoltageSource, c: number): void {
    this.owners.get(vs)?.setCurrent(vs, c);
  }
  override nonLinear(): boolean {
    return this.devices.some((d) => d.nonLinear());
  }
  override stamp(): void {
    for (const d of this.devices) d.stamp();
  }
  override startIteration(): void {
    for (const d of this.devices) d.startIteration();
  }
  override doStep(): void {
    for (const d of this.devices) d.doStep();
  }
  override stepFinished(): void {
    for (const d of this.devices) d.stepFinished();
  }
  override reset(): void {
    for (const d of this.devices) d.reset();
  }
  override states(values: number[], abstol: number[]): void {
    for (const d of this.devices) d.states(values, abstol);
  }
  override currents(into: number[]): void {
    for (const d of this.devices) d.currents(into);
  }
}

/** Where the models, subcircuits and top-level parameters a subcircuit refers to come from. */
export interface SpiceScope {
  model(name: string): SpiceModel | null;
  subckt(name: string): SpiceSubckt | null;
  params: ParamScope;
  /** Problems with the top-level parameters. */
  problems: string[];
}

/** A scope over the text of a model definition (its own models, subcircuits and parameters). */
export function scopeOf(text: string): SpiceScope {
  const lib = parseSpice(text);
  const problems: string[] = [];
  return {
    model: (n) => lib.models.get(n.toLowerCase()) ?? null,
    subckt: (n) => lib.subckts.get(n.toLowerCase()) ?? null,
    params: libraryScope(lib, problems),
    problems,
  };
}

export interface BuiltSubckt {
  device: DeviceGroup;
  /** Internal nodes the part must add (numbered from the first index given). */
  internalNodes: number;
  /** What couldn't be built (unsupported elements, unknown models). */
  problems: string[];
  /** Each named node of the subcircuit (nested ones as "x1.name") and its part node. */
  nodeNames: Map<string, number>;
}

/** `name=value` instance parameters of an element line (lower-case names), evaluated in a scope. */
function instanceParams(fields: string[], params: ParamScope): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of fields) {
    const i = f.indexOf("=");
    if (i > 0 && !f.startsWith("{")) out.set(f.slice(0, i).toLowerCase(), params.eval(f.slice(i + 1)));
  }
  return out;
}

/** The value of an R / C / L / V / I line: the first value after the nodes (`R=…`, `{expr}` too). */
function value(fields: string[], from: number, name: string, params: ParamScope): number {
  for (const f of fields.slice(from)) {
    const t = f.replace(/^(r|c|l|dc|value)=/i, "");
    if (/^dc$/i.test(t)) continue;
    if (isNumber(t) || t.startsWith("{")) return params.eval(t);
    if (/=/.test(f)) continue;
    // a bare parameter name (PSpice), else not a value (a model name, a flag)
    try {
      return params.eval(t);
    } catch {
      continue;
    }
  }
  return name.startsWith("V") || name.startsWith("I") ? 0 : NaN;
}

/** The text after a keyword (`VALUE=`, `V=`, `TABLE`) on an element line, or null. */
function after(line: string, keyword: RegExp): string | null {
  const m = keyword.exec(line);
  return m ? line.slice(m.index + m[0].length).trim() : null;
}

/** A braced group at the start of text ("{a*b} = …" → "{a*b}"), or the whole text when unbraced. */
function leadingExpr(text: string): { expr: string; rest: string } {
  if (!text.startsWith("{")) return { expr: text, rest: "" };
  let depth = 0;
  for (let k = 0; k < text.length; k++) {
    if (text[k] === "{") depth++;
    else if (text[k] === "}" && --depth === 0) return { expr: text.slice(0, k + 1), rest: text.slice(k + 1).trim() };
  }
  throw new Error("unbalanced braces");
}

/**
 * Build a subcircuit's devices: `pins` gives the part node for each of the subcircuit's pins
 * (−1: ground; undefined: left floating, so it becomes an inner node), inner nodes are numbered
 * from `firstInternal`.
 */
export function buildSubckt(host: DeviceHost, sub: SpiceSubckt, pins: (number | undefined)[], firstInternal: number, scope: SpiceScope, temp = T_DEFAULT): BuiltSubckt {
  const devices: Device[] = [];
  const problems: string[] = [...scope.problems];
  const nodeNames = new Map<string, number>();
  let next = firstInternal;

  /** Expand a subcircuit: its pins on these nodes, with these instance parameters (already evaluated). */
  const expand = (s: SpiceSubckt, pinMap: (number | undefined)[], prefix: string, depth: number, outer: ParamScope, overrides: Map<string, number>) => {
    if (depth > 20) {
      problems.push(`${s.name}: subcircuits nested too deep`);
      return;
    }
    // parameters: the defaults on the .subckt line, the instance's values over them, then .param
    // lines inside (in order), all over the enclosing scope
    const params = new ParamScope(outer);
    for (const [k, v] of s.params) {
      if (overrides.has(k)) continue;
      try {
        params.set(k, v);
      } catch (err) {
        problems.push(`${prefix}${s.name} ${k}: ${(err as Error).message}`);
      }
    }
    for (const [k, v] of overrides) params.setValue(k, v);
    addParams(params, s.locals, s.funcs, problems);

    const nodes = new Map<string, number>();
    s.pins.forEach((p, i) => {
      const n = pinMap[i];
      nodes.set(p.toLowerCase(), n === undefined ? next++ : n);
    });
    const node = (name: string): number => {
      const k = name.toLowerCase();
      if (k === "0" || k === "gnd" || k === "gnd!") return -1;
      let n = nodes.get(k);
      if (n === undefined) {
        nodes.set(k, (n = next++));
        nodeNames.set(prefix.toLowerCase() + k, n);
      }
      return n;
    };
    const model = (name: string) => {
      const m = s.models.get(name.toLowerCase()) ?? scope.model(name);
      return m ? resolveModel(m, params, problems) : null;
    };
    const branches = new Map<string, Branch>();
    const inductors = new Map<string, InductorDevice>();
    const pending: (() => void)[] = [];
    const branch = <D extends Device & Branch>(name: string, d: D): D => {
      branches.set(name.toLowerCase(), d);
      return d;
    };
    /** A branch by name, linked once the whole subcircuit is built (it may come later). */
    const branchRef = (elm: string, ctrl: string): Branch => {
      const proxy: { target: Branch | null } & Branch = {
        target: null,
        get vs() {
          return this.target!.vs;
        },
        get i() {
          return this.target!.i;
        },
      };
      pending.push(() => {
        const b = branches.get(ctrl.toLowerCase());
        if (!b) throw new Error(`${elm}: no voltage source or branch ${ctrl}`);
        proxy.target = b;
      });
      return proxy;
    };
    /** Compile a behavioral expression on this subcircuit's nodes and branches. */
    const behavioral = (elm: string, a: number, b: number, voltage: boolean, expr: Expr): BehavioralDevice => {
      const vars: Variable[] = [];
      const keys = new Map<string, number>();
      const bound = bind(expr, params, {
        node: (n) => {
          const k = `n:${node(n)}`;
          if (!keys.has(k)) {
            keys.set(k, vars.length);
            vars.push({ node: node(n) });
          }
          return keys.get(k)!;
        },
        branch: (n) => {
          const k = `b:${n.toLowerCase()}`;
          if (!keys.has(k)) {
            keys.set(k, vars.length);
            vars.push({ branch: branchRef(elm, n) });
          }
          return keys.get(k)!;
        },
      });
      const { f, df } = compileWithDerivatives(bound, vars.length);
      return new BehavioralDevice(host, a, b, voltage, vars, f, df, temp);
    };
    /**
     * A LAPLACE source: H(s) of the input u as a state-space system on inner nodes, with time scaled
     * by ω0 (s = ω0·p, so the states stay near u's size). States x1…xn, each a node on a capacitor
     * 1/ω0 to ground: x_k' = x_{k+1} (a VCCS), x_n' = u − Σ a_k x_{k+1} (a behavioral current);
     * the output Σ (b_k − a_k b_n) x_{k+1} + b_n u (a behavioral voltage, E, or current, G). The
     * capacitors are integrated as all charges are, so the steps' error control covers the states.
     */
    const laplace = (elm: string, prefixed: string, a: number, b: number, voltage: boolean, u: Expr, h: Rational): Device[] => {
      const { w0, a: den, b: num } = scaled(h);
      const n = den.length, out: Device[] = [];
      const sum = (terms: Expr[]): Expr => terms.reduce((x, y) => ({ k: "bin", op: "+", a: x, b: y }));
      const times = (c: number, x: Expr): Expr => ({ k: "bin", op: "*", a: { k: "num", v: c }, b: x });
      const states: Expr[] = [];
      for (let k = 0; k < n; k++) {
        const s = `${elm}#x${k + 1}`;
        states.push({ k: "v", a: s, b: null });
        out.push(new CapacitorDevice(host, node(s), -1, 1 / w0));
      }
      const x = (k: number) => node(`${elm}#x${k + 1}`);
      for (let k = 0; k + 1 < n; k++) out.push(new VccsDevice(host, -1, x(k), x(k + 1), -1, 1));
      if (n > 0) {
        out.push(behavioral(prefixed, -1, x(n - 1), false, sum([u, ...states.map((s, k) => times(-den[k], s))])));
        // a pole at s = 0 (an integrator): a leak a billion times slower, so the operating point exists
        if (den[0] === 0) out.push(new ResistorDevice(host, x(0), -1, 1e9));
      }
      const terms = states.map((s, k) => times(num[k] - den[k] * num[n], s));
      if (num[n] !== 0) terms.push(times(num[n], u));
      const d = behavioral(prefixed, a, b, voltage, terms.length ? sum(terms) : { k: "num", v: 0 });
      out.push(voltage ? branch(elm, d) : d);
      return out;
    };
    /** POLY(n) controls and coefficients: n node pairs (E, G) or n source names (F, H). */
    const poly = (f: string[], from: number, pairs: boolean): Expr => {
      const count = Number(/^poly\((\d+)\)$/i.exec(f[from])?.[1]);
      if (!(count > 0)) throw new Error("bad POLY");
      const ctrl = f.slice(from + 1, from + 1 + count * (pairs ? 2 : 1));
      const xs: Expr[] = [];
      for (let k = 0; k < count; k++) xs.push(pairs ? { k: "v", a: ctrl[2 * k], b: ctrl[2 * k + 1] } : { k: "i", name: ctrl[k] });
      const coeffs = f.slice(from + 1 + ctrl.length).filter((x) => !x.includes("=")).map((x) => params.eval(x));
      return polyExpr(xs, coeffs);
    };

    for (const e of s.elements) {
      const f = e.fields, name = prefix + e.name;
      const rest = e.line.slice(e.name.length).trim();
      try {
        switch (e.kind) {
          case "R": {
            const r = value(f, 2, e.name, params);
            if (!(r > 0)) throw new Error("no resistance");
            devices.push(new ResistorDevice(host, node(f[0]), node(f[1]), r));
            break;
          }
          case "C": {
            const c = value(f, 2, e.name, params);
            if (!Number.isFinite(c)) throw new Error("no capacitance");
            devices.push(new CapacitorDevice(host, node(f[0]), node(f[1]), c, instanceParams(f, params).get("ic") ?? 0));
            break;
          }
          case "L": {
            const l = value(f, 2, e.name, params);
            if (!(l > 0)) throw new Error("no inductance");
            const d = branch(e.name, new InductorDevice(host, node(f[0]), node(f[1]), l, instanceParams(f, params).get("ic") ?? 0));
            inductors.set(e.name.toLowerCase(), d);
            devices.push(d);
            break;
          }
          case "K": {
            // K name L1 L2 [L3 …] k: every pair coupled with M = k·√(L1·L2)
            const names = f.slice(0, -1), k = params.eval(f[f.length - 1]);
            if (names.length < 2 || !(Math.abs(k) <= 1)) throw new Error("needs two inductors and a coupling between −1 and 1");
            pending.push(() => {
              const ls = names.map((n) => {
                const l = inductors.get(n.toLowerCase());
                if (!l) throw new Error(`${name}: no inductor ${n}`);
                return l;
              });
              for (let x = 0; x < ls.length; x++) for (let y = x + 1; y < ls.length; y++) ls[x].couple(ls[y], k * Math.sqrt(ls[x].l * ls[y].l));
            });
            break;
          }
          case "V":
            devices.push(branch(e.name, new VoltageDevice(host, node(f[0]), node(f[1]), value(f, 2, e.name, params))));
            break;
          case "I":
            devices.push(new CurrentDevice(host, node(f[0]), node(f[1]), value(f, 2, e.name, params)));
            break;
          case "B": {
            // B n+ n− V={expr} or I={expr}
            const m = /^\S+\s+\S+\s+([vi])\s*=\s*/i.exec(rest);
            if (!m) throw new Error("needs V= or I=");
            const { expr } = leadingExpr(rest.slice(m[0].length).trim());
            const voltage = m[1].toLowerCase() === "v";
            const d = behavioral(name, node(f[0]), node(f[1]), voltage, parseExpr(expr));
            devices.push(voltage ? branch(e.name, d) : d);
            break;
          }
          case "E":
          case "G": {
            const voltage = e.kind === "E";
            const [a, b] = [node(f[0]), node(f[1])];
            let expr: Expr | null = null;
            const valueText = after(rest, /\bvalue\s*=?\s*/i);
            const tableText = after(rest, /\btable\s*/i);
            if (/\b(freq|chebyshev)\b/i.test(rest)) throw new Error("FREQ / CHEBYSHEV forms not supported");
            const lap = /\blaplace\b/i.test(rest) ? laplaceLine(rest) : null;
            if (lap) {
              devices.push(...laplace(e.name, name, node(lap.out[0]), node(lap.out[1]), voltage, parseExpr(lap.input), rational(parseExpr(lap.h), params)));
              break;
            }
            if (valueText !== null) expr = parseExpr(leadingExpr(valueText).expr);
            else if (tableText !== null) {
              // TABLE {expr} = (x1, y1) (x2, y2) …
              const { expr: x, rest: pts } = leadingExpr(tableText);
              const values = pts.replace(/^=/, "").split(/[\s,()]+/).filter(Boolean).map((v) => params.eval(v));
              expr = { k: "call", f: "table", args: [parseExpr(x), ...values.map((v): Expr => ({ k: "num", v }))] };
            } else if (/^poly\(/i.test(f[2] ?? "")) expr = poly(f, 2, true);
            if (expr) {
              const d = behavioral(name, a, b, voltage, expr);
              devices.push(voltage ? branch(e.name, d) : d);
              break;
            }
            const gain = params.eval(f[4] ?? "");
            const [c, d] = [node(f[2]), node(f[3])];
            devices.push(voltage ? branch(e.name, new VcvsDevice(host, a, b, c, d, gain)) : new VccsDevice(host, a, b, c, d, gain));
            break;
          }
          case "F":
          case "H": {
            const voltage = e.kind === "H";
            const [a, b] = [node(f[0]), node(f[1])];
            if (/^poly\(/i.test(f[2] ?? "")) {
              const d = behavioral(name, a, b, voltage, poly(f, 2, false));
              devices.push(voltage ? branch(e.name, d) : d);
              break;
            }
            const gain = params.eval(f[3] ?? "");
            const ctrl = branchRef(name, f[2]);
            const dev: CccsDevice | CcvsDevice = voltage ? branch(e.name, new CcvsDevice(host, a, b, ctrl, gain)) : new CccsDevice(host, a, b, ctrl, gain);
            devices.push(dev);
            break;
          }
          case "D": {
            // D a k model [area], or ngspice's thermal diode: D a k tj model [area] thermal
            const thermal = f.some((x) => /^thermal$/i.test(x)) && model(f[3] ?? "")?.type === "D";
            const mi = thermal ? 3 : 2;
            const m = model(f[mi]);
            if (!m || m.type !== "D") throw new Error(`no diode model ${f[mi]}`);
            const af = f[mi + 1];
            const area = af !== undefined && !af.includes("=") && !/^thermal$/i.test(af) ? params.eval(af) : instanceParams(f, params).get("area") ?? 1;
            const p = diodeParams(m, temp, area);
            const a = node(f[0]), k = node(f[1]);
            const ap = p.rs > 0 ? next++ : a;
            const dev = new DiodeDevice(host, p, a, k, ap);
            // self-heating: with the circuit's setting on and RTH0 in the model (else the node floats)
            if (thermal && simSelfHeating(host.sim) && (m.params.get("rth0") ?? 0) > 0) {
              dev.thermal = { model: m, area, temp, rth: m.params.get("rth0")!, cth: m.params.get("cth0") ?? 0, tn: node(f[2]), gminExtra: 0 };
            }
            devices.push(dev);
            break;
          }
          case "M": {
            // VDMOS has 3 nodes (d g s), the others 4 (d g s b); the model name follows them
            const m3 = model(f[3] ?? "");
            // ngspice's thermal VDMOS: M d g s tj tc model thermal
            const m5 = f.some((x) => /^thermal$/i.test(x)) ? model(f[5] ?? "") : null;
            const vdm = m5?.type === "VDMOS" ? m5 : m3?.type === "VDMOS" ? m3 : null;
            if (vdm) {
              const p = vdmosParams(vdm, temp, instanceParams(f, params).get("m") ?? 1);
              const d = node(f[0]), g = node(f[1]), s0 = node(f[2]);
              const inner = (r: number, outer: number) => (r > 0 ? next++ : outer);
              const dev = new VdmosDevice(host, p, d, g, s0, inner(p.rd, d), inner(p.rg, g), inner(p.rs, s0), inner(p.rb, s0));
              // self-heating: with the circuit's setting on and RTHJC in the model (else the nodes float)
              if (vdm === m5 && simSelfHeating(host.sim) && vdm.params.has("rthjc")) {
                dev.setThermal({
                  tj: node(f[3]), tc: node(f[4]), rthjc: vdm.params.get("rthjc")!, rthca: vdm.params.get("rthca") ?? 23,
                  cthj: vdm.params.get("cthj") ?? 10e-6, ambient: temp - 273.15,
                });
              }
              devices.push(dev);
              break;
            }
            const m = model(f[4] ?? "");
            if (!m || (m.type !== "NMOS" && m.type !== "PMOS")) throw new Error(`no MOSFET model ${f[4]}`);
            const level = m.params.get("level") ?? 1;
            if (level !== 1 && level !== 2 && level !== 3) problems.push(`${name}: MOSFET level ${level} simulated as level 1`);
            const ip = instanceParams(f, params);
            const inst = {
              l: ip.get("l") ?? 100e-6, w: ip.get("w") ?? 100e-6, m: ip.get("m") ?? 1,
              ad: ip.get("ad") ?? 0, as: ip.get("as") ?? 0, pd: ip.get("pd") ?? 0, ps: ip.get("ps") ?? 0,
            };
            const l3 = level === 3 ? mos3Params(m, inst, temp) : null;
            const l2 = level === 2 ? mos2Params(m, inst, temp) : null;
            const p = l3 ? l3.p : l2 ? l2.p : mos1Params(m, inst, temp);
            const d = node(f[0]), g = node(f[1]), s0 = node(f[2]), b = node(f[3]);
            const dp = p.rd > 0 ? next++ : d, sp = p.rs > 0 ? next++ : s0;
            devices.push(l3 ? new Mos3Device(host, p, l3.x, d, g, s0, b, dp, sp) : l2 ? new Mos2Device(host, p, l2.x, d, g, s0, b, dp, sp) : new Mos1Device(host, p, d, g, s0, b, dp, sp));
            break;
          }
          case "Q": {
            // Q c b e [s] model [area]: a fourth node unless the fourth field names a model
            const four = !model(f[3] ?? "");
            const m = model(f[four ? 4 : 3] ?? "");
            if (!m || (m.type !== "NPN" && m.type !== "PNP")) throw new Error(`no transistor model ${f[four ? 4 : 3]}`);
            const af = f[four ? 5 : 4];
            const area = af !== undefined && !af.includes("=") ? params.eval(af) : instanceParams(f, params).get("area") ?? 1;
            // AREAB / AREAC default to AREA
            const ip = instanceParams(f, params);
            const p = bjtParams(m, temp, area, ip.get("areab") ?? area, ip.get("areac") ?? area);
            for (const x of p.ignored) problems.push(`${name}: ${x} not simulated`);
            const c = node(f[0]), b = node(f[1]), e0 = node(f[2]), s0 = four ? node(f[3]) : -1;
            const cx = p.gc > 0 ? next++ : c, cp = p.rco > 0 ? next++ : cx;
            const bp = p.rb > 0 ? next++ : b, ep = p.ge > 0 ? next++ : e0;
            devices.push(new BjtDevice(host, p, c, b, e0, s0, cp, bp, ep, cx));
            break;
          }
          case "J": {
            // J d g s model [area]
            const m = model(f[3] ?? "");
            if (!m || (m.type !== "NJF" && m.type !== "PJF")) throw new Error(`no JFET model ${f[3]}`);
            const area = f[4] !== undefined && !f[4].includes("=") ? params.eval(f[4]) : instanceParams(f, params).get("area") ?? 1;
            const p = jfetParams(m, temp, area);
            const d = node(f[0]), g = node(f[1]), s0 = node(f[2]);
            devices.push(new JfetDevice(host, p, d, g, s0, p.gd > 0 ? next++ : d, p.gs > 0 ? next++ : s0));
            break;
          }
          case "X": {
            // X name n1 … nk subname [params:] [name=value …]
            const plain = f.filter((x) => !x.includes("=") && !/^params:$/i.test(x));
            const target = scope.subckt(plain[plain.length - 1] ?? "");
            if (!target) throw new Error(`no subcircuit ${plain[plain.length - 1]}`);
            const values = new Map<string, number>();
            for (const x of f) {
              const i = x.indexOf("=");
              if (i > 0 && !x.startsWith("{")) values.set(x.slice(0, i).toLowerCase(), params.eval(x.slice(i + 1)));
            }
            expand(target, plain.slice(0, -1).map(node), `${name}.`, depth + 1, params, values);
            break;
          }
          default:
            throw new Error(`${e.kind} elements not supported yet`);
        }
      } catch (err) {
        problems.push(`${name}: ${(err as Error).message}`);
      }
    }
    for (const link of pending) {
      try {
        link();
      } catch (err) {
        problems.push((err as Error).message);
      }
    }
  };
  expand(sub, pins, "", 0, scope.params, new Map());
  return { device: new DeviceGroup(host, devices), internalNodes: next - firstInternal, problems, nodeNames };
}

/**
 * The order of a MOSFET subcircuit's pins: drain, gate, source by default (most manufacturers),
 * otherwise as the pin names or a comment spell it out ("1 = drain", "D G S", "gate drain source").
 * Returns the index of each of drain, gate, source among the pins.
 */
export function mosfetPins(sub: SpiceSubckt): { d: number; g: number; s: number } {
  const find = (words: string[]) => {
    const idx = (re: RegExp) => words.findIndex((w) => re.test(w));
    const d = idx(/^(d|drain)$/i), g = idx(/^(g|gate)$/i), s = idx(/^(s|source)$/i);
    return d >= 0 && g >= 0 && s >= 0 ? { d, g, s } : null;
  };
  const byName = find(sub.pins);
  if (byName) return byName;
  for (const c of sub.comments) {
    // "1=drain 2=gate 3=source" or "nodes: drain gate source"
    const assigned = [...c.matchAll(/(\w+)\s*[=:]\s*(drain|gate|source)/gi)];
    if (assigned.length >= 3) {
      const at = (w: string) => sub.pins.findIndex((p) => p.toLowerCase() === assigned.find((a) => a[2].toLowerCase() === w)?.[1].toLowerCase());
      const r = { d: at("drain"), g: at("gate"), s: at("source") };
      if (r.d >= 0 && r.g >= 0 && r.s >= 0) return r;
    }
    const words = c.toLowerCase().match(/\b(drain|gate|source)\b/g);
    if (words && new Set(words).size === 3 && words.length === 3) {
      const r = { d: words.indexOf("drain"), g: words.indexOf("gate"), s: words.indexOf("source") };
      if (Math.max(r.d, r.g, r.s) < sub.pins.length) return r;
    }
  }
  return { d: 0, g: 1, s: 2 };
}

export type { SpiceElement };
