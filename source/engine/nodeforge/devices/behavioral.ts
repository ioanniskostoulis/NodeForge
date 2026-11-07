// Behavioral sources inside imported subcircuits: B (V= / I=), E and G with VALUE or TABLE, and the
// POLY forms of E, F, G, H. Each is a voltage or a current given by an expression of node voltages,
// branch currents, time and temperature, linearized every Newton iteration with its derivatives.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { VoltageSource } from "../../circuitjs/core/nodes";
import type { Compiled } from "../spice/expr";
import { addInto, Device, type DeviceHost, T_DEFAULT } from "./device";
import type { Branch } from "./linear";

/** What an expression reads: a node's voltage (−1: ground) or a branch's current. */
export type Variable = { node: number } | { branch: Branch };

export class BehavioralDevice extends Device implements Branch {
  vs: VoltageSource | null = null;
  /** The branch current (a voltage output's). */
  i = 0;
  /** The variables at the present iterate. */
  private x: Float64Array;
  /** The value at the last iteration (the device's own convergence test). */
  private last = NaN;
  /** The node voltages it was last linearized at (for damping). */
  private xLast: Float64Array;

  /**
   * `voltage`: V(a) − V(b) = f (an output with a branch, as E / B V=); else a current f flowing from
   * a through the source to b (G / B I=).
   */
  constructor(host: DeviceHost, readonly a: number, readonly b: number, readonly voltage: boolean,
    readonly vars: Variable[], readonly f: Compiled, readonly df: Compiled[], readonly temp = T_DEFAULT) {
    super(host);
    this.x = new Float64Array(vars.length);
    this.xLast = new Float64Array(vars.length);
  }
  override voltageSourceCount(): number {
    return this.voltage ? 1 : 0;
  }
  override setVoltageSource(_i: number, vs: VoltageSource): void {
    this.vs = vs;
  }
  override setCurrent(_vs: VoltageSource, c: number): void {
    this.i = c;
  }
  override nonLinear(): boolean {
    return true;
  }
  override stamp(): void {
    if (this.voltage) this.host.sim.stampVoltageSource(this.node(this.a), this.node(this.b), this.vs!);
  }
  private read(): void {
    const x = this.x;
    for (let k = 0; k < x.length; k++) {
      const v = this.vars[k];
      x[k] = "node" in v ? this.v(v.node) : v.branch.i;
    }
  }
  private value(): number {
    const t = this.dc ? 0 : this.host.sim.t;
    return this.f(this.x, t, this.temp - 273.15);
  }
  override doStep(): void {
    this.read();
    const sim = this.host.sim, x = this.x;
    // under the CircuitJS solver (which can't shorten a step): limit the node voltage steps the
    // expression sees to 0.5 V an iteration, as CircuitJS's own MOSFET does (a high-gain expression
    // otherwise overshoots, and can cycle); lifted when struggling, as the SPICE devices' limiting is
    const struggling = this.struggling;
    if (!(sim as { accurate?: boolean }).accurate && struggling > 0 && struggling <= 100) {
      for (let k = 0; k < x.length; k++) {
        if (!("node" in this.vars[k])) continue;
        const d = x[k] - this.xLast[k];
        if (Math.abs(d) > 0.5) {
          x[k] = this.xLast[k] + Math.sign(d) * 0.5;
          this.notConverged();
        }
      }
    }
    this.xLast.set(x);
    const t = this.dc ? 0 : sim.t, temper = this.temp - 273.15;
    let f0 = this.f(x, t, temper);
    if (!Number.isFinite(f0)) {
      // overflow (an exp far out on a Newton iterate): hold it large and keep iterating
      f0 = f0 > 0 || Number.isNaN(f0) ? 1e30 : -1e30;
      this.notConverged();
    }
    // the device's own test: has its value settled?
    const tol = this.voltage ? this.relTol * Math.max(Math.abs(f0), Math.abs(this.last)) + 1e-6 : this.currentTol(f0, this.last);
    if (!(Math.abs(f0 - this.last) <= tol)) this.notConverged();
    this.last = f0;
    // f ≈ f0 + Σ g_k (x_k − x0_k)
    let c = f0;
    for (let k = 0; k < x.length; k++) {
      let g = this.df[k](x, t, temper);
      if (!Number.isFinite(g)) g = 0;
      if (g === 0) continue;
      c -= g * x[k];
      const v = this.vars[k];
      if (this.voltage) {
        // the row: V(b) − V(a) + Σ g_k x_k = −c
        if ("node" in v) {
          if (v.node >= 0) sim.stampVCVS(this.node(v.node), sim.ground, g, this.vs!);
        } else sim.stampMatrixVV(this.vs!, v.branch.vs!, g);
      } else if ("node" in v) {
        if (v.node >= 0) sim.stampVCCurrentSource(this.node(this.a), this.node(this.b), this.node(v.node), sim.ground, g);
      } else sim.stampCCCS(this.node(this.a), this.node(this.b), v.branch.vs!, g);
    }
    if (this.voltage) sim.updateVoltageSource(this.node(this.a), this.node(this.b), this.vs!, -c);
    else this.currentSource(this.a, this.b, c);
  }
  override reset(): void {
    this.last = NaN;
  }
  override currents(into: number[]): void {
    let i = this.i;
    if (!this.voltage) {
      this.read();
      i = this.value();
      if (!Number.isFinite(i)) i = 0;
    }
    addInto(into, this.a, i);
    addInto(into, this.b, -i);
  }
}

