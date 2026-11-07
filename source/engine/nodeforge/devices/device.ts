// SPICE device models for the NodeForge engine: the base every device builds on (stamping on its
// part's nodes, charge integration, Newton limiting). The equations follow ngspice (BSD licence),
// so imported models behave as they do there and can be checked against it.
// Copyright 1985 - 2018, Regents of the University of California and others, ngspice (https://ngspice.sourceforge.io), Modified BSD licence (assets/licenses/ngspice-modified-bsd.txt).
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { CircuitNode, VoltageSource } from "../../circuitjs/core/nodes";
import type { Simulator } from "../../circuitjs/core/simulator";
import { DEFAULT_TEMPERATURE } from "../../circuitjs/io/circuit";

/** Boltzmann constant over the electron charge (V/K), as in ngspice (const.h). */
export const K_OVER_Q = 1.38064852e-23 / 1.6021766208e-19;
export const BOLTZMANN = 1.38064852e-23;
export const CHARGE = 1.6021766208e-19;
/** ngspice's nominal temperature: 27 °C. */
export const T_NOMINAL = 300.15;
/** The circuit's default operating temperature (K), separate from model TNOM. */
export const T_DEFAULT = DEFAULT_TEMPERATURE + 273.15;
/** The temperature (K) a simulator runs its devices at; use the circuit default without one. */
export function simTemperature(sim: unknown): number {
  return (sim as { temperature?: number } | undefined)?.temperature ?? T_DEFAULT;
}
/** Is self-heating on for a simulator's devices (the circuit's setting)? */
export function simSelfHeating(sim: unknown): boolean {
  return (sim as { selfHeating?: boolean } | undefined)?.selfHeating === true;
}
/** Conductance ngspice puts across every junction (CKTgmin). */
export const GMIN = 1e-12;
/**
 * The absolute tolerance of a device charge in the step's error estimate (SPICE's CHGTOL). SPICE's
 * default, 1e-14 C, is coarse for picofarad junctions: it lets their charges drift by millivolts at
 * the maximum step (a transistor's base after turn-off, its collector after a hard start).
 */
export const CHARGE_TOL = 1e-15;

/** The part a device belongs to: its nodes (posts, then internal nodes) and their voltages. */
export interface DeviceHost {
  sim: Simulator;
  nodes: (CircuitNode | null)[];
  volts: number[];
}

/**
 * A device inside a part: stamps the matrix on the part's nodes (by index), every Newton iteration
 * for nonlinear ones. Charges are integrated with BDF2 (see Charge); their values at the last
 * accepted steps are the device's state, which the engine's snapshots save and restore with the part.
 */
export abstract class Device {
  constructor(readonly host: DeviceHost) {}

  /** Node index −1 is ground (SPICE's node 0). */
  protected v(i: number): number {
    return i < 0 ? 0 : this.host.volts[i];
  }
  protected node(i: number): CircuitNode {
    return i < 0 ? this.host.sim.ground : this.host.nodes[i]!;
  }
  /** Conductance between two of the part's nodes. */
  protected conductance(a: number, b: number, g: number): void {
    if (g === 0 || a === b) return;
    this.host.sim.stampConductance(this.node(a), this.node(b), g);
  }
  protected matrix(i: number, j: number, x: number): void {
    if (x !== 0) this.host.sim.stampMatrix(this.node(i), this.node(j), x);
  }
  /** Current injected into node i (the right-hand side). */
  protected rhs(i: number, x: number): void {
    if (x !== 0) this.host.sim.stampRightSide(this.node(i), x);
  }
  /** A current i flowing out of node a and into node b, through the device. */
  protected currentSource(a: number, b: number, i: number): void {
    if (i !== 0) this.host.sim.stampCurrentSource(this.node(a), this.node(b), i);
  }
  /** Mark the iteration as not converged (this device's voltages moved, or were limited). */
  protected notConverged(): void {
    this.host.sim.converged = false;
  }
  /** Newton tolerance: the NodeForge engine's relTol; SPICE's default (1e-3) under the CircuitJS solver. */
  protected get relTol(): number {
    const sim = this.host.sim as { accurate: boolean; relTol?: number };
    return sim.accurate ? (sim.relTol ?? 1e-3) : 1e-3;
  }
  /**
   * Under the CircuitJS solver, which can't shorten a step that won't converge, how many iterations
   * this step has taken (devices then grow lenient, as CircuitJS's own parts do); 0 under the
   * NodeForge engine, which cuts the step instead.
   */
  protected get struggling(): number {
    const sim = this.host.sim;
    return sim.accurate ? 0 : sim.subIterations;
  }
  /** The current-convergence tolerance, loosened when struggling (CircuitJS mode). */
  protected currentTol(a: number, b: number): number {
    const k = this.struggling > 500 ? 1e3 : 1;
    return k * (this.relTol * Math.max(Math.abs(a), Math.abs(b)) + 1e-12);
  }
  protected get dc(): boolean {
    return this.host.sim.dcAnalysisFlag;
  }
  protected get h(): number {
    return this.host.sim.timeStep;
  }
  /**
   * Integration order of this step: 1 (backward Euler) for the first step of a run and the one after
   * a breakpoint, as SPICE does, so a jump doesn't leave the trapezoidal rule ringing; else 2. Always
   * 1 under the CircuitJS solver.
   */
  protected get order(): number {
    // under the CircuitJS solver (fixed steps, no error control to catch ringing): always first order
    const sim = this.host.sim as { accurate: boolean; integrationOrder?: number };
    return sim.accurate ? (sim.integrationOrder ?? 2) : 1;
  }

  /** Voltage sources the device needs (allocated by its part). */
  voltageSourceCount(): number {
    return 0;
  }
  setVoltageSource(_i: number, _vs: VoltageSource): void {}
  setCurrent(_vs: VoltageSource, _c: number): void {}

  /** Linear stamps that don't change during a run. */
  stamp(): void {}
  /** Start of a time step. */
  startIteration(): void {}
  /** One Newton iteration: stamp the linearized device. */
  doStep(): void {}
  /** The step was accepted (or the operating point found): keep its charges as the history. */
  stepFinished(): void {}
  /** Back to the start (no charge, nothing remembered). */
  reset(): void {}
  /** Values integrated over time, for the error estimate, each with an absolute tolerance. */
  states(_values: number[], _abstol: number[]): void {}
  /** Add the current flowing into the device at each of its part's nodes (at the solution). */
  currents(_into: number[]): void {}
  /** Is the device nonlinear (stamps change between Newton iterations)? */
  nonLinear(): boolean {
    return false;
  }
}

/** Add the current i flowing into the device at node n (ground, −1, isn't tracked). */
export function addInto(into: number[], n: number, i: number): void {
  if (n >= 0) into[n] += i;
}

/**
 * A charge q(v) between two nodes, integrated with the variable-step second-order backward
 * difference formula (BDF2, ngspice's `method=gear`), or backward Euler on a first-order step:
 * the current depends only on the charges, so a charge that holds still carries no current. (The
 * trapezoidal rule keeps a current flipping sign every step around a fast device RC, such as a
 * gate resistance with its gate capacitance, that error control on the charge never sees.)
 * Linearized as i ≈ geq·v + ieq around the Newton iterate; q1 and q2 are the charges at the last
 * two accepted steps, h1 the step between them.
 */
export class Charge {
  /** Saved and restored with its device by the engine's snapshots. */
  static readonly stateful = true;
  q1 = 0;
  q2 = 0;
  h1 = 0;
  /** At the present iterate. */
  q = 0;
  geq = 0;
  ieq = 0;
  /** The current at the last accepted step. */
  i1 = 0;

  /** The step's coefficients, i = a0·q + a1·q1 + a2·q2 (set by update, used by accept). */
  private a0 = 0;
  private a1 = 0;
  private a2 = 0;

  /** Linearize around voltage v with charge q and capacitance c (h: the step; order 1 or 2). */
  update(v: number, q: number, c: number, h: number, order = 2): void {
    this.q = q;
    if (order === 1 || !(this.h1 > 0)) {
      this.a0 = 1 / h;
      this.a1 = -1 / h;
      this.a2 = 0;
    } else {
      const w = h / this.h1;
      this.a0 = (1 + 2 * w) / ((1 + w) * h);
      this.a1 = -(1 + w) / h;
      this.a2 = (w * w) / ((1 + w) * h);
    }
    this.geq = this.a0 * c;
    this.ieq = this.a0 * q + this.a1 * this.q1 + this.a2 * this.q2 - this.geq * v;
  }
  /** The current at voltage v (on the linearization: exact at convergence). */
  current(v: number): number {
    return this.geq * v + this.ieq;
  }
  /** Accept the step: q at the solution becomes the history. */
  accept(q: number, h: number): void {
    this.i1 = this.a0 * q + this.a1 * this.q1 + this.a2 * this.q2;
    this.q2 = this.q1;
    this.q1 = q;
    this.h1 = h;
  }
  /** An operating point (or a start): this charge, and no current. */
  settle(q: number): void {
    this.q1 = this.q2 = q;
    this.h1 = 0;
    this.i1 = 0;
    this.geq = this.ieq = 0;
  }
}

// MARK: Newton limiting (ngspice devsup.c)

/** Limit a pn-junction voltage step (DEVpnjlim). Returns the limited voltage; `limited` tells. */
export function pnjlim(vnew: number, vold: number, vt: number, vcrit: number): { v: number; limited: boolean } {
  if (vnew > vcrit && Math.abs(vnew - vold) > vt + vt) {
    if (vold > 0) {
      const arg = (vnew - vold) / vt;
      vnew = arg > 0 ? vold + vt * (2 + Math.log(arg - 2)) : vold - vt * (2 + Math.log(2 - arg));
    } else vnew = vt * Math.log(vnew / vt);
    return { v: vnew, limited: true };
  }
  if (vnew < 0) {
    const arg = vold > 0 ? -1 * vold - 1 : 2 * vold - 1;
    if (vnew < arg) return { v: arg, limited: true };
  }
  return { v: vnew, limited: false };
}

/** Limit a FET gate voltage step around threshold vto (DEVfetlim). */
export function fetlim(vnew: number, vold: number, vto: number): number {
  const vtsthi = Math.abs(2 * (vold - vto)) + 2;
  const vtstlo = Math.abs(vold - vto) + 1;
  const vtox = vto + 3.5;
  const delv = vnew - vold;
  if (vold >= vto) {
    if (vold >= vtox) {
      if (delv <= 0) {
        // going off
        if (vnew >= vtox) {
          if (-delv > vtstlo) vnew = vold - vtstlo;
        } else vnew = Math.max(vnew, vto + 2);
      } else if (delv >= vtsthi) vnew = vold + vtsthi; // staying on
    } else if (delv <= 0) vnew = Math.max(vnew, vto - 0.5); // middle region, decreasing
    else vnew = Math.min(vnew, vto + 4); // increasing
  } else if (delv <= 0) {
    // off
    if (-delv > vtsthi) vnew = vold - vtsthi;
  } else {
    const vtemp = vto + 0.5;
    if (vnew <= vtemp) {
      if (delv > vtstlo) vnew = vold + vtstlo;
    } else vnew = vtemp;
  }
  return vnew;
}

/** Limit a FET drain-source voltage step (DEVlimvds). */
export function limvds(vnew: number, vold: number): number {
  if (vold >= 3.5) {
    if (vnew > vold) vnew = Math.min(vnew, 3 * vold + 2);
    else if (vnew < 3.5) vnew = Math.max(vnew, 2);
  } else if (vnew > vold) vnew = Math.min(vnew, 4);
  else vnew = Math.max(vnew, -0.5);
  return vnew;
}

/**
 * Limit a self-heating device's temperature rise per iteration (DEVlimitlog): beyond `limTol` (K)
 * of the last iterate, logarithmically. Returns the limited value; `limited` tells.
 */
export function limitlog(dT: number, dTold: number, limTol: number): { v: number; limited: boolean } {
  if (Number.isNaN(dT) || Number.isNaN(dTold)) return { v: 0, limited: true };
  if (dT > dTold + limTol) return { v: dTold + limTol + Math.log10((dT - dTold) / limTol), limited: true };
  if (dT < dTold - limTol) return { v: dTold - limTol - Math.log10((dTold - dT) / limTol), limited: true };
  return { v: dT, limited: false };
}

/** Has a voltage moved more than the Newton tolerance? */
export function moved(a: number, b: number, relTol: number, vnTol: number): boolean {
  return Math.abs(a - b) > relTol * Math.max(Math.abs(a), Math.abs(b)) + vnTol;
}
