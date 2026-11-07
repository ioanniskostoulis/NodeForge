// Power and efficiency: each part's energy integrated over the run, averaged over the last whole
// cycles of the circuit's switching (or since the start when nothing repeats). MOSFETs' loss is
// split into conduction and switching; input is what the sources deliver, output what the parts
// marked as loads take (efficiency = output / input). Reading it never changes the simulation.
import { CapacitorElm, CurrentElm, type CircuitElm, DiodeElm, InductorElm, GroundElm, MosfetElm, RailElm, type Simulator, TransistorElm, VoltageElm, WireElm } from "../engine";

/** Cycles averaged over, at most (the latest ones). */
const MAX_CYCLES = 20;
/** Cycle starts kept per candidate. */
const KEEP = MAX_CYCLES + 2;
/**
 * A MOSFET step counts as switching while both its drain voltage and its current are above this
 * fraction of their peaks so far (a transition); otherwise as conduction (on, its body diode, or
 * off-state leakage).
 */
const SWITCHING = 0.1;

export const isSource = (e: CircuitElm): boolean => e instanceof VoltageElm || e instanceof CurrentElm || e instanceof RailElm;
/** Parts that store energy (their average is what they gained, not a loss; about 0 in steady state). */
export const storesEnergy = (e: CircuitElm): boolean => e instanceof CapacitorElm || e instanceof InductorElm;

/**
 * A part whose voltage marks the cycles: a switch or rectifier, its swing crossing its middle. The
 * middle is the previous cycle's (a start-up overshoot would put the run's middle out of reach),
 * the range so far before the first cycles, or since the last start when a cycle runs long.
 * Hysteresis and a dead time after each start keep ringing on an edge from counting.
 */
class Marker {
  /** The whole run's range (its widest swing picks the marker). */
  min = Infinity;
  max = -Infinity;
  /** Since the last cycle start, and over the previous cycle. */
  cycMin = Infinity;
  cycMax = -Infinity;
  refMin = NaN;
  refMax = NaN;
  armed = false;
  /** Cycle starts: time and every part's energy then. */
  starts: { t: number; energy: Float64Array; switching: Float64Array }[] = [];
  constructor(readonly elm: CircuitElm) {}
}

export interface PowerLine {
  elm: CircuitElm;
  /** Average power (W): taken by the part (losses, loads), or delivered (sources). */
  power: number;
  /** A MOSFET's switching part of it (W). */
  switching?: number;
}

export interface PowerReport {
  /** The averaging window: whole cycles of `marker`, or the run so far. */
  seconds: number;
  cycles: number;
  marker: CircuitElm | null;
  /** Sources, power delivered (W). */
  sources: PowerLine[];
  /** Everything else, power taken (W), largest first (capacitors and inductors: what they stored). */
  parts: PowerLine[];
  input: number;
  /** The marked loads' power, or null with none marked. */
  output: number | null;
}

export class PowerMeter {
  private elms: CircuitElm[] = [];
  private energy = new Float64Array(0);
  private switching = new Float64Array(0);
  private last = new Float64Array(0);
  private peakV = new Float64Array(0);
  private peakI = new Float64Array(0);
  private markers: Marker[] = [];
  private t0 = 0;
  private t = 0;
  private started = false;
  /** The circuit's part count it started with. */
  private count = 0;

  /** Start over (a reset, a new circuit, an edit). */
  reset(): void {
    this.started = false;
  }

  private begin(sim: Simulator, elms: CircuitElm[]): void {
    this.count = elms.length;
    this.elms = elms.filter((e) => !(e instanceof WireElm || e instanceof GroundElm));
    const n = this.elms.length;
    this.energy = new Float64Array(n);
    this.switching = new Float64Array(n);
    this.last = new Float64Array(n);
    this.peakV = new Float64Array(n);
    this.peakI = new Float64Array(n);
    this.elms.forEach((e, i) => (this.last[i] = this.powerOf(e)));
    this.markers = this.elms.filter((e) => e instanceof MosfetElm || e instanceof DiodeElm || e instanceof TransistorElm).map((e) => new Marker(e));
    this.t0 = this.t = sim.t;
    this.started = true;
  }

  /** Power taken by a part (W); delivered, for a source. */
  private powerOf(e: CircuitElm): number {
    const p = e.getPower();
    return Number.isFinite(p) ? (isSource(e) ? -p : p) : 0;
  }

  /** After every timestep. */
  sample(sim: Simulator, elms: CircuitElm[]): void {
    // a reset (time went back) or parts added or removed: start over
    if (!this.started || sim.t < this.t || elms.length !== this.count) return this.begin(sim, elms);
    const dt = sim.t - this.t;
    this.t = sim.t;
    for (let i = 0; i < this.elms.length; i++) {
      const e = this.elms[i];
      const p = this.powerOf(e);
      const de = 0.5 * (p + this.last[i]) * dt;
      this.energy[i] += de;
      this.last[i] = p;
      if (e instanceof MosfetElm) {
        const v = Math.abs(e.getVoltageDiff()), c = Math.abs(e.getCurrent());
        if (v > this.peakV[i]) this.peakV[i] = v;
        if (c > this.peakI[i]) this.peakI[i] = c;
        if (v > SWITCHING * this.peakV[i] && c > SWITCHING * this.peakI[i]) this.switching[i] += de;
      }
    }
    for (const m of this.markers) {
      const v = m.elm.getVoltageDiff();
      if (!Number.isFinite(v)) continue;
      if (v < m.min) m.min = v;
      if (v > m.max) m.max = v;
      if (v < m.cycMin) m.cycMin = v;
      if (v > m.cycMax) m.cycMax = v;
      const n = m.starts.length;
      const period = n >= 2 ? m.starts[n - 1].t - m.starts[n - 2].t : 0;
      const [lo, hi] = !(m.refMax > m.refMin) ? [m.min, m.max]
        : period > 0 && sim.t - m.starts[n - 1].t > 4 * period ? [m.cycMin, m.cycMax] : [m.refMin, m.refMax];
      // (20% hysteresis, and no new start within 30% of a period: ringing on an edge isn't a cycle)
      const mid = 0.5 * (lo + hi), hyst = 0.2 * (hi - lo);
      if (v < mid - hyst && !(n && sim.t - m.starts[n - 1].t < 0.3 * period)) m.armed = true;
      else if (m.armed && v > mid) {
        m.armed = false;
        m.starts.push({ t: sim.t, energy: this.energy.slice(), switching: this.switching.slice() });
        if (m.starts.length > KEEP) m.starts.shift();
        if (n >= 1) {
          m.refMin = m.cycMin;
          m.refMax = m.cycMax;
        }
        m.cycMin = m.cycMax = v;
      }
    }
  }

  /** The averages now: over the latest whole cycles of the widest-swinging marker, else since the start. */
  report(): PowerReport | null {
    if (!this.started || this.t <= this.t0) return null;
    const marker = this.markers
      .filter((m) => m.starts.length >= 2)
      .sort((a, b) => b.max - b.min - (a.max - a.min))[0] ?? null;
    let seconds: number, cycles: number, e0: Float64Array, s0: Float64Array, e1: Float64Array, s1: Float64Array;
    if (marker) {
      const first = marker.starts[Math.max(0, marker.starts.length - 1 - MAX_CYCLES)], last = marker.starts[marker.starts.length - 1];
      cycles = marker.starts.length - 1 - marker.starts.indexOf(first);
      seconds = last.t - first.t;
      [e0, s0, e1, s1] = [first.energy, first.switching, last.energy, last.switching];
    } else {
      cycles = 0;
      seconds = this.t - this.t0;
      [e0, s0, e1, s1] = [new Float64Array(this.elms.length), new Float64Array(this.elms.length), this.energy, this.switching];
    }
    if (!(seconds > 0)) return null;
    const sources: PowerLine[] = [], parts: PowerLine[] = [];
    let output = 0, loads = 0;
    this.elms.forEach((elm, i) => {
      const line: PowerLine = { elm, power: (e1[i] - e0[i]) / seconds };
      if (elm instanceof MosfetElm) line.switching = (s1[i] - s0[i]) / seconds;
      if (isSource(elm)) sources.push(line);
      else parts.push(line);
      if (elm.powerLoad) {
        output += line.power;
        loads++;
      }
    });
    parts.sort((a, b) => b.power - a.power);
    const input = sources.reduce((s, x) => s + x.power, 0);
    return { seconds, cycles, marker: marker?.elm ?? null, sources, parts, input, output: loads ? output : null };
  }

  /** One part's average power (W; a source's delivered), as the report has it (the readout flips a source's to P's sign). */
  average(elm: CircuitElm): number | null {
    const r = this.report();
    return r ? ([...r.sources, ...r.parts].find((x) => x.elm === elm)?.power ?? null) : null;
  }
}
