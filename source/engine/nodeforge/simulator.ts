// The NodeForge engine: CircuitJS's simulator (source/engine/circuitjs) with NodeForge's own solving
// on top. With `accurate` off it is exactly CircuitJS.
//  - Error-controlled time steps (trapezoidal truncation error per reactive state, rejected steps
//    undone from a state snapshot), sources evaluated at the end of each step, breakpoints.
//  - SPICE-style Newton: a node-voltage convergence test, iteration limits escalated per step.
//  - Sparse LU with the pivot order reused (sparse.ts).
//  - DC operating point: Newton, gmin stepping, source stepping; inductors as exact shorts.
//  - Diagnostics: which parts set the step size, ring, or keep Newton from converging.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { CircuitElm } from "../circuitjs/core/elm";
import type { CircuitMatrix, CircuitNode, MatrixSolver } from "../circuitjs/core/nodes";
import { Simulator } from "../circuitjs/core/simulator";
import { CapacitorElm, InductorElm } from "../circuitjs/elements/reactive";
import { T_DEFAULT } from "./devices/device";
import { nextBreakpoint, reactiveStates } from "./parts";
import { type SavedState, StatePlan } from "./snapshot";
import { SparseLU } from "./sparse";

/** NodeForge solver: what one part made the solver do (see Simulator.diagnostics). */
export interface PartStats {
  /** Accepted steps whose length its error estimate decided (it set the pace). */
  limited: number;
  /** Steps taken back because its error was over tolerance. */
  rejected: number;
  /** Steps it limited while its value alternated step to step (numerical ringing). */
  ringing: number;
  /** Newton attempts that ran out of iterations with it still unconverged. */
  blocked: number;
  /** Steps accepted on the elements' own test with it still moving. */
  loose: number;
}

/** NodeForge solver: how hard the run was, and which parts made it so (for the background analysis). */
export interface SolverDiagnostics {
  /** Accepted steps, and the circuit time they covered. */
  steps: number;
  span: number;
  /** Steps taken back (error over tolerance or no convergence). */
  rejected: number;
  /** Shortest step accepted. */
  minStep: number;
  /** By simulated element (composites' parts are separate). */
  parts: Map<CircuitElm, PartStats>;
}

const emptyDiagnostics = (): SolverDiagnostics => ({ steps: 0, span: 0, rejected: 0, minStep: Infinity, parts: new Map() });

/** The first step of a run, and the first after a breakpoint, as a fraction of the step before. */
const FIRST_STEP = 10000;
const FIRST_STEP_AFTER_BREAK = 100;

export class AccurateSimulator extends Simulator {
  /** Factor matrices sparsely (off: dense LU, as CircuitJS mode; for comparison). */
  sparse = true;
  /** NodeForge solver: allowed relative error per step (SPICE's reltol; the app's default too). */
  relTol = 1e-5;
  /** The circuit's temperature (K) for its SPICE devices: 25 °C unless the circuit sets one. */
  temperature = T_DEFAULT;
  /** Self-heating: devices whose models give a thermal resistance heat up (off unless the circuit sets it). */
  selfHeating = false;
  /**
   * Self-heating MOSFETs' junctions start at 0 °C, not the ambient, as ngspice's VDMOS does in a
   * `uic` run (its thermal state starts at 0): only for comparisons with ngspice (`nfsim accuracy`).
   */
  coldThermalStart = false;
  /**
   * The start-up ramp (s; 0: off): every independent source (sourceScale) rises linearly from 0
   * at time 0 to its value at this time, as LTspice's `startup`, in a run from rest; a run from
   * an operating point starts with the sources at their values.
   */
  startupRamp = 0;
  /** Did this run start from an operating point (no start-up ramp)? Cleared by a reset. */
  fromOperatingPoint = false;

  /** Take a circuit's settings: temperature (°C), self-heating and the start-up ramp. */
  useCircuitOptions(o: { temperature: number; selfHeating: boolean; startupRamp?: number }): void {
    this.temperature = o.temperature + 273.15;
    this.selfHeating = o.selfHeating;
    this.startupRamp = o.startupRamp ?? 0;
  }
  /** NodeForge solver: how far a step's error estimate may exceed the tolerance (SPICE's trtol). */
  trTol = 7;
  /**
   * NodeForge solver state: the step to try next, recent solutions for error estimates, and for the
   * predictor the step before and each nonlinear matrix's node voltages before it.
   */
  private stepState: {
    h: number;
    history: { t: number; x: Float64Array }[];
    loose?: boolean;
    prev?: { h: number; v: Map<CircuitMatrix, Float64Array> };
  } = { h: 0, history: [] };
  /** NodeForge solver: start Newton from extrapolated node voltages (off: from the last solution). */
  predictor = true;

  /** Set each nonlinear matrix's node voltages to their extrapolation over a step h. */
  private predict(h: number, prev: { h: number; v: Map<CircuitMatrix, Float64Array> }): void {
    if (!(prev.h > 0)) return;
    const r = h / prev.h;
    for (const m of this.matrices) {
      const before = prev.v.get(m);
      if (!m.nonLinear || !before || before.length !== m.nodeCount) continue;
      const now = m.lastNodeVoltages, nv = m.nodeVoltages;
      for (let i = 0; i < nv.length; i++) nv[i] = now[i] + r * (now[i] - before[i]);
      this.setNodeVoltages(m, nv);
    }
  }
  /** NodeForge solver: which element fields to save to take a step back (worked out per circuit). */
  private statePlan: { elms: CircuitElm[]; length: number; plan: StatePlan; saved: SavedState | null } | null = null;


  /**
   * Integration order of this step: 1 (backward Euler) for the first two steps of a run and after a
   * breakpoint, as SPICE does, so a jump doesn't leave the trapezoidal rule ringing (devices, and
   * CircuitJS's capacitors and inductors on this engine); 2 otherwise (devices: BDF2; CircuitJS's
   * parts: trapezoidal). It stays 2 under the CircuitJS solver.
   */
  integrationOrder = 2;

  override analyzeCircuit(): void {
    // diodes and MOSFETs: a SPICE device under this engine (or for a library model), CircuitJS's
    // own code under the CircuitJS solver; decided before the nodes are counted
    // (a subcircuit's too, before it counts its children's inner nodes)
    const prepare = (list: CircuitElm[]) => {
      for (const ce of list) {
        (ce as { prepareDevice?: (accurate: boolean) => void }).prepareDevice?.(this.accurate);
        const children = ce.getChildElmList();
        if (children) {
          for (const child of children) child.sim = this;
          prepare(children);
        }
      }
    };
    prepare(this.circuitElements);
    super.analyzeCircuit();
    // the elements may have changed: work out what to snapshot again, and start the error history
    // over (an edit is a jump: the next step is first order, then the estimate builds up again)
    this.statePlan = null;
    this.stepState.history = [];
  }

  override resetTime(): void {
    super.resetTime();
    this.stepState = { h: 0, history: [] };
    this.looseSteps = 0;
    this.diagnostics = emptyDiagnostics();
  }

  protected override run(didAnalyze: boolean, shouldStop: (completed: number) => boolean): void {
    if (this.accurate) this.runCircuitAccurate(shouldStop);
    else {
      // (the start-up ramp is the NodeForge solver's: a switch mid-ramp leaves the sources whole)
      if (this.sourceScale !== 1) {
        this.sourceScale = 1;
        this.analyzeFlag = true;
      }
      super.run(didAnalyze, shouldStop);
    }
  }

  /** Sparse LU, keeping the pivot order from one factorization to the next. */
  protected override matrixSolver(m: CircuitMatrix): MatrixSolver | null {
    return this.accurate && this.sparse ? (m.solver ?? new SparseLU()) : null;
  }

  // The elements accept changes under 10 mV; the node test also requires each nonlinear
  // matrix to settle within relTol·|V| + vnTol.

  protected override beforeSolve(m: CircuitMatrix): void {
    if (!this.accurate) return;
    // the iterate before this solve (for the node test, and to tell which nodes still move)
    const prev = this.lastIterate.get(m);
    if (prev && prev.length === m.nodeVoltages.length) prev.set(m.nodeVoltages);
    else this.lastIterate.set(m, Float64Array.from(m.nodeVoltages));
  }

  protected override movedInSolve(m: CircuitMatrix): boolean {
    return this.accurate && this.newtonNodeTest && this.nodesMoved(m);
  }

  protected override stillMoving(subiter: number, movedNow: boolean): boolean {
    // the first solve has nothing of this attempt to compare with (the previous iterate may be a
    // failed attempt's), so convergence takes two solves that agree
    return this.accurate && this.newtonNodeTest && (subiter === 0 || movedNow);
  }

  /** NodeForge solver: the node-voltage Newton test applies (off only for the last resort). */
  private newtonNodeTest = true;
  /** NodeForge solver: is this the last resort, the step accepted on the elements' own test? */
  get lastResort(): boolean {
    return this.accurate && !this.newtonNodeTest;
  }
  /** NodeForge solver: steps accepted without full convergence (on the elements' own test). */
  looseSteps = 0;
  /** NodeForge solver: what made the run hard, by part (since the last reset). */
  diagnostics = emptyDiagnostics();

  private partStats(ce: CircuitElm): PartStats {
    let p = this.diagnostics.parts.get(ce);
    if (!p) this.diagnostics.parts.set(ce, (p = { limited: 0, rejected: 0, ringing: 0, blocked: 0, loose: 0 }));
    return p;
  }

  /**
   * The elements keeping Newton from converging: one more pass, asking each whether it would still
   * move. (It stamps the matrix and updates their iteration state, so call it only on a step that
   * is about to be retried from a saved state, or accepted as it is.)
   */
  private newtonBlockers(): CircuitElm[] {
    const out: CircuitElm[] = [];
    // nonlinear parts at nodes that moved more than the Newton tolerance in the last solve
    const moving = new Set<CircuitElm>();
    for (const m of this.matrices) {
      const prev = this.lastIterate.get(m), now = m.nodeVoltages;
      if (!m.nonLinear || !prev || prev.length !== now.length) continue;
      for (const cn of m.nodeList) {
        const a = prev[cn.row - 1], b = now[cn.row - 1];
        if (Math.abs(a - b) <= this.relTol * Math.max(Math.abs(a), Math.abs(b)) + this.vnTol) continue;
        for (const l of cn.links) if (l.elm.nonLinear()) moving.add(l.elm);
      }
    }
    for (const m of this.matrices) {
      m.rightSide.set(m.origRightSide);
      if (m.nonLinear) m.matrix.set(m.origMatrix);
    }
    for (const ce of this.elmArr) {
      this.converged = true;
      ce.doStep();
      if (!this.converged) out.push(ce);
    }
    this.converged = false;
    // the elements' own tests all passed: it's the node test that failed
    return out.length ? out : [...moving];
  }
  /** NodeForge solver: absolute part of the Newton convergence test on node voltages (V). */
  vnTol = 1e-6;
  /** NodeForge solver: each nonlinear matrix's node voltages before the latest Newton solve. */
  private lastIterate = new Map<CircuitMatrix, Float64Array>();

  /** Did any node of this matrix move more than the Newton tolerance in the last solve? */
  private nodesMoved(m: CircuitMatrix): boolean {
    const prev = this.lastIterate.get(m)!, now = m.nodeVoltages;
    for (let i = 0; i < now.length; i++) {
      const a = prev[i], b = now[i];
      if (Math.abs(a - b) > this.relTol * Math.max(Math.abs(a), Math.abs(b)) + this.vnTol) return true;
    }
    return false;
  }

  /**
   * DC operating point help (gmin stepping): a conductance from every node to ground, added to
   * the matrices each iteration (they're all solved as nonlinear while it's on).
   */
  gmin = 0;

  protected override stampExtra(): void {
    if (this.gmin > 0) this.stampGmin();
  }

  private stampGmin(): void {
    for (const m of this.matrices) {
      for (let i = 0; i < m.nodeCount; i++) {
        const k = i * m.size + i;
        m.matrix[k] += this.gmin;
        if (m.solver !== null && m.solver.slotOf[k] < 0) m.solver.added.push(k);
      }
    }
  }

  /** While finding the DC operating point: the inductors that are exact shorts. */
  private dcExactShorts = new Set<CircuitElm>();

  /** Is this inductor an exact short (a 0 V source) at DC, rather than a tiny resistance? */
  override isExactDcShort(ce: CircuitElm): boolean {
    return this.dcShortInductors && this.dcExactShorts.has(ce);
  }

  /**
   * At DC, inductors are exact shorts (SPICE's model; a tiny resistance would be far stiffer than
   * anything else and can make the matrix numerically singular). But shorts in a loop (parallel
   * inductors) leave the loop's current undetermined: the ones that close a loop stay tiny
   * resistances.
   */
  protected override beforeVoltageSources(): void {
    this.dcExactShorts.clear();
    if (!this.dcShortInductors) return;
    const parent = new Map<CircuitNode, CircuitNode>();
    const find = (n: CircuitNode): CircuitNode => {
      let r = n;
      while (parent.has(r)) r = parent.get(r)!;
      if (r !== n) parent.set(n, r);
      return r;
    };
    for (const ce of this.elmList) {
      if (!(ce instanceof InductorElm)) continue;
      const a = ce.getNode(0), b = ce.getNode(1);
      if (!a || !b) continue;
      const ra = find(a), rb = find(b);
      if (ra === rb) continue;
      parent.set(ra, rb);
      this.dcExactShorts.add(ce);
    }
  }

  /**
   * Small-signal (AC) analysis, SPICE's .ac: the circuit linearized at its operating point and
   * driven by a unit AC value of one source (`excite` stamps it on a right side: 1 V on a voltage
   * source's row, 1 A into a current source's nodes; every other source is zero for AC), solved at
   * each frequency. Returns each node's complex voltage per frequency, or null when no operating
   * point was found. The circuit is left at the operating point; run it on a copy.
   *
   * The linearization comes from the transient stamps themselves rather than a model of each
   * device: stamped for one backward-Euler step of size h at the operating point, the matrix is
   * A(h) = G + C/h + h·Γ (conductances, capacitances: a capacitor's and every device charge's C/h,
   * and an inductor's companion h/L), so three steps give G, C and Γ entry by entry, and the AC
   * matrix is Y(jω) = G + jωC + Γ/(jω).
   */
  acAnalysis(freqs: number[], excite: (m: CircuitMatrix, rhs: Float64Array) => void): Map<CircuitNode, { re: number[]; im: number[] }> | null {
    if (!this.solveOperatingPoint()) return null;
    // the transient circuit again (the operating point's shorted inductors were rows of their own)
    // (analyzing and pre-stamping set the step: each h is set after it)
    if (this.analyzeFlag) {
      this.analyzeCircuit();
      this.analyzeFlag = false;
      this.preStampAndStampCircuit();
    }
    const hs = [1e-3, 2e-3, 4e-3];
    const stamped = hs.map((h) => {
      this.timeStep = h;
      this.integrationOrder = 1;
      this.stampCircuit();
      for (const m of this.matrices) {
        m.matrix.fill(0);
        if (m.solver?.covers) m.solver.copyPattern(m.origMatrix, m.matrix);
        else m.matrix.set(m.origMatrix);
      }
      // the devices' loads at the operating point (their voltages are its, so nothing is limited)
      for (const ce of this.elmArr) ce.doStep();
      return this.matrices.map((m) => Float64Array.from(m.matrix));
    });
    // per entry: A_i = G + C/h_i + Γ·h_i, solved for (G, C, Γ) with the same 3×3 for every entry
    const rows = hs.map((h) => [1, 1 / h, h]);
    const inv = invert3(rows);
    const out = new Map<CircuitNode, { re: number[]; im: number[] }>();
    this.matrices.forEach((m, mi) => {
      const n = m.size, nn = n * n;
      const G = new Float64Array(nn), C = new Float64Array(nn), Gam = new Float64Array(nn);
      for (let k = 0; k < nn; k++) {
        const a = [stamped[0][mi][k], stamped[1][mi][k], stamped[2][mi][k]];
        G[k] = inv[0][0] * a[0] + inv[0][1] * a[1] + inv[0][2] * a[2];
        C[k] = inv[1][0] * a[0] + inv[1][1] * a[1] + inv[1][2] * a[2];
        Gam[k] = inv[2][0] * a[0] + inv[2][1] * a[1] + inv[2][2] * a[2];
      }
      const rhs = new Float64Array(n);
      excite(m, rhs);
      const results = m.nodeList.map(() => ({ re: [] as number[], im: [] as number[] }));
      for (const f of freqs) {
        const w = 2 * Math.PI * f;
        const re = Float64Array.from(G), im = new Float64Array(nn);
        for (let k = 0; k < nn; k++) im[k] = w * C[k] - Gam[k] / w;
        const x = complexSolve(n, re, im, rhs);
        m.nodeList.forEach((node, j) => {
          results[j].re.push(x ? x.re[node.row - 1] : NaN);
          results[j].im.push(x ? x.im[node.row - 1] : NaN);
        });
      }
      m.nodeList.forEach((node, j) => out.set(node, results[j]));
    });
    return out;
  }

  /**
   * DC sweep (SPICE's .dc): for each value in turn, `set` it (a source's value) and find the
   * operating point, each starting from the last one's solution (continuation), then `read` the
   * circuit. Returns the values whose operating point wasn't found (the circuit is then left at the
   * last one found).
   */
  dcSweep(values: number[], set: (v: number) => void, read: (v: number) => void): number[] {
    const failed: number[] = [];
    for (const v of values) {
      set(v);
      if (this.solveOperatingPoint()) read(v);
      else failed.push(v);
    }
    return failed;
  }

  /**
   * Find the DC operating point: capacitors open, inductors shorted, sources at their DC value
   * (a wave's offset). Newton from the present state first, then from zero; if that doesn't
   * converge, gmin stepping (a conductance from every node to ground, shrunk from 10 mS to nothing),
   * then source stepping (all sources ramped up from zero), as SPICE does. On success the circuit is left at
   * the operating point (capacitor voltages, inductor currents set) and the method used is
   * returned; on failure the circuit is unchanged and null is returned.
   */
  solveOperatingPoint(): "newton" | "gmin stepping" | "source stepping" | null {
    if (this.circuitElements.length === 0) return null;
    // the state to come back to on failure, under the transient models
    if (this.analyzeFlag) this.analyzeCircuit();
    this.analyzeFlag = false;
    this.preStampAndStampCircuit();
    if (this.stopMessage !== null) return null;
    const startPlan = new StatePlan(this.elmArr);
    const start = startPlan.save();
    const restoreStart = () => {
      startPlan.restore(start);
      this.dcAnalysisFlag = this.dcShortInductors = false;
      this.gmin = 0;
      this.sourceScale = 1;
      this.stopMessage = null;
      this.analyzeFlag = true;
    };

    this.dcAnalysisFlag = this.dcShortInductors = true;
    const restampOperatingPoint = (): boolean => {
      this.stopMessage = null;
      this.analyzeCircuit();
      this.preStampAndStampCircuit();
      if (this.stopMessage !== null) return false;
      // every matrix is refactored each iteration, so gmin can be added to it
      for (const m of this.matrices) m.nonLinear = true;
      return true;
    };
    const solveAtCurrentSettings = (): boolean => {
      for (const ce of this.elmArr) ce.startIteration();
      const it = this.iterate(1000);
      const ok = it >= 0 && it < 1000 && this.stopMessage === null;
      if (this.log) {
        // which elements keep the iteration from converging
        let blockers = "";
        if (!ok && it >= 0) {
          const names = new Set<string>();
          for (const ce of this.elmArr) {
            this.converged = true;
            ce.doStep();
            if (!this.converged) names.add(ce.constructor.name.replace(/^_/, ""));
          }
          blockers = ` (not converging: ${[...names].join(", ") || "node voltages"})`;
        }
        this.log(`operating point: gmin ${this.gmin}, sources ${this.sourceScale}: ${ok ? `converged in ${it}` : it < 0 ? `stopped (${this.stopMessage})` : "no convergence"}${blockers}`);
      }
      if (!ok) this.stopMessage = null;
      return ok;
    };
    if (!restampOperatingPoint()) {
      restoreStart();
      return null;
    }
    const plan = new StatePlan(this.elmArr);
    const initial = plan.save();
    /**
     * Newton from the present state, then from all node voltages zero, where SPICE starts: a circuit
     * whose present state is far from its operating point (an op-amp held at a rail by positive
     * feedback, its slope zero there) often converges from zero at once.
     */
    const tryNewton = (): boolean => {
      plan.restore(initial);
      if (solveAtCurrentSettings()) return true;
      plan.restore(initial);
      for (const m of this.matrices) this.setNodeVoltages(m, new Float64Array(m.nodeVoltages.length));
      return solveAtCurrentSettings();
    };
    /** Gmin stepping, then source stepping. */
    const stepping = (): "gmin stepping" | "source stepping" | null => {
      let method: "gmin stepping" | "source stepping" | null = null;
      /**
       * Dynamic gmin stepping: shrink gmin from `from` towards zero, each solution starting the next;
       * when a step fails, go back to the last good solution and shrink by less.
       */
      const gminStepping = (from: number): boolean => {
        let g = from, factor = 10, gGood = -1;
        let good = plan.save();
        for (let tries = 0; tries < 200; tries++) {
          this.gmin = g;
          if (solveAtCurrentSettings()) {
            good = plan.save(good);
            gGood = g;
            if (g === 0) return true;
            factor = Math.min(factor * 2, 10);
            g = g / factor < 1e-13 ? 0 : g / factor;
          } else {
            // even the largest gmin failed, or the reduction can't get any gentler: give up
            if (gGood < 0) return false;
            plan.restore(good);
            factor = Math.sqrt(factor);
            if (factor < 1.001) return false;
            g = gGood / factor;
          }
        }
        return false;
      };
      plan.restore(initial);
      if (gminStepping(1e-2)) method = "gmin stepping";
      this.gmin = 0;
      if (!method) {
        // source stepping, with a little gmin held on while the sources ramp up (SPICE's gmin + source
        // stepping), then gmin stepped away
        plan.restore(initial);
        let scale = 0, step = 0.1, ok = true;
        let good = plan.save();
        this.gmin = 1e-6;
        while (scale < 1 && ok) {
          const next = Math.min(1, scale + step);
          this.sourceScale = next;
          if (!restampOperatingPoint()) break;
          if (solveAtCurrentSettings()) {
            scale = next;
            good = plan.save(good);
            step = Math.min(step * 1.5, 0.25);
          } else {
            plan.restore(good);
            step /= 2;
            ok = step > 1e-5;
          }
        }
        this.sourceScale = 1;
        if (scale >= 1 && gminStepping(1e-6)) method = "source stepping";
        this.gmin = 0;
        if (!method) restampOperatingPoint();
      }
      return method;
    };
    const method = tryNewton() ? "newton" : stepping();
    if (!method) {
      restoreStart();
      return null;
    }
    // keep the solution: capacitor voltages and inductor currents become the state to run from
    for (const ce of this.elmArr) ce.stepFinished();
    // An oscillator's operating point is an unstable equilibrium (a relaxation oscillator's Schmitt
    // trigger at its midpoint), and a symmetric circuit finds it exactly: a run from it would never
    // leave it (SPICE's doesn't either, unless the user kicks it); a real circuit's noise does. Each
    // capacitor gets a fixed few nanovolts, of either sign, far below the solver's voltage
    // tolerance (1 µV): a stable circuit doesn't notice, an unstable one starts.
    let k = 0;
    for (const ce of this.elmArr) {
      if (!(ce instanceof CapacitorElm)) continue;
      k++;
      ce.voltdiff += (k % 2 ? 1 : -1) * (1 + (k % 7)) * 1e-9;
    }
    this.dcAnalysisFlag = this.dcShortInductors = false;
    this.analyzeFlag = true;
    this.stepState = { h: 0, history: [] };
    this.fromOperatingPoint = true;
    return method;
  }

  override reset(): void {
    this.fromOperatingPoint = false;
    super.reset();
  }

  /** The start-up ramp's scale at time t, or null when there's no ramp (off, past it, or from an operating point). */
  private rampScale(t: number): number | null {
    return this.startupRamp > 0 && !this.fromOperatingPoint && t < this.startupRamp * (1 + 1e-12) ? Math.min(1, Math.max(0, t / this.startupRamp)) : null;
  }

  /**
   * The NodeForge solver: error-controlled variable time steps instead of CircuitJS's fixed one.
   *
   *  - Sources are evaluated at the end of each step, where the solution is (CircuitJS evaluates
   *    them at the start, so driven waveforms lag a step).
   *  - Steps land exactly on breakpoints (square edges, ramp corners), so edges aren't late, and
   *    restart short after one.
   *  - Each step's local truncation error is estimated for every capacitor voltage and inductor
   *    current (trapezoidal rule: h^3/12 times the third derivative, taken from a third divided
   *    difference of the last four solutions, as SPICE does). A step over tolerance is undone and
   *    retried shorter; calm stretches get longer steps, up to maxTimeStep.
   */
  private runCircuitAccurate(shouldStop: (completed: number) => boolean): void {
    if (this.stopMessage !== null || this.elmList.length === 0) return;
    const countAtStart = this.timeStepCount;
    const hMax = this.maxTimeStep;
    const hMin = Math.min(this.minTimeStep, hMax * 1e-4);
    // Newton iterations per attempt, escalating when a step doesn't converge: first more
    // iterations at the same step (CircuitJS's diode and MOSFET models limit how far a junction
    // voltage may move per iteration, so switching takes many; a shorter step doesn't help and,
    // taken far enough, makes the matrix ill-conditioned), then a shorter step, and at the smallest
    // step one long last try. Only if that fails too is the step accepted on the elements' own
    // test, as CircuitJS would (they turn lenient after many iterations); such steps are counted
    // in looseSteps so the result can be flagged (e.g. a latch flipping with no node capacitance).
    const iterLimits = [100, 1000, 5000, 5000];
    let rescue = 0, cuts = 0;
    const stepState = this.stepState;
    // a run starts with a short step (the first is taken before any error estimate exists)
    let h = stepState.h > 0 ? Math.min(stepState.h, hMax) : Math.max(hMin, hMax / FIRST_STEP);
    let force = false;
    const values: number[] = [], abstol: number[] = [];
    /** Which element each reactive state belongs to, and whether a SPICE device integrates it (BDF2). */
    const owners: CircuitElm[] = [];
    const device: boolean[] = [];
    const collectReactiveStates = () => {
      values.length = abstol.length = 0;
      for (const ce of this.elmArr) {
        const n0 = values.length;
        reactiveStates(ce, values, abstol);
        const dev = (ce as { device?: unknown }).device != null;
        for (let q = n0; q < values.length; q++) {
          owners[q] = ce;
          device[q] = dev;
        }
      }
    };
    // the state the run starts from: the first point of the error history
    if (stepState.history.length === 0) {
      collectReactiveStates();
      stepState.history.push({ t: this.t, x: Float64Array.from(values) });
    }
    const diag = this.diagnostics;

    for (;;) {
      // land on the next breakpoint; split the stretch before it evenly rather than leave a sliver
      let bp = Infinity;
      for (const ce of this.elmArr) bp = Math.min(bp, nextBreakpoint(ce, this.t + hMin * 1e-3));
      // the start-up ramp's end is a corner
      if (this.rampScale(this.t) !== null && this.startupRamp > this.t + hMin * 1e-3) bp = Math.min(bp, this.startupRamp);
      const toBreak = bp - this.t;
      let atBreak = false;
      if (toBreak <= h * (1 + 1e-9)) {
        h = toBreak;
        atBreak = true;
      } else if (toBreak < h * 1.5) h = toBreak / 2;

      let sp = this.statePlan;
      if (!sp || sp.elms !== this.elmArr || sp.length !== this.elmArr.length) {
        sp = this.statePlan = { elms: this.elmArr, length: this.elmArr.length, plan: new StatePlan(this.elmArr), saved: null };
      }
      sp.saved = sp.plan.save(sp.saved ?? undefined);
      const t0 = this.t;
      // first order until there's history for a second-order error estimate (three points)
      const order = stepState.history.length < 3 ? 1 : 2;
      // the start-up ramp: sources at their share at the end of the step (DC ones are stamped, so
      // the circuit is stamped again while it changes)
      const ramp = this.rampScale(t0);
      const scale = ramp === null ? 1 : Math.min(1, (t0 + h) / this.startupRamp);
      const rescaled = scale !== this.sourceScale;
      if (rescaled) this.sourceScale = scale;
      if (rescaled || h !== this.timeStep || order !== this.integrationOrder) {
        this.timeStep = h;
        this.integrationOrder = order;
        this.stampCircuit();
        if (this.stopMessage !== null) return;
      }
      const tEnd = t0 + h;
      // sources take their value at the end of the step; on a breakpoint, the value up to the edge
      this.t = atBreak ? tEnd - h * 1e-6 : tEnd;
      for (const ce of this.elmArr) ce.startIteration();
      // Newton starts from the node voltages extrapolated from the last two steps (SPICE's predictor)
      // rather than from the last solution: fewer iterations on smooth stretches
      if (this.predictor && stepState.prev && !atBreak) this.predict(h, stepState.prev);
      const maxIter = iterLimits[rescue];
      this.newtonNodeTest = rescue < 3;
      const subiter = this.iterate(maxIter);
      this.newtonNodeTest = true;
      if (subiter < 0) {
        this.t = t0;
        return;
      }
      const converged = subiter !== maxIter;

      // error estimate
      values.length = abstol.length = 0;
      if (converged) collectReactiveStates();
      const ratio = converged ? this.errorRatio(values, abstol, tEnd, order, device) : Infinity;
      // how the error scales with the step: h² at first order, h³ at second
      const root = (x: number) => (order === 1 ? Math.sqrt(x) : Math.cbrt(x));
      if (!converged || (ratio > 1 && !force)) {
        // undo the step and retry shorter
        diag.rejected++;
        if (converged) this.partStats(owners[this.worstState]).rejected++;
        else for (const ce of this.newtonBlockers()) this.partStats(ce).blocked++;
        sp.plan.restore(sp.saved);
        this.t = t0;
        if (!converged) {
          if (rescue === 0 && stepState.loose) {
            // the last step could only be accepted on the elements' own test: the condition
            // (e.g. a MOSFET sitting at its threshold) usually persists, so don't climb the ladder
            rescue = 3;
            continue;
          }
          if (rescue === 0 && cuts === 0) {
            // the same step again, with more iterations (switching elements often just need them)
            rescue = 1;
            continue;
          }
          if (h / 4 < hMin) {
            // at the smallest step: a long try, then the elements' own test alone
            if (rescue >= 3) {
              this.stop("Convergence failed!", null);
              return;
            }
            rescue = rescue < 2 ? 2 : 3;
            this.log?.(`no convergence at ${this.t}; ${rescue === 2 ? "a last, long try" : "accepting on the elements' own test"}`);
            continue;
          }
          // shorter steps, with the short iteration limit
          cuts++;
          rescue = 0;
        }
        h = converged ? h * Math.max(0.2, 0.9 * root(1 / ratio)) : rescue >= 2 ? h : h / 4;
        if (h < hMin) {
          // the error can't be met even at the smallest step: accept it there
          h = hMin;
          force = true;
        }
        continue;
      }
      if (rescue === 3) {
        this.looseSteps++;
        // which parts were still moving (their state is final for this step either way)
        const save = sp.plan.save();
        for (const ce of this.newtonBlockers()) this.partStats(ce).loose++;
        sp.plan.restore(save);
      }
      stepState.loose = rescue === 3;
      diag.steps++;
      diag.span += tEnd - t0;
      if (!atBreak) diag.minStep = Math.min(diag.minStep, tEnd - t0);
      // the error estimate set the pace (rather than the max step or a breakpoint): who decided it
      if (ratio > 0.1 && this.worstState >= 0) {
        const p = this.partStats(owners[this.worstState]);
        p.limited++;
        if (this.worstRinging) p.ringing++;
      }
      force = false;
      rescue = 0;
      cuts = 0;

      // accept
      this.t = tEnd;
      const x = Float64Array.from(values);
      // the predictor's last two solutions (none across a breakpoint: the waveform has a corner there)
      if (atBreak) stepState.prev = undefined;
      else {
        const prev = (stepState.prev ??= { h: 0, v: new Map() });
        prev.h = tEnd - t0;
        for (const m of this.matrices) {
          if (!m.nonLinear) continue;
          // the step's start (lastNodeVoltages) is the solution before this one
          let v = prev.v.get(m);
          if (!v || v.length !== m.nodeCount) prev.v.set(m, (v = new Float64Array(m.nodeCount)));
          v.set(m.lastNodeVoltages);
        }
      }
      if (atBreak) {
        // derivatives jump at a breakpoint: start the history over, with a short step (the first
        // after it is taken before any error estimate exists)
        stepState.history = [{ t: tEnd, x }];
        h = Math.max(hMin, Math.min(h, hMax) / FIRST_STEP_AFTER_BREAK);
      } else {
        stepState.history.push({ t: tEnd, x });
        if (stepState.history.length > 3) stepState.history.shift();
        // grow (at most double) or shrink by the error estimate; without one yet, keep the step
        if (ratio >= 0) {
          const f = ratio > 0 ? Math.min(2, 0.9 * root(1 / ratio)) : 2;
          if (f > 1.1 || f < 0.9) h *= f;
        }
      }
      h = Math.min(h, hMax);
      stepState.h = h;

      this.timeStepAccum += tEnd - t0;
      while (this.timeStepAccum >= this.maxTimeStep) {
        this.timeStepAccum -= this.maxTimeStep;
        this.timeStepCount++;
      }
      for (const ce of this.elmArr) ce.stepFinished();
      if (!this.delayWireProcessing) this.calcWireCurrents();
      this.onTimeStep?.();
      if (this.checkTime?.()) break;
      for (const m of this.matrices) m.lastNodeVoltages.set(m.nodeVoltages);
      if (shouldStop(this.timeStepCount - countAtStart)) break;
      if (!this.simRunning) break;
    }
    if (this.delayWireProcessing) this.calcWireCurrents();
  }

  /** The reactive state with the largest error in the last estimate (-1: none), and whether it rang. */
  private worstState = -1;
  private worstRinging = false;

  /**
   * How far the step just solved is over its error tolerance (at most 1: fine), from the reactive
   * states' history; -1 when there isn't enough history yet to tell. The local truncation error is
   * the method's: a first-order step (backward Euler) h²/2·x″ from a second divided difference of
   * the last three solutions; a second-order one h³/12·x‴ (trapezoidal: CircuitJS's parts) or
   * 2/9·h³·x‴ (BDF2: SPICE devices, ngspice's gear coefficient) from a third divided difference of
   * the last four.
   */
  private errorRatio(x3: number[], abstol: number[], t3: number, order: number, device: boolean[]): number {
    const hist = this.stepState.history;
    if (hist.length && hist[0].x.length !== x3.length) this.stepState.history = [];
    this.worstState = -1;
    this.worstRinging = false;
    const n = this.stepState.history.length;
    if (n < 2 || (order === 2 && n < 3)) return -1;
    // the last three solutions (with only two, the first stands in for the third: unused at first order)
    const [p0, p1, p2] = n >= 3 ? this.stepState.history.slice(-3) : [this.stepState.history[0], this.stepState.history[0], this.stepState.history[1]];
    const t0 = p0.t, t1 = p1.t, t2 = p2.t, h = t3 - t2;
    let worst = 0, worstD: [number, number, number] | null = null;
    for (let i = 0; i < x3.length; i++) {
      const x0 = p0.x[i], x1 = p1.x[i], x2 = p2.x[i], x = x3[i];
      const d1b = (x2 - x1) / (t2 - t1), d1c = (x - x2) / (t3 - t2);
      const d2b = (d1c - d1b) / (t3 - t1);
      let lte: number, d1a = d1b;
      if (order === 1) {
        // h²/2·x″ with x″ ≈ 2·d2
        lte = h * h * Math.abs(d2b);
      } else {
        d1a = (x1 - x0) / (t1 - t0);
        const d2a = (d1b - d1a) / (t2 - t0);
        const d3 = (d2b - d2a) / (t3 - t0);
        // x‴ ≈ 6·d3: trapezoidal h³/12·x‴ = h³·d3/2; BDF2 2/9·h³·x‴ = 4/3·h³·d3
        lte = h * h * h * Math.abs(d3) * (device[i] ? 4 / 3 : 0.5);
      }
      const tol = this.relTol * Math.max(Math.abs(x2), Math.abs(x)) + abstol[i];
      const r = lte / (this.trTol * tol);
      if (r > worst) {
        worst = r;
        this.worstState = i;
        worstD = [d1a, d1b, d1c];
      }
    }
    if (worstD) {
      // numerical ringing: the slope flips sign every step, by similar amounts (a period of two
      // steps is no real behaviour; it's the trapezoidal rule's undamped response to a fast mode)
      const [a, b, c] = worstD;
      const lo = Math.min(Math.abs(a), Math.abs(b), Math.abs(c)), hi = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
      this.worstRinging = a > 0 !== b > 0 && b > 0 !== c > 0 && lo > 0.3 * hi;
    }
    return worst;
  }

}

/** The inverse of a 3×3 matrix (the AC analysis's step fit). */
function invert3(a: number[][]): number[][] {
  const [[a0, a1, a2], [b0, b1, b2], [c0, c1, c2]] = a;
  const det = a0 * (b1 * c2 - b2 * c1) - a1 * (b0 * c2 - b2 * c0) + a2 * (b0 * c1 - b1 * c0);
  return [
    [(b1 * c2 - b2 * c1) / det, (a2 * c1 - a1 * c2) / det, (a1 * b2 - a2 * b1) / det],
    [(b2 * c0 - b0 * c2) / det, (a0 * c2 - a2 * c0) / det, (a2 * b0 - a0 * b2) / det],
    [(b0 * c1 - b1 * c0) / det, (a1 * c0 - a0 * c1) / det, (a0 * b1 - a1 * b0) / det],
  ];
}

/** Solve (re + j·im)·x = rhs (real right side) by Gaussian elimination with partial pivoting; null if singular. */
function complexSolve(n: number, re: Float64Array, im: Float64Array, rhs: Float64Array): { re: Float64Array; im: Float64Array } | null {
  const br = Float64Array.from(rhs), bi = new Float64Array(n);
  for (let col = 0; col < n; col++) {
    let piv = col, best = 0;
    for (let r = col; r < n; r++) {
      const mag = Math.hypot(re[r * n + col], im[r * n + col]);
      if (mag > best) { best = mag; piv = r; }
    }
    if (!(best > 0)) return null;
    if (piv !== col) {
      for (let k = 0; k < n; k++) {
        const a = col * n + k, b = piv * n + k;
        [re[a], re[b]] = [re[b], re[a]];
        [im[a], im[b]] = [im[b], im[a]];
      }
      [br[col], br[piv]] = [br[piv], br[col]];
      [bi[col], bi[piv]] = [bi[piv], bi[col]];
    }
    const pr = re[col * n + col], pi = im[col * n + col], pd = pr * pr + pi * pi;
    for (let r = col + 1; r < n; r++) {
      const xr = re[r * n + col], xi = im[r * n + col];
      if (xr === 0 && xi === 0) continue;
      // factor = x / pivot
      const fr = (xr * pr + xi * pi) / pd, fi = (xi * pr - xr * pi) / pd;
      for (let k = col; k < n; k++) {
        const ar = re[col * n + k], ai = im[col * n + k];
        re[r * n + k] -= fr * ar - fi * ai;
        im[r * n + k] -= fr * ai + fi * ar;
      }
      br[r] -= fr * br[col] - fi * bi[col];
      bi[r] -= fr * bi[col] + fi * br[col];
    }
  }
  const xr = new Float64Array(n), xi = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let sr = br[r], si = bi[r];
    for (let k = r + 1; k < n; k++) {
      const ar = re[r * n + k], ai = im[r * n + k];
      sr -= ar * xr[k] - ai * xi[k];
      si -= ar * xi[k] + ai * xr[k];
    }
    const pr = re[r * n + r], pi = im[r * n + r], pd = pr * pr + pi * pi;
    xr[r] = (sr * pr + si * pi) / pd;
    xi[r] = (si * pr - sr * pi) / pd;
  }
  return { re: xr, im: xi };
}
