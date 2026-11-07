// Linear SPICE elements inside imported subcircuits: R, C, L (coupled by K), independent V and I
// sources (DC), and the controlled sources E (VCVS), F (CCCS), G (VCCS), H (CCVS). Node indices are the part's
// (−1: ground). Voltage sources follow SPICE's sign: V(n+) − V(n−) = value, and the branch current
// flows from n+ through the source to n−.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { VoltageSource } from "../../circuitjs/core/nodes";
import { addInto, CHARGE_TOL, Charge, Device, type DeviceHost } from "./device";

export class ResistorDevice extends Device {
  constructor(host: DeviceHost, readonly a: number, readonly b: number, readonly r: number) {
    super(host);
  }
  override stamp(): void {
    this.conductance(this.a, this.b, 1 / this.r);
  }
  override currents(into: number[]): void {
    const i = (this.v(this.a) - this.v(this.b)) / this.r;
    addInto(into, this.a, i);
    addInto(into, this.b, -i);
  }
}

export class CapacitorDevice extends Device {
  readonly charge = new Charge();
  constructor(host: DeviceHost, readonly a: number, readonly b: number, readonly c: number, readonly ic = 0) {
    super(host);
  }
  override reset(): void {
    this.charge.settle(this.c * this.ic);
  }
  override doStep(): void {
    if (this.dc) return;
    // the companion (its conductance and history current don't depend on the iterate)
    const v = this.v(this.a) - this.v(this.b);
    this.charge.update(v, this.c * v, this.c, this.h, this.order);
    this.conductance(this.a, this.b, this.charge.geq);
    this.currentSource(this.a, this.b, this.charge.ieq);
  }
  override stepFinished(): void {
    const q = this.c * (this.v(this.a) - this.v(this.b));
    if (this.dc) this.charge.settle(q);
    else this.charge.accept(q, this.h);
  }
  override states(values: number[], abstol: number[]): void {
    values.push(this.c * (this.v(this.a) - this.v(this.b)));
    abstol.push(CHARGE_TOL);
  }
  override currents(into: number[]): void {
    if (this.dc) return;
    const i = this.charge.current(this.v(this.a) - this.v(this.b));
    addInto(into, this.a, i);
    addInto(into, this.b, -i);
  }
}

/**
 * An inductor: a branch current through a voltage source row (exact at DC, where it's a short).
 * Its flux, L·i plus M·i of each inductor it's coupled to (K), is integrated as device charges are
 * (BDF2, or backward Euler on a first-order step): V(a) − V(b) = dφ/dt.
 */
export class InductorDevice extends Device {
  vs: VoltageSource | null = null;
  /** The branch current at the present iterate. */
  i = 0;
  /** Coupled inductors (K) and the mutual inductance with each. */
  readonly couplings: { other: InductorDevice; m: number }[] = [];
  /** Flux at the last two accepted steps, and the step between them. */
  f1 = 0;
  f2 = 0;
  h1 = 0;
  constructor(host: DeviceHost, readonly a: number, readonly b: number, readonly l: number, readonly ic = 0) {
    super(host);
  }
  override voltageSourceCount(): number {
    return 1;
  }
  override setVoltageSource(_i: number, vs: VoltageSource): void {
    this.vs = vs;
  }
  override setCurrent(_vs: VoltageSource, c: number): void {
    this.i = c;
  }
  /** Couple to another inductor (both ways). */
  couple(other: InductorDevice, m: number): void {
    this.couplings.push({ other, m });
    other.couplings.push({ other: this, m });
  }
  private flux(own: (d: InductorDevice) => number): number {
    let f = this.l * own(this);
    for (const c of this.couplings) f += c.m * own(c.other);
    return f;
  }
  override reset(): void {
    this.i = this.ic;
    this.f1 = this.f2 = this.flux((d) => d.ic);
    this.h1 = 0;
  }
  override stamp(): void {
    this.host.sim.stampVoltageSource(this.node(this.a), this.node(this.b), this.vs!);
  }
  override doStep(): void {
    const sim = this.host.sim;
    if (this.dc) {
      sim.updateVoltageSource(this.node(this.a), this.node(this.b), this.vs!, 0);
      return;
    }
    // V(a) − V(b) = a0·φ + a1·φ1 + a2·φ2; the row reads V(b) − V(a) + a0·φ = −(a1·φ1 + a2·φ2)
    const h = this.h;
    let a0: number, a1: number, a2: number;
    if (this.order === 1 || !(this.h1 > 0)) {
      a0 = 1 / h;
      a1 = -1 / h;
      a2 = 0;
    } else {
      const w = h / this.h1;
      a0 = (1 + 2 * w) / ((1 + w) * h);
      a1 = -(1 + w) / h;
      a2 = (w * w) / ((1 + w) * h);
    }
    sim.stampMatrixVV(this.vs!, this.vs!, a0 * this.l);
    for (const c of this.couplings) sim.stampMatrixVV(this.vs!, c.other.vs!, a0 * c.m);
    sim.updateVoltageSource(this.node(this.a), this.node(this.b), this.vs!, -(a1 * this.f1 + a2 * this.f2));
  }
  override nonLinear(): boolean {
    // the row's diagonal changes with the step
    return true;
  }
  override stepFinished(): void {
    const f = this.flux((d) => d.i);
    if (this.dc) {
      this.f1 = this.f2 = f;
      this.h1 = 0;
    } else {
      this.f2 = this.f1;
      this.f1 = f;
      this.h1 = this.h;
    }
  }
  override states(values: number[], abstol: number[]): void {
    values.push(this.i);
    abstol.push(1e-12);
  }
  override currents(into: number[]): void {
    addInto(into, this.a, this.i);
    addInto(into, this.b, -this.i);
  }
}

/** An independent voltage source (DC value), or a 0 V current probe. */
export class VoltageDevice extends Device {
  vs: VoltageSource | null = null;
  i = 0;
  constructor(host: DeviceHost, readonly a: number, readonly b: number, readonly value: number) {
    super(host);
  }
  override voltageSourceCount(): number {
    return 1;
  }
  override setVoltageSource(_i: number, vs: VoltageSource): void {
    this.vs = vs;
  }
  override setCurrent(_vs: VoltageSource, c: number): void {
    this.i = c;
  }
  override stamp(): void {
    // stamped n+ then n−: V(n−) − V(n+) = −value, so V(n+) − V(n−) = value, current n+ → n−
    this.host.sim.stampVoltageSource(this.node(this.a), this.node(this.b), this.vs!, -this.value * this.host.sim.sourceScale);
  }
  override currents(into: number[]): void {
    addInto(into, this.a, this.i);
    addInto(into, this.b, -this.i);
  }
}

/** An independent current source (DC): current flows from n+ through the source to n−. */
export class CurrentDevice extends Device {
  constructor(host: DeviceHost, readonly a: number, readonly b: number, readonly value: number) {
    super(host);
  }
  override stamp(): void {
    this.currentSource(this.a, this.b, this.value * this.host.sim.sourceScale);
  }
  override currents(into: number[]): void {
    addInto(into, this.a, this.value);
    addInto(into, this.b, -this.value);
  }
}

/** E: V(n+) − V(n−) = gain · (V(c+) − V(c−)). */
export class VcvsDevice extends Device {
  vs: VoltageSource | null = null;
  i = 0;
  constructor(host: DeviceHost, readonly a: number, readonly b: number, readonly c: number, readonly d: number, readonly gain: number) {
    super(host);
  }
  override voltageSourceCount(): number {
    return 1;
  }
  override setVoltageSource(_i: number, vs: VoltageSource): void {
    this.vs = vs;
  }
  override setCurrent(_vs: VoltageSource, c: number): void {
    this.i = c;
  }
  override stamp(): void {
    const sim = this.host.sim;
    sim.stampVoltageSource(this.node(this.a), this.node(this.b), this.vs!, 0);
    // the row: V(b) − V(a) + gain·(V(c) − V(d)) = 0
    sim.stampVCVS(this.node(this.c), this.node(this.d), this.gain, this.vs!);
  }
  override currents(into: number[]): void {
    addInto(into, this.a, this.i);
    addInto(into, this.b, -this.i);
  }
}

/** G: a current gm · (V(c+) − V(c−)) from n+ through the source to n−. */
export class VccsDevice extends Device {
  constructor(host: DeviceHost, readonly a: number, readonly b: number, readonly c: number, readonly d: number, readonly gm: number) {
    super(host);
  }
  override stamp(): void {
    this.host.sim.stampVCCurrentSource(this.node(this.a), this.node(this.b), this.node(this.c), this.node(this.d), this.gm);
  }
  override currents(into: number[]): void {
    const i = this.gm * (this.v(this.c) - this.v(this.d));
    addInto(into, this.a, i);
    addInto(into, this.b, -i);
  }
}

/** A device whose current a controlled source senses (a V source, or another branch). */
export interface Branch {
  vs: VoltageSource | null;
  i: number;
}

/** F: a current gain · I(Vctrl) from n+ through the source to n−. */
export class CccsDevice extends Device {
  constructor(host: DeviceHost, readonly a: number, readonly b: number, public ctrl: Branch, readonly gain: number) {
    super(host);
  }
  override stamp(): void {
    this.host.sim.stampCCCS(this.node(this.a), this.node(this.b), this.ctrl.vs!, this.gain);
  }
  override currents(into: number[]): void {
    const i = this.gain * this.ctrl.i;
    addInto(into, this.a, i);
    addInto(into, this.b, -i);
  }
}

/** H: V(n+) − V(n−) = r · I(Vctrl). */
export class CcvsDevice extends Device {
  vs: VoltageSource | null = null;
  i = 0;
  constructor(host: DeviceHost, readonly a: number, readonly b: number, public ctrl: Branch, readonly r: number) {
    super(host);
  }
  override voltageSourceCount(): number {
    return 1;
  }
  override setVoltageSource(_i: number, vs: VoltageSource): void {
    this.vs = vs;
  }
  override setCurrent(_vs: VoltageSource, c: number): void {
    this.i = c;
  }
  override stamp(): void {
    const sim = this.host.sim;
    sim.stampVoltageSource(this.node(this.a), this.node(this.b), this.vs!, 0);
    sim.stampMatrixVV(this.vs!, this.ctrl.vs!, this.r);
  }
  override currents(into: number[]): void {
    addInto(into, this.a, this.i);
    addInto(into, this.b, -this.i);
  }
}
