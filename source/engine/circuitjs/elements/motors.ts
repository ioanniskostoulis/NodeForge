// Ported from CircuitJS1 (ThreePhaseMotorElm.java, MotorProtectionSwitchElm.java) by Paul Falstad.
// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { CircuitElm, type XmlAttrs } from "../core/elm";
import { type GridPoint, orientSymbolPoint, interpPoint, interpPointPerp, pt } from "../core/geometry";
import { invertMatrix } from "../core/lu";
import type { VoltageSource } from "../core/nodes";
import { CircuitText, type TokenStream, type XmlNode } from "../io/tokens";
import { RelayCoilElm, RelayContactElm } from "./relays";

/** Three-phase induction motor (stator and rotor coils plus mechanical model). Posts: U1 U2 V1 V2 W1 W2. */
export class ThreePhaseMotorElm extends CircuitElm {
  /** NodeForge display geometry: preserve terminal identity when turning or mirroring. */
  static readonly FLAG_GEOMETRY_FLIP = 1 << 20;
  static override dumpType = 427;
  static readonly n001 = 6;
  static readonly n002 = 7;
  static readonly n003 = 8;
  static readonly n004 = 9;
  static readonly n005 = 10;
  static readonly n006 = 11;
  static readonly n007 = 12;
  static readonly Zp = 2;
  static readonly coilCount = 5;
  static readonly coilNodes = [6, 1, 8, 3, 10, 5, 7, 9, 11, 12];
  Rs = 0.435;
  Rr = 0.816;
  Ls = 0.0294;
  Lr = 0.0297;
  Lm = 0.0287;
  b = 0.05;
  J = 1;
  angle = Math.PI / 2;
  speed = 0;
  filteredSpeed = 0;
  posts: GridPoint[] = [];
  leads: GridPoint[] = [];
  motorCenter: GridPoint = pt(0, 0);
  coilCurrents = new Array<number>(ThreePhaseMotorElm.coilCount).fill(0);
  coilCurSourceValues: number[] | null = null;
  xformMatrix: number[][] | null = null;
  nodeCurrents: number[] | null = null;
  voltSources: (VoltageSource | null)[] = [null, null];
  vs1value = 0;
  vs2value = 0;

  override readTokens(st: TokenStream): void {
    this.angle = Math.PI / 2;
    this.filteredSpeed = this.speed = 0;
    this.Rs = st.nextDouble();
    this.Rr = st.nextDouble();
    this.Ls = st.nextDouble();
    this.Lr = st.nextDouble();
    this.Lm = st.nextDouble();
    this.b = st.nextDouble();
    this.J = st.tryDouble() ?? 1;
  }

  // upstream has no text writer for this part; the fields are written so text files stay readable
  override dumpValues(): string {
    return ` ${this.Rs} ${this.Rr} ${this.Ls} ${this.Lr} ${this.Lm} ${this.b} ${this.J}`;
  }
  override textLossless(): boolean {
    return false;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["rs", String(this.Rs)], ["rr", String(this.Rr)], ["ls", String(this.Ls)], ["lr", String(this.Lr)], ["lm", String(this.Lm)],
      ["b", String(this.b)], ["j", String(this.J)]);
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.Rs = xml.double("rs", this.Rs);
    this.Rr = xml.double("rr", this.Rr);
    this.Ls = xml.double("ls", this.Ls);
    this.Lr = xml.double("lr", this.Lr);
    this.Lm = xml.double("lm", this.Lm);
    this.b = xml.double("b", this.b);
    this.J = xml.double("j", this.J);
  }

  override setPoints(): void {
    super.setPoints();
    const q = (Math.abs(this.dy) > Math.abs(this.dx) ? -1 : 1) * (this.hasFlag(ThreePhaseMotorElm.FLAG_GEOMETRY_FLIP) ? -1 : 1);
    const p1 = this.point1, p2 = this.point2;
    for (let i = 0; i !== 3; i++) {
      this.posts[i * 2] = interpPointPerp(p1, p2, 0, -q * 32 * (i - 1));
      this.leads[i * 2] = interpPointPerp(p1, p2, 0.45, -q * 32 * (i - 1));
      this.posts[i * 2 + 1] = interpPointPerp(p1, p2, 1, q * 32 * (i - 1));
      this.leads[i * 2 + 1] = interpPointPerp(p1, p2, 0.55, q * 32 * (i - 1));
    }
    this.motorCenter = interpPoint(p1, p2, 0.5);
    this.allocNodes();
  }

  override getPostCount(): number {
    return 6;
  }
  override getPost(n: number): GridPoint {
    return this.posts[n];
  }
  override getInternalNodeCount(): number {
    return 7;
  }
  override getVoltageSourceCount(): number {
    return 2;
  }

  override reset(): void {
    super.reset();
    this.filteredSpeed = this.speed = 0;
    this.coilCurSourceValues = new Array<number>(ThreePhaseMotorElm.coilCount).fill(0);
    this.coilCurrents = new Array<number>(ThreePhaseMotorElm.coilCount).fill(0);
  }

  override stamp(): void {
    const T = ThreePhaseMotorElm, sim = this.sim, nodes = this.nodes, n = T.coilCount;
    sim.stampResistor(nodes[0]!, nodes[T.n001]!, this.Rs);
    sim.stampResistor(nodes[2]!, nodes[T.n003]!, this.Rs);
    sim.stampResistor(nodes[4]!, nodes[T.n005]!, this.Rs);
    sim.stampResistor(nodes[T.n004]!, sim.ground, 1.5 * this.Rr);
    sim.stampResistor(nodes[T.n007]!, sim.ground, 1.5 * this.Rr);

    const Lr2 = this.Lr * 1.5;
    const coilInductances = [this.Ls, this.Ls, this.Ls, Lr2, Lr2];
    const couplingCoefs = coilInductances.map(() => new Array<number>(n).fill(0));
    const xform = coilInductances.map(() => new Array<number>(n).fill(0));
    for (let i = 0; i !== n; i++) xform[i][i] = coilInductances[i];
    const k0 = this.Lm / Math.sqrt(this.Ls * Lr2);
    couplingCoefs[0][3] = couplingCoefs[3][0] = k0;
    couplingCoefs[1][3] = couplingCoefs[3][1] = -k0 / 2;
    couplingCoefs[1][4] = couplingCoefs[4][1] = (k0 * Math.sqrt(3)) / 2;
    couplingCoefs[2][3] = couplingCoefs[3][2] = -k0 / 2;
    couplingCoefs[2][4] = couplingCoefs[4][2] = (-k0 * Math.sqrt(3)) / 2;
    for (let i = 0; i !== n; i++)
      for (let j = 0; j !== i; j++) xform[i][j] = xform[j][i] = couplingCoefs[i][j] * Math.sqrt(coilInductances[i] * coilInductances[j]);
    invertMatrix(xform, n);
    const ts = sim.timeStep;
    const cn = T.coilNodes;
    for (let i = 0; i !== n; i++) {
      for (let j = 0; j !== n; j++) {
        xform[i][j] *= ts;
        if (i === j) sim.stampConductance(nodes[cn[i * 2]]!, nodes[cn[i * 2 + 1]]!, xform[i][i]);
        else sim.stampVCCurrentSource(nodes[cn[i * 2]]!, nodes[cn[i * 2 + 1]]!, nodes[cn[j * 2]]!, nodes[cn[j * 2 + 1]]!, xform[i][j]);
      }
    }
    this.xformMatrix = xform;
    sim.stampVoltageSource(nodes[T.n002]!, sim.ground, this.voltSources[0]!);
    sim.stampVoltageSource(nodes[T.n006]!, sim.ground, this.voltSources[1]!);
    if (this.coilCurSourceValues?.length !== n) this.coilCurSourceValues = new Array<number>(n).fill(0);
    if (this.coilCurrents.length !== n) this.coilCurrents = new Array<number>(n).fill(0);
    if (this.nodeCurrents?.length !== this.getNodeCount()) this.nodeCurrents = new Array<number>(this.getNodeCount()).fill(0);
  }

  override setVoltageSource(n: number, v: VoltageSource): void {
    this.voltSources[n] = v;
    v.setNodes(this.nodes[n === 0 ? ThreePhaseMotorElm.n002 : ThreePhaseMotorElm.n006]!, this.sim.ground);
  }

  override startIteration(): void {
    const c = this.coilCurrents, Zp = ThreePhaseMotorElm.Zp, ts = this.sim.timeStep;
    for (let i = 0; i !== ThreePhaseMotorElm.coilCount; i++) this.coilCurSourceValues![i] = c[i];
    const torque = ((Zp * Math.sqrt(3)) / 2) * this.Lm * ((c[1] - c[2]) * c[3] - Math.sqrt(3) * c[0] * c[4]);
    this.speed += (ts * (torque - this.b * this.speed)) / this.J;
    this.angle = this.angle + this.speed * ts;
    this.vs1value = -Zp * this.speed * (((this.Lm * Math.sqrt(3)) / 2) * (c[1] - c[2]) + 1.5 * this.Lr * c[4]);
    this.vs2value = Zp * this.speed * ((3 / 2) * this.Lm * c[0] + 1.5 * this.Lr * c[3]);
  }

  override doStep(): void {
    const T = ThreePhaseMotorElm, sim = this.sim, nodes = this.nodes, cn = T.coilNodes;
    for (let i = 0; i !== T.coilCount; i++) sim.stampCurrentSource(nodes[cn[i * 2]]!, nodes[cn[i * 2 + 1]]!, this.coilCurSourceValues![i]);
    sim.updateVoltageSource(nodes[T.n002]!, sim.ground, this.voltSources[0]!, -this.vs1value);
    sim.updateVoltageSource(nodes[T.n006]!, sim.ground, this.voltSources[1]!, -this.vs2value);
  }

  override calculateCurrent(): void {
    const nc = this.nodeCurrents;
    if (nc === null) return;
    nc.fill(0);
    const cn = ThreePhaseMotorElm.coilNodes;
    for (let i = 0; i !== ThreePhaseMotorElm.coilCount; i++) {
      let val = this.coilCurSourceValues![i];
      if (this.xformMatrix !== null) {
        for (let j = 0; j !== ThreePhaseMotorElm.coilCount; j++) {
          const voltdiff = this.volts[cn[j * 2]] - this.volts[cn[j * 2 + 1]];
          val += voltdiff * this.xformMatrix[i][j];
        }
      }
      this.coilCurrents[i] = val;
      // (upstream indexes these by coil number; they're not used for anything else)
      const ni = cn[i];
      nc[ni] += val;
      nc[ni + 1] -= val;
    }
  }

  override hasGroundConnection(_n1: number): boolean {
    return false;
  }
  override getConnection(_n1: number, _n2: number): boolean {
    return true;
  }

  override stepFinished(): void {
    // upstream updates this while drawing
    this.filteredSpeed = this.filteredSpeed * 0.98 + this.speed * 0.02;
  }

  override getCurrentIntoNode(n: number): number {
    if (n % 2 === 1) return this.coilCurrents[Math.trunc(n / 2)];
    return -this.coilCurrents[Math.trunc(n / 2)];
  }
}

/** Three-pole motor protection switch: trips (opens) when I²t heating exceeds the limit. */
export class MotorProtectionSwitchElm extends CircuitElm {
  static override dumpType = 428;
  static readonly blownResistance = 1e9;
  resistance = 0.0613;
  i2t = 6.73;
  heats = [0, 0, 0];
  currents = [0, 0, 0];
  blown = false;
  label = "";
  posts: GridPoint[] = [];
  leads: GridPoint[] = [];

  override initNew(): void {
    this.i2t = 6.73;
    this.resistance = 0.0613;
    this.label = "";
  }

  override readTokens(st: TokenStream): void {
    this.resistance = st.nextDouble();
    this.i2t = st.nextDouble();
    this.blown = st.nextBool();
    this.label = st.hasMoreTokens ? CircuitText.unescape(st.next()) : "";
  }

  override dumpValues(): string {
    return ` ${this.resistance} ${this.i2t} ${this.blown} ${CircuitText.escape(this.label)}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["re", String(this.resistance)], ["i2", String(this.i2t)], ["bl", String(this.blown)], ["la", this.label]);
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.resistance = xml.double("re", this.resistance);
    this.i2t = xml.double("i2", this.i2t);
    this.blown = xml.bool("bl", this.blown);
    this.label = xml.string("la", this.label) ?? this.label;
  }

  override reset(): void {
    super.reset();
    this.heats = [0, 0, 0];
    this.currents = [0, 0, 0];
    this.blown = false;
    this.setSwitchPositions();
  }

  override setPoints(): void {
    super.setPoints();
    this.initBoundingBox();
    for (let i = 0; i !== 3; i++) {
      this.posts[i * 2] = this.symbolPoint(this.x + i * 48, this.y);
      this.posts[i * 2 + 1] = this.symbolPoint(this.x + i * 48, this.y + 192);
      this.leads[i * 2] = this.symbolPoint(this.x + i * 48, this.y + 80);
      this.leads[i * 2 + 1] = this.symbolPoint(this.x + i * 48, this.y + 176);
    }
  }

  symbolPoint(x: number, y: number): GridPoint { return orientSymbolPoint(this, pt(x, y)); }

  override initBoundingBox(): void {
    const a = this.symbolPoint(this.x - 72, this.y), b = this.symbolPoint(this.x + 95, this.y + 192);
    this.boundingBox = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x) + 1, height: Math.abs(a.y - b.y) + 1 };
  }

  override getPostCount(): number {
    return 6;
  }
  override getPost(n: number): GridPoint {
    return this.posts[n];
  }

  override calculateCurrent(): void {
    const r = this.blown ? MotorProtectionSwitchElm.blownResistance : this.resistance;
    for (let i = 0; i !== 3; i++) this.currents[i] = (this.volts[i * 2] - this.volts[i * 2 + 1]) / r;
  }

  override nonLinear(): boolean {
    return true;
  }
  override getConnection(n1: number, n2: number): boolean {
    return Math.trunc(n1 / 2) === Math.trunc(n2 / 2);
  }

  override startIteration(): void {
    const wasBlown = this.blown, ts = this.sim.timeStep;
    for (let j = 0; j !== 3; j++) {
      const i = this.currents[j];
      let heat = this.heats[j];
      heat += i * i * ts;
      heat -= (ts * this.i2t) / 3;
      if (heat < 0) heat = 0;
      if (heat > this.i2t) this.blown = true;
      this.heats[j] = heat;
    }
    if (this.blown !== wasBlown) this.setSwitchPositions();
  }

  override stepFinished(): void {
    // upstream also does this every time it draws
    this.setSwitchPositions();
  }

  /** Open (when blown) or close the relay contacts with the same label. */
  setSwitchPositions(): void {
    if (!this.sim) return;
    const position = this.blown ? 0 : 1;
    for (const o of this.sim.elmList)
      if (o instanceof RelayContactElm && o.label === this.label) o.setContactPosition(position, RelayCoilElm.TYPE_NORMAL);
  }

  override doStep(): void {
    const r = this.blown ? MotorProtectionSwitchElm.blownResistance : this.resistance;
    for (let i = 0; i !== 3; i++) this.sim.stampResistor(this.nodes[i * 2]!, this.nodes[i * 2 + 1]!, r);
  }

  override getCurrentIntoNode(n: number): number {
    if (n % 2 === 1) return this.currents[Math.trunc(n / 2)];
    return -this.currents[Math.trunc(n / 2)];
  }
}
