// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Ported from CircuitJS1 (CapacitorElm.java, InductorElm.java, Inductor.java) by Paul Falstad and
// Iain Sharp. Licensed under the GNU General Public License v2 or later. See LICENSE.

import { CircuitElm, ScopeValue, type XmlAttrs } from "../core/elm";
import { FindPathInfo, PathKind } from "../core/findpath";
import { interpPoint } from "../core/geometry";
import type { CircuitNode, VoltageSource } from "../core/nodes";
import type { Simulator } from "../core/simulator";
import type { TokenStream, XmlNode } from "../io/tokens";

export class CapacitorElm extends CircuitElm {
  static override dumpType = "c".charCodeAt(0);
  static readonly FLAG_BACK_EULER = 2;
  static readonly FLAG_RESISTANCE = 4;

  capacitance = 0;
  compResistance = 0;
  voltdiff = 0;
  seriesResistance = 0;
  initialVoltage = 0;
  capNode2 = 0;
  curSourceValue = 0;

  override initNew(): void {
    this.capacitance = 1e-5;
    this.initialVoltage = 1e-3;
  }

  override readTokens(st: TokenStream): void {
    this.capacitance = st.nextDouble();
    this.voltdiff = st.nextDouble();
    this.initialVoltage = 1e-3;
    // optional fields; keep whatever parsed before the first failure
    const iv = st.tryDouble();
    if (iv !== undefined) {
      this.initialVoltage = iv;
      if ((this.flags & CapacitorElm.FLAG_RESISTANCE) !== 0) {
        const sr = st.tryDouble();
        if (sr !== undefined) this.seriesResistance = sr;
      }
    }
    this.allocNodes();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.capacitance = xml.double("c", this.capacitance);
    this.initialVoltage = xml.double("iv", this.initialVoltage);
    this.seriesResistance = xml.double("sr", this.seriesResistance);
    this.voltdiff = xml.double("vd", this.voltdiff);
    this.allocNodes();
  }

  override dump(): string {
    this.flags |= CapacitorElm.FLAG_RESISTANCE;
    return super.dump();
  }

  override dumpValues(): string {
    return ` ${this.capacitance} ${this.voltdiff} ${this.initialVoltage} ${this.seriesResistance}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["c", String(this.capacitance)], ["iv", String(this.initialVoltage)]);
    if (this.seriesResistance > 0) a.push(["sr", String(this.seriesResistance)]);
  }

  override dumpXmlState(a: XmlAttrs): void {
    a.push(["vd", String(this.voltdiff)]);
  }

  get isTrapezoidal(): boolean {
    return (this.flags & CapacitorElm.FLAG_BACK_EULER) === 0;
  }

  /**
   * NodeForge engine: trapezoidal this step, unless the solver takes a first-order step (the start of
   * a run, or just after a source edge) as SPICE does, so the jump doesn't leave it ringing.
   * (CircuitJS mode: always the part's own setting.)
   */
  private get trapezoidalNow(): boolean {
    return this.isTrapezoidal && (this.sim as { integrationOrder?: number }).integrationOrder !== 1;
  }

  override reset(): void {
    super.reset();
    this.current = this.curcount = this.curSourceValue = 0;
    // put a small charge on caps when reset to start oscillators
    this.voltdiff = this.initialVoltage;
  }

  shorted(): void {
    super.reset();
    this.voltdiff = this.current = this.curcount = this.curSourceValue = 0;
  }

  override setPoints(): void {
    super.setPoints();
    const f = (this.dn / 2 - 4) / this.dn;
    this.lead1 = interpPoint(this.point1, this.point2, f);
    this.lead2 = interpPoint(this.point1, this.point2, 1 - f);
  }

  override stamp(): void {
    const sim = this.sim;
    if (sim.dcAnalysisFlag) {
      // when finding the DC operating point, replace the cap with a 100M resistor (CircuitJS);
      // NodeForge engine: its operating point opens it, leaving SPICE's gmin-sized leak
      sim.stampResistor(this.nodes[0]!, this.nodes[1]!, sim.dcShortInductors ? 1e12 : 1e8);
      this.curSourceValue = 0;
      this.capNode2 = 1;
      return;
    }
    // The capacitor model is between nodes 0 and capNode2. For an ideal capacitor capNode2 is
    // node 1; with series resistance it's internal node 2, with a resistor from 2 to 1.
    this.capNode2 = this.seriesResistance > 0 ? 2 : 1;

    // Companion model (Norton equivalent): current source in parallel with a resistor.
    // Trapezoidal is more accurate than backward Euler but can oscillate if RC is small
    // relative to the timestep.
    this.compResistance = this.trapezoidalNow ? sim.timeStep / (2 * this.capacitance) : sim.timeStep / this.capacitance;
    sim.stampResistor(this.nodes[0]!, this.nodes[this.capNode2]!, this.compResistance);
    sim.markRightSide(this.nodes[0]!);
    sim.markRightSide(this.nodes[this.capNode2]!);
    if (this.seriesResistance > 0) sim.stampResistor(this.nodes[1]!, this.nodes[2]!, this.seriesResistance);
  }

  override startIteration(): void {
    this.curSourceValue = this.trapezoidalNow
      ? -this.voltdiff / this.compResistance - this.current
      : -this.voltdiff / this.compResistance;
  }

  override stepFinished(): void {
    this.voltdiff = this.volts[0] - this.volts[this.capNode2];
    this.calculateCurrent();
  }

  /** Don't calculate current here; only in stepFinished(). Otherwise it may run while stamping
   * and discharge the cap (the current feeds curSourceValue). */
  override setNodeVoltage(n: number, c: number): void {
    this.volts[n] = c;
  }

  override calculateCurrent(): void {
    const voltdiff = this.volts[0] - this.volts[this.capNode2];
    if (this.sim.dcAnalysisFlag) {
      this.current = voltdiff / (this.sim.dcShortInductors ? 1e12 : 1e8);
      return;
    }
    // compResistance may still be 0 if this runs before stamp()
    if (this.compResistance > 0) this.current = voltdiff / this.compResistance + this.curSourceValue;
  }

  override doStep(): void {
    if (this.sim.dcAnalysisFlag) return;
    this.sim.stampCurrentSource(this.nodes[0]!, this.nodes[this.capNode2]!, this.curSourceValue);
  }

  override getInternalNodeCount(): number {
    return !(this.sim?.dcAnalysisFlag ?? false) && this.seriesResistance > 0 ? 1 : 0;
  }

  override getScopeValue(x: number): number {
    if (x === ScopeValue.charge) return this.capacitance * this.voltdiff;
    return super.getScopeValue(x);
  }

  override isIdealCapacitor(): boolean {
    return this.seriesResistance === 0;
  }

  override validate(): boolean {
    if (this.isIdealCapacitor()) {
      let fpi = new FindPathInfo(PathKind.Short, this, this.getNode(1)!, this.sim);
      if (fpi.findPath(this.getNode(0)!)) {
        this.sim.log?.("capacitor shorted");
        this.shorted();
      } else {
        fpi = new FindPathInfo(PathKind.CapV, this, this.getNode(1)!, this.sim);
        if (fpi.findPath(this.getNode(0)!)) {
          // loop of ideal capacitors; add a small series resistance to avoid oscillation
          this.seriesResistance = 0.1;
          return false;
        }
      }
    }
    return true;
  }
}

/** Inductor companion model, shared by inductors, transformers and relays. */
export class Inductor {
  static readonly FLAG_BACK_EULER = 2;

  nodes: [CircuitNode | null, CircuitNode | null] = [null, null];
  flags = 0;
  inductance = 0;
  compResistance = 0;
  current = 0;
  curSourceValue = 0;
  /** 0 = disabled (linear); > 0 = saturation onset current (A). */
  saturationCurrent = 0;

  setup(ic: number, cr: number, f: number, isat = 0): void {
    this.inductance = ic;
    this.current = cr;
    this.flags = f;
    this.saturationCurrent = isat;
  }

  get isTrapezoidal(): boolean {
    return (this.flags & Inductor.FLAG_BACK_EULER) === 0;
  }

  /** NodeForge engine: trapezoidal this step, unless the solver takes a first-order one (see CapacitorElm). */
  private trapezoidalNow(sim: Simulator): boolean {
    return this.isTrapezoidal && (sim as { integrationOrder?: number }).integrationOrder !== 1;
  }

  /** curSourceValue must be set too: if a node is ground, calculateCurrent() may run while
   * analyzing, before startIteration(). */
  resetTo(c: number): void {
    this.current = this.curSourceValue = c;
  }

  /** L(I) = L0 / (1 + (I/Isat)²): L0/2 at Isat, L0/10 at 3·Isat. */
  calcEffectiveInductance(i: number): number {
    if (this.saturationCurrent <= 0) return this.inductance;
    const ratio = i / this.saturationCurrent;
    return this.inductance / (1 + ratio * ratio);
  }

  get nonLinear(): boolean {
    return this.saturationCurrent > 0;
  }

  /** NodeForge engine: a short (the DC operating point), not an integrator. */
  dcShort = false;

  stamp(sim: Simulator, n0: CircuitNode, n1: CircuitNode): void {
    this.nodes = [n0, n1];
    this.dcShort = sim.dcShortInductors;
    if (this.dcShort) {
      // a 1 nΩ short: its current is the DC current through the inductor
      this.compResistance = 1e-9;
      sim.stampResistor(n0, n1, this.compResistance);
      return;
    }
    if (this.saturationCurrent > 0) {
      // nonlinear: conductance depends on current, stamped in doStep()
      sim.markNonLinear(n0);
      sim.markNonLinear(n1);
    } else {
      this.compResistance = this.trapezoidalNow(sim) ? (2 * this.inductance) / sim.timeStep : this.inductance / sim.timeStep;
      sim.stampResistor(n0, n1, this.compResistance);
    }
    sim.markRightSide(n0);
    sim.markRightSide(n1);
  }

  startIteration(sim: Simulator, voltdiff: number): void {
    if (this.dcShort) {
      this.curSourceValue = 0;
      return;
    }
    if (this.saturationCurrent > 0) {
      const lEff = this.calcEffectiveInductance(this.current);
      this.compResistance = this.trapezoidalNow(sim) ? (2 * lEff) / sim.timeStep : lEff / sim.timeStep;
    }
    this.curSourceValue = this.trapezoidalNow(sim) ? voltdiff / this.compResistance + this.current : this.current;
  }

  calculateCurrent(voltdiff: number): number {
    // compResistance may still be 0 if called before stamp()
    if (this.compResistance > 0) this.current = voltdiff / this.compResistance + this.curSourceValue;
    return this.current;
  }

  doStep(sim: Simulator): void {
    if (this.dcShort) return;
    if (this.saturationCurrent > 0) sim.stampConductance(this.nodes[0]!, this.nodes[1]!, 1 / this.compResistance);
    sim.stampCurrentSource(this.nodes[0]!, this.nodes[1]!, this.curSourceValue);
  }
}

export class InductorElm extends CircuitElm {
  static override dumpType = "l".charCodeAt(0);
  readonly ind = new Inductor();
  inductance = 0;
  initialCurrent = 0;
  saturationCurrent = 0;

  override initNew(): void {
    this.inductance = 1;
    this.ind.setup(this.inductance, this.current, this.flags, this.saturationCurrent);
  }

  override readTokens(st: TokenStream): void {
    this.inductance = st.nextDouble();
    this.current = st.nextDouble();
    const ic = st.tryDouble();
    if (ic !== undefined) {
      this.initialCurrent = ic;
      const isat = st.tryDouble();
      if (isat !== undefined) this.saturationCurrent = isat;
    }
    this.ind.setup(this.inductance, this.current, this.flags, this.saturationCurrent);
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.inductance = xml.double("l", this.inductance);
    this.initialCurrent = xml.double("ic", this.initialCurrent);
    this.current = xml.double("i", this.current);
    this.saturationCurrent = xml.double("isat", this.saturationCurrent);
    this.ind.setup(this.inductance, this.current, this.flags, this.saturationCurrent);
  }

  override dumpValues(): string {
    return ` ${this.inductance} ${this.current} ${this.initialCurrent} ${this.saturationCurrent}`;
  }

  setInductance(l: number): void {
    this.inductance = l;
    this.ind.setup(this.inductance, this.current, this.flags, this.saturationCurrent);
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["l", String(this.inductance)], ["ic", String(this.initialCurrent)]);
    if (this.saturationCurrent !== 0) a.push(["isat", String(this.saturationCurrent)]);
  }

  override dumpXmlState(a: XmlAttrs): void {
    a.push(["i", String(this.current)]);
  }

  override setPoints(): void {
    super.setPoints();
    this.calcLeads(32);
  }

  override reset(): void {
    this.volts[0] = this.volts[1] = this.curcount = 0;
    this.current = this.initialCurrent;
    this.ind.resetTo(this.initialCurrent);
  }

  override stamp(): void {
    if (this.sim.isExactDcShort(this)) {
      // NodeForge engine, DC operating point: an exact short with its own current (SPICE's model). A tiny resistance
      // instead would be far stiffer than anything else in the matrix and can make it numerically
      // singular (e.g. next to the weak ties that hold floating parts of a circuit)
      this.ind.nodes = [this.nodes[0]!, this.nodes[1]!];
      this.ind.dcShort = true;
      this.ind.compResistance = 0;
      this.sim.stampVoltageSource(this.nodes[0]!, this.nodes[1]!, this.voltSource!, 0);
      return;
    }
    this.ind.stamp(this.sim, this.nodes[0]!, this.nodes[1]!);
  }
  override getVoltageSourceCount(): number {
    return this.sim?.isExactDcShort(this) ? 1 : 0;
  }
  override setVoltageSource(n: number, v: VoltageSource): void {
    super.setVoltageSource(n, v);
    v.setNodes(this.nodes[0]!, this.nodes[1]!);
  }
  /** The DC short's current (from post 0 to post 1, as the inductor's). */
  override setCurrent(_vs: VoltageSource, c: number): void {
    this.current = this.ind.current = c;
  }
  override startIteration(): void {
    this.ind.startIteration(this.sim, this.volts[0] - this.volts[1]);
  }
  override nonLinear(): boolean {
    return this.ind.nonLinear;
  }
  override calculateCurrent(): void {
    this.current = this.ind.calculateCurrent(this.volts[0] - this.volts[1]);
  }
  override doStep(): void {
    this.ind.doStep(this.sim);
  }
  override isInductor(): boolean {
    return true;
  }

  override validate(): boolean {
    const fpi = new FindPathInfo(PathKind.Induct, this, this.getNode(1)!, this.sim);
    if (!fpi.findPath(this.getNode(0)!)) this.reset();
    return true;
  }
}
