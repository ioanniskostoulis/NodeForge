// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Ported from CircuitJS1 (TransistorElm.java, TransistorModel.java, NTransistorElm.java,
// PTransistorElm.java, LEDElm.java, VaractorElm.java, TunnelDiodeElm.java, JfetElm.java,
// NJfetElm.java, SCRElm.java, TriacElm.java, DiacElm.java, TriodeElm.java) by Paul Falstad,
// Iain Sharp and contributors. Licensed under the GNU General Public License v2 or later. See LICENSE.

import { CircuitElm, type XmlAttrs } from "../core/elm";
import { type GridPoint, grid, interpPoint, interpPointPerp, pt, sign, snapGrid } from "../core/geometry";
import type { VoltageSource } from "../core/nodes";
import { CircuitText, type TokenStream, type XmlNode } from "../io/tokens";
import { Diode, DiodeElm, DiodeModel } from "./diode";
import { MosfetElm } from "./mosfet";

const ch = (c: string) => c.charCodeAt(0);
const vt = 0.025865;

/** Gummel–Poon transistor model parameters. Global and shared by name, like CircuitJS's modelMap. */
export class TransistorModel {
  private static modelMap: Map<string, TransistorModel> | null = null;
  flags = 0;
  name = "";
  description: string | null = null;
  satCur = 0;
  invRollOffF = 0;
  BEleakCur = 0;
  leakBEemissionCoeff = 0;
  invRollOffR = 0;
  BCleakCur = 0;
  leakBCemissionCoeff = 0;
  emissionCoeffF = 0;
  emissionCoeffR = 0;
  invEarlyVoltF = 0;
  invEarlyVoltR = 0;
  betaR = 0;
  junctionCapBE = 0;
  junctionCapBC = 0;
  junctionPotBE = 0.75;
  junctionPotBC = 0.75;
  junctionExpBE = 0.33;
  junctionExpBC = 0.33;
  transitTimeF = 0;
  transitTimeR = 0;
  dumped = false;
  readOnly = false;
  builtIn = false;
  internal = false;

  /** TransistorModel(String d, double sc) */
  static make(d: string | null, sc: number): TransistorModel {
    const m = new TransistorModel();
    m.description = d;
    m.satCur = sc;
    m.emissionCoeffF = m.emissionCoeffR = 1;
    m.leakBEemissionCoeff = 1.5;
    m.leakBCemissionCoeff = 2;
    m.betaR = 1;
    return m;
  }

  static copyOf(c: TransistorModel): TransistorModel {
    const m = new TransistorModel();
    for (const k of ["flags", "satCur", "invRollOffF", "BEleakCur", "leakBEemissionCoeff", "invRollOffR", "BCleakCur", "leakBCemissionCoeff",
      "emissionCoeffF", "emissionCoeffR", "invEarlyVoltF", "invEarlyVoltR", "betaR", "junctionCapBE", "junctionPotBE", "junctionExpBE",
      "junctionCapBC", "junctionPotBC", "junctionExpBC", "transitTimeF", "transitTimeR"] as const) (m as unknown as Record<string, number>)[k] = c[k];
    return m;
  }

  static getModelWithName(name: string): TransistorModel {
    const map = TransistorModel.createModelMap();
    let lm = map.get(name);
    if (lm) return lm;
    lm = new TransistorModel();
    lm.name = name;
    map.set(name, lm);
    return lm;
  }

  static getModelWithNameOrCopy(name: string, oldmodel: TransistorModel | null): TransistorModel {
    const map = TransistorModel.createModelMap();
    let lm = map.get(name);
    if (lm) return lm;
    if (!oldmodel) return TransistorModel.getDefaultModel();
    lm = TransistorModel.copyOf(oldmodel);
    lm.name = name;
    map.set(name, lm);
    return lm;
  }

  static createModelMap(): Map<string, TransistorModel> {
    if (TransistorModel.modelMap) return TransistorModel.modelMap;
    TransistorModel.modelMap = new Map();
    const add = (name: string, m: TransistorModel) => {
      TransistorModel.modelMap!.set(name, m);
      m.readOnly = m.builtIn = true;
      m.name = name;
    };
    add("default", TransistorModel.make("default", 1e-13));
    add("spice-default", TransistorModel.make("spice-default", 1e-16));
    for (const s of [
      "xlm324v2-qpi 0 1.01e-16 333.3333333333333 0 1.5 0 0 2 1 1 0.0034482758620689655 0 1",
      "xlm324v2-qpa 0 1.01e-16 333.3333333333333 0 1.5 0 0 2 1 1 0.004081632653061225 0 1",
      "xlm324v2-qnq 0 1e-16 200 0 1.5 0 0 2 1 1 0 0 1",
      "xlm324v2-qpq 0 1e-16 333.3333333333333 0 1.5 0 0 2 1 1 0 0 1",
      "~tl431ed-qn_ed 0 1e-16 0 0 1.5 0 0 2 1 1 0.0125 0.02 1",
      "~tl431ed-qn_ed-A1.2 0 1.2e-16 0 0 1.5 0 0 2 1 1 0.0125 0.02 1",
      "~tl431ed-qn_ed-A2.2 0 2.2000000000000002e-16 0 0 1.5 0 0 2 1 1 0.0125 0.02 1",
      "~tl431ed-qn_ed-A0.5 0 5e-17 0 0 1.5 0 0 2 1 1 0.0125 0.02 1",
      "~tl431ed-qp_ed 0 1e-16 0 0 1.5 0 0 2 1 1 0.014285714285714285 0.025 1",
      "~tl431ed-qn_ed-A5 0 5e-16 0 0 1.5 0 0 2 1 1 0.0125 0.02 1",
      "~lm317-qpl-A0.1 0 1e-17 0 0 1.5 0 0 2 1 1 0.02 0 1",
      "~lm317-qnl-A0.2 0 2e-17 0 0 1.5 0 0 2 1 1 0.01 0 1",
      "~lm317-qpl-A0.2 0 2e-17 0 0 1.5 0 0 2 1 1 0.02 0 1",
      "~lm317-qnl-A2 0 2e-16 0 0 1.5 0 0 2 1 1 0.01 0 1",
      "~lm317-qpl-A2 0 2e-16 0 0 1.5 0 0 2 1 1 0.02 0 1",
      "~lm317-qnl-A5 0 5e-16 0 0 1.5 0 0 2 1 1 0.01 0 1",
      "~lm317-qnl-A50 0 5e-15 0 0 1.5 0 0 2 1 1 0.01 0 1",
    ]) {
      const parts = s.split(" ");
      const m = TransistorModel.getModelWithName(parts[0]);
      m.undumpValues(parts.slice(1).map(Number));
      m.builtIn = m.internal = true;
    }
    return TransistorModel.modelMap;
  }

  static getDefaultModel(): TransistorModel {
    return TransistorModel.getModelWithName("default");
  }

  static getModelList(): TransistorModel[] {
    const list = [...new Set(TransistorModel.createModelMap().values())].filter((m) => !m.internal);
    return list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  getDescription(): string {
    return this.description === null || this.description === this.name ? this.name : `${this.name} (${this.description})`;
  }

  private static readonly ORDER = ["flags", "satCur", "invRollOffF", "BEleakCur", "leakBEemissionCoeff", "invRollOffR", "BCleakCur",
    "leakBCemissionCoeff", "emissionCoeffF", "emissionCoeffR", "invEarlyVoltF", "invEarlyVoltR", "betaR",
    "junctionCapBE", "junctionPotBE", "junctionExpBE", "junctionCapBC", "junctionPotBC", "junctionExpBC", "transitTimeF", "transitTimeR"] as const;

  /** The fields of a `32` line after the name; the last eight are optional. */
  undumpValues(v: number[]): void {
    TransistorModel.ORDER.forEach((k, i) => {
      if (i < v.length && !Number.isNaN(v[i])) (this as unknown as Record<string, number>)[k] = v[i];
    });
  }

  /** Text format: `32 name flags is ikf ise ne ikr isc nc nf nr vaf var br [cje vje mje cjc vjc mjc] [tf tr]`. */
  static undumpModel(st: TokenStream): TransistorModel {
    const m = TransistorModel.getModelWithName(CircuitText.unescape(st.next()));
    const v: number[] = [st.nextInt()];
    for (let i = 0; i < 12; i++) v.push(st.nextDouble());
    for (let i = 0; i < 8; i++) {
      const x = st.tryDouble();
      if (x === undefined) break;
      v.push(x);
    }
    m.undumpValues(v);
    return m;
  }

  dump(): string {
    const vals = TransistorModel.ORDER.map((k) => this[k]);
    return `32 ${CircuitText.escape(this.name)} ${vals.join(" ")}`;
  }

  static undumpModelXml(xml: XmlNode): TransistorModel {
    const m = TransistorModel.getModelWithName(xml.string("nm", null) ?? "");
    m.flags = xml.int("f", m.flags);
    const d = (k: string, v: number) => xml.double(k, v);
    m.satCur = d("is", m.satCur);
    m.invRollOffF = d("ikf", m.invRollOffF);
    m.BEleakCur = d("ise", m.BEleakCur);
    m.leakBEemissionCoeff = d("ne", m.leakBEemissionCoeff);
    m.invRollOffR = d("ikr", m.invRollOffR);
    m.BCleakCur = d("isc", m.BCleakCur);
    m.leakBCemissionCoeff = d("nc", m.leakBCemissionCoeff);
    m.emissionCoeffF = d("nf", m.emissionCoeffF);
    m.emissionCoeffR = d("nr", m.emissionCoeffR);
    m.invEarlyVoltF = d("vaf", m.invEarlyVoltF);
    m.invEarlyVoltR = d("var", m.invEarlyVoltR);
    m.betaR = d("br", m.betaR);
    m.junctionCapBE = d("cje", m.junctionCapBE);
    m.junctionPotBE = d("vje", m.junctionPotBE);
    m.junctionExpBE = d("mje", m.junctionExpBE);
    m.junctionCapBC = d("cjc", m.junctionCapBC);
    m.junctionPotBC = d("vjc", m.junctionPotBC);
    m.junctionExpBC = d("mjc", m.junctionExpBC);
    m.transitTimeF = d("tf", m.transitTimeF);
    m.transitTimeR = d("tr", m.transitTimeR);
    return m;
  }

  dumpXml(): XmlAttrs {
    const a: XmlAttrs = [["nm", this.name], ["f", String(this.flags)], ["is", String(this.satCur)], ["ikf", String(this.invRollOffF)],
      ["ise", String(this.BEleakCur)], ["ne", String(this.leakBEemissionCoeff)], ["ikr", String(this.invRollOffR)], ["isc", String(this.BCleakCur)],
      ["nc", String(this.leakBCemissionCoeff)], ["nf", String(this.emissionCoeffF)], ["nr", String(this.emissionCoeffR)],
      ["vaf", String(this.invEarlyVoltF)], ["var", String(this.invEarlyVoltR)], ["br", String(this.betaR)]];
    if (this.junctionCapBE !== 0) a.push(["cje", String(this.junctionCapBE)], ["vje", String(this.junctionPotBE)], ["mje", String(this.junctionExpBE)]);
    if (this.junctionCapBC !== 0) a.push(["cjc", String(this.junctionCapBC)], ["vjc", String(this.junctionPotBC)], ["mjc", String(this.junctionExpBC)]);
    if (this.transitTimeF !== 0) a.push(["tf", String(this.transitTimeF)]);
    if (this.transitTimeR !== 0) a.push(["tr", String(this.transitTimeR)]);
    return a;
  }
}

export class TransistorElm extends CircuitElm {
  static override dumpType = ch("t");
  static readonly FLAG_FLIP = 1;
  static readonly FLAG_CIRCLE = 2;
  static lastModelName = "default";
  /** 1 = NPN, -1 = PNP. */
  pnp = 1;
  beta = 100;
  gmin = 0;
  modelName = "default";
  model: TransistorModel | null = null;
  badIters = 0;
  localSubIters = 0;
  ic = 0;
  ie = 0;
  ib = 0;
  capVoltBE = 0;
  capVoltBC = 0;
  capCurBE = 0;
  capCurBC = 0;
  geqBE = 0;
  geqBC = 0;
  ceqBE = 0;
  ceqBC = 0;
  vcrit = 0;
  lastvbc = 0;
  lastvbe = 0;
  coll: GridPoint[] = [];
  emit: GridPoint[] = [];
  rect: GridPoint[] = [];
  base: GridPoint = pt(0, 0);

  initNewPolarity(pnpflag: boolean): void {
    this.pnp = pnpflag ? -1 : 1;
    this.beta = 100;
    this.modelName = TransistorElm.lastModelName;
    this.setup();
  }

  override initNew(): void {
    this.initNewPolarity(false);
  }

  override readTokens(st: TokenStream): void {
    this.pnp = st.nextInt();
    this.beta = 100;
    // all optional, in one try block upstream
    const a = st.tryDouble();
    const b = a === undefined ? undefined : st.tryDouble();
    if (a !== undefined && b !== undefined) {
      this.lastvbe = a;
      this.lastvbc = b;
      this.volts[0] = 0;
      this.volts[1] = -this.lastvbe;
      this.volts[2] = -this.lastvbc;
      const be = st.tryDouble();
      if (be !== undefined) {
        this.beta = be;
        this.modelName = st.hasMoreTokens ? CircuitText.unescape(st.next()) : "default";
      } else this.modelName = "default";
    } else {
      if (a !== undefined) this.lastvbe = a;
      this.modelName = "default";
    }
    this.setup();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.pnp = xml.int("pn", this.pnp);
    this.beta = xml.double("be", this.beta);
    this.modelName = xml.string("mo", this.modelName) ?? this.modelName;
    this.lastvbe = xml.double("vbe", 0);
    this.lastvbc = xml.double("vbc", 0);
    this.volts[0] = 0;
    this.volts[1] = -this.lastvbe;
    this.volts[2] = -this.lastvbc;
    this.setup();
  }

  override dumpValues(): string {
    return ` ${this.pnp} ${this.volts[0] - this.volts[1]} ${this.volts[0] - this.volts[2]} ${this.beta} ${CircuitText.escape(this.modelName)}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["pn", String(this.pnp)], ["be", String(this.beta)], ["mo", this.modelName]);
  }

  override dumpXmlState(a: XmlAttrs): void {
    a.push(["vbe", String(this.volts[0] - this.volts[1])], ["vbc", String(this.volts[0] - this.volts[2])]);
  }

  setBeta(b: number): void {
    this.beta = b;
    this.setup();
  }

  setFlipped(flip: boolean): void {
    if (((this.flags & TransistorElm.FLAG_FLIP) !== 0) !== flip) this.flags ^= TransistorElm.FLAG_FLIP;
  }

  setup(): void {
    this.model = TransistorModel.getModelWithNameOrCopy(this.modelName, this.model);
    this.modelName = this.model.name;
    this.vcrit = vt * Math.log(vt / (Math.sqrt(2) * this.model.satCur));
    this.noDiagonal = true;
  }

  setModel(name: string): void {
    this.modelName = name;
    this.model = null;
    this.setup();
  }

  override nonLinear(): boolean {
    return true;
  }

  override reset(): void {
    this.volts[0] = this.volts[1] = this.volts[2] = 0;
    this.lastvbc = this.lastvbe = this.curcount = 0;
    this.capVoltBE = this.capVoltBC = this.capCurBE = this.capCurBC = 0;
    this.geqBE = this.geqBC = this.ceqBE = this.ceqBC = 0;
    this.badIters = 0;
    this.localSubIters = 0;
  }

  get hasCircle(): boolean {
    return (this.flags & TransistorElm.FLAG_CIRCLE) !== 0;
  }

  override getPost(n: number): GridPoint {
    return n === 0 ? this.point1 : n === 1 ? this.coll[0] : this.emit[0];
  }
  override getPostCount(): number {
    return 3;
  }
  override getPower(): number {
    return (this.volts[0] - this.volts[2]) * this.ib + (this.volts[1] - this.volts[2]) * this.ic;
  }

  override setPoints(): void {
    super.setPoints();
    const hs = 16;
    if ((this.flags & TransistorElm.FLAG_FLIP) !== 0) this.dsign = -this.dsign;
    const hs2 = hs * this.dsign * this.pnp;
    const p1 = this.point1, p2 = this.point2, dn = this.dn;
    this.coll = [interpPointPerp(p1, p2, 1, hs2), interpPointPerp(p1, p2, 1 - 13 / dn, 6 * this.dsign * this.pnp)];
    this.emit = [interpPointPerp(p1, p2, 1, -hs2), interpPointPerp(p1, p2, 1 - 13 / dn, -6 * this.dsign * this.pnp)];
    this.rect = [interpPointPerp(p1, p2, 1 - 16 / dn, hs), interpPointPerp(p1, p2, 1 - 16 / dn, -hs), interpPointPerp(p1, p2, 1 - 13 / dn, hs), interpPointPerp(p1, p2, 1 - 13 / dn, -hs)];
    this.base = interpPoint(p1, p2, 1 - 16 / dn);
  }

  limitStep(vnew: number, vold: number): number {
    if (vnew > this.vcrit && Math.abs(vnew - vold) > vt + vt) {
      if (vold > 0) {
        const arg = 1 + (vnew - vold) / vt;
        vnew = arg > 0 ? vold + vt * Math.log(arg) : this.vcrit;
      } else vnew = vt * Math.log(vnew / vt);
      this.sim.converged = false;
    }
    return vnew;
  }

  static calcJunctionCap(vj: number, cj0: number, vj0: number, mj: number): number {
    if (cj0 <= 0) return 0;
    const fc = 0.5;
    if (vj < fc * vj0) return cj0 / Math.pow(1 - vj / vj0, mj);
    return (cj0 / Math.pow(1 - fc, 1 + mj)) * (1 - fc * (1 + mj) + (mj * vj) / vj0);
  }

  override startIteration(): void {
    const m = this.model!, sim = this.sim;
    const hasBEcap = m.junctionCapBE > 0 || m.transitTimeF > 0;
    const hasBCcap = m.junctionCapBC > 0 || m.transitTimeR > 0;
    if (hasBEcap && sim.timeStep > 0) {
      const vjBE = this.pnp * this.capVoltBE;
      let cje = TransistorElm.calcJunctionCap(vjBE, m.junctionCapBE, m.junctionPotBE, m.junctionExpBE);
      if (m.transitTimeF > 0 && vjBE > 0) {
        const vtn = vt * m.emissionCoeffF;
        cje += (m.transitTimeF * m.satCur * Math.exp(vjBE / vtn)) / vtn;
      }
      this.geqBE = (2 * cje) / sim.timeStep;
      if (this.geqBE < 1e-20) this.geqBE = this.ceqBE = this.capCurBE = 0;
      else this.ceqBE = -this.geqBE * this.capVoltBE - this.capCurBE;
    }
    if (hasBCcap && sim.timeStep > 0) {
      const vjBC = this.pnp * this.capVoltBC;
      let cjc = TransistorElm.calcJunctionCap(vjBC, m.junctionCapBC, m.junctionPotBC, m.junctionExpBC);
      if (m.transitTimeR > 0 && vjBC > 0) cjc += (m.transitTimeR * m.satCur * Math.exp(vjBC / (vt * m.emissionCoeffR))) / (vt * m.emissionCoeffR);
      this.geqBC = (2 * cjc) / sim.timeStep;
      if (this.geqBC < 1e-20) this.geqBC = this.ceqBC = this.capCurBC = 0;
      else this.ceqBC = -this.geqBC * this.capVoltBC - this.capCurBC;
    }
  }

  override doStep(): void {
    const sim = this.sim, m = this.model!, nodes = this.nodes, volts = this.volts, pnp = this.pnp;
    let vbc = pnp * (volts[0] - volts[1]); // typically negative
    let vbe = pnp * (volts[0] - volts[2]); // typically positive
    const notConverged = Math.abs(vbc - this.lastvbc) > 0.01 || Math.abs(vbe - this.lastvbe) > 0.01;
    if (notConverged) sim.converged = false;
    if (notConverged) this.localSubIters++;
    else this.localSubIters = 0;
    // to prevent a possible singular matrix, put a tiny conductance in parallel with each P-N junction
    let gmin = 1e-12;
    // if we're having trouble converging, gradually increase it (but give up after a few bad steps)
    if (this.localSubIters > 100 && this.badIters < 5) {
      gmin = Math.exp(-9 * Math.log(10) * (1 - this.localSubIters / 300));
      if (gmin > 0.1) gmin = 0.1;
    }
    this.gmin = gmin;
    vbc = this.limitStep(vbc, this.lastvbc);
    vbe = this.limitStep(vbe, this.lastvbe);
    this.lastvbc = vbc;
    this.lastvbe = vbe;

    const csat = m.satCur, oik = m.invRollOffF, c2 = m.BEleakCur, vte = m.leakBEemissionCoeff * vt;
    const oikr = m.invRollOffR, c4 = m.BCleakCur, vtc = m.leakBCemissionCoeff * vt;
    let vtn = vt * m.emissionCoeffF;
    let cbe: number, gbe: number, cben: number, gben: number, cbc: number, gbc: number, cbcn: number, gbcn: number;
    if (vbe > -5 * vtn) {
      const evbe = Math.exp(vbe / vtn);
      cbe = csat * (evbe - 1) + gmin * vbe;
      gbe = (csat * evbe) / vtn + gmin;
      if (c2 === 0) {
        cben = 0;
        gben = 0;
      } else {
        const evben = Math.exp(vbe / vte);
        cben = c2 * (evben - 1);
        gben = (c2 * evben) / vte;
      }
    } else {
      gbe = -csat / vbe + gmin;
      cbe = gbe * vbe;
      gben = -c2 / vbe;
      cben = gben * vbe;
    }
    vtn = vt * m.emissionCoeffR;
    if (vbc > -5 * vtn) {
      const evbc = Math.exp(vbc / vtn);
      cbc = csat * (evbc - 1) + gmin * vbc;
      gbc = (csat * evbc) / vtn + gmin;
      if (c4 === 0) {
        cbcn = 0;
        gbcn = 0;
      } else {
        const evbcn = Math.exp(vbc / vtc);
        cbcn = c4 * (evbcn - 1);
        gbcn = (c4 * evbcn) / vtc;
      }
    } else {
      gbc = -csat / vbc + gmin;
      cbc = gbc * vbc;
      gbcn = -c4 / vbc;
      cbcn = gbcn * vbc;
    }
    // determine base charge terms
    const q1 = 1 / (1 - m.invEarlyVoltF * vbc - m.invEarlyVoltR * vbe);
    let qb: number, dqbdve: number, dqbdvc: number;
    if (oik === 0 && oikr === 0) {
      qb = q1;
      dqbdve = q1 * qb * m.invEarlyVoltR;
      dqbdvc = q1 * qb * m.invEarlyVoltF;
    } else {
      const q2 = oik * cbe + oikr * cbc;
      const arg = Math.max(0, 1 + 4 * q2);
      let sqarg = 1;
      if (arg !== 0) sqarg = Math.sqrt(arg);
      qb = (q1 * (1 + sqarg)) / 2;
      dqbdve = q1 * (qb * m.invEarlyVoltR + (oik * gbe) / sqarg);
      dqbdvc = q1 * (qb * m.invEarlyVoltF + (oikr * gbc) / sqarg);
    }
    // determine dc incremental conductances
    let cc = 0;
    const cex = cbe, gex = gbe;
    cc = cc + (cex - cbc) / qb - cbc / m.betaR - cbcn;
    const cb = cbe / this.beta + cben + cbc / m.betaR + cbcn;
    this.ic = pnp * cc;
    this.ib = pnp * cb;
    this.ie = pnp * (-cc - cb);
    const gpi = gbe / this.beta + gben;
    const gmu = gbc / m.betaR + gbcn;
    const go = (gbc + ((cex - cbc) * dqbdvc) / qb) / qb;
    const gm = (gex - ((cex - cbc) * dqbdve) / qb) / qb - go;
    const ceqbe = pnp * (cc + cb - vbe * (gm + go + gpi) + vbc * go);
    const ceqbc = pnp * (-cc + vbe * (gm + go) - vbc * (gmu + go));
    if (!Number.isFinite(this.ib) || Number.isNaN(this.ic)) sim.stop("infinite transistor current", this);
    const [n0, n1, n2] = [nodes[0]!, nodes[1]!, nodes[2]!];
    sim.stampMatrix(n1, n1, gmu + go);
    sim.stampMatrix(n1, n0, -gmu + gm);
    sim.stampMatrix(n1, n2, -gm - go);
    sim.stampMatrix(n0, n0, gpi + gmu);
    sim.stampMatrix(n0, n2, -gpi);
    sim.stampMatrix(n0, n1, -gmu);
    sim.stampMatrix(n2, n0, -gpi - gm);
    sim.stampMatrix(n2, n1, -go);
    sim.stampMatrix(n2, n2, gpi + gm + go);
    sim.stampRightSide(n0, -ceqbe - ceqbc);
    sim.stampRightSide(n1, ceqbc);
    sim.stampRightSide(n2, ceqbe);
    // junction capacitance companion models (trapezoidal)
    if (this.geqBE > 0) {
      sim.stampMatrix(n0, n0, this.geqBE);
      sim.stampMatrix(n2, n2, this.geqBE);
      sim.stampMatrix(n0, n2, -this.geqBE);
      sim.stampMatrix(n2, n0, -this.geqBE);
      sim.stampRightSide(n0, -this.ceqBE);
      sim.stampRightSide(n2, this.ceqBE);
    }
    if (this.geqBC > 0) {
      sim.stampMatrix(n0, n0, this.geqBC);
      sim.stampMatrix(n1, n1, this.geqBC);
      sim.stampMatrix(n0, n1, -this.geqBC);
      sim.stampMatrix(n1, n0, -this.geqBC);
      sim.stampRightSide(n0, -this.ceqBC);
      sim.stampRightSide(n1, this.ceqBC);
    }
  }

  override stepFinished(): void {
    if (Math.abs(this.ic) > 1e12 || Math.abs(this.ib) > 1e12) this.sim.stop("max current exceeded", this);
    if (this.localSubIters > 100) this.badIters++;
    else this.badIters = 0;
    const v = this.volts;
    if (this.geqBE > 0) {
      this.capVoltBE = v[0] - v[2];
      this.capCurBE = this.geqBE * this.capVoltBE + this.ceqBE;
    }
    if (this.geqBC > 0) {
      this.capVoltBC = v[0] - v[1];
      this.capCurBC = this.geqBC * this.capVoltBC + this.ceqBC;
    }
    if (this.geqBE > 0) {
      const icapBE = this.geqBE * (v[0] - v[2]) + this.ceqBE;
      this.ib += icapBE;
      this.ie -= icapBE;
    }
    if (this.geqBC > 0) {
      const icapBC = this.geqBC * (v[0] - v[1]) + this.ceqBC;
      this.ib += icapBC;
      this.ic -= icapBC;
    }
    this.localSubIters = 0;
  }

  /** Scope values (Scope.VAL_IB … VAL_VCE). */
  override getScopeValue(x: number): number {
    const v = this.volts;
    switch (x) {
      case 1: return this.ib;
      case 2: return this.ic;
      case 3: return this.ie;
      case 4: return v[0] - v[2];
      case 5: return v[0] - v[1];
      case 6: return v[1] - v[2];
      case 7: return this.getPower();
      default: return 0;
    }
  }

  override getCurrent(): number {
    return this.ic;
  }
  override getVoltageDiff(): number {
    return this.volts[1] - this.volts[2];
  }

  override getCurrentIntoNode(n: number): number {
    return n === 0 ? -this.ib : n === 1 ? -this.ic : -this.ie;
  }
}

export class NTransistorElm extends TransistorElm {
  override initNew(): void {
    this.initNewPolarity(false);
  }
}

export class PTransistorElm extends TransistorElm {
  override initNew(): void {
    this.initNewPolarity(true);
  }
}

export class LEDElm extends DiodeElm {
  static override dumpType = 162;
  static lastLEDModelName = "default-led";
  colorR = 1;
  colorG = 0;
  colorB = 0;
  maxBrightnessCurrent = 0.01;

  override initNew(): void {
    super.initNew();
    this.modelName = LEDElm.lastLEDModelName;
    this.setup();
    this.maxBrightnessCurrent = 0.01;
    this.colorR = 1;
    this.colorG = this.colorB = 0;
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    if ((this.flags & (DiodeElm.FLAG_MODEL | DiodeElm.FLAG_FWDROP)) === 0) {
      this.model = DiodeModel.getModelWithParameters(2.1024259, 0);
      this.modelName = this.model.name;
      this.setup();
    }
    this.colorR = st.nextDouble();
    this.colorG = st.nextDouble();
    this.colorB = st.nextDouble();
    this.maxBrightnessCurrent = st.tryDouble() ?? 0.01;
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.colorR = xml.double("cr", this.colorR);
    this.colorG = xml.double("cg", this.colorG);
    this.colorB = xml.double("cb", this.colorB);
    this.maxBrightnessCurrent = xml.double("mbc", this.maxBrightnessCurrent);
  }

  override dumpValues(): string {
    return `${super.dumpValues()} ${this.colorR} ${this.colorG} ${this.colorB} ${this.maxBrightnessCurrent}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["cr", String(this.colorR)], ["cg", String(this.colorG)], ["cb", String(this.colorB)], ["mbc", String(this.maxBrightnessCurrent)]);
  }

  /** Brightness 0–1 from the current (LEDElm.draw). */
  get brightness(): number {
    let w = this.current / this.maxBrightnessCurrent;
    if (w > 0) w = 255 * (1 + 0.2 * Math.log(w));
    return Math.max(0, Math.min(255, w)) / 255;
  }
}

/** Diode with a voltage-dependent junction capacitance. */
export class VaractorElm extends DiodeElm {
  static override dumpType = 176;
  baseCapacitance = 4e-12;
  capacitance = 0;
  capCurrent = 0;
  compResistance = 0;
  capvoltdiff = 0;
  voltSourceValue = 0;

  override initNew(): void {
    super.initNew();
    this.baseCapacitance = 4e-12;
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.capvoltdiff = st.nextDouble();
    this.baseCapacitance = st.nextDouble();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.capvoltdiff = xml.double("ca", this.capvoltdiff);
    this.baseCapacitance = xml.double("ba", this.baseCapacitance);
  }

  override dumpValues(): string {
    return `${super.dumpValues()} ${this.capvoltdiff} ${this.baseCapacitance}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["ca", String(this.capvoltdiff)], ["ba", String(this.baseCapacitance)]);
  }

  override stepFinished(): void {
    this.capvoltdiff = this.volts[0] - this.volts[1];
  }

  override calculateCurrent(): void {
    super.calculateCurrent();
    this.current += this.capCurrent;
  }

  override reset(): void {
    super.reset();
    this.capvoltdiff = 0;
  }

  override setVoltageSource(n: number, v: VoltageSource): void {
    super.setVoltageSource(n, v);
    v.setNodes(this.nodes[0]!, this.nodes[2]!);
  }

  override stamp(): void {
    super.stamp();
    this.sim.stampVoltageSource(this.nodes[0]!, this.nodes[2]!, this.voltSource!);
  }

  override startIteration(): void {
    super.startIteration();
    // capacitor companion model, trapezoidal
    const c0 = this.baseCapacitance;
    this.capacitance = this.capvoltdiff > 0 ? c0 : c0 / Math.pow(1 - this.capvoltdiff / this.model!.fwdrop, 0.5);
    this.compResistance = this.sim.timeStep / (2 * this.capacitance);
    this.voltSourceValue = -this.capvoltdiff - this.capCurrent * this.compResistance;
  }

  override doStep(): void {
    super.doStep();
    this.sim.stampResistor(this.nodes[2]!, this.nodes[1]!, this.compResistance);
    this.sim.updateVoltageSource(this.nodes[0]!, this.nodes[2]!, this.voltSource!, this.voltSourceValue);
  }

  override setCurrent(_vs: VoltageSource, c: number): void {
    this.capCurrent = c;
  }
  override getVoltageSourceCount(): number {
    return 1;
  }
  override getInternalNodeCount(): number {
    return 1;
  }
}

export class TunnelDiodeElm extends CircuitElm {
  static override dumpType = 175;
  static readonly pvp = 0.1;
  static readonly pip = 4.7e-3;
  static readonly pvv = 0.37;
  static readonly pvt = 0.026;
  static readonly pvpp = 0.525;
  static readonly piv = 370e-6;
  lastvoltdiff = 0;

  override nonLinear(): boolean {
    return true;
  }

  override setPoints(): void {
    super.setPoints();
    this.calcLeads(16);
  }

  override reset(): void {
    this.lastvoltdiff = this.volts[0] = this.volts[1] = this.curcount = 0;
  }

  limitStep(vnew: number, vold: number): number {
    // Limit each Newton iteration to a 1 V change.
    if (vnew > vold + 1) return vold + 1;
    if (vnew < vold - 1) return vold - 1;
    return vnew;
  }

  override doStep(): void {
    const T = TunnelDiodeElm, sim = this.sim;
    let voltdiff = this.volts[0] - this.volts[1];
    if (Math.abs(voltdiff - this.lastvoltdiff) > 0.01) sim.converged = false;
    voltdiff = this.limitStep(voltdiff, this.lastvoltdiff);
    this.lastvoltdiff = voltdiff;
    const i0 = T.piv * Math.exp(-T.pvv);
    const i = T.pip * Math.exp(-T.pvpp / T.pvt) * (Math.exp(voltdiff / T.pvt) - 1) + T.pip * (voltdiff / T.pvp) * Math.exp(1 - voltdiff / T.pvp) +
      T.piv * Math.exp(voltdiff - T.pvv) - i0;
    const geq = (T.pip * Math.exp(-T.pvpp / T.pvt) * Math.exp(voltdiff / T.pvt)) / T.pvt + (T.pip * Math.exp(1 - voltdiff / T.pvp)) / T.pvp -
      (Math.exp(1 - voltdiff / T.pvp) * T.pip * voltdiff) / (T.pvp * T.pvp) + Math.exp(voltdiff - T.pvv) * T.piv;
    const nc = i - geq * voltdiff;
    sim.stampConductance(this.nodes[0]!, this.nodes[1]!, geq);
    sim.stampCurrentSource(this.nodes[0]!, this.nodes[1]!, nc);
  }

  override calculateCurrent(): void {
    const T = TunnelDiodeElm;
    const voltdiff = this.volts[0] - this.volts[1];
    const i0 = T.piv * Math.exp(-T.pvv);
    this.current = T.pip * Math.exp(-T.pvpp / T.pvt) * (Math.exp(voltdiff / T.pvt) - 1) + T.pip * (voltdiff / T.pvp) * Math.exp(1 - voltdiff / T.pvp) +
      T.piv * Math.exp(voltdiff - T.pvv) - i0;
  }
}

export class JfetElm extends MosfetElm {
  static override dumpType = ch("j");
  static lastJfetModelName = "default-jfet";
  diode = new Diode(this);
  gateCurrent = 0;
  gatePt: GridPoint = pt(0, 0);

  override isJfet(): boolean {
    return true;
  }
  override getLastModelName(): string {
    return JfetElm.lastJfetModelName;
  }
  override getDefaultThreshold(): number {
    return -4;
  }
  override getBackwardCompatibilityBeta(): number {
    return 0.00125;
  }
  override showBulk(): boolean {
    return false;
  }

  override initNewPolarity(pnpflag: boolean): void {
    super.initNewPolarity(pnpflag);
    this.noDiagonal = true;
    this.diode.setupForDefaultModel();
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.noDiagonal = true;
    this.diode.setupForDefaultModel();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.diode.setupForDefaultModel();
  }

  override reset(): void {
    super.reset();
    this.diode.reset();
  }

  override getCurrentIntoNode(n: number): number {
    if (n === 0) return -this.gateCurrent;
    if (n === 1) return this.gateCurrent + this.ids;
    return -this.ids;
  }

  override setPoints(): void {
    super.setPoints();
    let hs2 = MosfetElm.hs * this.dsign;
    if ((this.flags & MosfetElm.FLAG_FLIP) !== 0) hs2 = -hs2;
    const p1 = this.point1, p2 = this.point2, dn = this.dn;
    const half = Math.trunc(-hs2 / 2);
    this.src = [interpPointPerp(p1, p2, 1, -hs2), interpPointPerp(p1, p2, 1, half), interpPointPerp(p1, p2, 1 - 10 / dn, half)];
    this.drn = [interpPointPerp(p1, p2, 1, hs2), interpPointPerp(p1, p2, 1, -half), interpPointPerp(p1, p2, 1 - 10 / dn, -half)];
    this.gatePt = interpPoint(p1, p2, 1 - 14 / dn);
  }

  override stamp(): void {
    super.stamp();
    if (this.pnp < 0) this.diode.stamp(this.nodes[1]!, this.nodes[0]!);
    else this.diode.stamp(this.nodes[0]!, this.nodes[1]!);
  }

  override doStep(): void {
    super.doStep();
    this.diode.doStep(this.pnp * (this.volts[0] - this.volts[1]));
  }

  override calculateCurrent(): void {
    this.gateCurrent = this.pnp * this.diode.calculateCurrent(this.pnp * (this.volts[0] - this.volts[1]));
  }

  override getConnection(): boolean {
    return true;
  }
}

export class NJfetElm extends JfetElm {
  override initNew(): void {
    this.initNewPolarity(false);
  }
}

export class PJfetElm extends JfetElm {
  override initNew(): void {
    this.initNewPolarity(true);
  }
}

/** Shared lead geometry for SCRs and triacs: a gate lead bent off the cathode end. */
function gateLeads(e: CircuitElm, fixDn: boolean): { dir: number; gate: GridPoint[] | null } {
  let dir: number;
  if (Math.abs(e.dx) > Math.abs(e.dy)) {
    dir = -sign(e.dx) * sign(e.dy);
    if (fixDn) e.dn = Math.abs(e.dx);
    e.point2 = pt(e.point2.x, e.point1.y);
  } else {
    dir = sign(e.dy) * sign(e.dx);
    if (fixDn) e.dn = Math.abs(e.dy);
    e.point2 = pt(e.point1.x, e.point2.y);
  }
  if (dir === 0) dir = 1;
  dir *= e.geometryFlip;
  e.calcLeads(16);
  const leadlen = (e.dn - 16) / 2;
  let gatelen = grid.size;
  gatelen += leadlen % grid.size;
  if (leadlen < gatelen) return { dir, gate: null };
  const g0 = interpPointPerp(e.lead2!, e.point2, gatelen / leadlen, gatelen * dir);
  const g1 = interpPointPerp(e.lead2!, e.point2, gatelen / leadlen, grid.size * 2 * dir);
  return { dir, gate: [g0, pt(snapGrid(g1.x), snapGrid(g1.y))] };
}

export class SCRElm extends CircuitElm {
  static override dumpType = 177;
  static readonly FLAG_GATE_FIX = 1;
  static readonly anode = 0;
  static readonly cnode = 1;
  static readonly gnode = 2;
  static readonly inode = 3;
  diode = new Diode(this);
  dir = 1;
  gate: GridPoint[] = [];
  ia = 0;
  ic = 0;
  ig = 0;
  lastvac = 0;
  lastvag = 0;
  gresistance = 50;
  triggerI = 0.01;
  holdingI = 0.0082;
  aresistance = 1;

  override initNew(): void {
    this.setDefaults();
    this.flags |= SCRElm.FLAG_GATE_FIX;
    this.setup();
  }

  override readTokens(st: TokenStream): void {
    this.setDefaults();
    const vals: number[] = [];
    for (let i = 0; i < 5; i++) {
      const v = st.tryDouble();
      if (v === undefined) break;
      vals.push(v);
    }
    if (vals.length >= 2) {
      this.lastvac = vals[0];
      this.lastvag = vals[1];
      this.volts[0] = 0;
      this.volts[1] = -this.lastvac;
      this.volts[2] = -this.lastvag;
    } else if (vals.length === 1) this.lastvac = vals[0];
    if (vals.length >= 3) this.triggerI = vals[2];
    if (vals.length >= 4) this.holdingI = vals[3];
    if (vals.length >= 5) this.gresistance = vals[4];
    this.setup();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.triggerI = xml.double("tr", this.triggerI);
    this.holdingI = xml.double("ho", this.holdingI);
    this.gresistance = xml.double("gr", this.gresistance);
    this.setup();
  }

  override dumpValues(): string {
    const v = this.volts;
    return ` ${v[0] - v[1]} ${v[0] - v[2]} ${this.triggerI} ${this.holdingI} ${this.gresistance}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["tr", String(this.triggerI)], ["ho", String(this.holdingI)], ["gr", String(this.gresistance)]);
  }

  setDefaults(): void {
    this.gresistance = 50;
    this.holdingI = 0.0082;
    this.triggerI = 0.01;
  }

  setup(): void {
    this.diode.setupForDefaultModel();
    this.aresistance = 1; // to avoid divide by zero
  }

  override nonLinear(): boolean {
    return true;
  }

  override reset(): void {
    this.volts[0] = this.volts[1] = this.volts[2] = 0;
    this.diode.reset();
    this.lastvag = this.lastvac = this.curcount = 0;
  }

  override setPoints(): void {
    super.setPoints();
    const r = gateLeads(this, (this.flags & SCRElm.FLAG_GATE_FIX) !== 0);
    this.dir = r.dir;
    this.gate = r.gate ?? [this.point2, this.point2];
  }

  override getCurrentIntoNode(n: number): number {
    return n === 0 ? -this.ia : n === 1 ? -this.ic : -this.ig;
  }

  override getPost(n: number): GridPoint {
    return n === 0 ? this.point1 : n === 1 ? this.point2 : this.gate[1];
  }
  override getPostCount(): number {
    return 3;
  }
  override getInternalNodeCount(): number {
    return 1;
  }
  override getPower(): number {
    const v = this.volts;
    return (v[0] - v[2]) * this.ia + (v[1] - v[2]) * this.ic;
  }

  override stamp(): void {
    const nd = this.nodes;
    this.sim.stampResistor(nd[2]!, nd[1]!, this.gresistance);
    this.diode.stamp(nd[3]!, nd[1]!);
  }

  override doStep(): void {
    const v = this.volts, sim = this.sim;
    const vac = v[0] - v[1], vag = v[0] - v[2];
    if (Math.abs(vac - this.lastvac) > 0.01 || Math.abs(vag - this.lastvag) > 0.01) sim.converged = false;
    this.lastvac = vac;
    this.lastvag = vag;
    this.diode.doStep(v[3] - v[1]);
    const icmult = 1 / this.triggerI;
    const iamult = 1 / this.holdingI - icmult;
    this.aresistance = -icmult * this.ic + this.ia * iamult > 1 ? 0.0105 : 10e5;
    sim.stampResistor(this.nodes[0]!, this.nodes[3]!, this.aresistance);
  }

  override calculateCurrent(): void {
    const v = this.volts;
    this.ig = (v[2] - v[1]) / this.gresistance;
    this.ia = (v[0] - v[3]) / this.aresistance;
    this.ic = -this.ig - this.ia;
  }

  override getCurrent(): number {
    return this.ia;
  }
}

export class TriacElm extends CircuitElm {
  static override dumpType = 206;
  diode03 = new Diode(this);
  diode30 = new Diode(this);
  state = false;
  gate: GridPoint[] = [];
  i1 = 0;
  i2 = 0;
  ig = 0;
  cresistance = 100;
  triggerI = 0.01;
  holdingI = 0.0082;
  aresistance = 0;

  override initNew(): void {
    this.setDefaults();
    this.setup();
  }

  override readTokens(st: TokenStream): void {
    this.setDefaults();
    this.triggerI = st.nextDouble();
    this.holdingI = st.nextDouble();
    this.cresistance = st.nextDouble();
    this.state = st.nextBool();
    this.setup();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.triggerI = xml.double("ti", this.triggerI);
    this.holdingI = xml.double("hi", this.holdingI);
    this.cresistance = xml.double("cr", this.cresistance);
    this.state = xml.bool("st", this.state);
    this.setup();
  }

  override dumpValues(): string {
    return ` ${this.triggerI} ${this.holdingI} ${this.cresistance} ${this.state}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["ti", String(this.triggerI)], ["hi", String(this.holdingI)], ["cr", String(this.cresistance)]);
  }

  override dumpXmlState(a: XmlAttrs): void {
    a.push(["st", String(this.state)]);
  }

  setDefaults(): void {
    this.holdingI = 0.0082;
    this.triggerI = 0.01;
    this.cresistance = 100;
  }

  setup(): void {
    this.diode03.setupForDefaultModel();
    this.diode30.setupForDefaultModel();
  }

  override nonLinear(): boolean {
    return true;
  }

  override reset(): void {
    this.volts[0] = this.volts[1] = this.volts[2] = 0;
    this.diode03.reset();
    this.diode30.reset();
    this.curcount = 0;
  }

  override setPoints(): void {
    super.setPoints();
    this.gate = gateLeads(this, true).gate ?? [this.point2, this.point2];
  }

  override getPost(n: number): GridPoint {
    return n === 0 ? this.point1 : n === 1 ? this.point2 : this.gate[1];
  }
  override getCurrentIntoNode(n: number): number {
    return n === 0 ? -this.i2 : n === 1 ? -this.i1 : -this.ig;
  }
  override getPostCount(): number {
    return 3;
  }
  override getInternalNodeCount(): number {
    return 1;
  }

  // mt2 = node 0, mt1 = node 1, gate = node 2, internal = node 3
  override stamp(): void {
    const nd = this.nodes;
    this.sim.stampResistor(nd[2]!, nd[1]!, this.cresistance);
    this.diode03.stamp(nd[0]!, nd[3]!);
    this.diode30.stamp(nd[3]!, nd[0]!);
  }

  override startIteration(): void {
    if (Math.abs(this.i2) < this.holdingI) this.state = false;
    if (Math.abs(this.ig) > this.triggerI) this.state = true;
    this.aresistance = this.state ? 0.01 : 10e5;
  }

  override doStep(): void {
    const v = this.volts;
    this.diode03.doStep(v[0] - v[3]);
    this.diode30.doStep(v[3] - v[0]);
    this.sim.stampResistor(this.nodes[3]!, this.nodes[1]!, this.aresistance);
  }

  override calculateCurrent(): void {
    const v = this.volts;
    this.i2 = this.aresistance === 0 ? 0 : (v[3] - v[1]) / this.aresistance;
    this.ig = -(v[1] - v[2]) / this.cresistance;
    this.i1 = -this.i2 - this.ig;
  }

  override getPower(): number {
    const v = this.volts;
    return (v[0] - v[1]) * this.i2 + (v[2] - v[1]) * this.ig;
  }
  override getVoltageDiff(): number {
    return this.volts[0] - this.volts[1];
  }
  override getCurrent(): number {
    return this.i2;
  }
}

export class DiacElm extends CircuitElm {
  static override dumpType = 203;
  onresistance = 500;
  offresistance = 1e8;
  breakdown = 30;
  holdcurrent = 0.01;
  state = false;
  diode1 = new Diode(this);
  diode2 = new Diode(this);

  override initNew(): void {
    this.offresistance = 1e8;
    this.onresistance = 500;
    this.breakdown = 30;
    this.holdcurrent = 0.01;
    this.state = false;
    this.createDiodes();
  }

  override readTokens(st: TokenStream): void {
    this.onresistance = st.nextDouble();
    this.offresistance = st.nextDouble();
    this.breakdown = st.nextDouble();
    this.holdcurrent = st.nextDouble();
    this.createDiodes();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.onresistance = xml.double("ron", this.onresistance);
    this.offresistance = xml.double("roff", this.offresistance);
    this.breakdown = xml.double("bd", this.breakdown);
    this.holdcurrent = xml.double("hc", this.holdcurrent);
    this.createDiodes();
  }

  override dumpValues(): string {
    return ` ${this.onresistance} ${this.offresistance} ${this.breakdown} ${this.holdcurrent}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["ron", String(this.onresistance)], ["roff", String(this.offresistance)], ["bd", String(this.breakdown)], ["hc", String(this.holdcurrent)]);
  }

  createDiodes(): void {
    this.diode1.setupForDefaultModel();
    this.diode2.setupForDefaultModel();
  }

  override nonLinear(): boolean {
    return true;
  }

  override setPoints(): void {
    super.setPoints();
    this.calcLeads(16);
  }

  override calculateCurrent(): void {
    const r = this.state ? this.onresistance : this.offresistance;
    this.current = (this.volts[0] - this.volts[2]) / r + (this.volts[0] - this.volts[3]) / r;
  }

  override startIteration(): void {
    const vd = this.volts[0] - this.volts[1];
    if (Math.abs(this.current) < this.holdcurrent) this.state = false;
    if (Math.abs(vd) > this.breakdown) this.state = true;
  }

  override doStep(): void {
    const r = this.state ? this.onresistance : this.offresistance, nd = this.nodes, v = this.volts;
    this.sim.stampResistor(nd[0]!, nd[2]!, r);
    this.sim.stampResistor(nd[0]!, nd[3]!, r);
    this.diode1.doStep(v[2] - v[1]);
    this.diode2.doStep(v[1] - v[3]);
  }

  override stamp(): void {
    const nd = this.nodes;
    this.diode1.stamp(nd[2]!, nd[1]!);
    this.diode2.stamp(nd[1]!, nd[3]!);
  }

  override getInternalNodeCount(): number {
    return 2;
  }
}

export class TriodeElm extends CircuitElm {
  static override dumpType = 173;
  static readonly FLAG_FLIP = 1;
  static readonly FLAG_DSIGN_FIX = 2;
  static readonly gridCurrentR = 6000;
  mu = 93;
  kg1 = 680;
  currentp = 0;
  currentg = 0;
  currentc = 0;
  lastv0 = 0;
  lastv1 = 0;
  lastv2 = 0;
  plate: GridPoint[] = [];
  grid: GridPoint[] = [];
  cath: GridPoint[] = [];

  override initNew(): void {
    this.mu = 93;
    this.kg1 = 680;
    this.flags |= TriodeElm.FLAG_DSIGN_FIX;
    this.noDiagonal = true;
  }

  override readTokens(st: TokenStream): void {
    this.mu = st.nextDouble();
    this.kg1 = st.nextDouble();
    this.noDiagonal = true;
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.mu = xml.double("mu", this.mu);
    this.kg1 = xml.double("kg", this.kg1);
    this.noDiagonal = true;
  }

  override dumpValues(): string {
    return ` ${this.mu} ${this.kg1}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["mu", String(this.mu)], ["kg", String(this.kg1)]);
  }

  override nonLinear(): boolean {
    return true;
  }

  override reset(): void {
    this.volts[0] = this.volts[1] = this.volts[2] = 0;
    this.curcount = 0;
  }

  override setPoints(): void {
    super.setPoints();
    let s = (this.flags & TriodeElm.FLAG_DSIGN_FIX) !== 0 ? this.dsign : 1;
    if ((this.flags & TriodeElm.FLAG_FLIP) !== 0) s = -s;
    const p1 = this.point1, p2 = this.point2, dn = this.dn;
    const nearw = 8 * s, farw = 32 * s, platew = 18, circler = 24, cathw = 16 * s;
    const plate1 = interpPointPerp(p1, p2, 1, nearw);
    this.plate = [interpPointPerp(p1, p2, 1, farw), plate1, interpPointPerp(p2, plate1, 1, platew), interpPointPerp(p2, plate1, 1, -platew)];
    const g1 = interpPointPerp(p1, p2, (dn - circler) / dn, 0);
    this.grid = [p1, g1];
    for (let i = 0; i !== 3; i++) {
      this.grid[2 + i * 2] = interpPointPerp(g1, p2, (i * 3 + 1) / 4.5, 0);
      this.grid[3 + i * 2] = interpPointPerp(g1, p2, (i * 3 + 2) / 4.5, 0);
    }
    this.cath = [interpPointPerp(p2, plate1, -farw / nearw, cathw), interpPointPerp(p2, plate1, -1, cathw), interpPointPerp(p2, plate1, -1, -cathw),
      interpPointPerp(p2, plate1, -1.2, -cathw)];
  }

  override getCurrentIntoNode(n: number): number {
    if (n === 2) return this.currentc;
    if (n === 0) return -this.currentp;
    return -this.currentg;
  }

  override getPost(n: number): GridPoint {
    return n === 0 ? this.plate[0] : n === 1 ? this.grid[0] : this.cath[0];
  }
  override getPostCount(): number {
    return 3;
  }
  override getPower(): number {
    const v = this.volts;
    return (v[0] - v[2]) * this.currentc + (v[1] - v[2]) * this.currentg;
  }
  override getCurrent(): number {
    return this.currentc;
  }

  override doStep(): void {
    const sim = this.sim, nd = this.nodes;
    const vs = [this.volts[0], this.volts[1], this.volts[2]];
    if (vs[1] > this.lastv1 + 0.5) vs[1] = this.lastv1 + 0.5;
    if (vs[1] < this.lastv1 - 0.5) vs[1] = this.lastv1 - 0.5;
    if (vs[2] > this.lastv2 + 0.5) vs[2] = this.lastv2 + 0.5;
    if (vs[2] < this.lastv2 - 0.5) vs[2] = this.lastv2 - 0.5;
    const vgk = vs[1] - vs[2], vpk = vs[0] - vs[2];
    if (Math.abs(this.lastv0 - vs[0]) > 0.01 || Math.abs(this.lastv1 - vs[1]) > 0.01 || Math.abs(this.lastv2 - vs[2]) > 0.01) sim.converged = false;
    this.lastv0 = vs[0];
    this.lastv1 = vs[1];
    this.lastv2 = vs[2];
    let ids = 0, gm = 0, Gds = 0;
    const ival = vgk + vpk / this.mu;
    this.currentg = 0;
    if (vgk > 0.01) {
      sim.stampResistor(nd[1]!, nd[2]!, TriodeElm.gridCurrentR);
      this.currentg = vgk / TriodeElm.gridCurrentR;
    } else sim.stampResistor(nd[1]!, nd[2]!, 1e8); // avoid singular matrix
    if (ival < 0) {
      // should be all zero, but that causes a singular matrix, so instead we treat it as a large resistor
      Gds = 1e-8;
      ids = vpk * Gds;
    } else {
      ids = Math.pow(ival, 1.5) / this.kg1;
      const q = (1.5 * Math.sqrt(ival)) / this.kg1;
      // gm = dids/dgk; Gds = dids/dpk
      Gds = q;
      gm = q / this.mu;
    }
    this.currentp = ids;
    this.currentc = ids + this.currentg;
    const rs = -ids + Gds * vpk + gm * vgk;
    const [np, ng, nc] = [nd[0]!, nd[1]!, nd[2]!];
    sim.stampMatrix(np, np, Gds);
    sim.stampMatrix(np, nc, -Gds - gm);
    sim.stampMatrix(np, ng, gm);
    sim.stampMatrix(nc, np, -Gds);
    sim.stampMatrix(nc, nc, Gds + gm);
    sim.stampMatrix(nc, ng, -gm);
    sim.stampRightSide(np, rs);
    sim.stampRightSide(nc, -rs);
  }

  override getConnection(n1: number, n2: number): boolean {
    return !(n1 === 1 || n2 === 1);
  }
  override getMatrixConnection(): boolean {
    return true;
  }
  override getVoltageDiff(): number {
    return this.volts[0] - this.volts[2];
  }
}
