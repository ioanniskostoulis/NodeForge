// The SPICE level 3 MOSFET (ngspice's mos3load.c / mos3temp.c): the semi-empirical short-channel
// model — threshold with static feedback (ETA), short-channel (XJ) and narrow-width (DELTA) body
// effect, mobility falling with gate voltage (THETA), velocity saturation (VMAX), channel-length
// modulation (KAPPA), weak inversion (NFS) — on level 1's junctions, Meyer capacitances, limiting
// and stamps (Mos1Device), with LD / WD / XL / XW for the effective channel.
// Copyright 1985 - 2018, Regents of the University of California and others, ngspice (https://ngspice.sourceforge.io), Modified BSD licence (assets/licenses/ngspice-modified-bsd.txt).
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { copyParams, type SpiceModel } from "../spice/parse";
import { CHARGE, type DeviceHost, K_OVER_Q, T_DEFAULT } from "./device";
import { Mos1Device, type Mos1Instance, type Mos1Params, mos1Params } from "./mos1";

/** Silicon's permittivity (F/m), as ngspice's EPSSIL. */
const EPSSIL = 11.7 * 8.854214871e-12;

/** What level 3 adds to level 1's parameters. */
export interface Mos3Extra {
  leff: number;
  weff: number;
  /** Oxide capacitance per area (F/m²). */
  coxFactor: number;
  latDiff: number;
  eta: number;
  theta: number;
  kappa: number;
  /** DELTA's narrow-width factor, NFS (cm⁻²), XJ, VMAX. */
  narrowFactor: number;
  nfs: number;
  xj: number;
  vmax: number;
  /** From NSUB: the depletion-layer coefficient and its square (0 without NSUB). */
  alpha: number;
  coeffDepLayWidth: number;
  /** Surface mobility at the device temperature (cm²/Vs). */
  surfMob: number;
}

/** Level 3 parameters from a `.model … NMOS/PMOS (LEVEL=3)` card for one instance, at `temp`. */
export function mos3Params(model: SpiceModel, inst: Mos1Instance, temp = T_DEFAULT): { p: Mos1Params; x: Mos3Extra } {
  const g = (k: string, d: number) => model.params.get(k) ?? d;
  const has = (k: string) => model.params.has(k);
  const type = model.type === "PMOS" ? -1 : 1;
  const tnom = g("tnom", 27) + 273.15;
  const vtnom = tnom * K_OVER_Q;
  const egfet1 = 1.16 - (7.02e-4 * tnom * tnom) / (tnom + 1108);
  // level 3 always has an oxide (TOX = 0.1 µm by default)
  const tox = g("tox", 1e-7);
  const coxFactor = (3.9 * 8.854214871e-12) / tox;
  const params = copyParams(model.params);
  params.set("tox", tox);
  // NSUB: phi, gamma and the threshold as mos3temp works them out (with the intrinsic density at TNOM)
  const nsub = g("nsub", 0);
  let alpha = 0;
  if (has("nsub")) {
    const nifact = (tnom / 300) * Math.sqrt(tnom / 300) * Math.exp((0.5 * egfet1 * (1 / 300 - 1 / tnom)) / K_OVER_Q);
    const ni = 1.45e16 * nifact;
    if (nsub * 1e6 > ni) {
      let phi = g("phi", 0.6);
      if (!has("phi")) phi = Math.max(0.1, 2 * vtnom * Math.log((nsub * 1e6) / ni));
      params.set("phi", phi);
      const fermis = type * 0.5 * phi;
      const tpg = g("tpg", 1);
      let wkfng = 3.2;
      if (tpg !== 0) wkfng = 3.25 + 0.5 * egfet1 - type * tpg * 0.5 * egfet1;
      const wkfngs = wkfng - (3.25 + 0.5 * egfet1 + fermis);
      const gamma = has("gamma") ? g("gamma", 0) : Math.sqrt(2 * EPSSIL * CHARGE * nsub * 1e6) / coxFactor;
      params.set("gamma", gamma);
      if (!has("vto") && !has("vt0")) params.set("vto", wkfngs - (g("nss", 0) * 1e4 * CHARGE) / coxFactor + type * (gamma * Math.sqrt(phi) + phi));
      alpha = (EPSSIL + EPSSIL) / (CHARGE * nsub * 1e6);
    }
    // (level 1 must not redo it with its own intrinsic density)
    params.delete("nsub");
  }
  const latDiff = g("ld", 0);
  const weff = inst.w - 2 * g("wd", 0) + g("xw", 0);
  // level 1 takes L − 2·LD as the effective length: hand it L + XL
  const p = mos1Params({ ...model, params }, { ...inst, l: inst.l + g("xl", 0), w: weff }, temp);
  const leff = inst.l - 2 * latDiff + g("xl", 0);
  // DELVTO shifts the threshold
  const delvt0 = g("delvto", g("delvt0", 0));
  p.vbi += delvt0;
  p.vto += delvt0;
  const ratio = temp / tnom;
  return {
    p,
    x: {
      leff, weff, coxFactor, latDiff,
      eta: g("eta", 0), theta: g("theta", 0), kappa: g("kappa", 0.2),
      narrowFactor: (g("delta", 0) * 0.5 * Math.PI * EPSSIL) / coxFactor,
      nfs: g("nfs", 0), xj: g("xj", 0), vmax: g("vmax", 0),
      alpha, coeffDepLayWidth: Math.sqrt(alpha),
      surfMob: g("uo", g("u0", 600)) / (ratio * Math.sqrt(ratio)),
    },
  };
}

const COEFF0 = 0.0631353, COEFF1 = 0.8013292, COEFF2 = -0.01110777;

/** A level 3 MOSFET: level 1's device with mos3load's drain current. */
export class Mos3Device extends Mos1Device {
  constructor(host: DeviceHost, p: Mos1Params, readonly x: Mos3Extra, d: number, g: number, s: number, b: number, dp: number, sp: number) {
    super(host, p, d, g, s, b, dp, sp);
  }

  /** mos3load.c's drain current and derivatives (normalized voltages; sets mode, von, vdsat, gm, gds, gmbs). */
  protected override channel(vgs: number, vds: number, vbs: number): number {
    const p = this.p, x = this.x, vt = p.vt;
    const vbd = vbs - vds, vgd = vgs - vds;
    const mode = vds >= 0 ? 1 : -1;
    this.mode = mode;
    const vbx = mode === 1 ? vbs : vbd, vgx = mode === 1 ? vgs : vgd, mvds = mode * vds;
    const L = x.leff, W = x.weff;
    let beta = p.beta;
    let vdsat = 0, von: number, cdrain = 0, gm = 0, gds = 0, gmbs = 0;
    const oneoverxl = 1 / L;
    const eta = (x.eta * 8.15e-22) / (x.coxFactor * L * L * L);
    // square root term
    let phibs: number, sqphbs: number, dsqdvb: number;
    if (vbx <= 0) {
      phibs = p.phi - vbx;
      sqphbs = Math.sqrt(phibs);
      dsqdvb = -0.5 / sqphbs;
    } else {
      const sqphis = Math.sqrt(p.phi), sqphs3 = p.phi * sqphis;
      sqphbs = sqphis / (1 + vbx / (p.phi + p.phi));
      phibs = sqphbs * sqphbs;
      dsqdvb = -phibs / (sqphs3 + sqphs3);
    }
    // short-channel effect factor
    let fshort = 1, dfsdvb = 0;
    if (x.xj !== 0 && x.coeffDepLayWidth !== 0) {
      const wps = x.coeffDepLayWidth * sqphbs, oneoverxj = 1 / x.xj, xjonxl = x.xj * oneoverxl;
      const djonxj = x.latDiff * oneoverxj, wponxj = wps * oneoverxj;
      const wconxj = COEFF0 + COEFF1 * wponxj + COEFF2 * wponxj * wponxj;
      const arga = wconxj + djonxj, argc = wponxj / (1 + wponxj), argb = Math.sqrt(1 - argc * argc);
      fshort = 1 - xjonxl * (arga * argb - djonxj);
      const dwpdvb = x.coeffDepLayWidth * dsqdvb;
      const dadvb = (COEFF1 + COEFF2 * (wponxj + wponxj)) * dwpdvb * oneoverxj;
      const dbdvb = (-argc * argc * (1 - argc) * dwpdvb) / (argb * wps);
      dfsdvb = -xjonxl * (dadvb * argb + arga * dbdvb);
    }
    // body effect
    const gammas = p.gamma * fshort;
    const fbodys = (0.5 * gammas) / (sqphbs + sqphbs);
    const fbody = fbodys + x.narrowFactor / W;
    const onfbdy = 1 / (1 + fbody);
    const dfbdvb = (-fbodys * dsqdvb) / sqphbs + (fbodys * dfsdvb) / fshort;
    const qbonco = gammas * sqphbs + (x.narrowFactor * phibs) / W;
    const dqbdvb = gammas * dsqdvb + p.gamma * dfsdvb * sqphbs - x.narrowFactor / W;
    // static feedback, threshold
    const vbix = p.vbi * p.type - eta * mvds;
    const vth = vbix + qbonco;
    const dvtdvd = -eta, dvtdvb = dqbdvb;
    // weak and strong inversion
    von = vth;
    let xn = 0, dxndvb = 0, dvodvd = 0, dvodvb = 0;
    done: {
      if (x.nfs !== 0) {
        const csonco = (CHARGE * x.nfs * 1e4) / x.coxFactor;
        const cdonco = qbonco / (phibs + phibs);
        xn = 1 + csonco + cdonco;
        von = vth + vt * xn;
        dxndvb = dqbdvb / (phibs + phibs) - (qbonco * dsqdvb) / (phibs * sqphbs);
        dvodvd = dvtdvd;
        dvodvb = dvtdvb + vt * dxndvb;
      } else if (vgx <= von) {
        // cutoff
        break done;
      }
      // the device is on
      const vgsx = Math.max(vgx, von);
      // mobility modulation by gate voltage
      const onfg = 1 + x.theta * (vgsx - vth);
      const fgate = 1 / onfg;
      const us = x.surfMob * 1e-4 * fgate;
      const dfgdvg = -x.theta * fgate * fgate;
      const dfgdvd = -dfgdvg * dvtdvd, dfgdvb = -dfgdvg * dvtdvb;
      // saturation voltage
      vdsat = (vgsx - vth) * onfbdy;
      let dvsdvg: number, dvsdvd: number, dvsdvb: number, onvdsc = 0;
      if (x.vmax <= 0) {
        dvsdvg = onfbdy;
        dvsdvd = -dvsdvg * dvtdvd;
        dvsdvb = -dvsdvg * dvtdvb - vdsat * dfbdvb * onfbdy;
      } else {
        const vdsc = (L * x.vmax) / us;
        onvdsc = 1 / vdsc;
        const arga = (vgsx - vth) * onfbdy, argb = Math.sqrt(arga * arga + vdsc * vdsc);
        vdsat = arga + vdsc - argb;
        const dvsdga = (1 - arga / argb) * onfbdy;
        dvsdvg = dvsdga - (1 - vdsc / argb) * vdsc * dfgdvg * onfg;
        dvsdvd = -dvsdvg * dvtdvd;
        dvsdvb = -dvsdvg * dvtdvb - arga * dvsdga * dfbdvb;
      }
      // current factors in the linear region
      const vdsx = Math.min(mvds, vdsat);
      if (vdsx === 0) {
        // vds = 0
        beta *= fgate;
        cdrain = 0;
        gm = 0;
        gds = beta * (vgsx - vth);
        gmbs = 0;
        if (x.nfs !== 0 && vgx < von) gds *= Math.exp((vgx - von) / (vt * xn));
        break done;
      }
      const cdo = vgsx - vth - 0.5 * (1 + fbody) * vdsx;
      const dcodvb = -dvtdvb - 0.5 * dfbdvb * vdsx;
      const cdnorm = cdo * vdsx;
      gm = vdsx;
      gds = mvds > vdsat ? -dvtdvd * vdsx : vgsx - vth - (1 + fbody + dvtdvd) * vdsx;
      gmbs = dcodvb * vdsx;
      // without velocity saturation
      const cd1 = beta * cdnorm;
      beta *= fgate;
      cdrain = beta * cdnorm;
      gm = beta * gm + dfgdvg * cd1;
      gds = beta * gds + dfgdvd * cd1;
      gmbs = beta * gmbs + dfgdvb * cd1;
      // velocity saturation factor
      let fdrain = 0, dfddvg = 0, dfddvd = 0, dfddvb = 0;
      if (x.vmax > 0) {
        fdrain = 1 / (1 + vdsx * onvdsc);
        const fd2 = fdrain * fdrain;
        const arga = fd2 * vdsx * onvdsc * onfg;
        dfddvg = -dfgdvg * arga;
        dfddvd = mvds > vdsat ? -dfgdvd * arga : -dfgdvd * arga - fd2 * onvdsc;
        dfddvb = -dfgdvb * arga;
        gm = fdrain * gm + dfddvg * cdrain;
        gds = fdrain * gds + dfddvd * cdrain;
        gmbs = fdrain * gmbs + dfddvb * cdrain;
        cdrain *= fdrain;
        beta *= fdrain;
      }
      // channel-length modulation
      let gds0 = 0;
      clm: {
        let delxl: number, dldvd: number, ddldvg: number, ddldvd: number, ddldvb: number;
        if (mvds <= vdsat) {
          if (x.vmax > 0 || x.alpha === 0) break clm;
          let arga = mvds / vdsat;
          delxl = Math.sqrt((x.kappa * x.alpha * vdsat) / 8);
          dldvd = (4 * delxl * arga * arga * arga) / vdsat;
          arga *= arga;
          arga *= arga;
          delxl *= arga;
          ddldvg = 0;
          ddldvd = -dldvd;
          ddldvb = 0;
        } else if (x.vmax <= 0) {
          delxl = Math.sqrt(x.kappa * x.alpha * (mvds - vdsat + vdsat / 8));
          dldvd = (0.5 * delxl) / (mvds - vdsat + vdsat / 8);
          ddldvg = 0;
          ddldvd = -dldvd;
          ddldvb = 0;
        } else {
          if (x.alpha === 0) break clm;
          const cdsat = cdrain;
          const gdsat = Math.max(1e-12, cdsat * (1 - fdrain) * onvdsc);
          const gdoncd = gdsat / cdsat, gdonfd = gdsat / (1 - fdrain), gdonfg = gdsat * onfg;
          const dgdvg = gdoncd * gm - gdonfd * dfddvg + gdonfg * dfgdvg;
          const dgdvd = gdoncd * gds - gdonfd * dfddvd + gdonfg * dfgdvd;
          const dgdvb = gdoncd * gmbs - gdonfd * dfddvb + gdonfg * dfgdvb;
          const emax = (x.kappa * cdsat * oneoverxl) / gdsat;
          const emoncd = emax / cdsat, emongd = emax / gdsat;
          const demdvg = emoncd * gm - emongd * dgdvg;
          const demdvd = emoncd * gds - emongd * dgdvd;
          const demdvb = emoncd * gmbs - emongd * dgdvb;
          const arga = 0.5 * emax * x.alpha, argc = x.kappa * x.alpha;
          const argb = Math.sqrt(arga * arga + argc * (mvds - vdsat));
          delxl = argb - arga;
          let dldem = 0;
          dldvd = 0;
          if (argb !== 0) {
            dldvd = argc / (argb + argb);
            dldem = 0.5 * (arga / argb - 1) * x.alpha;
          }
          ddldvg = dldem * demdvg;
          ddldvd = dldem * demdvd - dldvd;
          ddldvb = dldem * demdvb;
        }
        // punch-through approximation
        if (delxl > 0.5 * L) {
          delxl = L - (L * L) / (4 * delxl);
          const arga = (4 * (L - delxl) * (L - delxl)) / (L * L);
          ddldvg *= arga;
          ddldvd *= arga;
          ddldvb *= arga;
          dldvd *= arga;
        }
        // saturation region
        const dlonxl = delxl * oneoverxl;
        const xlfact = 1 / (1 - dlonxl);
        cdrain *= xlfact;
        const diddl = cdrain / (L - delxl);
        gm = gm * xlfact + diddl * ddldvg;
        gmbs = gmbs * xlfact + diddl * ddldvb;
        gds0 = diddl * ddldvd;
        gm += gds0 * dvsdvg;
        gmbs += gds0 * dvsdvb;
        gds = gds * xlfact + diddl * dldvd + gds0 * dvsdvd;
      }
      // weak inversion
      if (vgx < von) {
        const onxn = 1 / xn, ondvt = onxn / vt;
        const wfact = Math.exp((vgx - von) * ondvt);
        cdrain *= wfact;
        const gms = gm * wfact, gmw = cdrain * ondvt;
        gm = gmw;
        if (mvds > vdsat) gm += gds0 * dvsdvg * wfact;
        gds = gds * wfact + (gms - gmw) * dvodvd;
        gmbs = gmbs * wfact + (gms - gmw) * dvodvb - gmw * (vgx - von) * onxn * dxndvb;
      }
    }
    this.von = von;
    this.vdsat = vdsat;
    this.gm = gm;
    this.gds = gds;
    this.gmbs = gmbs;
    return cdrain;
  }
}
