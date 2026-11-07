// Ported from CircuitJS1 (DarlingtonElm.java, UnijunctionElm.java, CrystalElm.java, OTAElm.java,
// NortonAmpElm.java) by Paul Falstad and Iain Sharp.
// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Licensed under the GNU General Public License v2 or later. See LICENSE.
//
// Parts built from other parts with a fixed model (see CompositeElm).

import type { XmlAttrs } from "../core/elm";
import { type GridPoint, grid, interpPoint, interpPointPerp, pt } from "../core/geometry";
import { parseXml, TokenStream, type XmlNode } from "../io/tokens";
import type { ResistorElm } from "./basic";
import { CompositeElm } from "./composite";
import type { CapacitorElm, InductorElm } from "./reactive";
import type { TransistorElm } from "./semis";
import type { RailElm } from "./sources";

/** Two NPN (or PNP) transistors in a Darlington pair; posts are base, collector, emitter. */
export class DarlingtonElm extends CompositeElm {
  static override dumpType = 400;
  static override get xmlTag(): string {
    return "dar";
  }
  static readonly modelString = "NTransistorElm 1 2 4\rNTransistorElm 4 2 3";
  static readonly modelExternalNodes = [1, 2, 3];
  /** Whether newly placed parts are PNP (the NDarlingtonElm / PDarlingtonElm subclasses). */
  static isPnp = false;
  pnp = 1;
  coll: GridPoint[] = [];
  emit: GridPoint[] = [];
  base: GridPoint = pt(0, 0);

  override initNew(): void {
    this.initComposite(null, DarlingtonElm.modelString, DarlingtonElm.modelExternalNodes);
    this.pnp = (this.constructor as typeof DarlingtonElm).isPnp ? -1 : 1;
    this.applyPnp();
    this.noDiagonal = true;
  }

  override readTokens(st: TokenStream): void {
    this.initComposite(st, DarlingtonElm.modelString, DarlingtonElm.modelExternalNodes);
    this.pnp = st.nextInt();
    this.noDiagonal = true;
  }

  private applyPnp(): void {
    (this.compElmList[0] as TransistorElm).pnp = this.pnp;
    (this.compElmList[1] as TransistorElm).pnp = this.pnp;
  }

  override dumpValues(): string {
    return super.dumpValues() + " " + this.pnp;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["pnp", String(this.pnp)]);
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.pnp = xml.int("pnp", this.pnp);
    this.applyPnp();
  }

  override setPoints(): void {
    super.setPoints();
    this.dsign *= this.geometryFlip;
    const hs2 = 16 * this.dsign * this.pnp;
    const p1 = this.point1, p2 = this.point2;
    // collector and emitter posts
    this.coll = [interpPointPerp(p1, p2, 1, hs2), interpPointPerp(p1, p2, 1 - 13 / this.dn, 6 * this.dsign * this.pnp)];
    this.emit = [interpPointPerp(p1, p2, 1, -hs2), interpPointPerp(p1, p2, 1 - 13 / this.dn, -6 * this.dsign * this.pnp)];
    // where the base lead meets the bar
    this.base = interpPoint(p1, p2, 1 - 16 / this.dn);
    this.setPost(0, p1);
    this.setPost(1, this.coll[0]);
    this.setPost(2, this.emit[0]);
  }
}

export class NDarlingtonElm extends DarlingtonElm {}
export class PDarlingtonElm extends DarlingtonElm {
  static override isPnp = true;
}

/** Unijunction transistor (2N2646-like); posts are emitter, B1, B2. */
export class UnijunctionElm extends CompositeElm {
  static override dumpType = 417;
  static readonly FLAG_FLIP = 2;
  static readonly modelString =
    "DiodeElm 1 4\rVoltageElm 4 5\rCCVSElm 4 5 6 0\rResistorElm 0 6\rVCCSElm 5 7 5 7 6 7 5\rCapacitorElm 5 7\rResistorElm 7 2\rResistorElm 3 5";
  static readonly externalNodes = [1, 2, 3];
  static readonly modelDump =
    "2 x2n2646-emitter/0 0 0 0 0 0 0/2 2 1000*a/0 1000000/0 5 0.00028*(a-b)\\p0.00575*(c-d)*e/2 3.5e-11 0 0/0 38.15/0 2518";
  emitter: GridPoint[] = [];
  b1: GridPoint[] = [];
  b2: GridPoint[] = [];

  override initNew(): void {
    this.setup();
  }
  override readTokens(_st: TokenStream): void {
    this.setup();
  }

  setup(): void {
    this.noDiagonal = true;
    this.flags |= CompositeElm.FLAG_ESCAPE;
    this.loadComposite(new TokenStream(UnijunctionElm.modelDump, /\/+/), UnijunctionElm.modelString, UnijunctionElm.externalNodes);
  }

  override preStamp(): void {
    // the model doesn't work without time step auto-adjust (upstream sets it on creation)
    this.sim.adjustTimeStep = true;
    super.preStamp();
  }

  // the model details aren't saved: they take up space and would make the model hard to change
  override dumpValues(): string {
    return this.dumpElements(0);
  }

  override setPoints(): void {
    super.setPoints();
    const flip = this.hasFlag(UnijunctionElm.FLAG_FLIP) ? -1 : 1;
    const hs2 = 16 * this.dsign * flip;
    const p1 = interpPointPerp(this.point1, this.point2, 0, -hs2);
    const p2 = interpPointPerp(this.point1, this.point2, 1, -hs2);
    const half = Math.trunc(hs2 / 2);
    this.b1 = [interpPointPerp(p1, p2, 1, -hs2), interpPointPerp(p1, p2, 1, -half), interpPointPerp(p1, p2, 1 - 10 / this.dn, -half)];
    this.b2 = [interpPointPerp(p1, p2, 1, hs2), interpPointPerp(p1, p2, 1, half), interpPointPerp(p1, p2, 1 - 10 / this.dn, half)];
    this.emitter = [interpPointPerp(p1, p2, 0, hs2), interpPointPerp(p1, p2, 1 - 28 / this.dn, hs2), interpPoint(p1, p2, 1 - 14 / this.dn)];
  }

  override getPost(n: number): GridPoint {
    return n === 0 ? this.emitter[0] : n === 1 ? this.b1[0] : this.b2[0];
  }
  override getPostCount(): number {
    return 3;
  }
}

/** Quartz crystal: the usual parallel capacitance plus a series RLC branch. */
export class CrystalElm extends CompositeElm {
  static override dumpType = 412;
  static override get xmlTag(): string {
    return "cr";
  }
  static readonly FLAG_SHOW_FREQ = 2;
  static readonly modelString = "CapacitorElm 1 2\rCapacitorElm 1 3\rInductorElm 3 4\rResistorElm 4 2";
  static readonly externalNodes = [1, 2];
  seriesCapacitance = 0.1e-12;
  parallelCapacitance = 28.7e-12;
  inductance = 2.5e-3;
  resistance = 6.4;

  override initNew(): void {
    this.initComposite(null, CrystalElm.modelString, CrystalElm.externalNodes);
    this.flags = CrystalElm.FLAG_SHOW_FREQ;
    this.parallelCapacitance = 28.7e-12;
    this.seriesCapacitance = 0.1e-12;
    this.inductance = 2.5e-3;
    this.resistance = 6.4;
    this.initCrystal();
  }

  override readTokens(st: TokenStream): void {
    this.initComposite(st, CrystalElm.modelString, CrystalElm.externalNodes);
    const [c1, c2, i1, r1] = this.parts();
    this.parallelCapacitance = c1.capacitance;
    this.seriesCapacitance = c2.capacitance;
    this.inductance = i1.inductance;
    this.resistance = r1.resistance;
    this.initCrystal();
  }

  private parts(): [CapacitorElm, CapacitorElm, InductorElm, ResistorElm] {
    const l = this.compElmList;
    return [l[0] as CapacitorElm, l[1] as CapacitorElm, l[2] as InductorElm, l[3] as ResistorElm];
  }

  initCrystal(): void {
    const [c1, c2, i1, r1] = this.parts();
    c1.capacitance = this.parallelCapacitance;
    c2.capacitance = this.seriesCapacitance;
    i1.setInductance(this.inductance);
    r1.resistance = this.resistance;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["pc", String(this.parallelCapacitance)], ["sc", String(this.seriesCapacitance)], ["in", String(this.inductance)], ["r", String(this.resistance)]);
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.resistance = xml.double("r", this.resistance);
    this.inductance = xml.double("in", this.inductance);
    this.parallelCapacitance = xml.double("pc", this.parallelCapacitance);
    this.seriesCapacitance = xml.double("sc", this.seriesCapacitance);
    this.initCrystal();
  }

  override setPoints(): void {
    super.setPoints();
    const f = (this.dn / 2 - 10) / this.dn;
    this.lead1 = interpPoint(this.point1, this.point2, f);
    this.lead2 = interpPoint(this.point1, this.point2, 1 - f);
    this.setPost(0, this.point1);
    this.setPost(1, this.point2);
  }

  override stepFinished(): void {
    super.stepFinished();
    this.current = this.getCurrentIntoNode(1);
  }

  /** Series resonant frequency. */
  get seriesFrequency(): number {
    return 1 / (Math.sqrt(this.inductance * this.seriesCapacitance) * Math.PI * 2);
  }
}

/** Operational transconductance amplifier (LM13700 style), built from transistors. */
export class OTAElm extends CompositeElm {
  /** NodeForge display geometry: independently preserve input polarity and the bias lead. */
  static readonly FLAG_INPUT_FLIP = 1 << 20;
  static readonly FLAG_BIAS_FLIP = 1 << 21;
  static override dumpType = 402;
  static readonly modelString =
    "RailElm 4\rRailElm 10\rNTransistorElm 1 2 3\rNTransistorElm 3 1 4\rNTransistorElm 3 3 4\rNTransistorElm 5 6 2\rNTransistorElm 7 8 2\rPTransistorElm 9 6 10\rPTransistorElm 9 9 10\rPTransistorElm 6 12 9\rPTransistorElm 11 8 10\rPTransistorElm 11 11 10\rPTransistorElm 8 13 11\rNTransistorElm 14 14 4\rNTransistorElm 14 12 4\rNTransistorElm 12 13 14\rNTransistorElm 15 15 5\rNTransistorElm 15 15 7";
  static readonly externalNodes = [7, 5, 15, 1, 13];
  static readonly opheight = 32;
  static readonly opwidth = 32;
  static readonly circDiam = 19;
  static readonly circOverlap = 8;
  posVolt = 9;
  negVolt = -9;
  point2bis: GridPoint = pt(0, 0);
  /** Input leads: +, -, Iabc (from point1) and the bias input from below. */
  in1p: GridPoint[] = [];
  in2p: GridPoint[] = [];
  in4p: GridPoint[] = [];

  override initNew(): void {
    this.initComposite(null, OTAElm.modelString, OTAElm.externalNodes);
    this.noDiagonal = true;
    this.initOTA();
  }

  override readTokens(st: TokenStream): void {
    this.initComposite(st, OTAElm.modelString, OTAElm.externalNodes);
    this.noDiagonal = true;
    this.negVolt = (this.compElmList[0] as RailElm).maxVoltage;
    this.posVolt = (this.compElmList[1] as RailElm).maxVoltage;
  }

  initOTA(): void {
    (this.compElmList[0] as RailElm).maxVoltage = this.negVolt;
    (this.compElmList[1] as RailElm).maxVoltage = this.posVolt;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["pv", String(this.posVolt)], ["nv", String(this.negVolt)]);
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.posVolt = xml.double("pv", this.posVolt);
    this.negVolt = xml.double("nv", this.negVolt);
    this.initOTA();
  }

  override setPoints(): void {
    super.setPoints();
    const ww = OTAElm.opwidth;
    const wtot = ww * 2 + 2 * OTAElm.circDiam - OTAElm.circOverlap;
    if (this.dn > wtot) {
      this.lead1 = interpPoint(this.point1, this.point2, 1 - wtot / this.dn);
      this.lead2 = this.point2;
      this.point2bis = this.point2;
    } else {
      this.lead1 = this.point1;
      this.lead2 = interpPoint(this.point1, this.point2, wtot / this.dn);
      this.point2bis = this.lead2;
    }
    const hs = OTAElm.opheight * this.dsign * (this.hasFlag(OTAElm.FLAG_INPUT_FLIP) ? -1 : 1);
    const l1 = this.lead1, l2 = this.lead2;
    this.in1p = [interpPointPerp(this.point1, this.point2bis, 0, hs), interpPointPerp(l1, l2, 0, hs)];
    this.in2p = [interpPointPerp(this.point1, this.point2bis, 0, -hs), interpPointPerp(l1, l2, 0, -hs)];
    const bias = this.hasFlag(OTAElm.FLAG_BIAS_FLIP) ? -1 : 1;
    this.in4p = [interpPointPerp(l1, l2, 1 - 16 / wtot, 32 * bias), interpPointPerp(l1, l2, 1 - 16 / wtot, 8 * bias)];
    this.setPost(0, this.in1p[0]);
    this.setPost(1, this.in2p[0]);
    this.setPost(2, this.point1);
    this.setPost(3, this.in4p[0]);
    this.setPost(4, this.point2bis);
  }
}

/** Norton (current-differencing) amplifier, like the LM3900. */
export class NortonAmpElm extends CompositeElm {
  static override get xmlTag(): string {
    return "nor";
  }
  static readonly FLAG_SWAP = 1;
  static readonly FLAG_SMALL = 2;
  /** External nodes in model order: in+, in-, out. */
  static readonly externalNodes = [3, 1, 4];
  static readonly modelXml =
    '<elms><d nn="1 0" f="2" mo="default"/><d nn="2 0" f="2" mo="default"/>' +
    '<CCCS nn="3 2 1 0" f="0" ic="2" ex="-a"/><a nn="1 0 4" f="8" ma="12" mi="0" ga="100000"/></elms>';
  private static modelElements: XmlNode[] | null = null;
  opsize = 2;
  opheight = 16;
  opwidth = 26;

  override initNew(): void {
    NortonAmpElm.modelElements ??= parseXml(NortonAmpElm.modelXml).children;
    this.loadCompositeXml(NortonAmpElm.modelElements, NortonAmpElm.externalNodes);
    this.buildCompNodeList();
    this.allocNodes();
    this.noDiagonal = true;
    this.setSize(grid.size === 8 ? 1 : 2);
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.setSize((this.flags & NortonAmpElm.FLAG_SMALL) !== 0 ? 1 : 2);
  }

  setSize(s: number): void {
    this.opsize = s;
    this.opheight = 8 * s;
    this.opwidth = 13 * s;
    this.flags = (this.flags & ~NortonAmpElm.FLAG_SMALL) | (s === 1 ? NortonAmpElm.FLAG_SMALL : 0);
  }

  override setPoints(): void {
    super.setPoints();
    let ww = this.opwidth;
    if (ww > this.dn / 2) ww = Math.trunc(this.dn / 2);
    this.calcLeads(ww * 2);
    let hs = this.opheight * this.dsign;
    if ((this.flags & NortonAmpElm.FLAG_SWAP) !== 0) hs = -hs;
    this.setPost(0, interpPointPerp(this.point1, this.point2, 0, hs));
    this.setPost(1, interpPointPerp(this.point1, this.point2, 0, -hs));
    this.setPost(2, this.point2);
  }

  // XML only (upstream has no text type code for it)
  override textLossless(): boolean {
    return false;
  }
}
