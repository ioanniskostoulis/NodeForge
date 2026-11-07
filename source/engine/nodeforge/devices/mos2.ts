// The SPICE level 2 MOSFET (ngspice's mos2load.c / mos2temp.c): the analytical Grove-Frohman
// model — bulk charge in the drain current, short-channel (XJ) and narrow-width (DELTA) threshold,
// mobility degradation by the vertical field (UCRIT, UEXP), Baum's velocity saturation (VMAX, NEFF;
// the saturation voltage from a quartic), channel-length modulation (LAMBDA, or from NSUB), weak
// inversion (NFS) — on level 1's junctions, Meyer capacitances, limiting and stamps (Mos1Device).
// Copyright 1985 - 2018, Regents of the University of California and others, ngspice (https://ngspice.sourceforge.io), Modified BSD licence (assets/licenses/ngspice-modified-bsd.txt).
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { copyParams, type SpiceModel } from "../spice/parse";
import { CHARGE, type DeviceHost, T_DEFAULT } from "./device";
import { Mos1Device, type Mos1Instance, type Mos1Params, mos1Params } from "./mos1";

const EPSSIL = 11.7 * 8.854214871e-12;
const SIG1 = [1, -1, 1, -1], SIG2 = [1, 1, -1, -1];

/** What level 2 adds to level 1's parameters. */
export interface Mos2Extra {
  leff: number;
  /** Drawn width (level 2 has no WD). */
  w: number;
  /** Oxide capacitance per area (F/m²). */
  coxFactor: number;
  /** DELTA, XD (from NSUB; 0 without), XJ, NFS, VMAX, NEFF, UCRIT, UEXP. */
  narrowFactor: number;
  xd: number;
  nsub: number;
  xj: number;
  nfs: number;
  vmax: number;
  neff: number;
  ucrit: number;
  uexp: number;
  /** UO (cm²/Vs; level 2 uses it unscaled by temperature), bulk junction potential. */
  uo: number;
  pb: number;
}

/** Level 2 parameters from a `.model … NMOS/PMOS (LEVEL=2)` card for one instance, at `temp`. */
export function mos2Params(model: SpiceModel, inst: Mos1Instance, temp = T_DEFAULT): { p: Mos1Params; x: Mos2Extra } {
  const g = (k: string, d: number) => model.params.get(k) ?? d;
  // level 2 always has an oxide (TOX = 0.1 µm by default); NSUB, PHI, GAMMA, VTO as level 1 works them out
  const tox = g("tox", 1e-7);
  const params = copyParams(model.params);
  params.set("tox", tox);
  const p = mos1Params({ ...model, params }, inst, temp);
  const coxFactor = (3.9 * 8.854214871e-12) / tox;
  const nsub = g("nsub", 0);
  return {
    p,
    x: {
      leff: inst.l - 2 * g("ld", 0),
      w: inst.w,
      coxFactor,
      narrowFactor: g("delta", 0),
      xd: nsub * 1e6 > 1.45e16 ? Math.sqrt((EPSSIL + EPSSIL) / (CHARGE * nsub * 1e6)) : 0,
      nsub: nsub * 1e6 > 1.45e16 ? nsub : 0,
      xj: g("xj", 0), nfs: g("nfs", 0), vmax: g("vmax", 0), neff: g("neff", 1),
      ucrit: g("ucrit", 1e4), uexp: g("uexp", 0),
      uo: g("uo", g("u0", 600)),
      pb: p.pb,
    },
  };
}

/** A level 2 MOSFET: level 1's device with mos2load's drain current. */
export class Mos2Device extends Mos1Device {
  constructor(host: DeviceHost, p: Mos1Params, readonly x: Mos2Extra, d: number, g: number, s: number, b: number, dp: number, sp: number) {
    super(host, p, d, g, s, b, dp, sp);
  }

  /** mos2load.c's drain current and derivatives (normalized voltages; sets mode, von, vdsat, gm, gds, gmbs). */
  protected override channel(vgs: number, vds: number, vbs: number): number {
    const p = this.p, x = this.x, vt = p.vt;
    const vbd = vbs - vds, vgd = vgs - vds;
    const mode = vds >= 0 ? 1 : -1;
    this.mode = mode;
    const lvbs = mode === 1 ? vbs : vbd, lvds = mode * vds, lvgs = mode === 1 ? vgs : vgd;
    const phi = p.phi, phiMinVbs = phi - lvbs, L = x.leff;
    let xlamda = p.lambda;
    let cdrain = 0, gm = this.gm, gds = this.gds, gmbs = this.gmbs;
    let vdsat = 0;
    let von: number;
    // useful quantities
    let sarg1: number, dsrgdb: number, d2sdb2: number;
    if (lvbs <= 0) {
      sarg1 = Math.sqrt(phiMinVbs);
      dsrgdb = -0.5 / sarg1;
      d2sdb2 = (0.5 * dsrgdb) / phiMinVbs;
    } else {
      const sphi = Math.sqrt(phi), sphi3 = phi * sphi;
      sarg1 = sphi / (1 + (0.5 * lvbs) / phi);
      const tmp = sarg1 / sphi3;
      dsrgdb = -0.5 * sarg1 * tmp;
      d2sdb2 = -dsrgdb * tmp;
    }
    let barg: number, dbrgdb: number, d2bdb2: number;
    if (lvbs - lvds <= 0) {
      barg = Math.sqrt(phiMinVbs + lvds);
      dbrgdb = -0.5 / barg;
      d2bdb2 = (0.5 * dbrgdb) / (phiMinVbs + lvds);
    } else {
      const sphi = Math.sqrt(phi), sphi3 = phi * sphi;
      barg = sphi / (1 + (0.5 * (lvbs - lvds)) / phi);
      const tmp = barg / sphi3;
      dbrgdb = -0.5 * barg * tmp;
      d2bdb2 = -dbrgdb * tmp;
    }
    // threshold (von), with the narrow-channel effect
    // (ngspice: 0.125·DELTA·2π·εSi / (Cox·L·W) · L)
    const factor = (0.125 * x.narrowFactor * 2 * Math.PI * EPSSIL) / (x.coxFactor * x.w);
    const eta = 1 + factor;
    const vbin = p.vbi * p.type + factor * phiMinVbs;
    let gamasd: number, dgddvb: number, dgdvds: number, dgddb2: number;
    if (p.gamma > 0 || x.nsub > 0) {
      const xwd = x.xd * barg, xws = x.xd * sarg1;
      let argss = 0, argsd = 0, dbargs = 0, dbargd = 0, args = 0, argd = 0, argxs = 0, argxd = 0;
      dgdvds = 0;
      dgddb2 = 0;
      if (x.xj > 0) {
        const tmp = 2 / x.xj;
        argxs = 1 + xws * tmp;
        argxd = 1 + xwd * tmp;
        args = Math.sqrt(argxs);
        argd = Math.sqrt(argxd);
        const t2 = (0.5 * x.xj) / L;
        argss = t2 * (args - 1);
        argsd = t2 * (argd - 1);
      }
      gamasd = p.gamma * (1 - argss - argsd);
      const dbxwd = x.xd * dbrgdb, dbxws = x.xd * dsrgdb;
      if (x.xj > 0) {
        const tmp = 0.5 / L;
        dbargs = (tmp * dbxws) / args;
        dbargd = (tmp * dbxwd) / argd;
        const dasdb2 = (-x.xd * (d2sdb2 + (dsrgdb * dsrgdb * x.xd) / (x.xj * argxs))) / (L * args);
        const daddb2 = (-x.xd * (d2bdb2 + (dbrgdb * dbrgdb * x.xd) / (x.xj * argxd))) / (L * argd);
        dgddb2 = -0.5 * p.gamma * (dasdb2 + daddb2);
      }
      dgddvb = -p.gamma * (dbargs + dbargd);
      if (x.xj > 0) dgdvds = (-p.gamma * 0.5 * -dbxwd) / (L * argd);
    } else {
      gamasd = p.gamma;
      dgddvb = dgdvds = dgddb2 = 0;
    }
    von = vbin + gamasd * sarg1;
    const vth = von;
    let xn = 0, argg = 0;
    const nfs = x.nfs !== 0;
    out: {
      if (nfs) {
        const cfs = CHARGE * x.nfs * 1e4;
        const cdonco = -(gamasd * dsrgdb + dgddvb * sarg1) + factor;
        xn = 1 + cfs / x.coxFactor + cdonco;
        const tmp = vt * xn;
        von += tmp;
        argg = 1 / tmp;
      } else if (lvgs <= vbin) {
        // cutoff
        gds = 0;
        cdrain = gm = gmbs = 0;
        break out;
      }
      const vgst = lvgs - von;
      // more useful quantities
      const sarg3 = sarg1 * sarg1 * sarg1;
      const sbiarg = Math.sqrt(x.pb);
      let gammad = gamasd;
      let dgdvbs = dgddvb;
      let body = barg * barg * barg - sarg3;
      let gdbdv = 2 * gammad * (barg * barg * dbrgdb - sarg1 * sarg1 * dsrgdb);
      let dodvbs = -factor + dgdvbs * sarg1 + gammad * dsrgdb;
      let dodvds = 0, dxndvd = 0, dxndvb = 0;
      if (nfs) {
        dxndvb = 2 * dgdvbs * dsrgdb + gammad * d2sdb2 + dgddb2 * sarg1;
        dodvbs += vt * dxndvb;
        dxndvd = dgdvds * dsrgdb;
        dodvds = dgdvds * sarg1 + vt * dxndvd;
      }
      // effective mobility
      let ufact = 1, ueff = x.uo * 1e-4, dudvgs = 0, dudvbs = 0;
      const dudvds = 0;
      const ucritV = (x.ucrit * 100 * EPSSIL) / x.coxFactor;
      if (vgst > ucritV) {
        ufact = Math.exp(x.uexp * Math.log(ucritV / vgst));
        ueff = x.uo * 1e-4 * ufact;
        dudvgs = (-ufact * x.uexp) / vgst;
        dudvbs = (x.uexp * ufact * dodvbs) / vgst;
      }
      // saturation voltage (Grove-Frohman)
      let vgsx = lvgs;
      gammad = gamasd / eta;
      dgdvbs = dgddvb;
      if (nfs) vgsx = Math.max(lvgs, von);
      let dsdvgs: number, dsdvbs: number;
      if (gammad > 0) {
        const gammd2 = gammad * gammad;
        const argv = (vgsx - vbin) / eta + phiMinVbs;
        if (argv <= 0) {
          vdsat = 0;
          dsdvgs = dsdvbs = 0;
        } else {
          const arg1 = Math.sqrt(1 + (4 * argv) / gammd2);
          vdsat = Math.max(0, (vgsx - vbin) / eta + (gammd2 * (1 - arg1)) / 2);
          dsdvgs = (1 - 1 / arg1) / eta;
          dsdvbs = ((gammad * (1 - arg1) + (2 * argv) / (gammad * arg1)) / eta) * dgdvbs + 1 / arg1 + factor * dsdvgs;
        }
      } else {
        vdsat = Math.max(0, (vgsx - vbin) / eta);
        dsdvgs = 1;
        dsdvbs = 0;
      }
      if (x.vmax > 0) {
        // Baum's scattering-limited velocity saturation: the smallest positive root of a quartic
        const v1 = (vgsx - vbin) / eta + phiMinVbs, v2 = phiMinVbs;
        const xv = (x.vmax * L) / ueff;
        const a1 = gammad / 0.75, b1 = -2 * (v1 + xv), c1 = -2 * gammad * xv;
        const d1 = 2 * v1 * (v2 + xv) - v2 * v2 - (4 / 3) * gammad * sarg3;
        const a = -b1, b = a1 * c1 - 4 * d1, c = -d1 * (a1 * a1 - 4 * b1) - c1 * c1;
        const r = (-a * a) / 3 + b, s = (2 * a * a * a) / 27 - (a * b) / 3 + c;
        const r3 = r * r * r, s2 = s * s;
        const pp = s2 / 4 + r3 / 27, p0 = Math.abs(pp), p2 = Math.sqrt(p0);
        let y3: number;
        if (pp < 0) {
          const ro = Math.exp(Math.log(Math.sqrt(s2 / 4 + p0)) / 3);
          const fi = Math.atan((-2 * p2) / s);
          y3 = 2 * ro * Math.cos(fi / 3) - a / 3;
        } else {
          const p3 = Math.exp(Math.log(Math.abs(-s / 2 + p2)) / 3);
          const p4 = Math.exp(Math.log(Math.abs(-s / 2 - p2)) / 3);
          y3 = p3 + p4 - a / 3;
        }
        const a3 = Math.sqrt((a1 * a1) / 4 - b1 + y3), b3 = Math.sqrt((y3 * y3) / 4 - d1);
        const x4: number[] = [];
        for (let i = 0; i < 4; i++) {
          const a4 = a1 / 2 + SIG1[i] * a3, b4 = y3 / 2 + SIG2[i] * b3;
          const delta4 = (a4 * a4) / 4 - b4;
          if (delta4 < 0) continue;
          const t = Math.sqrt(delta4);
          x4.push(-a4 / 2 + t, -a4 / 2 - t);
        }
        let jknt = 0, xvalid = 0;
        for (const xr of x4) {
          if (xr <= 0) continue;
          const poly = xr * xr * xr * xr + a1 * xr * xr * xr + b1 * xr * xr + c1 * xr + d1;
          if (Math.abs(poly) > 1e-6) continue;
          jknt++;
          if (jknt <= 1) xvalid = xr;
          if (xr > xvalid) continue;
          xvalid = xr;
        }
        if (jknt > 0) vdsat = xvalid * xvalid - phiMinVbs;
      }
      // effective channel length
      let dldvgs = 0, dldvds = 0, dldvbs = 0, bsarg = 0, dbsrdb = 0, bodys = 0, gdbdvs = 0;
      if (lvds !== 0) {
        gammad = gamasd;
        if (lvbs - vdsat <= 0) {
          bsarg = Math.sqrt(vdsat + phiMinVbs);
          dbsrdb = -0.5 / bsarg;
        } else {
          const sphi = Math.sqrt(phi), sphi3 = phi * sphi;
          bsarg = sphi / (1 + (0.5 * (lvbs - vdsat)) / phi);
          dbsrdb = (-0.5 * bsarg * bsarg) / sphi3;
        }
        bodys = bsarg * bsarg * bsarg - sarg3;
        gdbdvs = 2 * gammad * (bsarg * bsarg * dbsrdb - sarg1 * sarg1 * dsrgdb);
        let dldsat = 0, clm = false;
        if (x.vmax <= 0) {
          if (x.nsub !== 0 && !(xlamda > 0)) {
            const argv = (lvds - vdsat) / 4, sargv = Math.sqrt(1 + argv * argv);
            const arg1 = Math.sqrt(argv + sargv);
            const xlfact = x.xd / (L * lvds);
            xlamda = xlfact * arg1;
            dldsat = (lvds * xlamda) / (8 * sargv);
            clm = true;
          }
        } else {
          const argv0 = (vgsx - vbin) / eta - vdsat;
          const xdv = x.xd / Math.sqrt(x.neff);
          const xlv = (x.vmax * xdv) / (2 * ueff);
          const vqchan = argv0 - gammad * bsarg;
          const dqdsat = -1 + gammad * dbsrdb;
          const vl = x.vmax * L;
          const dfunds = vl * dqdsat - ueff * vqchan;
          const dfundg = (vl - ueff * vdsat) / eta;
          const dfundb = -vl * (1 + dqdsat - factor / eta) + (ueff * (gdbdvs - (dgdvbs * bodys) / 1.5)) / eta;
          dsdvgs = -dfundg / dfunds;
          dsdvbs = -dfundb / dfunds;
          if (x.nsub !== 0 && !(xlamda > 0)) {
            const argv = Math.max(lvds - vdsat, 0);
            const xls = Math.sqrt(xlv * xlv + argv);
            dldsat = xdv / (2 * xls);
            const xlfact = xdv / (L * lvds);
            xlamda = xlfact * (xls - xlv);
            dldsat /= L;
            clm = true;
          }
        }
        if (clm) {
          dldvgs = dldsat * dsdvgs;
          dldvds = -xlamda + dldsat;
          dldvbs = dldsat * dsdvbs;
        }
      }
      // channel shortening limited at punch-through
      let xwb = x.xd * sbiarg;
      const xld = L - xwb;
      let clfact = 1 - xlamda * lvds;
      dldvds = -xlamda - dldvds;
      let xleff = L * clfact;
      const deltal = xlamda * lvds * L;
      if (x.nsub === 0) xwb = 0.25e-6;
      if (xleff < xwb) {
        xleff = xwb / (1 + (deltal - xld) / xwb);
        clfact = xleff / L;
        const dfact = (xleff * xleff) / (xwb * xwb);
        dldvgs *= dfact;
        dldvds *= dfact;
        dldvbs *= dfact;
      }
      // effective beta
      const beta1 = (p.beta * ufact) / clfact;
      gammad = gamasd;
      dgdvbs = dgddvb;
      if (lvds <= 1e-10) {
        if (lvgs <= von) gds = nfs ? beta1 * (von - vbin - gammad * sarg1) * Math.exp(argg * (lvgs - von)) : 0;
        else gds = beta1 * (lvgs - vbin - gammad * sarg1);
        cdrain = gm = gmbs = 0;
        break out;
      }
      if (nfs ? lvgs <= von : lvgs <= vbin) {
        // subthreshold
        if (vdsat <= 0) {
          gds = 0;
          if (lvgs > vth) break out;
          cdrain = gm = gmbs = 0;
          break out;
        }
        const vdson = Math.min(vdsat, lvds);
        if (lvds > vdsat) {
          barg = bsarg;
          dbrgdb = dbsrdb;
          body = bodys;
          gdbdv = gdbdvs;
        }
        const cdson = beta1 * ((von - vbin - eta * vdson * 0.5) * vdson - (gammad * body) / 1.5);
        const didvds = beta1 * (von - vbin - eta * vdson - gammad * barg);
        let gdson = (-cdson * dldvds) / clfact - (beta1 * dgdvds * body) / 1.5;
        if (lvds < vdsat) gdson += didvds;
        let gbson = (-cdson * dldvbs) / clfact + beta1 * (dodvbs * vdson + factor * vdson - (dgdvbs * body) / 1.5 - gdbdv);
        if (lvds > vdsat) gbson += didvds * dsdvbs;
        const expg = Math.exp(argg * (lvgs - von));
        cdrain = cdson * expg;
        const gmw = cdrain * argg;
        gm = gmw;
        if (lvds > vdsat) gm = gmw + didvds * dsdvgs * expg;
        const tmp = (gmw * (lvgs - von)) / xn;
        gds = gdson * expg - gm * dodvds - tmp * dxndvd;
        gmbs = gbson * expg - gm * dodvbs - tmp * dxndvb;
        break out;
      }
      if (lvds <= vdsat) {
        // linear region
        cdrain = beta1 * ((lvgs - vbin - (eta * lvds) / 2) * lvds - (gammad * body) / 1.5);
        gm = cdrain * (dudvgs / ufact - dldvgs / clfact) + beta1 * lvds;
        gds = cdrain * (dudvds / ufact - dldvds / clfact) + beta1 * (lvgs - vbin - eta * lvds - gammad * barg - (dgdvds * body) / 1.5);
        gmbs = cdrain * (dudvbs / ufact - dldvbs / clfact) - beta1 * (gdbdv + (dgdvbs * body) / 1.5 - factor * lvds);
      } else {
        // saturation
        cdrain = beta1 * ((lvgs - vbin - (eta * vdsat) / 2) * vdsat - (gammad * bodys) / 1.5);
        gm = cdrain * (dudvgs / ufact - dldvgs / clfact) + beta1 * vdsat + beta1 * (lvgs - vbin - eta * vdsat - gammad * bsarg) * dsdvgs;
        gds = (-cdrain * dldvds) / clfact - (beta1 * dgdvds * bodys) / 1.5;
        gmbs = cdrain * (dudvbs / ufact - dldvbs / clfact) - beta1 * (gdbdvs + (dgdvbs * bodys) / 1.5 - factor * vdsat) + beta1 * (lvgs - vbin - eta * vdsat - gammad * bsarg) * dsdvbs;
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
