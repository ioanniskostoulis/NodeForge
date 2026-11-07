// Ported from CircuitJS1 (VCCSElm.java, VCVSElm.java, CCVSElm.java, CCCSElm.java) by Paul Falstad.
// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Licensed under the GNU General Public License v2 or later. See LICENSE.
//
// Controlled sources whose output is an arbitrary expression of their inputs. The expression is
// linearized around the current operating point every subiteration (a numeric derivative per
// input), so they're nonlinear elements solved by Newton iteration.

import type { CircuitElm, XmlAttrs } from "../core/elm";
import { Expr, ExprParser, ExprState } from "../core/expr";
import { FindPathInfo, PathKind } from "../core/findpath";
import type { CircuitNode, VoltageSource } from "../core/nodes";
import { CircuitText, type TokenStream, type XmlNode } from "../io/tokens";
import { ChipElm, Side } from "./chips";

const letter = (i: number) => String.fromCharCode(65 + i);

/** Voltage-controlled current source: inputs A, B, … and a current output C+ → C-. */
export class VCCSElm extends ChipElm {
  static override dumpType = 213;
  inputCount = 0;
  exprString = "";
  expr: Expr | null = null;
  exprState = new ExprState(0);
  broken = false;
  lastVolts: number[] = [];
  /** The parse error of the current expression, if any. */
  exprError: string | null = null;

  defaultExpr(): string {
    return ".1*(a-b)";
  }

  override initNew(): void {
    this.inputCount = 2;
    this.exprString = this.defaultExpr();
    this.parseExpr();
    super.initNew();
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.inputCount = st.nextInt();
    this.exprString = CircuitText.unescape(st.next());
    this.parseExpr();
    this.setupPins();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.inputCount = xml.int("ic", this.inputCount);
    this.exprString = xml.string("ex", this.exprString) ?? this.exprString;
    this.parseExpr();
    this.setupPins();
  }

  // upstream has no text writer for these; the fields are written so text files stay readable
  override dumpChipValues(): string {
    return ` ${this.inputCount} ${CircuitText.escape(this.exprString)}`;
  }

  override textLossless(): boolean {
    return false;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["ic", String(this.inputCount)], ["ex", this.exprString]);
  }

  setupPins(): void {
    this.sizeX = 2;
    this.sizeY = this.inputCount > 2 ? this.inputCount : 2;
    this.pins = [];
    for (let i = 0; i !== this.inputCount; i++) this.pins[i] = this.newPin(i, Side.W, letter(i));
    this.pins[this.inputCount] = this.newPin(0, Side.E, "C+");
    this.pins[this.inputCount + 1] = this.newPin(1, Side.E, "C-");
    this.lastVolts = new Array<number>(this.inputCount).fill(0);
    this.exprState = new ExprState(this.inputCount);
    this.allocNodes();
  }

  override chipName(): string {
    return "VCCS";
  }
  override nonLinear(): boolean {
    return true;
  }
  override isDigitalChip(): boolean {
    return false;
  }

  override stamp(): void {
    this.sim.markNonLinear(this.nodes[this.inputCount]!);
    this.sim.markNonLinear(this.nodes[this.inputCount + 1]!);
  }

  signOf(a: number, b: number): number {
    return a > 0 ? b : -b;
  }

  /** Maximum change per subiteration still counted as converged; more lenient over time. */
  getConvergeLimit(): number {
    if (this.sim.subIterations < 10) return 0.001;
    if (this.sim.subIterations < 200) return 0.01;
    return 0.1;
  }

  hasCurrentOutput(): boolean {
    return true;
  }
  getOutputNode(n: number): CircuitNode {
    return this.nodes[n + this.inputCount]!;
  }

  override doStep(): void {
    const sim = this.sim, ic = this.inputCount, nodes = this.nodes, volts = this.volts;
    if (this.broken) {
      this.pins[ic].current = 0;
      this.pins[ic + 1].current = 0;
      // A current output without a return path would make the matrix singular.
      sim.stampResistor(nodes[ic]!, nodes[ic + 1]!, 1e8);
      return;
    }

    const convergeLimit = this.getConvergeLimit();
    for (let i = 0; i !== ic; i++) if (Math.abs(volts[i] - this.lastVolts[i]) > convergeLimit) sim.converged = false;

    const expr = this.expr, es = this.exprState;
    if (expr !== null) {
      for (let i = 0; i !== ic; i++) es.values[i] = volts[i];
      es.t = sim.t;
      es.timeStep = sim.timeStep;
      const v0 = -expr.eval(es);
      let rs = v0;

      for (let i = 0; i !== ic; i++) {
        let dv = volts[i] - this.lastVolts[i];
        if (Math.abs(dv) < 1e-6) dv = 1e-6;
        es.values[i] = volts[i];
        const v = -expr.eval(es);
        es.values[i] = volts[i] - dv;
        const v2 = -expr.eval(es);
        let dx = (v - v2) / dv;
        if (Math.abs(dx) < 1e-6) dx = this.signOf(dx, 1e-6);
        sim.stampVCCurrentSource(nodes[ic]!, nodes[ic + 1]!, nodes[i]!, sim.ground, dx);
        rs -= dx * volts[i];
        es.values[i] = volts[i];
      }
      sim.stampCurrentSource(nodes[ic]!, nodes[ic + 1]!, rs);
      this.pins[ic].current = -v0;
      this.pins[ic + 1].current = v0;
    }

    for (let i = 0; i !== ic; i++) this.lastVolts[i] = volts[i];
  }

  override stepFinished(): void {
    this.exprState.updateLastValues(this.pins[this.inputCount].current);
  }

  override getPostCount(): number {
    return this.inputCount + 2;
  }
  override getVoltageSourceCount(): number {
    return 0;
  }

  override getConnection(n1: number, n2: number): boolean {
    const a = this.inputCount, b = this.inputCount + 1;
    return (a === n1 && b === n2) || (a === n2 && b === n1);
  }
  override getMatrixConnection(): boolean {
    return true;
  }
  override hasGroundConnection(): boolean {
    return false;
  }

  setExpr(s: string): void {
    this.exprString = s;
    this.parseExpr();
  }

  parseExpr(): void {
    const parser = new ExprParser(this.exprString);
    this.expr = parser.parseExpression();
    this.exprError = parser.gotError();
  }

  /** Change the number of inputs (the inputs editor). */
  setInputCount(n: number): void {
    if (n < 0 || n > 8) return;
    this.inputCount = n;
    this.setupPins();
    this.allocNodes();
    this.setPoints();
  }

  override reset(): void {
    super.reset();
    this.exprState.reset();
  }

  override validate(): boolean {
    const fpi = new FindPathInfo(PathKind.Induct, this, this.getOutputNode(0), this.sim);
    this.broken = this.hasCurrentOutput() && !fpi.findPath(this.getOutputNode(1));
    return true;
  }
}

/** Voltage-controlled voltage source: output V+ − V- equals the expression. */
export class VCVSElm extends VCCSElm {
  static override dumpType = 212;

  override setupPins(): void {
    this.sizeX = 2;
    this.sizeY = this.inputCount > 2 ? this.inputCount : 2;
    this.pins = [];
    for (let i = 0; i !== this.inputCount; i++) this.pins[i] = this.newPin(i, Side.W, letter(i));
    this.pins[this.inputCount] = this.newPin(0, Side.E, "V+");
    this.pins[this.inputCount].output = true;
    this.pins[this.inputCount + 1] = this.newPin(1, Side.E, "V-");
    this.lastVolts = new Array<number>(this.inputCount).fill(0);
    this.exprState = new ExprState(this.inputCount);
    this.allocNodes();
  }

  override chipName(): string {
    return "VCVS";
  }

  override stamp(): void {
    const ic = this.inputCount;
    this.sim.stampVoltageSource(this.nodes[ic + 1]!, this.nodes[ic]!, this.pins[ic].voltSource!);
  }

  override doStep(): void {
    const sim = this.sim, ic = this.inputCount, volts = this.volts;
    const convergeLimit = this.getConvergeLimit();
    for (let i = 0; i !== ic; i++) if (Math.abs(volts[i] - this.lastVolts[i]) > convergeLimit) sim.converged = false;

    const vn = this.pins[ic].voltSource!;
    const expr = this.expr, es = this.exprState;
    if (expr !== null) {
      for (let i = 0; i !== ic; i++) es.values[i] = volts[i];
      es.t = sim.t;
      es.timeStep = sim.timeStep;
      const v0 = expr.eval(es);
      if (Math.abs(volts[ic] - volts[ic + 1] - v0) > Math.abs(v0) * 0.01 && sim.subIterations < 100) sim.converged = false;
      let rs = v0;

      for (let i = 0; i !== ic; i++) {
        let dv = volts[i] - this.lastVolts[i];
        if (Math.abs(dv) < 1e-6) dv = 1e-6;
        es.values[i] = volts[i];
        const v = expr.eval(es);
        es.values[i] = volts[i] - dv;
        const v2 = expr.eval(es);
        let dx = (v - v2) / dv;
        if (Math.abs(dx) < 1e-6) dx = this.signOf(dx, 1e-6);
        sim.stampMatrixVN(vn, this.nodes[i]!, -dx);
        rs -= dx * volts[i];
        es.values[i] = volts[i];
      }
      sim.stampRightSideV(vn, rs);
    }

    for (let i = 0; i !== ic; i++) this.lastVolts[i] = volts[i];
  }

  override stepFinished(): void {
    this.exprState.updateLastValues(this.volts[this.inputCount] - this.volts[this.inputCount + 1]);
  }

  override getVoltageSourceCount(): number {
    return 1;
  }
  override hasCurrentOutput(): boolean {
    return false;
  }

  override setVoltageSource(j: number, vs: VoltageSource): void {
    super.setVoltageSource(j, vs);
    vs.setNodes(this.nodes[this.inputCount + 1]!, this.nodes[this.inputCount]!);
  }

  override setCurrent(vs: VoltageSource, c: number): void {
    if (this.pins[this.inputCount].voltSource === vs) {
      this.pins[this.inputCount].current = c;
      this.pins[this.inputCount + 1].current = -c;
    }
  }
}

/** Shared setup for the current-controlled sources: input pairs A+/A-, B+/B-, … */
function setupPairPins(e: CCVSElm | CCCSElm, outPlus: string, outMinus: string): void {
  e.sizeX = 2;
  e.sizeY = e.inputCount > 2 ? e.inputCount : 2;
  e.inputPairCount = Math.trunc(e.inputCount / 2);
  e.pins = [];
  let i: number;
  for (i = 0; i !== e.inputPairCount; i++) {
    e.pins[i * 2] = e.newPin(i * 2, Side.W, letter(i) + "+");
    e.pins[i * 2 + 1] = e.newPin(i * 2 + 1, Side.W, letter(i) + "-");
    e.pins[i * 2 + 1].output = true;
  }
  e.pins[i * 2] = e.newPin(0, Side.E, outPlus);
  e.pins[i * 2].output = true;
  e.pins[i * 2 + 1] = e.newPin(1, Side.E, outMinus);
  e.exprState = new ExprState(e.inputPairCount);
}

/** Voltage sources across the inputs, for SPICE-style controlled sources (from subcircuit conversion). */
function findInputSources(e: CCVSElm | CCCSElm, list: CircuitElm[]): (CircuitElm | null)[] {
  const sources = new Array<CircuitElm | null>(e.inputPairCount).fill(null);
  for (let i = 0; i !== e.inputCount; i += 2) {
    for (const ce of list) {
      if (!ce.isVoltageElm()) continue;
      if (ce.getNode(0) === e.nodes[i] && ce.getNode(1) === e.nodes[i + 1]) sources[i / 2] = ce;
    }
  }
  return sources;
}

/** Current-controlled voltage source: input currents through A+→A-, … control V+ − V-. */
export class CCVSElm extends VCCSElm {
  static override dumpType = 214;
  static readonly FLAG_SPICE = 2;
  voltageSources: (CircuitElm | null)[] = [];
  outputVS: VoltageSource | null = null;
  inputPairCount = 0;
  lastCurrents: number[] = [];
  lastOutput = 0;

  override defaultExpr(): string {
    return "2*a";
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.setupPins();
  }

  override setupPins(): void {
    setupPairPins(this, "V+", "V-");
    this.lastCurrents = new Array<number>(this.inputPairCount).fill(0);
    this.allocNodes();
  }

  override chipName(): string {
    return "CCVS";
  }

  isSpiceStyle(): boolean {
    return (this.flags & CCVSElm.FLAG_SPICE) !== 0;
  }

  override stamp(): void {
    const sim = this.sim, ic = this.inputCount;
    if (this.isSpiceStyle()) {
      for (let i = 0; i !== ic; i += 2) this.pins[i + 1].voltSource = this.voltageSources[i / 2]?.voltSource ?? null;
    } else {
      // voltage source (0V) between C+ and C- so we can measure current
      for (let i = 0; i !== ic; i += 2) sim.stampVoltageSource(this.nodes[i]!, this.nodes[i + 1]!, this.pins[i + 1].voltSource!, 0);
    }

    const vn2 = this.pins[ic].voltSource!;
    this.outputVS = vn2;
    sim.stampVoltageSource(this.nodes[ic + 1]!, this.nodes[ic]!, vn2);
  }

  override doStep(): void {
    const sim = this.sim, ic = this.inputCount, ipc = this.inputPairCount, pins = this.pins;
    if (this.isSpiceStyle()) for (let i = 0; i !== ipc; i++) pins[i * 2 + 1].current = this.voltageSources[i]!.getCurrent();

    const convergeLimitCurrent = this.getConvergeLimit() * 0.1;
    for (let i = 0; i !== ipc; i++) if (Math.abs(pins[i * 2 + 1].current - this.lastCurrents[i]) > convergeLimitCurrent) sim.converged = false;

    const convergeLimitVoltage = this.getConvergeLimit();
    if (Math.abs(this.volts[ic] - this.volts[ic + 1] - this.lastOutput) > convergeLimitVoltage) sim.converged = false;

    const vno = this.outputVS!;
    const expr = this.expr, es = this.exprState;
    if (expr !== null) {
      for (let i = 0; i !== ipc; i++) this.setCurrentExprValue(i, pins[i * 2 + 1].current);
      es.t = sim.t;
      es.timeStep = sim.timeStep;
      const v0 = expr.eval(es);
      let rs = v0;

      for (let i = 0; i !== ipc; i++) {
        const cur = pins[i * 2 + 1].current;
        const vni = pins[i * 2 + 1].voltSource!;
        // upstream overrides the adaptive step with a fixed one
        const dv = 1e-9;
        this.setCurrentExprValue(i, cur);
        const v = expr.eval(es);
        this.setCurrentExprValue(i, cur - dv);
        const v2 = expr.eval(es);
        let dx = (v - v2) / dv;
        if (Math.abs(dx) < 1e-6) dx = this.signOf(dx, 1e-6);
        sim.stampMatrixVV(vno, vni, -dx);
        rs -= dx * cur;
        this.setCurrentExprValue(i, cur);
      }
      sim.stampRightSideV(vno, rs);
    }

    for (let i = 0; i !== ipc; i++) this.lastCurrents[i] = pins[i * 2 + 1].current;
    this.lastOutput = this.volts[ic] - this.volts[ic + 1];
  }

  override stepFinished(): void {
    this.exprState.updateLastValues(this.volts[this.inputCount] - this.volts[this.inputCount + 1]);
    for (let i = 0; i !== this.inputPairCount; i++) this.exprState.lastValues[i] = this.pins[i * 2 + 1].current;
  }

  setCurrentExprValue(n: number, cur: number): void {
    // set i to current for backward compatibility
    if (n === 0 && this.inputPairCount < 9) this.exprState.values[8] = cur;
    this.exprState.values[n] = cur;
  }

  override getVoltageSourceCount(): number {
    return this.isSpiceStyle() ? 1 : 1 + this.inputPairCount;
  }
  override getConnection(n1: number, n2: number): boolean {
    return Math.trunc(n1 / 2) === Math.trunc(n2 / 2);
  }
  override hasCurrentOutput(): boolean {
    return false;
  }

  override setCurrent(vs: VoltageSource, c: number): void {
    let i = 0;
    if (!this.isSpiceStyle()) {
      for (i = 0; i !== this.inputCount; i += 2) {
        if (this.pins[i + 1].voltSource === vs) {
          this.pins[i].current = -c;
          this.pins[i + 1].current = c;
          return;
        }
      }
    } else i = this.inputCount;
    if (this.pins[i].voltSource === vs) {
      this.pins[i].current = c;
      this.pins[i + 1].current = -c;
    }
  }

  override setInputCount(n: number): void {
    // make sure number of inputs is even
    if (n % 2 === 1) return;
    super.setInputCount(n);
  }

  override setParentList(list: CircuitElm[]): void {
    if (!this.isSpiceStyle()) return;
    // look for voltage sources across our inputs and use them rather than creating our own.
    // this is useful for converting spice subcircuits
    this.voltageSources = findInputSources(this, list);
  }

  override setVoltageSource(j: number, vs: VoltageSource): void {
    const ic = this.inputCount;
    if (this.isSpiceStyle()) {
      this.pins[ic].voltSource = vs;
      vs.setNodes(this.nodes[ic + 1]!, this.nodes[ic]!);
    } else {
      ChipElm.prototype.setVoltageSource.call(this, j, vs);
      if (j < this.inputPairCount) vs.setNodes(this.nodes[j * 2]!, this.nodes[j * 2 + 1]!);
      else vs.setNodes(this.nodes[ic + 1]!, this.nodes[ic]!);
    }
  }
}

/** Current-controlled current source: input currents through A+→A-, … control the O+ → O- current. */
export class CCCSElm extends VCCSElm {
  static override dumpType = 215;
  static readonly FLAG_SPICE = 2;
  voltageSources: (CircuitElm | null)[] = [];
  inputPairCount = 0;
  lastCurrents: number[] = [];

  override defaultExpr(): string {
    return "2*a";
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.setupPins();
  }

  override setupPins(): void {
    setupPairPins(this, "O+", "O-");
    this.lastCurrents = new Array<number>(this.inputPairCount + 1).fill(0);
    this.allocNodes();
  }

  override chipName(): string {
    return "CCCS";
  }

  isSpiceStyle(): boolean {
    return (this.flags & CCCSElm.FLAG_SPICE) !== 0;
  }

  override stamp(): void {
    const sim = this.sim, ic = this.inputCount;
    if (this.isSpiceStyle()) {
      for (let i = 0; i !== ic; i += 2) this.pins[i + 1].voltSource = this.voltageSources[i / 2]?.voltSource ?? null;
    } else {
      // voltage sources (0V) between C+ and C- so we can measure current
      for (let i = 0; i !== ic; i += 2) sim.stampVoltageSource(this.nodes[i]!, this.nodes[i + 1]!, this.pins[i + 1].voltSource!, 0);
    }
    sim.markNonLinear(this.nodes[ic]!);
    sim.markNonLinear(this.nodes[ic + 1]!);
  }

  override doStep(): void {
    const sim = this.sim, ic = this.inputCount, ipc = this.inputPairCount, pins = this.pins, nodes = this.nodes;
    if (this.broken) {
      pins[ic].current = 0;
      pins[ic + 1].current = 0;
      // A current output without a return path would make the matrix singular.
      sim.stampResistor(nodes[ic]!, nodes[ic + 1]!, 1e8);
      return;
    }

    // get current from connected voltage sources
    if (this.isSpiceStyle()) for (let i = 0; i !== ipc; i++) pins[i * 2 + 1].current = this.voltageSources[i]!.getCurrent();

    const convergeLimit = this.getConvergeLimit() * 0.1;
    for (let i = 0; i <= ipc; i++) if (Math.abs(pins[i * 2 + 1].current - this.lastCurrents[i]) > convergeLimit) sim.converged = false;
    for (let i = 0; i <= ipc; i++) this.lastCurrents[i] = pins[i * 2 + 1].current;

    const expr = this.expr, es = this.exprState;
    if (expr !== null) {
      for (let i = 0; i !== ipc; i++) this.setCurrentExprValue(i, pins[i * 2 + 1].current);
      es.t = sim.t;
      es.timeStep = sim.timeStep;
      const v0 = expr.eval(es);
      let rs = v0;

      pins[ic].current = v0;
      pins[ic + 1].current = -v0;

      for (let i = 0; i !== ipc; i++) {
        const cur = pins[i * 2 + 1].current;
        let dv = cur - this.lastCurrents[i];
        if (Math.abs(dv) < 1e-6) dv = 1e-6;
        this.setCurrentExprValue(i, cur);
        const v = expr.eval(es);
        this.setCurrentExprValue(i, cur - dv);
        const v2 = expr.eval(es);
        let dx = (v - v2) / dv;
        if (Math.abs(dx) < 1e-6) dx = this.signOf(dx, 1e-6);
        sim.stampCCCS(nodes[ic + 1]!, nodes[ic]!, pins[i * 2 + 1].voltSource!, dx);
        rs -= dx * cur;
        this.setCurrentExprValue(i, cur);
      }
      sim.stampCurrentSource(nodes[ic + 1]!, nodes[ic]!, rs);
    }
  }

  override stepFinished(): void {
    this.exprState.updateLastValues(this.pins[this.inputCount].current);
  }

  setCurrentExprValue(n: number, cur: number): void {
    // set i to current for backward compatibility
    if (n === 0 && this.inputPairCount < 9) this.exprState.values[8] = cur;
    this.exprState.values[n] = cur;
  }

  override getVoltageSourceCount(): number {
    return this.isSpiceStyle() ? 0 : this.inputPairCount;
  }
  override getConnection(n1: number, n2: number): boolean {
    return Math.trunc(n1 / 2) === Math.trunc(n2 / 2);
  }
  override hasCurrentOutput(): boolean {
    return true;
  }

  override setCurrent(vs: VoltageSource, c: number): void {
    for (let i = 0; i !== this.inputCount; i += 2) {
      if (this.pins[i + 1].voltSource === vs) {
        this.pins[i].current = -c;
        this.pins[i + 1].current = c;
        return;
      }
    }
  }

  override setInputCount(n: number): void {
    // make sure number of inputs is even
    if (n % 2 === 1) return;
    super.setInputCount(n);
  }

  override setParentList(list: CircuitElm[]): void {
    if (!this.isSpiceStyle()) return;
    // look for voltage sources across our inputs and use them rather than creating our own.
    // this is useful for converting spice subcircuits
    this.voltageSources = findInputSources(this, list);
  }

  override setVoltageSource(j: number, vs: VoltageSource): void {
    if (this.isSpiceStyle()) this.pins[this.inputCount].voltSource = vs;
    else {
      ChipElm.prototype.setVoltageSource.call(this, j, vs);
      vs.setNodes(this.nodes[j * 2]!, this.nodes[j * 2 + 1]!);
    }
  }
}
