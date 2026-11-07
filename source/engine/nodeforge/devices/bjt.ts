// The SPICE bipolar transistor (ngspice's Gummel-Poon model: bjtload.c, bjttemp.c, bjtsetup.c):
// transport saturation current with forward / reverse emission coefficients and betas, base-emitter
// and base-collector leakage (ISE / NE, ISC / NC), Early voltages and high-injection knees through
// the base charge qb (NKF), base resistance falling with current (RB, RBM, IRB), collector and
// emitter resistances, depletion charges (CJE, CJC split by XCJC, CJS), diffusion charges with
// TF's bias dependence (XTF, VTF, ITF) and TR, excess phase (PTF), and the substrate junction.
// Copyright 1985 - 2018, Regents of the University of California and others, ngspice (https://ngspice.sourceforge.io), Modified BSD licence (assets/licenses/ngspice-modified-bsd.txt).
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { SpiceModel } from "../spice/parse";
import { addInto, BOLTZMANN, CHARGE, CHARGE_TOL, Charge, Device, type DeviceHost, GMIN, K_OVER_Q, pnjlim, T_DEFAULT, T_NOMINAL } from "./device";

/** Gummel-Poon parameters at the device temperature, scaled by the instance's area. */
export interface BjtParams {
  /** 1 for NPN, −1 for PNP. */
  type: number;
  /** 1: vertical (substrate junction at the collector), −1: lateral (at the base). */
  subs: number;
  is: number;
  /** The base-emitter and base-collector saturation currents (IS, or IBE / IBC when both are given). */
  isBE: number;
  isBC: number;
  bf: number;
  br: number;
  nf: number;
  nr: number;
  ise: number;
  ne: number;
  isc: number;
  nc: number;
  /** Inverse Early voltages and knee currents (0: none). */
  invVaf: number;
  invVar: number;
  invIkf: number;
  invIkr: number;
  nkf: number;
  /** Base resistance at zero bias and its minimum (Ω), the current where it's halfway (0: none). */
  rb: number;
  rbm: number;
  irb: number;
  /** Collector and emitter conductances (0: no resistance). */
  gc: number;
  ge: number;
  // depletion charges
  cje: number;
  vje: number;
  mje: number;
  cjc: number;
  vjc: number;
  mjc: number;
  xcjc: number;
  cjs: number;
  vjs: number;
  mjs: number;
  fc: number;
  /** fc·vje and the linear extension's coefficients (BE: f1–f3, BC: f4–f7, as ngspice). */
  depCap: number;
  f1: number;
  f2: number;
  f3: number;
  f4: number;
  f5: number;
  f6: number;
  f7: number;
  // transit times
  tf: number;
  xtf: number;
  /** 1 / (1.44·VTF) (0: VTF infinite). */
  ovtf: number;
  itf: number;
  tr: number;
  /** Excess phase as a time constant: PTF (radians) × TF (0: none). */
  td: number;
  /** Substrate saturation current and emission coefficient. */
  iss: number;
  ns: number;
  vt: number;
  vcrit: number;
  /** Limiting the substrate junction: its own Vcrit with ISS, else 50 V (as ngspice). */
  subVcrit: number;
  /**
   * Kull's quasi-saturation (RCO given; 0: none): the epi layer's resistance RCO, drift saturation
   * voltage VO, doping parameter GAMMA and charge QCO, at the temperature (QUASIMOD = 1) or as given.
   */
  rco: number;
  vo: number;
  gamma: number;
  qco: number;
  /** Parameters ngspice has that this model leaves out. */
  ignored: string[];
}

const egap = (t: number) => 1.16 - (7.02e-4 * t * t) / (t + 1108);

/**
 * Gummel-Poon parameters from a `.model … NPN/PNP` card at temperature `temp` (K), as ngspice's
 * BJTsetup and BJTtemp do for TLEV = TLEVC = 0 (with their linear and quadratic temperature
 * coefficients: TVAF1, TIKF1, TRB1, TNF1, TTF1, TMJE1… and TBF1 / TBR1 in place of XTB). `area` scales the currents, capacitances and
 * conductances (the resistances divide by it); the base-collector junction's take AREAB (vertical)
 * or AREAC (lateral), the substrate's the other, as ngspice (whose IS for the base-collector
 * junction, without IBC, carries both AREA and AREAB). RCO, VO, GAMMA, QCO don't scale with area.
 */
export function bjtParams(m: SpiceModel, temp = T_DEFAULT, area = 1, areab = area, areac = area): BjtParams {
  const g = (names: string[], d: number) => {
    for (const k of names) {
      const v = m.params.get(k);
      if (v !== undefined) return v;
    }
    return d;
  };
  const has = (k: string) => m.params.has(k);
  // a parameter with its temperature coefficients: p·(1 + t1·ΔT + t2·ΔT²)
  const dt = temp - (g(["tnom"], 27) + 273.15);
  const tc = (base: number, name: string) => base * (1 + g([`${name}1`], 0) * dt + g([`${name}2`], 0) * dt * dt);
  const type = m.type === "PNP" ? -1 : 1;
  const tnom = g(["tnom"], 27) + 273.15;
  const vt = temp * K_OVER_Q;
  const fact1 = tnom / T_NOMINAL, fact2 = temp / T_NOMINAL;
  const vtnom = tnom * K_OVER_Q;
  const arg1 = -egap(tnom) / (2 * BOLTZMANN * tnom) + 1.1150877 / (BOLTZMANN * 2 * T_NOMINAL);
  const pbfact1 = -2 * vtnom * (1.5 * Math.log(fact1) + CHARGE * arg1);
  const arg = -egap(temp) / (2 * BOLTZMANN * temp) + 1.1150877 / (BOLTZMANN * 2 * T_NOMINAL);
  const pbfact = -2 * vt * (1.5 * Math.log(fact2) + CHARGE * arg);
  // saturation currents and betas
  const is0 = g(["is"], 1e-16);
  const ratlog = Math.log(temp / tnom), ratio1 = temp / tnom - 1;
  const factlog = (ratio1 * g(["eg"], 1.11)) / vt + g(["xti"], 3) * ratlog;
  const factor = Math.exp(factlog);
  const bfactor = Math.exp(ratlog * g(["xtb"], 0));
  const ne0 = g(["ne"], 1.5), nc0 = g(["nc"], 2);
  // ISE / ISC can be given as multiples of IS (C2 / C4, old SPICE)
  const ise0 = has("ise") ? g(["ise"], 0) : has("c2") ? g(["c2"], 0) * is0 : 0;
  const isc0 = has("isc") ? g(["isc"], 0) : has("c4") ? g(["c4"], 0) * is0 : 0;
  // junction potentials and capacitances
  const junction = (pot: number, cap: number, mg: number) => {
    const pbo = (pot - pbfact1) / fact1;
    const gmaold = (pot - pbo) / pbo;
    let c = cap / (1 + mg * (4e-4 * (tnom - T_NOMINAL) - gmaold));
    const tpot = fact2 * pbo + pbfact;
    const gmanew = (tpot - pbo) / pbo;
    c *= 1 + mg * (4e-4 * (temp - T_NOMINAL) - gmanew);
    return { pot: tpot, cap: c };
  };
  // (gradings limited to 0.999, as ngspice)
  const mje = Math.min(0.999, tc(g(["mje", "me"], 0.33), "tmje")), mjc = Math.min(0.999, tc(g(["mjc", "mc"], 0.33), "tmjc"));
  const mjs = Math.min(0.999, tc(g(["mjs", "ms"], 0), "tmjs"));
  const be = junction(g(["vje", "pe"], 0.75), g(["cje"], 0), mje);
  const bc = junction(g(["vjc", "pc"], 0.75), g(["cjc"], 0), mjc);
  const sub = junction(g(["vjs", "ps"], 0.75), g(["cjs", "ccs", "csub"], 0), mjs);
  const fc = Math.min(g(["fc"], 0.5), 0.9999);
  const xfc = Math.log(1 - fc);
  const inv = (x: number) => (x !== 0 && Number.isFinite(x) ? 1 / x : 0);
  const rb = tc(g(["rb"], 0), "trb");
  const vtf = g(["vtf"], 0);
  const is = is0 * factor * area;
  // IBE and IBC (both given) replace IS for the junction currents (bjttemp.c)
  const both = has("ibe") && has("ibc");
  const nf = g(["nf"], 1), nr = g(["nr"], 1);
  // (ISS takes the last factor bjttemp works out: NR's when IBE and IBC are given)
  const iss = g(["iss"], 0) * (both ? Math.exp(factlog / nr) : factor);
  const ignored: string[] = [];
  if ((g(["tlev"], 0) !== 0) || (g(["tlevc"], 0) !== 0)) ignored.push("TLEV / TLEVC (simulated as 0)");
  // ngspice's default: vertical for NPN, lateral for PNP
  const subs = g(["subs"], 0) === 1 ? 1 : g(["subs"], 0) === -1 ? -1 : type;
  // the base-collector junction's area and the substrate's (bjttemp.c)
  const abc = subs > 0 ? areab : areac, asub = subs > 0 ? areac : areab;
  // quasi-saturation, with QUASIMOD = 1's temperature equations (CN, D, VG; XTI)
  const rco = g(["rco"], 0);
  let vo = g(["vo"], 10), gamma = g(["gamma"], 1e-11), rcoT = rco;
  if (rco > 0 && g(["quasimod"], 0) === 1) {
    const rT = temp / tnom;
    rcoT = rco * Math.pow(rT, g(["cn"], type > 0 ? 2.42 : 2.2));
    vo *= Math.pow(rT, g(["d"], type > 0 ? 0.87 : 0.52));
    gamma *= Math.pow(rT, g(["xti"], 3)) * Math.exp((-g(["vg"], 1.206) * (1 - rT)) / vt);
  }
  return {
    type,
    subs,
    is,
    isBE: both ? g(["ibe"], 0) * Math.exp(factlog / nf) * area : is,
    isBC: (both ? g(["ibc"], 0) * Math.exp(factlog / nr) : is) * abc,
    bf: has("tbf1") || has("tbf2") ? tc(g(["bf"], 100), "tbf") : g(["bf"], 100) * bfactor,
    br: has("tbr1") || has("tbr2") ? tc(g(["br"], 1), "tbr") : g(["br"], 1) * bfactor,
    nf: tc(nf, "tnf"),
    nr: tc(nr, "tnr"),
    ise: ((ise0 * Math.exp(factlog / ne0)) / bfactor) * area,
    ne: tc(ne0, "tne"),
    isc: ((isc0 * Math.exp(factlog / nc0)) / bfactor) * abc,
    nc: tc(nc0, "tnc"),
    invVaf: inv(tc(g(["vaf", "va"], 0), "tvaf")),
    invVar: inv(tc(g(["var", "vb"], 0), "tvar")),
    invIkf: inv(tc(g(["ikf", "ik"], 0), "tikf")) / area,
    invIkr: inv(tc(g(["ikr"], 0), "tikr")) / area,
    nkf: g(["nkf"], 0.5),
    rb: rb / area,
    rbm: (has("rbm") ? tc(g(["rbm"], 0), "trm") : tc(g(["rb"], 0), "trm")) / area,
    irb: tc(g(["irb", "jrb", "ioc"], 0), "tirb") * area,
    gc: inv(tc(g(["rc"], 0), "trc")) * area,
    ge: inv(tc(g(["re"], 0), "tre")) * area,
    cje: be.cap * area, vje: be.pot, mje,
    cjc: bc.cap * abc, vjc: bc.pot, mjc,
    xcjc: g(["xcjc", "cdis"], 1),
    cjs: sub.cap * asub, vjs: sub.pot, mjs,
    fc,
    depCap: fc * be.pot,
    f1: (be.pot * (1 - Math.exp((1 - mje) * xfc))) / (1 - mje),
    f2: Math.exp((1 + mje) * xfc),
    f3: 1 - fc * (1 + mje),
    f4: fc * bc.pot,
    f5: (bc.pot * (1 - Math.exp((1 - mjc) * xfc))) / (1 - mjc),
    f6: Math.exp((1 + mjc) * xfc),
    f7: 1 - fc * (1 + mjc),
    tf: tc(g(["tf"], 0), "ttf"),
    xtf: g(["xtf"], 0),
    ovtf: vtf !== 0 && Number.isFinite(vtf) ? 1 / (vtf * 1.44) : 0,
    itf: tc(g(["itf"], 0), "titf") * area,
    tr: tc(g(["tr"], 0), "ttr"),
    td: (g(["ptf"], 0) / (180 / Math.PI)) * g(["tf"], 0),
    // (ISS: AREAC / AREAB with IBE and IBC, else AREA)
    iss: iss * (both ? asub : area),
    ns: tc(g(["ns"], 1), "tns"),
    vt,
    vcrit: vt * Math.log(vt / (Math.SQRT2 * is)),
    subVcrit: has("iss") ? vt * Math.log(vt / (Math.SQRT2 * iss * (both ? asub : area))) : 50,
    rco: rcoT, vo, gamma, qco: g(["qco"], 0),
    ignored,
  };
}

/** A junction's exponential current and conductance, with ngspice's cubic tail in reverse. */
function junction(isat: number, v: number, vtn: number): { i: number; g: number } {
  if (isat === 0) return { i: 0, g: 0 };
  if (v >= -3 * vtn) {
    const e = Math.exp(v / vtn);
    return { i: isat * (e - 1), g: (isat * e) / vtn };
  }
  let arg = (3 * vtn) / (v * Math.E);
  arg = arg * arg * arg;
  return { i: -isat * (1 + arg), g: (isat * 3 * arg) / v };
}

/** Depletion charge and capacitance of a junction (cz at zero bias), linear above fc·pot. */
function depletion(v: number, cz: number, pot: number, mg: number, fcpot: number, f1: number, f2: number, f3: number): { q: number; c: number } {
  if (cz === 0) return { q: 0, c: 0 };
  if (v < fcpot) {
    const arg = 1 - v / pot;
    const sarg = Math.exp(-mg * Math.log(arg));
    return { q: (pot * cz * (1 - arg * sarg)) / (1 - mg), c: cz * sarg };
  }
  const czf2 = cz / f2;
  return { q: cz * f1 + czf2 * (f3 * (v - fcpot) + (mg / (pot + pot)) * (v * v - fcpot * fcpot)), c: czf2 * (f3 + (mg * v) / pot) };
}

/** What bjtload works out at one set of junction voltages (dc part; charges are added by the caller). */
interface BjtPoint {
  cc: number;
  cb: number;
  gpi: number;
  gmu: number;
  gm: number;
  go: number;
  gx: number;
  // for the charges
  cbe: number;
  gbe: number;
  cbc: number;
  gbc: number;
  qb: number;
  dqbdve: number;
  dqbdvc: number;
  cdsub: number;
  gdsub: number;
}

/** Kull's quasi-saturation at one set of voltages: the epi current and its charges (bjtload.c). */
interface Quasi {
  irci: number;
  /** dIrci / dvrci, dvbci, dvbcx. */
  gr: number;
  gbci: number;
  gbcx: number;
  /** The charge added to the base-collector junction's, and the one across b'–cx, with their capacitances. */
  qbci: number;
  cbci: number;
  qbcx: number;
  cbcx: number;
}

/**
 * A Gummel-Poon transistor on its part's nodes: collector, base, emitter, substrate (−1: ground,
 * as a three-terminal SPICE Q); c', b', e' are the nodes inside RC, RB and RE (the outer node when
 * there's no resistance). With RCO, cx is the node between RC and the epi layer, c' the intrinsic
 * collector beyond it (without RCO, cx is c').
 */
export class BjtDevice extends Device {
  // the last iteration's junction voltages and currents (ngspice's state0)
  vbe = 0;
  vbc = 0;
  vsub = 0;
  vbcx = 0;
  cc = 0;
  cb = 0;
  gpi = 0;
  gmu = 0;
  gm = 0;
  go = 0;
  /** Depletion and diffusion charges: base-emitter, base-collector (inner), base-collector outside RB, substrate. */
  readonly qbe = new Charge();
  readonly qbc = new Charge();
  readonly qbx = new Charge();
  readonly qsub = new Charge();
  /** Quasi-saturation's charge across b'–cx (QCO). */
  readonly qbcx = new Charge();
  /** Excess phase: the delayed collector current at the last two accepted steps. */
  cex1 = 0;
  cex2 = 0;
  cexh1 = 0;
  /** At the present iterate (accepted when the step is). */
  cex0 = 0;

  constructor(
    host: DeviceHost, public p: BjtParams,
    readonly c: number, readonly b: number, readonly e: number, readonly s: number,
    readonly cp: number, readonly bp: number, readonly ep: number, readonly cx = cp,
  ) {
    super(host);
  }

  override nonLinear(): boolean {
    return true;
  }

  private get hasCharge(): boolean {
    const p = this.p;
    return p.cje > 0 || p.cjc > 0 || p.cjs > 0 || p.tf > 0 || p.tr > 0 || (p.rco > 0 && p.qco !== 0);
  }

  override reset(): void {
    this.vbe = this.vbc = this.vsub = this.vbcx = 0;
    this.cc = this.cb = this.gpi = this.gmu = this.gm = this.go = 0;
    for (const q of [this.qbe, this.qbc, this.qbx, this.qsub, this.qbcx]) q.settle(0);
    this.cex1 = this.cex2 = this.cexh1 = this.cex0 = 0;
  }

  override stamp(): void {
    const p = this.p;
    if (this.cx !== this.c) this.conductance(this.c, this.cx, p.gc);
    if (this.ep !== this.e) this.conductance(this.e, this.ep, p.ge);
  }

  /**
   * How many iterations this step has taken when the solver relies on the elements' own test: under
   * the CircuitJS solver (which can't shorten a step), and the NodeForge engine's last resort. Else 0.
   */
  private get stuck(): number {
    const sim = this.host.sim as { lastResort?: boolean; subIterations: number };
    return sim.lastResort ? sim.subIterations : this.struggling;
  }

  /**
   * Conductance added across the junctions when Newton is stuck, as CircuitJS's transistor does:
   * from 1 nS after 100 iterations up to 0.1 S, so a latch flipping with no capacitance to slow it
   * (no solution near the last one) can still settle. SPICE's GMIN otherwise.
   */
  private gminNow(): number {
    const n = this.stuck;
    return n > 100 ? Math.min(0.1, Math.exp(-9 * Math.log(10) * (1 - n / 300))) : GMIN;
  }

  /** The substrate's other junction node: c' (vertical) or b' (lateral). */
  private get subCon(): number {
    return this.p.subs > 0 ? this.cp : this.bp;
  }

  private voltages(): { vbe: number; vbc: number; vbx: number; vsub: number; vbcx: number } {
    const t = this.p.type;
    return {
      vbe: t * (this.v(this.bp) - this.v(this.ep)),
      vbc: t * (this.v(this.bp) - this.v(this.cp)),
      vbx: t * (this.v(this.b) - this.v(this.cp)),
      vsub: t * this.p.subs * (this.v(this.s) - this.v(this.subCon)),
      vbcx: t * (this.v(this.bp) - this.v(this.cx)),
    };
  }

  /**
   * Kull's quasi-saturation (bjtload.c): the current through the epi layer, cx to c', at vrci =
   * vbc − vbcx; forward (vrci > 0) its ohmic current corrected by the injected carriers
   * (Kbci, Kbcx) and limited by velocity saturation (VO); reverse plain RCO. The epi charge QCO·K
   * at each end is kept in both directions (ngspice drops it to 0 for vrci ≤ 0, a step of at least
   * QCO each time the current reverses, which neither it nor this engine can integrate; VBIC, the
   * model's origin, keeps it): the same charge while vrci > 0, and continuous.
   */
  private quasi(vrci: number, vbci: number, vbcx: number, gmin: number): Quasi {
    const p = this.p, vt = p.vt;
    const ei = p.gamma * Math.exp(Math.min(vbci / vt, 709)), ex = p.gamma * Math.exp(Math.min(vbcx / vt, 709));
    const kbci = Math.sqrt(1 + ei), kbciV = ei / (2 * vt * kbci);
    const kbcx = Math.sqrt(1 + ex), kbcxV = ex / (2 * vt * kbcx);
    const charge = { qbci: p.qco * kbci, cbci: p.qco * kbciV, qbcx: p.qco * kbcx, cbcx: p.qco * kbcxV };
    if (!(vrci > 0)) return { irci: vrci / p.rco + gmin * vrci, gr: 1 / p.rco + gmin, gbci: 0, gbcx: 0, ...charge };
    const rKp1 = (1 + kbci) / (1 + kbcx);
    const rKp1Vbci = kbciV / (1 + kbci);
    const rKp1Vbcx = (-(1 + kbci) * kbcxV) / ((kbcx + 1) * (kbcx + 1));
    const x1 = Math.log(rKp1), x1Vbci = rKp1Vbci / rKp1, x1Vbcx = rKp1Vbcx / rKp1;
    const vcorr = vt * (kbci - kbcx - x1);
    const vcorrVbci = vt * (kbciV - x1Vbci), vcorrVbcx = vt * (-kbcxV - x1Vbcx);
    const iohm = (vrci + vcorr) / p.rco;
    const quot = 1 + Math.abs(vrci) / p.vo, quotV = vrci / (p.vo * Math.abs(vrci));
    return {
      irci: iohm / quot + gmin * vrci,
      gr: 1 / p.rco / quot - (iohm * quotV) / (quot * quot) + gmin,
      gbci: vcorrVbci / p.rco / quot,
      gbcx: vcorrVbcx / p.rco / quot,
      ...charge,
    };
  }

  /** The dc currents and conductances at vbe, vbc, vsub (bjtload.c, before charge storage). */
  private point(vbe: number, vbc: number, vsub: number, gmin = GMIN): BjtPoint {
    const p = this.p, vt = p.vt;
    const f = junction(p.isBE, vbe, vt * p.nf);
    const fe = junction(p.ise, vbe, vt * p.ne);
    const cben = fe.i + gmin * vbe, gben = fe.g + gmin;
    const r = junction(p.isBC, vbc, vt * p.nr);
    const rc = junction(p.isc, vbc, vt * p.nc);
    const cbcn = rc.i + gmin * vbc, gbcn = rc.g + gmin;
    // substrate junction (with gmin, even without ISS)
    const vts = vt * p.ns;
    let cdsub: number, gdsub: number;
    if (vsub <= -3 * vts) {
      let arg = (3 * vts) / (vsub * Math.E);
      arg = arg * arg * arg;
      gdsub = (p.iss * 3 * arg) / vsub + GMIN;
      cdsub = -p.iss * (1 + arg) + GMIN * vsub;
    } else {
      const ev = Math.exp(Math.min(709, vsub / vts));
      gdsub = (p.iss * ev) / vts + GMIN;
      cdsub = p.iss * (ev - 1) + GMIN * vsub;
    }
    // base charge
    const q1 = 1 / (1 - p.invVaf * vbc - p.invVar * vbe);
    let qb: number, dqbdve: number, dqbdvc: number;
    if (p.invIkf === 0 && p.invIkr === 0) {
      qb = q1;
      dqbdve = q1 * qb * p.invVar;
      dqbdvc = q1 * qb * p.invVaf;
    } else {
      const q2 = p.invIkf * f.i + p.invIkr * r.i;
      const arg = Math.max(0, 1 + 4 * q2);
      let sqarg = 1;
      if (arg !== 0) sqarg = p.nkf === 0.5 ? Math.sqrt(arg) : Math.pow(arg, p.nkf);
      qb = (q1 * (1 + sqarg)) / 2;
      if (p.nkf === 0.5) {
        dqbdve = q1 * (qb * p.invVar + (p.invIkf * f.g) / sqarg);
        dqbdvc = q1 * (qb * p.invVaf + (p.invIkr * r.g) / sqarg);
      } else {
        dqbdve = q1 * (qb * p.invVar + (p.invIkf * f.g * 2 * sqarg * p.nkf) / arg);
        dqbdvc = q1 * (qb * p.invVaf + (p.invIkr * r.g * 2 * sqarg * p.nkf) / arg);
      }
    }
    // excess phase: the transport current through a second-order delay (transient only)
    let cc = 0, cex = f.i, gex = f.g;
    this.cex0 = 0;
    if (p.td !== 0 && !this.dc && this.h > 0) {
      const h = this.h;
      let a1 = h / p.td;
      const a2 = 3 * a1;
      a1 = a2 * a1;
      const denom = 1 + a1 + a2;
      const a3 = a1 / denom;
      const ratio = this.cexh1 > 0 ? h / this.cexh1 : 0;
      cc = (this.cex1 * (1 + ratio + a2) - this.cex2 * ratio) / denom;
      cex = f.i * a3;
      gex = f.g * a3;
      this.cex0 = cc + cex / qb;
    }
    cc = cc + (cex - r.i) / qb - r.i / p.br - cbcn;
    const cb = f.i / p.bf + cben + r.i / p.br + cbcn;
    // base resistance: RBM + (RB − RBM)/qb, or IRB's current crowding
    let gx = p.rbm + (p.rb - p.rbm) / qb;
    if (p.irb !== 0) {
      let a1 = Math.max(cb / p.irb, 1e-9);
      const a2 = (-1 + Math.sqrt(1 + 14.59025 * a1)) / 2.4317 / Math.sqrt(a1);
      a1 = Math.tan(a2);
      gx = p.rbm + (3 * (p.rb - p.rbm) * (a1 - a2)) / a2 / a1 / a1;
    }
    if (gx !== 0) gx = 1 / gx;
    const go = (r.g + ((cex - r.i) * dqbdvc) / qb) / qb;
    return {
      cc, cb,
      gpi: f.g / p.bf + gben,
      gmu: r.g / p.br + gbcn,
      gm: (gex - ((cex - r.i) * dqbdve) / qb) / qb - go,
      go, gx,
      cbe: f.i, gbe: f.g, cbc: r.i, gbc: r.g, qb, dqbdve, dqbdvc, cdsub, gdsub,
    };
  }

  /**
   * The charges at vbe, vbc, vbx, vsub: qbe (depletion + TF's diffusion charge, which also depends
   * on vbc through qb and VTF: dqbe/dvbc is `cbeVbc`), qbc, qbx, qsub, and their capacitances.
   */
  private charges(pt: BjtPoint, vbe: number, vbc: number, vbx: number, vsub: number) {
    const p = this.p;
    let cbe = pt.cbe, gbe = pt.gbe, cbeVbc = 0;
    if (p.tf !== 0 && vbe > 0) {
      let argtf = 0, arg2 = 0, arg3 = 0;
      if (p.xtf !== 0) {
        argtf = p.xtf;
        if (p.ovtf !== 0) argtf *= Math.exp(vbc * p.ovtf);
        arg2 = argtf;
        if (p.itf !== 0) {
          const t = cbe / (cbe + p.itf);
          argtf *= t * t;
          arg2 = argtf * (3 - t - t);
        }
        arg3 = cbe * argtf * p.ovtf;
      }
      cbe = (cbe * (1 + argtf)) / pt.qb;
      gbe = (gbe * (1 + arg2) - cbe * pt.dqbdve) / pt.qb;
      cbeVbc = (p.tf * (arg3 - cbe * pt.dqbdvc)) / pt.qb;
    }
    const de = depletion(vbe, p.cje, p.vje, p.mje, p.depCap, p.f1, p.f2, p.f3);
    const czbc = p.cjc * p.xcjc, czbx = p.cjc - czbc;
    const dc = depletion(vbc, czbc, p.vjc, p.mjc, p.f4, p.f5, p.f6, p.f7);
    const dx = depletion(vbx, czbx, p.vjc, p.mjc, p.f4, p.f5, p.f6, p.f7);
    let qs = 0, cs = 0;
    if (p.cjs !== 0) {
      if (vsub < 0) {
        const arg = 1 - vsub / p.vjs, sarg = Math.exp(-p.mjs * Math.log(arg));
        qs = (p.vjs * p.cjs * (1 - arg * sarg)) / (1 - p.mjs);
        cs = p.cjs * sarg;
      } else {
        qs = vsub * p.cjs * (1 + (p.mjs * vsub) / (2 * p.vjs));
        cs = p.cjs * (1 + (p.mjs * vsub) / p.vjs);
      }
    }
    return {
      qbe: p.tf * cbe + de.q, cbe: p.tf * gbe + de.c, cbeVbc,
      qbc: p.tr * pt.cbc + dc.q, cbc: p.tr * pt.gbc + dc.c,
      qbx: dx.q, cbx: dx.c,
      qsub: qs, csub: cs,
    };
  }

  override doStep(): void {
    const p = this.p, t = p.type;
    const raw = this.voltages();
    // ngspice's convergence test (bjtconv.c) on the collector and base currents
    const delvbe = raw.vbe - this.vbe, delvbc = raw.vbc - this.vbc;
    const cchat = this.cc + (this.gm + this.go) * delvbe - (this.go + this.gmu) * delvbc;
    const cbhat = this.cb + this.gpi * delvbe + this.gmu * delvbc;
    // (the NodeForge engine's last resort: lenient, as currentTol is under the CircuitJS solver)
    const k = (this.host.sim as { lastResort?: boolean }).lastResort && this.stuck > 500 ? 1e3 : 1;
    if (Math.abs(cchat - this.cc) > k * this.currentTol(cchat, this.cc) || Math.abs(cbhat - this.cb) > k * this.currentTol(cbhat, this.cb)) this.notConverged();
    // limit the junction voltage steps
    const lbe = pnjlim(raw.vbe, this.vbe, p.vt, p.vcrit);
    const lbc = pnjlim(raw.vbc, this.vbc, p.vt, p.vcrit);
    const lsub = pnjlim(raw.vsub, this.vsub, p.vt, p.subVcrit);
    if (lbe.limited || lbc.limited || lsub.limited) this.notConverged();
    const vbe = lbe.v, vbc = lbc.v, vsub = lsub.v;
    // (vbx, across the outer part of the base-collector capacitance, isn't limited. vbcx, the
    // epi layer's far end, is limited as a junction: ngspice doesn't, but its exp(vbcx/vt) then
    // overflows on a Newton iterate far from the solution (from a start at zero with a large QCO);
    // vrci follows both limits)
    let vbcx = raw.vbcx;
    if (p.rco > 0) {
      const lbcx = pnjlim(raw.vbcx, this.vbcx, p.vt, p.vcrit);
      if (lbcx.limited) this.notConverged();
      vbcx = lbcx.v;
      this.vbcx = vbcx;
    }
    const vbx = raw.vbx, vrci = vbc - vbcx;
    const gmin = this.gminNow();
    const pt = this.point(vbe, vbc, vsub, gmin);
    const qs = p.rco > 0 ? this.quasi(vrci, vbc, vbcx, gmin) : null;
    let { cc, cb, gpi, gmu } = pt;
    const { gm, go, gx } = pt;
    // ngspice stores the dc-plus-charge values for the next convergence test
    let geqcb = 0, geqbx = 0, ceqbxI = 0, gcsub = 0, cqsub = 0, gbcx = 0, cqbcx = 0;
    if (!this.dc && this.hasCharge) {
      const q = this.charges(pt, vbe, vbc, vbx, vsub);
      const h = this.h, order = this.order;
      this.qbe.update(vbe, q.qbe, q.cbe, h, order);
      // (quasi-saturation's epi charge at c' joins the base-collector junction's)
      this.qbc.update(vbc, q.qbc + (qs?.qbci ?? 0), q.cbc + (qs?.cbci ?? 0), h, order);
      if (qs) {
        this.qbcx.update(vbcx, qs.qbcx, qs.cbcx, h, order);
        gbcx = this.qbcx.geq;
        cqbcx = this.qbcx.current(vbcx);
      }
      this.qbx.update(vbx, q.qbx, q.cbx, h, order);
      this.qsub.update(vsub, q.qsub, q.csub, h, order);
      // dqbe/dvbc times the integration coefficient (geq / C of the BE charge)
      geqcb = q.cbeVbc * this.coefficient(h, order);
      const iqbe = this.qbe.current(vbe), iqbc = this.qbc.current(vbc);
      gpi += this.qbe.geq;
      cb += iqbe;
      gmu += this.qbc.geq;
      cb += iqbc;
      cc -= iqbc;
      geqbx = this.qbx.geq;
      ceqbxI = this.qbx.current(vbx);
      gcsub = this.qsub.geq;
      cqsub = this.qsub.current(vsub);
    }
    this.vbe = vbe;
    this.vbc = vbc;
    this.vsub = vsub;
    this.cc = cc;
    this.cb = cb;
    this.gpi = gpi;
    this.gmu = gmu;
    this.gm = gm;
    this.go = go;

    // load (bjtload.c)
    const geqsub = gcsub + pt.gdsub;
    const ceqsub = t * p.subs * (cqsub + pt.cdsub - vsub * geqsub);
    const ceqbx = t * (ceqbxI - vbx * geqbx);
    const ceqbe = t * (cc + cb - vbe * (gm + go + gpi) + vbc * (go - geqcb));
    const ceqbc = t * (-cc + vbe * (gm + go) - vbc * (gmu + go));
    const { b, cp, bp, ep, s } = this, sc = this.subCon;
    this.rhs(b, -ceqbx);
    this.rhs(cp, ceqbx + ceqbc);
    this.rhs(sc, ceqsub);
    this.rhs(bp, -ceqbe - ceqbc);
    this.rhs(ep, ceqbe);
    this.rhs(s, -ceqsub);
    if (bp !== b) {
      this.matrix(b, b, gx);
      this.matrix(b, bp, -gx);
      this.matrix(bp, b, -gx);
      this.matrix(bp, bp, gx);
    }
    this.matrix(b, b, geqbx);
    this.matrix(cp, cp, gmu + go + geqbx);
    this.matrix(sc, sc, geqsub);
    this.matrix(bp, bp, gpi + gmu + geqcb);
    this.matrix(ep, ep, gpi + gm + go);
    this.matrix(cp, bp, -gmu + gm);
    this.matrix(cp, ep, -gm - go);
    this.matrix(bp, cp, -gmu - geqcb);
    this.matrix(bp, ep, -gpi);
    this.matrix(ep, cp, -go + geqcb);
    this.matrix(ep, bp, -gpi - gm - geqcb);
    this.matrix(s, s, geqsub);
    this.matrix(sc, s, -geqsub);
    this.matrix(s, sc, -geqsub);
    this.matrix(b, cp, -geqbx);
    this.matrix(cp, b, -geqbx);
    if (qs) {
      // the epi current, cx to c', linearized in vrci, vbc and vbcx (as ngspice stamps Irci)
      const cx = this.cx;
      const ceq = t * (qs.irci - qs.gr * vrci - qs.gbci * vbc - qs.gbcx * vbcx);
      this.rhs(cx, -ceq);
      this.rhs(cp, ceq);
      this.matrix(cx, cx, qs.gr - qs.gbcx);
      this.matrix(cx, cp, -qs.gr - qs.gbci);
      this.matrix(cx, bp, qs.gbci + qs.gbcx);
      this.matrix(cp, cx, -qs.gr + qs.gbcx);
      this.matrix(cp, cp, qs.gr + qs.gbci);
      this.matrix(cp, bp, -qs.gbci - qs.gbcx);
      // QCO's charge across b'–cx, as the other charges are stamped (ngspice leaves out the
      // −gbcx·vbcx and the type sign here, so its b'–cx charge acts as a step-dependent conductance)
      if (gbcx !== 0 || cqbcx !== 0) {
        const ceqx = t * (cqbcx - gbcx * vbcx);
        this.rhs(bp, -ceqx);
        this.rhs(cx, ceqx);
        this.matrix(bp, bp, gbcx);
        this.matrix(cx, cx, gbcx);
        this.matrix(bp, cx, -gbcx);
        this.matrix(cx, bp, -gbcx);
      }
    }
  }

  /** The integration coefficient a0 of a step (as Charge.update uses it). */
  private coefficient(h: number, order: number): number {
    const h1 = this.qbe.h1;
    if (order === 1 || !(h1 > 0)) return 1 / h;
    const w = h / h1;
    return (1 + 2 * w) / ((1 + w) * h);
  }

  override stepFinished(): void {
    const v = this.voltages();
    const pt = this.point(v.vbe, v.vbc, v.vsub);
    if (this.p.td !== 0) {
      if (this.dc || !(this.h > 0)) {
        // ngspice's MODEINITTRAN: the delay starts settled at the transport current
        this.cex1 = this.cex2 = pt.cbe / pt.qb;
        this.cexh1 = 0;
      } else {
        this.cex2 = this.cex1;
        this.cex1 = this.cex0;
        this.cexh1 = this.h;
      }
    }
    if (!this.hasCharge) return;
    const q = this.charges(pt, v.vbe, v.vbc, v.vbx, v.vsub);
    const qs = this.p.rco > 0 ? this.quasi(v.vbc - v.vbcx, v.vbc, v.vbcx, GMIN) : null;
    const qbc = q.qbc + (qs?.qbci ?? 0), qbcx = qs?.qbcx ?? 0;
    if (this.dc) {
      this.qbe.settle(q.qbe);
      this.qbc.settle(qbc);
      this.qbx.settle(q.qbx);
      this.qsub.settle(q.qsub);
      this.qbcx.settle(qbcx);
    } else {
      this.qbe.accept(q.qbe, this.h);
      this.qbc.accept(qbc, this.h);
      this.qbx.accept(q.qbx, this.h);
      this.qsub.accept(q.qsub, this.h);
      this.qbcx.accept(qbcx, this.h);
    }
  }

  override states(values: number[], abstol: number[]): void {
    if (!this.hasCharge) return;
    values.push(this.qbe.q, this.qbc.q, this.qbx.q, this.qsub.q, this.qbcx.q);
    abstol.push(CHARGE_TOL, CHARGE_TOL, CHARGE_TOL, CHARGE_TOL, CHARGE_TOL);
  }

  override currents(into: number[]): void {
    const p = this.p, t = p.type;
    const v = this.voltages();
    // the dc currents at the solution (excess phase: its value at the last iterate)
    const saved = this.cex0;
    const pt = this.point(v.vbe, v.vbc, v.vsub);
    this.cex0 = saved;
    let cc = pt.cc, cb = pt.cb, ibx = 0, isub = pt.cdsub, ibcx = 0;
    const qs = p.rco > 0 ? this.quasi(v.vbc - v.vbcx, v.vbc, v.vbcx, GMIN) : null;
    if (!this.dc && this.hasCharge) {
      if (qs) ibcx = this.qbcx.current(v.vbcx);
      const iqbc = this.qbc.current(v.vbc);
      cb += this.qbe.current(v.vbe) + iqbc;
      cc -= iqbc;
      ibx = this.qbx.current(v.vbx);
      isub += this.qsub.current(v.vsub);
    }
    // into c' and b', out of e' (NPN sense), then the outside base-collector charge and substrate
    addInto(into, this.cp, t * cc);
    addInto(into, this.bp, t * cb);
    addInto(into, this.ep, -t * (cc + cb));
    addInto(into, this.b, t * ibx);
    addInto(into, this.cp, -t * ibx);
    addInto(into, this.s, t * p.subs * isub);
    addInto(into, this.subCon, -t * p.subs * isub);
    const r = (a: number, b: number, gg: number) => {
      if (a === b || !(gg > 0)) return;
      const i = (this.v(a) - this.v(b)) * gg;
      addInto(into, a, i);
      addInto(into, b, -i);
    };
    r(this.c, this.cx, p.gc);
    if (qs) {
      // the epi current, cx to c'; QCO's charge, b' to cx
      addInto(into, this.cx, t * qs.irci);
      addInto(into, this.cp, -t * qs.irci);
      addInto(into, this.bp, t * ibcx);
      addInto(into, this.cx, -t * ibcx);
    }
    r(this.e, this.ep, p.ge);
    if (this.bp !== this.b) r(this.b, this.bp, pt.gx);
  }
}
