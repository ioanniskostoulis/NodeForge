// The SPICE JFET (ngspice's level 1: jfetload.c, jfettemp.c): Shichman-Hodges drain current with
// channel-length modulation and the Sydney University doping-tail parameter B, symmetric in drain
// and source (inverse mode), gate-source and gate-drain junctions (IS) with their depletion charges
// (IS, N; CGS, CGD, PB, FC; grading 1/2), and series RD / RS.
// Copyright 1985 - 2018, Regents of the University of California and others, ngspice (https://ngspice.sourceforge.io), Modified BSD licence (assets/licenses/ngspice-modified-bsd.txt).
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { SpiceModel } from "../spice/parse";
import { addInto, BOLTZMANN, CHARGE, Charge, Device, type DeviceHost, fetlim, GMIN, K_OVER_Q, pnjlim, T_DEFAULT, T_NOMINAL } from "./device";

export interface JfetParams {
  /** 1 for NJF, −1 for PJF. */
  type: number;
  /** Threshold (pinch-off, negative for depletion parts of either type), transconductance (A/V²). */
  vto: number;
  beta: number;
  lambda: number;
  /** Doping-tail parameter and ngspice's (1 − B)/(PB − VTO). */
  b: number;
  bFac: number;
  /** Gate junction saturation current and emission coefficient, zero-bias capacitances, potential. */
  is: number;
  n: number;
  cgs: number;
  cgd: number;
  pb: number;
  /** fc·pb and the linear extension's coefficients. */
  depCap: number;
  f1: number;
  f2: number;
  f3: number;
  /** Drain and source conductances (0: no resistance). */
  gd: number;
  gs: number;
  vt: number;
  vcrit: number;
}

const egap = (t: number) => 1.16 - (7.02e-4 * t * t) / (t + 1108);

/** JFET parameters from a `.model … NJF/PJF` card at temperature `temp` (K), scaled by `area`. */
export function jfetParams(m: SpiceModel, temp = T_DEFAULT, area = 1): JfetParams {
  const g = (names: string[], d: number) => {
    for (const k of names) {
      const v = m.params.get(k);
      if (v !== undefined) return v;
    }
    return d;
  };
  const type = m.type === "PJF" ? -1 : 1;
  const tnom = g(["tnom"], 27) + 273.15;
  const vtnom = K_OVER_Q * tnom;
  const fact1 = tnom / T_NOMINAL;
  const arg1 = -egap(tnom) / (2 * BOLTZMANN * tnom) + 1.1150877 / (BOLTZMANN * 2 * T_NOMINAL);
  const pbfact1 = -2 * vtnom * (1.5 * Math.log(fact1) + CHARGE * arg1);
  const pb0 = g(["pb"], 1);
  const pbo = (pb0 - pbfact1) / fact1;
  const gmaold = (pb0 - pbo) / pbo;
  const cjfact = 1 / (1 + 0.5 * (4e-4 * (tnom - T_NOMINAL) - gmaold));
  const fc = Math.min(g(["fc"], 0.5), 0.95);
  const xfc = Math.log(1 - fc);
  const vto0 = g(["vto", "vt0"], -2);
  const b = g(["b"], 1);
  // at the device temperature
  const vt = temp * K_OVER_Q;
  const fact2 = temp / T_NOMINAL;
  const ratio1 = temp / tnom - 1;
  const n = g(["n"], 1), vtn = vt * n;
  const is0 = g(["is"], 1e-14), eg = g(["eg"], 1.11);
  const is = (m.params.has("xti") ? is0 * Math.exp((ratio1 * eg) / vtn) * Math.pow(ratio1 + 1, g(["xti"], 3)) : is0 * Math.exp((ratio1 * eg) / vtn)) * area;
  const arg = -egap(temp) / (2 * BOLTZMANN * temp) + 1.1150877 / (BOLTZMANN * 2 * T_NOMINAL);
  const pbfact = -2 * vt * (1.5 * Math.log(fact2) + CHARGE * arg);
  const pb = fact2 * pbo + pbfact;
  const gmanew = (pb - pbo) / pbo;
  const cjfact1 = 1 + 0.5 * (4e-4 * (temp - T_NOMINAL) - gmanew);
  const vto = m.params.has("vtotc") ? vto0 + g(["vtotc"], 0) * (temp - tnom) : vto0 - g(["tcv"], 0) * (temp - tnom);
  const beta = m.params.has("betatce") ? g(["beta"], 1e-4) * Math.pow(1.01, g(["betatce"], 0) * (temp - tnom)) : g(["beta"], 1e-4) * Math.pow(temp / tnom, g(["bex"], 0));
  const inv = (r: number) => (r > 0 ? 1 / r : 0);
  return {
    type, vto,
    beta: beta * area,
    lambda: g(["lambda"], 0),
    b, bFac: (1 - b) / (pb0 - vto0),
    is, n,
    cgs: g(["cgs"], 0) * cjfact * cjfact1 * area,
    cgd: g(["cgd"], 0) * cjfact * cjfact1 * area,
    pb,
    depCap: fc * pb,
    f1: (pb * (1 - Math.exp(0.5 * xfc))) / 0.5,
    f2: Math.exp(1.5 * xfc),
    f3: 1 - fc * 1.5,
    gd: inv(g(["rd"], 0)) * area,
    gs: inv(g(["rs"], 0)) * area,
    vt,
    vcrit: vt * Math.log(vt / (Math.SQRT2 * is)),
  };
}

/** A gate junction's current and conductance (with gmin), ngspice's cubic tail in reverse. */
function junction(isat: number, v: number, vt: number): { i: number; g: number } {
  if (v < -3 * vt) {
    let arg = (3 * vt) / (v * Math.E);
    arg = arg * arg * arg;
    return { i: -isat * (1 + arg) + GMIN * v, g: (isat * 3 * arg) / v + GMIN };
  }
  const e = Math.exp(v / vt);
  return { i: isat * (e - 1) + GMIN * v, g: (isat * e) / vt + GMIN };
}

/**
 * A level 1 JFET on its part's nodes: drain, gate, source; dp / sp inside RD / RS (the outer node
 * when there's no resistance).
 */
export class JfetDevice extends Device {
  // the last iteration's voltages and currents (ngspice's state0)
  vgs = 0;
  vgd = 0;
  cg = 0;
  cd = 0;
  cgd = 0;
  gm = 0;
  gds = 0;
  ggs = 0;
  ggd = 0;
  readonly qgs = new Charge();
  readonly qgd = new Charge();

  constructor(host: DeviceHost, public p: JfetParams, readonly d: number, readonly g: number, readonly s: number, readonly dp: number, readonly sp: number) {
    super(host);
  }

  override nonLinear(): boolean {
    return true;
  }

  private get hasCharge(): boolean {
    return this.p.cgs > 0 || this.p.cgd > 0;
  }

  override reset(): void {
    this.vgs = this.vgd = this.cg = this.cd = this.cgd = this.gm = this.gds = this.ggs = this.ggd = 0;
    this.qgs.settle(0);
    this.qgd.settle(0);
  }

  override stamp(): void {
    if (this.dp !== this.d) this.conductance(this.d, this.dp, this.p.gd);
    if (this.sp !== this.s) this.conductance(this.s, this.sp, this.p.gs);
  }

  private voltages(): { vgs: number; vgd: number } {
    const t = this.p.type;
    return { vgs: t * (this.v(this.g) - this.v(this.sp)), vgd: t * (this.v(this.g) - this.v(this.dp)) };
  }

  /** The drain current and its derivatives at vgs, vds (jfetload.c, both modes). */
  private channel(vgs: number, vgd: number): { cdrain: number; gm: number; gds: number } {
    const p = this.p, vds = vgs - vgd;
    let cdrain = 0, gm = 0, gds = 0;
    if (vds >= 0) {
      const vgst = vgs - p.vto;
      if (vgst > 0) {
        const betap = p.beta * (1 + p.lambda * vds);
        let bfac = p.bFac;
        if (vgst >= vds) {
          // normal mode, linear region
          const apart = 2 * p.b + 3 * bfac * (vgst - vds);
          const cpart = vds * (vds * (bfac * vds - p.b) + vgst * apart);
          cdrain = betap * cpart;
          gm = betap * vds * (apart + 3 * bfac * vgst);
          gds = betap * (vgst - vds) * apart + p.beta * p.lambda * cpart;
        } else {
          // normal mode, saturation
          bfac = vgst * bfac;
          gm = betap * vgst * (2 * p.b + 3 * bfac);
          const cpart = vgst * vgst * (p.b + bfac);
          cdrain = betap * cpart;
          gds = p.lambda * p.beta * cpart;
        }
      }
    } else {
      const vgdt = vgd - p.vto;
      if (vgdt > 0) {
        const betap = p.beta * (1 - p.lambda * vds);
        let bfac = p.bFac;
        if (vgdt + vds >= 0) {
          // inverse mode, linear region
          const apart = 2 * p.b + 3 * bfac * (vgdt + vds);
          const cpart = vds * (-vds * (-bfac * vds - p.b) + vgdt * apart);
          cdrain = betap * cpart;
          gm = betap * vds * (apart + 3 * bfac * vgdt);
          gds = betap * (vgdt + vds) * apart - p.beta * p.lambda * cpart - gm;
        } else {
          // inverse mode, saturation
          bfac = vgdt * bfac;
          gm = -betap * vgdt * (2 * p.b + 3 * bfac);
          const cpart = vgdt * vgdt * (p.b + bfac);
          cdrain = -betap * cpart;
          gds = p.lambda * p.beta * cpart - gm;
        }
      }
    }
    return { cdrain, gm, gds };
  }

  /** Gate depletion charge and capacitance (grading 1/2), linear above fc·pb. */
  private depletion(v: number, cz: number): { q: number; c: number } {
    const p = this.p;
    if (cz === 0) return { q: 0, c: 0 };
    const twop = p.pb + p.pb;
    if (v < p.depCap) {
      const sarg = Math.sqrt(1 - v / p.pb);
      return { q: twop * cz * (1 - sarg), c: cz / sarg };
    }
    const czf2 = cz / p.f2;
    return { q: cz * p.f1 + czf2 * (p.f3 * (v - p.depCap) + (v * v - p.depCap * p.depCap) / (twop + twop)), c: czf2 * (p.f3 + v / twop) };
  }

  override doStep(): void {
    const p = this.p, t = p.type;
    const raw = this.voltages();
    // ngspice's convergence test on the gate and drain currents (jfetload.c)
    const delvgs = raw.vgs - this.vgs, delvgd = raw.vgd - this.vgd, delvds = delvgs - delvgd;
    const cghat = this.cg + this.ggd * delvgd + this.ggs * delvgs;
    const cdhat = this.cd + this.gm * delvgs + this.gds * delvds - this.ggd * delvgd;
    if (Math.abs(cghat - this.cg) >= this.currentTol(cghat, this.cg) || Math.abs(cdhat - this.cd) > this.currentTol(cdhat, this.cd)) this.notConverged();
    // limiting: the junctions, then around the threshold
    const lgs = pnjlim(raw.vgs, this.vgs, p.vt, p.vcrit);
    const lgd = pnjlim(raw.vgd, this.vgd, p.vt, p.vcrit);
    if (lgs.limited || lgd.limited) this.notConverged();
    let vgs = lgs.v, vgd = lgd.v;
    // (no FET limiting once a CircuitJS-mode step struggles: it can cycle between its clamps)
    if (this.struggling <= 100) {
      vgs = fetlim(vgs, this.vgs, p.vto);
      vgd = fetlim(vgd, this.vgd, p.vto);
    }
    const vds = vgs - vgd;
    const vtn = p.vt * p.n;
    const js = junction(p.is, vgs, vtn), jd = junction(p.is, vgd, vtn);
    let cg = js.i + jd.i, cgd = jd.i, ggs = js.g, ggd = jd.g;
    const { cdrain, gm, gds } = this.channel(vgs, vgd);
    let cd = cdrain - cgd;
    if (!this.dc && this.hasCharge) {
      const qs = this.depletion(vgs, p.cgs), qd = this.depletion(vgd, p.cgd);
      this.qgs.update(vgs, qs.q, qs.c, this.h, this.order);
      this.qgd.update(vgd, qd.q, qd.c, this.h, this.order);
      const iqs = this.qgs.current(vgs), iqd = this.qgd.current(vgd);
      ggs += this.qgs.geq;
      cg += iqs;
      ggd += this.qgd.geq;
      cg += iqd;
      cd -= iqd;
      cgd += iqd;
    }
    this.vgs = vgs;
    this.vgd = vgd;
    this.cg = cg;
    this.cd = cd;
    this.cgd = cgd;
    this.gm = gm;
    this.gds = gds;
    this.ggs = ggs;
    this.ggd = ggd;

    // load (jfetload.c)
    const ceqgd = t * (cgd - ggd * vgd);
    const ceqgs = t * (cg - cgd - ggs * vgs);
    const cdreq = t * (cd + cgd - gds * vds - gm * vgs);
    const { g, dp, sp } = this;
    this.rhs(g, -ceqgs - ceqgd);
    this.rhs(dp, -cdreq + ceqgd);
    this.rhs(sp, cdreq + ceqgs);
    this.matrix(g, g, ggd + ggs);
    this.matrix(g, dp, -ggd);
    this.matrix(g, sp, -ggs);
    this.matrix(dp, g, gm - ggd);
    this.matrix(dp, dp, gds + ggd);
    this.matrix(dp, sp, -gds - gm);
    this.matrix(sp, g, -ggs - gm);
    this.matrix(sp, dp, -gds);
    this.matrix(sp, sp, gds + gm + ggs);
  }

  override stepFinished(): void {
    if (!this.hasCharge) return;
    const { vgs, vgd } = this.voltages();
    const qs = this.depletion(vgs, this.p.cgs).q, qd = this.depletion(vgd, this.p.cgd).q;
    if (this.dc) {
      this.qgs.settle(qs);
      this.qgd.settle(qd);
    } else {
      this.qgs.accept(qs, this.h);
      this.qgd.accept(qd, this.h);
    }
  }

  override states(values: number[], abstol: number[]): void {
    if (!this.hasCharge) return;
    // (as a capacitor's 1 µV: picofarad gate charges are far below SPICE's 1e-14 C)
    values.push(this.qgs.q, this.qgd.q);
    abstol.push(Math.max(1e-18, this.p.cgs * 1e-6), Math.max(1e-18, this.p.cgd * 1e-6));
  }

  override currents(into: number[]): void {
    const p = this.p, t = p.type;
    const { vgs, vgd } = this.voltages();
    let igs = junction(p.is, vgs, p.vt * p.n).i, igd = junction(p.is, vgd, p.vt * p.n).i;
    if (!this.dc && this.hasCharge) {
      igs += this.qgs.current(vgs);
      igd += this.qgd.current(vgd);
    }
    const ich = this.channel(vgs, vgd).cdrain;
    addInto(into, this.g, t * (igs + igd));
    addInto(into, this.sp, -t * igs - t * ich);
    addInto(into, this.dp, -t * igd + t * ich);
    const r = (a: number, b: number, gg: number) => {
      if (a === b || !(gg > 0)) return;
      const i = (this.v(a) - this.v(b)) * gg;
      addInto(into, a, i);
      addInto(into, b, -i);
    };
    r(this.d, this.dp, p.gd);
    r(this.s, this.sp, p.gs);
  }
}
