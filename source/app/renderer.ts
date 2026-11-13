// Symbol geometry follows CircuitJS1's drawing code (Paul Falstad, Iain Sharp).
// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import {
  CapacitorElm, type CircuitElm, CurrentElm, DiodeElm, FuseElm, type GridPoint, GroundElm,
  InductorElm, junctionTemperature, MosfetElm, PlaceholderElm, ProbeElm, RailElm, ResistorElm, RoutedWireElm, type ScopeElm,
  SwitchElm, VoltageElm, Waveform, WireElm, ZenerElm,
} from "../engine";
import { si } from "./format";
import { chevronPoints, markerMetrics, pathSegments, steadyMarkers, type VisibleLead } from "./current-flow";
import { arrow, dist, frame, inductorCurves, lerp, type P, perp, perpPoint, readingOrder, unit } from "./geom";
import { traceSmoothCurve } from "./curves";
import { type LabelGroup, type LabelKind, type LabelLine, layoutLabels, type Obstacle, type ObstacleKind, type PlacedLabel, type Rect as LabelRect } from "./labels";
import { bodyBox, drawSymbol, resistorBodyPath, type Pen } from "./symbols";
import { probeReading, type ScopeRuntime, type SimulationModel } from "./model";
import { ScopeStrip } from "./scopes";
import { settings } from "./settings";
import { isTransformer, transformerHandles } from "./transformer-geometry";
import { chipLeadHandles, isLeadPart } from "./chip-handles";
import { partHandles } from "./part-handles";
import { DESIGNATOR_FONT, designatorFont, ELECTRON_MARKER_COLOR, heatColor, PIN_FONT, READOUT_FONT, READOUT_TITLE_FONT, rgbColor, type Theme, valueFont, voltageColor } from "./theme";
import { wireReadout } from "./wire-readout";
import { bridgeMarker, bridgePath, findWireJumps, type WireJump, type WireSegment } from "./wire-jumps";
import type { Viewport } from "forge-shell/app/viewport";
import { boxRect, drawSelectionBox } from "forge-shell/app/content-selection";

/** The smallest side of a part handle, in grid units: past it a handle grows with the parts when zoomed in. */
const HANDLE_MIN_SIDE = 5;
/** The thinnest edge of a part handle, in grid units: it thickens with the handle, as a schematic line does. */
const HANDLE_MIN_EDGE = 1.2;
import { drawPointHandles } from "forge-shell/app/canvas-overlay";


/** Editing state drawn over the circuit. */
export interface Overlay {
  marquee: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Show grab handles on selected parts. */
  handles: boolean;
  /** Pointer position (world), for the hover readout. */
  pointer: [number, number] | null;
}

// line weights in world units
const WIRE = 2.0;
const BODY = 1.75;
const FINE = 1.25;
const JUNCTION_RADIUS = 2.5;
const JUMP_RADIUS = 8;
const JUMP_HALF_ANGLE = Math.PI / 2;
const JUMP_HALF_HEIGHT = JUMP_RADIUS * Math.sin(JUMP_HALF_ANGLE);

/** Label line heights, before the zoomed-out enlargement. */
const LINE_HEIGHT: Record<LabelKind, number> = { designator: 13, value: 12.5, readout: 12.5 };

/**
 * How far a two-terminal part's drawing reaches on each side of its axis, the normal (dy, −dx)
 * first: labels start past it. Parts that draw nothing there get a small margin.
 */
function clearance(ce: CircuitElm, shapes: Obstacle<CircuitElm>[]): [number, number] {
  const a = ce.point1, len = ce.dn;
  if (!(len > 0)) return [2, 2];
  const ux = (ce.point2.x - a.x) / len, uy = (ce.point2.y - a.y) / len;
  let plus = 2, minus = 2;
  const reach = (x: number, y: number, extra: number) => {
    const n = (x - a.x) * uy - (y - a.y) * ux;
    plus = Math.max(plus, n + extra);
    minus = Math.max(minus, -n + extra);
  };
  for (const s of shapes) {
    if (s.seg) {
      reach(s.seg.ax, s.seg.ay, s.seg.hw);
      reach(s.seg.bx, s.seg.by, s.seg.hw);
    } else if (s.rect) {
      const r = s.rect;
      for (const [x, y] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]) reach(x, y, 0);
    }
  }
  return [plus, minus];
}

/** A MOSFET's G / D / S letters: where each is centred. */
function pinNames(e: CircuitElm): [P, string][] {
  if (!(e instanceof MosfetElm) || e.src.length < 1) return [];
  // posts 1 and 2 are source and drain for n-channel, the other way round for p-channel
  const names: [P, string][] = [[e.point1, "G"], [e.src[0], e.pnp === 1 ? "S" : "D"], [e.drn[0], e.pnp === 1 ? "D" : "S"]];
  const c = lerp(e.point1, e.point2, 0.5);
  return names.map(([p, n]) => {
    const u = unit(c, p);
    return [{ x: p.x + u.x * 7 + (Math.abs(u.x) < 0.5 ? 6 : 0), y: p.y + u.y * 7 - (Math.abs(u.y) < 0.5 ? 6 : 0) }, n];
  });
}

/** Parts whose drawing failed (each is reported once). */
const drawFailures = new WeakSet<CircuitElm>();
/** Draws a circuit as a schematic sheet. Geometry is in world units; weights scale with zoom
 * but never get thinner than a device pixel. */
export class SchematicRenderer {
  private ctx!: CanvasRenderingContext2D;
  private labelScale = 1;
  private vp!: Viewport;
  private theme!: Theme;
  private range = 5;
  private pen!: Pen;
  /** A canvas of its own for measuring symbols (heatSpot), never shown. */
  private measureCtx: CanvasRenderingContext2D | null = null;
  /** While measuring a symbol: what stroke and fill record instead of drawing. */
  private measuring: ((pts: P[], color: string, fill?: boolean, width?: number) => void) | null = null;
  private jumpCache: { model: SimulationModel; junctions: GridPoint[]; leadRevision: number; byElement: Map<CircuitElm, WireJump<CircuitElm>[]> } | null = null;
  private activeElement: CircuitElm | null = null;
  private currentLeads: VisibleLead[] = [];

  constructor(public model: SimulationModel) {}

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, vp: Viewport, theme: Theme, hover: CircuitElm | null, overlay: Overlay): void {
    this.ctx = ctx;
    this.vp = vp;
    this.theme = theme;
    this.range = this.model.circuit.options.voltageRange;
    const self = this;
    this.pen = {
      // (the renderer's canvas, or while measuring the measuring one)
      get ctx() { return self.ctx; },
      theme,
      gridSize: this.model.circuit.options.smallGrid ? 8 : 16,
      lw: (w) => this.lw(w),
      stroke: (pts, color, width) => this.stroke(pts, color, width),
      onLead: (_, terminal, a, b) => this.currentLeads.push({ terminal, a, b }),
      fill: (pts, color) => this.fill(pts, color),
      volt: (e, n) => this.volt(e, n),
      text: (s, p, f, color, align, baseline) => this.text(s, p, f, color, align, baseline),
    };
    const sel = this.model.selection;

    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, width, height);
    this.drawGrid(width, height);

    ctx.save();
    ctx.setTransform(ctx.getTransform().multiply(new DOMMatrix([vp.scale, 0, 0, vp.scale, vp.ox, vp.oy])));
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const els = this.model.circuit.elements;
    if (settings.showWireJumps) this.prepareWireJumps();
    // Wires first, then parts; each conductor's own stroke includes its bridges.
    for (const ce of els) if (ce instanceof WireElm) this.drawElement(ce, ce === hover || sel.has(ce));
    this.drawHeatGlows();
    for (const ce of els) if (!(ce instanceof WireElm)) this.drawElement(ce, ce === hover || sel.has(ce));
    this.drawIssueBadges();
    for (const [elm, scope] of this.model.sheetScopes) this.drawSheetScope(elm, scope, elm === hover || sel.has(elm));
    if (settings.showCurrent && this.model.running) for (const ce of this.model.circuit.simulatedElements) this.drawCurrent(ce);
    this.drawConnections();
    this.drawPinNames();
    this.drawLabels(hover);
    if (overlay.handles) this.drawHandles();
    if (overlay.marquee) this.drawMarquee(overlay.marquee);
    ctx.restore();
    if (hover && settings.showReadout && !overlay.marquee && overlay.pointer) this.drawReadout(hover, overlay.pointer, width, height);
  }

  /** Paints scopes for the sheet (an offscreen canvas, drawn into each scope's box). */
  private sheetPainter: ScopeStrip | null = null;

  /** A scope drawn on the sheet: its plot, as the scope panel draws it, filling the element's box. */
  private drawSheetScope(elm: ScopeElm, scope: ScopeRuntime, highlighted: boolean): void {
    const { ctx, vp, theme } = this;
    const x0 = Math.min(elm.x, elm.x2), y0 = Math.min(elm.y, elm.y2), w = Math.abs(elm.x2 - elm.x), h = Math.abs(elm.y2 - elm.y);
    const sw = w * vp.scale, sh = h * vp.scale;
    if (sw < 16 || sh < 12) return; // too small to show anything: the outline stands in
    const dpr = Math.min(window.devicePixelRatio || 1, 4096 / Math.max(sw, sh));
    this.sheetPainter ??= new ScopeStrip(document.createElement("canvas"), this.model);
    this.sheetPainter.setModel(this.model);
    ctx.drawImage(this.sheetPainter.paintSingle(scope, sw, sh, dpr), x0, y0, w, h);
    ctx.strokeStyle = highlighted ? theme.accent : "#2c2c2c";
    ctx.lineWidth = this.lw(highlighted ? 1.5 : 1);
    ctx.strokeRect(x0, y0, w, h);
  }

  /**
   * Grab handles on the geometry ends of every selected part: the shell's nodes, 7 px at any zoom and never under
   * 5 grid units, so they grow with the parts when zoomed in.
   */
  private drawHandles(): void {
    const { theme } = this;
    const all: { x: number; y: number }[] = [];
    for (const e of this.model.selection) {
      let points: { x: number; y: number }[] = [];
      if (isTransformer(e)) {
        const h = transformerHandles(e);
        points = [h.top, h.bottom, ...Array.from({ length: e.getPostCount() }, (_, i) => e.getPost(i))];
      } else if (isLeadPart(e)) {
        points = chipLeadHandles(e);
      } else points = partHandles(e);
      all.push(...points);
    }
    // the edge is drawn as `lw` draws a line: never under 1 view px, 1.2 grid units once zoomed in, thinner on a light sheet
    const f = this.lineFactor();
    drawPointHandles(this.ctx, all, this.vp.scale, { color: theme.accent, fill: theme.background, minSide: HANDLE_MIN_SIDE, edge: f, minEdge: HANDLE_MIN_EDGE * f });
  }

  /** The selection box, in the sheet's selection cyan (the shell's `--pick` on the dark sheet). */
  private drawMarquee(m: { x0: number; y0: number; x1: number; y1: number }): void {
    drawSelectionBox(this.ctx, boxRect(m.x0, m.y0, m.x1, m.y1), this.vp.scale, this.theme.accent);
  }

  /**
   * With self-heating on, a soft glow behind each self-heated part in its junction temperature's
   * colour (`heatColor`: ice blue, green, yellow, red); the leads keep their voltage colours.
   */
  private drawHeatGlows(): void {
    const { ctx } = this;
    // only while self-heating is on: turned off, the colours go at once
    if (!this.model.circuit.options.selfHeating) return;
    for (const ce of this.model.circuit.simulatedElements) {
      const tj = junctionTemperature(ce);
      if (tj === null || !Number.isFinite(tj)) continue;
      const spot = this.heatSpot(ce);
      if (!spot) continue;
      const { cx, cy, r } = spot;
      const [red, green, blue] = heatColor(tj);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, rgbColor(red, green, blue, 0.55));
      g.addColorStop(0.55, rgbColor(red, green, blue, 0.25));
      g.addColorStop(1, rgbColor(red, green, blue, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  /**
   * Where a part's heat glow sits: centred on its body (what it draws in ink, the white part; not
   * the voltage-coloured leads, labels or posts), reaching a little past it so the colour still
   * shows at the body's edge. Found by drawing the part with stroke and fill recording points
   * instead of drawing, on a canvas of its own (for anything drawn on the context directly).
   */
  private heatSpot(ce: CircuitElm): { cx: number; cy: number; r: number } | null {
    const ink = this.theme.ink;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const saved = { ctx: this.ctx, leads: this.currentLeads, active: this.activeElement };
    this.measureCtx ??= document.createElement("canvas").getContext("2d")!;
    this.ctx = this.measureCtx;
    this.currentLeads = [];
    this.activeElement = null;
    this.measuring = (pts, color) => {
      if (color !== ink) return;
      for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    };
    try { this.drawElementBody(ce, false); }
    catch { /* drawn (or not) as drawElement reports */ }
    finally {
      this.measuring = null;
      this.ctx = saved.ctx;
      this.currentLeads = saved.leads;
      this.activeElement = saved.active;
    }
    if (!(x1 >= x0)) return null;
    // half the body's diagonal, plus a margin where the glow fades out
    const r = Math.hypot(x1 - x0, y1 - y0) / 2 + 8;
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, r: Math.max(r, 14) };
  }

  /**
   * A small badge at the top right of each part whose model has a problem (red: it can't run) or a
   * warning (amber: something of the model isn't simulated); the readout under the pointer says what.
   */
  private drawIssueBadges(): void {
    const { ctx, theme, vp } = this;
    const r = Math.max(5, 6 / vp.scale);
    for (const ce of this.model.circuit.elements) {
      const { problems, warnings } = this.model.partIssues(ce);
      if (!problems.length && !warnings.length) continue;
      const b = ce.boundingBox;
      const x = b.x + b.width, y = b.y;
      ctx.save();
      ctx.fillStyle = problems.length ? theme.error : theme.unsupported;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = theme.background;
      ctx.font = `bold ${r * 1.5}px -apple-system, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("!", x, y + r * 0.08);
      ctx.restore();
    }
  }

  /**
   * A readout next to the pointer for the part under it: what it is and its live values, so the
   * schematic can be read without looking away to the inspector.
   */
  private drawReadout(ce: CircuitElm, pointer: [number, number], width: number, height: number): void {
    const { ctx, theme, vp } = this;
    const lines = this.model.infoLines(ce).slice(0, 5);
    if (!lines.length) return;
    const px = pointer[0] * vp.scale + vp.ox, py = pointer[1] * vp.scale + vp.oy;
    ctx.font = READOUT_FONT;
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
    const h = lines.length * 15 + 10;
    let x = px + 16, y = py + 18;
    if (x + w > width - 4) x = px - 16 - w;
    if (y + h > height - 4) y = py - 12 - h;
    ctx.save();
    ctx.globalAlpha = 0.94;
    ctx.fillStyle = theme.readoutBackground;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 5);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = theme.readoutBorder;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    lines.forEach((l, i) => {
      ctx.font = i === 0 ? READOUT_TITLE_FONT : READOUT_FONT;
      ctx.fillStyle = i === 0 ? theme.designatorText : theme.readoutText;
      ctx.fillText(l, x + 8, y + 6 + i * 15);
    });
    ctx.restore();
  }

  /** G / D / S beside MOSFET pins when zoomed in far enough to read them. */
  private drawPinNames(): void {
    if (this.vp.scale < 0.9) return;
    for (const e of this.model.circuit.elements) {
      for (const [p, n] of pinNames(e)) this.text(n, p, PIN_FONT, this.theme.valueText, "center", "middle");
    }
  }

  private drawGrid(width: number, height: number): void {
    const { ctx, vp, theme } = this;
    const minor = 16 * vp.scale;
    const major = 128 * vp.scale;
    const mod = (a: number, n: number) => ((a % n) + n) % n;
    if (major >= 24) {
      ctx.strokeStyle = theme.gridMajor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = mod(vp.ox, major); x < width; x += major) {
        ctx.moveTo(Math.round(x) + 0.5, 0);
        ctx.lineTo(Math.round(x) + 0.5, height);
      }
      for (let y = mod(vp.oy, major); y < height; y += major) {
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(width, Math.round(y) + 0.5);
      }
      ctx.stroke();
    }
    if (minor < 7) return;
    ctx.fillStyle = theme.gridMinor;
    const r = minor >= 20 ? 1.1 : 0.8;
    for (let x = mod(vp.ox, minor); x < width; x += minor) {
      for (let y = mod(vp.oy, minor); y < height; y += minor) ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
  }

  private drawElement(ce: CircuitElm, hl: boolean): void {
    this.activeElement = ce;
    this.currentLeads = [];
    try { this.drawElementBody(ce, hl); }
    catch (error) {
      // one part that can't be drawn must not stop the whole schematic from drawing
      if (!drawFailures.has(ce)) {
        drawFailures.add(ce);
        console.error(`Couldn't draw ${ce.constructor.name}:`, error);
      }
    }
    finally {
      this.model.currentFlow.setVisibleLeads(ce, this.currentLeads);
      this.activeElement = null;
    }
  }

  private drawElementBody(ce: CircuitElm, hl: boolean): void {
    const ink = hl ? this.theme.accent : this.theme.ink;
    if (drawSymbol(this.pen, ce, ink, hl)) return;
    if (ce instanceof WireElm) this.stroke([ce.point1, ce.point2], hl ? this.theme.accent : this.volt(ce, 0), ce.busWidth > 1 ? WIRE + 2 : WIRE);
    else if (ce instanceof ResistorElm) this.drawResistor(ce, ink, hl);
    else if (ce instanceof CapacitorElm) this.drawCapacitor(ce, ink, hl);
    else if (ce instanceof InductorElm) this.drawInductor(ce, ink, hl);
    else if (ce instanceof RailElm) this.drawRail(ce, ink, hl);
    else if (ce instanceof VoltageElm) this.drawVoltage(ce, ink, hl);
    else if (ce instanceof GroundElm) this.drawGround(ce, ink, hl);
    else if (ce instanceof SwitchElm) this.drawSwitch(ce, ink, hl);
    else if (ce instanceof CurrentElm) this.drawCurrentSource(ce, ink, hl);
    else if (ce instanceof DiodeElm) this.drawDiode(ce, ink, hl);
    else if (ce instanceof FuseElm) this.drawFuse(ce, ink, hl);
    else if (ce instanceof MosfetElm) this.drawMosfet(ce, ink, hl);
    else if (ce instanceof PlaceholderElm) this.drawPlaceholder(ce, hl);
    else this.stroke([ce.point1, ce.point2], ink, BODY);
  }

  private drawLeads(e: CircuitElm, hl: boolean): void {
    if (e.lead1) this.stroke([e.point1, e.lead1], hl ? this.theme.accent : this.volt(e, 0), WIRE);
    if (e.lead2) this.stroke([e.lead2, e.point2], hl ? this.theme.accent : this.volt(e, 1), WIRE);
  }

  private drawResistor(e: ResistorElm, ink: string, hl: boolean): void {
    const l1 = e.lead1, l2 = e.lead2;
    if (!l1 || !l2) return;
    this.drawLeads(e, hl);
    this.stroke(resistorBodyPath(l1, l2), ink, BODY);
  }

  private drawCapacitor(e: CapacitorElm, ink: string, hl: boolean): void {
    const l1 = e.lead1, l2 = e.lead2;
    if (!l1 || !l2) return;
    this.stroke([e.point1, l1], hl ? this.theme.accent : this.volt(e, 0), WIRE);
    this.stroke([e.point2, l2], hl ? this.theme.accent : this.volt(e, 1), WIRE);
    this.stroke(perp(l1, l2, 0, 11), ink, BODY + 0.75);
    this.stroke(perp(l1, l2, 1, 11), ink, BODY + 0.75);
  }

  private drawInductor(e: InductorElm, ink: string, hl: boolean): void {
    const l1 = e.lead1, l2 = e.lead2;
    if (!l1 || !l2) return;
    this.drawLeads(e, hl);
    const len = dist(l1, l2);
    // loops in reading order, so the coil looks the same whichever way it was dragged
    const [r1, r2] = readingOrder(l1, l2);
    const transform = frame(r1, r2);
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(r1.x, r1.y);
    for (const curve of inductorCurves(len)) {
      const [a, b, end] = curve.map(transform);
      ctx.bezierCurveTo(a.x, a.y, b.x, b.y, end.x, end.y);
    }
    ctx.strokeStyle = ink;
    ctx.lineWidth = this.lw(BODY);
    ctx.stroke();
  }

  private drawVoltage(e: VoltageElm, ink: string, hl: boolean): void {
    const l1 = e.lead1, l2 = e.lead2;
    if (!l1 || !l2) return;
    this.drawLeads(e, hl);
    if (e.waveform === Waveform.dc && !e.usesCircleSymbol) {
      // battery: short heavy plate (−) at lead1, long thin plate (+) at lead2
      this.stroke(perp(l1, l2, 0, 7), ink, BODY + 1.5);
      this.stroke(perp(l1, l2, 1, 14), ink, BODY);
    } else {
      this.sourceCircle(lerp(l1, l2, 0.5), e, [l1, l2], ink);
    }
  }

  private drawRail(e: RailElm, ink: string, hl: boolean): void {
    const l1 = e.lead1;
    if (!l1) return;
    this.stroke([e.point1, l1], hl ? this.theme.accent : this.volt(e, 0), WIRE);
    if (e.waveform === Waveform.dc || e.waveform === Waveform.variable) {
      // power symbol: a bar with the voltage beyond it
      this.stroke(perp(e.point1, l1, 1, 8), ink, BODY + 0.5);
      // a rail being placed isn't attached to a simulator yet: show its DC value
      const v = e.sim ? e.getVoltage() : e.maxVoltage + e.bias;
      this.text((v > 0 ? "+" : "") + si(v, "V"), e.point2, DESIGNATOR_FONT, hl ? this.theme.accent : this.theme.designatorText, "center", "middle");
    } else {
      this.sourceCircle(e.point2, e, [e.point1, e.point2], ink);
    }
  }

  private sourceCircle(c: P, e: VoltageElm, axis: [P, P], ink: string): void {
    const { ctx } = this;
    ctx.strokeStyle = ink;
    ctx.lineWidth = this.lw(BODY);
    ctx.beginPath();
    ctx.arc(c.x, c.y, 16, 0, Math.PI * 2);
    ctx.stroke();
    const wl = 7;
    let g: P[] = [];
    let smooth = false;
    switch (e.waveform) {
      case Waveform.ac:
        for (let i = 0; i <= 40; i++) g.push({ x: c.x - 10 + i * 0.5, y: c.y - Math.sin((i * Math.PI) / 20) * wl });
        smooth = true;
        break;
      case Waveform.square: {
        const x2 = Math.max(c.x - wl + 3, Math.min(c.x + wl - 3, wl * 2 * e.dutyCycle - wl + c.x));
        g = [{ x: c.x - wl, y: c.y }, { x: c.x - wl, y: c.y - wl }, { x: x2, y: c.y - wl }, { x: x2, y: c.y + wl }, { x: c.x + wl, y: c.y + wl }, { x: c.x + wl, y: c.y }];
        break;
      }
      case Waveform.triangle:
        g = [{ x: c.x - 10, y: c.y }, { x: c.x - 5, y: c.y - wl }, { x: c.x + 5, y: c.y + wl }, { x: c.x + 10, y: c.y }];
        break;
      case Waveform.sawtooth:
        g = [{ x: c.x - wl, y: c.y }, { x: c.x, y: c.y - wl }, { x: c.x, y: c.y + wl }, { x: c.x + wl, y: c.y }];
        break;
      case Waveform.pulse: {
        const y = c.y + wl / 2;
        g = [{ x: c.x - wl, y }, { x: c.x - wl, y: y - wl }, { x: c.x - wl / 2, y: y - wl }, { x: c.x - wl / 2, y }, { x: c.x + wl, y }];
        break;
      }
      case Waveform.noise:
        this.text("N", c, DESIGNATOR_FONT, ink, "center", "middle");
        break;
      default: {
        // DC in a circle: + and − along the axis
        const u = unit(axis[0], axis[1]);
        const plus = { x: c.x + u.x * 7, y: c.y + u.y * 7 };
        this.stroke([{ x: plus.x - 3.5, y: plus.y }, { x: plus.x + 3.5, y: plus.y }], ink, FINE);
        this.stroke([{ x: plus.x, y: plus.y - 3.5 }, { x: plus.x, y: plus.y + 3.5 }], ink, FINE);
        const m = { x: c.x - u.x * 7, y: c.y - u.y * 7 };
        this.stroke([{ x: m.x - 3.5, y: m.y }, { x: m.x + 3.5, y: m.y }], ink, FINE);
      }
    }
    if (g.length) (smooth ? this.strokeSmooth(g, ink, FINE) : this.stroke(g, ink, FINE));
  }

  private drawGround(e: GroundElm, ink: string, hl: boolean): void {
    this.stroke([e.point1, e.point2], hl ? this.theme.accent : this.volt(e, 0), WIRE);
    const { point1: a, point2: b } = e;
    const ux = (b.x - a.x) / e.dn, uy = (b.y - a.y) / e.dn;
    const at = (along: number, across: number): P => ({ x: a.x + ux * along - uy * across, y: a.y + uy * along + ux * across });
    switch (e.symbolType) {
      case 1: // chassis: a bar with slanted hatches
        this.stroke(perp(a, b, 1, 10), ink, BODY);
        for (const k of [-6, 0, 6]) this.stroke([at(e.dn, k), at(e.dn + 6, k - 5)], ink, BODY);
        break;
      case 2: // signal ground: an open triangle
        this.stroke([at(e.dn, -9), at(e.dn, 9), at(e.dn + 11, 0), at(e.dn, -9)], ink, BODY);
        break;
      case 3: // common: a small circle
        this.stroke([at(e.dn, 0), at(e.dn + 3, 0)], ink, BODY);
        const c = at(e.dn + 8, 0);
        this.ctx.strokeStyle = ink;
        this.ctx.lineWidth = this.lw(BODY);
        this.ctx.beginPath();
        this.ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
        this.ctx.stroke();
        break;
      default: // earth: three shrinking bars
        for (let i = 0; i < 3; i++) this.stroke(perp(a, b, 1 + (i * 4) / e.dn, 10 - i * 3.5), ink, BODY);
    }
  }

  private drawSwitch(e: SwitchElm, ink: string, hl: boolean): void {
    const l1 = e.lead1, l2 = e.lead2;
    if (!l1 || !l2) return;
    this.drawLeads(e, hl);
    const open = e.position === 1;
    this.stroke([l1, perp(l1, l2, open ? 0.92 : 1, open ? 13 : 0)[0]], ink, BODY);
    // contacts
    const { ctx } = this;
    ctx.fillStyle = this.theme.background;
    ctx.strokeStyle = ink;
    ctx.lineWidth = this.lw(FINE);
    for (const c of [l1, l2]) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawCurrentSource(e: CurrentElm, ink: string, hl: boolean): void {
    const l1 = e.lead1, l2 = e.lead2;
    if (!l1 || !l2) return;
    this.drawLeads(e, hl);
    const { ctx } = this;
    const c = lerp(l1, l2, 0.5);
    ctx.strokeStyle = ink;
    ctx.lineWidth = this.lw(BODY);
    ctx.beginPath();
    ctx.arc(c.x, c.y, 12, 0, Math.PI * 2);
    ctx.stroke();
    const tip = lerp(l1, l2, 0.78);
    this.stroke([lerp(l1, l2, 0.22), tip], ink, FINE);
    const u = unit(l1, l2), n = { x: -u.y, y: u.x };
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - u.x * 5 + n.x * 3.5, tip.y - u.y * 5 + n.y * 3.5);
    ctx.lineTo(tip.x - u.x * 5 - n.x * 3.5, tip.y - u.y * 5 - n.y * 3.5);
    ctx.closePath();
    ctx.fill();
  }

  /** DiodeElm.drawDiode / ZenerElm.draw: a filled triangle and the cathode bar (with wings for a Zener). */
  private drawDiode(e: DiodeElm, ink: string, hl: boolean): void {
    const l1 = e.lead1, l2 = e.lead2;
    if (!l1 || !l2) return;
    this.drawLeads(e, hl);
    const hs = 8;
    const [a0, a1] = perp(l1, l2, 0, hs);
    this.fill([a0, a1, l2], ink);
    const cathode = perp(l1, l2, 1, hs);
    this.stroke(cathode, ink, BODY);
    if (e instanceof ZenerElm) {
      this.stroke([perpPoint(cathode[0], cathode[1], -0.2, -hs), cathode[0]], ink, BODY);
      this.stroke([perpPoint(cathode[1], cathode[0], -0.2, -hs), cathode[1]], ink, BODY);
    }
  }

  /** FuseElm.draw: an ANSI wave or IEC cartridge, marked and open when blown. */
  private drawFuse(e: FuseElm, ink: string, hl: boolean): void {
    // The stored CircuitJS flag stays in the file; display geometry follows the app setting.
    const body = settings.symbolStyle === "iec" ? 32 : 16;
    const lead = e.dn < body ? 0 : (e.dn - body) / (2 * e.dn);
    const l1 = lerp(e.point1, e.point2, lead), l2 = lerp(e.point1, e.point2, 1 - lead);
    this.stroke([e.point1, l1], hl ? this.theme.accent : this.volt(e, 0), WIRE);
    this.stroke([l2, e.point2], hl ? this.theme.accent : this.volt(e, 1), WIRE);
    const len = dist(l1, l2), hs = 6, f = frame(...readingOrder(l1, l2));
    if (settings.symbolStyle === "iec") {
      this.stroke([{ x: 0, y: -hs }, { x: len, y: -hs }, { x: len, y: hs }, { x: 0, y: hs }, { x: 0, y: -hs }].map(f), ink, BODY);
      for (const x of [len * 0.18, len * 0.82]) {
        this.stroke([{ x, y: -hs }, { x, y: hs }].map(f), ink, FINE);
      }
    } else {
      const wave = (start: number, end: number): void => {
        const pts: P[] = [];
        for (let i = start; i <= end; i++) pts.push({ x: (i * len) / 16, y: -hs * Math.sin((i * Math.PI * 2) / 16) });
        this.strokeSmooth(pts.map(f), ink, BODY);
      };
      if (e.blown) { wave(0, 5); wave(11, 16); }
      else wave(0, 16);
    }
    if (e.blown) {
      const center = len / 2, mark = 2.25;
      this.stroke([{ x: center - mark, y: -mark }, { x: center + mark, y: mark }].map(f), ink, FINE);
      this.stroke([{ x: center - mark, y: mark }, { x: center + mark, y: -mark }].map(f), ink, FINE);
    }
  }

  /** MosfetElm.draw: source/drain stubs, channel (broken for enhancement mode), bulk, arrow and gate. */
  private drawMosfet(e: MosfetElm, ink: string, hl: boolean): void {
    const { src, drn, gate, body } = e;
    if (src.length < 3) return;
    const lead = (n: number) => (hl ? this.theme.accent : this.volt(e, n));
    this.stroke([src[0], src[1]], lead(1), WIRE);
    this.stroke([drn[0], drn[1]], lead(2), WIRE);
    const enhancement = e.vt > 0 && e.showBulk();
    for (let i = 0; i < 6; i++) {
      if ((i === 1 || i === 4) && enhancement) continue;
      this.stroke([lerp(src[1], drn[1], i / 6), lerp(src[1], drn[1], (i + 1) / 6)], ink, BODY + 0.75);
    }
    this.stroke([src[1], src[2]], ink, BODY);
    this.stroke([drn[1], drn[2]], ink, BODY);
    if (body) {
      if (!e.hasBodyTerminal()) this.stroke([e.pnp === -1 ? drn[0] : src[0], body[0]], ink, BODY);
      this.stroke([body[0], body[1]], ink, BODY);
    }
    if (!e.drawDigital()) {
      const [a, b, al, aw] = e.pnp === 1
        ? body ? [body[0], body[1], 12, 5] : [src[1], src[0], 10, 4]
        : body ? [body[1], body[0], 12, 5] : [drn[0], drn[1], 12, 5];
      this.fill(arrow(a as P, b as P, al as number, aw as number), ink);
    }
    this.stroke([e.point1, gate[1]], lead(0), WIRE);
    this.stroke([gate[0], gate[2]], ink, BODY + 0.75);
    if (e.drawDigital() && e.pnp === -1) {
      const c = lerp(e.point1, e.point2, 1 - (e.dsign < 0 ? 32 : 31) / e.dn);
      const { ctx } = this;
      ctx.strokeStyle = ink;
      ctx.lineWidth = this.lw(BODY);
      ctx.beginPath();
      ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawPlaceholder(e: PlaceholderElm, hl: boolean): void {
    const { ctx } = this;
    const color = hl ? this.theme.accent : this.theme.unsupported;
    // a faint line keeps the connection points visible
    ctx.globalAlpha = 0.35;
    this.stroke([e.point1, e.point2], color, FINE);
    ctx.globalAlpha = 1;
    const x = Math.min(e.point1.x, e.point2.x) - 9, y = Math.min(e.point1.y, e.point2.y) - 9;
    const w = Math.abs(e.point1.x - e.point2.x) + 18, h = Math.abs(e.point1.y - e.point2.y) + 18;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = this.lw(FINE);
    ctx.setLineDash([3, 2.5]);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 3);
    ctx.stroke();
    ctx.restore();
  }

  /** Cache bridge geometry until the circuit's endpoints or routes change. */
  private prepareWireJumps(): void {
    const { model } = this;
    if (this.jumpCache?.model === model && this.jumpCache.junctions === model.junctions
      && this.jumpCache.leadRevision === model.currentFlow.leadRevision) return;
    const segments: WireSegment<CircuitElm>[] = [];
    const terminals = new Map<string, { point: GridPoint; count: number }>();
    for (const elm of model.circuit.elements) {
      for (let n = 0; n < elm.getPostCount(); n++) {
        const point = elm.getPost(n), key = `${point.x},${point.y}`;
        const existing = terminals.get(key);
        if (existing) existing.count++;
        else terminals.set(key, { point, count: 1 });
      }
      for (const path of model.currentFlow.pathsFor(elm)) {
        // A generic two-terminal path without explicit leads can pass through a symbol body.
        if (!(elm instanceof WireElm) && elm.getPostCount() === 2 && !path.segments && !path.visibleConductor) continue;
        for (let i = 0; i + 1 < path.points.length; i++) {
          if (path.segments && !path.segments.includes(i)) continue;
          const a = path.points[i], b = path.points[i + 1];
          if (a.x !== b.x || a.y !== b.y) segments.push({ owner: elm, a, b, segment: i, wire: elm instanceof WireElm });
        }
      }
    }
    const connected = [...terminals.values()].filter((entry) => entry.count > 1).map((entry) => entry.point);
    const jumps = findWireJumps(segments, connected, JUMP_HALF_HEIGHT);
    const byElement = new Map<CircuitElm, WireJump<CircuitElm>[]>();
    for (const jump of jumps) {
      const wire = jump.over.owner;
      const entries = byElement.get(wire) ?? [];
      entries.push(jump);
      byElement.set(wire, entries);
    }
    this.jumpCache = { model, junctions: model.junctions, leadRevision: model.currentFlow.leadRevision, byElement };
  }

  private drawConnections(): void {
    const { ctx, theme, model } = this;
    for (const j of model.junctions) {
      ctx.fillStyle = settings.showVoltage ? voltageColor(theme, model.voltageAt(j), this.range) : theme.ink;
      ctx.beginPath();
      ctx.arc(j.x, j.y, JUNCTION_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = theme.openPin;
    ctx.fillStyle = theme.background;
    ctx.lineWidth = this.lw(FINE);
    for (const o of model.openPins) {
      ctx.beginPath();
      ctx.arc(o.x, o.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.strokeStyle = theme.error;
    for (const b of model.sim.badConnectionList) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /**
   * Designators, values and wire readouts. When zoomed out they grow (up to 1.6×) so they stay
   * readable; the layout is redone when that size changes.
   */
  private drawLabels(hover: CircuitElm | null): void {
    if (this.vp.scale < 0.3) return;
    const model = this.model;
    const k = Math.round(Math.min(1.6, Math.max(1, 1 / this.vp.scale)) * 5) / 5;
    if (model.labelLayout && this.labelScale !== k) model.labelLayout = null;
    this.labelScale = k;
    model.labelLayout ??= this.layoutLabels(k);
    const dFont = designatorFont(k), vFont = valueFont(k);
    for (const [ce, labels] of model.labelLayout) {
      const selected = ce === hover || model.selection.has(ce);
      const desColor = selected ? this.theme.accent : ce instanceof PlaceholderElm ? this.theme.unsupportedText : this.theme.designatorText;
      // live text (a probe's reading, a wire's readout) placed with the layout, its text as of now
      const live = ce instanceof WireElm ? wireReadout(ce)
        : ce instanceof ProbeElm && ce.hasFlag(ProbeElm.FLAG_SHOWVOLTAGE) ? probeReading(ce) : null;
      for (const l of labels) {
        if (l.kind === "readout") {
          if (live) this.text(live, l, vFont, selected ? this.theme.accent : this.theme.valueText, l.align, "top");
          continue;
        }
        const text = live !== null && l.kind === "value" ? live : l.text;
        this.text(text, l, l.isDesignator ? dFont : vFont, l.isDesignator ? desColor : this.theme.valueText, l.align, "top");
      }
    }
  }

  /** Every part's designator and value and every wire's readout, placed around what is drawn. */
  private layoutLabels(k: number): Map<CircuitElm, PlacedLabel[]> {
    const { model, ctx } = this;
    const obstacles = this.labelObstacles();
    const own = new Map<CircuitElm, Obstacle<CircuitElm>[]>();
    for (const o of obstacles) {
      if (o.kind !== "body" && o.kind !== "text") continue;
      const list = own.get(o.owner);
      if (list) list.push(o);
      else own.set(o.owner, [o]);
    }
    const measure = (text: string, kind: LabelKind, reserve = false): LabelLine => {
      ctx.font = kind === "designator" ? designatorFont(k) : valueFont(k);
      // a live reading keeps room for a longer number than it shows now
      const w = Math.max(ctx.measureText(text).width, reserve ? ctx.measureText(text.replace(/[−-]?\d+(\.\d+)?/g, "−888.8")).width : 0);
      return { text, kind, w, h: LINE_HEIGHT[kind] * k };
    };
    const groups: LabelGroup<CircuitElm>[] = [];
    for (const ce of model.circuit.elements) {
      if (ce instanceof WireElm) {
        const text = wireReadout(ce);
        if (!text) continue;
        const points = ce instanceof RoutedWireElm && ce.routePoints?.length ? ce.routePoints : [ce.point1, ce.point2];
        groups.push({ owner: ce, lines: [measure(text, "readout", true)], anchor: { kind: "wire", points } });
        continue;
      }
      if (!(ce.dn > 0)) continue;
      const des = model.designator(ce);
      const val = settings.showValues ? model.valueLabel(ce) : null;
      const typeName = ce instanceof PlaceholderElm ? ce.typeName : null;
      const top = des ? (typeName ? `${des} ${typeName}` : des) : typeName;
      const live = ce instanceof ProbeElm && ce.hasFlag(ProbeElm.FLAG_SHOWVOLTAGE);
      const lines: LabelLine[] = [];
      if (top) lines.push(measure(top, "designator"));
      if (val) lines.push(measure(val, "value", live));
      if (!lines.length) continue;
      const box = bodyBox(ce);
      groups.push({ owner: ce, lines, anchor: box ? { kind: "box", box } : { kind: "axis", a: ce.point1, b: ce.point2, clear: clearance(ce, own.get(ce) ?? []) } });
    }
    return layoutLabels(groups, obstacles, [...model.junctions, ...model.openPins]);
  }

  /** What each part draws, recorded once while the part (and the theme) stay as they are. */
  private drawnShapes = new WeakMap<CircuitElm, { key: string; shapes: Obstacle<CircuitElm>[] }>();

  private labelObstacles(): Obstacle<CircuitElm>[] {
    const out: Obstacle<CircuitElm>[] = [];
    for (const ce of this.model.circuit.elements) {
      let key = "";
      try { key = `${this.theme.ink}|${ce.dump()}`; } catch { /* recorded every time */ }
      let entry = this.drawnShapes.get(ce);
      if (!entry || !key || entry.key !== key) {
        entry = { key, shapes: this.recordShapes(ce) };
        this.drawnShapes.set(ce, entry);
      }
      out.push(...entry.shapes);
      // the G / D / S letters (shown zoomed in) count as the part's text
      for (const [p] of pinNames(ce)) out.push({ owner: ce, kind: "text", rect: { x: p.x - 3.5, y: p.y - 4.5, w: 7, h: 9 } });
    }
    // scopes on the sheet are drawn over their box
    for (const [elm] of this.model.sheetScopes) {
      out.push({ owner: elm, kind: "body", rect: { x: Math.min(elm.x, elm.x2), y: Math.min(elm.y, elm.y2), w: Math.abs(elm.x2 - elm.x), h: Math.abs(elm.y2 - elm.y) } });
    }
    return out;
  }

  /**
   * A part's drawing as label obstacles: the part is drawn on the measuring canvas through a
   * context that records strokes, fills, circles and text instead of drawing them. Leads (in their
   * node's voltage colour) and wires are cheap to cross; the body and the part's own text are not.
   */
  private recordShapes(ce: CircuitElm): Obstacle<CircuitElm>[] {
    const shapes: Obstacle<CircuitElm>[] = [];
    // (without a canvas of its own, as under Node, the drawing context: only its state is used)
    this.measureCtx ??= document.createElement("canvas").getContext("2d")!;
    const real = this.measureCtx ?? this.ctx;
    const isWire = ce instanceof WireElm;
    const { theme } = this;
    real.save();
    real.setTransform(1, 0, 0, 1, 0, 0);
    real.strokeStyle = theme.valueText;
    const annotation = real.strokeStyle;
    const kindOf = (color: string | CanvasGradient | CanvasPattern, normalized: string | CanvasGradient | CanvasPattern): ObstacleKind =>
      isWire ? "wire" : color === "volt" ? "lead" : color === theme.valueText || normalized === annotation ? "annotation" : "body";
    const segment = (a: P, b: P, hw: number, kind: ObstacleKind) =>
      shapes.push({ owner: ce, kind, seg: { ax: a.x, ay: a.y, bx: b.x, by: b.y, hw } });
    const boxOf = (pts: P[]): LabelRect => {
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    };
    const at = (x: number, y: number): P => {
      const m = real.getTransform();
      return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
    };
    const corners = (x: number, y: number, w: number, h: number) => [at(x, y), at(x + w, y), at(x, y + h), at(x + w, y + h)];
    // the path being built on the context
    let segs: [P, P][] = [], boxes: LabelRect[] = [], cur: P | null = null, start: P | null = null;
    const lineTo = (p: P) => {
      if (cur) segs.push([cur, p]);
      else start = p;
      cur = p;
    };
    const hooks: Record<string, (...args: number[]) => void> = {
      beginPath: () => { segs = []; boxes = []; cur = start = null; },
      moveTo: (x, y) => { cur = start = at(x, y); },
      lineTo: (x, y) => lineTo(at(x, y)),
      closePath: () => { if (cur && start) segs.push([cur, start]); cur = start; },
      quadraticCurveTo: (cx, cy, x, y) => { lineTo(at(cx, cy)); lineTo(at(x, y)); },
      bezierCurveTo: (ax, ay, bx, by, x, y) => { lineTo(at(ax, ay)); lineTo(at(bx, by)); lineTo(at(x, y)); },
      arcTo: (ax, ay, x, y) => { lineTo(at(ax, ay)); lineTo(at(x, y)); },
      arc: (x, y, r) => { boxes.push(boxOf(corners(x - r, y - r, 2 * r, 2 * r))); cur = null; },
      ellipse: (x, y, rx, ry) => { const r = Math.max(rx, ry); boxes.push(boxOf(corners(x - r, y - r, 2 * r, 2 * r))); cur = null; },
      rect: (x, y, w, h) => { boxes.push(boxOf(corners(x, y, w, h))); cur = null; },
      roundRect: (x, y, w, h) => { boxes.push(boxOf(corners(x, y, w, h))); cur = null; },
      stroke: () => {
        const kind = kindOf(real.strokeStyle, real.strokeStyle);
        const hw = Math.min((real.lineWidth || 1) / 2, 3);
        for (const [a, b] of segs) segment(a, b, hw, kind);
        for (const r of boxes) shapes.push({ owner: ce, kind, rect: r });
      },
      fill: () => {
        const pts = [...segs.flat(), ...boxes.flatMap((r) => [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h }])];
        if (pts.length) shapes.push({ owner: ce, kind: isWire ? "wire" : "body", rect: boxOf(pts) });
      },
      strokeRect: (x, y, w, h) => {
        const [a, b, c, d] = corners(x, y, w, h), kind = kindOf(real.strokeStyle, real.strokeStyle), hw = Math.min((real.lineWidth || 1) / 2, 3);
        segment(a, b, hw, kind); segment(b, d, hw, kind); segment(d, c, hw, kind); segment(c, a, hw, kind);
      },
      fillRect: (x, y, w, h) => { shapes.push({ owner: ce, kind: "body", rect: boxOf(corners(x, y, w, h)) }); },
      clearRect: () => {},
      drawImage: () => {},
    };
    const text = (s: string, x: number, y: number, maxWidth?: number) => {
      const m = real.measureText(s);
      const scale = maxWidth !== undefined && m.width > maxWidth ? maxWidth / m.width : 1;
      // (the text's own box where measureText gives it, or one from its width and alignment)
      const align = real.textAlign, base = real.textBaseline;
      const lead = m.actualBoundingBoxLeft ?? (align === "center" ? m.width / 2 : align === "right" || align === "end" ? m.width : 0);
      const ascent = m.actualBoundingBoxAscent ?? (base === "top" || base === "hanging" ? 0 : base === "middle" ? 5 : 9);
      const descent = m.actualBoundingBoxDescent ?? (base === "top" || base === "hanging" ? 11 : base === "middle" ? 5 : 2);
      const left = x - lead * scale, right = x + (m.actualBoundingBoxRight ?? m.width - lead) * scale;
      const top = y - ascent, bottom = y + descent;
      shapes.push({ owner: ce, kind: "text", rect: boxOf(corners(left, top, right - left, bottom - top)) });
    };
    const recorder = new Proxy(real, {
      get: (target, prop) => {
        if (prop === "fillText" || prop === "strokeText") return text;
        if (typeof prop === "string" && prop in hooks) return hooks[prop];
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
      set: (target, prop, value) => Reflect.set(target, prop, value, target),
    });
    const saved = { ctx: this.ctx, leads: this.currentLeads, active: this.activeElement };
    this.ctx = recorder;
    this.currentLeads = [];
    this.activeElement = null;
    // strokes and fills through the pen arrive here, in world units
    this.measuring = (pts, color, fill, width = BODY) => {
      const kind = kindOf(color, color);
      if (fill) shapes.push({ owner: ce, kind: isWire ? "wire" : "body", rect: boxOf(pts) });
      else for (let i = 1; i < pts.length; i++) segment(pts[i - 1], pts[i], width / 2, kind);
    };
    try { this.drawElementBody(ce, false); }
    catch { /* drawn (or not) as drawElement reports */ }
    finally {
      this.measuring = null;
      this.ctx = saved.ctx;
      this.currentLeads = saved.leads;
      this.activeElement = saved.active;
      real.restore();
    }
    return shapes;
  }

  /** Plain schematic lettering; label placement supplies clearance instead of cutting into symbols. */
  private text(s: string, p: P, font: string, color: string, align: CanvasTextAlign, baseline: CanvasTextBaseline): void {
    const { ctx } = this;
    ctx.font = font;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillStyle = color;
    ctx.fillText(s, p.x, p.y);
  }

  private drawCurrent(ce: CircuitElm): void {
    const { ctx, theme } = this;
    const width = this.lw(ce instanceof WireElm && ce.busWidth > 1 ? WIRE + 2 : WIRE);
    const { size, dotRadius, chevronSize, spacing, bandWidth } = markerMetrics(this.vp.scale, width);
    const electron = !settings.conventionalCurrent;
    const color = electron ? ELECTRON_MARKER_COLOR : theme.current;
    const flow = this.model.currentFlow;
    const paths = flow.pathsFor(ce);
    const fast = paths.filter((path) => settings.currentSteadyBand && flow.isFast(ce, path.id));
    if (fast.length) {
      ctx.save();
      ctx.globalAlpha = electron ? 1 : settings.appearance === "light" || settings.whiteBackground ? 0.8 : 0.45;
      ctx.strokeStyle = color;
      ctx.lineWidth = bandWidth;
      ctx.beginPath();
      for (const path of fast) {
        const jumps = settings.showWireJumps ? this.jumpCache?.byElement.get(ce) ?? [] : [];
        for (const [a, b] of pathSegments(path)) {
          const points = jumps.length ? bridgePath([a, b], jumps, JUMP_RADIUS, JUMP_HALF_ANGLE) : [a, b];
          ctx.moveTo(points[0].x, points[0].y);
          for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        }
      }
      ctx.stroke();
      ctx.restore();
    }
    const markers = paths.flatMap((path) => {
      const steady = fast.includes(path);
      if (steady && !settings.currentSteadyArrows) return [];
      const positions = steady ? steadyMarkers(path, electron, 2.6 * chevronSize * 2)
        : flow.markersForPath(ce, path, this.vp.scale, electron, spacing);
      const jumps = settings.showWireJumps ? this.jumpCache?.byElement.get(ce) ?? [] : [];
      return positions.map((m) => ({ ...bridgeMarker(m, jumps, JUMP_RADIUS, JUMP_HALF_ANGLE), shape: steady ? "arrows" : settings.currentShape }));
    });
    ctx.fillStyle = color;
    ctx.beginPath();
    const chevrons: typeof markers = [];
    for (const m of markers) {
      if (m.shape === "dots") {
        const radius = dotRadius;
        ctx.moveTo(m.x + radius, m.y);
        ctx.arc(m.x, m.y, radius, 0, Math.PI * 2);
      } else if (m.shape === "squares") {
        ctx.rect(m.x - 2.1 * size, m.y - 2.1 * size, 4.2 * size, 4.2 * size);
      } else {
        chevrons.push(m);
      }
    }
    ctx.fill();
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4 * chevronSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (const m of chevrons) {
      const [a, tip, b] = chevronPoints(m, chevronSize);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Stable geometry: voltage and hover colors never change the stroke's width. */
  /** Lines are 15 % thinner on a light or white sheet. */
  private lineFactor(): number {
    return settings.appearance === "light" || settings.whiteBackground ? 0.85 : 1;
  }

  private lw(w: number): number {
    return Math.max(w, 1 / this.vp.scale) * this.lineFactor();
  }

  private stroke(pts: P[], color: string, width: number): void {
    if (pts.length < 2) return;
    if (this.measuring) return this.measuring(pts, color, false, width);
    const { ctx } = this;
    const jumps = this.activeElement && settings.showWireJumps ? this.jumpCache?.byElement.get(this.activeElement) : null;
    if (jumps?.length) pts = bridgePath(pts, jumps, JUMP_RADIUS, JUMP_HALF_ANGLE);
    ctx.strokeStyle = color;
    ctx.lineWidth = this.lw(width);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  private strokeSmooth(pts: P[], color: string, width: number): void {
    if (pts.length < 2) return;
    if (this.measuring) return this.measuring(pts, color, false, width);
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = this.lw(width);
    ctx.beginPath();
    traceSmoothCurve(ctx, pts);
    ctx.stroke();
  }

  private fill(pts: P[], color: string): void {
    if (this.measuring) return this.measuring(pts, color, true);
    const { ctx } = this;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fill();
  }

  private volt(e: CircuitElm, n: number): string {
    // (measuring a body: leads are never ink, whatever the voltage display)
    if (this.measuring) return "volt";
    if (!settings.showVoltage) return settings.appearance === "light" || settings.whiteBackground
      ? this.theme.ink : voltageColor(this.theme, 0, this.range);
    return voltageColor(this.theme, e.volts[n] ?? 0, this.range);
  }
}
