// Scope display after CircuitJS's Scope (time plots, XY plots, FFT), drawn for reading values off:
// per-division grid with labeled axes, a legend per trace, and optional measurements.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { ScopeFlag, ScopeValue } from "../engine";
import { axisFormat, parseSI, si } from "./format";
import { showFieldPopover } from "forge-shell/app/context-menu";
import { setTip } from "forge-shell/app/tips";
import { ExprTrace, MathTrace, ScopeRuntime, type ScopeScale, type ScopeTrace, type SimulationModel } from "./model";
import { anyMeasure, measure, measurementText, phase, WHOLE_CYCLES } from "./scope-measure";
import { currentTheme, LIGHT_SIGNALS, MONO, SANS } from "./theme";
import { settings } from "./settings";
import { wheelIntent } from "./wheel";
import { panRange, type Range, rangeOf, scaleOf, subRange, ticks, zoomRange } from "./scope-nav";
import { centeredScale, DIVS_Y, EMPTY_CELLS, fitScale, harmonics, spectrum, holdEnvelope, holdScale, niceCeil, originScale, readCells, readTail } from "./scope-math";
import type { AudioRange } from "./scope-audio";
import type { ScopeDropEdge } from "./scope-layout";
import { dragStarted, drawSelectionBox, dropEdge } from "forge-shell/app/content-selection";

const COLORS: Record<number, string> = {
  [ScopeValue.voltage]: "#3be05a",
  [ScopeValue.current]: "#ffd23f",
  [ScopeValue.power]: "#ff8a3d",
  [ScopeValue.charge]: "#2fd3e6",
};
/** Extra colors when a scope shows several parts' values of the same kind. */
const LIGHT_COLORS: Record<number, string> = {
  [ScopeValue.voltage]: LIGHT_SIGNALS.voltage,
  [ScopeValue.current]: LIGHT_SIGNALS.current,
  [ScopeValue.power]: LIGHT_SIGNALS.power,
  [ScopeValue.charge]: LIGHT_SIGNALS.charge,
};
const LIGHT_EXTRA = ["#2a5fd6", "#c0268f", "#6b3fc4", "#00877a", "#7a6a00"];
const EXTRA = ["#5ec8ff", "#ff6bd5", "#b48cff", "#ff5c5c", "#9cff6b"];
const AXIS_FONT = `10px ${MONO}`;
/** A header tile: an on/off switch, coloured when on (sound, Trigger or dB, Auto). */
export type ScopeTile = "audio" | "trigger" | "db" | "auto";
/**
 * What opens from the header: a tile's options (right-click), the plot type (the label beside the
 * tiles) or the measurement choices (the strip under the plot).
 */
export type ScopePanel = "audio" | "trigger" | "scale" | "plot" | "measure";
/** Acts at (x, y) in client pixels (a panel opens there, or above `top` when there's no room below). */
type ChipAction = (x: number, y: number, top: number) => void;
const DIVS_X = 10;
const UNIT_NAMES: Record<string, string> = { V: "Voltage", A: "Current", W: "Power", C: "Charge", "Ω": "Resistance", "°C": "Temperature", "°F": "Temperature", K: "Temperature" };
/** A color (from the extra ones) for each quantity beyond voltage, current, power and charge. */
const QUANTITY_COLOR: Record<number, number> = { 1: 0, 2: 1, 4: 2, 5: 3, 6: 4, 100: 2, 101: 0, 102: 5, 103: 6, 104: 7 };

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LegendItem {
  text: string;
  color: string;
  /** Clicking it opens its trace's menu (at client pixels). */
  open?: ChipAction;
}

/** Where a time plot is and what it showed in the last frame (for navigating it). */
interface PlotLayout {
  kind: "time" | "xy" | "fft";
  plot: Rect;
  /** What the plot showed along the bottom (time, X or frequency) and up the side, per unit on a time plot ("y" on X-Y, "fft" on a spectrum). */
  h: Range;
  v: Map<string, Range>;
  /** Units: along the bottom, up the side (X-Y and spectrum), and per side of a time plot. */
  hUnit: string;
  vUnit: string;
  vUnits: string[];
  /** The horizontal range is log10 of the value (a spectrum's logarithmic frequency axis). */
  hLog?: boolean;
  x0: number;
  span: number;
  bucket: number;
  defaultSpan: number;
  now: number;
  oldest: number;
  /** The fitted scales (what turning auto scale off keeps). */
  auto: Map<string, ScopeScale>;
  /** The scales drawn, per unit. */
  scales: Map<string, ScopeScale>;
  /** The recording level drawn. */
  level: number;
  /** Where the trigger level marker is (y), when the trigger is on. */
  triggerY: number | null;
}

/** Where the trigger point sits across a triggered plot (a division in from the left). */
const TRIGGER_AT = 0.1;
const CURSOR_NAMES = ["A", "B"];
/**
 * Measurement cursors (A and B: click to place, drag to move; Δt, 1/Δt, values and differences).
 * The hover readout remains available between cursor placements.
 */
export const MEASUREMENT_CURSORS = true;

/** Canvas controls use the interface's own tokens, read once per appearance. */
let tokenTheme = "";
let tokens: Record<string, string> = {};
function token(name: string): string {
  const theme = document.body.dataset.theme ?? "";
  if (theme !== tokenTheme || !tokens[name]) {
    if (theme !== tokenTheme) tokens = {};
    tokenTheme = theme;
    tokens[name] = getComputedStyle(document.body).getPropertyValue(name).trim();
  }
  return tokens[name];
}
const scopeAccent = (): string => token("--accent-fill");

/** The plot's neutral colors come from the interface tokens; the traces keep their own hues. */
function scopePalette(): { backdrop: string; surface: string; title: string; muted: string; grid: string; gridStrong: string; readout: string; border: string; cursor: string; accent: string; accentText: string } {
  const text = token("--text"), well = token("--well");
  return {
    backdrop: token("--window"), surface: well, title: text, muted: token("--text2"), grid: token("--hairline"),
    gridStrong: `color-mix(in srgb, ${text} 22%, transparent)`, readout: `color-mix(in srgb, ${well} 95%, transparent)`,
    border: token("--control-hover"), cursor: text, accent: scopeAccent(), accentText: token("--accent-foreground"),
  };
}

/** Bright traces keep their hue; small numbers use a readable ink on the pale plot. */
function scopeTextColor(color: string): string {
  if (settings.appearance !== "light") return color;
  if (color === LIGHT_SIGNALS.current) return scopePalette().title;
  if (color === LIGHT_SIGNALS.voltage) return "#00792b";
  if (color === LIGHT_SIGNALS.power) return "#b73500";
  if (color === LIGHT_SIGNALS.charge) return "#007c96";
  return color;
}

/**
 * All scopes side by side: dark wells with a labeled grid, legends and readouts.
 *
 * Time plots fill from the left while the first screen is recorded, then scroll. Every plot (time,
 * X-Y, spectrum) navigates the same way, running or paused, its grid on round values wherever it
 * goes: drag a box to zoom into it; two-finger scroll, middle-drag or Space-drag moves the plot;
 * pinch, ⌘-scroll or a mouse wheel zooms at the pointer (time or frequency; both axes on X-Y) and
 * ⌥-scroll the values. Over an axis the same moves or zooms that axis alone, and a click opens its
 * scale (per division, center or start). A live time plot that's running stays live when zoomed;
 * moving through time leaves live. Space or a double-click fits it, as on the schematic (live, its
 * own time per division, every axis automatic); right-click › Zoom back undoes a step.
 */
export class ScopeStrip {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly layouts = new Map<ScopeRuntime, PlotLayout>();
  /** Clickable header chips of the last frame. */
  private chips: { rect: Rect; action: ChipAction | null; title: string; menu?: ChipAction }[] = [];
  /** A plot or axis being dragged (from the ranges it showed then); an axis not dragged is a click. */
  private drag: { scope: ScopeRuntime; region: "plot" | "left" | "right" | "bottom"; axis: boolean; moved: boolean; x: number; y: number; h0: Range; v0: Map<string, Range> } | null = null;
  /** The scope and circuit time under the pointer (this frame), read out on every time plot. */
  private hover: { scope: ScopeRuntime; t: number } | null = null;
  /** Pointer position over the strip (CSS pixels), for the readout cursor. */
  private pointer: { x: number; y: number } | null = null;
  /** A measurement cursor (index) or the trigger level being dragged. */
  private cursorDrag: { scope: ScopeRuntime; index: number } | null = null;
  private levelDrag: ScopeRuntime | null = null;
  private levelBefore: number | null = null;
  /** Space is held (set by the app): a drag pans; whether it did (then the tap isn't one). */
  spaceHeld = false;
  spacePanned = false;
  /** A box being dragged in a time plot (box zoom), in canvas pixels. */
  private box: { scope: ScopeRuntime; x0: number; y0: number; x1: number; y1: number } | null = null;
  /** Cursors the last clicks added (a double-click's two clicks take theirs back). */
  private created: { scope: ScopeRuntime; index: number; at: number }[] = [];
  /** Painting a scope on the sheet (paintSingle): no clickable chips. */
  private sheet = false;
  /** Where the last two presses were (a double-click is two in one place). */
  private downs: [number, number][] = [];
  /** Relative widths of side-by-side columns, by scope position (missing: 1). Not saved. */
  private readonly widths = new Map<number, number>();
  /** A divider between two columns being dragged. */
  private columnDrag: { left: number; right: number; x: number; a: number; b: number } | null = null;
  private scopeDrag: { scope: ScopeRuntime; x: number; y: number; active: boolean; target: ScopeRuntime | null; edge: ScopeDropEdge } | null = null;

  /** The note shown instead of the plots while there are none. */
  private readonly emptyNote: HTMLElement;

  constructor(private readonly canvas: HTMLCanvasElement, private model: SimulationModel,
    private readonly triggerEdit?: {
      beginTriggerEdit: () => void;
      endTriggerEdit: (changed: boolean) => void;
      moveScope?: (source: ScopeRuntime, target: ScopeRuntime, edge: ScopeDropEdge) => boolean;
    },
    private readonly controls?: {
      listeningTrace: (scope: ScopeRuntime) => ScopeTrace | null;
      /** Switch a header tile on or off. */
      toggle: (scope: ScopeRuntime, tile: ScopeTile) => void;
      /** Open a tile's options at (x, y) in client pixels. */
      panel: (scope: ScopeRuntime, panel: ScopePanel, x: number, y: number, top: number) => void;
      /** Open a trace's menu (its legend entry was clicked). */
      traceMenu: (scope: ScopeRuntime, trace: ScopeTrace, x: number, y: number, top: number) => void;
    }) {
    this.ctx = canvas.getContext("2d")!;
    this.emptyNote = Object.assign(document.createElement("div"), { className: "pane-empty", textContent: "No scopes. Right-click a component and choose View in scope." });
    canvas.after(this.emptyNote);
    canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    canvas.addEventListener("pointermove", (e) => this.onPointerMove(e));
    canvas.addEventListener("pointerup", (e) => {
      if (this.scopeDrag) this.moveScopeDrag(...this.local(e));
      this.endDrags();
    });
    canvas.addEventListener("pointerleave", () => (this.pointer = null));
    canvas.addEventListener("pointercancel", () => this.endDrags(false));
    canvas.addEventListener("lostpointercapture", () => { if (this.scopeDrag) this.endDrags(false); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.scopeDrag) {
        this.endDrags(false);
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }, true);
    canvas.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener("auxclick", (e) => e.button === 1 && e.preventDefault());
    canvas.addEventListener("dblclick", (e) => {
      // on a divider: the columns go back to equal widths
      const [lx, ly] = this.local(e);
      if (this.dividerAt(lx, ly) !== null) {
        this.widths.clear();
        this.draw();
        return;
      }
      const s = this.scopeAt(e.clientX, e.clientY);
      // two quick clicks in different places place two cursors; only one place is a double-click
      const [a, b] = this.downs;
      if (!s || !a || !b || Math.hypot(a[0] - b[0], a[1] - b[1]) > 4) return;
      // the double-click's clicks placed cursors: not meant
      const now = performance.now();
      for (const c of this.created.reverse()) if (c.scope === s && now - c.at < 1000) s.view.cursors.splice(c.index, 1);
      this.created = [];
      s.resetView(this.model.sim.t);
      this.draw();
    });
  }


  private local(e: MouseEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  /** Where a panel opens under a chip: (x, y, top) in client pixels. */
  private below(r: Rect, b = this.canvas.getBoundingClientRect()): [number, number, number] {
    return [b.left + r.x, b.top + r.y + r.h + 4, b.top + r.y];
  }

  /** A right-click on a tile with options of its own opens them; false if there's none there. */
  tileMenuAt(clientX: number, clientY: number): boolean {
    const b = this.canvas.getBoundingClientRect();
    const chip = this.chipAt(clientX - b.left, clientY - b.top);
    if (!chip?.menu) return false;
    chip.menu(...this.below(chip.rect, b));
    return true;
  }

  private chipAt(x: number, y: number) {
    return this.chips.find((c) => x >= c.rect.x && x <= c.rect.x + c.rect.w && y >= c.rect.y && y <= c.rect.y + c.rect.h);
  }

  /**
   * What is under a point: a scope, its last layout and which part of it: the plot, the value
   * axis beside it (left, or right for a second unit) or the axis below it.
   */
  private regionAt(x: number, y: number): { scope: ScopeRuntime; L: PlotLayout; region: "plot" | "left" | "right" | "bottom" } | null {
    const i = this.rects().findIndex((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
    const scope = this.model.scopes[i], L = scope && this.layouts.get(scope);
    if (!scope || !L) return null;
    const { plot } = L, r = this.rects()[i];
    const inX = x >= plot.x && x <= plot.x + plot.w, inY = y >= plot.y && y <= plot.y + plot.h;
    if (inX && inY) return { scope, L, region: "plot" };
    if (inY && x < plot.x) return { scope, L, region: "left" };
    if (inY && x > plot.x + plot.w && x < r.x + r.w) return { scope, L, region: "right" };
    if (inX && y > plot.y + plot.h && y <= plot.y + plot.h + 18) return { scope, L, region: "bottom" };
    return null;
  }

  /**
   * Show new ranges: `h` along the bottom (time, X or frequency), `v` up the side (per unit on a
   * time plot, "y" on X-Y, "fft" on a spectrum). A time plot that's live while running stays live
   * when zoomed (its window gets the new length); otherwise moving through time leaves live. Values
   * stop being automatic on the axes that move.
   */
  private navigate(scope: ScopeRuntime, L: PlotLayout, h: Range | null, v: Map<string, Range> | null, how: "zoom" | "pan"): void {
    const view = scope.view, ok = (r: Range | undefined | null): r is Range => !!r && r.hi > r.lo && Number.isFinite(r.hi - r.lo);
    if (ok(h)) {
      if (L.kind === "time") {
        if (how === "zoom" && view.live && this.model.running) {
          view.liveSpan = Math.min(1e12, Math.max(this.model.sim.maxTimeStep * 8, h.hi - h.lo));
        } else {
          if (view.live) {
            view.live = false;
            view.cursors = view.cursors.map((c) => L.x0 + c);
          }
          view.start = h.lo;
          view.span = h.hi - h.lo;
          this.clampView(scope, L);
        }
      } else if (L.kind === "xy") this.xyManual(scope, L).x = scaleOf(h, DIVS_X);
      else view.fftX = L.hLog ? { lo: 10 ** h.lo, hi: 10 ** h.hi } : { lo: Math.max(0, h.lo), hi: h.hi };
    }
    if (v) {
      if (L.kind === "time") {
        const scales = [...v].filter(([, r]) => ok(r));
        if (scales.length) {
          const manual = this.manualScales(scope);
          for (const [u, r] of scales) manual.set(u, scaleOf(r, DIVS_Y));
        }
      } else if (L.kind === "xy") {
        const r = v.get("y");
        if (ok(r)) this.xyManual(scope, L).y = scaleOf(r, DIVS_Y);
      } else {
        const r = v.get("fft");
        if (ok(r)) view.fftY = r;
      }
    }
    this.draw();
  }

  /** The X-Y plot's manual scales, taking over from auto at what it showed. */
  private xyManual(scope: ScopeRuntime, L: PlotLayout): { x: ScopeScale; y: ScopeScale } {
    if (scope.xyAuto || !scope.xyManual) {
      scope.xyManual = { x: scaleOf(L.h, DIVS_X), y: scaleOf(L.v.get("y") ?? { lo: -1, hi: 1 }, DIVS_Y) };
      scope.xyAuto = false;
    }
    return scope.xyManual;
  }

  /** Every vertical range of a layout zoomed or moved the same way. */
  private mapV(L: PlotLayout, f: (r: Range) => Range): Map<string, Range> {
    return new Map([...L.v].map(([k, r]) => [k, f(r)]));
  }

  /** Open the scale editor for an axis (a click on it): per division, and the center or start. */
  private editAxis(scope: ScopeRuntime, L: PlotLayout, region: "left" | "right" | "bottom", x: number, y: number, top: number): void {
    const parse = (text: string, unit: string) => parseSI(text, unit);
    const num = (v: number, unit: string) => si(v, unit, true, 4);
    if (region === "bottom" && L.kind === "time") {
      const live = scope.view.live, step = ticks(L.h, DIVS_X).step;
      const fields = [{ label: "Time per division", value: num(step, "s") }, ...(live ? [] : [{ label: "Start", value: num(L.h.lo, "s") }])];
      showFieldPopover(x, y, "Time axis", fields, ([div, start]) => {
        const d = parse(div, "s");
        if (!(d > 0)) return { field: 0, error: "Enter a time, e.g. 2ms." };
        const t0 = live ? L.h.lo : parse(start, "s");
        if (!Number.isFinite(t0)) return { field: 1, error: "Enter a time, e.g. 10ms." };
        scope.pushNav();
        if (live) {
          scope.view.liveSpan = Math.max(this.model.sim.maxTimeStep * 8, d * DIVS_X);
          this.draw();
        } else this.navigate(scope, L, { lo: t0, hi: t0 + d * DIVS_X }, null, "pan");
        return null;
      }, top);
      return;
    }
    // a logarithmic frequency axis: from and to
    if (region === "bottom" && L.hLog) {
      showFieldPopover(x, y, "Frequency axis", [{ label: "From", value: si(10 ** L.h.lo, "Hz", true, 4) }, { label: "To", value: si(10 ** L.h.hi, "Hz", true, 4) }], ([a, b]) => {
        const lo = parse(a, "Hz"), hi = parse(b, "Hz");
        if (!(lo > 0)) return { field: 0, error: "Enter a frequency above 0 Hz." };
        if (!(hi > lo)) return { field: 1, error: "Enter a frequency above From." };
        scope.pushNav();
        scope.view.fftX = { lo, hi };
        this.draw();
        return null;
      }, top);
      return;
    }
    // a value axis: which range and unit
    const horizontal = region === "bottom";
    const key = horizontal ? null : L.kind === "time" ? L.vUnits[region === "right" ? 1 : 0] : [...L.v.keys()][0];
    const r = horizontal ? L.h : key !== null && key !== undefined ? L.v.get(key) : undefined;
    if (!r) return;
    const unit = horizontal ? L.hUnit : L.kind === "time" ? key! : L.vUnit;
    const divs = horizontal ? DIVS_X : DIVS_Y;
    const name = horizontal ? (L.kind === "fft" ? "Frequency axis" : "X axis") : L.kind === "xy" ? "Y axis" : L.kind === "fft" ? "Magnitude axis" : `${UNIT_NAMES[unit] ?? unit} axis`;
    const step = ticks(r, divs).step, center = (r.lo + r.hi) / 2;
    showFieldPopover(x, y, name, [{ label: "Per division", value: num(step, unit) }, { label: "Center", value: num(center, unit) }], ([div, mid]) => {
      const d = parse(div, unit), c = parse(mid, unit);
      if (!(d > 0)) return { field: 0, error: "Enter a positive value." };
      if (!Number.isFinite(c)) return { field: 1, error: "Enter a value." };
      scope.pushNav();
      const range = { lo: c - (d * divs) / 2, hi: c + (d * divs) / 2 };
      if (horizontal) this.navigate(scope, L, range, null, "pan");
      else this.navigate(scope, L, null, new Map([[key!, range]]), "pan");
      return null;
    }, top);
  }

  private endDrags(commitLayout = true): void {
    const moving = this.scopeDrag;
    this.scopeDrag = null;
    if (commitLayout && moving?.active && moving.target
      && this.triggerEdit?.moveScope?.(moving.scope, moving.target, moving.edge)) this.widths.clear();
    this.canvas.style.cursor = "";
    this.columnDrag = null;
    if (this.levelDrag) this.triggerEdit?.endTriggerEdit(this.levelDrag.view.trigger.level !== this.levelBefore);
    // a box hardly dragged is a click: on a time plot it places a cursor (A, then B; then the
    // nearer one moves)
    const b = this.box;
    if (b && Math.abs(b.x1 - b.x0) < 4 && Math.abs(b.y1 - b.y0) < 4) this.placeCursor(b.scope, b.x0);
    else if (b) this.applyBox(b);
    this.box = null;
    // a click on an axis (not dragged): its scale editor
    const d = this.drag;
    if (commitLayout && d?.axis && !d.moved && d.region !== "plot") {
      const L = this.layouts.get(d.scope), b = this.canvas.getBoundingClientRect();
      const region = d.region;
      if (L) setTimeout(() => this.editAxis(d.scope, L, region, b.left + d.x - 20, b.top + d.y + 12, b.top + d.y - 8));
    }
    this.drag = null;
    this.cursorDrag = null;
    this.levelDrag = null;
    this.levelBefore = null;
    this.draw();
  }

  /**
   * Box zoom: the box dragged over a plot fills it, on any plot. Running, a time plot's box keeps
   * it live with a window that long. A box only a few pixels tall or wide zooms one way only.
   * Space or a double-click fits the plot again; right-click › Zoom back undoes one step.
   */
  private applyBox(b: { scope: ScopeRuntime; x0: number; y0: number; x1: number; y1: number }): void {
    const L = this.layouts.get(b.scope);
    if (!L) return;
    const { plot } = L;
    const fx = (x: number) => Math.min(1, Math.max(0, (x - plot.x) / plot.w));
    const fy = (y: number) => Math.min(1, Math.max(0, (plot.y + plot.h - y) / plot.h));
    const wide = Math.abs(b.x1 - b.x0) >= 6, tall = Math.abs(b.y1 - b.y0) >= 6;
    if (!wide && !tall) return;
    b.scope.pushNav();
    this.navigate(b.scope, L,
      wide ? subRange(L.h, fx(b.x0), fx(b.x1)) : null,
      tall ? this.mapV(L, (r) => subRange(r, fy(b.y0), fy(b.y1))) : null, "zoom");
  }

  /** Is the pointer over the scopes? */
  get hovered(): boolean {
    return this.pointer !== null;
  }

  /** The scope under the pointer back to how it started: live, auto scale, its time per division (Space). */
  resetHovered(): void {
    const p = this.pointer;
    if (!p) return;
    const b = this.canvas.getBoundingClientRect();
    const s = this.scopeAt(b.left + p.x, b.top + p.y);
    if (!s) return;
    s.resetView(this.model.sim.t);
    this.draw();
  }

  private placeCursor(scope: ScopeRuntime, x: number): void {
    const L = this.layouts.get(scope);
    if (!MEASUREMENT_CURSORS || !L || L.kind !== "time" || !this.model.scopes.includes(scope)) return;
    const cursors = scope.view.cursors;
    const xs = cursors.map((c) => L.plot.x + ((this.cursorTime(scope, L, c) - L.x0) / L.span) * L.plot.w);
    const index = cursors.length < 2 ? cursors.length : Math.abs(xs[0] - x) <= Math.abs(xs[1] - x) ? 0 : 1;
    if (index === cursors.length) this.created.push({ scope, index, at: performance.now() });
    this.setCursor(scope, L, index, x);
  }

  /** A cursor's circuit time in a plot. */
  private cursorTime(scope: ScopeRuntime, L: PlotLayout, c: number): number {
    return scope.view.live ? L.x0 + c : c;
  }

  /** Set a cursor at pointer x (stored as the view keeps cursors: from the left edge while live). */
  private setCursor(scope: ScopeRuntime, L: PlotLayout, index: number, x: number): void {
    const f = Math.min(1, Math.max(0, (x - L.plot.x) / L.plot.w));
    scope.view.cursors[index] = scope.view.live ? f * L.span : L.x0 + f * L.span;
  }

  /** Start a box zoom, from a press inside a time plot. */
  private startBox(e: PointerEvent, x: number, y: number): void {
    const scope = this.scopeAt(e.clientX, e.clientY);
    const L = scope && this.layouts.get(scope);
    if (!scope || !L) return;
    const { plot } = L;
    if (x < plot.x || x > plot.x + plot.w || y < plot.y || y > plot.y + plot.h) return;
    this.box = { scope, x0: x, y0: y, x1: x, y1: y };
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // synthetic events
    }
  }

  /**
   * A press in a time plot: on the trigger level marker, drag the level; else place or move a
   * measurement cursor (A, then B; then the nearer one moves) and drag it.
   */
  private pressPlot(e: PointerEvent, x: number, y: number): boolean {
    const scope = this.scopeAt(e.clientX, e.clientY);
    const L = scope && this.layouts.get(scope);
    if (!scope || !L || scope.has(ScopeFlag.fft) || scope.isXY) return false;
    const { plot } = L;
    if (L.triggerY !== null && x >= plot.x - 12 && x <= plot.x + 4 && Math.abs(y - L.triggerY) <= 7) {
      this.triggerEdit?.beginTriggerEdit();
      this.levelBefore = scope.view.trigger.level;
      this.levelDrag = scope;
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // synthetic events
      }
      return true;
    }
    // on a cursor: drag it (elsewhere a press starts a box zoom; a click places a cursor)
    if (!MEASUREMENT_CURSORS || x < plot.x || x > plot.x + plot.w || y < plot.y || y > plot.y + plot.h) return false;
    const xs = scope.view.cursors.map((c) => plot.x + ((this.cursorTime(scope, L, c) - L.x0) / L.span) * plot.w);
    const index = xs.findIndex((cx) => Math.abs(cx - x) <= 5);
    if (index < 0) return false;
    this.cursorDrag = { scope, index };
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // synthetic events
    }
    return true;
  }

  /**
   * Keep the view on the recording: not zoomed in past a few buckets or out much beyond it, not
   * panned off it, and never before time 0.
   */
  private clampView(scope: ScopeRuntime, L: PlotLayout): void {
    const v = scope.view;
    const maxSpan = Math.max(L.defaultSpan, (L.now - L.oldest) * 1.25);
    v.span = Math.min(maxSpan, Math.max(L.bucket * 4, v.span));
    v.start = Math.max(0, Math.min(L.now - v.span / 2, Math.max(L.oldest - v.span / 2, v.start)));
  }

  /** Switch a spectrum's automatic ranges; off keeps what it shows. */
  setFFTAuto(scope: ScopeRuntime, on: boolean): void {
    const L = this.layouts.get(scope);
    scope.pushNav();
    scope.view.fftX = on || L?.kind !== "fft" ? null : { ...L.h };
    scope.view.fftY = on || L?.kind !== "fft" ? null : { ...L.v.get("fft")! };
    this.draw();
  }

  /** Switch X-Y auto scale; switching it off puts the origin in the middle, showing the figure. */
  setXYAuto(scope: ScopeRuntime, on: boolean): void {
    if (!on) {
      const e = scope.xyEnvelope, max = (v?: { lo: number; hi: number }) => v ? Math.max(Math.abs(v.lo), Math.abs(v.hi)) : 0;
      scope.xyManual = { x: originScale(max(e.x), DIVS_X), y: originScale(max(e.y), DIVS_Y) };
    }
    scope.xyAuto = on;
    this.draw();
  }

  /** The scope's manual scales per unit (turning auto scale off, from what it showed). */
  manualScales(scope: ScopeRuntime): Map<string, ScopeScale> {
    if (scope.view.autoY) this.setAutoY(scope, false);
    return scope.view.scales;
  }

  private onPointerDown(e: PointerEvent): void {
    const [x, y] = this.local(e);
    this.downs = [...this.downs.slice(-1), [x, y]];
    const divider = e.button === 0 ? this.dividerAt(x, y) : null;
    if (divider !== null) {
      const cols = this.columns();
      const left = cols[divider].position, right = cols[divider + 1].position;
      this.columnDrag = { left, right, x, a: this.widths.get(left) ?? 1, b: this.widths.get(right) ?? 1 };
      this.capture(e);
      return;
    }
    // middle-drag, or a drag with Space held, pans (as on the schematic)
    const pan = e.button === 1 || (e.button === 0 && this.spaceHeld);
    if (e.button === 0 && !pan) {
      const chip = this.chipAt(x, y);
      const at = chip ? null : this.regionAt(x, y);
      if (chip) {
        const b = this.canvas.getBoundingClientRect();
        // after this press's mousedown, which would close a panel as a click outside it
        const action = chip.action;
        if (action) setTimeout(() => action(...this.below(chip.rect, b)));
      }
      else if (this.headerAt(x, y) && this.triggerEdit?.moveScope) {
        this.scopeDrag = { scope: this.headerAt(x, y)!, x, y, active: false, target: null, edge: "above" };
        e.preventDefault();
        this.canvas.style.cursor = "grabbing";
        this.capture(e);
      }
      // an axis: dragging moves it, a click opens its scale
      else if (at && at.region !== "plot" && !this.sheet) this.startPan(e, at, x, y, true);
      else if (!this.pressPlot(e, x, y)) this.startBox(e, x, y);
      this.draw();
      return;
    }
    if (!pan) return;
    if (this.spaceHeld) this.spacePanned = true;
    e.preventDefault();
    const at = this.regionAt(x, y);
    if (at) this.startPan(e, at, x, y, false);
  }

  private capture(e: PointerEvent): void {
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // not an active pointer (synthetic events): the drag still works while over the canvas
    }
  }

  /** Start dragging a plot (both ways) or one of its axes (that axis only), from what it shows. */
  private startPan(e: PointerEvent, at: NonNullable<ReturnType<ScopeStrip["regionAt"]>>, x: number, y: number, axis: boolean): void {
    this.capture(e);
    this.drag = { scope: at.scope, region: at.region, axis, moved: false, x, y, h0: { ...at.L.h }, v0: this.mapV(at.L, (r) => ({ ...r })) };
  }

  /** The tooltip and mouse cursor for what is under the pointer (also redone when space is pressed or released). */
  private hoverFeedback(x: number, y: number): void {
    const chip = this.chipAt(x, y);
    const header = this.headerAt(x, y);
    const region = !chip && !header && !this.drag && !this.box ? this.regionAt(x, y)?.region : undefined;
    setTip(this.canvas, chip?.title ?? (header ? "Drag beside a scope for columns, or above or below to stack. Esc cancels."
      : region && region !== "plot" ? "Drag to move this axis, scroll to zoom it, click to set its scale." : ""));
    this.canvas.style.cursor = this.dividerAt(x, y) !== null ? "col-resize" : chip ? "default"
      : this.drag ? "grabbing" : this.spaceHeld || header ? "grab" : this.cursorDrag ? "ew-resize" : this.levelDrag ? "ns-resize"
        : region === "bottom" ? "ew-resize" : region === "left" || region === "right" ? "ns-resize" : region === "plot" ? "crosshair" : "";
  }

  /** Redo the cursor for the pointer where it rests (the space key changes it without a move). */
  refreshCursor(): void {
    if (this.pointer && !this.scopeDrag && !this.columnDrag && !this.box) this.hoverFeedback(this.pointer.x, this.pointer.y);
  }

  private onPointerMove(e: PointerEvent): void {
    const [x, y] = this.local(e);
    this.pointer = { x, y };
    if (this.scopeDrag) { this.moveScopeDrag(x, y); return; }
    if (this.columnDrag) {
      this.moveDivider(x);
      return;
    }
    this.hoverFeedback(x, y);
    if (this.box) {
      this.box.x1 = x;
      this.box.y1 = y;
      this.draw();
      return;
    }
    if (this.cursorDrag) {
      const L = this.layouts.get(this.cursorDrag.scope);
      if (L) this.setCursor(this.cursorDrag.scope, L, this.cursorDrag.index, x);
      this.draw();
      return;
    }
    if (this.levelDrag) {
      const scope = this.levelDrag, L = this.layouts.get(scope);
      const t = scope.traces[triggerIndex(scope)];
      const sc = t && L?.scales.get(t.unit);
      if (L && sc) scope.view.trigger.level = sc.center + ((L.plot.y + L.plot.h / 2 - y) / (L.plot.h / DIVS_Y)) * sc.perDiv;
      this.draw();
      return;
    }
    const d = this.drag;
    const L = d && this.layouts.get(d.scope);
    if (!d || !L) return;
    if (!d.moved) {
      if (Math.hypot(x - d.x, y - d.y) < 3) return;
      d.moved = true;
      d.scope.pushNav();
    }
    // the content follows the pointer; on a time plot, up and down only past a small dead zone
    const fx = (x - d.x) / L.plot.w, fy = (y - d.y) / L.plot.h;
    const moveH = d.region === "plot" || d.region === "bottom";
    const moveV = (d.region === "plot" && (L.kind !== "time" || Math.abs(y - d.y) > 4)) || d.region === "left" || d.region === "right";
    this.navigate(d.scope, L, moveH ? panRange(d.h0, -fx) : null, moveV ? new Map([...d.v0].map(([k, r]) => [k, panRange(r, fy)])) : null, "pan");
  }

  /**
   * Scroll and pinch, as on the schematic: over the plot, a pinch, ⌘-scroll or a mouse wheel zooms
   * at the pointer (time or frequency; both axes on X-Y), ⌥ zooms the values instead, and a
   * trackpad's two-finger scroll moves the plot. Over an axis, the same zoom or move that axis only.
   */
  private onWheel(e: WheelEvent): void {
    const [x, y] = this.local(e);
    const at = this.regionAt(x, y);
    if (!at || this.sheet) return;
    e.preventDefault();
    const { scope, L, region } = at, { plot } = L;
    const fx = Math.min(1, Math.max(0, (x - plot.x) / plot.w)), fy = Math.min(1, Math.max(0, (plot.y + plot.h - y) / plot.h));
    const w = e.altKey && !e.ctrlKey && !e.metaKey
      ? { kind: "zoom" as const, factor: Math.exp(-(e.deltaY || e.deltaX) * 0.003), alt: true }
      : { ...wheelIntent(e), alt: false };
    scope.pushNav(true);
    if (w.kind === "zoom") {
      const k = 1 / w.factor;
      const both = L.kind === "xy" && region === "plot" && !w.alt;
      const zoomH = region === "bottom" || (region === "plot" && !w.alt);
      const zoomV = region === "left" || region === "right" || (region === "plot" && (w.alt || both));
      // the time axis of a live, running plot keeps its right edge: the newest data stays in view
      const live = L.kind === "time" && scope.view.live && this.model.running;
      this.navigate(scope, L, zoomH ? zoomRange(L.h, k, live ? 1 : fx) : null, zoomV ? this.mapV(L, (r) => zoomRange(r, k, fy)) : null, "zoom");
    } else {
      const horizontal = region === "bottom" ? (w.dx || w.dy) : region === "plot" ? w.dx : 0;
      const vertical = region === "left" || region === "right" ? w.dy : region === "plot" && Math.abs(w.dy) > Math.abs(w.dx) ? w.dy : 0;
      this.navigate(scope, L, horizontal ? panRange(L.h, horizontal / plot.w) : null, vertical ? this.mapV(L, (r) => panRange(r, -vertical / plot.h)) : null, "pan");
    }
  }

  setModel(model: SimulationModel): void {
    if (model !== this.model) { this.widths.clear(); this.scopeDrag = null; }
    this.model = model;
  }

  /**
   * Draw one scope filling this (offscreen) canvas, w × h CSS pixels at the given pixel ratio:
   * for scopes drawn on the sheet. Returns the canvas.
   */
  paintSingle(scope: ScopeRuntime, w: number, h: number, dpr: number): HTMLCanvasElement {
    const { canvas, ctx } = this;
    const pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.chips = [];
    this.sheet = true;
    this.drawScope(scope, { x: 0, y: 0, w, h });
    return canvas;
  }

  /**
   * Scope rectangles in CSS pixels, in the model's order: a column per position, side by side,
   * the scopes stacked in a column sharing its height.
   */
  private rects(): Rect[] {
    const scopes = this.model.scopes;
    const columns = this.columns();
    const h = this.canvas.clientHeight;
    return scopes.map((s) => {
      const stack = scopes.filter((x) => x.position === s.position);
      const k = stack.indexOf(s), sh = h / stack.length;
      const c = columns.find((col) => col.position === s.position)!;
      return { x: c.x, y: k * sh, w: c.w, h: sh };
    });
  }

  private headerAt(x: number, y: number): ScopeRuntime | null {
    if (this.sheet) return null;
    const i = this.rects().findIndex((r) => x >= r.x + 5 && x < r.x + r.w - 5 && y >= r.y && y < r.y + 28);
    return i < 0 ? null : this.model.scopes[i];
  }

  private moveScopeDrag(x: number, y: number): void {
    const drag = this.scopeDrag!;
    if (!drag.active && !dragStarted(drag.x, drag.y, x, y)) return;
    drag.active = true;
    drag.target = null;
    const rects = this.rects();
    const i = rects.findIndex((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
    if (i >= 0) {
      const r = rects[i];
      drag.edge = dropEdge({ x, y }, { x: r.x, y: r.y, width: r.w, height: r.h });
      const target = this.model.scopes[i];
      if (target !== drag.scope || ((drag.edge === "left" || drag.edge === "right") && this.model.isStacked(target))) drag.target = target;
    }
    this.canvas.style.cursor = drag.target ? "grabbing" : "not-allowed";
    this.draw();
  }

  /** The columns, left to right, sized by their relative widths. */
  private columns(): { position: number; x: number; w: number }[] {
    const positions = [...new Set(this.model.scopes.map((s) => s.position))];
    const share = (p: number) => this.widths.get(p) ?? 1;
    const total = positions.reduce((sum, p) => sum + share(p), 0) || 1;
    let x = 0;
    return positions.map((position) => {
      const w = (this.canvas.clientWidth * share(position)) / total;
      const c = { position, x, w };
      x += w;
      return c;
    });
  }

  /** The divider (index of the column on its left) within reach of x, if any. */
  private dividerAt(x: number, _y: number): number | null {
    const cols = this.columns();
    for (let i = 0; i < cols.length - 1; i++) if (Math.abs(cols[i].x + cols[i].w - x) <= 4) return i;
    return null;
  }

  /** Drag a divider: the two columns beside it trade width (each keeps at least 160 px). */
  private moveDivider(x: number): void {
    const d = this.columnDrag!;
    const cols = this.columns();
    const unit = this.canvas.clientWidth / cols.reduce((sum, c) => sum + (this.widths.get(c.position) ?? 1), 0);
    const pair = d.a + d.b;
    const min = Math.min(160 / unit, pair / 2);
    const a = Math.min(pair - min, Math.max(min, d.a + (x - d.x) / unit));
    this.widths.set(d.left, a);
    this.widths.set(d.right, pair - a);
    this.draw();
  }

  scopeAt(clientX: number, clientY: number): ScopeRuntime | null {
    const b = this.canvas.getBoundingClientRect();
    const x = clientX - b.left, y = clientY - b.top;
    const i = this.rects().findIndex((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
    return i >= 0 ? this.model.scopes[i] : null;
  }

  draw(): void {
    const { canvas, ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.chips = [];
    const colors = scopePalette();
    ctx.fillStyle = colors.backdrop;
    ctx.fillRect(0, 0, w, h);
    // with no scopes, the panel's empty note (in the page, styled like the terminal's) covers the canvas
    this.emptyNote.hidden = this.model.scopes.length > 0;
    if (this.model.scopes.length === 0) return;
    // the moment under the pointer (from the last frame's layout), for every scope's readout
    this.hover = null;
    const p = this.pointer;
    if (p && settings.linkedReadout) {
      const b = this.canvas.getBoundingClientRect();
      const under = this.scopeAt(b.left + p.x, b.top + p.y);
      const L = under && this.layouts.get(under);
      if (under && L && !under.has(ScopeFlag.fft) && !under.isXY && p.x >= L.plot.x && p.x <= L.plot.x + L.plot.w && p.y >= L.plot.y - 4 && p.y <= L.plot.y + L.plot.h + 4) {
        if (L.kind === "time") this.hover = { scope: under, t: L.x0 + ((p.x - L.plot.x) / L.plot.w) * L.span };
      }
    }
    const rects = this.rects();
    // a 2 px gap between columns and between stacked scopes
    this.model.scopes.forEach((s, i) => {
      const r = rects[i];
      this.drawScope(s, { x: r.x + 1, y: r.y + (r.y > 0 ? 1 : 0), w: r.w - 2, h: r.h - (r.y > 0 ? 1 : 0) - (r.y + r.h < h - 0.5 ? 1 : 0) });
    });
    const drag = this.scopeDrag;
    if (drag?.active) {
      const target = drag.target && rects[this.model.scopes.indexOf(drag.target)];
      if (target) {
        ctx.save();
        ctx.strokeStyle = currentTheme().accent;
        ctx.lineWidth = 3;
        const horizontal = drag.edge === "above" || drag.edge === "below";
        ctx.beginPath();
        if (horizontal) {
          const y = Math.max(2, Math.min(h - 2, target.y + (drag.edge === "below" ? target.h : 0)));
          ctx.moveTo(target.x + 3, y); ctx.lineTo(target.x + target.w - 3, y);
        } else {
          const x = Math.max(2, Math.min(w - 2, target.x + (drag.edge === "right" ? target.w : 0)));
          ctx.moveTo(x, 2); ctx.lineTo(x, h - 2);
        }
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  private traceColor(scope: ScopeRuntime, t: ScopeTrace): string {
    const colors = settings.appearance === "light" ? LIGHT_COLORS : COLORS;
    const extra = settings.appearance === "light" ? LIGHT_EXTRA : EXTRA;
    // math and expression traces after the parts' colors, each its own
    if (t instanceof MathTrace || t instanceof ExprTrace) {
      const maths = scope.traces.filter((x) => x instanceof MathTrace || x instanceof ExprTrace);
      return extra[(maths.indexOf(t) + 2) % extra.length];
    }
    // the first part keeps the standard colors (other quantities one each); other parts get their own
    const elms = [...new Set(scope.traces.filter((x) => !(x instanceof MathTrace) && !(x instanceof ExprTrace)).map((x) => x.elm))];
    const k = elms.indexOf(t.elm);
    if (k > 0) return extra[(k - 1) % extra.length];
    return colors[t.value] ?? extra[(QUANTITY_COLOR[t.value] ?? 0) % extra.length];
  }

  private traceName(scope: ScopeRuntime, t: ScopeTrace): string {
    if (t instanceof ExprTrace) return t.text((elm, label) => `${label}(${this.model.designator(elm) ?? "?"})`);
    if (t instanceof MathTrace) {
      const a = this.traceName(scope, t.a), b = t.b ? this.traceName(scope, t.b) : "";
      return t.op === "sub" ? `${a}−${b}` : t.op === "add" ? `${a}+${b}` : t.op === "mul" ? `${a}×${b}` : t.op === "div" ? `${a}÷${b}` : t.op === "int" ? `∫${a}` : `d${a}/dt`;
    }
    const multi = new Set(scope.traces.filter((x) => !(x instanceof MathTrace)).map((x) => x.elm)).size > 1 || scope.traces.some((x) => x instanceof ExprTrace);
    return multi ? `${t.quantity.label}(${this.model.designator(t.elm) ?? "?"})` : t.quantity.label;
  }

  private drawScope(scope: ScopeRuntime, r: Rect): void {
    const { ctx } = this;
    const colors = scopePalette();
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.fillStyle = colors.surface;
    ctx.fillRect(r.x, r.y, r.w, r.h);

    // header: the part(s), then the legend
    const elms = [...new Set(scope.traces.map((t) => t.elm))];
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = `600 11px ${SANS}`;
    ctx.fillStyle = colors.title;
    const head = elms.length === 1
      ? [this.model.designator(elms[0]), this.model.scopeCaption(elms[0])].filter(Boolean).join("  ")
      : elms.map((e) => this.model.designator(e) ?? "?").join(", ");
    // X-Y is titled by what it plots: Y vs X
    const axes = scope.isXY && !scope.has(ScopeFlag.fft) ? scope.xyTraces : null;
    const mode = scope.sweep ? scope.sweep.title : scope.has(ScopeFlag.fft) ? "FFT" : axes ? `${this.traceName(scope, axes[1])} vs ${this.traceName(scope, axes[0])}` : scope.isXY ? "X-Y" : "";
    let headerRight = mode ? this.drawModeHeader(scope, r, mode) : r.x + r.w - 8;

    // a second unit (current next to voltage) gets its own axis on the right
    // (a sweep is never one, even with a single trace)
    const timePlot = !scope.sweep && !scope.has(ScopeFlag.fft) && !scope.isXY;
    // a tiny scope on the sheet: the traces alone, as CircuitJS draws small scopes (never in the panel)
    if (this.sheet && timePlot && (r.w < 160 || r.h < 80)) {
      this.drawTime(scope, { x: r.x + 2, y: r.y + 2, w: r.w - 4, h: r.h - 4 }, r, "mini");
      ctx.restore();
      return;
    }
    const rightAxis = !!scope.sweep?.phase || ((timePlot || !!scope.sweep) && new Set(scope.visibleTraces.map((t) => t.unit)).size > 1);
    // Short scopes keep a single legend line below the title and controls.
    const compact = timePlot && r.h < 150;
    const plot: Rect = compact
      ? { x: r.x + 52, y: r.y + 48, w: r.w - (rightAxis ? 104 : 64), h: r.h - 54 }
      : { x: r.x + 52, y: r.y + 50, w: r.w - (rightAxis ? 104 : 64), h: r.h - 72 };
    if (plot.w < 40 || plot.h < 16) {
      let right = headerRight;
      if (timePlot && r.h >= 30) right = this.headerControls(scope, right, r.y + 2, r.x + 8, null);
      ctx.font = `600 11px ${SANS}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillStyle = colors.title;
      ctx.fillText(fitText(ctx, head, right - r.x - 24), r.x + 8, r.y + 8);
      ctx.restore();
      return;
    }
    let legend: LegendItem[] = [];
    if (scope.sweep) this.drawSweep(scope, plot, r);
    else if (scope.has(ScopeFlag.fft)) this.drawFFT(scope, plot, r);
    else if (scope.isXY) this.drawXY(scope, plot, r);
    else ({ right: headerRight, legend } = this.drawTime(scope, plot, r, compact ? "compact" : "full"));
    // the title gets what room the right-hand items leave (in a compact scope, sharing it with the legend)
    ctx.font = `600 11px ${SANS}`;
    ctx.fillStyle = colors.title;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const room = headerRight - 12 - (r.x + 8);
    const title = fitText(ctx, head, room);
    ctx.fillText(title, r.x + 8, r.y + (timePlot ? 8 : 6));
    if (compact) {
      this.inlineLegend(legend, r.x + 8, r.y + 22, r.x + r.w - 8);
    }
    ctx.restore();
  }

  /** X-Y and FFT scale themselves: the plot's name stands where time plots show time/div. */
  private drawModeHeader(scope: ScopeRuntime, r: Rect, mode: string): number {
    return this.headerControls(scope, r.x + r.w - 8, r.y + 2, r.x + 8, mode);
  }

  /** A legend on one line from x, up to `right` (items that don't fit are cut short). */
  private inlineLegend(items: LegendItem[], x: number, y: number, right: number): void {
    const { ctx } = this;
    ctx.font = AXIS_FONT;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    for (const it of items) {
      if (x + 30 > right) break;
      ctx.fillStyle = it.color;
      ctx.fillRect(x, y + 3, 8, 3);
      ctx.fillStyle = scopeTextColor(it.color);
      const text = fitText(ctx, it.text, right - x - 12);
      ctx.fillText(text, x + 12, y);
      const w = ctx.measureText(text).width + 12;
      this.legendHit(it, x, y, w);
      x += w + 10;
    }
  }


  /**
   * Draws a time plot; returns where the header's right-hand items begin (for fitting the title)
   * and, in a compact scope, the legend for the header row.
   */
  private drawTime(scope: ScopeRuntime, area: Rect, r: Rect, layout: "full" | "compact" | "mini"): { right: number; legend: LegendItem[] } {
    const { ctx } = this;
    const colors = scopePalette();
    const compact = layout !== "full", mini = layout === "mini";
    const sim = this.model.sim, view = scope.view;
    const traces = scope.visibleTraces;
    const bucket = scope.bucketTime(sim), now = sim.t;
    const defaultSpan = view.liveSpan ?? area.w * bucket;
    // live: fill the first screen left to right from where the recording started, then follow;
    // with a trigger, start a division before the trace's last crossing that fills a screen
    let x0: number, span: number;
    let trig: { t: number | null; level: number } | null = null;
    if (view.live) {
      span = defaultSpan;
      x0 = now - scope.startedAt < span ? scope.startedAt : now - span;
      trig = view.trigger.edge ? this.findTrigger(scope, span, area.w, now) : null;
      if (trig?.t != null) x0 = trig.t - TRIGGER_AT * span;
    } else {
      span = view.span || defaultSpan;
      x0 = view.start;
    }
    const x1 = x0 + span;
    // the recording's cells at about one per pixel; while a stretch's detail is still being read
    // back from its temporary file, a coarser level stands in
    const rec = scope.recording;
    let level = rec ? rec.levelFor(span / area.w) : 0;
    if (rec) while (level + 1 < rec.levelCount && !rec.available(level, x0, x1)) level++;
    const pad = rec ? rec.cellTime(level) : 0;
    const cells = rec ? readCells(rec, level, x0 - pad, x1 + pad) : EMPTY_CELLS;
    const traceIndex = (t: ScopeTrace) => scope.traces.indexOf(t);

    // vertical scales, one per unit: fitted to what's visible, or the scope's manual ones
    const units = [...new Set(traces.map((t) => t.unit))];
    const auto = new Map<string, ScopeScale>();
    for (const u of units) {
      let a = Infinity, b = -Infinity;
      for (const t of traces) {
        if (t.unit !== u) continue;
        const j = traceIndex(t);
        for (let i = 0; i < cells.count; i++) {
          if (cells.te[i] <= x0 || cells.ts[i] >= x1) continue;
          const o = (i * cells.traces + j) * 2;
          a = Math.min(a, cells.v[o]);
          b = Math.max(b, cells.v[o + 1]);
        }
      }
      // held while the data fits it, so a waveform of changing size doesn't make the axis jump
      const sc = holdScale(view.autoHeld.get(u), fitScale(a, b), a, b, performance.now());
      if (a <= b) view.autoHeld.set(u, sc);
      auto.set(u, sc);
    }
    const scales = new Map<string, ScopeScale>();
    for (const u of units) {
      if (!view.autoY && !view.scales.has(u)) view.scales.set(u, { ...auto.get(u)! });
      scales.set(u, view.autoY ? auto.get(u)! : view.scales.get(u)!);
    }

    const measured = mini ? traces.map(() => "") : this.measurements(scope, traces, x0, span, area.w);
    const vRange = (u: string) => rangeOf(scales.get(u)!, DIVS_Y);
    const legend = traces.map((t, k) => ({
      text: [`${this.traceName(scope, t)} ${si(ticks(vRange(t.unit), DIVS_Y).step, t.unit)}/div`, measured[k]].filter(Boolean).join("  "),
      color: this.traceColor(scope, t), open: this.traceOpener(scope, t),
    }));
    // a legend that wraps pushes the plot down, clear of the top axis labels
    const legendRect = r;
    const extra = compact ? 0 : (this.legend(legend, legendRect, false) - 1) * 13;
    const plot: Rect = { ...area, y: area.y + extra, h: area.h - extra };
    const trigTrace = view.trigger.edge ? scope.traces[triggerIndex(scope)] : undefined;
    const trigScale = trigTrace && scales.get(trigTrace.unit);
    const triggerLevel = view.trigger.level ?? trig?.level ?? null;
    const triggerY = trigScale && triggerLevel !== null && view.live
      ? plot.y + plot.h / 2 - ((triggerLevel - trigScale.center) / trigScale.perDiv) * (plot.h / DIVS_Y)
      : null;
    this.layouts.set(scope, {
      kind: "time", plot, h: { lo: x0, hi: x1 }, v: new Map(units.map((u) => [u, vRange(u)])), hUnit: "s", vUnit: units[0] ?? "", vUnits: units,
      x0, span, bucket, defaultSpan, now, oldest: rec?.start ?? now, auto, scales, level, triggerY,
    });

    // grid: time lines on round times (they move with the data), DIVS_Y value lines
    const tDiv = niceCeil(span / DIVS_X);
    const xOf = (t: number) => plot.x + ((t - x0) / span) * plot.w;
    ctx.lineWidth = 1;
    ctx.strokeStyle = colors.grid;
    ctx.beginPath();
    const firstLine = Math.ceil(x0 / tDiv - 1e-9);
    for (let n = firstLine; n * tDiv <= x1 + 1e-12 * span; n++) {
      const gx = Math.round(xOf(n * tDiv)) + 0.5;
      ctx.moveTo(gx, plot.y);
      ctx.lineTo(gx, plot.y + plot.h);
    }
    ctx.stroke();
    // value lines on round values of the first unit (zero stronger); its labels on the left, a
    // second unit's (e.g. current) on the right. With two axes, each is tinted like its trace.
    const tint = (u: string) => units.length > 1 ? scopeTextColor(this.traceColor(scope, traces.find((t) => t.unit === u)!)) : colors.muted;
    units.slice(0, 2).forEach((u, side) => this.valueAxis(plot, vRange(u), side ? "right" : "left", u, { lines: side === 0, labels: !mini, color: tint(u), few: compact }));

    // time axis: the time at round grid lines, as many as fit (none in a compact scope)
    if (!compact) {
      ctx.fillStyle = colors.muted;
      ctx.textBaseline = "top";
      ctx.textAlign = "center";
      const pxPerDiv = (tDiv / span) * plot.w;
      const every = Math.max(1, Math.ceil(56 / pxPerDiv));
      const timeLabel = axisFormat(Math.max(Math.abs(x0), Math.abs(x1)), tDiv * every, "s");
      for (let n = firstLine; n * tDiv <= x1 + 1e-12 * span; n++) {
        if (n % every !== 0) continue;
        const gx = xOf(n * tDiv);
        if (gx < plot.x - 1 || gx > plot.x + plot.w + 1) continue;
        ctx.fillText(timeLabel(n * tDiv), Math.min(Math.max(gx, plot.x + 14), plot.x + plot.w - 14), plot.y + plot.h + 5);
      }
    }

    // traces: buckets narrower than a pixel are merged per pixel column (min and max)
    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.x, plot.y - 1, plot.w, plot.h + 2);
    ctx.clip();
    for (const t of traces) {
      const j = traceIndex(t);
      const { perDiv, center } = scales.get(t.unit)!;
      const yScale = plot.h / DIVS_Y / perDiv, midY = plot.y + plot.h / 2;
      const yOf = (v: number) => Math.max(plot.y - 1e4, Math.min(plot.y + plot.h + 1e4, midY - (v - center) * yScale));
      ctx.strokeStyle = this.traceColor(scope, t);
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      let started = false, col = NaN, xIn = 0, xOut = 0, cLo = Infinity, cHi = -Infinity, lastY = 0;
      const flush = () => {
        if (cLo > cHi) return;
        // each point is a min-max range: enter it at the end nearest the previous point, so a
        // rising or falling stretch is a clean line rather than a zigzag. A bucket wider than a
        // pixel is crossed from its left edge to its right one.
        let y1 = yOf(cHi), y2 = yOf(cLo);
        if (started && Math.abs(y2 - lastY) < Math.abs(y1 - lastY)) [y1, y2] = [y2, y1];
        if (!started) ctx.moveTo(xIn, y1);
        else ctx.lineTo(xIn, y1);
        started = true;
        if (Math.abs(y2 - y1) > 1 || xOut - xIn > 1) ctx.lineTo(xOut, y2);
        lastY = y2;
        cLo = Infinity;
        cHi = -Infinity;
      };
      for (let i = 0; i < cells.count; i++) {
        const o = (i * cells.traces + j) * 2;
        const vLo = cells.v[o], vHi = cells.v[o + 1];
        if (!(vLo <= vHi)) continue;
        const xs = xOf(cells.ts[i]), xe = xOf(cells.te[i]);
        if (xe - xs < 1) {
          const c = Math.floor(xs);
          if (c !== col) {
            flush();
            col = c;
            xIn = xOut = c + 0.5;
          }
          cLo = Math.min(cLo, vLo);
          cHi = Math.max(cHi, vHi);
        } else {
          flush();
          col = NaN;
          xIn = xs;
          xOut = xe;
          cLo = vLo;
          cHi = vHi;
          flush();
        }
      }
      flush();
      this.strokeTrace(this.traceColor(scope, t));
    }
    ctx.restore();
    if (mini) return { right: r.x + r.w, legend: [] };
    if (!compact) this.legend(legend, legendRect);
    if (triggerY !== null && trigTrace) this.drawTrigger(plot, triggerY, trig?.t != null ? xOf(trig.t) : null, this.traceColor(scope, trigTrace), view.trigger.edge);
    if (MEASUREMENT_CURSORS) this.drawCursors(scope, plot, traces, scales, x0, span, level);
    this.drawBox(scope);
    if (!this.cursorDrag && !this.levelDrag && !this.box) this.drawCursor(scope, plot, traces, scales, x0, span, level);

    // Title left, controls right, with a full-width legend underneath.
    const minLeft = r.x + Math.min(110, r.w * 0.28), controlsY = r.y + 2;
    let cx = r.x + r.w - 8;
    cx = this.headerControls(scope, cx, controlsY, minLeft, `${si(tDiv, "s")}/div`, trig?.t != null);
    return { right: this.sheet ? r.x + r.w - 8 : cx, legend: compact ? legend : [] };
  }

  /**
   * The readout cursor: with the pointer over the plot, a line at that time, a dot on each trace
   * and a box with the time and each trace's value there (a range where the point covers a jump
   * of more than a division, like an edge).
   */
  private drawCursor(
    scope: ScopeRuntime, plot: Rect, traces: ScopeTrace[], scales: Map<string, ScopeScale>,
    x0: number, span: number, level: number,
  ): void {
    // under the pointer: at the pointer; any other time plot: at the same circuit time (its box at
    // the top), so every scope reads the same moment
    const ptr = this.pointer;
    if (!ptr || this.drag) return;
    const linked = this.hover !== null && this.hover.scope !== scope;
    let p = ptr;
    if (linked) {
      const x = plot.x + ((this.hover!.t - x0) / span) * plot.w;
      if (x < plot.x || x > plot.x + plot.w) return;
      p = { x, y: plot.y };
    } else if (p.x < plot.x || p.x > plot.x + plot.w || p.y < plot.y - 4 || p.y > plot.y + plot.h + 4) return;
    const { ctx } = this;
    const t0 = x0 + ((p.x - plot.x) / plot.w) * span;
    // what one pixel spans: the readout covers it, so it agrees with what's drawn
    const t1 = t0 + span / plot.w;
    const rec = scope.recording;
    if (!rec) return;
    const here = readCells(rec, level, t0, t1);
    if (!here.count) return; // no data at this time
    const lines: { text: string; color: string }[] = [{ text: `t = ${si(t0, "s", true, 4)}`, color: scopePalette().title }];
    const dots: { y: number; color: string }[] = [];
    for (const t of traces) {
      let a = Infinity, b = -Infinity;
      const j = scope.traces.indexOf(t);
      for (let i = 0; i < here.count; i++) {
        const o = (i * here.traces + j) * 2;
        a = Math.min(a, here.v[o]);
        b = Math.max(b, here.v[o + 1]);
      }
      if (!(a <= b)) continue;
      const { perDiv, center } = scales.get(t.unit)!;
      const color = this.traceColor(scope, t);
      const v = (a + b) / 2;
      // one value, unless the point covers a big jump (more than a division, like an edge)
      const ranged = b - a > perDiv;
      lines.push({ text: `${this.traceName(scope, t)}  ${ranged ? `${si(a, t.unit, true, 4)} … ${si(b, t.unit, true, 4)}` : si(v, t.unit, true, 4)}`, color });
      dots.push({ y: plot.y + plot.h / 2 - ((v - center) / perDiv) * (plot.h / DIVS_Y), color });
    }
    // the line and the dots
    ctx.save();
    ctx.strokeStyle = scopePalette().gridStrong;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(Math.round(p.x) + 0.5, plot.y);
    ctx.lineTo(Math.round(p.x) + 0.5, plot.y + plot.h);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const d of dots) {
      if (d.y < plot.y || d.y > plot.y + plot.h) continue;
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.arc(p.x, d.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = scopePalette().surface;
      ctx.stroke();
    }
    ctx.restore();
    this.readoutBox(plot, p, lines, linked);
  }

  /** A readout box beside a point, kept inside the plot (at the top for a linked readout). */
  private readoutBox(plot: Rect, p: { x: number; y: number }, lines: { text: string; color: string }[], top = false): void {
    const { ctx } = this;
    ctx.save();
    ctx.font = AXIS_FONT;
    const w = Math.max(...lines.map((l) => ctx.measureText(l.text).width)) + 14, h = lines.length * 13 + 8;
    let bx = p.x + 10, by = top ? plot.y + 4 : p.y - h - 8;
    if (bx + w > plot.x + plot.w) bx = p.x - 10 - w;
    if (bx < plot.x) bx = plot.x;
    if (by < plot.y) by = Math.min(p.y + 12, plot.y + plot.h - h);
    ctx.fillStyle = scopePalette().readout;
    ctx.strokeStyle = scopePalette().border;
    ctx.beginPath();
    ctx.roundRect(bx + 0.5, by + 0.5, w, h, 4);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    lines.forEach((l, i) => {
      ctx.fillStyle = scopeTextColor(l.color);
      ctx.fillText(l.text, bx + 7, by + 5 + i * 13);
    });
    ctx.restore();
  }

  /** The pointer over this plot (not while dragging), or null. */
  private pointerIn(plot: Rect): { x: number; y: number } | null {
    const p = this.pointer;
    if (!p || this.drag || this.box || this.sheet) return null;
    return p.x >= plot.x && p.x <= plot.x + plot.w && p.y >= plot.y && p.y <= plot.y + plot.h ? p : null;
  }

  /** A dot on a trace (outlined against the plot). */
  private dot(x: number, y: number, color: string): void {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = scopePalette().surface;
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /**
   * The header, right-aligned at `right`; returns its left edge. Left to right: the plot's label
   * (time/div, FFT or X-Y; click it for the plot type), then the plot's own tile (Trigger, Live while
   * navigating, dB on a spectrum), then Sound and Auto, which every plot has. A click switches a tile, coloured when on; a right-click opens
   * its options. Every setting is also in the scope's right-click menu.
   */
  private headerControls(scope: ScopeRuntime, right: number, y: number, minLeft: number, label: string | null, locked = false): number {
    // a sweep's result: its name alone (no scale, sound or trigger applies to it)
    const c = this.controls;
    if (scope.sweep) {
      if (label && !this.sheet) {
        const { ctx } = this;
        ctx.font = AXIS_FONT;
        ctx.fillStyle = scopePalette().muted;
        ctx.textAlign = "right";
        ctx.textBaseline = "top";
        if (right - ctx.measureText(label).width >= minLeft) {
          ctx.fillText(label, right, y + 6);
          right -= ctx.measureText(label).width;
        }
      }
      return right;
    }
    const fft = scope.has(ScopeFlag.fft), timePlot = !fft && !scope.isXY, view = scope.view;
    const toggle = (tile: ScopeTile): ChipAction | null => c ? () => c.toggle(scope, tile) : null;
    const panel = (p: ScopePanel): ChipAction | undefined => c ? (x, yy, top) => c.panel(scope, p, x, yy, top) : undefined;
    const xy = !fft && !timePlot;
    right = this.chip("Auto", timePlot ? view.autoY : xy ? scope.xyAuto : !view.fftX && !view.fftY, right, y, toggle("auto"),
      timePlot ? "Fit the vertical axis to the visible data. Right-click to set the scale."
        : xy ? "Fit and center the figure gathered so far. Off: the origin in the middle. Right-click to set the scale."
          : "Fit the spectrum: from 0 Hz past its content, up to its peak. Off: keep the view.", minLeft, fft ? undefined : panel("scale"), 34);
    // Sound and Auto, which every plot has, sit last; before them the plot's own tile
    if (scope.visibleTraces.length) {
      const trace = c?.listeningTrace(scope);
      right = this.chip("speaker", !!trace, right - 3, y, toggle("audio"),
        `${trace ? `Sound: playing ${this.traceLabel(scope, trace)}.` : "Sound: off. Plays the last trace and mode."} Right-click for sound options.`, minLeft, panel("audio"), 34);
    }
    if (timePlot && view.live) {
      const tr = view.trigger;
      const state = !tr.edge ? "off" : locked ? `${tr.edge > 0 ? "rising" : "falling"} edge` : "waiting for the trace to cross the level";
      right = this.chip("Trigger", tr.edge !== 0, right - 3, y, toggle("trigger"), `Trigger: ${state}. Right-click for the edge, trace and level.`, minLeft, panel("trigger"), 48);
    } else if (timePlot) {
      right = this.chip("Live", false, right - 3, y, () => scope.goLive(), "Show the latest data. Double-click also returns to live view.", minLeft, undefined, 48);
    } else if (fft) {
      right = this.chip("dB", scope.has(ScopeFlag.logSpectrum), right - 3, y, toggle("db"), "Logarithmic spectrum.", minLeft, undefined, 48);
    }
    if (label && !this.sheet) {
      const { ctx } = this;
      ctx.font = AXIS_FONT;
      ctx.fillStyle = scopePalette().muted;
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      const w = ctx.measureText(label).width;
      if (right - 16 - w >= minLeft) {
        ctx.fillText(label, right - 16, y + 6);
        const open = panel("plot");
        if (open) this.chips.push({ rect: { x: right - 18 - w, y, w: w + 4, h: 20 }, action: open, title: "Plot: time, X-Y or FFT. Click to change." });
        right -= 16 + w;
      }
    }
    return right;
  }

  /** A header tile right-aligned at `right` (text, or the speaker); returns its left edge. */
  private chip(label: string, on: boolean, right: number, y: number, action: ChipAction | null, title: string, minLeft = -Infinity, menu?: ChipAction, fixedWidth?: number): number {
    const { ctx } = this;
    // a scope on the sheet isn't clicked through (its settings are in its menu)
    if (this.sheet) return right;
    ctx.font = `500 10px ${SANS}`;
    const speaker = label === "speaker";
    const w = fixedWidth ?? ctx.measureText(label).width + 12, h = 20, x = right - w;
    // no room (it would crowd out the title): left out
    if (x < minLeft) return right + 3;
    const palette = scopePalette();
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, 3);
    if (on || action === null) {
      // unavailable (Auto on a spectrum, always on): filled grey
      ctx.fillStyle = action === null ? palette.border : palette.accent;
      ctx.fill();
    } else {
      ctx.strokeStyle = palette.border;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    const ink = on && action !== null ? palette.accentText : palette.muted;
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    if (speaker) this.speakerIcon(x, y, on);
    else {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, x + w / 2, y + h / 2 + 0.5);
    }
    this.chips.push({ rect: { x, y, w, h }, action, title, menu });
    return x;
  }

  /** The speaker in a 34 × 20 tile at (x, y): with sound waves when on, an X when off. */
  private speakerIcon(x: number, y: number, on: boolean): void {
    const { ctx } = this;
    ctx.lineWidth = 1.2;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x + 9, y + 7);
    ctx.lineTo(x + 12, y + 7);
    ctx.lineTo(x + 17, y + 4);
    ctx.lineTo(x + 17, y + 16);
    ctx.lineTo(x + 12, y + 13);
    ctx.lineTo(x + 9, y + 13);
    ctx.closePath();
    if (on) {
      ctx.fill();
      for (const radius of [5, 8]) {
        ctx.beginPath();
        ctx.arc(x + 16, y + 10, radius, -0.7, 0.7);
        ctx.stroke();
      }
    } else {
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + 21, y + 7); ctx.lineTo(x + 25, y + 13);
      ctx.moveTo(x + 25, y + 7); ctx.lineTo(x + 21, y + 13);
      ctx.stroke();
    }
  }

  /**
   * The trigger: the last time the trigger trace crossed the level in the trigger's direction that
   * still leaves a full screen after it (null: none in the last few screens, so the plot scrolls).
   * Crossings are found on the recording at about two cells per pixel, between cell midpoints,
   * with a little hysteresis against noise; the level, unless set, is the middle of the swing.
   */
  private findTrigger(scope: ScopeRuntime, span: number, width: number, now: number): { t: number | null; level: number } | null {
    const rec = scope.recording, tr = scope.view.trigger;
    if (!rec || !scope.traces.length) return null;
    const j = triggerIndex(scope);
    const level = rec.levelFor(span / width / 2);
    const cells = readCells(rec, level, Math.max(rec.start, now - 4 * span), now);
    if (cells.count < 3) return null;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < cells.count; i++) {
      const o = (i * cells.traces + j) * 2;
      lo = Math.min(lo, cells.v[o]);
      hi = Math.max(hi, cells.v[o + 1]);
    }
    const L = tr.level ?? (lo + hi) / 2;
    if (!(hi > lo)) return { t: null, level: L };
    const hyst = (hi - lo) * 0.05, dir = tr.edge;
    const latest = now - (1 - TRIGGER_AT) * span;
    let armed = false, best: number | null = null, pt = 0, pm = 0;
    for (let i = 0; i < cells.count; i++) {
      const o = (i * cells.traces + j) * 2;
      const m = (cells.v[o] + cells.v[o + 1]) / 2, t = (cells.ts[i] + cells.te[i]) / 2;
      if (dir * (m - L) < -hyst) armed = true;
      else if (armed && dir * (m - L) >= 0 && i > 0) {
        armed = false;
        const tc = m === pm ? t : pt + ((L - pm) / (m - pm)) * (t - pt);
        if (tc <= latest) best = tc;
      }
      pt = t;
      pm = m;
    }
    return { t: best, level: L };
  }

  /** The trigger level marker on the left axis (drag it) and the trigger point at the top. */
  private drawTrigger(plot: Rect, y: number, x: number | null, color: string, edge: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = color;
    const yy = Math.max(plot.y, Math.min(plot.y + plot.h, y));
    ctx.beginPath();
    ctx.moveTo(plot.x + 1, yy);
    ctx.lineTo(plot.x - 7, yy - 5);
    ctx.lineTo(plot.x - 7, yy + 5);
    ctx.closePath();
    ctx.fill();
    if (x !== null && x >= plot.x && x <= plot.x + plot.w) {
      ctx.beginPath();
      ctx.moveTo(x, plot.y + 6);
      ctx.lineTo(x - 4, plot.y);
      ctx.lineTo(x + 4, plot.y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.35;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(plot.x, Math.round(yy) + 0.5);
      ctx.lineTo(plot.x + plot.w, Math.round(yy) + 0.5);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      ctx.font = `600 9px ${SANS}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(edge > 0 ? "↑" : "↓", x, plot.y + 7);
    }
    ctx.restore();
  }

  /** A trace's value at time t, over one pixel: its middle, and its range there. */
  private valueAt(scope: ScopeRuntime, level: number, t: number, pixel: number, j: number): { v: number; lo: number; hi: number } | null {
    const rec = scope.recording;
    if (!rec) return null;
    const here = readCells(rec, level, t, t + pixel);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < here.count; i++) {
      const o = (i * here.traces + j) * 2;
      lo = Math.min(lo, here.v[o]);
      hi = Math.max(hi, here.v[o + 1]);
    }
    return lo <= hi ? { v: (lo + hi) / 2, lo, hi } : null;
  }

  /**
   * Measurement cursors: a line for A and B, and a box with their times, Δt and 1/Δt, and each
   * trace's value at them and the difference.
   */
  private drawCursors(scope: ScopeRuntime, plot: Rect, traces: ScopeTrace[], scales: Map<string, ScopeScale>, x0: number, span: number, level: number): void {
    const view = scope.view;
    if (!view.cursors.length) return;
    const { ctx } = this;
    const times = view.cursors.map((c) => (view.live ? x0 + c : c));
    const pixel = span / plot.w;
    ctx.save();
    ctx.font = `600 9px ${SANS}`;
    times.forEach((t, k) => {
      const x = plot.x + ((t - x0) / span) * plot.w;
      if (x < plot.x - 0.5 || x > plot.x + plot.w + 0.5) return;
      ctx.strokeStyle = scopePalette().cursor;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, plot.y);
      ctx.lineTo(Math.round(x) + 0.5, plot.y + plot.h);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = scopePalette().cursor;
      ctx.beginPath();
      ctx.roundRect(Math.round(x) - 6, plot.y + plot.h - 13, 12, 13, 2);
      ctx.fill();
      ctx.fillStyle = scopePalette().surface;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(CURSOR_NAMES[k], Math.round(x) + 0.5, plot.y + plot.h - 6);
    });
    // the readout
    const lines: { text: string; color: string }[] = [];
    const tText = times.map((t, k) => `${CURSOR_NAMES[k]} ${si(t, "s", true, 4)}`).join("   ");
    lines.push({ text: tText, color: scopePalette().cursor });
    if (times.length === 2) {
      const dt = times[1] - times[0];
      lines.push({ text: `Δt ${si(dt, "s", true, 4)}${dt ? `   1/Δt ${si(1 / Math.abs(dt), "Hz", true, 4)}` : ""}`, color: scopePalette().cursor });
    }
    for (const t of traces) {
      const j = scope.traces.indexOf(t);
      const vals = times.map((tc) => this.valueAt(scope, level, tc, pixel, j));
      if (vals.some((v) => !v)) continue;
      const perDiv = scales.get(t.unit)!.perDiv;
      const show = (v: { v: number; lo: number; hi: number }) => (v.hi - v.lo > perDiv ? `${si(v.lo, t.unit, true, 3)}…${si(v.hi, t.unit, true, 3)}` : si(v.v, t.unit, true, 4));
      const parts = vals.map((v, k) => `${CURSOR_NAMES[k]} ${show(v!)}`);
      if (vals.length === 2) parts.push(`Δ ${si(vals[1]!.v - vals[0]!.v, t.unit, true, 4)}`);
      lines.push({ text: `${this.traceName(scope, t)}  ${parts.join("   ")}`, color: this.traceColor(scope, t) });
    }
    ctx.font = AXIS_FONT;
    const w = Math.max(...lines.map((l) => ctx.measureText(l.text).width)) + 14, h = lines.length * 13 + 8;
    const bx = plot.x + plot.w - w - 4, by = plot.y + 4;
    ctx.fillStyle = scopePalette().readout;
    ctx.strokeStyle = scopePalette().border;
    ctx.beginPath();
    ctx.roundRect(Math.max(plot.x, bx) + 0.5, by + 0.5, w, h, 4);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    lines.forEach((l, i) => {
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, Math.max(plot.x, bx) + 7, by + 5 + i * 13);
    });
    ctx.restore();
  }

  /** A trace's name as the legend shows it ("V", or "V(R1)" when the scope shows several parts). */
  traceLabel(scope: ScopeRuntime, t: ScopeTrace): string {
    return this.traceName(scope, t);
  }

  /** Freeze the visible vertical scale when sonification starts, so auto scale cannot shift pitch. */
  audioRange(scope: ScopeRuntime, trace: ScopeTrace): AudioRange {
    const scale = this.layouts.get(scope)?.scales.get(trace.unit) ?? scope.view.scales.get(trace.unit);
    if (scale) return { low: scale.center - scale.perDiv * DIVS_Y / 2, high: scale.center + scale.perDiv * DIVS_Y / 2 };
    const value = trace.elm.getScopeValue(trace.value);
    const extent = Math.max(1, Math.abs(value) * 2);
    return { low: -extent, high: extent };
  }

  /** Turn vertical auto scale on or off; turning it off keeps the scale as it is now. */
  setAutoY(scope: ScopeRuntime, on: boolean): void {
    const v = scope.view;
    if (!on && v.autoY) {
      v.scales.clear();
      for (const [u, sc] of this.layouts.get(scope)?.auto ?? []) v.scales.set(u, { ...sc });
    }
    v.autoY = on;
    this.draw();
  }

  /**
   * Each trace's measurements (those switched on, e.g. "max 4.27 V  f 52.08 Hz") over the visible
   * window, or between cursors A and B when both are placed, from the recording at a finer level
   * than drawn (about 4000 cells across the window).
   */
  private measurements(scope: ScopeRuntime, traces: ScopeTrace[], x0: number, span: number, width: number): string[] {
    const rec = scope.recording;
    if (!rec || !anyMeasure(scope)) return traces.map(() => "");
    let w0 = x0, w1 = x0 + span;
    const cursors = scope.view.cursors;
    if (MEASUREMENT_CURSORS && cursors.length === 2) {
      const [a, b] = cursors.map((c) => scope.view.live ? x0 + c : c);
      w0 = Math.min(a, b);
      w1 = Math.max(a, b);
    }
    if (!(w1 > w0)) return traces.map(() => "");
    let level = rec.levelFor(Math.min(span / width, (w1 - w0) / 4000));
    while (level + 1 < rec.levelCount && !rec.available(level, w0, w1)) level++;
    const cells = readCells(rec, level, w0, w1);
    const cycles = scope.measures.has(WHOLE_CYCLES);
    // edges re-read from the finest detail still in memory around each one
    const fine = (a: number, b: number) => {
      let l = 0;
      while (l + 1 < rec.levelCount && !rec.available(l, a, b)) l++;
      return readCells(rec, l, a, b);
    };
    const results = traces.map((t) => measure(cells, scope.traces.indexOf(t), w0, w1, cycles, fine));
    // phase against the first trace; efficiency against the first power trace
    const ref = results[0], firstPower = traces.findIndex((t) => t.unit === "W");
    return traces.map((t, k) => measurementText(scope, results[k], t.unit, {
      phase: k === 0 ? undefined : phase(results[k].rises, ref.rises, ref.period),
      efficiency: t.unit !== "W" || k === firstPower || firstPower < 0 ? undefined
        : Math.abs(results[firstPower].avg) > 0 ? Math.abs(results[k].avg) / Math.abs(results[firstPower].avg) : null,
    }));
  }

  /** Draw the legend under the header, wrapping as needed (or just measure it); returns its line count. */
  private legend(items: LegendItem[], r: Rect, draw = true): number {
    const { ctx } = this;
    let lines = 1;
    ctx.font = AXIS_FONT;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const left = r.x + 8, right = r.x + r.w - 4;
    let x = left, y = r.y + 22;
    const newLine = (indent: number) => { x = left + indent; y += 13; lines++; };
    for (const it of items) {
      // an entry is its name and scale, then its measurements; ones too long for the line carry on
      // at the next, a little indented, part by part
      const [head, ...rest] = it.text.split("  ");
      const w = ctx.measureText(head).width + 12;
      if (x + w > right && x > left) newLine(0);
      if (draw) {
        ctx.fillStyle = it.color;
        ctx.fillRect(x, y + 3, 8, 3);
        ctx.fillStyle = scopeTextColor(it.color);
        ctx.fillText(head, x + 12, y);
        this.legendHit(it, x, y, w);
      }
      x += w + 10;
      for (const part of rest) {
        const pw = ctx.measureText(part).width;
        if (x + pw > right && x > left + 12) newLine(12);
        if (draw) ctx.fillText(part, x, y);
        x += pw + 10;
      }
      x += 2;
    }
    return lines;
  }
  /** A legend entry's click area (its swatch and text). */
  private legendHit(it: LegendItem, x: number, y: number, w: number): void {
    if (it.open && !this.sheet) this.chips.push({ rect: { x: x - 2, y: y - 2, w: w + 4, h: 15 }, action: it.open, title: "Trace options" });
  }

  private traceOpener(scope: ScopeRuntime, t: ScopeTrace): ChipAction | undefined {
    return this.controls ? (x, y, top) => this.controls!.traceMenu(scope, t, x, y, top) : undefined;
  }

  /** Light signal traces are 5% thicker than the base weight, with no outline. */
  private strokeTrace(color: string): void {
    const light = settings.appearance === "light";
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1.25 * (light ? 1.05 : 1);
    this.ctx.stroke();
  }

  /**
   * A value axis on round values (scope-nav ticks), however it's zoomed or moved: grid lines
   * across the plot, zero stronger, and labels beside it (left, right or below), as many as fit.
   * Returns its step, the value per division it shows.
   */
  private valueAxis(plot: Rect, r: Range, side: "left" | "right" | "bottom", unit: string,
    opts: { lines?: boolean; labels?: boolean; color?: string; few?: boolean; format?: (v: number) => string } = {}): number {
    const { ctx } = this;
    const colors = scopePalette();
    const horizontal = side === "bottom";
    const { step, values } = ticks(r, horizontal ? DIVS_X : DIVS_Y);
    const pos = (v: number) => horizontal
      ? plot.x + ((v - r.lo) / (r.hi - r.lo)) * plot.w
      : plot.y + plot.h - ((v - r.lo) / (r.hi - r.lo)) * plot.h;
    if (opts.lines !== false) {
      ctx.lineWidth = 1;
      for (const strong of [false, true]) {
        ctx.strokeStyle = strong ? colors.gridStrong : colors.grid;
        ctx.beginPath();
        for (const v of values) {
          if ((v === 0) !== strong) continue;
          const p = Math.round(pos(v)) + 0.5;
          if (horizontal) { ctx.moveTo(p, plot.y); ctx.lineTo(p, plot.y + plot.h); }
          else { ctx.moveTo(plot.x, p); ctx.lineTo(plot.x + plot.w, p); }
        }
        ctx.stroke();
      }
    }
    if (opts.labels === false) return step;
    // one form of the unit on the whole axis, with the decimals its step needs
    const fmt = opts.format ?? axisFormat(Math.max(Math.abs(r.lo), Math.abs(r.hi)), step, unit);
    ctx.font = AXIS_FONT;
    ctx.fillStyle = opts.color ?? colors.muted;
    const px = (step / (r.hi - r.lo)) * (horizontal ? plot.w : plot.h);
    const every = horizontal
      ? Math.max(1, Math.ceil((Math.max(10, ...values.map((v) => ctx.measureText(fmt(v)).width)) + 12) / px))
      : opts.few ? Math.max(1, Math.ceil(values.length / 3)) : Math.max(1, Math.ceil(36 / px));
    ctx.textBaseline = horizontal ? "top" : "middle";
    ctx.textAlign = horizontal ? "center" : side === "left" ? "right" : "left";
    for (const v of values) {
      if (Math.round(v / step) % every !== 0) continue;
      const text = fmt(v), p = pos(v);
      if (horizontal) {
        const half = ctx.measureText(text).width / 2;
        ctx.fillText(text, Math.min(Math.max(p, plot.x + half), plot.x + plot.w - half), plot.y + plot.h + 5);
      } else ctx.fillText(text, side === "left" ? plot.x - 6 : plot.x + plot.w + 6, p);
    }
    return step;
  }


  private drawXY(scope: ScopeRuntime, area: Rect, r: Rect): void {
    const { ctx } = this;
    const axes = scope.xyTraces;
    if (!axes) return;
    const [tx, ty] = axes;
    // the newest points, in order: 4096 of them, or the whole ring with a long trail
    const cap = ScopeRuntime.xyCapacity, n = Math.min(scope.xyCount, scope.measures.has("xylong") ? cap : 4096);
    const at = (i: number) => (scope.xyPtr - n + i + cap) % cap;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = scope.xy[at(i) * 2], y = scope.xy[at(i) * 2 + 1];
      if (Number.isFinite(x) && Number.isFinite(y)) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    // auto: centered on the range gathered so far (holdEnvelope), so a wandering figure, like a
    // chaotic attractor, stays still; off: the origin in the middle at the scale set then
    const env = scope.xyEnvelope, now = performance.now();
    env.x = holdEnvelope(env.x, minX, maxX, now);
    env.y = holdEnvelope(env.y, minY, maxY, now);
    const { x: xScale, y: yScale } = scope.xyAuto || !scope.xyManual
      ? { x: centeredScale(env.x?.lo ?? 0, env.x?.hi ?? 0, DIVS_X), y: centeredScale(env.y?.lo ?? 0, env.y?.hi ?? 0, DIVS_Y) }
      : scope.xyManual;
    const xr = rangeOf(xScale, DIVS_X), yr = rangeOf(yScale, DIVS_Y);
    // which trace is which axis, in the legend row (in the curve's colour: it's one curve); one that
    // wraps pushes the plot down, clear of the top value
    const ink = settings.appearance === "light" ? LIGHT_COLORS[ScopeValue.voltage] : COLORS[ScopeValue.voltage];
    const legend = [
      { text: `X: ${this.traceName(scope, tx)} ${si(ticks(xr, DIVS_X).step, tx.unit)}/div`, color: ink },
      { text: `Y: ${this.traceName(scope, ty)} ${si(ticks(yr, DIVS_Y).step, ty.unit)}/div`, color: ink },
    ];
    const extra = (this.legend(legend, r, false) - 1) * 13;
    const plot: Rect = { ...area, y: area.y + extra, h: area.h - extra };
    this.layouts.set(scope, this.otherLayout("xy", plot, xr, new Map([["y", yr]]), tx.unit, ty.unit));
    // grid and values on round numbers, the axes through the origin stronger
    this.valueAxis(plot, xr, "bottom", tx.unit);
    this.valueAxis(plot, yr, "left", ty.unit);
    const sx = plot.w / (xr.hi - xr.lo), sy = plot.h / (yr.hi - yr.lo);
    const cx = plot.x - xr.lo * sx, cy = plot.y + plot.h + yr.lo * sy;
    // newest points brightest
    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.x, plot.y, plot.w, plot.h);
    ctx.clip();
    const segs = 8;
    for (let s = 0; s < segs; s++) {
      ctx.globalAlpha = 0.2 + (0.8 * (s + 1)) / segs;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      const from = Math.floor((n * s) / segs), to = Math.floor((n * (s + 1)) / segs);
      let started = false;
      for (let i = from; i <= Math.min(to, n - 1); i++) {
        const k = at(i);
        const px = cx + scope.xy[k * 2] * sx, py = cy - scope.xy[k * 2 + 1] * sy;
        if (!Number.isFinite(px) || !Number.isFinite(py)) { started = false; continue; }
        if (!started) { ctx.moveTo(px, py); started = true; }
        else ctx.lineTo(px, py);
      }
      this.strokeTrace(ink);
    }
    ctx.restore();
    // readout: the nearest point drawn (within 12 px), else the values under the pointer
    const p = this.pointerIn(plot);
    if (p) {
      let best = -1, bestD = 144;
      for (let i = 0; i < n; i++) {
        const k = at(i), dx = cx + scope.xy[k * 2] * sx - p.x, dy = cy - scope.xy[k * 2 + 1] * sy - p.y;
        if (dx * dx + dy * dy <= bestD) { bestD = dx * dx + dy * dy; best = k; }
      }
      const vx = best >= 0 ? scope.xy[best * 2] : xr.lo + ((p.x - plot.x) / plot.w) * (xr.hi - xr.lo);
      const vy = best >= 0 ? scope.xy[best * 2 + 1] : yr.lo + ((plot.y + plot.h - p.y) / plot.h) * (yr.hi - yr.lo);
      if (best >= 0) this.dot(cx + vx * sx, cy - vy * sy, ink);
      this.readoutBox(plot, best >= 0 ? { x: cx + vx * sx, y: cy - vy * sy } : p, [
        { text: `${this.traceName(scope, tx)}  ${si(vx, tx.unit, true, 4)}`, color: ink },
        { text: `${this.traceName(scope, ty)}  ${si(vy, ty.unit, true, 4)}`, color: ink },
      ]);
    }
    this.drawBox(scope);
    this.legend(legend, r);
  }

  /**
   * A DC sweep's result: each trace against the swept source's value, the first trace's unit on
   * the left axis and a second unit (if any) on the right; a point whose operating point wasn't
   * found leaves a gap. The readout gives every trace at the swept value nearest the pointer.
   */
  private drawSweep(scope: ScopeRuntime, area: Rect, r: Rect): void {
    const { ctx } = this;
    const sw = scope.sweep!;
    if (sw.phase) return this.drawBode(scope, area, r);
    // a parameter sweep's runs: each trace's series for run k at j · runs + k
    const runs = sw.runs?.length ?? 1;
    const traces = scope.traces.slice(0, sw.series.length / runs);
    const seriesOf = (j: number, k: number) => sw.series[j * runs + k];
    const units = [...new Set(traces.map((t) => t.unit))].slice(0, 2);
    const rangeFor = (unit: string) => {
      let lo = Infinity, hi = -Infinity;
      traces.forEach((t, j) => {
        if (t.unit !== unit) return;
        for (let k = 0; k < runs; k++) for (const v of seriesOf(j, k)) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      });
      return rangeOf(centeredScale(Number.isFinite(lo) ? lo : 0, Number.isFinite(hi) ? hi : 0, DIVS_Y), DIVS_Y);
    };
    // the swept range exactly, from start to stop
    const xr = { lo: Math.min(...sw.x), hi: Math.max(...sw.x) };
    const yr = new Map(units.map((u) => [u, rangeFor(u)] as const));
    const legend = traces.filter((t) => units.includes(t.unit)).map((t) => ({ text: this.traceName(scope, t), color: this.traceColor(scope, t) }));
    if (sw.runs) legend.push({ text: `runs: ${sw.runs.join(", ")} (faint to strong)`, color: scopePalette().muted });
    if (sw.failed.length) legend.push({ text: sw.runs ? `${sw.failed.length} run${sw.failed.length > 1 ? "s" : ""} stopped` : `${sw.failed.length} point${sw.failed.length > 1 ? "s" : ""} not found`, color: scopePalette().muted });
    const extra = (this.legend(legend, r, false) - 1) * 13;
    const plot: Rect = { ...area, y: area.y + extra, h: area.h - extra };
    this.layouts.set(scope, this.otherLayout("xy", plot, xr, new Map([["y", yr.get(units[0])!]]), sw.unit, units[0] ?? ""));
    this.valueAxis(plot, xr, "bottom", sw.unit);
    this.valueAxis(plot, yr.get(units[0])!, "left", units[0] ?? "");
    if (units[1]) this.valueAxis(plot, yr.get(units[1])!, "right", units[1], { lines: false });
    const sx = plot.w / (xr.hi - xr.lo);
    const px = (v: number) => plot.x + (v - xr.lo) * sx;
    const py = (v: number, u: string) => {
      const y = yr.get(u)!;
      return plot.y + plot.h - ((v - y.lo) / (y.hi - y.lo)) * plot.h;
    };
    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.x, plot.y, plot.w, plot.h);
    ctx.clip();
    traces.forEach((t, j) => {
      if (!units.includes(t.unit)) return;
      for (let k = 0; k < runs; k++) {
        // runs from faint (the first value) to full strength (the last)
        ctx.globalAlpha = runs > 1 ? 0.3 + (0.7 * k) / (runs - 1) : 1;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let started = false;
        const ys = seriesOf(j, k);
        sw.x.forEach((xv, i) => {
          const v = ys[i];
          if (!Number.isFinite(v)) { started = false; return; }
          if (!started) { ctx.moveTo(px(xv), py(v, t.unit)); started = true; }
          else ctx.lineTo(px(xv), py(v, t.unit));
        });
        this.strokeTrace(this.traceColor(scope, t));
      }
      ctx.globalAlpha = 1;
    });
    ctx.restore();
    // readout: every trace at the swept value nearest the pointer
    const p = this.pointerIn(plot);
    if (p) {
      const xv = xr.lo + (p.x - plot.x) / sx;
      let i = 0;
      for (let k = 1; k < sw.x.length; k++) if (Math.abs(sw.x[k] - xv) < Math.abs(sw.x[i] - xv)) i = k;
      const lines = [{ text: `${sw.label}  ${si(sw.x[i], sw.unit, true, 4)}`, color: scopePalette().title }];
      traces.forEach((t, j) => {
        if (!units.includes(t.unit)) return;
        // (with runs, up to eight of them, each by its value)
        for (let k = 0; k < Math.min(runs, 8); k++) {
          const v = seriesOf(j, k)[i];
          if (Number.isFinite(v)) this.dot(px(sw.x[i]), py(v, t.unit), this.traceColor(scope, t));
          const name = sw.runs ? `${this.traceName(scope, t)} (${sw.runs[k]})` : this.traceName(scope, t);
          lines.push({ text: `${name}  ${Number.isFinite(v) ? si(v, t.unit, true, 4) : "not found"}`, color: this.traceColor(scope, t) });
        }
      });
      this.readoutBox(plot, { x: px(sw.x[i]), y: p.y }, lines);
    }
    this.legend(legend, r);
  }

  /**
   * An AC sweep's Bode plot: frequency on a log axis, each trace's magnitude (dB) against the left
   * axis and its phase (degrees, dashed) against the right. The readout gives both for every trace
   * at the frequency nearest the pointer.
   */
  private drawBode(scope: ScopeRuntime, area: Rect, r: Rect): void {
    const { ctx } = this;
    const sw = scope.sweep!, phase = sw.phase!;
    const traces = scope.traces.slice(0, sw.series.length);
    const span = (all: number[][], divs: number) => {
      let lo = Infinity, hi = -Infinity;
      for (const ys of all) for (const v of ys) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      return rangeOf(centeredScale(Number.isFinite(lo) ? lo : 0, Number.isFinite(hi) ? hi : 0, divs), divs);
    };
    const xr = { lo: Math.log10(sw.x[0]), hi: Math.log10(sw.x[sw.x.length - 1]) };
    const dbr = span(sw.series, DIVS_Y), degr = span(phase, DIVS_Y);
    const legend = traces.map((t) => ({ text: this.traceName(scope, t), color: this.traceColor(scope, t) }));
    legend.push({ text: "magnitude solid, phase dashed", color: scopePalette().muted });
    const extra = (this.legend(legend, r, false) - 1) * 13;
    const plot: Rect = { ...area, y: area.y + extra, h: area.h - extra };
    this.layouts.set(scope, this.otherLayout("xy", plot, xr, new Map([["y", dbr]]), "Hz", "dB"));
    this.logAxis(plot, xr, "Hz");
    this.valueAxis(plot, dbr, "left", "dB", { format: (v) => `${Number(v.toFixed(6))} dB` });
    this.valueAxis(plot, degr, "right", "°", { lines: false, format: (v) => `${Number(v.toFixed(6))}°` });
    const px = (f: number) => plot.x + ((Math.log10(f) - xr.lo) / (xr.hi - xr.lo)) * plot.w;
    const py = (v: number, y: Range) => plot.y + plot.h - ((v - y.lo) / (y.hi - y.lo)) * plot.h;
    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.x, plot.y, plot.w, plot.h);
    ctx.clip();
    traces.forEach((t, j) => {
      for (const [ys, y, dash] of [[sw.series[j], dbr, []], [phase[j], degr, [5, 4]]] as const) {
        ctx.lineWidth = 1.5;
        ctx.setLineDash(dash);
        ctx.beginPath();
        let started = false;
        sw.x.forEach((f, i) => {
          if (!Number.isFinite(ys[i])) { started = false; return; }
          if (!started) { ctx.moveTo(px(f), py(ys[i], y)); started = true; }
          else ctx.lineTo(px(f), py(ys[i], y));
        });
        this.strokeTrace(this.traceColor(scope, t));
      }
      ctx.setLineDash([]);
    });
    ctx.restore();
    // readout: magnitude and phase of every trace at the frequency nearest the pointer
    const p = this.pointerIn(plot);
    if (p) {
      const lf = xr.lo + ((p.x - plot.x) / plot.w) * (xr.hi - xr.lo);
      let i = 0;
      for (let k = 1; k < sw.x.length; k++) if (Math.abs(Math.log10(sw.x[k]) - lf) < Math.abs(Math.log10(sw.x[i]) - lf)) i = k;
      const lines = [{ text: `${si(sw.x[i], "Hz", true, 4)}`, color: scopePalette().title }];
      traces.forEach((t, j) => {
        const m = sw.series[j][i], d = phase[j][i];
        if (Number.isFinite(m)) this.dot(px(sw.x[i]), py(m, dbr), this.traceColor(scope, t));
        lines.push({ text: `${this.traceName(scope, t)}  ${Number.isFinite(m) ? `${m.toFixed(2)} dB  ${d.toFixed(1)}°` : "–"}`, color: this.traceColor(scope, t) });
      });
      this.readoutBox(plot, { x: px(sw.x[i]), y: p.y }, lines);
    }
    this.legend(legend, r);
  }

  /** The layout of an X-Y plot or a spectrum (the time plot's own fields unused). */
  private otherLayout(kind: "xy" | "fft", plot: Rect, h: Range, v: Map<string, Range>, hUnit: string, vUnit: string): PlotLayout {
    return { kind, plot, h, v, hUnit, vUnit, vUnits: [vUnit], x0: h.lo, span: h.hi - h.lo, bucket: 0, defaultSpan: 0, now: 0, oldest: 0, auto: new Map(), scales: new Map(), level: 0, triggerY: null };
  }

  /** The box being dragged for a box zoom, drawn as the schematic's selection box. */
  private drawBox(scope: ScopeRuntime): void {
    const b = this.box;
    if (b?.scope !== scope) return;
    const bx = Math.min(b.x0, b.x1), by = Math.min(b.y0, b.y1), bw = Math.abs(b.x1 - b.x0), bh = Math.abs(b.y1 - b.y0);
    // on whole pixels plus a half, so the 1 px outline stays crisp
    drawSelectionBox(this.ctx, { x: Math.round(bx) + 0.5, y: Math.round(by) + 0.5, width: Math.round(bw), height: Math.round(bh) }, 1, currentTheme().accent);
  }


  /**
   * A spectrum of the first trace: the newest 1024 cells at the scope's time scale, windowed (Hann,
   * flat-top or none) and scaled so a sinusoid reads its amplitude. Optionally harmonics 2–10 marked
   * with the THD, and frequency on a logarithmic axis.
   */
  private drawFFT(scope: ScopeRuntime, plot: Rect, r: Rect): void {
    const { ctx } = this;
    const t = scope.visibleTraces[0];
    if (!t) return;
    const db = scope.has(ScopeFlag.logSpectrum), logF = scope.measures.has("logfreq"), showH = scope.measures.has("harmonics");
    // the newest cells at the scope's own time scale (the level nearest one cell per pixel)
    const rec = scope.recording;
    const level = rec ? rec.levelFor(scope.bucketTime(this.model.sim)) : 0;
    const recent = rec ? readTail(rec, level, 1024) : EMPTY_CELLS;
    const j = scope.traces.indexOf(t);
    let n = 1;
    while (n * 2 <= recent.count) n *= 2;
    const view = scope.view;
    const fs = rec ? 1 / rec.cellTime(level) : 1, df = fs / Math.max(n, 2);
    let mags: Float64Array = new Float64Array(Math.max(1, n / 2));
    let peak = 1e-15, peakBin = 1, last = 1;
    if (n >= 16) {
      const x = new Float64Array(n);
      for (let k = 0; k < n; k++) {
        const o = ((recent.count - n + k) * recent.traces + j) * 2;
        x[k] = (recent.v[o] + recent.v[o + 1]) / 2;
      }
      mags = spectrum(x, scope.fftWindow);
      for (let k = 1; k < n / 2; k++) if (mags[k] > peak) { peak = mags[k]; peakBin = k; }
      // the part of the spectrum with content: past the last bin above 1% of the peak
      last = peakBin;
      for (let k = n / 2 - 1; k > peakBin; k--) if (mags[k] > peak * 0.01) { last = k; break; }
    }
    const h = showH && n >= 16 ? harmonics(mags) : null;
    const legend = [{
      text: `${this.traceName(scope, t)} spectrum${db ? " (dB)" : ""}${h ? `  THD ${Number.isFinite(h.thd) ? `${(h.thd * 100).toFixed(2)}%` : "–"}` : ""}`,
      color: this.traceColor(scope, t), open: this.traceOpener(scope, t),
    }];
    // automatic: 0 Hz (the first bin on a log axis) to a round frequency past the content, up to
    // Nyquist; up to just above the peak (linear) or 80 dB below it (dB, relative to the peak)
    const autoSpan = Math.min(fs / 2, niceCeil(Math.max(last * 1.3, peakBin * 4) * df)) || 1;
    const hz = view.fftX ?? { lo: logF ? df : 0, hi: autoSpan };
    // a log axis is navigated in decades: its range in log10(Hz)
    const hr = logF ? { lo: Math.log10(Math.max(hz.lo, df / 4, 1e-12)), hi: Math.log10(Math.max(hz.hi, df)) } : hz;
    const vr = view.fftY ?? (db ? { lo: -80, hi: 0 } : { lo: 0, hi: peak * 1.1 });
    const layout = this.otherLayout("fft", plot, hr, new Map([["fft", vr]]), "Hz", db ? "dB" : t.unit);
    layout.hLog = logF;
    this.layouts.set(scope, layout);
    if (logF) this.logAxis(plot, hr, "Hz");
    else this.valueAxis(plot, hr, "bottom", "Hz");
    this.valueAxis(plot, vr, "left", t.unit, { format: db ? (v) => `${Number(v.toFixed(6))} dB` : undefined });
    if (n >= 16) {
      const fx = (f: number) => logF ? Math.log10(Math.max(f, 1e-12)) : f;
      const xOf = (k: number) => plot.x + ((fx(k * df) - hr.lo) / (hr.hi - hr.lo)) * plot.w;
      const lv = (m: number) => db ? 20 * Math.log10(Math.max(m, 1e-30) / peak) : m;
      const yOf = (m: number) => plot.y + plot.h - ((lv(m) - vr.lo) / (vr.hi - vr.lo)) * plot.h;
      const fLo = logF ? 10 ** hr.lo : hr.lo, fHi = logF ? 10 ** hr.hi : hr.hi;
      const first = Math.max(1, Math.floor(fLo / df)), end = Math.min(n / 2 - 1, Math.ceil(fHi / df) + 1);
      ctx.save();
      ctx.beginPath();
      ctx.rect(plot.x, plot.y, plot.w, plot.h);
      ctx.clip();
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      for (let k = first; k <= end; k++) {
        const py = Math.max(plot.y - 2, Math.min(plot.y + plot.h + 2, yOf(mags[k])));
        if (k === first) ctx.moveTo(xOf(k), py);
        else ctx.lineTo(xOf(k), py);
      }
      this.strokeTrace(this.traceColor(scope, t));
      // the peak (or the fundamental and its harmonics) in the plot's neutral text color
      ctx.fillStyle = scopePalette().title;
      ctx.font = AXIS_FONT;
      // labels that would overlap the previous one are left out (the dot stays)
      let lastLabel = { x0: -Infinity, x1: -Infinity, y: 0 };
      const mark = (bin: number, amp: number, text: string) => {
        const px = xOf(bin), py = yOf(amp);
        if (px < plot.x || px > plot.x + plot.w || py < plot.y || py > plot.y + plot.h) return;
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fill();
        const w = ctx.measureText(text).width, left = px > plot.x + plot.w - 80;
        const x0 = left ? px - 6 - w : px + 6, x1 = x0 + w;
        if (x0 < lastLabel.x1 + 4 && x1 > lastLabel.x0 - 4 && Math.abs(py - lastLabel.y) < 12) return;
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillText(text, x0, py - 3);
        lastLabel = { x0, x1, y: py };
      };
      if (h) {
        mark(h.bins[0], h.amps[0], `${si(h.fundamental * df, "Hz", true, 4)}  ${si(h.amps[0], t.unit, true, 3)}`);
        h.bins.slice(1).forEach((bin, i) => mark(bin, h.amps[i + 1], `${i + 2}`));
      } else mark(peakBin, peak, `${si(peakBin * df, "Hz", true, 4)}  ${si(peak, t.unit, true, 3)}`);
      ctx.restore();
      // readout: the bin under the pointer, its frequency and level (and dB below the peak)
      const p = this.pointerIn(plot);
      if (p) {
        const f = logF ? 10 ** (hr.lo + ((p.x - plot.x) / plot.w) * (hr.hi - hr.lo)) : hr.lo + ((p.x - plot.x) / plot.w) * (hr.hi - hr.lo);
        const k = Math.max(1, Math.min(n / 2 - 1, Math.round(f / df)));
        const color = this.traceColor(scope, t);
        this.dot(xOf(k), Math.max(plot.y, Math.min(plot.y + plot.h, yOf(mags[k]))), color);
        const dbBelow = 20 * Math.log10(Math.max(mags[k], 1e-30) / peak);
        this.readoutBox(plot, { x: xOf(k), y: yOf(mags[k]) }, [
          { text: `f = ${si(k * df, "Hz", true, 4)}`, color: scopePalette().title },
          { text: `${si(mags[k], t.unit, true, 4)}  (${dbBelow.toFixed(1)} dB)`, color },
        ]);
      }
    }
    this.drawBox(scope);
    this.legend(legend, r);
  }

  /**
   * A logarithmic frequency axis over a range in log10 units: lines at 1–9 × each decade (the
   * 1, 2 and 5 ones labelled, as fits), each label in its own prefix.
   */
  private logAxis(plot: Rect, r: Range, unit: string): void {
    const { ctx } = this, colors = scopePalette();
    const xOf = (f: number) => plot.x + ((Math.log10(f) - r.lo) / (r.hi - r.lo)) * plot.w;
    const lines: number[] = [];
    for (let d = Math.floor(r.lo); d <= Math.ceil(r.hi); d++) for (let m = 1; m <= 9; m++) {
      const f = m * 10 ** d, l = Math.log10(f);
      if (l >= r.lo - 1e-9 && l <= r.hi + 1e-9) lines.push(f);
    }
    ctx.lineWidth = 1;
    for (const strong of [false, true]) {
      ctx.strokeStyle = strong ? colors.gridStrong : colors.grid;
      ctx.beginPath();
      for (const f of lines) {
        const decade = Math.abs(Math.log10(f) - Math.round(Math.log10(f))) < 1e-9;
        if (decade !== strong) continue;
        const x = Math.round(xOf(f)) + 0.5;
        ctx.moveTo(x, plot.y);
        ctx.lineTo(x, plot.y + plot.h);
      }
      ctx.stroke();
    }
    // labels: decades, then 2 and 5, as far as they fit
    const decadesWide = plot.w / Math.max(1e-9, r.hi - r.lo);
    const steps = decadesWide > 160 ? [1, 2, 5] : decadesWide > 70 ? [1, 3] : [1];
    const shown = lines.filter((f) => steps.includes(Math.round(f / 10 ** Math.floor(Math.log10(f) + 1e-9))));
    // each in its own prefix (10Hz, 100Hz, 1kHz): one form across decades reads 0.01kHz … 100.00kHz
    const fmt = (f: number) => si(f, unit);
    ctx.font = AXIS_FONT;
    ctx.fillStyle = colors.muted;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    let lastRight = -Infinity;
    for (const f of shown) {
      const text = fmt(f), w = ctx.measureText(text).width, x = Math.min(Math.max(xOf(f), plot.x + w / 2), plot.x + plot.w - w / 2);
      if (x - w / 2 < lastRight + 6) continue;
      ctx.fillText(text, x, plot.y + plot.h + 5);
      lastRight = x + w / 2;
    }
  }

}

/** The trace the trigger watches: the chosen one if it's shown, else the first shown. */
function triggerIndex(scope: ScopeRuntime): number {
  const t = scope.traces[scope.view.trigger.trace];
  const visible = scope.visibleTraces;
  return t && visible.includes(t) ? scope.view.trigger.trace : Math.max(0, scope.traces.indexOf(visible[0]));
}

/** Text cut to fit a width, with an ellipsis. */
function fitText(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + "…").width <= width) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + "…" : "";
}
