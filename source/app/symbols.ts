// Schematic symbols for the parts beyond the basic passives and sources (those are drawn in
// renderer.ts). Geometry follows CircuitJS1's drawing code (Paul Falstad, Iain Sharp); the look
// follows NodeForge's sheet style: leads in voltage colors, bodies in ink, no fills except where
// a symbol needs one.
// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import {
  AmmeterElm, AnalogSwitch2Elm, AnalogSwitchElm, AntennaElm, AudioOutputElm, BoxElm, BusLogicInputElm, BusSplitterElm,
  ChipElm, type CircuitElm, CrossSwitchElm, CrystalElm, CustomCompositeElm, DarlingtonElm, DecimalDisplayElm, DiacElm,
  ExtVoltageElm, GateElm, GraphicElm, GyratorElm, InstructionDisplayElm, InverterElm, InvertingSchmittElm, JfetElm, LabeledNodeElm,
  LampElm, LEDArrayElm, LEDElm, LineElm, LogicInputElm, LogicOutputElm, MemristorElm, MotorProtectionSwitchElm,
  NoiseElm, NortonAmpElm, OpAmpElm, OTAElm, OutputElm, type Pin, PolarCapacitorElm, PotElm, ProbeElm, PushSwitchElm,
  RelayCoilElm, RelayContactElm, RelayElm, RoutedWireElm, SchmittElm, SCRElm, ScopeElm, SevenSegElm, Side, SparkGapElm,
  SweepElm, Switch2Elm, TappedTransformerElm, TextElm, ThreePhaseMotorElm, TransformerElm, TransistorElm, TransLineElm,
  TriacElm, TriodeElm, TunnelDiodeElm, UnijunctionElm, VaractorElm, WireElm, XorGateElm,
  BatteryElm, AMElm, FMElm, DataInputElm, AudioInputElm, OhmMeterElm, WattmeterElm, TestPointElm, StopTriggerElm,
  DataRecorderElm, LDRElm, ThermistorNTCElm, DCMotorElm, ComparatorElm, TriStateElm, DelayBufferElm, OptocouplerElm,
  OpAmpRealElm, DPDTSwitchElm, MBBSwitchElm, CustomTransformerElm, SwitchElm,
} from "../engine";
import { si } from "./format";
import { partBox } from "./model";
import { arrow, dist, frame, lerp, type P, perp, perpPoint, readingOrder, unit } from "./geom";
import { settings } from "./settings";
import { windingLoops, windingPoints, windingShift } from "./transformer-geometry";
import { traceSmoothCurve } from "./curves";
import { rgbColor, SANS, type Theme } from "./theme";

// line weights in world units (as in renderer.ts)
const WIRE = 2.0;
const BODY = 1.75;
const FINE = 1.25;
const RESISTOR_HALF_HEIGHT = 6;

/** The shared body for fixed and variable resistor symbols. Lead geometry supplies its length. */
export function resistorBodyPath(a: P, b: P): P[] {
  [a, b] = readingOrder(a, b);
  const len = dist(a, b), f = frame(a, b);
  if (settings.symbolStyle === "iec") {
    const h = RESISTOR_HALF_HEIGHT;
    return [{ x: 0, y: -h }, { x: len, y: -h }, { x: len, y: h }, { x: 0, y: h }, { x: 0, y: -h }].map(f);
  }
  const h = len < 30 ? 2 : RESISTOR_HALF_HEIGHT;
  // rises first, read left to right (local -y is up on screen for a left-to-right part)
  const pts: P[] = [{ x: 0, y: 0 }];
  for (let i = 0; i < 4; i++) {
    pts.push({ x: ((1 + 4 * i) * len) / 16, y: -h });
    pts.push({ x: ((3 + 4 * i) * len) / 16, y: h });
  }
  pts.push({ x: len, y: 0 });
  return pts.map(f);
}

/** Drawing primitives the symbols use (provided by the renderer). */
export interface Pen {
  gridSize?: number;
  ctx: CanvasRenderingContext2D;
  theme: Theme;
  /** Line width in world units, at least one device pixel. */
  lw(w: number): number;
  stroke(pts: P[], color: string, width: number): void;
  /** Record a visible electrical lead for current markers and crossing bridges. */
  onLead?(elm: CircuitElm, terminal: number, a: P, b: P): void;
  fill(pts: P[], color: string): void;
  /** The voltage color of node n of an element. */
  volt(e: CircuitElm, n: number): string;
  /** Plain schematic lettering. */
  text(s: string, p: P, font: string, color: string, align: CanvasTextAlign, baseline: CanvasTextBaseline): void;
}

const font = (px: number, weight = 400) => `${weight} ${px}px ${SANS}`;

/** The box around a part's terminals. */
function postsBox(ce: CircuitElm): { x: number; y: number; width: number; height: number } {
  if (!ce.getPostCount()) return partBox(ce);
  const ps = Array.from({ length: ce.getPostCount() }, (_, i) => ce.getPost(i));
  const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** The drawn body of a part, for keeping labels off it. Null for inline parts and wires. */
export function bodyBox(ce: CircuitElm): { x: number; y: number; w: number; h: number } | null {
  const chip = ce instanceof CustomCompositeElm ? ce.chip : ce instanceof ChipElm ? ce : null;
  if (chip) {
    const top = Math.min(chip.rect.y, ...chip.pins.map((p) => p.post.y - 4));
    const bottom = Math.max(chip.rect.y + chip.rect.h, ...chip.pins.map((p) => p.post.y + 4));
    return { x: chip.rect.x, y: top, w: chip.rect.w, h: bottom - top };
  }
  // the drawn body and the terminals around it (labels shouldn't sit on a lead either)
  const withPosts = (x0: number, y0: number, x1: number, y1: number, margin: number) => {
    const p = postsBox(ce);
    x0 = Math.min(x0, p.x) - margin;
    y0 = Math.min(y0, p.y) - margin;
    x1 = Math.max(x1, p.x + p.width) + margin;
    y1 = Math.max(y1, p.y + p.height) + margin;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  if (ce instanceof WattmeterElm && ce.rect.length === 4) {
    const xs = ce.rect.map((p) => p.x), ys = ce.rect.map((p) => p.y);
    return withPosts(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), 4);
  }
  if (ce instanceof OpAmpElm || ce instanceof OpAmpRealElm || ce instanceof ComparatorElm || ce instanceof OTAElm || ce instanceof NortonAmpElm) {
    // the triangle reaches about twice as far across the part as its inputs do
    const u = unit(ce.point1, ce.point2);
    let inputs = 8;
    for (let i = 0; i < ce.getPostCount(); i++) {
      const p = ce.getPost(i), dx = p.x - ce.point1.x, dy = p.y - ce.point1.y;
      if (dx * u.x + dy * u.y < ce.dn / 2) inputs = Math.max(inputs, Math.abs(dx * u.y - dy * u.x));
    }
    const corners = [...perp(ce.point1, ce.point2, 0, inputs * 2), ...perp(ce.point1, ce.point2, 1, inputs * 2)];
    const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
    return withPosts(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), 4);
  }
  if (ce instanceof OptocouplerElm) {
    const r = ce.rect, a = ce.symbolPoint(r.x, r.y), b = ce.symbolPoint(r.x + r.w, r.y + r.h);
    return withPosts(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y), 4);
  }
  if (ce instanceof TriodeElm) {
    // the glass envelope around point2 (radius 20) reaches past the terminals
    const c = ce.point2;
    return withPosts(c.x - 20, c.y - 20, c.x + 20, c.y + 20, 4);
  }
  if (ce instanceof DCMotorElm || ce instanceof ThreePhaseMotorElm) {
    const radius = ce instanceof DCMotorElm ? 22 : 41, c = ce.motorCenter;
    return withPosts(c.x - radius, c.y - radius, c.x + radius, c.y + radius, 4);
  }
  if ((ce instanceof SchmittElm || ce instanceof InvertingSchmittElm || ce instanceof InverterElm) && ce.lead1 && ce.lead2) {
    const x0 = Math.min(ce.lead1.x, ce.lead2.x), y0 = Math.min(ce.lead1.y, ce.lead2.y);
    const x1 = Math.max(ce.lead1.x, ce.lead2.x), y1 = Math.max(ce.lead1.y, ce.lead2.y);
    return { x: x0 - 18, y: y0 - 18, w: x1 - x0 + 36, h: y1 - y0 + 36 };
  }
  if ((ce instanceof TriStateElm || ce instanceof DelayBufferElm) && ce.lead1 && ce.lead2) {
    const x0 = Math.min(ce.lead1.x, ce.lead2.x), y0 = Math.min(ce.lead1.y, ce.lead2.y);
    const x1 = Math.max(ce.lead1.x, ce.lead2.x), y1 = Math.max(ce.lead1.y, ce.lead2.y);
    return { x: x0 - 18, y: y0 - 18, w: x1 - x0 + 36, h: y1 - y0 + 36 };
  }
  if (ce instanceof WireElm || ce instanceof LabeledNodeElm || ce instanceof BusLogicInputElm || ce instanceof InstructionDisplayElm || ce instanceof GraphicElm) return null;
  if (ce.getPostCount() <= 2) return null;
  // the terminals, not the drag end: parts like the optocoupler don't depend on where it was
  const b = postsBox(ce);
  const m = ce instanceof GateElm ? 12 : 6;
  return { x: b.x - m, y: b.y - m, w: b.width + 2 * m, h: b.height + 2 * m };
}

/**
 * Draw the symbol for `ce` if it's one of the parts handled here. Returns false for parts the
 * renderer draws itself.
 */
export function drawSymbol(pen: Pen, ce: CircuitElm, ink: string, hl: boolean): boolean {
  const s = new Symbols(pen, ink, hl);
  // order matters: subclasses before their base classes
  if (ce instanceof RoutedWireElm) s.routedWire(ce);
  else if (ce instanceof DPDTSwitchElm) s.dpdt(ce);
  else if (ce instanceof MBBSwitchElm) s.mbb(ce);
  else if (ce instanceof OhmMeterElm) s.meterCircle(ce, "Ω");
  else if (ce instanceof BatteryElm) s.battery(ce);
  else if (ce instanceof AMElm) s.modSource(ce, ce instanceof FMElm ? "FM" : "AM");
  else if (ce instanceof WattmeterElm) s.wattmeter(ce);
  else if (ce instanceof TestPointElm) s.testPoint(ce);
  else if (ce instanceof StopTriggerElm) s.tag(ce, "trigger", ce.stopped);
  else if (ce instanceof DataRecorderElm) s.tag(ce, "export", false);
  else if (ce instanceof LDRElm) s.ldr(ce);
  else if (ce instanceof ThermistorNTCElm) s.thermistor(ce);
  else if (ce instanceof DCMotorElm) s.dcMotor(ce);
  else if (ce instanceof ComparatorElm) s.comparator(ce);
  else if (ce instanceof TriStateElm) s.triState(ce);
  else if (ce instanceof DelayBufferElm) s.delayBuffer(ce);
  else if (ce instanceof OptocouplerElm) s.optocoupler(ce);
  else if (ce instanceof OpAmpRealElm) s.opAmpReal(ce);
  else if (ce instanceof CustomTransformerElm) s.customTransformer(ce);
  else if (ce instanceof BusLogicInputElm) s.busInput(ce);
  else if (ce instanceof LogicInputElm) s.logicInput(ce);
  else if (ce instanceof CrossSwitchElm) s.crossSwitch(ce);
  else if (ce instanceof Switch2Elm) s.switch2(ce);
  // a push switch is saved as a momentary switch and comes back as a SwitchElm
  else if (ce instanceof PushSwitchElm || (ce.constructor === SwitchElm && (ce as SwitchElm).momentary)) s.pushSwitch(ce as SwitchElm);
  else if (ce instanceof LogicOutputElm) s.logicOutput(ce);
  else if (ce instanceof GateElm) s.gate(ce);
  else if (ce instanceof InverterElm) s.inverter(ce);
  else if (ce instanceof SevenSegElm) { s.chip(ce); s.sevenSeg(ce); }
  else if (ce instanceof DecimalDisplayElm) { s.chip(ce); s.decimalDisplay(ce); }
  else if (ce instanceof LEDArrayElm) { s.chip(ce); s.ledArray(ce); }
  else if (ce instanceof BusSplitterElm) s.busSplitter(ce);
  else if (ce instanceof ChipElm) s.chip(ce);
  else if (ce instanceof CustomCompositeElm) s.subcircuit(ce);
  else if (ce instanceof NortonAmpElm) s.nortonAmp(ce);
  else if (ce instanceof OpAmpElm) s.opAmp(ce);
  else if (ce instanceof OTAElm) s.ota(ce);
  else if (ce instanceof DarlingtonElm) s.darlington(ce);
  else if (ce instanceof TransistorElm) s.transistor(ce);
  else if (ce instanceof UnijunctionElm) s.unijunction(ce);
  else if (ce instanceof JfetElm) s.jfet(ce);
  else if (ce instanceof LEDElm) s.led(ce);
  else if (ce instanceof VaractorElm) s.varactor(ce);
  else if (ce instanceof TunnelDiodeElm) s.tunnelDiode(ce);
  else if (ce instanceof SCRElm) s.scr(ce);
  else if (ce instanceof TriacElm) s.triac(ce);
  else if (ce instanceof DiacElm) s.diac(ce);
  else if (ce instanceof TriodeElm) s.triode(ce);
  else if (ce instanceof LabeledNodeElm) s.labeledNode(ce);
  else if (ce instanceof OutputElm) s.output(ce);
  else if (ce instanceof ProbeElm) s.probe(ce);
  else if (ce instanceof TextElm) s.textElm(ce);
  else if (ce instanceof BoxElm) s.box(ce);
  else if (ce instanceof LineElm) s.lineElm(ce);
  else if (ce instanceof PotElm) s.pot(ce);
  else if (ce instanceof AnalogSwitch2Elm) s.analogSwitch2(ce);
  else if (ce instanceof AnalogSwitchElm) s.analogSwitch(ce);
  else if (ce instanceof TappedTransformerElm) s.tappedTransformer(ce);
  else if (ce instanceof TransformerElm) s.transformer(ce);
  else if (ce instanceof RelayElm) s.relay(ce);
  else if (ce instanceof RelayCoilElm) s.relayCoil(ce);
  else if (ce instanceof RelayContactElm) s.relayContact(ce);
  // the variable rail is drawn as a rail (bar and present voltage) by the renderer
  else if (ce instanceof ExtVoltageElm || ce instanceof NoiseElm || ce instanceof DataInputElm || ce instanceof AudioInputElm) s.labeledRail(ce);
  else if (ce instanceof AntennaElm) s.antenna(ce);
  else if (ce instanceof SweepElm) s.sweep(ce);
  else if (ce instanceof PolarCapacitorElm) s.polarCap(ce);
  else if (ce instanceof SchmittElm || ce instanceof InvertingSchmittElm) s.schmitt(ce);
  else if (ce instanceof LampElm) s.lamp(ce);
  else if (ce instanceof SparkGapElm) s.sparkGap(ce);
  else if (ce instanceof MemristorElm) s.memristor(ce);
  else if (ce instanceof TransLineElm) s.transLine(ce);
  else if (ce instanceof AmmeterElm) s.ammeter(ce);
  else if (ce instanceof GyratorElm) s.gyrator(ce);
  else if (ce instanceof AudioOutputElm) s.audioOutput(ce);
  else if (ce instanceof ScopeElm) s.scope(ce);
  else if (ce instanceof CrystalElm) s.crystal(ce);
  else if (ce instanceof ThreePhaseMotorElm) s.motor(ce);
  else if (ce instanceof MotorProtectionSwitchElm) s.motorProtection(ce);
  else if (ce instanceof InstructionDisplayElm) s.instructionDisplay(ce);
  else return false;
  return true;
}

class Symbols {
  constructor(private readonly pen: Pen, private readonly ink: string, private readonly hl: boolean) {}

  private lead(e: CircuitElm, n: number): string {
    return this.hl ? this.pen.theme.accent : this.pen.volt(e, n);
  }

  /** A wire-weight line in node n's voltage color. */
  private wire(e: CircuitElm, n: number, a: P, b: P, width = WIRE): void {
    this.pen.onLead?.(e, n, a, b);
    this.pen.stroke([a, b], this.lead(e, n), width);
  }

  private seg(pts: P[], width = BODY, color = this.ink): void {
    this.pen.stroke(pts, color, width);
  }

  private smoothSeg(pts: P[], width = BODY, color = this.ink): void {
    if (pts.length < 2) return;
    const { ctx } = this.pen;
    ctx.beginPath();
    traceSmoothCurve(ctx, pts);
    ctx.strokeStyle = color;
    ctx.lineWidth = this.pen.lw(width);
    ctx.stroke();
  }

  private circle(c: P, r: number, width = BODY, color = this.ink, fill: string | null = null): void {
    const { ctx } = this.pen;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = this.pen.lw(width);
    ctx.stroke();
  }

  /** Plain text (no halo), for text inside symbol outlines. */
  private label(s: string, p: P, px: number, align: CanvasTextAlign = "center", baseline: CanvasTextBaseline = "middle", color = this.ink, weight = 400): void {
    const { ctx } = this.pen;
    ctx.font = font(px, weight);
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillStyle = color;
    ctx.fillText(s, p.x, p.y);
  }

  private textWidth(s: string, px: number, weight = 400): number {
    const { ctx } = this.pen;
    ctx.font = font(px, weight);
    return ctx.measureText(s).width;
  }

  private leads(e: CircuitElm): void {
    if (e.lead1) this.wire(e, 0, e.point1, e.lead1);
    if (e.lead2) this.wire(e, 1, e.lead2, e.point2);
  }

  /** Coil from a to b: half-loops bulging to the side `side` (±1). */
  private coil(a: P, b: P, side: number, loops = 4): void {
    const len = dist(a, b);
    const r = len / (2 * loops);
    const { ctx } = this.pen;
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(Math.atan2(b.y - a.y, b.x - a.x));
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let loop = 0; loop < loops; loop++) {
      const cx = (len * (loop + 0.5)) / loops;
      ctx.arc(cx, 0, r, Math.PI, side >= 0 ? 2 * Math.PI : 0, side < 0);
    }
    ctx.strokeStyle = this.ink;
    ctx.lineWidth = this.pen.lw(BODY);
    ctx.stroke();
    ctx.restore();
  }

  /** Choose the lobe direction from the core position, so reversed winding order cannot flip it. */
  private coilTowardCore(a: P, b: P, core: P[]): void {
    const center = core.reduce((sum, p) => ({ x: sum.x + p.x / core.length, y: sum.y + p.y / core.length }), { x: 0, y: 0 });
    const u = unit(a, b);
    const middle = lerp(a, b, 0.5);
    const facing = (center.x - middle.x) * -u.y + (center.y - middle.y) * u.x;
    this.coil(a, b, facing >= 0 ? -1 : 1, windingLoops(a, b));
  }

  /** Diode triangle from a (anode) pointing at b (cathode), half-width hs, with the cathode bar. */
  private diodeBody(a: P, b: P, hs = 8, filled = true): void {
    const [a0, a1] = perp(a, b, 0, hs);
    if (filled) this.pen.fill([a0, a1, b], this.ink);
    else this.seg([a0, a1, b, a0], FINE);
    this.seg(perp(a, b, 1, hs));
  }

  routedWire(e: RoutedWireElm): void {
    const pts = e.routePoints ?? [e.point1, e.point2];
    this.pen.stroke(pts, this.lead(e, 0), e.busWidth > 1 ? WIRE + 2 : WIRE);
  }

  labeledNode(e: LabeledNodeElm): void {
    const lead = e.lead1 ?? e.point2;
    this.wire(e, 0, e.point1, lead, e.busWidth > 1 ? WIRE + 2 : WIRE);
    // the label sits in a tag past the lead
    const text = e.busWidth > 1 ? `${e.text} /${e.busWidth}` : e.text;
    const u = unit(e.point1, e.point2);
    const px = 11, w = this.textWidth(text, px, 600) + 10, h = 14;
    const horizontal = Math.abs(u.x) >= Math.abs(u.y);
    // a vertical node's label along its lead when it says so (Rotate when vertical)
    const rotated = !horizontal && e.hasFlag(LabeledNodeElm.FLAG_ROTATE_TEXT);
    const c = horizontal ? { x: lead.x + u.x * (w / 2), y: lead.y } : { x: lead.x, y: lead.y + u.y * ((rotated ? w : h) / 2) };
    const { ctx } = this.pen;
    ctx.beginPath();
    if (rotated) ctx.roundRect(c.x - h / 2, c.y - w / 2, h, w, 3);
    else ctx.roundRect(c.x - w / 2, c.y - h / 2, w, h, 3);
    ctx.strokeStyle = this.ink;
    ctx.lineWidth = this.pen.lw(FINE);
    ctx.stroke();
    const color = this.hl ? this.pen.theme.accent : this.pen.theme.designatorText;
    if (rotated) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(-Math.PI / 2);
      this.label(text, { x: 0, y: 0 }, px, "center", "middle", color, 600);
      ctx.restore();
    } else this.label(text, c, px, "center", "middle", color, 600);
  }

  output(e: OutputElm): void {
    const s = e.showsVoltage ? si(e.volts[0], "V") : "out";
    const px = 12;
    const w = this.textWidth(s, px, 600);
    const lead = lerp(e.point1, e.point2, Math.max(0, 1 - (w / 2 + 8) / e.dn));
    this.wire(e, 0, e.point1, lead);
    this.pen.text(s, e.point2, font(px, 600), this.hl ? this.pen.theme.accent : this.pen.theme.designatorText, "center", "middle");
  }

  probe(e: ProbeElm): void {
    const c = lerp(e.point1, e.point2, 0.5);
    // in a circle (Circle symbol), or the leads stopping short of a bare V
    const r = e.drawAsCircle ? 12 : 8;
    const l1 = lerp(e.point1, e.point2, Math.max(0, 0.5 - r / e.dn)), l2 = lerp(e.point1, e.point2, Math.min(1, 0.5 + r / e.dn));
    this.wire(e, 0, e.point1, l1);
    this.wire(e, 1, l2, e.point2);
    if (e.drawAsCircle) this.circle(c, r);
    this.label("V", c, 12, "center", "middle", this.ink, 600);
  }

  textElm(e: TextElm): void {
    const px = Math.max(6, e.size * 0.75);
    const lines = e.text.split("\n");
    // its own colour (Color: any CSS colour), and a bar over each line (Bar on top)
    const color = this.hl ? this.pen.theme.accent : e.color && CSS_COLOR.test(e.color.trim()) ? e.color.trim() : this.pen.theme.designatorText;
    const bar = e.hasFlag(TextElm.FLAG_BAR);
    lines.forEach((l, i) => {
      const y = e.y + i * px * 1.2;
      this.label(l, { x: e.x, y }, px, "left", "top", color);
      if (bar && l) this.seg([{ x: e.x, y: y - 1 }, { x: e.x + this.textWidth(l, px), y: y - 1 }], FINE, color);
    });
  }

  box(e: BoxElm): void {
    const { ctx } = this.pen;
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = this.hl ? this.pen.theme.accent : this.pen.theme.valueText;
    ctx.lineWidth = this.pen.lw(FINE);
    ctx.strokeRect(Math.min(e.x, e.x2), Math.min(e.y, e.y2), Math.abs(e.x2 - e.x), Math.abs(e.y2 - e.y));
    ctx.restore();
  }

  lineElm(e: LineElm): void {
    this.seg([e.point1, e.point2], FINE, this.hl ? this.pen.theme.accent : this.pen.theme.valueText);
  }

  private logicBox(e: CircuitElm, value: string, lead: P): void {
    this.wire(e, 0, e.point1, lead);
    const c = e.point2;
    const w = 18, h = 18;
    const { ctx } = this.pen;
    ctx.beginPath();
    ctx.roundRect(c.x - w / 2, c.y - h / 2, w, h, 3);
    ctx.fillStyle = this.pen.theme.background;
    ctx.fill();
    ctx.strokeStyle = this.ink;
    ctx.lineWidth = this.pen.lw(FINE);
    ctx.stroke();
    this.label(value, c, 13, "center", "middle", this.ink, 700);
  }

  logicInput(e: LogicInputElm): void {
    const s = e.isNumeric || e.isTernary ? String(e.position) : e.position === 0 ? "L" : "H";
    this.logicBox(e, s, e.lead1 ?? e.point2);
  }

  busInput(e: BusLogicInputElm): void {
    const s = String(e.value);
    const w = Math.max(18, this.textWidth(s, 13, 700) + 8);
    const lead = lerp(e.point1, e.point2, Math.max(0, 1 - (w / 2) / e.dn));
    this.wire(e, 0, e.point1, lead, WIRE + 2);
    const c = e.point2;
    const { ctx } = this.pen;
    ctx.beginPath();
    ctx.roundRect(c.x - w / 2, c.y - 9, w, 18, 3);
    ctx.fillStyle = this.pen.theme.background;
    ctx.fill();
    ctx.strokeStyle = this.ink;
    ctx.lineWidth = this.pen.lw(FINE);
    ctx.stroke();
    this.label(s, c, 13, "center", "middle", this.ink, 700);
  }

  logicOutput(e: LogicOutputElm): void {
    this.logicBox(e, e.displayValue, e.lead1 ?? e.point2);
  }

  instructionDisplay(e: InstructionDisplayElm): void {
    const s = e.getDisplayText();
    const w = this.textWidth(s, 12, 600);
    const lead = lerp(e.point1, e.point2, Math.max(0, 1 - (w / 2 + 8) / e.dn));
    this.wire(e, 0, e.point1, lead, WIRE + 2);
    this.pen.text(s, e.point2, font(12, 600), this.hl ? this.pen.theme.accent : this.pen.theme.designatorText, "center", "middle");
  }

  gate(e: GateElm): void {
    // Build the body on the leads before the output bubble moves lead2.
    const ww = e.ww;
    const l1 = lerp(e.point1, e.point2, (e.dn - ww * 2) / (2 * e.dn));
    const l2 = lerp(e.point1, e.point2, (e.dn + ww * 2) / (2 * e.dn));
    const hs2 = e.gwidth * (Math.trunc(e.inputCount / 2) + 1);
    if (settings.symbolStyle === "iec") {
      const invertedInputs = e.hasFlag(GateElm.FLAG_INVERT_INPUTS) || e.hasFlag(GateElm.FLAG_DEMORGAN);
      let input = -Math.trunc(e.inputCount / 2);
      for (let i = 0; i !== e.inputCount; i++, input++) {
        if (input === 0 && (e.inputCount & 1) === 0) input++;
        this.wire(e, i, e.inPosts[i], perpPoint(l1, l2, invertedInputs ? -8 / (ww * 2) : 0, e.gheight * input));
      }
      this.wire(e, e.inputCount, e.lead2!, e.point2);
      const [a, b] = perp(l1, l2, 0, hs2), [d, c] = perp(l1, l2, 1, hs2);
      this.seg([a, b, c, d, a], BODY);
      const label = e instanceof XorGateElm ? "=1" : e.drawAsAndGate() ? "&" : "≥1";
      this.label(label, lerp(l1, l2, 0.5), e.gsize === 1 ? 11 : 17, "center", "middle", this.ink, 600);
      if (e.isInverting() !== e.hasFlag(GateElm.FLAG_DEMORGAN)) this.circle(lerp(e.point1, e.point2, 0.5 + (ww + 4) / e.dn), 3.5, FINE);
      if (invertedInputs) {
        let i0 = -Math.trunc(e.inputCount / 2);
        for (let i = 0; i !== e.inputCount; i++, i0++) {
          if (i0 === 0 && (e.inputCount & 1) === 0) i0++;
          this.circle(perpPoint(l1, l2, -4 / (ww * 2), e.gheight * i0), 3.5, FINE);
        }
      }
      return;
    }
    for (let i = 0; i !== e.inputCount; i++) this.wire(e, i, e.inPosts[i], e.inGates[i]);
    this.wire(e, e.inputCount, e.lead2!, e.point2);
    const { ctx } = this.pen;
    ctx.beginPath();
    if (e.drawAsAndGate()) {
      const [t0, t6] = perp(l1, l2, 0, hs2), [t1, t5] = perp(l1, l2, 0.5, hs2), [t2, t4] = perp(l1, l2, 1, hs2);
      const t3 = l2;
      ctx.moveTo(t0.x, t0.y);
      ctx.lineTo(t1.x, t1.y);
      ctx.bezierCurveTo(t1.x, t1.y, t2.x, t2.y, t3.x, t3.y);
      ctx.bezierCurveTo(t3.x, t3.y, t4.x, t4.y, t5.x, t5.y);
      ctx.lineTo(t6.x, t6.y);
      ctx.closePath();
    } else {
      const [t0, t6] = perp(l1, l2, 0, hs2), [t1, t5] = perp(l1, l2, 0.3, hs2), [t2, t4] = perp(l1, l2, 0.733, hs2 * 0.85);
      const t3 = l2, t7 = lerp(l1, l2, 0.105);
      ctx.moveTo(t0.x, t0.y);
      ctx.lineTo(t1.x, t1.y);
      ctx.bezierCurveTo(t2.x, t2.y, t2.x, t2.y, t3.x, t3.y);
      ctx.bezierCurveTo(t4.x, t4.y, t4.x, t4.y, t5.x, t5.y);
      ctx.lineTo(t6.x, t6.y);
      ctx.bezierCurveTo(t7.x, t7.y, t7.x, t7.y, t0.x, t0.y);
      if (e instanceof XorGateElm) {
        const ww2 = ww === 0 ? e.dn * 2 : ww * 2;
        const [t8, t9] = perp(l1, l2, -0.05 - 8 / ww2, hs2), t10 = lerp(l1, l2, 0.1 - 8 / ww2);
        ctx.moveTo(t8.x, t8.y);
        ctx.bezierCurveTo(t10.x, t10.y, t10.x, t10.y, t9.x, t9.y);
      }
    }
    ctx.strokeStyle = this.ink;
    ctx.lineWidth = this.pen.lw(BODY);
    ctx.stroke();
    if (e.isInverting() !== e.hasFlag(GateElm.FLAG_DEMORGAN)) this.circle(lerp(e.point1, e.point2, 0.5 + (ww + 4) / e.dn), 3.5, FINE);
    if (e.hasFlag(GateElm.FLAG_INVERT_INPUTS) || e.hasFlag(GateElm.FLAG_DEMORGAN)) {
      let i0 = -Math.trunc(e.inputCount / 2);
      for (let i = 0; i !== e.inputCount; i++, i0++) {
        if (i0 === 0 && (e.inputCount & 1) === 0) i0++;
        this.circle(perpPoint(l1, l2, -4 / (ww * 2), e.gheight * i0), 3.5, FINE);
      }
    }
  }

  inverter(e: InverterElm): void {
    this.leads(e);
    const ww = Math.min(16, Math.trunc(e.dn / 2));
    const demorgan = e.hasFlag(InverterElm.FLAG_DEMORGAN);
    const start = demorgan ? lerp(e.point1, e.point2, 0.5 - (ww - 8) / e.dn) : e.lead1!;
    const end = demorgan ? 0.5 + (ww + 2) / e.dn : 0.5 + (ww - 5) / e.dn;
    const [t0, t1] = perp(start, e.lead2!, 0, 16);
    if (settings.symbolStyle === "iec") {
      const bodyEnd = lerp(e.point1, e.point2, end);
      const [u0, u1] = perp(start, bodyEnd, 1, 16);
      this.seg([t0, t1, u1, u0, t0]);
      this.label("1", lerp(start, bodyEnd, 0.5), Math.min(17, Math.max(8, dist(start, bodyEnd) - 4)), "center", "middle", this.ink, 600);
      this.circle(lerp(e.point1, e.point2, demorgan ? 0.5 - (ww - 4) / e.dn : 0.5 + (ww - 1) / e.dn), 3.5, FINE);
      return;
    }
    this.seg([t0, t1, lerp(e.point1, e.point2, end), t0]);
    this.circle(lerp(e.point1, e.point2, demorgan ? 0.5 - (ww - 4) / e.dn : 0.5 + (ww - 1) / e.dn), 3.5, FINE);
  }

  schmitt(e: InvertingSchmittElm): void {
    this.leads(e);
    const l1 = e.lead1!, l2 = e.lead2!;
    const inverting = !(e instanceof SchmittElm);
    const tip = inverting ? lerp(l1, l2, 0.8) : l2;
    const [t0, t1] = perp(l1, l2, 0, 16);
    this.seg([t0, t1, tip, t0]);
    if (inverting) this.circle(lerp(tip, l2, 0.5), Math.max(2.5, dist(tip, l2) / 2 - 0.5), FINE);
    // hysteresis loop
    const f = frame(l1, l2), c = { x: dist(l1, l2) * 0.35, y: 0 };
    const h = [{ x: -6, y: 4 }, { x: 2, y: 4 }, { x: 2, y: -4 }, { x: 6, y: -4 }, { x: -2, y: -4 }, { x: -2, y: 4 }].map((p) => f({ x: c.x + p.x, y: c.y + p.y }));
    this.seg(h, FINE);
  }

  chip(e: ChipElm): void {
    const pins = e.pins;
    const hasVertical = pins.some((p) => p.side === Side.N || p.side === Side.S);
    for (let i = 0; i !== e.getPostCount(); i++) {
      const p = pins[i];
      if (!p || p.busZ > 0) continue;
      this.wire(e, i, p.post, p.stub, p.busWidth > 1 ? WIRE + 2 : WIRE);
      if (p.bubble) this.circle({ x: p.bubbleX, y: p.bubbleY }, 3, FINE, this.ink, this.pen.theme.background);
      if (p.clockPoints) this.seg(p.clockPoints, FINE);
    }
    this.chipOutline(e);
    // pin names inside the outline
    const avail = !hasVertical && e.sizeX > 2 ? e.cspc * 2.5 + e.cspc * (e.sizeX - 3) : e.cspc * 2 - 8;
    for (let i = 0; i !== e.getPostCount(); i++) {
      const p = pins[i];
      if (!p || p.busZ > 0) continue;
      this.pinName(e, p, avail);
    }
  }

  private chipOutline(e: ChipElm): void {
    const r = e.rect;
    const { ctx } = this.pen;
    ctx.strokeStyle = this.ink;
    ctx.lineWidth = this.pen.lw(BODY);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  }

  private pinName(e: ChipElm, p: Pin, avail: number): void {
    const text = p.busWidth > 1 ? `${p.text}/${p.busWidth}` : p.text;
    if (!text) return;
    let px = Math.min(11, 5.5 * e.csize);
    while (px > 4 && this.textWidth(text, px) > avail) px -= 0.5;
    const w = this.textWidth(text, px);
    const west = e.isFlippedX ? Side.E : Side.W, east = e.isFlippedX ? Side.W : Side.E;
    let x: number;
    if (p.side === west) x = p.textloc.x - (e.cspc - 5);
    else if (p.side === east) x = p.textloc.x + (e.cspc - 5) - w;
    else x = p.textloc.x - w / 2;
    const color = this.hl ? this.pen.theme.accent : this.pen.theme.valueText;
    this.label(text, { x, y: p.textloc.y }, px, "left", "middle", color);
    if (p.lineOver) this.seg([{ x, y: p.textloc.y - px * 0.62 }, { x: x + w, y: p.textloc.y - px * 0.62 }], 0.8, color);
  }

  busSplitter(e: BusSplitterElm): void {
    // drawn like upstream's chip, but the bus side is one thick lead
    this.chip(e);
  }

  subcircuit(e: CustomCompositeElm): void {
    const chip = e.chip;
    if (!chip) return;
    // the chip draws with the subcircuit's voltages
    for (let i = 0; i !== e.getPostCount(); i++) chip.volts[i] = e.volts[i];
    this.chip(chip);
    if (chip.label) this.label(chip.label, { x: chip.labelX, y: chip.labelY }, 11, "center", "middle", this.ink, 600);
  }

  sevenSeg(e: SevenSegElm): void {
    let spx = e.cspc * 2;
    if (e.extraSegment !== SevenSegElm.ES_NONE) spx = Math.trunc(spx * 0.9);
    if (e.sizeY <= 4 || e.isFlippedXY) spx = Math.trunc(spx / 2);
    const spy = spx * 2;
    const xl = e.x + e.cspc + e.flippedSizeX * e.cspc - spx;
    let yl = e.y - e.cspc + e.flippedSizeY * e.cspc - spy;
    if (e.sizeY <= 4 && (e.flags & (ChipElm.FLAG_FLIP_Y | ChipElm.FLAG_FLIP_XY)) !== 0) yl += 10;
    const disp = e.baseSegmentCount === 7 ? SevenSegElm.display7 : e.baseSegmentCount === 14 ? SevenSegElm.display14 : SevenSegElm.display16;
    const thick = e.sizeY <= 4 ? 5 : spx / 6;
    for (let i = 0; i !== e.segmentCount && i * 4 + 3 < disp.length; i++) {
      const p1 = { x: xl + disp[i * 4] * spx, y: yl + disp[i * 4 + 1] * spy }, p2 = { x: xl + disp[i * 4 + 2] * spx, y: yl + disp[i * 4 + 3] * spy };
      const d = dist(p1, p2);
      const [p3, p4] = perp(p1, p2, thick / d, thick), [p5, p6] = perp(p1, p2, 1 - thick / d, thick);
      this.pen.fill([p1, p3, p5, p2, p6, p4], this.segmentColor(e, i));
    }
    if (e.extraSegment !== SevenSegElm.ES_NONE) {
      const dpsize = e.sizeY <= 4 ? 7 : e.isFlippedXY ? 3 : 7;
      const color = this.segmentColor(e, e.baseSegmentCount);
      const dot = (x: number, y: number) => this.circle({ x, y }, dpsize / 2, 0.1, color, color);
      if (e.extraSegment === SevenSegElm.ES_DP) dot(xl + spx + Math.max(spx * 1.5, spx + 12), yl + spy * 2);
      else {
        const dx = xl + spx + Math.max(spx * 1.5, spx + 14);
        dot(dx, yl + spy * 0.5);
        dot(dx, yl + spy * 1.5);
      }
    }
  }

  private segmentColor(e: SevenSegElm, p: number): string {
    const pin = e.pins[p];
    if (!pin) return rgbColor(255, 40, 40, 0.15);
    if (e.diodeDirection === 0) return pin.value ? "#ff3b30" : rgbColor(255, 59, 48, 0.14);
    let w = (-e.diodeDirection * pin.current) / 0.01;
    if (w > 0) w = 1 + 0.2 * Math.log(w);
    const a = Math.max(0.14, Math.min(1, w));
    return rgbColor(255, 59, 48, a);
  }

  decimalDisplay(e: DecimalDisplayElm): void {
    let value = 0;
    for (let i = 0; i !== e.bitCount; i++) if (e.pins[i]?.value) value |= 1 << i;
    const s = e.displayMode === 1 ? value.toString(16).toUpperCase() : e.displayMode === 2 ? value.toString(8) : String(value);
    const x = e.x + e.cspc + e.flippedSizeX * e.cspc + 5 * e.csize;
    const y = e.y - e.cspc + e.flippedSizeY * e.cspc;
    this.label(s, { x, y }, 15 * e.csize * 0.8, "center", "middle", this.ink, 600);
  }

  ledArray(e: LEDArrayElm): void {
    for (let ix = 0; ix !== e.sizeX; ix++) {
      for (let iy = 0; iy !== e.sizeY; iy++) {
        const i = ix + iy * e.sizeX;
        const cur = e.currents[i] ?? 0;
        let w = cur / 0.01;
        if (w > 0) w = 1 + 0.2 * Math.log(w);
        const a = Math.max(0.1, Math.min(1, w));
        const px = e.isFlippedXY ? e.pins[iy + e.sizeX].post.x : e.pins[ix].post.x;
        const py = e.isFlippedXY ? e.pins[ix].post.y : e.pins[iy + e.sizeX].post.y;
        const color = rgbColor(255, 59, 48, a);
        this.circle({ x: px, y: py }, e.cspc / 2, 0.1, color, color);
      }
    }
  }

  opAmp(e: OpAmpElm): void {
    const l1 = e.lead1!, l2 = e.lead2!;
    this.wire(e, 0, e.in1p[0], e.in1p[1]);
    this.wire(e, 1, e.in2p[0], e.in2p[1]);
    this.wire(e, 2, l2, e.point2);
    const hs = e.opheight * e.dsign * ((e.flags & OpAmpElm.FLAG_SWAP) !== 0 ? -1 : 1);
    const [t0, t1] = perp(l1, l2, 0, hs * 2);
    this.seg([t0, t1, l2, t0]);
    const [p0, p1] = perp(l1, l2, 0.2, hs);
    const px = e.opsize === 2 ? 14 : 10;
    this.label("−", p0, px);
    this.label("+", p1, px);
  }

  nortonAmp(e: NortonAmpElm): void {
    const ww = Math.min(e.opwidth, Math.trunc(e.dn / 2));
    const l1 = lerp(e.point1, e.point2, (e.dn - ww * 2) / (2 * e.dn)), l2 = lerp(e.point1, e.point2, (e.dn + ww * 2) / (2 * e.dn));
    let hs = e.opheight * e.dsign;
    if ((e.flags & NortonAmpElm.FLAG_SWAP) !== 0) hs = -hs;
    const [i1, i2] = perp(l1, l2, 0, hs);
    this.wire(e, 0, e.getPost(0), i1);
    this.wire(e, 1, e.getPost(1), i2);
    this.wire(e, 2, l2, e.point2);
    const [t0, t1] = perp(l1, l2, 0, hs * 2);
    this.seg([t0, t1, l2, t0]);
    const [p0, p1] = perp(l1, l2, 0.2, hs);
    this.label("+", p0, e.opsize === 2 ? 14 : 10);
    this.label("−", p1, e.opsize === 2 ? 14 : 10);
    this.circle(l1, e.opheight * 0.5, FINE);
  }

  ota(e: OTAElm): void {
    const l1 = e.lead1!, l2 = e.lead2!;
    this.wire(e, 0, e.in1p[0], e.in1p[1]);
    this.wire(e, 1, e.in2p[0], e.in2p[1]);
    this.wire(e, 2, e.point1, l1);
    this.wire(e, 3, e.in4p[0], e.in4p[1]);
    if (dist(e.point2bis, e.point2) > 0) this.wire(e, 4, l2, e.point2);
    const wtot = OTAElm.opwidth * 2 + 2 * OTAElm.circDiam - OTAElm.circOverlap;
    const hs = OTAElm.opheight * e.dsign * (e.hasFlag(OTAElm.FLAG_INPUT_FLIP) ? -1 : 1);
    const [t0, t1] = perp(l1, l2, 0, (3 * hs) / 2);
    const t2 = lerp(l1, l2, (2 * OTAElm.opwidth) / wtot);
    this.seg([t0, t1, t2, t0]);
    this.circle(lerp(l1, l2, 1 - OTAElm.circDiam / (2 * wtot)), OTAElm.circDiam / 2, FINE);
    this.circle(lerp(l1, l2, 1 - ((3 * OTAElm.circDiam) / 2 - OTAElm.circOverlap) / wtot), OTAElm.circDiam / 2, FINE);
    const [p0, p1] = perp(l1, l2, 0.1, hs);
    this.label("+", p0, 14);
    this.label("−", p1, 14);
  }

  private bjt(e: CircuitElm, coll: P[], emit: P[], base: P, pnp: number, collNode: number, emitNode: number): void {
    this.wire(e, collNode, coll[0], coll[1]);
    this.wire(e, emitNode, emit[0], emit[1]);
    this.wire(e, 0, e.point1, base);
    // base bar
    const [r0, r1] = perp(e.point1, e.point2, 1 - 16 / e.dn, 16), [r2, r3] = perp(e.point1, e.point2, 1 - 13 / e.dn, 16);
    this.pen.fill([r0, r2, r3, r1], this.ink);
    this.pen.fill(pnp === 1 ? arrow(emit[1], emit[0], 8, 4) : arrow(emit[0], emit[1], 8, 4), this.ink);
  }

  transistor(e: TransistorElm): void {
    if (e.coll.length < 2) return;
    // a circle round it (Circle symbol), as CircuitJS: halfway from the base point to the far end
    if (e.hasCircle) this.circle(lerp(e.base, e.point2, 0.5), 20, FINE);
    this.bjt(e, e.coll, e.emit, e.base, e.pnp, 1, 2);
  }

  darlington(e: DarlingtonElm): void {
    if (e.coll.length < 2) return;
    this.bjt(e, e.coll, e.emit, e.base, e.pnp, 1, 2);
    // the second collector line marks the pair
    const c2 = [perpPoint(e.point1, e.point2, 1, 16 * e.dsign * e.pnp - 5 * e.dsign * e.pnp), perpPoint(e.point1, e.point2, 1 - 13 / e.dn, e.dsign * e.pnp)];
    this.wire(e, 1, c2[0], c2[1]);
    this.wire(e, 1, e.coll[0], c2[0]);
  }

  unijunction(e: UnijunctionElm): void {
    if (e.b1.length < 3) return;
    this.wire(e, 1, e.b1[0], e.b1[1]);
    this.wire(e, 1, e.b1[1], e.b1[2]);
    this.wire(e, 2, e.b2[0], e.b2[1]);
    this.wire(e, 2, e.b2[1], e.b2[2]);
    this.wire(e, 0, e.emitter[0], e.emitter[1]);
    this.wire(e, 0, e.emitter[1], e.emitter[2]);
    this.pen.fill(arrow(e.emitter[1], e.emitter[2], 8, 3), this.ink);
    const flip = e.hasFlag(UnijunctionElm.FLAG_FLIP) ? -1 : 1;
    const hs2 = 16 * e.dsign * flip;
    const p1 = perpPoint(e.point1, e.point2, 0, -hs2), p2 = perpPoint(e.point1, e.point2, 1, -hs2);
    const [a, b] = perp(p1, p2, 1 - 13 / dist(p1, p2), 16), [c, d] = perp(p1, p2, 1 - 10 / dist(p1, p2), 16);
    this.pen.fill([a, b, d, c], this.ink);
  }

  jfet(e: JfetElm): void {
    const { src, drn } = e;
    if (src.length < 3) return;
    this.wire(e, 1, src[0], src[1]);
    this.wire(e, 1, src[1], src[2]);
    this.wire(e, 2, drn[0], drn[1]);
    this.wire(e, 2, drn[1], drn[2]);
    this.wire(e, 0, e.point1, e.gatePt);
    // channel bar, and the gate arrow (into the channel for n-channel, out of it for p-channel)
    this.seg([lerp(src[2], drn[2], -0.4), lerp(src[2], drn[2], 1.4)], BODY + 1.5);
    const g = e.gatePt, back = lerp(g, e.point1, 8 / Math.max(8, dist(g, e.point1)));
    this.pen.fill(e.pnp === 1 ? arrow(e.point1, g, 8, 4) : arrow(g, back, 8, 4), this.ink);
  }

  led(e: LEDElm): void {
    const l1 = e.lead1!, l2 = e.lead2!;
    this.leads(e);
    const c = lerp(l1, l2, 0.5);
    const b = e.brightness;
    if (b > 0) this.circle(c, 12, 0.1, "transparent", rgbColor(255 * e.colorR, 255 * e.colorG, 255 * e.colorB, 0.15 + 0.6 * b));
    this.circle(c, 12, FINE);
    const a = lerp(l1, l2, 0.5 - 8 / dist(l1, l2)), k = lerp(l1, l2, 0.5 + 8 / dist(l1, l2));
    this.diodeBody(a, k, 7);
  }

  varactor(e: VaractorElm): void {
    this.leads(e);
    const l1 = e.lead1!, l2 = e.lead2!;
    const k = lerp(l1, l2, 1 - 4 / dist(l1, l2));
    this.diodeBody(l1, k, 8, false);
    this.seg(perp(l1, l2, 1, 8));
  }

  tunnelDiode(e: TunnelDiodeElm): void {
    this.leads(e);
    const l1 = e.lead1!, l2 = e.lead2!;
    const [a0, a1] = perp(l1, l2, 0, 8);
    this.pen.fill([a0, a1, l2], this.ink);
    const [c0, c1] = perp(l1, l2, 1, 8);
    this.seg([perpPoint(l1, l2, 0.8, 8), c0, c1, perpPoint(l1, l2, 0.8, -8)]);
  }

  scr(e: SCRElm): void {
    this.leads(e);
    this.diodeBody(e.lead1!, e.lead2!, 8);
    if (e.gate.length >= 2 && e.gate[0] !== e.gate[1]) {
      this.wire(e, 2, e.lead2!, e.gate[0]);
      this.wire(e, 2, e.gate[0], e.gate[1]);
    }
  }

  triac(e: TriacElm): void {
    this.leads(e);
    const l1 = e.lead1!, l2 = e.lead2!;
    // two antiparallel diodes stacked between the plates
    const [a0, a1] = perp(l1, l2, 0, 8), [b0, b1] = perp(l1, l2, 1, 8);
    this.pen.fill([a0, l1, perpPoint(l1, l2, 1, 4)], this.ink);
    this.pen.fill([b1, l2, perpPoint(l1, l2, 0, -4)], this.ink);
    this.seg([a0, a1]);
    this.seg([b0, b1]);
    if (e.gate.length >= 2) {
      this.wire(e, 2, l2, e.gate[0]);
      this.wire(e, 2, e.gate[0], e.gate[1]);
    }
  }

  diac(e: DiacElm): void {
    this.leads(e);
    const l1 = e.lead1!, l2 = e.lead2!;
    const [a0, a1] = perp(l1, l2, 0, 8), [b0, b1] = perp(l1, l2, 1, 8);
    this.pen.fill([a0, l1, perpPoint(l1, l2, 1, 4)], this.ink);
    this.pen.fill([b1, l2, perpPoint(l1, l2, 0, -4)], this.ink);
    this.seg([a0, a1]);
    this.seg([b0, b1]);
  }

  triode(e: TriodeElm): void {
    if (e.plate.length < 4 || e.cath.length < 4) return;
    this.circle(e.point2, 20, FINE, this.pen.theme.valueText);
    this.wire(e, 0, e.plate[0], e.plate[1]);
    this.seg([e.plate[2], e.plate[3]]);
    this.wire(e, 1, e.grid[0], e.grid[1]);
    for (let i = 2; i + 1 < e.grid.length; i += 2) this.seg([e.grid[i], e.grid[i + 1]], FINE);
    for (let i = 0; i !== 3; i++) this.wire(e, 2, e.cath[i], e.cath[i + 1]);
  }

  switch2(e: Switch2Elm): void {
    this.wire(e, 0, e.point1, e.lead1!);
    for (let i = 0; i !== e.throwCount; i++) this.wire(e, i + 1, e.swpoles[i], e.swposts[i]);
    const pole = e.swpoles[Math.min(e.position, e.throwCount - 1)];
    if (pole && !(e.position === 2 && e.hasCenterOff())) this.seg([e.lead1!, pole]);
    else if (pole) this.seg([e.lead1!, lerp(e.swpoles[0], e.swpoles[e.throwCount - 1], 0.5)]);
    // swpoles has one more point than throws (the center-off position), which isn't a contact
    for (const p of [e.lead1!, ...e.swpoles.slice(0, e.throwCount)]) this.circle(p, 2.5, FINE, this.ink, this.pen.theme.background);
  }

  pushSwitch(e: SwitchElm): void {
    this.leads(e);
    // in reading order, so the plunger is on the same side whichever way the part was dragged
    const [l1, l2] = readingOrder(e.lead1!, e.lead2!);
    const off = e.position === 0 ? 2 : 8;
    const [b0, b1] = [perpPoint(l1, l2, 0, off), perpPoint(l1, l2, 1, off)];
    this.seg([b0, b1]);
    const m = lerp(b0, b1, 0.5);
    this.seg([m, perpPoint(l1, l2, 0.5, off + 8)], FINE);
    for (const p of [l1, l2]) this.circle(p, 2.5, FINE, this.ink, this.pen.theme.background);
  }

  crossSwitch(e: CrossSwitchElm): void {
    const cp = e.crossPoints, tp = e.throwPosts;
    if (cp.length < 6 || tp.length < 4) return;
    const h = CrossSwitchElm.openhs * e.geometryFlip, l1 = e.lead1!, l2 = e.lead2!;
    const contacts: P[] = [];
    // the crossed wiring behind the throws
    for (const [a, b] of [[cp[1], cp[2]], [cp[1], cp[3]], [cp[3], tp[0]], [tp[0], tp[3]]]) this.wire(e, 1, a, b);
    for (const [a, b] of [[tp[2], cp[5]], [tp[1], cp[0]], [cp[0], cp[4]], [cp[4], cp[5]]]) this.wire(e, 3, a, b);
    for (let i = 0; i !== 2; i++) {
      const offset = -i * h * 3;
      const poleLead = perpPoint(l1, l2, 0, offset);
      const t0 = perpPoint(l1, l2, 1, offset - h), t1 = perpPoint(l1, l2, 1, offset + h);
      this.wire(e, i * 2, e.polePosts[i], poleLead);
      this.wire(e, i * 2 + 1, tp[i * 2], t0);
      this.wire(e, i * 2 + 1, tp[i * 2 + 1], t1);
      this.seg([poleLead, e.position === 0 ? t0 : t1]);
      contacts.push(poleLead, t0, t1);
    }
    // the two poles move together
    const { ctx } = this.pen;
    ctx.save();
    ctx.setLineDash([4, 4]);
    const adj = e.position * -3;
    this.seg([perpPoint(e.point1, e.point2, 0.5, -h * (0.5 - e.position) + adj), perpPoint(e.point1, e.point2, 0.5, -h * 3 - h * (0.5 - e.position) + 7 + adj)], FINE);
    ctx.restore();
    // contacts as on the other switches
    for (const p of contacts) this.circle(p, 2.5, FINE, this.ink, this.pen.theme.background);
  }

  analogSwitch(e: AnalogSwitchElm): void {
    this.leads(e);
    const l1 = e.lead1!, l2 = e.lead2!;
    const hs = e.open ? e.openhs : 2;
    this.seg([l1, perpPoint(l1, l2, 1, hs)]);
    this.wire(e, 2, e.point3, lerp(e.point3, lerp(l1, l2, 0.5), 0.5));
    this.seg([lerp(e.point3, lerp(l1, l2, 0.5), 0.5), lerp(l1, l2, 0.5)], FINE);
  }

  analogSwitch2(e: AnalogSwitch2Elm): void {
    this.wire(e, 0, e.point1, e.lead1!);
    this.wire(e, 1, e.swpoles[0], e.swposts[0]);
    this.wire(e, 2, e.swpoles[1], e.swposts[1]);
    this.seg([e.lead1!, e.swpoles[e.open ? 1 : 0]]);
    this.wire(e, 3, e.ctlPoint, lerp(e.ctlPoint, lerp(e.lead1!, e.lead2!, 0.5), 0.6));
  }

  pot(e: PotElm): void {
    this.leads(e);
    this.seg(resistorBodyPath(e.lead1!, e.lead2!));
    // wiper
    this.wire(e, 2, e.post3, e.corner2);
    this.wire(e, 2, e.corner2, e.arrowPoint);
    this.pen.fill(arrow(e.corner2, e.arrowPoint, 8, 4), this.ink);
  }

  transformer(e: TransformerElm): void {
    const ends = e.ptEnds, core = e.ptCore;
    if (ends.length < 4) return;
    const drawn = windingPoints(e);
    for (let i = 0; i !== 4; i++) this.wire(e, i, ends[i], drawn[i]);
    this.coilTowardCore(drawn[0], drawn[2], core);
    this.coilTowardCore(drawn[1], drawn[3], core);
    this.seg([core[0], core[2]], BODY);
    this.seg([core[1], core[3]], BODY);
    if (e.dots) for (let i = 0; i < e.dots.length; i++) {
      const d = e.dots[i], axis = unit(e.point1, e.point2);
      const shift = windingShift();
      const sign = i === 0 ? -1 : 1;
      this.circle({ ...d, x: d.x + axis.x * shift * sign, y: d.y + axis.y * shift * sign }, 2, 0.1, this.ink, this.ink);
    }
  }

  tappedTransformer(e: TappedTransformerElm): void {
    const ends = e.ptEnds, core = e.ptCore;
    if (ends.length < 5) return;
    const drawn = windingPoints(e);
    for (let i = 0; i !== 5; i++) this.wire(e, i, ends[i], drawn[i]);
    for (let i = 0; i !== 4; i++) {
      if (i === 1) continue;
      this.coilTowardCore(drawn[i], drawn[i + 1], core);
    }
    for (let i = 0; i + 1 < core.length; i += 2) this.seg([core[i], core[i + 1]]);
  }

  relay(e: RelayElm): void {
    if (e.coilPosts.length < 2) return;
    const nCoil = e.nCoil1;
    this.wire(e, nCoil, e.coilPosts[0], e.coilLeads[0]);
    this.wire(e, nCoil + 1, e.coilPosts[1], e.coilLeads[1]);
    this.coil(e.coilLeads[0], e.coilLeads[1], e.dsign, 4);
    for (let p = 0; p !== e.poleCount(); p++) {
      const po = p * 3;
      if (!e.swposts[p]) continue;
      this.wire(e, po, e.swposts[p][0], e.swpoles[p][0]);
      this.wire(e, po + 1, e.swposts[p][1], e.swpoles[p][1]);
      this.wire(e, po + 2, e.swposts[p][2], e.swpoles[p][2]);
      this.seg([e.swpoles[p][0], e.swpoles[p][e.i_position === 0 ? 1 : 2]]);
    }
    if (e.outline.length) {
      const { ctx } = this.pen;
      ctx.save();
      ctx.setLineDash([3, 3]);
      this.seg([...e.outline, e.outline[0]], FINE, this.pen.theme.valueText);
      ctx.restore();
    }
  }

  relayCoil(e: RelayCoilElm): void {
    if (e.coilLeads.length < 2) return;
    this.wire(e, 0, e.point1, e.coilLeads[0]);
    this.wire(e, 1, e.coilLeads[1], e.point2);
    const [a0, a1] = perp(e.coilLeads[0], e.coilLeads[1], 0, 10), [b0, b1] = perp(e.coilLeads[0], e.coilLeads[1], 1, 10);
    this.seg([a0, b0, b1, a1, a0]);
    if (e.label) {
      const { ctx } = this.pen;
      // the text runs along the coil: left to right, or bottom to top on an upright coil
      const [c0, c1] = [e.coilLeads[0], e.coilLeads[1]];
      const upright = Math.abs(c1.y - c0.y) > Math.abs(c1.x - c0.x);
      const room = dist(c0, c1) - 8;
      let size = 10;
      while (size > 8) {
        ctx.font = font(size);
        if (ctx.measureText(e.label).width <= room) break;
        size--;
      }
      ctx.font = font(size);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = this.pen.theme.valueText;
      const p = lerp(c0, c1, 0.5);
      ctx.save();
      ctx.translate(p.x, p.y);
      if (upright) ctx.rotate(-Math.PI / 2);
      ctx.fillText(e.label, 0, 0, room);
      ctx.restore();
    }
  }

  relayContact(e: RelayContactElm): void {
    if (e.swposts.length < 2) return;
    this.wire(e, 0, e.point1, e.lead1 ?? e.point1);
    this.wire(e, 1, e.swposts[1] ?? e.point2, e.swpoles[1] ?? e.point2);
    const closed = e.i_position === 0;
    this.seg([e.lead1 ?? e.point1, closed ? e.swpoles[1] : perpPoint(e.lead1 ?? e.point1, e.swpoles[1], 1, 10)]);
  }

  labeledRail(e: ExtVoltageElm | NoiseElm | DataInputElm | AudioInputElm): void {
    const l1 = e.lead1 ?? e.point2;
    this.wire(e, 0, e.point1, l1);
    let s: string;
    if (e instanceof ExtVoltageElm) s = e.name;
    else if (e instanceof DataInputElm || e instanceof AudioInputElm) s = e.railText;
    else s = "Noise";
    const u = unit(e.point1, e.point2);
    const gap = 5;
    // the text starts where the drawn lead ends
    const p = { x: l1.x + u.x * gap, y: l1.y + u.y * gap };
    const horizontal = Math.abs(u.x) >= Math.abs(u.y);
    const align: CanvasTextAlign = horizontal ? (u.x >= 0 ? "left" : "right") : "center";
    const baseline: CanvasTextBaseline = horizontal ? "middle" : (u.y >= 0 ? "top" : "bottom");
    this.pen.text(s, p, font(11, 600), this.hl ? this.pen.theme.accent : this.pen.theme.designatorText, align, baseline);
  }

  antenna(e: AntennaElm): void {
    this.wire(e, 0, e.point1, e.point2);
    const u = unit(e.point1, e.point2), n = { x: -u.y, y: u.x };
    const t = e.point2;
    const top = { x: t.x + u.x * 16, y: t.y + u.y * 16 };
    this.seg([t, top]);
    this.seg([{ x: top.x + n.x * 8, y: top.y + n.y * 8 }, t, { x: top.x - n.x * 8, y: top.y - n.y * 8 }]);
  }

  sweep(e: SweepElm): void {
    const c = e.point2;
    this.wire(e, 0, e.point1, lerp(e.point1, e.point2, Math.max(0, 1 - SweepElm.circleSize / e.dn)));
    this.circle(c, SweepElm.circleSize);
    const pts: P[] = [];
    for (let i = -12; i <= 12; i++) {
      const t = (i + 12) / 24;
      pts.push({ x: c.x + i, y: c.y - 7 * Math.sin(t * t * 14) });
    }
    this.smoothSeg(pts, FINE);
  }

  polarCap(e: PolarCapacitorElm): void {
    const l1 = e.lead1!, l2 = e.lead2!;
    this.wire(e, 0, e.point1, l1);
    this.wire(e, 1, e.point2, l2);
    this.seg(perp(l1, l2, 0, 11), BODY + 0.75);
    // curved (negative) plate
    const f = frame(l1, l2), len = dist(l1, l2);
    const start = f({ x: len + 3, y: -11 });
    const control = f({ x: len - 3, y: 0 });
    const end = f({ x: len + 3, y: 11 });
    const { ctx } = this.pen;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
    ctx.strokeStyle = this.ink;
    ctx.lineWidth = this.pen.lw(BODY + 0.75);
    ctx.stroke();
    const plus = f({ x: -5, y: -9 });
    this.seg([{ x: plus.x - 3, y: plus.y }, { x: plus.x + 3, y: plus.y }], FINE);
    this.seg([{ x: plus.x, y: plus.y - 3 }, { x: plus.x, y: plus.y + 3 }], FINE);
  }

  lamp(e: LampElm): void {
    this.leads(e);
    const l1 = e.lead1!, l2 = e.lead2!;
    const c = lerp(l1, l2, 0.5);
    const glow = Math.max(0, Math.min(1, (e.temp - 400) / 2000));
    this.circle(c, 14, BODY, this.ink, glow > 0 ? rgbColor(255, 214, 90, 0.12 + 0.6 * glow) : null);
    const r = 14 / Math.SQRT2;
    this.seg([{ x: c.x - r, y: c.y - r }, { x: c.x + r, y: c.y + r }], FINE);
    this.seg([{ x: c.x - r, y: c.y + r }, { x: c.x + r, y: c.y - r }], FINE);
  }

  sparkGap(e: SparkGapElm): void {
    this.leads(e);
    const l1 = e.lead1!, l2 = e.lead2!;
    const m1 = lerp(l1, l2, 0.42), m2 = lerp(l1, l2, 0.58);
    this.pen.fill(arrow(l1, m1, dist(l1, m1), 6), this.ink);
    this.pen.fill(arrow(l2, m2, dist(l2, m2), 6), this.ink);
  }

  memristor(e: MemristorElm): void {
    this.leads(e);
    const l1 = e.lead1!, l2 = e.lead2!;
    const len = dist(l1, l2), f = frame(l1, l2), hs = 6;
    this.seg([{ x: 0, y: -hs }, { x: len, y: -hs }, { x: len, y: hs }, { x: 0, y: hs }, { x: 0, y: -hs }].map(f));
    // the wave in reading order (the polarity band below stays at lead2)
    const [r1, r2] = readingOrder(l1, l2), fw = frame(r1, r2);
    const pts: P[] = [{ x: 0, y: 0 }];
    const n = 6;
    for (let i = 0; i < n; i++) {
      const x0 = (i * len) / n, x1 = ((i + 0.5) * len) / n;
      pts.push({ x: x0, y: i % 2 ? hs / 2 : -hs / 2 }, { x: x1, y: i % 2 ? hs / 2 : -hs / 2 });
    }
    this.seg(pts.map(fw), FINE);
    this.pen.fill([{ x: len - 5, y: -hs }, { x: len, y: -hs }, { x: len, y: hs }, { x: len - 5, y: hs }].map(f), this.ink);
  }

  transLine(e: TransLineElm): void {
    if (e.posts.length < 4) return;
    for (let i = 0; i !== 4; i++) this.wire(e, i, e.posts[i], e.inner[i]);
    this.seg([e.inner[0], e.inner[1]]);
    this.seg([e.inner[2], e.inner[3]]);
  }

  ammeter(e: AmmeterElm): void {
    const c = lerp(e.point1, e.point2, 0.5);
    // in a circle (Circle symbol), or the leads stopping short of a bare A
    const circle = e.hasFlag(AmmeterElm.FLAG_CIRCLE);
    const r = circle ? 12 : 8;
    this.wire(e, 0, e.point1, lerp(e.point1, e.point2, 0.5 - r / e.dn));
    this.wire(e, 1, lerp(e.point1, e.point2, 0.5 + r / e.dn), e.point2);
    if (circle) this.circle(c, r);
    this.label("A", c, 12, "center", "middle", this.ink, 600);
  }

  gyrator(e: GyratorElm): void {
    const ends = e.ptEnds, stubs = e.ptStub;
    if (ends.length < 4) return;
    for (let i = 0; i !== 4; i++) this.wire(e, i, ends[i], stubs[i]);
    const xs = stubs.map((p) => p.x), ys = stubs.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    this.seg([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }]);
    this.label("G", { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, 12, "center", "middle", this.ink, 600);
  }

  audioOutput(e: AudioOutputElm): void {
    const u = unit(e.point1, e.point2), n = { x: -u.y, y: u.x };
    const body = lerp(e.point1, e.point2, Math.max(0, 1 - 12 / e.dn));
    this.wire(e, 0, e.point1, body);
    const at = (a: number, b: number) => ({ x: body.x + u.x * a + n.x * b, y: body.y + u.y * a + n.y * b });
    this.seg([at(0, -5), at(6, -5), at(6, 5), at(0, 5), at(0, -5)]);
    this.seg([at(6, -5), at(14, -11), at(14, 11), at(6, 5)]);
  }

  scope(e: ScopeElm): void {
    const x0 = Math.min(e.x, e.x2), y0 = Math.min(e.y, e.y2), w = Math.abs(e.x2 - e.x), h = Math.abs(e.y2 - e.y);
    const { ctx } = this.pen;
    ctx.strokeStyle = this.hl ? this.pen.theme.accent : this.pen.theme.valueText;
    ctx.lineWidth = this.pen.lw(FINE);
    ctx.strokeRect(x0, y0, w, h);
    this.label("scope", { x: x0 + w / 2, y: y0 + h / 2 }, 10, "center", "middle", this.pen.theme.valueText);
  }

  crystal(e: CrystalElm): void {
    this.leads(e);
    const l1 = e.lead1!, l2 = e.lead2!;
    this.seg(perp(l1, l2, 0, 8));
    this.seg(perp(l1, l2, 1, 8));
    const f2 = (e.dn / 2 - 5) / e.dn;
    const [s0, s1] = perp(e.point1, e.point2, f2, 10), [s3, s2] = perp(e.point1, e.point2, 1 - f2, 10);
    this.seg([s0, s1, s2, s3, s0]);
  }

  motor(e: ThreePhaseMotorElm): void {
    const center = e.motorCenter, radius = 37;
    const axis = unit(e.point1, e.point2), normal = { x: -axis.y, y: axis.x };
    for (let i = 0; i !== 6; i++) {
      const post = e.posts[i];
      const dx = post.x - center.x, dy = post.y - center.y;
      const along = dx * axis.x + dy * axis.y, across = dx * normal.x + dy * normal.y;
      const rim = Math.sqrt(Math.max(0, radius * radius - across * across));
      if (Math.abs(along) > rim) this.wire(e, i, post, {
        x: center.x + Math.sign(along) * rim * axis.x + across * normal.x,
        y: center.y + Math.sign(along) * rim * axis.y + across * normal.y,
      });
    }
    this.circle(e.motorCenter, 37, BODY, this.ink);
    this.label("M", e.motorCenter, 18, "center", "middle", this.ink, 600);
    this.label("3~", { x: e.motorCenter.x, y: e.motorCenter.y + 15 }, 10, "center", "middle", this.pen.theme.valueText);
  }

  motorProtection(e: MotorProtectionSwitchElm): void {
    const p = (x: number, y: number) => e.symbolPoint(x, y);
    for (let i = 0; i !== 3; i++) {
      const x = e.x + i * 48;
      this.wire(e, i * 2, e.posts[i * 2], p(x, e.y + 32));
      if (!e.blown) this.seg([p(x, e.y + 32), p(x, e.y + 64)]);
      else this.seg([p(x - 16, e.y + 32), p(x, e.y + 64)]);
      this.seg([p(x, e.y + 64), p(x, e.y + 80)]);
      this.seg([p(x, e.y + 80), p(x, e.y + 96), p(x - 12, e.y + 96), p(x - 12, e.y + 112), p(x, e.y + 112), p(x, e.y + 128)], FINE);
      this.label("I>", p(x, e.y + 152), 14, "center", "middle", this.pen.theme.valueText);
      this.wire(e, i * 2 + 1, p(x, e.y + 176), e.posts[i * 2 + 1]);
    }
    this.seg([p(e.x - 24, e.y + 80), p(e.x + 120, e.y + 80), p(e.x + 120, e.y + 176), p(e.x - 24, e.y + 176), p(e.x - 24, e.y + 80)], FINE, this.pen.theme.valueText);
    if (e.label) this.label(e.label, p(e.x + 120, e.y + 48), 11, "left", "middle", this.pen.theme.valueText);
  }

  meterCircle(e: CircuitElm, sym: string): void {
    this.leads(e);
    const c = lerp(e.lead1 ?? e.point1, e.lead2 ?? e.point2, 0.5);
    this.circle(c, 12);
    this.label(sym, c, 13, "center", "middle", this.ink, 600);
  }

  battery(e: BatteryElm): void {
    // two cells (short thick plate −, long thin plate +), all four plates 6 px apart; CircuitJS's
    // 8 px lead gap is too narrow for them, so the body spans 18 px around the middle
    const at = (d: number) => Math.min(1, Math.max(0, 0.5 + d / e.dn));
    this.wire(e, 0, e.point1, lerp(e.point1, e.point2, at(-9)));
    this.wire(e, 1, lerp(e.point1, e.point2, at(9)), e.point2);
    this.seg(perp(e.point1, e.point2, at(-9), 6), BODY + 1.5);
    this.seg(perp(e.point1, e.point2, at(-3), 12), BODY);
    this.seg(perp(e.point1, e.point2, at(3), 6), BODY + 1.5);
    this.seg(perp(e.point1, e.point2, at(9), 12), BODY);
  }

  modSource(e: AMElm, text: string): void {
    this.wire(e, 0, e.point1, e.lead1 ?? e.point2);
    this.circle(e.point2, AMElm.circleSize);
    this.label(text, e.point2, 11, "center", "middle", this.ink, 600);
  }

  wattmeter(e: WattmeterElm): void {
    if (e.posts.length < 4) return;
    for (let i = 0; i !== 4; i++) this.wire(e, i, e.posts[i], e.inner[i]);
    // current path straight through, voltage sense on the other side
    this.wire(e, 2, e.inner[2], e.inner[3]);
    if (e.rect.length === 4) this.seg([...e.rect, e.rect[0]]);
    this.label(si(e.reading, "W"), e.center, 11, "center", "middle", this.ink, 600);
  }

  testPoint(e: TestPointElm): void {
    const T = TestPointElm;
    const v = e.meterValue(e.meter);
    const s = e.meter === T.TP_BIN ? String(v) : e.meter === T.TP_DUT ? v.toFixed(3) : si(v, ["V", "V", "V", "V", "V", "", "Hz", "s", "s", "", "V"][e.meter] ?? "V");
    const lead = lerp(e.point1, e.point2, Math.max(0, 1 - 12 / e.dn));
    this.wire(e, 0, e.point1, lead);
    this.pen.text(e.label, e.point2, font(11, 600), this.hl ? this.pen.theme.accent : this.pen.theme.designatorText, "center", "bottom");
    this.pen.text(s, { x: e.point2.x, y: e.point2.y + 2 }, font(10.5), this.pen.theme.valueText, "center", "top");
  }

  /** A connection tag with a word in it (stop trigger, data export). */
  tag(e: CircuitElm, word: string, active: boolean): void {
    const lead = e.lead1 ?? e.point2;
    this.wire(e, 0, e.point1, lead);
    const u = unit(e.point1, e.point2);
    const w = this.textWidth(word, 10, 600) + 10, h = 14;
    const horizontal = Math.abs(u.x) >= Math.abs(u.y);
    const c = horizontal ? { x: lead.x + u.x * (w / 2), y: lead.y } : { x: lead.x, y: lead.y + u.y * (h / 2) };
    const { ctx } = this.pen;
    ctx.beginPath();
    ctx.roundRect(c.x - w / 2, c.y - h / 2, w, h, 7);
    ctx.strokeStyle = active ? this.pen.theme.error : this.ink;
    ctx.lineWidth = this.pen.lw(FINE);
    ctx.stroke();
    this.label(word, c, 10, "center", "middle", active ? this.pen.theme.error : this.ink, 600);
  }

  ldr(e: LDRElm): void {
    this.leads(e);
    this.seg(resistorBodyPath(e.lead1!, e.lead2!));
    // incoming light: two arrows, below the body (or left of it) whichever way it was dragged
    const f = frame(...readingOrder(e.lead1!, e.lead2!));
    for (const x0 of [-8, 12]) {
      const a = f({ x: x0, y: 26 }), b = f({ x: x0 + 16, y: 12 });
      this.seg([a, b], FINE);
      this.pen.fill(arrow(a, b, 5, 3), this.ink);
    }
  }

  thermistor(e: ThermistorNTCElm): void {
    this.leads(e);
    this.seg(resistorBodyPath(e.lead1!, e.lead2!));
    const f = frame(...readingOrder(e.lead1!, e.lead2!)), len = dist(e.lead1!, e.lead2!);
    this.seg([f({ x: -6, y: 12 }), f({ x: 6, y: 12 }), f({ x: len, y: -12 })], FINE);
  }

  dcMotor(e: DCMotorElm): void {
    this.leads(e);
    const c = e.motorCenter;
    this.circle(c, 18);
    this.label("M", c, 14, "center", "middle", this.ink, 600);
  }

  /** Op-amp-like triangle between the leads with ± inputs (comparator, real op-amp). */
  private ampTriangle(e: CircuitElm, in1: P[], in2: P[], plusFirst: boolean, hs: number): void {
    const l1 = e.lead1!, l2 = e.lead2!;
    this.wire(e, 0, in1[0], in1[1]);
    this.wire(e, 1, in2[0], in2[1]);
    this.wire(e, 2, l2, e.point2);
    const [t0, t1] = perp(l1, l2, 0, hs * 2);
    this.seg([t0, t1, l2, t0]);
    const [p0, p1] = perp(l1, l2, 0.2, hs);
    this.label(plusFirst ? "+" : "−", p0, 13);
    this.label(plusFirst ? "−" : "+", p1, 13);
  }

  comparator(e: ComparatorElm): void {
    if (e.in1p.length < 2) return;
    const hs = e.opheight * e.dsign * (e.hasFlag(ComparatorElm.FLAG_SWAP) ? -1 : 1);
    this.ampTriangle(e, e.in1p, e.in2p, false, hs);
    // open-collector mark
    const m = lerp(e.lead1!, e.lead2!, 0.5);
    this.seg([{ x: m.x - 3, y: m.y + 3 }, { x: m.x + 3, y: m.y + 3 }, { x: m.x, y: m.y - 3 }, { x: m.x - 3, y: m.y + 3 }], FINE);
  }

  opAmpReal(e: OpAmpRealElm): void {
    if (e.in1p.length < 2) return;
    const hs = OpAmpRealElm.opheight * e.dsign * ((e.flags & OpAmpRealElm.FLAG_SWAP) !== 0 ? -1 : 1);
    this.ampTriangle(e, e.in1p, e.in2p, false, hs);
    this.wire(e, 3, e.rail1p[0], e.rail1p[1]);
    this.wire(e, 4, e.rail2p[0], e.rail2p[1]);
  }

  triState(e: TriStateElm): void {
    const l1 = e.lead1!, l2 = e.lead2!;
    const bus = e.busWidth > 1 ? WIRE + 2 : WIRE;
    this.wire(e, 0, e.point1, l1, bus);
    this.wire(e, e.busWidth, l2, e.point2, bus);
    const ww = Math.min(16, Math.trunc(e.dn / 2));
    const [t0, t1] = perp(l1, l2, 0, 18);
    this.seg([t0, t1, lerp(l1, l2, 0.5 + (ww - 2) / 32), t0]);
    this.wire(e, e.controlNode(), e.point3, e.lead3);
  }

  delayBuffer(e: DelayBufferElm): void {
    this.leads(e);
    const [t0, t1] = perp(e.lead1!, e.lead2!, 0, 16);
    this.seg([t0, t1, e.lead2!, t0]);
    this.label("Δt", lerp(e.lead1!, e.lead2!, 0.35), 9, "center", "middle", this.ink);
  }

  optocoupler(e: OptocouplerElm): void {
    for (let i = 0; i !== 4; i++) if (e.stubs[i]) this.wire(e, i, e.getPost(i), e.stubs[i]);
    const r = e.rect;
    const { ctx } = this.pen;
    ctx.strokeStyle = this.ink;
    ctx.lineWidth = this.pen.lw(BODY);
    this.seg([[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h], [r.x, r.y]].map(([x, y]) => e.symbolPoint(x, y)));
    // the LED and phototransistor inside
    const d = e.diode, t = e.transistor;
    if (d.lead1 && d.lead2) this.diodeBody(d.lead1, d.lead2, 7);
    if (t.coll.length >= 2) {
      this.seg([t.coll[0], t.coll[1]]);
      this.seg([t.emit[0], t.emit[1]]);
      const [r0, r1] = perp(t.point1, t.point2, 1 - 16 / t.dn, 12), [r2, r3] = perp(t.point1, t.point2, 1 - 13 / t.dn, 12);
      this.pen.fill([r0, r2, r3, r1], this.ink);
      this.pen.fill(arrow(t.emit[1], t.emit[0], 6, 3), this.ink);
    }
    // light
    const sx = (e.x + (e.isFlippedX() ? 64 : 32)) + (e.isFlippedX() ? -2 : 2) + (e.isFlippedX() ? -16 : 16);
    const sy = r.y + r.h / 2;
    for (const dy of [-5, 5]) {
      const a = e.symbolPoint(sx, sy + dy), b = e.symbolPoint(sx + (e.isFlippedX() ? -16 : 16), sy + dy);
      this.seg([a, b], FINE);
      this.pen.fill(arrow(a, b, 5, 2.5), this.ink);
    }
  }

  dpdt(e: DPDTSwitchElm): void {
    for (let i = 0; i !== e.poleCount; i++) {
      this.wire(e, i * 3, e.polePosts[i], e.poleLeads[i]);
      this.wire(e, i * 3 + 1, e.throwPosts[i * 2], e.throwLeads[i * 4]);
      this.wire(e, i * 3 + 2, e.throwPosts[i * 2 + 1], e.throwLeads[i * 4 + 1]);
      this.seg([e.poleLeads[i], e.throwLeads[i * 4 + e.position]]);
      for (const p of [e.poleLeads[i], e.throwLeads[i * 4], e.throwLeads[i * 4 + 1]]) this.circle(p, 2.5, FINE, this.ink, this.pen.theme.background);
    }
    if (e.poleCount > 1) {
      const { ctx } = this.pen;
      ctx.save();
      ctx.setLineDash([4, 4]);
      // the poles move together: a dashed link between the middles of the first and last blades
      const blade = (i: number) => lerp(e.poleLeads[i], e.throwLeads[i * 4 + e.position], 0.5);
      this.seg([blade(0), blade(e.poleCount - 1)], FINE);
      ctx.restore();
    }
  }

  mbb(e: MBBSwitchElm): void {
    this.wire(e, 0, e.point1, e.lead1!);
    for (let i = 0; i !== 2; i++) this.wire(e, i + 1, e.swpoles[i], e.swposts[i]);
    const both = e.position === 1 || e.position === 3;
    if (both || e.position === 0) this.seg([e.lead1!, e.swpoles[0]]);
    if (both || e.position === 2) this.seg([e.lead1!, e.swpoles[1]]);
    for (const p of [e.lead1!, ...e.swpoles]) this.circle(p, 2.5, FINE, this.ink, this.pen.theme.background);
  }

  customTransformer(e: CustomTransformerElm): void {
    if (e.nodePoints.length < e.nodeCount || e.ptCore.length < 4) return;
    const axis = unit(e.point1, e.point2);
    const drawn = windingPoints(e), core = e.ptCore;
    for (let i = 0; i !== e.nodeCount; i++) this.wire(e, i, e.nodePoints[i], drawn[i]);
    for (let i = 0; i !== e.coilCount; i++) {
      const n = e.coilNodes[i];
      this.coilTowardCore(drawn[n], drawn[n + 1], core);
    }
    this.seg([core[0], core[2]]);
    this.seg([core[1], core[3]]);
    if (e.dots) for (let i = 0; i < e.dots.length; i++) {
      const d = e.dots[i], sign = i < e.primaryCoils ? -1 : 1;
      const shift = windingShift();
      this.circle({ ...d, x: d.x + axis.x * shift * sign, y: d.y + axis.y * shift * sign }, 2, 0.1, this.ink, this.ink);
    }
  }
}

/** A CSS colour as a TextElm's Color takes it: a name, a hex value, or a functional notation. */
const CSS_COLOR = /^(#[0-9a-f]{3,8}|[a-z]+|(rgb|hsl)a?\([^)]*\))$/i;
