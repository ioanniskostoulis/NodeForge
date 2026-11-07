// The VDMOS power MOSFET (ngspice's vdmosload.c / vdmostemp.c, after LTspice's model): a
// Shichman-Hodges channel with smooth subthreshold, mobility reduction (theta) and a triode
// multiplier, series Rd / Rs / Rg, a drain-source leak, a constant Cgs and the nonlinear gate-drain
// capacitance that makes the Miller plateau, and a body diode (junction capacitance, transit time,
// breakdown) through Rb; self-heating (ngspice's `thermal` VDMOS: the junction temperature on a
// node of its own, CTHJ there, RTHJC to the case node, RTHCA to ambient).
// Copyright 1985 - 2018, Regents of the University of California and others, ngspice (https://ngspice.sourceforge.io), Modified BSD licence (assets/licenses/ngspice-modified-bsd.txt).
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { SpiceModel } from "../spice/parse";
import { addInto, CHARGE_TOL, Charge, Device, type DeviceHost, fetlim, K_OVER_Q, limitlog, limvds, T_DEFAULT, T_NOMINAL } from "./device";
import { DiodeDevice, type DiodeParams, diodeParams } from "./diode";

export interface VdmosParams {
  /** 1 n-channel, −1 p-channel. */
  type: number;
  /** Threshold (signed, as in the model card), transconductance (A/V²). */
  vto: number;
  beta: number;
  lambda: number;
  theta: number;
  mtr: number;
  ksubthres: number;
  subshift: number;
  rd: number;
  rs: number;
  rg: number;
  /** Drain-source leak conductance. */
  gds0: number;
  /** Quasi-saturation (rq, vq), when both given. */
  rq: number;
  vq: number;
  cgdmin: number;
  cgdmax: number;
  a: number;
  cgs: number;
  /** Body diode, and its series resistance (0: none). */
  diode: DiodeParams;
  rb: number;
  /** What they were worked out from (self-heating works them out again at the junction temperature). */
  card: SpiceModel;
  mult: number;
  bodyCard: SpiceModel;
  temp: number;
}

const get = (m: SpiceModel, k: string, d: number) => m.params.get(k) ?? d;

/** Is this a p-channel VDMOS card (LTspice's `pchan` flag, or ngspice's `vdmosp`)? */
export function vdmosType(m: SpiceModel): number {
  return m.flags.has("pchan") || m.flags.has("vdmosp") || (m.params.get("vdmosp") ?? 0) !== 0 ? -1 : 1;
}

/** VDMOS parameters from a `.model … VDMOS` card at temperature `temp` (K), `mult` devices in parallel. */
export function vdmosParams(m: SpiceModel, temp = T_DEFAULT, mult = 1): VdmosParams {
  const type = vdmosType(m);
  const tnom = get(m, "tnom", 27) + 273.15;
  const dt = temp - tnom;
  const ratio = temp / tnom;
  const rds = m.params.get("rds");
  // the body diode: VDMOS's own defaults (Cjo 0.5 nF, Vj 0.8, Ibv 0.1 nA, Nbv 1)
  const dm: SpiceModel = {
    name: `${m.name}:body`, type: "D", flags: new Set(), text: new Map(), source: "",
    params: new Map<string, number>([
      ["is", get(m, "is", 1e-14) * mult], ["n", get(m, "n", 1)], ["cjo", get(m, "cjo", 5e-10) * mult],
      ["vj", get(m, "vj", 0.8)], ["m", get(m, "m", 0.5)], ["fc", get(m, "fc", 0.5)], ["tt", get(m, "tt", 0)],
      ["ibv", get(m, "ibv", 1e-10)], ["nbv", get(m, "nbv", 1)], ["eg", get(m, "eg", 1.11)], ["xti", get(m, "xti", 3)],
      ["tnom", get(m, "tnom", 27)],
    ]),
  };
  const bv = m.params.get("bv");
  if (bv !== undefined && Math.abs(bv) < 1e90) dm.params.set("bv", Math.abs(bv));
  const rd = get(m, "rd", 0), texp0 = m.params.get("texp0");
  return {
    type,
    vto: get(m, "vto", get(m, "vth0", 3 * type)) + get(m, "tcvth", get(m, "vtotc", 0)) * dt,
    beta: get(m, "kp", 15 + 5 * type) * mult * Math.pow(ratio, get(m, "mu", get(m, "bex", -1.5))),
    lambda: get(m, "lambda", 0),
    theta: get(m, "theta", 0),
    mtr: get(m, "mtriode", 1),
    ksubthres: get(m, "ksubthres", 0.1) * (1 + get(m, "tksubthres1", 0) * dt + get(m, "tksubthres2", 0) * dt * dt),
    subshift: get(m, "subshift", 0),
    rd: (texp0 !== undefined ? (rd / mult) * Math.pow(ratio, texp0) : (rd / mult) * (1 + get(m, "trd1", 0) * dt + get(m, "trd2", 0) * dt * dt)),
    rs: (get(m, "rs", 0) / mult) * (1 + get(m, "trs1", 0) * dt + get(m, "trs2", 0) * dt * dt),
    rg: (get(m, "rg", 0) / mult) * (1 + get(m, "trg1", 0) * dt + get(m, "trg2", 0) * dt * dt),
    gds0: rds !== undefined && rds > 0 ? mult / rds : 1e-15,
    rq: m.params.has("rq") && m.params.has("vq") ? (get(m, "rq", 0) / mult) * Math.pow(ratio, get(m, "texp1", 0.3)) : 0,
    vq: get(m, "vq", 0),
    cgdmin: get(m, "cgdmin", 2e-11) * mult,
    cgdmax: get(m, "cgdmax", 2e-9) * mult,
    a: get(m, "a", 1),
    cgs: get(m, "cgs", 1.4e-9) * mult,
    diode: diodeParams(dm, temp),
    rb: (get(m, "rb", 0) / mult) * (1 + get(m, "trb1", 0) * dt + get(m, "trb2", 0) * dt * dt),
    card: m, mult, bodyCard: dm, temp,
  };
}

/**
 * The derivatives in temperature self-heating needs (vdmosload.c): of the drain, source and
 * body-diode series conductances (ngspice's forms), and of KP (∝ T^MU) and the threshold (TCVTH).
 */
function temperatureSlopes(p: VdmosParams): { gd: number; gs: number; gb: number; beta: number; vto: number } {
  const m = p.card, T = p.temp, tnom = get(m, "tnom", 27) + 273.15, dt = T - tnom;
  const rd0 = get(m, "rd", 0) / p.mult;
  const drd = m.params.has("texp0") ? (p.rd * get(m, "texp0", 0)) / T : rd0 * (get(m, "trd1", 0) + 2 * get(m, "trd2", 0) * dt);
  const rs0 = get(m, "rs", 0) / p.mult;
  const drs = rs0 * (get(m, "trs1", 0) + 2 * get(m, "trs2", 0) * dt);
  // the body diode's series resistance: ngspice's VDIOtConductance_dT, −G·(TRB1 + TRB2·ΔT)/factor²
  const rb0 = get(m, "rb", 0) / p.mult, fb = 1 + get(m, "trb1", 0) * dt + get(m, "trb2", 0) * dt * dt;
  return {
    gd: p.rd > 0 ? -drd / (p.rd * p.rd) : 0,
    gs: p.rs > 0 ? -drs / (p.rs * p.rs) : 0,
    gb: rb0 > 0 ? (-(1 / rb0) * (get(m, "trb1", 0) + get(m, "trb2", 0) * dt)) / (fb * fb) : 0,
    beta: (p.beta * get(m, "mu", get(m, "bex", -1.5))) / T,
    vto: get(m, "tcvth", get(m, "vtotc", 0)),
  };
}

/** Self-heating: the junction (°C) and case nodes, the thermal network, the ambient (°C). */
export interface VdmosThermal {
  tj: number;
  tc: number;
  rthjc: number;
  rthca: number;
  cthj: number;
  ambient: number;
}

/** Half the gate-drain capacitance at vgd, and half of Cgs (DevCapVDMOS: Meyer stores halves). */
function halfCaps(p: VdmosParams, vgd: number): { cgd: number; cgs: number } {
  const s = (p.cgdmax - p.cgdmin) / (1 + Math.PI / 2);
  const y = p.cgdmax - s;
  const cgd = vgd > 0 ? 0.5 * (s * Math.tanh(p.a * vgd) + y) : 0.5 * (s * Math.atan(p.a * vgd) + y);
  return { cgd, cgs: 0.5 * p.cgs };
}

/**
 * A gate capacitance integrated as ngspice integrates MOSFET capacitances (Meyer): the charge
 * moves by the voltage change times the average of the capacitance now and at the last step.
 */
class MeyerCap extends Charge {
  /** Voltage and half-capacitance at the last accepted step. */
  v1 = 0;
  c1 = 0;

  /** Linearize at voltage v with half-capacitance c (h: the step). */
  at(v: number, c: number, h: number, order = 2): void {
    const total = c + this.c1;
    this.update(v, (v - this.v1) * total + this.q1, total, h, order);
  }
  acceptAt(v: number, c: number, h: number): void {
    const q = (v - this.v1) * (c + this.c1) + this.q1;
    this.accept(q, h);
    this.v1 = v;
    this.c1 = c;
  }
  settleAt(v: number, c: number): void {
    this.settle(v * 2 * c);
    this.v1 = v;
    this.c1 = c;
  }
}

/**
 * A VDMOS between its part's drain, gate and source nodes; dp, gp, sp are the inner ends of Rd,
 * Rg, Rs (the same node when that resistance is 0) and bp the body diode's anode end of Rb.
 */
export class VdmosDevice extends Device {
  /** Normalized (×type) gate-source and drain-source voltages of the last iteration. */
  vgs = 0;
  vds = 0;
  /** Drain current (into dp, out of sp, normalized), its derivatives, and the mode (1 / −1). */
  cd = 0;
  gm = 0;
  gds = 0;
  mode = 1;
  von = 0;
  readonly qgs = new MeyerCap();
  readonly qgd = new MeyerCap();
  readonly body: DiodeDevice;
  /** Self-heating, or null; the junction temperature (°C) of the last iteration; the channel current's slope in it. */
  thermal: VdmosThermal | null = null;
  tj = T_DEFAULT - 273.15;
  /** Tolerances: the threshold's shift (V, as the card's VTO) and KP's factor (1: nominal). */
  vtoShift = 0;
  betaFactor = 1;
  gmT = 0;
  readonly qth = new Charge();

  /**
   * The junction and case at the ambient: their nodes (°C), the heat stored and the parameters (a
   * run from reset, or from a part just built, has no operating point to put them there).
   */
  startThermal(): void {
    const th = this.thermal;
    if (!th) return;
    const start = (this.host.sim as { coldThermalStart?: boolean }).coldThermalStart ? 0 : th.ambient;
    this.tj = start;
    this.host.volts[th.tj] = this.host.volts[th.tc] = start;
    this.p = vdmosParams(this.p.card, this.tj + 273.15, this.p.mult);
    this.qth.settle(th.cthj * this.tj);
  }

  /** Switch self-heating on: the body diode heats the same junction node. */
  setThermal(th: VdmosThermal): void {
    this.thermal = th;
    this.tj = th.ambient;
    this.body.thermal = { model: this.p.bodyCard, area: 1, temp: 273.15, rth: 0, cth: 0, tn: th.tj, gminExtra: 0, start: th.ambient, limit: 10 };
  }

  constructor(
    host: DeviceHost, public p: VdmosParams,
    readonly d: number, readonly g: number, readonly s: number,
    readonly dp: number, readonly gp: number, readonly sp: number, readonly bp: number,
  ) {
    super(host);
    // the body diode conducts from source to drain (n-channel), or drain to source (p-channel)
    this.body = p.type > 0 ? new DiodeDevice(host, p.diode, bp, d, bp) : new DiodeDevice(host, p.diode, d, bp, d);
    this.von = p.type * p.vto;
  }

  override nonLinear(): boolean {
    return true;
  }

  override reset(): void {
    this.vgs = this.vds = this.cd = this.gm = this.gds = 0;
    this.mode = 1;
    if (this.thermal) {
      this.gmT = 0;
      this.startThermal();
    }
    this.qgs.settleAt(0, halfCaps(this.p, 0).cgs);
    this.qgd.settleAt(0, halfCaps(this.p, 0).cgd);
    this.body.reset();
  }

  override stamp(): void {
    const p = this.p;
    // (self-heating: the series resistances follow the temperature, stamped every iteration)
    if (!this.thermal) this.stampResistances();
    this.conductance(this.d, this.s, p.gds0);
    this.body.stamp();
  }

  private stampResistances(): void {
    const p = this.p;
    if (this.dp !== this.d && !(p.rq > 0)) this.conductance(this.d, this.dp, 1 / p.rd);
    if (this.sp !== this.s) this.conductance(this.s, this.sp, 1 / p.rs);
    if (this.gp !== this.g) this.conductance(this.g, this.gp, 1 / p.rg);
    if (this.bp !== this.s) this.conductance(this.s, this.bp, 1 / p.rb);
  }

  /** Channel current at normalized vgs, vds: sets cd (normalized, drain to source), gm, gds, mode. */
  private channel(vgs: number, vds: number): void {
    const p = this.p;
    const vgd = vgs - vds;
    this.mode = vds >= 0 ? 1 : -1;
    // threshold in the normalized frame (vto is signed as in the card: negative for p-channel)
    const von = p.type * (p.vto + this.vtoShift);
    let vgst = (this.mode === 1 ? vgs : vgd) - von;
    const vdsat = Math.max(vgst, 0);
    const slope = p.ksubthres;
    const vdss = vds * p.mtr * this.mode;
    const t0 = 1 + p.lambda * vds;
    const t1 = 1 + p.theta * vdsat;
    const beta = p.beta * this.betaFactor;
    const betap = (beta * t0) / t1;
    const dbetapdvgs = (-beta * p.theta * t0) / (t1 * t1);
    const dbetapdvds = (beta * p.lambda) / t1;
    const vgstRaw = vgst;
    const t2 = Math.exp((vgst - p.subshift) / slope);
    vgst = Number.isFinite(t2) ? slope * Math.log(1 + t2) : vgst - p.subshift;
    const dvgstdvgs = Number.isFinite(t2) ? t2 / (t2 + 1) : 1;
    let cdrain: number;
    if (vgst <= vdss) {
      // saturation
      cdrain = betap * vgst * vgst * 0.5;
      this.gm = betap * vgst * dvgstdvgs + 0.5 * dbetapdvgs * vgst * vgst;
      this.gds = 0.5 * dbetapdvds * vgst * vgst;
    } else {
      // linear
      cdrain = betap * vdss * (vgst - 0.5 * vdss);
      this.gm = betap * vdss * dvgstdvgs + vdss * dbetapdvgs * (vgst - 0.5 * vdss);
      this.gds = vdss * dbetapdvds * (vgst - 0.5 * vdss) + betap * p.mtr * (vgst - 0.5 * vdss) - 0.5 * vdss * betap * p.mtr;
    }
    this.cd = this.mode * cdrain;
    if (this.thermal) {
      // the slope in temperature (vdmosload.c; the threshold's sign corrected: it moves by
      // TCVTH, so the overdrive by −type·TCVTH, through the subthreshold smoothing)
      const ts = temperatureSlopes(p);
      const dvgstRawdT = -p.type * ts.vto;
      const dvgstdT = dvgstdvgs * dvgstRawdT;
      const dt1dT = p.theta * (vgstRaw > 0 ? dvgstRawdT : 0);
      const dbetapdT = (t0 * (t1 * ts.beta * this.betaFactor - beta * dt1dT)) / (t1 * t1);
      this.gmT = vgst <= vdss
        ? 0.5 * dbetapdT * vgst * vgst + betap * vgst * dvgstdT
        : vdss * (dbetapdT * vgst + betap * dvgstdT) - dbetapdT * vdss * 0.5 * vdss;
    }
  }

  override doStep(): void {
    let p = this.p;
    const type = p.type;
    // the voltages across the channel (inner nodes), normalized to n-channel
    let vgs = type * (this.v(this.gp) - this.v(this.sp));
    let vds = type * (this.v(this.dp) - this.v(this.sp));
    let vgd = vgs - vds;
    const vgdo = this.vgs - this.vds;
    // ngspice's convergence test on the drain current
    const delvgs = vgs - this.vgs, delvds = vds - this.vds, delvgd = vgd - vgdo;
    const th = this.thermal;
    const rawTj = th ? this.v(th.tj) : 0;
    const cdhat = (this.mode >= 0 ? this.cd + this.gm * delvgs + this.gds * delvds : this.cd - this.gm * delvgd + this.gds * delvds)
      + (th ? this.gmT * (rawTj - this.tj) : 0);
    if (Math.abs(cdhat - this.cd) > this.currentTol(cdhat, this.cd)) this.notConverged();
    // self-heating: the junction temperature limited (DEVlimitlog, 10 K), the parameters at it
    if (th) {
      const l = limitlog(rawTj, this.tj, 10);
      if (l.limited) this.notConverged();
      this.tj = l.v;
      this.p = vdmosParams(p.card, l.v + 273.15, p.mult);
    }
    // CircuitJS mode can cycle between FET clamps after a step has struggled to converge.
    if (this.struggling <= 100) {
      if (this.vds >= 0) {
        vgs = fetlim(vgs, this.vgs, this.von);
        vds = vgs - vgd;
        vds = limvds(vds, this.vds);
      } else {
        vgd = fetlim(vgd, vgdo, this.von);
        vds = vgs - vgd;
        vds = -limvds(-vds, -this.vds);
        vgs = vgd + vds;
      }
    }
    vgd = vgs - vds;
    p = this.p;
    this.channel(vgs, vds);
    this.vgs = vgs;
    this.vds = vds;

    // gate capacitances
    let gcgs = 0, gcgd = 0, ceqgs = 0, ceqgd = 0;
    if (!this.dc) {
      const { cgd, cgs } = halfCaps(p, vgd);
      this.qgs.at(vgs, cgs, this.h, this.order);
      this.qgd.at(vgd, cgd, this.h, this.order);
      gcgs = this.qgs.geq;
      gcgd = this.qgd.geq;
      ceqgs = this.qgs.current(vgs) - gcgs * vgs;
      ceqgd = this.qgd.current(vgd) - gcgd * vgd;
    }

    // the linearized channel and capacitances (vdmosload.c)
    const xnrm = this.mode >= 0 ? 1 : 0, xrev = 1 - xnrm;
    const cdrain = this.mode * this.cd;
    const cdreq = this.mode >= 0
      ? type * (cdrain - this.gds * vds - this.gm * vgs)
      : -type * (cdrain - this.gds * -vds - this.gm * vgd);
    const { dp, gp, sp } = this;
    this.rhs(gp, -type * (ceqgs + ceqgd));
    this.rhs(dp, -cdreq + type * ceqgd);
    this.rhs(sp, cdreq + type * ceqgs);
    const gm = this.gm, gds = this.gds;
    this.matrix(dp, dp, gds + xrev * gm + gcgd);
    this.matrix(sp, sp, gds + xnrm * gm + gcgs);
    this.matrix(gp, gp, gcgd + gcgs);
    this.matrix(gp, dp, -gcgd);
    this.matrix(gp, sp, -gcgs);
    this.matrix(dp, gp, (xnrm - xrev) * gm - gcgd);
    this.matrix(dp, sp, -gds - xnrm * gm);
    this.matrix(sp, gp, -(xnrm - xrev) * gm - gcgs);
    this.matrix(sp, dp, -gds - xrev * gm);

    // quasi-saturation: the drain resistance depends on the outer drain-source voltage
    if (p.rq > 0 && this.dp !== this.d) {
      const vdsn = type * (this.v(this.d) - this.v(this.s));
      const rd = this.mode === 1 ? p.rd + p.rq * (vdsn / (vdsn + Math.abs(p.vq))) : p.rd;
      this.conductance(this.d, this.dp, rd > 0 ? 1 / rd + 1e-12 : 1 / p.rd);
    }

    if (th) this.loadThermal(th, vgs, vds, vgd);
    this.body.doStep();
  }

  /** Self-heating's stamps (vdmosload.c): resistances at Tj, the power into the junction node, the network. */
  private loadThermal(th: VdmosThermal, vgs: number, vds: number, vgd: number): void {
    const p = this.p, type = p.type, Tj = this.tj, ts = temperatureSlopes(p);
    const { d, s, dp, sp, gp, bp } = this, tj = th.tj, tc = th.tc;
    this.stampResistances();
    // the channel's power: cdrain·Vds (normalized), linearized in vgs, vds and Tj
    const mode = this.mode, Vds = mode * vds, Vgs = mode >= 0 ? vgs : vgd, cdrain = mode * this.cd;
    const gtempg = type * this.gm * Vds, gtempT = this.gmT * Vds, gtempd = type * (this.gds * Vds + cdrain);
    let cth = cdrain * Vds - type * (gtempg * Vgs + gtempd * Vds) - gtempT * Tj;
    const GmT = mode >= 0 ? type * this.gmT : -type * this.gmT;
    const gTtg = gtempg, gTtt = gtempT;
    const gTtdp = mode >= 0 ? gtempd : -(gtempg + gtempd), gTtsp = mode >= 0 ? -(gtempg + gtempd) : gtempd;
    // Rd and Rs: their I²R, and their conductances' slopes
    let dIthdVrd = 0, dIrddT = 0, vrd = 0;
    if (dp !== d && p.rd > 0) {
      const gdr = 1 / p.rd;
      vrd = this.v(d) - this.v(dp);
      dIthdVrd = gdr * 2 * vrd;
      dIrddT = vrd * ts.gd;
      cth += gdr * vrd * vrd - dIthdVrd * vrd - dIrddT * vrd * Tj;
    }
    let dIthdVrs = 0, dIrsdT = 0, vrs = 0;
    if (sp !== s && p.rs > 0) {
      const gsr = 1 / p.rs;
      vrs = this.v(s) - this.v(sp);
      dIthdVrs = gsr * 2 * vrs;
      dIrsdT = vrs * ts.gs;
      cth += gsr * vrs * vrs - dIthdVrs * vrs - dIrsdT * vrs * Tj;
    }
    // the body diode's Rb (its junction's power is the diode's own: see DiodeDevice.loadThermal)
    let dIthdVrb = 0, dIrbdT = 0, vrb = 0;
    if (bp !== s && p.rb > 0) {
      const gb = 1 / p.rb;
      vrb = this.v(s) - this.v(bp);
      dIthdVrb = vrb * gb;
      dIrbdT = vrb * ts.gb;
      cth += vrb * vrb * gb - dIthdVrb * vrb - vrb * dIrbdT * Tj;
    }
    let gcTt = 0, ceqqth = 0;
    if (!this.dc) {
      this.qth.update(Tj, th.cthj * Tj, th.cthj, this.h, this.order);
      gcTt = this.qth.geq;
      ceqqth = this.qth.current(Tj) - gcTt * Tj;
    }
    this.rhs(d, dIrddT * Tj);
    this.rhs(s, dIrsdT * Tj + dIrbdT * Tj);
    this.rhs(dp, GmT * Tj - dIrddT * Tj);
    this.rhs(sp, -GmT * Tj - dIrsdT * Tj);
    this.rhs(bp, -dIrbdT * Tj);
    this.rhs(tj, cth - ceqqth);
    const gthjc = 1 / th.rthjc, gthca = 1 / th.rthca;
    this.matrix(d, tj, dIrddT);
    this.matrix(dp, tj, GmT - dIrddT);
    this.matrix(s, tj, dIrsdT + dIrbdT);
    this.matrix(sp, tj, -GmT - dIrsdT);
    this.matrix(bp, tj, -dIrbdT);
    this.matrix(tj, tj, -gTtt - dIrddT * vrd - dIrsdT * vrs - dIrbdT * vrb + gthjc + gcTt);
    this.matrix(tj, gp, -gTtg);
    this.matrix(tj, d, -dIthdVrd);
    this.matrix(tj, s, -dIthdVrs - dIthdVrb);
    this.matrix(tj, dp, -gTtdp + dIthdVrd);
    this.matrix(tj, sp, -gTtsp + dIthdVrs);
    this.matrix(tj, bp, dIthdVrb);
    // the network: junction–case RTHJC, case–ambient RTHCA (the ambient a fixed temperature)
    this.matrix(tj, tc, -gthjc);
    this.matrix(tc, tj, -gthjc);
    this.matrix(tc, tc, gthjc + gthca);
    this.rhs(tc, gthca * th.ambient);
  }

  override stepFinished(): void {
    const p = this.p, type = p.type;
    const vgs = type * (this.v(this.gp) - this.v(this.sp));
    const vds = type * (this.v(this.dp) - this.v(this.sp));
    const vgd = vgs - vds;
    const { cgd, cgs } = halfCaps(p, vgd);
    if (this.dc) {
      this.qgs.settleAt(vgs, cgs);
      this.qgd.settleAt(vgd, cgd);
    } else {
      this.qgs.acceptAt(vgs, cgs, this.h);
      this.qgd.acceptAt(vgd, cgd, this.h);
    }
    this.body.stepFinished();
    const th = this.thermal;
    if (th) {
      const Tj = this.v(th.tj);
      if (this.dc) this.qth.settle(th.cthj * Tj);
      else this.qth.accept(th.cthj * Tj, this.h);
    }
  }

  override states(values: number[], abstol: number[]): void {
    values.push(this.qgs.q, this.qgd.q);
    abstol.push(CHARGE_TOL, CHARGE_TOL);
    if (this.thermal) {
      // the junction's heat (1 µK of it as the tolerance)
      values.push(this.qth.q);
      abstol.push(this.thermal.cthj * 1e-6);
    }
    this.body.states(values, abstol);
  }

  /** The channel current from drain to source (inner nodes), at the solution. */
  channelCurrent(): number {
    const type = this.p.type;
    const vgs = type * (this.v(this.gp) - this.v(this.sp));
    const vds = type * (this.v(this.dp) - this.v(this.sp));
    const saved = [this.cd, this.gm, this.gds, this.mode];
    this.channel(vgs, vds);
    const i = type * this.cd;
    [this.cd, this.gm, this.gds, this.mode] = saved;
    return i;
  }

  override currents(into: number[]): void {
    const p = this.p, type = p.type;
    // channel
    const ich = this.channelCurrent();
    addInto(into, this.dp, ich);
    addInto(into, this.sp, -ich);
    // gate capacitances (on their linearization: exact at convergence)
    if (!this.dc) {
      const vgs = type * (this.v(this.gp) - this.v(this.sp));
      const vgd = vgs - type * (this.v(this.dp) - this.v(this.sp));
      const igs = type * this.qgs.current(vgs), igd = type * this.qgd.current(vgd);
      addInto(into, this.gp, igs + igd);
      addInto(into, this.sp, -igs);
      addInto(into, this.dp, -igd);
    }
    // resistors
    const r = (a: number, b: number, g: number) => {
      if (a === b || !(g > 0)) return;
      const i = (this.v(a) - this.v(b)) * g;
      addInto(into, a, i);
      addInto(into, b, -i);
    };
    r(this.d, this.dp, p.rd > 0 ? 1 / p.rd : 0);
    r(this.s, this.sp, p.rs > 0 ? 1 / p.rs : 0);
    r(this.g, this.gp, p.rg > 0 ? 1 / p.rg : 0);
    r(this.s, this.bp, p.rb > 0 ? 1 / p.rb : 0);
    r(this.d, this.s, p.gds0);
    this.body.currents(into);
  }
}

/** Thermal voltage at the nominal temperature (for display / checks). */
export const VT_NOMINAL = K_OVER_Q * T_NOMINAL;
