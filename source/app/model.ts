// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { fitBounds, type Rect } from "forge-shell/app/content-selection";
import {
  type Adjustable, adjustablePosition, adjustableValue, CapacitorElm, chooseFormat, Circuit, type CircuitElm, type CircuitFormat,
  CurrentElm, DiodeElm, editItem, FuseElm, GroundElm, type GridPoint, InductorElm, MosfetElm, PlaceholderElm, pointKey, RailElm,
  ResistorElm, ScopeFlag, type ScopeSpec, ScopeValue, setEditValue, Simulator, SwitchElm, VoltageElm, visiblePlots, Waveform, WireElm,
  writeCircuit, ZenerElm, ChipElm, CustomCompositeElm, CustomLogicElm, VCCSElm, TransistorElm, PotElm, TransformerElm,
  LEDElm, GraphicElm, LabeledNodeElm, OutputElm, ProbeElm, ScopeElm, LogicOutputElm, BusSplitterElm, InstructionDisplayElm, scopeElmSpec, setScopeElmSpec, createNew,
  ignoredParams, junctionTemperature, JfetElm, DarlingtonElm, UnijunctionElm, SCRElm, TriacElm, DiacElm, VaractorElm, TunnelDiodeElm, TappedTransformerElm,
  RelayElm, RelayCoilElm, RelayContactElm, LampElm, CrystalElm, AmmeterElm, AudioOutputElm, ThreePhaseMotorElm,
  MotorProtectionSwitchElm, SparkGapElm, MemristorElm, SweepElm, AnalogSwitchElm, OpAmpElm, GateElm, InverterElm,
  TriodeElm, LogicInputElm, BusLogicInputElm, CrossSwitchElm, Switch2Elm, OTAElm, NortonAmpElm,
  BatteryElm, AMElm, OhmMeterElm, WattmeterElm, TestPointElm, StopTriggerElm, DataRecorderElm, LDRElm, ThermistorNTCElm,
  DCMotorElm, ComparatorElm, TriStateElm, DelayBufferElm, OptocouplerElm, OpAmpRealElm, DPDTSwitchElm, MBBSwitchElm,
  CustomTransformerElm, spiceModelOf, spicePolarity, withSpiceModel, isSpicePart, partClassName, defineModels, findModel, modelText, tunableMosfetCard, type SpiceModel,
} from "../engine";
import { si } from "./format";
import { moveScope, type ScopeDropEdge } from "./scope-layout";
import { circuitJSLabel, isPlainCircuitJSModel, modelLabel as labelOf } from "./model-catalog";
import { settings } from "./settings";
import { formatTemperature } from "./temperature";
import { modelLibrary } from "./model-library";
import { CurrentFlow } from "./current-flow";
import { isSource, PowerMeter } from "./power";
import { Recording } from "./recording";
import type { Envelope, FFTWindow, HeldScale } from "./scope-math";
import { defaultQuantities, type Quantity, quantitiesFor, quantityOf, readQuantity } from "./scope-quantities";
import { type Ast, compileExpr, parseExpr, printExpr, refsOf, sourceExpr, unitOf } from "./scope-expr";
import type { Range } from "./scope-nav";
import { AudioCapture } from "./audio-capture";
import { Tolerance } from "./tolerance";
import type { PlacedLabel } from "./labels";
import { windingLoops, windingPoints, isTransformer, type TransformerPart } from "./transformer-geometry";

/** One scoped value: which element and what of it (its samples are in the scope's recording). */
export class ScopeTrace {
  constructor(readonly elm: CircuitElm, readonly value: number) {}

  get quantity(): Quantity {
    return quantityOf(this.elm, this.value);
  }

  get unit(): string {
    return this.quantity.unit;
  }

  /** Its value now. */
  read(): number {
    return readQuantity(this.elm, this.value);
  }
}

/**
 * A trace computed from an expression of parts' quantities (typed in the terminal): V(D1)*I(D1),
 * Vgs(M1) - 2… It reads its quantities each timestep. It isn't a CircuitJS plot: it saves as
 * NodeForge metadata, its quantities written by part number.
 */
export class ExprTrace extends ScopeTrace {
  private readonly fn: (values: ArrayLike<number>) => number;
  private readonly values: Float64Array;

  constructor(readonly ast: Ast, readonly refs: { elm: CircuitElm; quantity: Quantity }[]) {
    super(refs[0].elm, -2);
    this.fn = compileExpr(ast);
    this.values = new Float64Array(refs.length);
  }

  override get unit(): string {
    const refs = refsOf(this.ast);
    return unitOf(this.ast, (r) => this.refs[refs.findIndex((x) => x.label === r.label && x.part === r.part)].quantity.unit);
  }

  override read(): number {
    for (let k = 0; k < this.refs.length; k++) this.values[k] = readQuantity(this.refs[k].elm, this.refs[k].quantity.value);
    return this.fn(this.values);
  }

  /** The expression with each quantity written by `name` (for display or for files). */
  text(name: (elm: CircuitElm, label: string) => string): string {
    const refs = refsOf(this.ast);
    return printExpr(this.ast, (r) => { const x = this.refs[refs.findIndex((y) => y.label === r.label && y.part === r.part)]; return name(x.elm, x.quantity.label); });
  }
}

/** Trace math: A − B (a differential probe between two scoped voltages), A + B, A × B, A ÷ B, ∫A dt, dA/dt. */
export type MathOp = "sub" | "add" | "mul" | "div" | "int" | "der";
export const MATH_OPS: MathOp[] = ["sub", "add", "mul", "div", "int", "der"];

/**
 * A trace computed from the scope's other traces each timestep (never from another math trace).
 * It sits after them in the scope, isn't a CircuitJS plot, and saves as NodeForge metadata.
 */
export class MathTrace extends ScopeTrace {
  private acc = 0;
  private prevValue = NaN;
  private prevT = NaN;

  constructor(readonly op: MathOp, readonly a: ScopeTrace, readonly b: ScopeTrace | null) {
    super(a.elm, -1);
  }

  override get unit(): string {
    const ua = this.a.unit, ub = this.b?.unit ?? "";
    switch (this.op) {
      case "sub": case "add": return ua;
      case "mul": return ua === "V" && ub === "A" || ua === "A" && ub === "V" ? "W" : `${ua}·${ub}`;
      case "div": return ua === "V" && ub === "A" ? "Ω" : ua === ub ? "" : `${ua}/${ub}`;
      case "int": return ua === "W" ? "J" : ua === "A" ? "C" : `${ua}·s`;
      case "der": return `${ua}/s`;
    }
  }

  override read(): number {
    return NaN;
  }

  /** This timestep's value from its operands' (b: 0 for one-operand ops). */
  compute(a: number, b: number, t: number): number {
    let v: number;
    switch (this.op) {
      case "sub": v = a - b; break;
      case "add": v = a + b; break;
      case "mul": v = a * b; break;
      case "div": v = b === 0 ? NaN : a / b; break;
      case "int":
        if (Number.isFinite(this.prevT) && t > this.prevT) this.acc += ((a + this.prevValue) / 2) * (t - this.prevT);
        v = this.acc;
        break;
      case "der":
        v = Number.isFinite(this.prevT) && t > this.prevT ? (a - this.prevValue) / (t - this.prevT) : 0;
        break;
    }
    this.prevValue = a;
    this.prevT = t;
    return v;
  }

  /** Start over (an integral from zero). */
  reset(): void {
    this.acc = 0;
    this.prevValue = this.prevT = NaN;
  }
}

/**
 * Scopes drawn on the schematic (CircuitJS's undocked scopes, Undock / Dock). Off for now: scopes
 * live in the scope panel only, and the ones a CircuitJS file places on the schematic open there.
 */
export const SHEET_SCOPES = false;

/** Manual vertical scale for one unit: per division and the value at the middle. */
export interface ScopeScale {
  perDiv: number;
  center: number;
}

/** A scope's view, as Zoom back restores it. */
interface ScopeNavState {
  live: boolean;
  start: number;
  span: number;
  liveSpan?: number;
  autoY: boolean;
  scales: Map<string, ScopeScale>;
  fftX: Range | null;
  fftY: Range | null;
  xyAuto: boolean;
  xyManual: { x: ScopeScale; y: ScopeScale } | null;
}

export interface ScopeView {
  live: boolean;
  /** Left edge (circuit time) when not live. */
  start: number;
  /** Time across the plot when not live (0: one bucket per pixel). */
  span: number;
  /** Fit the vertical scale to the visible data; off: `scales` per unit. */
  autoY: boolean;
  /** The automatic scales last shown, per unit: kept while the data fits them (holdScale). */
  autoHeld: Map<string, HeldScale>;
  /** Explicit live-window duration (set by zooming or typing it; saved with the view), cleared by native time-scale changes. */
  liveSpan?: number;
  scales: Map<string, ScopeScale>;
  /** A spectrum's frequency and magnitude ranges once navigated (null: automatic). */
  fftX: Range | null;
  fftY: Range | null;
  /**
   * Measurement cursors (up to two, A then B): while live, times from the left edge of the plot
   * (they stay put on screen, and on a triggered waveform); while navigating, circuit times.
   */
  cursors: number[];
  trigger: ScopeTrigger;
}

/** An edge trigger: the live view starts where a trace last crossed a level. */
export interface ScopeTrigger {
  /** 0: off (the plot scrolls), 1: rising edge, −1: falling edge. */
  edge: number;
  /** Which trace (index into the scope's traces). */
  trace: number;
  /** The level; null: the middle of the trace's swing. */
  level: number | null;
}

let nextScopeId = 1;

/**
 * A DC sweep's result, which a scope shows instead of sampling: its traces' values against the
 * swept source's (x). Not saved with the circuit (it's a result: run the sweep again).
 */
export interface SweepPlot {
  /** The scope's header ("DC sweep of V1", "R1 stepped"). */
  title: string;
  /** What runs along x (the swept source's designator, or "time") and its unit. */
  label: string;
  unit: string;
  x: number[];
  /**
   * The values along x: one series per trace in the scope's trace order, or with runs, one per trace
   * and run (trace j, run k at j · runs + k); NaN where a point wasn't found.
   */
  series: number[][];
  /** A parameter sweep's runs, by the value stepped ("4.7 kΩ"), or none (one run). */
  runs?: string[];
  /** Swept values whose operating point wasn't found. */
  failed: number[];
  /**
   * An AC sweep's Bode plot: x is frequency (a log axis), `series` the magnitudes in dB and these
   * the phases in degrees, one per trace.
   */
  phase?: number[][];
  /** The same sweep again on the circuit as it is now, into the same scope (Run and Reset call it). */
  rerun?: () => ScopeRuntime | string;
}

/** A live scope and its recording, traces, display settings, and navigation state. */
export class ScopeRuntime {
  /** A DC sweep's result (the scope shows it and doesn't sample), or null. */
  sweep: SweepPlot | null = null;
  /** X-Y points kept: a long trail ("xylong") draws them all, a short one the newest 4096. */
  static readonly xyCapacity = 65536;
  readonly id = nextScopeId++;
  /** Every sample of the traces since the scope (re)started; null until the first sample. */
  recording: Recording | null = null;
  /** Recent (x, y) pairs for XY mode, one per timestep. */
  readonly xy = new Float64Array(ScopeRuntime.xyCapacity * 2);
  xyPtr = 0;
  xyCount = 0;
  /** X-Y auto scale: fit and center the figure gathered so far; off: the origin in the middle. */
  xyAuto = true;
  /** The range each X-Y axis has gathered (holdEnvelope), for its auto scale. */
  xyEnvelope: { x?: Envelope; y?: Envelope } = {};
  /** The X-Y scales with auto off: the origin centered when switched off, or where navigated. */
  xyManual: { x: ScopeScale; y: ScopeScale } | null = null;
  /**
   * NodeForge's measurements switched on (beyond CircuitJS's flags) and its options, saved together
   * (`nfme`): "cycles" (measure over whole cycles), the FFT window ("fftflattop", "fftrect"; else
   * Hann), "harmonics", "logfreq", X-Y axes ("xyx2", "xyy0": trace indices) and "xylong" (a long trail).
   */
  measures = new Set<string>();

  get fftWindow(): FFTWindow {
    return this.measures.has("fftflattop") ? "flattop" : this.measures.has("fftrect") ? "rect" : "hann";
  }

  set fftWindow(w: FFTWindow) {
    this.measures.delete("fftflattop");
    this.measures.delete("fftrect");
    if (w !== "hann") this.measures.add(w === "flattop" ? "fftflattop" : "fftrect");
  }

  setOption(key: string, on: boolean): void {
    if (on) this.measures.add(key);
    else this.measures.delete(key);
  }

  /** X-Y's traces: the chosen ones if still shown, else the first two shown. */
  get xyTraces(): [ScopeTrace, ScopeTrace] | null {
    const vis = this.visibleTraces;
    const chosen = (axis: "x" | "y") => {
      for (const k of this.measures) if (k.startsWith(`xy${axis}`)) { const t = this.traces[Number(k.slice(3))]; if (t && vis.includes(t)) return t; }
      return undefined;
    };
    const x = chosen("x") ?? vis[0], y = chosen("y") ?? vis.find((t) => t !== x);
    return x && y && x !== y ? [x, y] : null;
  }

  /** Plot this trace along X (or Y) on X-Y. */
  setXYTrace(axis: "x" | "y", t: ScopeTrace): void {
    for (const k of [...this.measures]) if (k.startsWith(`xy${axis}`)) this.measures.delete(k);
    this.measures.add(`xy${axis}${this.traces.indexOf(t)}`);
    this.clearXY();
  }
  /** Earlier views, for Zoom back (session only). */
  private navHistory: ScopeNavState[] = [];
  private navPushedAt = 0;
  readonly view: ScopeView = { live: true, start: 0, span: 0, autoY: true, autoHeld: new Map(), scales: new Map(), fftX: null, fftY: null, cursors: [], trigger: { edge: 0, trace: 0, level: null } };
  private sampleValues = new Float64Array(0);
  readonly audio: AudioCapture;

  /**
   * The column the scope sits in (CircuitJS's position): scopes sharing a column are stacked, one
   * above the other.
   */
  position = 0;

  /** The time scale it started with (what Space goes back to), kept in step with the time step. */
  homeSpeed: number;

  constructor(public speed: number, readonly traces: ScopeTrace[], public flags: number) {
    this.homeSpeed = speed;
    this.audio = new AudioCapture();
  }

  has(flag: number): boolean {
    return (this.flags & flag) !== 0;
  }

  /** Add a part's trace before the math traces (they stay last). */
  addTrace(t: ScopeTrace): void {
    this.clearXYChoice();
    const i = this.traces.findIndex((x) => x instanceof MathTrace);
    if (i < 0 || t instanceof MathTrace) this.traces.push(t);
    else this.traces.splice(i, 0, t);
  }

  /**
   * The view as saved with the circuit (only what isn't automatic: manual scales, the time per
   * division set by zooming, a spectrum's ranges, X-Y's manual axes), or undefined.
   */
  encodeView(): string | undefined {
    const v = this.view, o: Record<string, unknown> = {};
    if (!v.autoY && v.scales.size) o.s = Object.fromEntries([...v.scales].map(([u, sc]) => [u, [sc.perDiv, sc.center]]));
    if (v.liveSpan !== undefined) o.l = v.liveSpan;
    if (v.fftX) o.fx = [v.fftX.lo, v.fftX.hi];
    if (v.fftY) o.fy = [v.fftY.lo, v.fftY.hi];
    if (!this.xyAuto && this.xyManual) o.xy = [[this.xyManual.x.perDiv, this.xyManual.x.center], [this.xyManual.y.perDiv, this.xyManual.y.center]];
    return Object.keys(o).length ? JSON.stringify(o) : undefined;
  }

  /** Restore a saved view (anything malformed is left automatic). */
  decodeView(text: string): void {
    let o: Record<string, unknown>;
    try { o = JSON.parse(text); } catch { return; }
    const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
    const pair = (x: unknown): [number, number] | null => Array.isArray(x) && x.length === 2 && num(x[0]) && num(x[1]) ? [x[0], x[1]] : null;
    const range = (x: unknown) => { const p = pair(x); return p && p[1] > p[0] ? { lo: p[0], hi: p[1] } : null; };
    const v = this.view;
    if (o.s && typeof o.s === "object") {
      for (const [u, x] of Object.entries(o.s as Record<string, unknown>)) {
        const p = pair(x);
        if (p && p[0] > 0) v.scales.set(u, { perDiv: p[0], center: p[1] });
      }
      if (v.scales.size) v.autoY = false;
    }
    if (num(o.l) && o.l > 0) v.liveSpan = o.l;
    v.fftX = range(o.fx);
    v.fftY = range(o.fy);
    const xy = Array.isArray(o.xy) && o.xy.length === 2 ? [pair(o.xy[0]), pair(o.xy[1])] : null;
    if (xy?.[0] && xy[1] && xy[0][0] > 0 && xy[1][0] > 0) {
      this.xyManual = { x: { perDiv: xy[0][0], center: xy[0][1] }, y: { perDiv: xy[1][0], center: xy[1][1] } };
      this.xyAuto = false;
    }
  }

  /** Forget the chosen X-Y traces (their indices change when traces come and go). */
  clearXYChoice(): void {
    for (const k of [...this.measures]) if (/^xy[xy]\d/.test(k)) this.measures.delete(k);
  }

  /** Drop math traces whose operands are gone. */
  pruneMath(): void {
    const kept = this.traces.filter((t) => !(t instanceof MathTrace) || (this.traces.includes(t.a) && (!t.b || this.traces.includes(t.b))));
    if (kept.length !== this.traces.length) this.traces.splice(0, this.traces.length, ...kept);
  }

  /** A trace's value at the last timestep recorded. */
  latest(t: ScopeTrace): number {
    const j = this.traces.indexOf(t);
    return j >= 0 && j < this.sampleValues.length ? this.sampleValues[j] : NaN;
  }

  toggle(flag: number): void {
    this.flags ^= flag;
  }

  /** Traces shown, after the Show Voltage / Show Current switches. */
  get visibleTraces(): ScopeTrace[] {
    return this.traces.filter((t) =>
      t.value === ScopeValue.voltage ? this.has(ScopeFlag.showVoltage) : t.value === ScopeValue.current ? this.has(ScopeFlag.showCurrent) : true,
    );
  }

  /** XY mode needs two traces: the first is X, the second Y. */
  get isXY(): boolean {
    return this.has(ScopeFlag.plotXY) && this.visibleTraces.length >= 2;
  }

  /** When the recording started (time axis origin while it fills the first screen). */
  get startedAt(): number {
    return this.recording?.start ?? 0;
  }

  /** Back to the live view; cursors placed while navigating (at circuit times) go. */
  goLive(): void {
    if (!this.view.live) this.view.cursors = [];
    this.view.live = true;
  }

  /** Remember the view before navigating, for Zoom back (a burst of wheel steps counts once). */
  pushNav(burst = false): void {
    const now = performance.now();
    if (burst && now - this.navPushedAt < 600 && this.navHistory.length) { this.navPushedAt = now; return; }
    this.navPushedAt = burst ? now : 0;
    const v = this.view;
    this.navHistory.push({
      live: v.live, start: v.start, span: v.span, liveSpan: v.liveSpan, autoY: v.autoY,
      scales: new Map([...v.scales].map(([u, sc]) => [u, { ...sc }])),
      fftX: v.fftX && { ...v.fftX }, fftY: v.fftY && { ...v.fftY },
      xyAuto: this.xyAuto, xyManual: this.xyManual && { x: { ...this.xyManual.x }, y: { ...this.xyManual.y } },
    });
    if (this.navHistory.length > 50) this.navHistory.shift();
  }

  get canNavBack(): boolean {
    return this.navHistory.length > 0;
  }

  /** Back to the view before the last navigation. */
  navBack(): void {
    const s = this.navHistory.pop();
    if (!s) return;
    const v = this.view;
    Object.assign(v, { live: s.live, start: s.start, span: s.span, liveSpan: s.liveSpan, autoY: s.autoY, fftX: s.fftX, fftY: s.fftY });
    v.scales = s.scales;
    this.xyAuto = s.xyAuto;
    this.xyManual = s.xyManual;
    this.navPushedAt = 0;
  }

  /**
   * Fit (Space or a double-click, as on the schematic): live at its own time per division, every
   * axis automatic (a spectrum's full range, X-Y fitted). Zoom back undoes it.
   */
  resetView(t: number): void {
    this.pushNav();
    this.setSpeed(this.homeSpeed, t);
    this.view.autoY = true;
    this.view.scales.clear();
    this.view.autoHeld.clear();
    this.view.fftX = this.view.fftY = null;
    this.xyAuto = true;
  }

  /** Start over: the recording is discarded (memory and temporary files). */
  reset(): void {
    this.recording?.dispose();
    this.recording = null;
    this.audio.reset();
    for (const t of this.traces) if (t instanceof MathTrace) t.reset();
    this.clearXY();
    this.view.autoHeld.clear();
    this.goLive();
  }

  /** Circuit time per pixel at the scope's own time scale. */
  bucketTime(sim: Simulator): number {
    return sim.maxTimeStep * this.speed;
  }

  /**
   * Circuit time per sample the scope was set to, kept while the time step changes (CircuitJS
   * counts a scope's time scale in timesteps; NodeForge keeps it in seconds). Null until the time
   * step first changes.
   */
  private sampleTime: number | null = null;

  /** Change the time scale (the recording stays: only the default view changes). */
  setSpeed(speed: number, _t: number): void {
    this.speed = Math.max(1, Math.min(1 << 20, Math.round(speed)));
    this.sampleTime = null;
    this.view.liveSpan = undefined;
    this.goLive();
  }

  /** The time step changed: keep the same time per division (as near as whole timesteps allow). */
  retime(oldStep: number, newStep: number, t: number): void {
    const sampleTime = this.sampleTime ?? this.speed * oldStep;
    this.homeSpeed = Math.max(1, Math.round((this.homeSpeed * oldStep) / newStep));
    this.setSpeed(sampleTime / newStep, t);
    this.sampleTime = sampleTime;
  }

  /** Start the X-Y plot over, its scale with it. */
  clearXY(): void {
    this.xyPtr = this.xyCount = 0;
    this.xyEnvelope = {};
  }

  /** Record the traces' values after a timestep. */
  sample(sim: Simulator): void {
    if (this.sweep) return;
    const n = this.traces.length;
    if (this.sampleValues.length !== n) this.sampleValues = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      const t = this.traces[j];
      if (t instanceof MathTrace) {
        const v = this.sampleValues, ia = this.traces.indexOf(t.a), ib = t.b ? this.traces.indexOf(t.b) : -1;
        v[j] = t.compute(v[ia] ?? NaN, ib >= 0 ? v[ib] : 0, sim.t);
      } else this.sampleValues[j] = t.read();
    }
    // a new recording when there's none, the traces changed, or the resolution (max step) did;
    // it starts where this step began (0 after a reset)
    const r = this.recording;
    if (!r || r.traces !== n || r.cell !== sim.maxTimeStep || sim.t < r.end) {
      r?.dispose();
      this.recording = new Recording(n, Math.max(0, sim.t - sim.timeStep), sim.maxTimeStep);
    }
    this.recording!.add(sim.t, this.sampleValues);
    this.audio.add(sim.t, this.sampleValues);
    if (this.has(ScopeFlag.plotXY)) {
      const axes = this.xyTraces;
      if (axes) {
        this.xy[this.xyPtr * 2] = this.latest(axes[0]);
        this.xy[this.xyPtr * 2 + 1] = this.latest(axes[1]);
        this.xyPtr = (this.xyPtr + 1) % ScopeRuntime.xyCapacity;
        this.xyCount = Math.min(this.xyCount + 1, ScopeRuntime.xyCapacity);
      }
    }
  }
}

/** A slider from the circuit file, bound to an element (indices change as the circuit is edited). */
export interface Slider {
  adj: Adjustable;
  elm: CircuitElm;
  /** 0–100. */
  position: number;
  /** Sliders that follow this one (shared sliders in CircuitJS). */
  followers: { adj: Adjustable; elm: CircuitElm }[];
}

/** A restorable copy of the circuit (for undo). */
export interface Snapshot {
  text: string;
  designators: (string | null)[];
  triggers?: ScopeRuntime["view"]["trigger"][];
}

/** Simulation speed range, as circuit time per real second: 10⁻⁸ to 100 × real time. */
export const MAX_SPEED_RATIO = 100;
export const MIN_SPEED_RATIO = 1e-8;
const DEFAULT_SCOPE_FLAGS = ScopeFlag.showVoltage | ScopeFlag.showCurrent | ScopeFlag.plots;

/** Owns one circuit and its simulator, and advances it in step with the display. */
export class SimulationModel {
  circuit!: Circuit;
  readonly sim = new Simulator();
  loadError: string | null = null;

  /** Circuits open paused; Run (or ⌘↩) starts them. */
  running = false;
  /** CircuitJS "Simulation Speed" (iteration count). */
  iterCount = 10;
  /** CircuitJS "Current Speed" slider (1–100); kept for the file, the dots scale themselves. */
  currentBar = 50;
  /** The speed the circuit was loaded with (what the speed dial's double-click returns to). */
  fileSpeedRatio = 0;
  /** Circuit time per real second actually reached lately (null until measured, or while paused). */
  achievedRatio: number | null = null;
  private rateWindow = { wall: 0, sim: 0 };
  /** Component tolerances: on for new circuits, as the file says otherwise (CircuitJS files: off). */
  readonly tolerance = new Tolerance();
  /** Each part's average power over the latest cycles (the power report). */
  readonly power = new PowerMeter();
  readonly currentFlow = new CurrentFlow();

  /** Whether the circuit's currents are big enough to move the dots (false: all under 1 nA). */
  get currentsVisible(): boolean {
    return this.currentFlow.currentsVisible;
  }
  /** Selected parts; `selected` is the one the inspector shows. */
  readonly selection = new Set<CircuitElm>();
  scopes: ScopeRuntime[] = [];
  sliders: Slider[] = [];

  /** Reference designators (R1, C2, …), stable while editing. */
  private readonly designators = new Map<CircuitElm, string>();
  /** Points where three or more terminals meet. */
  junctions: GridPoint[] = [];
  /** Terminals connected to nothing. */
  openPins: GridPoint[] = [];
  /** Label positions, computed by the renderer on first draw. */
  labelLayout: Map<CircuitElm, PlacedLabel[]> | null = null;
  private terminalAt = new Map<string, [CircuitElm, number]>();

  private lastFrame: number | null = null;
  /** Fractional timesteps owed to the simulation (it may need less than one step per frame). */
  private stepDebt = 0;

  constructor(text: string) {
    let circuit: Circuit;
    try {
      circuit = Circuit.parse(text);
    } catch (e) {
      circuit = new Circuit();
      this.loadError = (e as Error).message;
    }
    this.load(circuit);
    this.iterCount = circuit.options.iterCount;
    this.currentBar = circuit.options.currentBar;
    // speeds are capped at 100 × real time
    if (this.speedRatio > MAX_SPEED_RATIO) this.speedRatio = MAX_SPEED_RATIO;
    this.fileSpeedRatio = this.speedRatio;
    // Like CircuitJS, loading only resets time: elements keep the state stored in the file
    // (capacitor voltages, inductor currents). The Reset button resets them too.
    this.restart(false);
  }

  /** Install a (re)loaded circuit: simulator, sliders, scopes, designators. */
  private load(circuit: Circuit, designators?: (string | null)[]): void {
    this.circuit = circuit;
    modelLibrary.upgradeLegacyThermalModels(circuit.elements.map((e) => spiceModelOf(e) ?? "").filter(Boolean));
    const o = circuit.options;
    const sim = this.sim;
    sim.maxTimeStep = o.maxTimeStep;
    sim.minTimeStep = o.minTimeStep;
    sim.adjustTimeStep = o.adjustTimeStep;
    sim.solverType = o.solverType;
    this.applySolverSettings();
    this.tolerance.enabled = o.tolerance?.on ?? false;
    this.tolerance.seed = o.tolerance?.seed ?? 1;
    sim.useCircuitOptions(circuit.options);
    sim.setElements(circuit.simulatedElements);
    sim.stopMessage = null;
    this.power.reset();
    sim.onTimeStep = () => {
      this.power.sample(sim, circuit.elements);
      for (const s of this.scopes) s.sample(sim);
      for (const s of this.sheetScopes.values()) s.sample(sim);
    };

    for (const s of this.scopes ?? []) s.reset();
    this.scopes = [];
    for (const spec of circuit.scopes) this.addScopeFromSpec(spec);
    for (const s of this.sheetScopes?.values() ?? []) s.reset();
    this.sheetScopes = new Map();
    this.syncSheetScopes();
    this.sliders = [];
    circuit.adjustables.forEach((adj) => {
      const elm = this.element(adj.elementIndex);
      if (!elm) return;
      if (adj.sharedWith !== null) {
        const master = circuit.adjustables[adj.sharedWith];
        const s = this.sliders.find((x) => x.adj === master);
        s?.followers.push({ adj, elm });
        return;
      }
      const item = editItem(elm, adj.editItem);
      if (item) this.sliders.push({ adj, elm, position: Math.max(0, Math.min(100, adjustablePosition(adj, item.value))), followers: [] });
    });
    this.selection.clear();
    this.designators.clear();
    if (designators) circuit.elements.forEach((e, i) => designators[i] && this.designators.set(e, designators[i]!));
    this.dockSheetScopes();
    this.assignDesignators();
    this.analyzeTopology();
    this.labelLayout = null;
  }

  /**
   * With scopes on the schematic off: a file's scopes there move to the scope panel (each in a
   * column of its own) and their elements go. Done after everything that refers to parts by index.
   */
  private dockSheetScopes(): void {
    if (SHEET_SCOPES) return;
    const elms = this.circuit.elements.filter((e): e is ScopeElm => e instanceof ScopeElm);
    if (!elms.length) return;
    for (const e of elms) {
      const s = this.sheetScopes.get(e);
      this.sheetScopes.delete(e);
      if (!s) continue;
      s.position = this.scopes.length ? Math.max(...this.scopes.map((x) => x.position)) + 1 : 0;
      this.scopes.push(s);
    }
    this.circuit.elements = this.circuit.elements.filter((e) => !(e instanceof ScopeElm));
    this.sim.useCircuitOptions(this.circuit.options);
    this.sim.setElements(this.circuit.simulatedElements);
  }

  element(index: number): CircuitElm | null {
    return this.circuit.elements[index] ?? null;
  }

  reset(): void {
    this.restart(true);
  }

  private restart(resetElements: boolean): void {
    if (resetElements) {
      this.sim.reset();
      this.sim.stopMessage = null;
      if (this.circuit.options.autoDCOnReset) {
        // the NodeForge solver finds a real operating point; CircuitJS takes one DC step
        if (this.sim.accurate) this.sim.solveOperatingPoint();
        else this.sim.dcAnalysisFlag = true;
      }
    } else this.sim.resetTime();
    this.sim.simRunning = true;
    this.stepDebt = 0;
    this.currentFlow.reset();
    for (const s of this.scopes) s.reset();
  }


  /**
   * Set a part's SPICE model by name and refresh the circuit. Returns the same part.
   */
  setSpiceModel(e: CircuitElm, name: string | null): CircuitElm {
    withSpiceModel(e, name);
    this.circuitChanged();
    return e;
  }

  /** A diode's, MOSFET's, JFET's or transistor's model as it's named to the user ("custom" for a custom one), or null. */
  modelLabel(e: CircuitElm): string | null {
    if (!isSpicePart(e)) return null;
    if (this.isCustomModel(e)) return "custom";
    if (e.spiceModel) return labelOf(e.spiceModel);
    if (e instanceof TransistorElm) return circuitJSLabel(e.modelName, null, "bjt");
    return circuitJSLabel(e.modelName, e.model, e instanceof MosfetElm ? "mosfet" : "diode");
  }

  /** Is the part on a custom model (its own, dialled in its properties)? */
  isCustomModel(e: CircuitElm): boolean {
    return /^custom_/i.test(spiceModelOf(e) ?? "");
  }

  /**
   * The SPICE card a part's model is (a subcircuit has none), as its properties show it and a
   * custom model starts from: a CircuitJS MOSFET model as a stand-alone level 1 card.
   */
  modelCard(e: CircuitElm): SpiceModel | null {
    if (!isSpicePart(e)) return null;
    if (!e.spiceModel && e instanceof MosfetElm && !(e instanceof JfetElm)) return tunableMosfetCard(e.model!, e.pnp);
    return e.spiceCard();
  }

  /**
   * Give a part a custom model of its own, starting from the model it's on: a copy of its card
   * (a MOSFET on a subcircuit starts from a plain VDMOS). Stored in the circuit like any model.
   */
  useCustomModel(e: CircuitElm): void {
    if (!isSpicePart(e) || this.isCustomModel(e)) return;
    const pnp = spicePolarity(e);
    const card = this.modelCard(e);
    const name = newCustomName();
    const text = card ? modelText(card, name) : `.model ${name} VDMOS(${pnp < 0 ? "PCHAN" : ""})`;
    defineModels(text);
    e.setSpiceModel(name);
    this.circuitChanged();
  }

  /**
   * Set a parameter of a part's custom model (null: leave it out, SPICE's default). A model other
   * parts share too (a duplicated part) is copied first, so only this part changes.
   */
  setCustomParam(e: CircuitElm, key: string, value: number | null): void {
    if (!isSpicePart(e) || !this.isCustomModel(e)) return;
    const card = e.spiceCard();
    if (!card) return;
    const params = new Map(card.params);
    if (value === null) params.delete(key);
    else params.set(key, value);
    const shared = this.circuit.elements.some((x) => x !== e && spiceModelOf(x)?.toLowerCase() === e.spiceModel.toLowerCase());
    const name = shared ? newCustomName() : card.name;
    defineModels(modelText({ ...card, params }, name));
    e.setSpiceModel(name);
    this.circuitChanged();
  }

  /**
   * Put a diode or MOSFET on one of CircuitJS's own models (by name): a plain CircuitJS part again
   * (a MOSFET takes the model's threshold and β).
   */
  useCircuitJSModel(e: CircuitElm, name: string): void {
    if (!isSpicePart(e)) return;
    e.setSpiceModel("");
    e.setModel(name);
    e.setPoints();
    this.circuitChanged();
  }

  /**
   * Call after changing elements in place (added, removed, moved, values edited): refreshes the
   * simulator, designators, connectivity, sliders and scopes.
   */
  circuitChanged(): void {
    const els = new Set(this.circuit.elements);
    for (const ce of this.circuit.elements) ce.initBoundingBox();
    this.sim.useCircuitOptions(this.circuit.options);
    this.sim.setElements(this.circuit.simulatedElements);
    this.sim.stopMessage = null;
    this.sim.analyzeFlag = true;
    for (const e of [...this.selection]) if (!els.has(e)) this.selection.delete(e);
    for (const e of [...this.designators.keys()]) if (!els.has(e)) this.designators.delete(e);
    this.sliders = this.sliders.filter((s) => els.has(s.elm));
    for (const s of this.sliders) s.followers = s.followers.filter((f) => els.has(f.elm));
    for (const s of this.scopes) {
      const kept = s.traces.filter((t) => els.has(t.elm));
      if (kept.length === s.traces.length) continue;
      // a trace's part was deleted: the recording's traces no longer line up, so start over
      s.traces.splice(0, s.traces.length, ...kept);
      s.reset();
    }
    this.scopes = this.scopes.filter((s) => s.traces.length > 0);
    this.syncSheetScopes();
    this.dockSheetScopes();
    this.assignDesignators();
    this.analyzeTopology();
    this.labelLayout = null;
  }

  /** The circuit as it stands, with sliders and scopes written back into it. */
  private syncCircuit(): Circuit {
    const c = this.circuit;
    const index = new Map(c.elements.map((e, i) => [e, i] as const));
    c.options.iterCount = this.iterCount;
    c.options.currentBar = this.currentBar;
    // tolerance settings, once a circuit has them (CircuitJS files have none until turned on)
    const t = this.tolerance;
    if (t.enabled || c.options.tolerance) c.options.tolerance = { on: t.enabled, seed: t.seed };
    const adjustables: Adjustable[] = [];
    for (const s of this.sliders) {
      const master = adjustables.length;
      adjustables.push({ ...s.adj, elementIndex: index.get(s.elm)!, sharedWith: null });
      for (const f of s.followers) adjustables.push({ ...f.adj, elementIndex: index.get(f.elm)!, sharedWith: master });
    }
    c.adjustables = adjustables;
    // expression traces are written with their parts by number, and their places in the scope
    const exprSource = (t: ExprTrace) => sourceExpr(t.ast, (r) => {
      const refs = refsOf(t.ast), x = t.refs[refs.findIndex((y) => y.label === r.label && y.part === r.part)];
      return `${x.quantity.label}(#${index.get(x.elm)})`;
    });
    const plain = (t: ScopeTrace) => !(t instanceof MathTrace) && !(t instanceof ExprTrace);
    const spec = (s: ScopeRuntime): ScopeSpec => ({
      // a scope of expressions alone still needs one CircuitJS plot: its first part's voltage
      plots: s.traces.some(plain)
        ? s.traces.filter(plain).map((t) => ({ elementIndex: index.get(t.elm)!, value: t.value }))
        : [{ elementIndex: index.get(s.traces[0].elm)!, value: 0 }],
      expr: s.traces.flatMap((t, i) => t instanceof ExprTrace ? [{ position: i, text: exprSource(t) }] : []),
      exprOnly: !s.traces.some(plain),
      math: s.traces.filter((t): t is MathTrace => t instanceof MathTrace).map((t) => ({ op: t.op, a: s.traces.indexOf(t.a), b: t.b ? s.traces.indexOf(t.b) : null })),
      measures: [...s.measures],
      view: s.encodeView(),
      speed: s.speed, showVoltage: s.has(ScopeFlag.showVoltage), showCurrent: s.has(ScopeFlag.showCurrent), position: s.position, text: null, flags: s.flags,
      trigger: s.view.trigger.edge || s.view.trigger.trace || s.view.trigger.level !== null
        ? { edge: s.view.trigger.edge as 0 | 1 | -1, trace: Math.max(0, Math.min(s.traces.length - 1, s.view.trigger.trace)), level: s.view.trigger.level }
        : undefined,
    });
    // (a sweep's scope is a result, not saved)
    c.scopes = this.scopes.filter((s) => !s.sweep).map(spec);
    // scopes on the sheet keep their definition in their element (part numbers change with edits)
    for (const [elm, s] of this.sheetScopes) if (s.traces.length) setScopeElmSpec(elm, { ...spec(s), position: 0 });
    return c;
  }

  /** The circuit in a file format: `preferred` unless that would lose something. */
  serialize(preferred: CircuitFormat): { text: string; format: CircuitFormat } {
    const c = this.syncCircuit();
    const format = chooseFormat(c, preferred);
    return { text: writeCircuit(c, format), format };
  }

  snapshot(): Snapshot {
    // (an .nfg circuit is kept as XML here: the same content, and snapshots are taken on every edit)
    const { text } = this.serialize(this.circuit.format === "nfg" ? "xml" : this.circuit.format);
    return { text, designators: this.circuit.elements.map((e) => this.designators.get(e) ?? null), triggers: this.scopes.filter((s) => !s.sweep).map((s) => ({ ...s.view.trigger })) };
  }

  /** Restore a snapshot (undo/redo). The simulation keeps its time; element state comes from the snapshot. */
  restore(s: Snapshot): void {
    const format = this.circuit.format;
    const c = Circuit.parse(s.text);
    c.format = format;
    // what the file says about itself isn't part of an edit
    c.meta = this.circuit.meta;
    c.nfgExtra = this.circuit.nfgExtra;
    // scope views are the view, as the schematic's zoom is: undo and redo leave them as they are (a
    // scope still in its place with the same traces keeps its view, time scale and X-Y axes; its
    // trigger comes from the snapshot below)
    const signature = (sc: ScopeRuntime) => sc.traces.map((t) => `${t instanceof MathTrace ? "math" : this.designator(t.elm) ?? "?"}:${t.value}`).join(",");
    const views = this.scopes.filter((sc) => !sc.sweep).map((sc) => ({ signature: signature(sc), view: sc.view, speed: sc.speed, xyAuto: sc.xyAuto, xyManual: sc.xyManual }));
    this.load(c, s.designators);
    this.scopes.filter((sc) => !sc.sweep).forEach((sc, i) => {
      const kept = views[i];
      if (!kept || kept.signature !== signature(sc)) return;
      Object.assign(sc.view, { ...kept.view, trigger: sc.view.trigger });
      sc.speed = kept.speed;
      sc.xyAuto = kept.xyAuto;
      sc.xyManual = kept.xyManual;
    });
    // Undo must restore playback controls as well as the circuit and its time step.
    this.iterCount = c.options.iterCount;
    this.currentBar = c.options.currentBar;
    s.triggers?.forEach((trigger, i) => { if (this.scopes[i]) Object.assign(this.scopes[i].view.trigger, trigger); });
  }

  /**
   * Run as many timesteps as are due since the previous frame (CirSim's steprate logic),
   * limited to ~25 ms of computation per frame. `now` is in seconds.
   */
  advance(now: number): void {
    const last = this.lastFrame;
    this.lastFrame = now;
    if (last === null) return;
    const dt = Math.min(now - last, 0.1);
    if (!this.running || dt <= 0) {
      this.achievedRatio = null;
      this.rateWindow = { wall: 0, sim: 0 };
      return;
    }
    const t0 = this.sim.t;

    // timeStepCount increments per second of wall-clock time
    const steprate = 160 * this.iterCount;
    this.stepDebt = Math.min(this.stepDebt + steprate * dt, steprate * 0.1 + 1);
    if (this.stepDebt >= 1 || this.sim.analyzeFlag) {
      const due = Math.max(1, Math.floor(this.stepDebt));
      const deadline = performance.now() + 25;
      const start = this.sim.timeStepCount;
      this.simulate(() => this.sim.update((done) => done >= due || performance.now() >= deadline));
      this.stepDebt = Math.max(0, this.stepDebt - (this.sim.timeStepCount - start));
      // a stop trigger pauses the simulation (upstream: setSimRunning(false))
      if (!this.sim.simRunning && this.sim.stopMessage === null) {
        this.running = false;
        this.sim.simRunning = true;
      }
    }
    this.measureRate(dt, this.sim.t - t0);
    if (settings.showCurrent && this.running) this.currentFlow.advance(this.circuit.simulatedElements, dt, settings.dotSpeed, !settings.conventionalCurrent);
  }

  /** Average the speed reached over about a second. */
  private measureRate(wall: number, sim: number): void {
    const w = this.rateWindow;
    w.wall += wall;
    w.sim += sim;
    if (w.wall >= 0.5) {
      this.achievedRatio = w.sim / w.wall;
      this.rateWindow = { wall: 0, sim: 0 };
    }
  }

  /** A tab that isn't shown doesn't run; when it comes back, don't count the time it was away. */
  pauseClock(): void {
    this.lastFrame = null;
  }

  /** Advance exactly one timestep (for stepping while paused). */
  step(): void {
    this.simulate(() => this.sim.update(() => true));
  }

  /** Run the simulator with the parts' tolerances in place, then put the nominal values back. */
  private simulate(run: () => void): void {
    this.tolerance.apply(this.circuit.elements, (e) => this.designator(e));
    try {
      run();
    } finally {
      this.tolerance.restore();
    }
  }

  /** Turn tolerances on (with a seed) or off: ideal parts. */
  setTolerance(on: boolean, seed = this.tolerance.seed): void {
    this.tolerance.enabled = on;
    this.tolerance.seed = seed;
    this.circuit.options.tolerance = { on, seed };
    this.toleranceChanged();
  }

  /** The circuit's temperature (°C) for its SPICE devices; they're rebuilt for it at the next step. */
  setTemperature(celsius: number): void {
    this.circuit.options.temperature = celsius;
    this.sim.temperature = celsius + 273.15;
    this.sim.analyzeFlag = true;
  }

  /** The start-up ramp (s; 0: off): sources rise from 0 over it at the start of a run from rest (the next one). */
  setStartupRamp(seconds: number): void {
    this.circuit.options.startupRamp = seconds;
    this.sim.startupRamp = seconds;
  }

  /** Self-heating on or off: devices whose models give a thermal resistance heat up (rebuilt at the next step). */
  setSelfHeating(on: boolean): void {
    this.circuit.options.selfHeating = on;
    this.sim.selfHeating = on;
    this.sim.analyzeFlag = true;
  }

  /** Tolerance settings changed: the parts' values must be stamped again. */
  toleranceChanged(): void {
    this.sim.analyzeFlag = true;
  }


  /**
   * Simulation speed as circuit time per real second (1 = real time). CircuitJS stores an
   * iteration count instead (160 × count timesteps per second), which files keep.
   */
  get speedRatio(): number {
    return 160 * this.iterCount * this.sim.maxTimeStep;
  }
  set speedRatio(r: number) {
    this.iterCount = Math.min(MAX_SPEED_RATIO, Math.max(MIN_SPEED_RATIO, r)) / (160 * this.sim.maxTimeStep);
  }

  /** The solver from the app settings: NodeForge's (error-controlled steps) or CircuitJS's fixed steps. */
  applySolverSettings(): void {
    const accurate = settings.solver === "nodeforge";
    if (this.sim.accurate !== accurate || this.sim.relTol !== settings.relTol) {
      this.sim.accurate = accurate;
      this.sim.relTol = settings.relTol;
      // switching solvers mid-run: start the step size over
      this.sim.analyzeFlag = true;
    }
  }

  /**
   * Set the circuit to its DC operating point (capacitor voltages and inductor currents), from
   * where it then runs. Returns how it was found, or null if it couldn't be.
   */
  findOperatingPoint(): string | null {
    const method = this.sim.solveOperatingPoint();
    if (method) {
      this.sim.resetTime();
      this.stepDebt = 0;
      for (const s of this.scopes) s.reset();
    }
    return method;
  }

  /** Change the time step (accuracy) without changing how fast the circuit plays. */
  setTimeStep(dt: number): void {
    const r = this.speedRatio, old = this.sim.maxTimeStep;
    this.circuit.options.maxTimeStep = this.sim.maxTimeStep = this.sim.timeStep = dt;
    this.speedRatio = r;
    // scopes keep their time per division too
    for (const s of this.scopes) s.retime(old, dt, this.sim.t);
  }

  /**
   * The fastest periodic source, for judging the time step: a time step needs ~20 steps per
   * cycle to follow a signal, and one longer than a cycle can't see it at all.
   */
  fastestSource(): { elm: CircuitElm; frequency: number } | null {
    let best: { elm: CircuitElm; frequency: number } | null = null;
    for (const e of this.circuit.elements) {
      let f = 0;
      if (e instanceof VoltageElm && e.waveform !== Waveform.dc && e.waveform !== Waveform.noise && e.waveform !== Waveform.variable) f = e.frequency;
      else if (e instanceof SweepElm) f = Math.max(e.maxF, e.minF);
      else if (e instanceof AMElm) f = e.carrierfreq;
      if (f > 0 && (!best || f > best.frequency)) best = { elm: e, frequency: f };
    }
    return best;
  }

  /** Scopes drawn on the sheet (CircuitJS's undocked scopes), by their element. */
  sheetScopes = new Map<ScopeElm, ScopeRuntime>();

  /** A scope's traces from its stored definition (parts by index), or null if none is left. */
  private scopeFromSpec(spec: ScopeSpec): ScopeRuntime | null {
    let traces: ScopeTrace[] = [];
    // keep hidden voltage/current plots too: the scope's settings can show them again
    for (const p of spec.plots) {
      const elm = this.element(p.elementIndex);
      if (elm && !(elm instanceof PlaceholderElm)) traces.push(new ScopeTrace(elm, p.value));
    }
    // expression traces at their places (a scope of expressions alone drops its stand-in plot)
    const exprs = (spec.expr ?? []).flatMap((e) => {
      try { const t = this.traceFor(e.text); return [{ position: e.position, trace: t }]; } catch { return []; }
    });
    const complete = traces.length === spec.plots.length && exprs.length === (spec.expr ?? []).length;
    if (spec.exprOnly && exprs.length) traces = [];
    else if (!visiblePlots(spec).length || !traces.length) return null;
    for (const e of exprs.sort((a, b) => a.position - b.position)) traces.splice(Math.min(e.position, traces.length), 0, e.trace);
    if (!traces.length) return null;
    // math traces refer to traces by index: only when every part is still there
    if (complete) {
      for (const m of spec.math ?? []) {
        const a = traces[m.a], b = m.b === null ? null : traces[m.b];
        if (a && !(a instanceof MathTrace) && (m.b === null || (b && !(b instanceof MathTrace))) && MATH_OPS.includes(m.op as MathOp)) traces.push(new MathTrace(m.op as MathOp, a, b));
      }
    }
    const flags = spec.flags | (spec.showVoltage ? ScopeFlag.showVoltage : 0) | (spec.showCurrent ? ScopeFlag.showCurrent : 0);
    const s = new ScopeRuntime(Math.max(1, spec.speed), traces, flags);
    s.position = spec.position;
    for (const key of spec.measures ?? []) s.measures.add(key);
    if (spec.view) s.decodeView(spec.view);
    if (spec.trigger && spec.trigger.trace < traces.length) Object.assign(s.view.trigger, spec.trigger);
    return s;
  }

  /** Scopes for the scope elements on the sheet: new ones read, deleted ones dropped, traces kept to parts that exist. */
  private syncSheetScopes(): void {
    const els = new Set(this.circuit.elements);
    for (const [elm, s] of this.sheetScopes) {
      if (!els.has(elm)) {
        s.reset();
        this.sheetScopes.delete(elm);
        continue;
      }
      const kept = s.traces.filter((t) => els.has(t.elm));
      if (kept.length !== s.traces.length) {
        s.traces.splice(0, s.traces.length, ...kept);
        s.reset();
      }
    }
    for (const e of this.circuit.elements) {
      if (!(e instanceof ScopeElm) || this.sheetScopes.has(e)) continue;
      const spec = scopeElmSpec(e);
      const s = spec && this.scopeFromSpec(spec);
      if (s) this.sheetScopes.set(e, s);
    }
  }

  /**
   * Scopes ▸ Undock: put a scope on the sheet, in a box `w` × `h` at (x, y). Returns the element
   * (the caller adds it as an edit, so it can be undone).
   */
  undockScope(scope: ScopeRuntime, x: number, y: number, w: number, h: number): ScopeElm {
    const elm = createNew(ScopeElm, x, y) as ScopeElm;
    elm.setPosition(x, y, x + w, y + h);
    const index = new Map(this.circuit.elements.map((e, i) => [e, i] as const));
    setScopeElmSpec(elm, {
      plots: scope.traces.map((t) => ({ elementIndex: index.get(t.elm)!, value: t.value })),
      speed: scope.speed, showVoltage: scope.has(ScopeFlag.showVoltage), showCurrent: scope.has(ScopeFlag.showCurrent), position: 0, text: null, flags: scope.flags,
    });
    // the scope itself moves (its recording too)
    this.scopes = this.scopes.filter((x) => x !== scope);
    this.arrangeScopes();
    scope.position = 0;
    this.circuit.elements.push(elm);
    this.sheetScopes.set(elm, scope);
    return elm;
  }

  /** Dock a scope on the sheet: back in the scope panel (a column of its own); its element goes. */
  dockScope(elm: ScopeElm): void {
    const s = this.sheetScopes.get(elm);
    this.circuit.elements = this.circuit.elements.filter((e) => e !== elm);
    if (!s) return;
    this.sheetScopes.delete(elm);
    s.position = this.scopes.length ? Math.max(...this.scopes.map((x) => x.position)) + 1 : 0;
    this.scopes.push(s);
  }

  private addScopeFromSpec(spec: ScopeSpec): void {
    const s = this.scopeFromSpec(spec);
    if (!s) return;
    this.scopes.push(s);
    this.arrangeScopes();
  }

  /** "View in Scope": voltage and current of one element, in a column of its own. */
  addScope(elm: CircuitElm): ScopeRuntime | null {
    if (elm instanceof PlaceholderElm) return null;
    const s = new ScopeRuntime(64, defaultQuantities(elm).map((v) => new ScopeTrace(elm, v)), DEFAULT_SCOPE_FLAGS);
    s.position = this.scopes.length ? Math.max(...this.scopes.map((x) => x.position)) + 1 : 0;
    this.scopes.push(s);
    return s;
  }

  /**
   * Scopes in column order (stacked ones together, keeping their order) with the columns numbered
   * 0, 1, 2… (as CircuitJS keeps them).
   */
  arrangeScopes(): void {
    const columns = [...new Set(this.scopes.map((s) => s.position))].sort((a, b) => a - b);
    for (const s of this.scopes) s.position = columns.indexOf(s.position);
    this.scopes = this.scopes.map((s, i) => [s, i] as const).sort((a, b) => a[0].position - b[0].position || a[1] - b[1]).map(([s]) => s);
  }

  moveScope(source: ScopeRuntime, target: ScopeRuntime, edge: ScopeDropEdge): boolean {
    const next = moveScope(this.scopes, source, target, edge);
    if (!next) return false;
    this.scopes = next;
    return true;
  }

  /** Stack a scope under the scope(s) in the column to its left. */
  stackScope(scope: ScopeRuntime): void {
    if (scope.position === 0) return;
    scope.position--;
    this.arrangeScopes();
  }

  /** Take a scope out of its stack, into a column of its own just after. */
  unstackScope(scope: ScopeRuntime): void {
    for (const s of this.scopes) if (s.position > scope.position) s.position++;
    scope.position++;
    this.arrangeScopes();
  }

  /** Is the scope stacked with others? */
  isStacked(scope: ScopeRuntime): boolean {
    return this.scopes.some((s) => s !== scope && s.position === scope.position);
  }

  /** Scopes ▸ Stack All: every scope in one column. */
  stackScopes(): void {
    for (const s of this.scopes) s.position = 0;
    this.arrangeScopes();
  }

  /** Scopes ▸ Unstack All: every scope in a column of its own. */
  unstackScopes(): void {
    this.scopes.forEach((s, i) => (s.position = i));
  }

  /** Add a value of an element to an existing scope (CircuitJS "Add to Existing Scope"). */
  addToScope(scope: ScopeRuntime, elm: CircuitElm, value: number = defaultQuantities(elm)[0]): void {
    if (scope.traces.some((t) => t.elm === elm && t.value === value)) return;
    scope.addTrace(new ScopeTrace(elm, value));
    scope.reset();
  }

  /** Show or hide a value type in a scope, adding traces for its parts if needed. */
  toggleScopeValue(scope: ScopeRuntime, value: number): void {
    const flag = value === ScopeValue.voltage ? ScopeFlag.showVoltage : value === ScopeValue.current ? ScopeFlag.showCurrent : 0;
    // the scope's parts that offer this quantity
    const elms = [...new Set(scope.traces.filter((t) => !(t instanceof MathTrace)).map((t) => t.elm))]
      .filter((e) => quantitiesFor(e).some((x) => x.value === value));
    const base = (t: ScopeTrace) => !(t instanceof MathTrace) && t.value === value;
    if (flag) {
      scope.toggle(flag);
      if (scope.has(flag)) for (const e of elms) if (!scope.traces.some((t) => base(t) && t.elm === e)) scope.addTrace(new ScopeTrace(e, value));
    } else if (scope.traces.some(base)) {
      scope.clearXYChoice();
      scope.traces.splice(0, scope.traces.length, ...scope.traces.filter((t) => !base(t)));
      scope.pruneMath();
    } else {
      for (const e of elms) scope.addTrace(new ScopeTrace(e, value));
    }
    if (!scope.traces.some((t) => !(t instanceof MathTrace))) this.removeScope(scope.id);
    scope.reset();
  }

  /**
   * A trace for an expression typed in the terminal: one quantity (V(R1)) is an ordinary trace,
   * anything more an expression trace. Parts are named by designator (or #index, as files keep
   * them); quantities by their legend label (V, I, P, Vgs, Ic…; V, I and P work on any part that
   * has them). Throws an Error saying what's wrong.
   */
  traceFor(text: string): ScopeTrace {
    const ast = parseExpr(text);
    const refs = refsOf(ast).map((r) => {
      const elm = r.part.startsWith("#") ? this.element(Number(r.part.slice(1)))
        : this.circuit.elements.find((e) => this.designator(e)?.toLowerCase() === r.part.toLowerCase()) ?? null;
      if (!elm || elm instanceof PlaceholderElm) throw new Error(`${r.part}: no such part.`);
      const offered = quantitiesFor(elm);
      const generic: Record<string, number> = { v: 0, i: 3, p: 7 };
      const quantity = offered.find((q) => q.label.toLowerCase() === r.label.toLowerCase())
        ?? offered.find((q) => q.value === generic[r.label.toLowerCase()]);
      if (!quantity) throw new Error(`${r.part} has no ${r.label}; it offers ${offered.map((q) => q.label).join(", ")}.`);
      return { elm, quantity };
    });
    if (!refs.length) throw new Error("An expression needs at least one quantity, e.g. V(R1).");
    if (ast.kind === "ref") return new ScopeTrace(refs[0].elm, refs[0].quantity.value);
    return new ExprTrace(ast, refs);
  }

  /**
   * A DC sweep (SPICE's .dc): the source's DC value stepped from start to stop, the operating point
   * found at each (each from the last), on a copy of the circuit (the running one is left as it is),
   * and the traces' values shown against it in a new scope. Returns the scope, or why not.
   */
  dcSweep(source: CircuitElm, start: number, stop: number, step: number, traces: ScopeTrace[], into?: ScopeRuntime): ScopeRuntime | string {
    const gone = this.sweepPartsGone([source], traces);
    if (gone) return gone;
    if (!(source instanceof VoltageElm || source instanceof CurrentElm)) return "only a voltage source, rail or current source can be swept";
    const n = Math.round((stop - start) / step);
    if (!(n >= 1) || n > 10000) return "start, stop and step don't make a sweep of 1 to 10000 steps";
    const parts = traces.filter((t) => !(t instanceof ExprTrace) && !(t instanceof MathTrace));
    if (!parts.length) return "nothing to plot";
    // the copy: the circuit as saved, read back (its parts in the same order)
    const copy = Circuit.parse(writeCircuit(this.syncCircuit(), "xml"));
    const at = (e: CircuitElm) => copy.elements[this.circuit.elements.indexOf(e)];
    const src = at(source);
    const sim = new Simulator();
    sim.accurate = true;
    sim.relTol = this.sim.relTol;
    sim.maxTimeStep = sim.timeStep = copy.options.maxTimeStep;
    sim.useCircuitOptions(copy.options);
    sim.setElements(copy.simulatedElements);
    sim.resetTime();
    const x = Array.from({ length: n + 1 }, (_, i) => start + i * step);
    const series = parts.map(() => [] as number[]);
    const found = new Set<number>();
    const failed = sim.dcSweep(x, (v) => {
      if (src instanceof VoltageElm) {
        src.waveform = Waveform.dc;
        src.maxVoltage = v - src.bias;
      } else if (src instanceof CurrentElm) src.currentValue = v;
    }, (v) => {
      found.add(v);
      parts.forEach((t, j) => series[j].push(readQuantity(at(t.elm), t.value)));
    });
    // a point not found: a gap in each series
    if (failed.length) for (let j = 0; j < parts.length; j++) series[j] = x.map((v) => (found.has(v) ? series[j].shift()! : NaN));
    const s = into ?? this.addPlotScope(parts, "xy");
    const label = this.designator(source) ?? this.kindName(source);
    s.sweep = { title: `DC sweep of ${label}`, label, unit: source instanceof CurrentElm ? "A" : "V", x, series, failed,
      rerun: () => this.dcSweep(source, start, stop, step, s.traces, s) };
    return s;
  }

  /**
   * A parameter sweep: for each value, a copy of the circuit with the part's property set to it
   * (`apply` sets it on the copy's part, as `set` does), run from the start for `seconds` with the
   * circuit's settings, its traces resampled on a common time grid; the runs overlaid in a new
   * scope. Returns the scope, or why not.
   */
  paramSweep(part: CircuitElm, values: number[], show: (v: number) => string, apply: (copyPart: CircuitElm, v: number) => void, seconds: number, traces: ScopeTrace[], into?: ScopeRuntime): ScopeRuntime | string {
    const gone = this.sweepPartsGone([part], traces);
    if (gone) return gone;
    const parts = traces.filter((t) => !(t instanceof ExprTrace) && !(t instanceof MathTrace));
    if (!parts.length) return "nothing to plot";
    if (!values.length || values.length > 50) return "give 1 to 50 values";
    const steps = seconds / this.circuit.options.maxTimeStep;
    if (!(seconds > 0) || steps * values.length > 5e6) return `${values.length} runs of ${Math.round(steps)} steps each are too many (at most 5 000 000 steps in all)`;
    const grid = Array.from({ length: 1001 }, (_, i) => (i * seconds) / 1000);
    const series: number[][] = parts.flatMap(() => values.map(() => [] as number[]));
    const failed: number[] = [];
    values.forEach((v, k) => {
      const copy = Circuit.parse(writeCircuit(this.syncCircuit(), "xml"));
      const at = (e: CircuitElm) => copy.elements[this.circuit.elements.indexOf(e)];
      apply(at(part), v);
      const sim = new Simulator();
      sim.accurate = this.sim.accurate;
      sim.relTol = this.sim.relTol;
      sim.maxTimeStep = sim.timeStep = copy.options.maxTimeStep;
      sim.minTimeStep = copy.options.minTimeStep;
      sim.adjustTimeStep = copy.options.adjustTimeStep;
      sim.useCircuitOptions(copy.options);
      sim.setElements(copy.simulatedElements);
      sim.resetTime();
      // each trace sampled at every step, then resampled on the grid (linear between steps)
      const times: number[] = [0], values_: number[][] = parts.map((t) => [readQuantity(at(t.elm), t.value)]);
      sim.onTimeStep = () => {
        times.push(sim.t);
        parts.forEach((t, j) => values_[j].push(readQuantity(at(t.elm), t.value)));
      };
      while (sim.t < seconds && sim.stopMessage === null) sim.update(() => sim.t >= seconds);
      if (sim.stopMessage !== null) failed.push(v);
      parts.forEach((_, j) => {
        let i = 0;
        series[j * values.length + k] = grid.map((t) => {
          if (t > times[times.length - 1]) return NaN;
          while (i + 1 < times.length && times[i + 1] < t) i++;
          const t0 = times[i], t1 = times[i + 1] ?? t0, y0 = values_[j][i], y1 = values_[j][i + 1] ?? y0;
          return t1 > t0 ? y0 + ((y1 - y0) * (t - t0)) / (t1 - t0) : y0;
        });
      });
    });
    const s = into ?? this.addPlotScope(parts, "xy");
    s.sweep = { title: `${this.designator(part) ?? this.kindName(part)} stepped`, label: "time", unit: "s", x: grid, series, runs: values.map(show), failed,
      rerun: () => this.paramSweep(part, values, show, apply, seconds, s.traces, s) };
    return s;
  }

  /**
   * An AC sweep (SPICE's .ac): the circuit linearized at its operating point, driven by a unit AC
   * value of the source (1 V, or 1 A), at `perDecade` frequencies per decade from fStart to fStop,
   * on a copy of the circuit; each trace (a voltage) shown as a Bode plot in a new scope: magnitude
   * in dB (relative to 1 V) and phase in degrees, unwrapped along the sweep. Returns the scope, or
   * why not.
   */
  acSweep(source: CircuitElm, fStart: number, fStop: number, perDecade: number, traces: ScopeTrace[], into?: ScopeRuntime): ScopeRuntime | string {
    const gone = this.sweepPartsGone([source], traces);
    if (gone) return gone;
    if (!(source instanceof VoltageElm || source instanceof CurrentElm)) return "only a voltage source, rail or current source can drive it";
    const decades = Math.log10(fStop / fStart);
    const n = Math.round(decades * perDecade);
    if (!(fStart > 0) || !(n >= 1) || n > 10000) return "the frequencies and points per decade don't make a sweep of 1 to 10000 steps";
    const parts = traces.filter((t) => !(t instanceof ExprTrace) && !(t instanceof MathTrace));
    if (!parts.length) return "nothing to plot";
    const notV = parts.find((t) => t.unit !== "V");
    if (notV) return `only voltages can be plotted (${this.designator(notV.elm) ?? this.kindName(notV.elm)}: ${notV.unit})`;
    const copy = Circuit.parse(writeCircuit(this.syncCircuit(), "xml"));
    const at = (e: CircuitElm) => copy.elements[this.circuit.elements.indexOf(e)];
    const src = at(source);
    const sim = new Simulator();
    sim.accurate = true;
    sim.relTol = this.sim.relTol;
    sim.maxTimeStep = sim.timeStep = copy.options.maxTimeStep;
    sim.useCircuitOptions(copy.options);
    sim.setElements(copy.simulatedElements);
    sim.resetTime();
    const x = Array.from({ length: n + 1 }, (_, i) => fStart * 10 ** (i / perDecade));
    // the unit excitation: 1 V on the voltage source's row, or 1 A through the current source
    const result = sim.acAnalysis(x, (m, rhs) => {
      if (src instanceof VoltageElm) {
        const vs = (src as unknown as { voltSource: { row: number; matrixIndex: number } | null }).voltSource;
        if (vs && sim.matrices[vs.matrixIndex] === m) rhs[vs.row - 1] = 1;
      } else {
        const [a, b] = [src.getNode(0), src.getNode(1)];
        if (a && a.row > 0 && sim.matrices[a.matrixIndex] === m) rhs[a.row - 1] -= 1;
        if (b && b.row > 0 && sim.matrices[b.matrixIndex] === m) rhs[b.row - 1] += 1;
      }
    });
    if (!result) return "no operating point was found";
    // each trace read from its part's node voltages set to the real, then the imaginary parts (a
    // voltage is linear in them; its value with every node at 0 taken off)
    const series: number[][] = [], phase: number[][] = [];
    for (const t of parts) {
      const e = at(t.elm), saved = [...e.volts];
      const nodes = Array.from({ length: e.volts.length }, (_, k) => (k < e.getNodeCount() && e.getNode(k) ? result.get(e.getNode(k)!) : undefined));
      const read = (part: "re" | "im" | null, i: number) => {
        nodes.forEach((v, k) => (e.volts[k] = part && v ? v[part][i] : 0));
        return readQuantity(e, t.value);
      };
      const mag: number[] = [], deg: number[] = [];
      for (let i = 0; i < x.length; i++) {
        const zero = read(null, i), re = read("re", i) - zero, im = read("im", i) - zero;
        mag.push(20 * Math.log10(Math.hypot(re, im)));
        let p = (Math.atan2(im, re) * 180) / Math.PI;
        // unwrapped: within half a turn of the last point
        if (deg.length) p += 360 * Math.round((deg[deg.length - 1] - p) / 360);
        deg.push(p);
      }
      e.volts.splice(0, e.volts.length, ...saved);
      series.push(mag);
      phase.push(deg);
    }
    const s = into ?? this.addPlotScope(parts, "xy");
    const label = this.designator(source) ?? this.kindName(source);
    s.sweep = { title: `AC sweep of ${label}`, label: "frequency", unit: "Hz", x, series, phase, failed: [],
      rerun: () => this.acSweep(source, fStart, fStop, perDecade, s.traces, s) };
    return s;
  }

  /** Why a sweep can't run again: a part it sweeps or plots has been deleted (null if none). */
  private sweepPartsGone(swept: CircuitElm[], traces: ScopeTrace[]): string | null {
    const gone = [...swept, ...traces.map((t) => t.elm)].find((e) => !this.circuit.elements.includes(e));
    return gone ? `${this.designator(gone) ?? this.kindName(gone)} is no longer in the circuit` : null;
  }

  /**
   * Run every sweep scope's sweep again on the circuit as it is now (Run and Reset do), so its plot
   * follows edits. A sweep that can no longer run keeps its last result; returns why, per scope.
   */
  rerunSweeps(): string[] {
    const reasons: string[] = [];
    for (const s of this.scopes) {
      if (!s.sweep?.rerun) continue;
      const r = s.sweep.rerun();
      if (typeof r === "string") reasons.push(`${s.sweep.title}: ${r}`);
    }
    return reasons;
  }

  /** A new scope of these traces as a time plot, X-Y (the first along X) or a spectrum. */
  addPlotScope(traces: ScopeTrace[], plot: "time" | "xy" | "fft"): ScopeRuntime {
    const flags = DEFAULT_SCOPE_FLAGS | (plot === "xy" ? ScopeFlag.plotXY : plot === "fft" ? ScopeFlag.fft : 0);
    const s = new ScopeRuntime(64, traces, flags);
    s.position = this.scopes.length ? Math.max(...this.scopes.map((x) => x.position)) + 1 : 0;
    this.scopes.push(s);
    return s;
  }

  /** Add a math trace to a scope (operands are its part traces). */
  addMathTrace(scope: ScopeRuntime, op: MathOp, a: ScopeTrace, b: ScopeTrace | null): MathTrace {
    const t = new MathTrace(op, a, b);
    scope.addTrace(t);
    scope.reset();
    return t;
  }

  removeTrace(scope: ScopeRuntime, t: ScopeTrace): void {
    scope.clearXYChoice();
    scope.traces.splice(0, scope.traces.length, ...scope.traces.filter((x) => x !== t));
    scope.pruneMath();
    if (!scope.traces.some((x) => !(x instanceof MathTrace))) this.removeScope(scope.id);
    scope.reset();
  }
  removeScope(id: number): void {
    const i = this.scopes.findIndex((s) => s.id === id);
    if (i >= 0) this.scopes.splice(i, 1)[0].reset();
    this.arrangeScopes();
  }

  /** Remove every scope (and its recording). */
  clearScopes(): void {
    for (const s of this.scopes) s.reset();
    this.scopes = [];
  }

  /** Scopes ▸ Combine All: every trace in one scope. */
  combineScopes(): void {
    if (this.scopes.length < 2) return;
    const [first, ...rest] = this.scopes;
    for (const s of rest) for (const t of s.traces) if (!first.traces.some((u) => u.elm === t.elm && u.value === t.value)) first.traces.push(new ScopeTrace(t.elm, t.value));
    for (const s of rest) s.reset();
    this.scopes = [first];
    first.position = 0;
    first.reset();
  }

  /** Scopes ▸ Separate All: one scope per part. */
  separateScopes(): void {
    const out: ScopeRuntime[] = [];
    for (const s of this.scopes) {
      const elms = [...new Set(s.traces.map((t) => t.elm))];
      if (elms.length < 2) {
        out.push(s);
        continue;
      }
      for (const e of elms) out.push(new ScopeRuntime(s.speed, s.traces.filter((t) => t.elm === e).map((t) => new ScopeTrace(e, t.value)), s.flags & ~ScopeFlag.plotXY));
      s.reset();
    }
    // each in a column of its own
    out.forEach((s, i) => (s.position = i));
    this.scopes = out;
  }


  setSlider(s: Slider, position: number): void {
    s.position = position;
    setEditValue(s.elm, s.adj.editItem, adjustableValue(s.adj, position));
    // a shared slider maps the master's position through its own range
    for (const f of s.followers) setEditValue(f.elm, f.adj.editItem, adjustableValue(f.adj, position));
    this.sim.analyzeFlag = true;
    this.labelLayout = null;
  }

  /** A part's own slider moved (it changes the part's value directly). */
  partSliderMoved(): void {
    this.sim.analyzeFlag = true;
    this.labelLayout = null;
  }

  sliderValueText(s: Slider): string {
    const item = editItem(s.elm, s.adj.editItem);
    if (!item) return "–";
    return si(item.value, unitForEditName(item.name), true);
  }


  private assignDesignators(): void {
    // a new part takes the lowest free number of its kind (deleting R2 frees it); named parts keep theirs
    const used = new Map<string, Set<number>>();
    for (const [, d] of this.designators) {
      const m = /^([A-Z]+)(\d+)$/.exec(d);
      if (!m) continue;
      if (!used.has(m[1])) used.set(m[1], new Set());
      used.get(m[1])!.add(Number(m[2]));
    }
    for (const ce of this.circuit.elements) {
      if (this.designators.has(ce)) continue;
      const prefix = designatorPrefix(ce);
      if (!prefix) continue;
      if (!used.has(prefix)) used.set(prefix, new Set());
      const taken = used.get(prefix)!;
      let n = 1;
      while (taken.has(n)) n++;
      taken.add(n);
      this.designators.set(ce, prefix + n);
    }
  }

  /** Parts moved mid-drag: refresh junction and open-pin markers and label positions (the simulator waits for the drop). */
  geometryChanged(): void {
    this.analyzeTopology();
    this.labelLayout = null;
  }

  private analyzeTopology(): void {
    const count = new Map<string, { p: GridPoint; n: number }>();
    this.terminalAt = new Map();
    for (const ce of this.circuit.elements) {
      for (let i = 0; i < ce.getPostCount(); i++) {
        const p = ce.getPost(i);
        const k = pointKey(p);
        const e = count.get(k);
        if (e) e.n++;
        else count.set(k, { p, n: 1 });
        const prev = this.terminalAt.get(k);
        if (!prev || prev[0] instanceof PlaceholderElm) this.terminalAt.set(k, [ce, i]);
      }
    }
    this.junctions = [...count.values()].filter((e) => e.n >= 3).map((e) => e.p);
    this.openPins = [...count.values()].filter((e) => e.n === 1).map((e) => e.p);
  }

  /** Voltage of the node at a terminal point (0 if unknown). */
  voltageAt(p: GridPoint): number {
    const t = this.terminalAt.get(pointKey(p));
    if (!t || t[0] instanceof PlaceholderElm) return 0;
    return t[0].volts[t[1]] ?? 0;
  }

  /** Is anything else connected at this point? */
  isConnected(p: GridPoint, except: CircuitElm): boolean {
    const k = pointKey(p);
    return this.circuit.elements.some((e) => e !== except && Array.from({ length: e.getPostCount() }, (_, i) => pointKey(e.getPost(i))).includes(k));
  }


  /** The nearest drawn part or wire; a box interior is a fallback when no stroke is nearby. */
  elementAt(px: number, py: number, tolerance: number): CircuitElm | null {
    let best: CircuitElm | null = null;
    let bestD = tolerance;
    for (const ce of this.circuit.elements) {
      const d = distanceToElement(px, py, ce);
      if (d > tolerance) continue;
      if (d < bestD || (d === bestD && best instanceof WireElm && !(ce instanceof WireElm))) {
        best = ce;
        bestD = d;
      }
    }
    if (best) return best;
    for (const ce of this.circuit.elements) {
      if (ce.getPostCount() <= 2 && !(ce instanceof ScopeElm)) continue;
      if (isTransformer(ce)) continue;
      if (distanceToBox(px, py, partBox(ce)) <= tolerance) return ce;
    }
    return best;
  }

  /** Elements entirely inside a world rectangle (marquee selection). */
  elementsIn(x0: number, y0: number, x1: number, y1: number): CircuitElm[] {
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)], [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
    const inside = (p: { x: number; y: number }) => p.x >= ax && p.x <= bx && p.y >= ay && p.y <= by;
    return this.circuit.elements.filter((e) => inside(e.point1) && inside(e.point2));
  }

  /** The part the inspector shows: the only selected part, if exactly one is selected. */
  get selected(): CircuitElm | null {
    return this.selection.size === 1 ? [...this.selection][0] : null;
  }
  set selected(e: CircuitElm | null) {
    this.selection.clear();
    if (e) this.selection.add(e);
  }

  designator(ce: CircuitElm): string | null {
    return this.designators.get(ce) ?? null;
  }

  /** Short value label shown on the schematic. */
  valueLabel(ce: CircuitElm): string | null {
    if (ce instanceof OhmMeterElm) return Number.isFinite(ce.resistance) ? si(ce.resistance, "Ω") : "∞";
    if (ce instanceof ResistorElm) return si(ce.resistance, "Ω");
    if (ce instanceof CapacitorElm) return si(ce.capacitance, "F");
    if (ce instanceof InductorElm) return si(ce.inductance, "H");
    if (ce instanceof RailElm) return null;
    if (ce instanceof VoltageElm) {
      if (ce.waveform === Waveform.dc) return si(ce.maxVoltage + ce.bias, "V");
      return `${si(ce.maxVoltage, "V")} ${si(ce.frequency, "Hz")}`;
    }
    if (ce instanceof CurrentElm) return si(ce.currentValue, "A");
    // a diode or MOSFET: its model's name (it's what the part is; "custom" for its own), none for
    // CircuitJS's plain default (the part's type says it)
    if (ce instanceof TransistorElm && !spiceModelOf(ce)) return ce.modelName === "default" ? `β ${si(ce.beta, "")}` : ce.modelName;
    if (isSpicePart(ce)) return !ce.spiceModel && isPlainCircuitJSModel(ce.modelName) ? null : this.modelLabel(ce);
    if (ce instanceof FuseElm) return `${si(ce.i2t, "A²s")}`;
    if (ce instanceof TransistorElm) return ce.modelName === "default" ? `β ${si(ce.beta, "")}` : ce.modelName;
    if (ce instanceof BatteryElm) {
      // its voltage and state of charge, each as it's set to show (Show voltage value / Show state of charge)
      const parts = [ce.hasFlag(BatteryElm.FLAG_SHOW_VOLTAGE) ? si(ce.getVoltageForSoc(ce.soc), "V") : "", ce.hasFlag(BatteryElm.FLAG_SHOW_SOC) ? ce.socText : ""];
      return parts.filter(Boolean).join(" ") || null;
    }
    if (ce instanceof LDRElm || ce instanceof ThermistorNTCElm) return si(ce.resistance, "Ω");
    if (ce instanceof DCMotorElm) return `${Math.round(ce.rpm)} rpm`;
    if (ce instanceof OpAmpRealElm) return ["LM741", "LM324", "LM324"][ce.modelType] ?? null;
    // and the two halves either side of the wiper (Show values)
    if (ce instanceof PotElm) {
      const r1 = ce.maxResistance * ce.position, r2 = ce.maxResistance * (1 - ce.position);
      return ce.hasFlag(PotElm.FLAG_SHOW_VALUES) ? `${si(ce.maxResistance, "Ω")} (${si(r1, "Ω")} / ${si(r2, "Ω")})` : si(ce.maxResistance, "Ω");
    }
    if (ce instanceof TransformerElm) return `${si(ce.inductance, "H")} 1:${si(ce.ratio, "")}`;
    if (ce instanceof CrystalElm) return si(ce.seriesFrequency, "Hz");
    // its reading (Show value; the renderer refreshes it every frame)
    if (ce instanceof ProbeElm) return ce.hasFlag(ProbeElm.FLAG_SHOWVOLTAGE) ? probeReading(ce) : null;
    if (ce instanceof LampElm) return si(ce.nom_pow, "W");
    if (ce instanceof VCCSElm) return ce.exprString;
    if (ce instanceof CustomCompositeElm) return ce.modelName;
    if (ce instanceof CustomLogicElm) return ce.modelName;
    if (ce instanceof BusSplitterElm) return null;
    if (ce instanceof ChipElm) return ce.chipName() || null;
    return null;
  }

  kindName(ce: CircuitElm): string {
    if (ce instanceof WireElm) return "wire";
    if (ce instanceof GroundElm) return "ground";
    if (ce instanceof ResistorElm) return "resistor";
    if (ce instanceof CapacitorElm) return "capacitor";
    if (ce instanceof InductorElm) return "inductor";
    if (ce instanceof RailElm) return ce.waveform === Waveform.dc ? "voltage rail" : "signal rail";
    if (ce instanceof VoltageElm) {
      return ["voltage source", "A/C source", "square wave gen", "triangle gen", "sawtooth gen", "pulse gen", "noise gen", "voltage source"][ce.waveform] ?? "voltage source";
    }
    if (ce instanceof SwitchElm) return ce.momentary ? "push switch (SPST)" : "switch (SPST)";
    if (ce instanceof CurrentElm) return "current source";
    const model = this.modelLabel(ce);
    if (ce instanceof ZenerElm) return `Zener diode (${model})`;
    if (ce instanceof LEDElm && isSpicePart(ce)) return model === "LED" ? "LED" : `LED (${model})`;
    if (ce instanceof DiodeElm && isSpicePart(ce)) return model === "Diode" ? "diode" : `diode (${model})`;
    if (ce instanceof FuseElm) return ce.blown ? "fuse (blown)" : "fuse";
    if (ce instanceof JfetElm) return `${ce.pnp === -1 ? "p" : "n"}-JFET`;
    if (ce instanceof MosfetElm) return `${ce.pnp === -1 ? "p" : "n"}-MOSFET${model ? ` (${model})` : ""}`;
    if (ce instanceof PlaceholderElm) return `'${ce.typeName}' (not simulated yet)`;
    if (ce instanceof TransistorElm) return `${ce.pnp === -1 ? "PNP" : "NPN"} transistor`;
    if (ce instanceof VCCSElm || ce instanceof ChipElm) return ce.chipName() || readableName(ce);
    if (ce instanceof CustomCompositeElm) return `subcircuit (${ce.modelName})`;
    return readableName(ce);
  }

  /** Scope caption, e.g. "inductor, 1H". */
  scopeCaption(ce: CircuitElm): string {
    return [this.kindName(ce), this.valueLabel(ce)].filter(Boolean).join(", ");
  }

  /**
   * What's wrong with a part's model, its own and its subcircuit's parts': problems (it can't be
   * simulated: an unknown model, the wrong kind) and warnings (it runs, but something of its model
   * isn't simulated: an element a subcircuit can't build, a parameter set left out).
   */
  partIssues(ce: CircuitElm): { problems: string[]; warnings: string[] } {
    const problems: string[] = [], warnings: string[] = [];
    const visit = (e: CircuitElm) => {
      const p = e as { spiceProblem?: string | null; spiceWarnings?: string[] };
      if (p.spiceProblem) problems.push(p.spiceProblem);
      // (before a run has built it, an unknown model is known already)
      else if (spiceModelOf(e) && !findModel(spiceModelOf(e)!)) problems.push(`SPICE model ${spiceModelOf(e)} isn't defined`);
      for (const w of p.spiceWarnings ?? []) warnings.push(w);
      const ignored = ignoredParams(e);
      if (ignored.length) warnings.push(`${ignored.join(", ")} ${ignored.length > 1 ? "aren't" : "isn't"} simulated`);
      for (const child of e.getChildElmList() ?? []) visit(child);
    };
    visit(ce);
    return { problems: [...new Set(problems)], warnings: [...new Set(warnings)] };
  }

  /** The CircuitJS info box for an element. */
  infoLines(ce: CircuitElm): string[] {
    const lines = [[this.designator(ce), this.kindName(ce)].filter(Boolean).join("  ")];
    // a model problem or warning first, so the readout (five lines) always has room for it
    const issues = this.partIssues(ce);
    lines.push(...issues.problems.map((x) => `Problem: ${x}`), ...issues.warnings.map((x) => `Warning: ${x}`));
    if (ce instanceof PlaceholderElm) return lines;
    if (ce instanceof MosfetElm) return this.fetInfo(ce, lines);
    if (ce instanceof ScopeElm) {
      // what it shows
      const s = this.sheetScopes.get(ce);
      if (s) lines.push(s.visibleTraces.filter((t) => !(t instanceof MathTrace)).map((t) => `${t.quantity.label}(${this.designator(t.elm) ?? "?"})`).join(", "));
      return lines;
    }
    if (ce instanceof SwitchElm) lines.push(ce.position === 0 ? "closed" : "open");
    lines.push("I = " + si(Math.abs(ce.getCurrent()), "A", true));
    if (ce instanceof WireElm || ce instanceof RailElm) lines.push("V = " + si(ce.volts[0] ?? 0, "V", true));
    else if (!(ce instanceof GroundElm)) lines.push("Vd = " + si(Math.abs(ce.getVoltageDiff()), "V", true));
    if (ce instanceof ResistorElm) lines.push("R = " + si(ce.resistance, "Ω", true));
    else if (ce instanceof CapacitorElm) lines.push("C = " + si(ce.capacitance, "F", true));
    else if (ce instanceof InductorElm) lines.push("L = " + si(ce.inductance, "H", true));
    else if (ce instanceof VoltageElm && ce.waveform !== Waveform.dc) {
      lines.push("f = " + si(ce.frequency, "Hz", true));
      lines.push("Vmax = " + si(ce.maxVoltage, "V", true));
    }
    if (!(ce instanceof WireElm || ce instanceof GroundElm)) lines.push("P = " + si(ce.getPower(), "W", true), ...this.averagePowerLines(ce));
    lines.push(...this.temperatureLines(ce));
    lines.push(...this.toleranceLines(ce));
    if (ce instanceof DiodeElm && spiceModelOf(ce)) {
      // the CircuitJS model's figures don't apply
    } else if (ce instanceof DiodeElm) {
      if (ce.model!.oldStyle) lines.push("Vf = " + si(ce.model!.fwdrop, "V", true));
      if (ce instanceof ZenerElm) lines.push("Vz = " + si(ce.model!.breakdownVoltage, "V", true));
    } else if (ce instanceof FuseElm) {
      lines.push("R = " + si(ce.resistance, "Ω", true));
      lines.push("I²t = " + si(ce.i2t, "A²s", true));
      if (!ce.blown) lines.push(`${Math.trunc((ce.heat * 100) / ce.i2t)}% melted`);
    }
    return lines;
  }

  /** A part's average power over the latest cycles, e.g. "Pavg = 6.2 W" (signed as P: a source delivering is negative). */
  private averagePowerLines(ce: CircuitElm): string[] {
    const p = this.power.average(ce);
    return p === null ? [] : [`Pavg = ${si(isSource(ce) ? -p : p, "W", true)}`];
  }

  /** A self-heated part's junction temperature in the app's unit, e.g. "Tj = 63.2 °C". */
  private temperatureLines(ce: CircuitElm): string[] {
    const tj = junctionTemperature(ce);
    // (over 150 °C, silicon's usual limit, where the schematic's heat glow turns fully red)
    return tj === null ? [] : [`Tj = ${formatTemperature(tj, 4)}${tj > 150 ? ` (over ${formatTemperature(150, 3)})` : ""}`];
  }

  /** A part's actual values under tolerance, e.g. "actual R = 1.007 kΩ (+0.7%)". */
  private toleranceLines(ce: CircuitElm): string[] {
    return this.tolerance.deviations(ce, this.designator(ce)).map(
      (d) => `actual ${d.symbol} = ${d.unit ? si(d.value, d.unit, true) : +d.value.toPrecision(4)} (${d.percent >= 0 ? "+" : ""}${d.percent.toFixed(1)}%)`,
    );
  }

  /** MosfetElm.getFetInfo */
  private fetInfo(ce: MosfetElm, lines: string[]): string[] {
    const v = ce.volts, n = ce.pnp === 1;
    const library = spiceModelOf(ce);
    if (library || (ce as { device?: unknown }).device) {
      // simulated as a SPICE device: its currents and voltages (CircuitJS's region and gm aren't
      // worked out); on a CircuitJS model, that model's Vt and β
      if (!library) lines.push(`Vt = ${si(ce.pnp * ce.vt, "V", true)}, β = ${ce.beta}`);
      lines.push((n ? "Ids = " : "Isd = ") + si(ce.ids, "A", true));
      lines.push("Vgs = " + si(v[0] - v[ce.pnp === -1 ? 2 : 1], "V", true));
      lines.push((n ? "Vds = " : "Vsd = ") + si(v[2] - v[1], "V", true));
      lines.push("Ig = " + si(-ce.getCurrentIntoNode(0), "A", true));
      lines.push("P = " + si(ce.getPower(), "W", true), ...this.averagePowerLines(ce));
      lines.push(...this.temperatureLines(ce));
      if (!library) lines.push(...this.toleranceLines(ce));
      return lines;
    }
    lines.push(`Vt = ${si(ce.pnp * ce.vt, "V", true)}, β = ${ce.beta}`);
    lines.push((n ? "Ids = " : "Isd = ") + si(ce.ids, "A", true));
    lines.push("Vgs = " + si(v[0] - v[ce.pnp === -1 ? 2 : 1], "V", true));
    lines.push((n ? "Vds = " : "Vsd = ") + si(v[2] - v[1], "V", true));
    lines.push(ce.mode === 0 ? "off" : ce.mode === 1 ? "linear" : "saturation");
    lines.push("gm = " + si(ce.gm, "A/V", true));
    lines.push("P = " + si(ce.getPower(), "W", true));
    if (ce.showBulk()) lines.push("Ib = " + si(ce.getBodyCurrent(), "A", true));
    if (ce.model!.capGS > 0) lines.push("Cgs = " + si(ce.model!.capGS, "F", true));
    if (ce.model!.capGD > 0) lines.push("Cgd = " + si(ce.model!.capGD, "F", true));
    lines.push(...this.toleranceLines(ce));
    return lines;
  }


  /** Toggle a switch. Returns true if `ce` was one. */
  toggle(ce: CircuitElm | null): boolean {
    if (!(ce instanceof SwitchElm)) return false;
    ce.toggle();
    this.sim.analyzeFlag = true;
    return true;
  }

  /** World-space bounds of the drawing, or null if it's empty. */
  get bounds(): Rect | null {
    return this.boundsOf([]);
  }

  /** World-space bounds of what Fit frames: the given parts, or the whole drawing when none are given. */
  boundsOf(selected: Iterable<CircuitElm>): Rect | null {
    const r = fitBounds(this.circuit.elements, [...selected], (ce) => {
      const b = ce.boundingBox;
      // terminals too: not every part keeps its bounding box current (a rotated custom transformer)
      const p = partBox(ce);
      const x0 = Math.min(b.x, ce.point1.x, ce.point2.x, p.x), y0 = Math.min(b.y, ce.point1.y, ce.point2.y, p.y);
      const x1 = Math.max(b.x + b.width, ce.point1.x, ce.point2.x, p.x + p.width), y1 = Math.max(b.y + b.height, ce.point1.y, ce.point2.y, p.y + p.height);
      return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    });
    // room for labels, which grow when zoomed out
    return r && { x: r.x - 64, y: r.y - 64, width: r.width + 128, height: r.height + 128 };
  }
}

/** A name for a new custom model, unique enough across circuits ("custom_k3f9q2"). */
function newCustomName(): string {
  let name: string;
  do name = `custom_${Math.random().toString(36).slice(2, 8)}`;
  while (findModel(name));
  return name;
}

/** "OpAmpElm" → "op amp", with a few names spelled out. */
function readableName(ce: CircuitElm): string {
  const n = partClassName(ce).replace(/Elm$/, "");
  const special: Record<string, string> = {
    LED: "LED", SCR: "SCR", OTA: "OTA (LM13700 style)", CC2: "current conveyor", CC2Neg: "current conveyor (−)", LEDArray: "LED array",
    NDarlington: "NPN Darlington", PDarlington: "PNP Darlington", Darlington: "Darlington pair", NortonAmp: "Norton amplifier",
    ThreePhaseMotor: "3-phase motor", TransLine: "transmission line", ExtVoltage: "external voltage", VarRail: "adjustable rail",
    Switch2: "switch (SPDT)", AnalogSwitch: "analog switch (SPST)", AnalogSwitch2: "analog switch (SPDT)", CrossSwitch: "cross switch",
    LabeledNode: "labeled node", Output: "output", Probe: "voltmeter", Text: "text", Box: "box", Line: "line", Scope: "scope",
    BusLogicInput: "bus input", InstructionDisplay: "instruction display", LogicInput: "logic input", LogicOutput: "logic output",
    InvertingSchmitt: "inverting Schmitt trigger", Schmitt: "Schmitt trigger", Unijunction: "unijunction transistor",
    TunnelDiode: "tunnel diode", PolarCapacitor: "polarized capacitor", TappedTransformer: "center-tapped transformer",
    AudioOutput: "audio output", MotorProtectionSwitch: "motor protection switch", RelayCoil: "relay coil", RelayContact: "relay contact",
    RoutedWire: "wire", PushSwitch: "push switch", Inverter: "inverter", SparkGap: "spark gap",
  };
  if (special[n]) return special[n];
  if (n.endsWith("Gate")) return `${n.slice(0, -4).toUpperCase()} gate`;
  return n.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

export function designatorPrefix(ce: CircuitElm): string | null {
  if (ce instanceof WireElm || ce instanceof GroundElm || ce instanceof RailElm) return null;
  if (ce instanceof TestPointElm || ce instanceof StopTriggerElm || ce instanceof DataRecorderElm) return null;
  if (ce instanceof BatteryElm) return "BT";
  if (ce instanceof AMElm) return "V";
  if (ce instanceof OhmMeterElm || ce instanceof WattmeterElm || ce instanceof DCMotorElm) return "M";
  if (ce instanceof LDRElm) return "R";
  if (ce instanceof ThermistorNTCElm) return "RT";
  if (ce instanceof DPDTSwitchElm || ce instanceof MBBSwitchElm) return "SW";
  if (ce instanceof CustomTransformerElm) return "T";
  if (ce instanceof ComparatorElm || ce instanceof TriStateElm || ce instanceof DelayBufferElm || ce instanceof OptocouplerElm ||
    ce instanceof OpAmpRealElm) return "U";
  if (ce instanceof GraphicElm || ce instanceof LabeledNodeElm || ce instanceof OutputElm || ce instanceof ScopeElm ||
    ce instanceof LogicOutputElm || ce instanceof BusSplitterElm || ce instanceof InstructionDisplayElm) return null;
  if (ce instanceof LogicInputElm || ce instanceof BusLogicInputElm || ce instanceof CrossSwitchElm || ce instanceof Switch2Elm) return "SW";
  if (ce instanceof ProbeElm || ce instanceof AmmeterElm) return "M";
  if (ce instanceof TransistorElm || ce instanceof JfetElm || ce instanceof DarlingtonElm || ce instanceof UnijunctionElm ||
    ce instanceof SCRElm || ce instanceof TriacElm || ce instanceof TriodeElm) return "Q";
  if (ce instanceof LEDElm || ce instanceof VaractorElm || ce instanceof TunnelDiodeElm || ce instanceof DiacElm) return "D";
  if (ce instanceof TransformerElm || ce instanceof TappedTransformerElm) return "T";
  if (ce instanceof RelayElm || ce instanceof RelayCoilElm || ce instanceof RelayContactElm) return "K";
  if (ce instanceof PotElm) return "RV";
  if (ce instanceof MemristorElm) return "R";
  if (ce instanceof LampElm) return "LP";
  if (ce instanceof CrystalElm) return "Y";
  if (ce instanceof AudioOutputElm) return "LS";
  if (ce instanceof ThreePhaseMotorElm) return "M";
  if (ce instanceof MotorProtectionSwitchElm) return "Q";
  if (ce instanceof SparkGapElm) return "E";
  if (ce instanceof SweepElm) return "V";
  if (ce instanceof AnalogSwitchElm || ce instanceof OpAmpElm || ce instanceof GateElm || ce instanceof InverterElm ||
    ce instanceof OTAElm || ce instanceof NortonAmpElm) return "U";
  if (ce instanceof ResistorElm) return "R";
  if (ce instanceof CapacitorElm) return "C";
  if (ce instanceof InductorElm) return "L";
  if (ce instanceof VoltageElm) return "V";
  if (ce instanceof CurrentElm) return "I";
  if (ce instanceof SwitchElm) return "SW";
  if (ce instanceof DiodeElm) return "D";
  if (ce instanceof MosfetElm) return "Q";
  if (ce instanceof FuseElm) return "F";
  if (ce instanceof PlaceholderElm) {
    const t = ce.typeName;
    if (["d", "z", "LED"].includes(t)) return "D";
    if (["t", "f", "j"].includes(t)) return "Q";
    if (t === "404") return "F";
    if (["x", "ln", "rw", "w", "O", "p", "L", "M"].includes(t)) return null;
    return "U";
  }
  return "U";
}

function distanceToElement(px: number, py: number, ce: CircuitElm): number {
  if (isTransformer(ce)) return distanceToTransformer(px, py, ce);
  let distance = distanceToSegment(px, py, ce.point1, ce.point2);
  if (ce.getPostCount() > 2) {
    for (let i = 0; i < ce.getPostCount(); i++)
      distance = Math.min(distance, Math.hypot(px - ce.getPost(i).x, py - ce.getPost(i).y));
  }
  return distance;
}

function distanceToTransformer(px: number, py: number, ce: TransformerPart): number {
  const drawn = windingPoints(ce);
  let distance = Infinity;
  for (let i = 0; i < Math.min(ce.getPostCount(), drawn.length); i++)
    distance = Math.min(distance, distanceToSegment(px, py, ce.getPost(i), drawn[i]));
  const coils = ce instanceof CustomTransformerElm
    ? Array.from({ length: ce.coilCount }, (_, i) => [ce.coilNodes[i], ce.coilNodes[i] + 1])
    : ce instanceof TappedTransformerElm ? [[0, 1], [2, 3], [3, 4]] : [[0, 2], [1, 3]];
  for (const [a, b] of coils)
    if (drawn[a] && drawn[b]) distance = Math.min(distance, distanceToCoil(px, py, drawn[a], drawn[b], ce.ptCore));
  const core = ce.ptCore;
  const corePairs = ce instanceof TappedTransformerElm ? [[0, 1], [2, 3]] : [[0, 2], [1, 3]];
  for (const [a, b] of corePairs)
    if (core[a] && core[b]) distance = Math.min(distance, distanceToSegment(px, py, core[a], core[b]));
  return distance;
}

function distanceToCoil(px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }, core: { x: number; y: number }[]): number {
  if (!core.length) return distanceToSegment(px, py, a, b);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length === 0) return Math.hypot(px - a.x, py - a.y);
  const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
  const x = (px - a.x) * ux + (py - a.y) * uy;
  const y = -(px - a.x) * uy + (py - a.y) * ux;
  const coreY = core.reduce((sum, p) => sum + (-(p.x - a.x) * uy + (p.y - a.y) * ux), 0) / core.length;
  const loops = windingLoops(a, b), radius = length / (2 * loops);
  let distance = Infinity;
  for (let i = 0; i < loops; i++) {
    const centerX = (length * (i + 0.5)) / loops;
    const d = y * coreY >= 0
      ? Math.abs(Math.hypot(x - centerX, y) - radius)
      : Math.min(Math.hypot(x - (centerX - radius), y), Math.hypot(x - (centerX + radius), y));
    distance = Math.min(distance, d);
  }
  return distance;
}

function distanceToSegment(px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const ax = a.x, ay = a.y;
  const dx = b.x - ax, dy = b.y - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distanceToBox(px: number, py: number, b: { x: number; y: number; width: number; height: number }): number {
  const dx = Math.max(b.x - px, 0, px - (b.x + b.width));
  const dy = Math.max(b.y - py, 0, py - (b.y + b.height));
  return Math.hypot(dx, dy);
}

/** The box around a part's points and pins. */
export function partBox(ce: CircuitElm): { x: number; y: number; width: number; height: number } {
  const pts = [ce.point1, ce.point2, ...Array.from({ length: ce.getPostCount() }, (_, i) => ce.getPost(i))];
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function unitForEditName(name: string): string {
  if (name.includes("(ohms)") || name.includes("Resistance")) return "Ω";
  if (name.includes("(F)") || name.startsWith("Capacitance")) return "F";
  if (name.includes("(H)") || name.startsWith("Inductance")) return "H";
  if (name.includes("(Hz)")) return "Hz";
  if (name.includes("(A)") || name.startsWith("Current")) return "A";
  if (name.includes("(s)")) return "s";
  if (name.includes("degrees")) return "°";
  if (name.includes("Voltage") || name.includes("(V)")) return "V";
  if (name === "I2t") return "A²s";
  return "";
}

/** A probe's reading as its meter is set (CircuitJS's ProbeElm.draw). */
export function probeReading(e: ProbeElm): string {
  const M = ProbeElm.Meter;
  switch (e.meter) {
    case M.rms: return `${si(e.rmsV, "V")} rms`;
    case M.average: return `${si(e.avgV, "V")} avg`;
    case M.max: return `${si(e.lastMaxV, "V")} pk`;
    case M.min: return `${si(e.lastMinV, "V")} min`;
    case M.p2p: return `${si(e.lastMaxV - e.lastMinV, "V")} p-p`;
    case M.binary: return String(e.binaryLevel);
    case M.frequency: return si(e.frequency, "Hz");
    case M.pulseWidth: return si(e.pulseWidth, "s");
    case M.dutyCycle: return `${Math.round(e.dutyCycle * 100)}%`;
    default: return si(e.volts[0] - e.volts[1], "V");
  }
}
