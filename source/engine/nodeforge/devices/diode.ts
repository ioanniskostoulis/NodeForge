// The SPICE diode (ngspice's level 1: dioload.c, diotemp.c): exponential forward current with
// emission coefficient, reverse current, breakdown matched to IBV, series resistance, depletion
// charge (CJO, VJ, M, FC) and diffusion charge (TT), which gives reverse recovery; self-heating
// (ngspice's `thermal` diode: RTH0, CTH0), its temperature rise a node of its own.

// Copyright 1985 - 2018, Regents of the University of California and others, ngspice (https://ngspice.sourceforge.io), Modified BSD licence (assets/licenses/ngspice-modified-bsd.txt).
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { SpiceModel } from "../spice/parse";
import { addInto, BOLTZMANN, CHARGE, CHARGE_TOL, Charge, Device, type DeviceHost, GMIN, K_OVER_Q, limitlog, pnjlim, T_DEFAULT, T_NOMINAL } from "./device";

/** Diode parameters at the device temperature, ready for the equations. */
export interface DiodeParams {
  /** Saturation current (A), emission coefficient. */
  is: number;
  n: number;
  /** Series resistance (Ω, 0: none), with TRS1 / TRS2 at the device temperature; d(1/RS)/dT as ngspice has it. */
  rs: number;
  gsdT: number;
  /** d(IS)/dT (A/K), for self-heating. */
  isdT: number;
  /** Depletion capacitance at zero bias, junction potential, grading, forward-bias coefficient. */
  cjo: number;
  vj: number;
  m: number;
  fc: number;
  tt: number;
  /** Breakdown (Infinity: none), adjusted so the current at bv is ibv; its emission coefficient. */
  bv: number;
  nbv: number;
  /** Knee currents (0: none). */
  ikf: number;
  ikr: number;
  /** Thermal voltage at the device temperature. */
  vt: number;
  vcrit: number;
  /** Conductance across the junction: SPICE's GMIN (more for CircuitJS's models, see circuitjs.ts). */
  gmin: number;
  // depletion charge above fc·vj (linear extension)
  f1: number;
  f2: number;
  f3: number;
  depCap: number;
}

const num = (m: SpiceModel, names: string[], dflt: number): number => {
  for (const k of names) {
    const v = m.params.get(k);
    if (v !== undefined) return v;
  }
  return dflt;
};

/** ngspice's band gap of silicon at temperature t (diotemp.c). */
const egap = (t: number) => 1.16 - (7.02e-4 * t * t) / (t + 1108);

/**
 * Diode parameters from a `.model … D` card at temperature `temp` (K), as ngspice's DIOtempUpdate
 * does for TLEV = TLEVC = 0. `area` scales the currents and capacitance.
 */
export function diodeParams(m: SpiceModel, temp = T_DEFAULT, area = 1): DiodeParams {
  const tnom = num(m, ["tnom"], 27) + 273.15;
  const n = num(m, ["n"], 1);
  const vj0 = num(m, ["vj", "pb"], 1);
  const m0 = num(m, ["m", "mj"], 0.5);
  const fc = num(m, ["fc"], 0.5);
  const eg = num(m, ["eg"], 1.11);
  const xti = num(m, ["xti"], 3);
  // series resistance: R·(1 + TRS1·ΔT + TRS2·ΔT²) (diotemp.c)
  const dtn = temp - tnom, trs1 = num(m, ["trs1", "trs"], 0), trs2 = num(m, ["trs2"], 0);
  const rsFactor = 1 + trs1 * dtn + trs2 * dtn * dtn;
  const vt = K_OVER_Q * temp;
  const vte = n * vt;
  const vtnom = K_OVER_Q * tnom;
  // junction potential and capacitance
  const fact1 = tnom / T_NOMINAL, fact2 = temp / T_NOMINAL;
  const arg = -egap(temp) / (2 * BOLTZMANN * temp) + 1.1150877 / (BOLTZMANN * 2 * T_NOMINAL);
  const pbfact = -2 * vt * (1.5 * Math.log(fact2) + CHARGE * arg);
  const arg1 = -egap(tnom) / (BOLTZMANN * 2 * tnom) + 1.1150877 / (2 * BOLTZMANN * T_NOMINAL);
  const pbfact1 = -2 * vtnom * (1.5 * Math.log(fact1) + CHARGE * arg1);
  const pbo = (vj0 - pbfact1) / fact1;
  const gmaold = (vj0 - pbo) / pbo;
  let cjo = (num(m, ["cjo", "cj0", "cj"], 0) * area) / (1 + m0 * (400e-6 * (tnom - T_NOMINAL) - gmaold));
  const vj = pbfact + fact2 * pbo;
  const gmanew = (vj - pbo) / pbo;
  cjo *= 1 + m0 * (400e-6 * (temp - T_NOMINAL) - gmanew);
  // saturation current
  const is = num(m, ["is", "js"], 1e-14) * area * Math.exp(((temp / tnom - 1) * eg) / vte + (xti / n) * Math.log(temp / tnom));
  const vcrit = vte * Math.log(vte / (Math.SQRT2 * is));
  // breakdown: the knee voltage that makes the current at bv equal ibv
  const nbv = num(m, ["nbv"], n);
  let bv = Infinity;
  const bvGiven = m.params.get("bv");
  if (bvGiven !== undefined && Number.isFinite(bvGiven)) {
    const tbv = bvGiven - num(m, ["tcv"], 0) * (temp - tnom);
    const cbv = num(m, ["ibv"], 1e-3);
    let xbv: number;
    if (cbv < (is * tbv) / vt) xbv = tbv;
    else {
      const tol = 1e-3 * cbv;
      xbv = tbv - nbv * vt * Math.log(1 + cbv / is);
      for (let iter = 0; iter < 25; iter++) {
        xbv = tbv - nbv * vt * Math.log(cbv / is + 1 - xbv / vt);
        const xcbv = is * (Math.exp((tbv - xbv) / (nbv * vt)) - 1 + xbv / vt);
        if (Math.abs(xcbv - cbv) <= tol) break;
      }
    }
    bv = xbv;
  }
  const xfc = Math.log(1 - fc);
  return {
    is, n, rs: (num(m, ["rs"], 0) * rsFactor) / area,
    // (ngspice's DIOtConductance_dT: −G·(TRS1 + TRS2·ΔT)/factor²)
    gsdT: num(m, ["rs"], 0) > 0 ? (-(area / num(m, ["rs"], 0)) * (trs1 + trs2 * dtn)) / (rsFactor * rsFactor) : 0,
    // d/dT of IS·exp((T/Tnom − 1)·EG/(N·vt) + XTI/N·ln(T/Tnom)) (diotemp.c's DIOtSatCur_dT)
    isdT: is * (eg / (vte * tnom) - (eg * (temp / tnom - 1)) / (vte * temp) + xti / (n * temp)),
    cjo, vj, m: m0, fc,
    tt: num(m, ["tt"], 0), bv, nbv,
    ikf: num(m, ["ikf", "ik"], 0) * area, ikr: num(m, ["ikr"], 0) * area,
    vt, vcrit, gmin: GMIN,
    f1: (vj * (1 - Math.exp((1 - m0) * xfc))) / (1 - m0),
    f2: Math.exp((1 + m0) * xfc),
    f3: 1 - fc * (1 + m0),
    depCap: fc * vj,
  };
}

/** Junction current and conductance at vd (without gmin), as dioload.c. */
export function diodeCurrent(p: DiodeParams, vd: number): { cd: number; gd: number } {
  const vte = p.n * p.vt, vtebrk = p.nbv * p.vt;
  let cd: number, gd: number;
  if (vd >= -3 * vte) {
    const evd = Math.exp(vd / vte);
    cd = p.is * (evd - 1);
    gd = (p.is * evd) / vte;
    if (p.ikf > 0 && cd > 1e-18) {
      const s = Math.sqrt(cd / p.ikf);
      gd = ((1 + s) * gd - (cd * gd) / (2 * s * p.ikf)) / (1 + 2 * s + cd / p.ikf);
      cd /= 1 + s;
    }
  } else if (!Number.isFinite(p.bv) || vd >= -p.bv) {
    let arg = (3 * vte) / (vd * Math.E);
    arg = arg * arg * arg;
    cd = -p.is * (1 + arg);
    gd = (p.is * 3 * arg) / vd;
  } else {
    const evrev = Math.exp(-(p.bv + vd) / vtebrk);
    cd = -p.is * evrev;
    gd = (p.is * evrev) / vtebrk;
  }
  if (vd < -3 * vte && p.ikr > 0 && cd < -1e-18) {
    const s = Math.sqrt(cd / -p.ikr);
    gd = ((1 + s) * gd + (cd * gd) / (2 * s * p.ikr)) / (1 + 2 * s - cd / p.ikr);
    cd /= 1 + s;
  }
  return { cd, gd };
}

/**
 * The junction current's derivative in temperature at vd and temperature `temp` (K), as dioload.c
 * works it out for self-heating (IKF / IKR left out of it, as there).
 */
export function diodeCurrentdT(p: DiodeParams, vd: number, temp: number): number {
  const vte = p.n * p.vt, vtebrk = p.nbv * p.vt;
  if (vd >= -3 * vte) {
    const evd = Math.exp(vd / vte);
    return p.isdT * (evd - 1) - (p.is * vd * evd) / (vte * temp);
  }
  if (!Number.isFinite(p.bv) || vd >= -p.bv) {
    let arg = (3 * vte) / (vd * Math.E);
    arg = arg * arg * arg;
    const dargdT = (3 * arg) / temp;
    return -p.isdT - (p.isdT * arg + p.is * dargdT);
  }
  const evrev = Math.exp(-(p.bv + vd) / vtebrk);
  const evrevdT = ((p.bv + vd) * evrev) / (vtebrk * temp);
  return -(p.isdT * evrev + p.is * evrevdT);
}

/**
 * Self-heating (ngspice's diode with `thermal`): the junction's temperature rise ΔT is the voltage
 * of node `tn`, fed by the dissipated power through RTH0 (to ambient) and CTH0; the diode's
 * parameters follow T + ΔT every iteration.
 */
export interface DiodeThermal {
  model: SpiceModel;
  area: number;
  /** The temperature (K) at node value 0: the circuit's (node = the rise), or 273.15 (node = °C). */
  temp: number;
  /** To ambient and the thermal capacitance (0: none, as for a VDMOS's body diode, whose node the MOSFET's network holds). */
  rth: number;
  cth: number;
  tn: number;
  /** Conductance beyond SPICE's GMIN the part keeps across the junction (CircuitJS's leak). */
  gminExtra: number;
  /** The node's value at rest (0, or the ambient °C), and the per-iteration limit (K; ngspice's 100, VDMOS 10). */
  start?: number;
  limit?: number;
}

/** Depletion charge and capacitance at vd. */
export function depletion(p: DiodeParams, vd: number): { q: number; c: number } {
  const czero = p.cjo;
  if (czero === 0) return { q: 0, c: 0 };
  if (vd < p.depCap) {
    const arg = 1 - vd / p.vj;
    const sarg = Math.exp(-p.m * Math.log(arg));
    return { q: (p.vj * czero * (1 - arg * sarg)) / (1 - p.m), c: czero * sarg };
  }
  const czof2 = czero / p.f2;
  return {
    q: czero * p.f1 + czof2 * (p.f3 * (vd - p.depCap) + (p.m / (p.vj + p.vj)) * (vd * vd - p.depCap * p.depCap)),
    c: czof2 * (p.f3 + (p.m * vd) / p.vj),
  };
}

/**
 * A SPICE diode between two of its part's nodes: anode `a`, cathode `k`; with series resistance,
 * the junction sits between internal node `ap` and `k`.
 */
export class DiodeDevice extends Device {
  /** Junction voltage of the last iteration, and the current and conductance there (dc part). */
  vd = 0;
  cd = 0;
  gd = 0;
  readonly charge = new Charge();
  /** Self-heating, or null. */
  thermal: DiodeThermal | null = null;
  /** Self-heating: the temperature rise of the last iteration, and the current's derivative in it. */
  dT = 0;
  cddT = 0;
  readonly qth = new Charge();

  constructor(host: DeviceHost, public p: DiodeParams, readonly a: number, readonly k: number, readonly ap: number) {
    super(host);
  }

  /** The parameters at temperature rise dT (self-heating). */
  private paramsAt(th: DiodeThermal, dT: number): DiodeParams {
    const p = diodeParams(th.model, th.temp + dT, th.area);
    p.gmin += th.gminExtra;
    return p;
  }

  override nonLinear(): boolean {
    return true;
  }

  override reset(): void {
    this.vd = this.cd = this.gd = 0;
    this.charge.settle(0);
    if (this.thermal) {
      const start = this.thermal.start ?? 0;
      this.dT = start;
      this.cddT = 0;
      this.p = this.paramsAt(this.thermal, start);
      this.qth.settle(this.thermal.cth * start);
    }
  }

  override stamp(): void {
    // (self-heating: RS follows the temperature, stamped every iteration)
    if (this.ap !== this.a && !this.thermal) this.conductance(this.a, this.ap, 1 / this.p.rs);
  }

  /** Junction charge and capacitance at vd (dc current cd and conductance gd there). */
  private chargeAt(vd: number, cd: number, gd: number): { q: number; c: number } {
    const d = depletion(this.p, vd);
    return { q: d.q + this.p.tt * cd, c: d.c + this.p.tt * gd };
  }

  override doStep(): void {
    const p = this.p;
    const raw = this.v(this.ap) - this.v(this.k);
    const th = this.thermal;
    const rawdT = th ? this.v(th.tn) : 0;
    // ngspice's convergence test on the current: the linear prediction from the last iterate
    const cdhat = this.cd + this.gd * (raw - this.vd) + this.cddT * (rawdT - this.dT);
    if (Math.abs(cdhat - this.cd) > this.currentTol(cdhat, this.cd)) this.notConverged();
    // limit the junction voltage step (around the breakdown knee in breakdown)
    const vtebrk = p.nbv * p.vt;
    let vd: number, limited: boolean;
    if (Number.isFinite(p.bv) && raw < Math.min(0, -p.bv + 10 * vtebrk)) {
      const r = pnjlim(-(raw + p.bv), -(this.vd + p.bv), vtebrk, p.vcrit);
      vd = -(r.v + p.bv);
      limited = r.limited;
    } else {
      const r = pnjlim(raw, this.vd, p.n * p.vt, p.vcrit);
      vd = r.v;
      limited = r.limited;
    }
    if (limited) this.notConverged();
    // self-heating: limit the temperature step (DEVlimitlog, 100 K), then the parameters at T + ΔT
    let dT = 0;
    if (th) {
      const l = limitlog(rawdT, this.dT, th.limit ?? 100);
      dT = l.v;
      if (l.limited) this.notConverged();
      this.p = this.paramsAt(th, dT);
    }
    const pt = this.p;
    const { cd: cdj, gd: gdj } = diodeCurrent(pt, vd);
    let cd = cdj + pt.gmin * vd, gd = gdj + pt.gmin;
    const cddT = th ? diodeCurrentdT(pt, vd, th.temp + dT) : 0;
    this.vd = vd;
    this.cd = cd;
    this.gd = gd;
    this.dT = dT;
    this.cddT = cddT;
    if (!this.dc && (pt.cjo > 0 || pt.tt > 0)) {
      const { q, c } = this.chargeAt(vd, cd, gd);
      this.charge.update(vd, q, c, this.h, this.order);
      cd += this.charge.current(vd);
      gd += this.charge.geq;
    }
    // the linearized junction: i = gd·v + (cd − gd·vd)
    this.conductance(this.ap, this.k, gd);
    this.currentSource(this.ap, this.k, cd - gd * vd);
    if (th) this.loadThermal(th, vd, cd, gd, cddT, dT);
  }

  /** Self-heating's stamps (dioload.c): RS at T, the current's temperature terms, the thermal node. */
  private loadThermal(th: DiodeThermal, vd: number, cd: number, gd: number, cddT: number, dT: number): void {
    const p = this.p, a = this.a, ap = this.ap, k = this.k, tn = th.tn;
    const gspr = p.rs > 0 ? 1 / p.rs : 0;
    if (ap !== a) this.conductance(a, ap, gspr);
    const vrs = this.v(a) - this.v(ap);
    const dIrsdT = vrs * p.gsdT;
    // dissipated power (junction, displacement current included as ngspice does, and RS)
    const ith = vd * cd + vrs * vrs * gspr;
    const dIthdVrs = 2 * vrs * gspr;
    const dIthdT = vrs * dIrsdT + cddT * vd;
    const dIthdVdio = cd + vd * gd;
    let gcTt = 0, ceqqth = 0;
    if (!this.dc && th.cth > 0) {
      this.qth.update(dT, th.cth * dT, th.cth, this.h, this.order);
      gcTt = this.qth.geq;
      ceqqth = this.qth.current(dT) - gcTt * dT;
    }
    this.rhs(a, dIrsdT * dT);
    this.rhs(ap, cddT * dT - dIrsdT * dT);
    this.rhs(k, -cddT * dT);
    this.rhs(tn, ith - dIthdVdio * vd - dIthdVrs * vrs - dIthdT * dT - ceqqth);
    this.matrix(tn, a, -dIthdVrs);
    this.matrix(tn, ap, -dIthdVdio + dIthdVrs);
    this.matrix(tn, k, dIthdVdio);
    this.matrix(tn, tn, -dIthdT + (th.rth > 0 ? 1 / th.rth : 0) + gcTt);
    this.matrix(a, tn, dIrsdT);
    this.matrix(ap, tn, cddT - dIrsdT);
    this.matrix(k, tn, -cddT);
  }

  override stepFinished(): void {
    const th = this.thermal;
    if (th && th.cth > 0) {
      // the temperature rise at the solution (the parameters are the last iteration's)
      const dT = this.v(th.tn);
      if (this.dc) this.qth.settle(th.cth * dT);
      else this.qth.accept(th.cth * dT, this.h);
    }
    const p = this.p;
    if (!(p.cjo > 0 || p.tt > 0)) return;
    const vd = this.v(this.ap) - this.v(this.k);
    const { cd, gd } = diodeCurrent(p, vd);
    const { q } = this.chargeAt(vd, cd + p.gmin * vd, gd + p.gmin);
    if (this.dc) this.charge.settle(q);
    else this.charge.accept(q, this.h);
  }

  override states(values: number[], abstol: number[]): void {
    if (this.thermal && this.thermal.cth > 0) {
      // the thermal capacitance's heat (1 µK of it as the tolerance)
      values.push(this.qth.q);
      abstol.push(this.thermal.cth * 1e-6);
    }
    if (!(this.p.cjo > 0 || this.p.tt > 0)) return;
    values.push(this.charge.q);
    abstol.push(CHARGE_TOL);
  }

  /** The junction current at the solution (dc and charge), anode to cathode. */
  junctionCurrent(): number {
    const vd = this.v(this.ap) - this.v(this.k);
    let i = diodeCurrent(this.p, vd).cd + this.p.gmin * vd;
    if (!this.dc && (this.p.cjo > 0 || this.p.tt > 0)) i += this.charge.current(vd);
    return i;
  }

  override currents(into: number[]): void {
    const i = this.junctionCurrent();
    addInto(into, this.a, i);
    addInto(into, this.k, -i);
  }
}
