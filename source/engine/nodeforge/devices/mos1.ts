// The SPICE level 1 MOSFET (ngspice's mos1load.c / mos1temp.c): Shichman-Hodges with body effect
// and channel-length modulation, Meyer gate capacitances (when TOX is given) plus overlap
// capacitances, bulk junction diodes with depletion charge, and series RD / RS. It's what most
// manufacturer power-MOSFET subcircuits are built around.
// Copyright 1985 - 2018, Regents of the University of California and others, ngspice (https://ngspice.sourceforge.io), Modified BSD licence (assets/licenses/ngspice-modified-bsd.txt).
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { SpiceModel } from "../spice/parse";
import { addInto, BOLTZMANN, CHARGE, CHARGE_TOL, Charge, Device, type DeviceHost, fetlim, GMIN, K_OVER_Q, limvds, pnjlim, T_DEFAULT, T_NOMINAL } from "./device";

export interface Mos1Params {
  type: number;
  beta: number;
  lambda: number;
  gamma: number;
  phi: number;
  /** Built-in voltage (the threshold without body effect), threshold. */
  vbi: number;
  vto: number;
  /** Overlap capacitances (F), oxide capacitance (F; 0: no Meyer capacitances). */
  cgso: number;
  cgdo: number;
  cgbo: number;
  cox: number;
  rd: number;
  rs: number;
  // bulk junctions
  drainSat: number;
  sourceSat: number;
  vcrit: number;
  pb: number;
  mj: number;
  mjsw: number;
  fc: number;
  depCap: number;
  cbd: number;
  cbdsw: number;
  cbs: number;
  cbssw: number;
  f2d: number;
  f3d: number;
  f4d: number;
  f2s: number;
  f3s: number;
  f4s: number;
  vt: number;
}

const egap = (t: number) => 1.16 - (7.02e-4 * t * t) / (t + 1108);

/** Instance values of an M line: L, W, M, AD, AS, PD, PS (SPICE defaults: L = W = 100 µm). */
export interface Mos1Instance {
  l: number;
  w: number;
  m: number;
  ad: number;
  as: number;
  pd: number;
  ps: number;
}

/** Level 1 parameters from a `.model … NMOS/PMOS` card for one instance, at temperature `temp`. */
export function mos1Params(model: SpiceModel, inst: Mos1Instance, temp = T_DEFAULT): Mos1Params {
  const g = (k: string, d: number) => model.params.get(k) ?? d;
  const has = (k: string) => model.params.has(k);
  const type = model.type === "PMOS" ? -1 : 1;
  const tnom = g("tnom", 27) + 273.15;
  const vtnom = tnom * K_OVER_Q;
  const fact1 = tnom / T_NOMINAL;
  const egfet1 = egap(tnom);
  const arg1 = -egfet1 / (2 * BOLTZMANN * tnom) + 1.1150877 / (BOLTZMANN * 2 * T_NOMINAL);
  const pbfact1 = -2 * vtnom * (1.5 * Math.log(fact1) + CHARGE * arg1);
  // oxide capacitance per area, and what follows from TOX / NSUB when not given
  const tox = g("tox", 0);
  const coxFactor = tox > 0 ? (3.9 * 8.854214871e-12) / tox : 0;
  let kp = g("kp", 2e-5);
  if (coxFactor > 0 && !has("kp")) kp = g("uo", g("u0", 600)) * coxFactor * 1e-4;
  let phi = g("phi", 0.6);
  let gamma = g("gamma", 0);
  let vto = g("vto", g("vt0", 0));
  const nsub = g("nsub", 0);
  if (coxFactor > 0 && nsub * 1e6 > 1.45e16) {
    if (!has("phi")) phi = Math.max(0.1, 2 * vtnom * Math.log((nsub * 1e6) / 1.45e16));
    const fermis = type * 0.5 * phi;
    const tpg = g("tpg", 1);
    let wkfng = 3.2;
    if (tpg !== 0) wkfng = 3.25 + 0.5 * egfet1 - type * tpg * 0.5 * egfet1;
    const wkfngs = wkfng - (3.25 + 0.5 * egfet1 + fermis);
    if (!has("gamma")) gamma = Math.sqrt(2 * 11.7 * 8.854214871e-12 * CHARGE * nsub * 1e6) / coxFactor;
    if (!has("vto") && !has("vt0")) vto = wkfngs - (g("nss", 0) * 1e4 * CHARGE) / coxFactor + type * (gamma * Math.sqrt(phi) + phi);
  }
  // temperature
  const vt = temp * K_OVER_Q;
  const ratio = temp / tnom;
  const fact2 = temp / T_NOMINAL;
  const egfet = egap(temp);
  const arg = -egfet / (2 * BOLTZMANN * temp) + 1.1150877 / (BOLTZMANN * 2 * T_NOMINAL);
  const pbfact = -2 * vt * (1.5 * Math.log(fact2) + CHARGE * arg);
  const tphi = fact2 * ((phi - pbfact1) / fact1) + pbfact;
  const tvbi = vto - type * gamma * Math.sqrt(phi) + 0.5 * (egfet1 - egfet) + type * 0.5 * (tphi - phi);
  const tvto = tvbi + type * gamma * Math.sqrt(tphi);
  const satFactor = Math.exp(-egfet / vt + egfet1 / vtnom);
  const isat = g("is", 1e-14) * satFactor, js = g("js", 0) * satFactor;
  const pb0 = g("pb", 0.8), mj = g("mj", 0.5), mjsw = g("mjsw", 0.5), fc = g("fc", 0.5);
  const pbo = (pb0 - pbfact1) / fact1;
  const gmaold = (pb0 - pbo) / pbo;
  const tpb = fact2 * pbo + pbfact;
  const gmanew = (tpb - pbo) / pbo;
  const capT = (mgrade: number) => (1 + mgrade * (4e-4 * (temp - T_NOMINAL) - gmanew)) / (1 + mgrade * (4e-4 * (tnom - T_NOMINAL) - gmaold));
  const { l, w, m, ad, as, pd, ps } = inst;
  const leff = l - 2 * g("ld", 0);
  const cj = g("cj", 0) * capT(mj), cjsw = g("cjsw", 0) * capT(mjsw);
  const czbd = has("cbd") ? g("cbd", 0) * capT(mj) * m : has("cj") ? cj * m * ad : 0;
  const czbs = has("cbs") ? g("cbs", 0) * capT(mj) * m : has("cj") ? cj * m * as : 0;
  const czbdsw = has("cjsw") ? cjsw * pd * m : 0;
  const czbssw = has("cjsw") ? cjsw * ps * m : 0;
  const a1 = 1 - fc;
  const sarg = Math.exp(-mj * Math.log(a1)), sargsw = Math.exp(-mjsw * Math.log(a1));
  const f = (cz: number, czsw: number) => {
    const f2 = (cz * (1 - fc * (1 + mj)) * sarg) / a1 + (czsw * (1 - fc * (1 + mjsw)) * sargsw) / a1;
    const f3 = (cz * mj * sarg) / a1 / tpb + (czsw * mjsw * sargsw) / a1 / tpb;
    const depCap = fc * tpb;
    const f4 = (cz * tpb * (1 - a1 * sarg)) / (1 - mj) + (czsw * tpb * (1 - a1 * sargsw)) / (1 - mjsw) - (f3 / 2) * depCap * depCap - depCap * f2;
    return { f2, f3, f4 };
  };
  const fd = f(czbd, czbdsw), fs = f(czbs, czbssw);
  const useDens = js !== 0 && ad !== 0 && as !== 0;
  const drainSat = useDens ? js * m * ad : m * isat;
  const sourceSat = useDens ? js * m * as : m * isat;
  const rd = g("rd", 0), rs = g("rs", 0), rsh = g("rsh", 0);
  return {
    type,
    beta: ((kp / Math.pow(ratio, 1.5)) * m * w) / leff,
    lambda: g("lambda", 0),
    gamma, phi: tphi, vbi: tvbi, vto: tvto,
    cgso: g("cgso", 0) * m * w, cgdo: g("cgdo", 0) * m * w, cgbo: g("cgbo", 0) * m * leff,
    cox: coxFactor * leff * m * w,
    rd: rd > 0 ? rd / m : rsh > 0 ? rsh / m : 0,
    rs: rs > 0 ? rs / m : rsh > 0 ? rsh / m : 0,
    drainSat, sourceSat,
    vcrit: vt * Math.log(vt / (Math.SQRT2 * Math.max(drainSat, 1e-300))),
    pb: tpb, mj, mjsw, fc, depCap: fc * tpb,
    cbd: czbd, cbdsw: czbdsw, cbs: czbs, cbssw: czbssw,
    f2d: fd.f2, f3d: fd.f3, f4d: fd.f4, f2s: fs.f2, f3s: fs.f3, f4s: fs.f4,
    vt,
  };
}

/** Meyer's gate capacitances (halves of the voltage-dependent part), DEVqmeyer. */
function qmeyer(vgs: number, vgd: number, von: number, vdsat: number, phi: number, cox: number): { gs: number; gd: number; gb: number } {
  const vgst = vgs - von;
  vdsat = Math.max(vdsat, 0.025);
  if (vgst <= -phi) return { gb: cox / 2, gs: 0, gd: 0 };
  if (vgst <= -phi / 2) return { gb: (-vgst * cox) / (2 * phi), gs: 0, gd: 0 };
  const vds = vgs - vgd;
  if (vgst <= 0) {
    const gb = (-vgst * cox) / (2 * phi);
    let gs = (vgst * cox) / (1.5 * phi) + cox / 3;
    let gd = 0;
    if (vds < vdsat) {
      const vddif = 2 * vdsat - vds, vddif1 = vdsat - vds, vddif2 = vddif * vddif;
      gd = gs * (1 - (vdsat * vdsat) / vddif2);
      gs = gs * (1 - (vddif1 * vddif1) / vddif2);
    }
    return { gs, gd, gb };
  }
  if (vdsat <= vds) return { gs: cox / 3, gd: 0, gb: 0 };
  const vddif = 2 * vdsat - vds, vddif1 = vdsat - vds, vddif2 = vddif * vddif;
  return { gd: (cox * (1 - (vdsat * vdsat) / vddif2)) / 3, gs: (cox * (1 - (vddif1 * vddif1) / vddif2)) / 3, gb: 0 };
}

/** A gate capacitance as ngspice integrates it: Meyer half now + half at the last step + overlap. */
class GateCap extends Charge {
  v1 = 0;
  c1 = 0;
  at(v: number, half: number, overlap: number, h: number, order = 2): void {
    const total = half + this.c1 + overlap;
    this.update(v, (v - this.v1) * total + this.q1, total, h, order);
  }
  acceptAt(v: number, half: number, overlap: number, h: number): void {
    this.accept((v - this.v1) * (half + this.c1 + overlap) + this.q1, h);
    this.v1 = v;
    this.c1 = half;
  }
  settleAt(v: number, half: number, overlap: number): void {
    this.settle(v * (2 * half + overlap));
    this.v1 = v;
    this.c1 = half;
  }
}

/** A level 1 MOSFET on its part's nodes: drain, gate, source, bulk; dp / sp inside RD / RS. */
export class Mos1Device extends Device {
  vgs = 0;
  vds = 0;
  vbs = 0;
  cd = 0;
  gm = 0;
  gds = 0;
  gmbs = 0;
  cbs = 0;
  gbs = 0;
  cbd = 0;
  gbd = 0;
  mode = 1;
  von = 0;
  vdsat = 0;
  readonly qgs = new GateCap();
  readonly qgd = new GateCap();
  readonly qgb = new GateCap();
  readonly qbs = new Charge();
  /** Tolerances: the nominal VBI / VTO / β, kept while a variation is applied (null: none applied). */
  private nominal: { vbi: number; vto: number; beta: number } | null = null;

  /** Vary the threshold (by dVt, V as the card's VTO) and β (by a factor), from the nominal values. */
  setVariation(dVt: number, gain: number): void {
    const p = this.p;
    this.nominal ??= { vbi: p.vbi, vto: p.vto, beta: p.beta };
    p.vbi = this.nominal.vbi + dVt;
    p.vto = this.nominal.vto + dVt;
    p.beta = this.nominal.beta * gain;
  }
  readonly qbd = new Charge();

  constructor(
    host: DeviceHost, public p: Mos1Params,
    readonly d: number, readonly g: number, readonly s: number, readonly b: number,
    readonly dp: number, readonly sp: number,
  ) {
    super(host);
    this.von = p.type * p.vto;
  }

  override nonLinear(): boolean {
    return true;
  }

  override reset(): void {
    this.vgs = this.vds = this.vbs = this.cd = this.gm = this.gds = this.gmbs = 0;
    this.cbs = this.gbs = this.cbd = this.gbd = 0;
    this.mode = 1;
    this.settleCaps(0, 0, 0);
  }

  override stamp(): void {
    if (this.dp !== this.d) this.conductance(this.d, this.dp, 1 / this.p.rd);
    if (this.sp !== this.s) this.conductance(this.s, this.sp, 1 / this.p.rs);
  }

  /** Bulk junction depletion charge and capacitance (drain or source side). */
  private junction(v: number, cz: number, czsw: number, f2: number, f3: number, f4: number): { q: number; c: number } {
    const p = this.p;
    if (cz === 0 && czsw === 0) return { q: 0, c: 0 };
    if (v < p.depCap) {
      const arg = 1 - v / p.pb;
      const sarg = Math.exp(-p.mj * Math.log(arg)), sargsw = Math.exp(-p.mjsw * Math.log(arg));
      return {
        q: p.pb * ((cz * (1 - arg * sarg)) / (1 - p.mj) + (czsw * (1 - arg * sargsw)) / (1 - p.mjsw)),
        c: cz * sarg + czsw * sargsw,
      };
    }
    return { q: f4 + v * (f2 + (v * f3) / 2), c: f2 + f3 * v };
  }

  /**
   * Channel current and its derivatives at normalized vgs, vds, vbs (sets cd, gm, gds, gmbs, mode,
   * von, vdsat). Levels 2 and 3 replace it; the rest of the device (junctions, Meyer capacitances,
   * limiting, stamps) is the same in ngspice's mos2load / mos3load.
   */
  protected channel(vgs: number, vds: number, vbs: number): number {
    const p = this.p;
    const vbd = vbs - vds, vgd = vgs - vds;
    this.mode = vds >= 0 ? 1 : -1;
    const vb = this.mode === 1 ? vbs : vbd;
    let sarg: number;
    if (vb <= 0) sarg = Math.sqrt(p.phi - vb);
    else {
      sarg = Math.sqrt(p.phi);
      sarg = Math.max(0, sarg - vb / (sarg + sarg));
    }
    const von = p.vbi * p.type + p.gamma * sarg;
    const vgst = (this.mode === 1 ? vgs : vgd) - von;
    this.von = von;
    this.vdsat = Math.max(vgst, 0);
    const arg = sarg <= 0 ? 0 : p.gamma / (sarg + sarg);
    let cdrain = 0;
    if (vgst <= 0) this.gm = this.gds = this.gmbs = 0;
    else {
      const md = vds * this.mode;
      const betap = p.beta * (1 + p.lambda * md);
      if (vgst <= md) {
        cdrain = betap * vgst * vgst * 0.5;
        this.gm = betap * vgst;
        this.gds = p.lambda * p.beta * vgst * vgst * 0.5;
      } else {
        cdrain = betap * md * (vgst - 0.5 * md);
        this.gm = betap * md;
        this.gds = betap * (vgst - md) + p.lambda * p.beta * md * (vgst - 0.5 * md);
      }
      this.gmbs = this.gm * arg;
    }
    return cdrain;
  }

  override doStep(): void {
    const p = this.p, type = p.type, vt = p.vt;
    let vbs = type * (this.v(this.b) - this.v(this.sp));
    let vgs = type * (this.v(this.g) - this.v(this.sp));
    let vds = type * (this.v(this.dp) - this.v(this.sp));
    let vbd = vbs - vds;
    let vgd = vgs - vds;
    const vgdo = this.vgs - this.vds;
    // ngspice's convergence test on the drain and bulk currents
    const delvbs = vbs - this.vbs, delvbd = vbd - (this.vbs - this.vds), delvgs = vgs - this.vgs, delvds = vds - this.vds, delvgd = vgd - vgdo;
    const cdhat = this.mode >= 0
      ? this.cd - this.gbd * delvbd + this.gmbs * delvbs + this.gm * delvgs + this.gds * delvds
      : this.cd - (this.gbd - this.gmbs) * delvbd - this.gm * delvgd + this.gds * delvds;
    const cbhat = this.cbs + this.cbd + this.gbd * delvbd + this.gbs * delvbs;
    if (Math.abs(cdhat - this.cd) > this.currentTol(cdhat, this.cd) || Math.abs(cbhat - (this.cbs + this.cbd)) > this.currentTol(cbhat, this.cbs + this.cbd)) this.notConverged();
    // limiting
    // (no FET limiting once a CircuitJS-mode step struggles: it can cycle between its clamps)
    if (this.struggling <= 100) {
      if (this.vds >= 0) {
        vgs = fetlim(vgs, this.vgs, this.von);
        vds = vgs - vgd;
        vds = limvds(vds, this.vds);
        vgd = vgs - vds;
      } else {
        vgd = fetlim(vgd, vgdo, this.von);
        vds = vgs - vgd;
        vds = -limvds(-vds, -this.vds);
        vgs = vgd + vds;
      }
    }
    if (vds >= 0) {
      const r = pnjlim(vbs, this.vbs, vt, p.vcrit);
      vbs = r.v;
      if (r.limited) this.notConverged();
      vbd = vbs - vds;
    } else {
      const r = pnjlim(vbd, this.vbs - this.vds, vt, p.vcrit);
      vbd = r.v;
      if (r.limited) this.notConverged();
      vbs = vbd + vds;
    }
    vbd = vbs - vds;
    vgd = vgs - vds;
    const vgb = vgs - vbs;

    // bulk junctions
    if (vbs <= -3 * vt) {
      this.gbs = GMIN;
      this.cbs = this.gbs * vbs - p.sourceSat;
    } else {
      const e = Math.exp(Math.min(709, vbs / vt));
      this.gbs = (p.sourceSat * e) / vt + GMIN;
      this.cbs = p.sourceSat * (e - 1) + GMIN * vbs;
    }
    if (vbd <= -3 * vt) {
      this.gbd = GMIN;
      this.cbd = this.gbd * vbd - p.drainSat;
    } else {
      const e = Math.exp(Math.min(709, vbd / vt));
      this.gbd = (p.drainSat * e) / vt + GMIN;
      this.cbd = p.drainSat * (e - 1) + GMIN * vbd;
    }
    const cdrain = this.channel(vgs, vds, vbs);
    this.cd = this.mode * cdrain - this.cbd;
    this.vgs = vgs;
    this.vds = vds;
    this.vbs = vbs;

    // charges
    let gcgs = 0, gcgd = 0, gcgb = 0, ceqgs = 0, ceqgd = 0, ceqgb = 0;
    let gbd = this.gbd, gbs = this.gbs, cbd = this.cbd, cbs = this.cbs;
    if (!this.dc) {
      const jd = this.junction(vbd, p.cbd, p.cbdsw, p.f2d, p.f3d, p.f4d);
      const js = this.junction(vbs, p.cbs, p.cbssw, p.f2s, p.f3s, p.f4s);
      this.qbd.update(vbd, jd.q, jd.c, this.h, this.order);
      this.qbs.update(vbs, js.q, js.c, this.h, this.order);
      gbd += this.qbd.geq;
      cbd += this.qbd.current(vbd);
      gbs += this.qbs.geq;
      cbs += this.qbs.current(vbs);
      this.cd -= this.qbd.current(vbd);
      const m = this.mode > 0 ? qmeyer(vgs, vgd, this.von, this.vdsat, p.phi, p.cox) : (() => {
        const r = qmeyer(vgd, vgs, this.von, this.vdsat, p.phi, p.cox);
        return { gs: r.gd, gd: r.gs, gb: r.gb };
      })();
      this.qgs.at(vgs, m.gs, p.cgso, this.h, this.order);
      this.qgd.at(vgd, m.gd, p.cgdo, this.h, this.order);
      this.qgb.at(vgb, m.gb, p.cgbo, this.h, this.order);
      gcgs = this.qgs.geq;
      gcgd = this.qgd.geq;
      gcgb = this.qgb.geq;
      ceqgs = this.qgs.current(vgs) - gcgs * vgs;
      ceqgd = this.qgd.current(vgd) - gcgd * vgd;
      ceqgb = this.qgb.current(vgb) - gcgb * vgb;
    }

    // load (mos1load.c)
    const ceqbs = type * (cbs - gbs * vbs);
    const ceqbd = type * (cbd - gbd * vbd);
    const xnrm = this.mode >= 0 ? 1 : 0, xrev = 1 - xnrm;
    const cdreq = this.mode >= 0
      ? type * (cdrain - this.gds * vds - this.gm * vgs - this.gmbs * vbs)
      : -type * (cdrain - this.gds * -vds - this.gm * vgd - this.gmbs * vbd);
    const { dp, sp, g, b } = this;
    const gm = this.gm, gds = this.gds, gmbs = this.gmbs;
    this.rhs(g, -type * (ceqgs + ceqgb + ceqgd));
    this.rhs(b, -(ceqbs + ceqbd - type * ceqgb));
    this.rhs(dp, ceqbd - cdreq + type * ceqgd);
    this.rhs(sp, cdreq + ceqbs + type * ceqgs);
    this.matrix(g, g, gcgd + gcgs + gcgb);
    this.matrix(b, b, gbd + gbs + gcgb);
    this.matrix(dp, dp, gds + gbd + xrev * (gm + gmbs) + gcgd);
    this.matrix(sp, sp, gds + gbs + xnrm * (gm + gmbs) + gcgs);
    this.matrix(g, b, -gcgb);
    this.matrix(g, dp, -gcgd);
    this.matrix(g, sp, -gcgs);
    this.matrix(b, g, -gcgb);
    this.matrix(b, dp, -gbd);
    this.matrix(b, sp, -gbs);
    this.matrix(dp, g, (xnrm - xrev) * gm - gcgd);
    this.matrix(dp, b, -gbd + (xnrm - xrev) * gmbs);
    this.matrix(dp, sp, -gds - xnrm * (gm + gmbs));
    this.matrix(sp, g, -(xnrm - xrev) * gm - gcgs);
    this.matrix(sp, b, -gbs - (xnrm - xrev) * gmbs);
    this.matrix(sp, dp, -gds - xrev * (gm + gmbs));
  }

  private voltages(): { vgs: number; vds: number; vbs: number; vgd: number; vbd: number; vgb: number } {
    const type = this.p.type;
    const vbs = type * (this.v(this.b) - this.v(this.sp));
    const vgs = type * (this.v(this.g) - this.v(this.sp));
    const vds = type * (this.v(this.dp) - this.v(this.sp));
    return { vgs, vds, vbs, vgd: vgs - vds, vbd: vbs - vds, vgb: vgs - vbs };
  }

  private settleCaps(vgs: number, vgd: number, vgb: number): void {
    const p = this.p;
    const m = qmeyer(vgs, vgd, this.von, this.vdsat, p.phi, p.cox);
    this.qgs.settleAt(vgs, m.gs, p.cgso);
    this.qgd.settleAt(vgd, m.gd, p.cgdo);
    this.qgb.settleAt(vgb, m.gb, p.cgbo);
  }

  override stepFinished(): void {
    const p = this.p;
    const { vgs, vds, vbs, vgd, vbd, vgb } = this.voltages();
    const saved = [this.cd, this.gm, this.gds, this.gmbs, this.mode, this.von, this.vdsat];
    this.channel(vgs, vds, vbs);
    const m = this.mode > 0 ? qmeyer(vgs, vgd, this.von, this.vdsat, p.phi, p.cox) : (() => {
      const r = qmeyer(vgd, vgs, this.von, this.vdsat, p.phi, p.cox);
      return { gs: r.gd, gd: r.gs, gb: r.gb };
    })();
    [this.cd, this.gm, this.gds, this.gmbs, this.mode, this.von, this.vdsat] = saved;
    const jd = this.junction(vbd, p.cbd, p.cbdsw, p.f2d, p.f3d, p.f4d);
    const js = this.junction(vbs, p.cbs, p.cbssw, p.f2s, p.f3s, p.f4s);
    if (this.dc) {
      this.qgs.settleAt(vgs, m.gs, p.cgso);
      this.qgd.settleAt(vgd, m.gd, p.cgdo);
      this.qgb.settleAt(vgb, m.gb, p.cgbo);
      this.qbd.settle(jd.q);
      this.qbs.settle(js.q);
    } else {
      this.qgs.acceptAt(vgs, m.gs, p.cgso, this.h);
      this.qgd.acceptAt(vgd, m.gd, p.cgdo, this.h);
      this.qgb.acceptAt(vgb, m.gb, p.cgbo, this.h);
      this.qbd.accept(jd.q, this.h);
      this.qbs.accept(js.q, this.h);
    }
  }

  override states(values: number[], abstol: number[]): void {
    values.push(this.qgs.q, this.qgd.q, this.qgb.q, this.qbd.q, this.qbs.q);
    abstol.push(CHARGE_TOL, CHARGE_TOL, CHARGE_TOL, CHARGE_TOL, CHARGE_TOL);
  }

  override currents(into: number[]): void {
    const p = this.p, type = p.type;
    const { vgs, vds, vbs, vgd, vbd, vgb } = this.voltages();
    const saved = [this.cd, this.gm, this.gds, this.gmbs, this.mode, this.von, this.vdsat];
    const ich = type * this.mode * this.channel(vgs, vds, vbs);
    [this.cd, this.gm, this.gds, this.gmbs, this.mode, this.von, this.vdsat] = saved;
    addInto(into, this.dp, ich);
    addInto(into, this.sp, -ich);
    // bulk junctions (dc) and charges (on their linearization)
    const jdc = (v: number, sat: number) => (v <= -3 * p.vt ? GMIN * v - sat : sat * (Math.exp(Math.min(709, v / p.vt)) - 1) + GMIN * v);
    let ibd = jdc(vbd, p.drainSat), ibs = jdc(vbs, p.sourceSat);
    if (!this.dc) {
      ibd += this.qbd.current(vbd);
      ibs += this.qbs.current(vbs);
      const igs = this.qgs.current(vgs), igd = this.qgd.current(vgd), igb = this.qgb.current(vgb);
      addInto(into, this.g, type * (igs + igd + igb));
      addInto(into, this.sp, -type * igs);
      addInto(into, this.dp, -type * igd);
      addInto(into, this.b, -type * igb);
    }
    addInto(into, this.b, type * (ibd + ibs));
    addInto(into, this.dp, -type * ibd);
    addInto(into, this.sp, -type * ibs);
    const r = (a: number, b: number, res: number) => {
      if (a === b || !(res > 0)) return;
      const i = (this.v(a) - this.v(b)) / res;
      addInto(into, a, i);
      addInto(into, b, -i);
    };
    r(this.d, this.dp, p.rd);
    r(this.s, this.sp, p.rs);
  }
}
