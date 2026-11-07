// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { Circuit, type CircuitElm, type PartStats, Simulator, VoltageElm, Waveform } from "../engine";
import { si } from "./format";
import { resonances } from "./resonance";
import { Tolerance } from "./tolerance";

/**
 * Recommended simulation settings, found by running the circuit rather than guessing from part
 * values: short trial runs on a copy find the fastest oscillation that matters (or how long the
 * circuit takes to settle), then the time step is halved until halving it no longer changes the
 * result. Speed and scope scale follow from what the circuit does.
 *
 * This runs in a worker (recommend-worker.ts) so the window never waits for it; everything it
 * needs comes in an AnalysisInput.
 */
export interface AnalysisInput {
  /** The circuit, serialized. */
  text: string;
  /** Designators of its elements, in order (tolerances are keyed by them). */
  names: string[];
  /** Tolerance settings when they're on. */
  tolerance: { seed: number; perElement: (Record<string, number> | null)[] } | null;
  /** The circuit's time step now. */
  timeStep: number;
  /** Frequency of its fastest periodic source, or 0. */
  sourceFrequency: number;
  /** The solver the circuit runs with. */
  accurate: boolean;
  relTol: number;
  /** Speed range the app allows (circuit time per real second). */
  minSpeed: number;
  maxSpeed: number;
}

export interface Recommendation {
  timeStep: number;
  speedRatio: number;
  /** Circuit time a scope should show across (about four cycles), or null if nothing to show. */
  scopeSpan: number | null;
  /** What was found and why, for the dialog. */
  findings: string[];
  /** NodeForge solver: the tolerance recommended (the loosest within 1% of a 10× tighter run). */
  relTol: number | null;
  /**
   * Estimated accuracy at the circuit's current settings: how far its result is from a run with a
   * 10× tighter tolerance (fraction of the largest swing), or null in CircuitJS mode.
   */
  accuracy: number | null;
  /** How far the results can be trusted, and why. */
  confidence: Confidence;
}

export interface Confidence {
  level: "high" | "medium" | "low";
  /** What lowers it, most serious first (empty for high). */
  reasons: string[];
}

/** "A", "A and B", "A, B and 2 more". */
function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/**
 * What made the NodeForge solver work, as findings: fast behaviour that sets the pace (how many
 * more steps than the max step alone, and which parts' errors decide them; numerical ringing there
 * means a stiff circuit), and parts that keep Newton from converging.
 */
function solverFindings(d: DiagnosticSummary, maxStep: number, findings: string[], doubts: [number, string][]): void {
  if (!d.steps) return;
  const pace = d.steps / Math.max(1, d.span / maxStep);
  const limiting = d.parts.filter((p) => p.stats.limited > 0).sort((a, b) => b.stats.limited - a.stats.limited);
  const totalLimited = limiting.reduce((a, p) => a + p.stats.limited, 0);
  if (pace >= 3 && limiting.length) {
    // the parts that together decide most of the error-limited steps
    const top: typeof limiting = [];
    let sum = 0;
    for (const p of limiting) {
      if (sum >= 0.7 * totalLimited || top.length === 3) break;
      top.push(p);
      sum += p.stats.limited;
    }
    findings.push(`Step count: ${pace.toFixed(pace < 10 ? 1 : 0)}× the fixed-step estimate. Minimum step: ${si(d.minStep, "s", true)}. Limiting components: ${nameList(top.map((p) => p.name))}.`);
    const ringing = top.filter((p) => p.stats.ringing > 0.2 * p.stats.limited);
    if (ringing.length) {
      findings.push(`Numerical ringing: ${nameList(ringing.map((p) => p.name))}. Check the model's parasitic resistance and fast time constants.`);
      doubts.push([1, `numerical ringing in ${nameList(ringing.map((p) => p.name))}`]);
    }
  }
  const blocking = d.parts.filter((p) => p.stats.blocked + p.stats.loose > 0).sort((a, b) => b.stats.blocked + b.stats.loose - (a.stats.blocked + a.stats.loose));
  const attempts = blocking.reduce((a, p) => Math.max(a, p.stats.blocked), 0);
  if (blocking.length && (attempts >= 10 || d.loose)) {
    const names = nameList(blocking.slice(0, 4).map((p) => p.name));
    findings.push(`Convergence difficulty: ${names}.${attempts ? ` Newton iteration limit reached ${attempts} times.` : ""} The solver retries with more iterations or shorter steps.`);
  }
  if (d.loose) {
    const share = d.loose / d.steps;
    const who = nameList(d.parts.filter((p) => p.stats.loose > 0).sort((a, b) => b.stats.loose - a.stats.loose).slice(0, 3).map((p) => p.name));
    const text = `${d.loose} step${d.loose === 1 ? "" : "s"} (${+(share * 100).toPrecision(2)}%) accepted without full convergence${who ? ` around ${who}` : ""}`;
    findings.push(`${text[0].toUpperCase()}${text.slice(1)}. Results at these steps are less reliable.`);
    doubts.push([share > 0.01 ? 2 : 1, text]);
  }
}

/** Steps per cycle of the fastest oscillation that the time step should give. */
const STEPS_PER_CYCLE = 100;
/** Steps per cycle of the circuit's highest LC resonance, at least (worked out from part values; the solver refines within it). */
const RESONANCE_STEPS = 50;
/** Results at a step and at half of it may differ by this much (fraction of the largest swing). */
const AGREEMENT = 0.02;
/** Timesteps per real second the speed shouldn't ask for, so the computer can keep up. */
const STEP_RATE_LIMIT = 20000;
/** Trial run length, in timesteps. */
const TRIAL_STEPS = 20000;
/** The tightest accuracy (relTol) the app offers. */
const MIN_RELTOL = 1e-6;
/** Most nodes watched in a trial (plenty for finding oscillations; keeps memory small). */
const MAX_NODES = 64;

interface Run {
  /** Node voltages per sample: samples[k][node]. */
  samples: Float64Array[];
  /** Time of each sample. */
  times: number[];
  stopped: string | null;
  /** What the NodeForge solver went through. */
  diagnostics: DiagnosticSummary;
}

/** The NodeForge solver's diagnostics, by part (composites' insides counted as the part). */
export interface DiagnosticSummary {
  steps: number;
  span: number;
  rejected: number;
  minStep: number;
  /** Steps accepted without full convergence. */
  loose: number;
  /** Parts that made the solver work, by designator. */
  parts: { name: string; stats: PartStats }[];
}

/** Summarize a simulator's diagnostics by the circuit's parts (`names` in the order of `elements`). */
export function summarizeDiagnostics(sim: Simulator, elements: readonly CircuitElm[], names: readonly string[]): DiagnosticSummary {
  // a composite's inner elements are simulated separately: count them as the composite
  const owner = new Map<CircuitElm, number>();
  const claim = (e: CircuitElm, i: number) => {
    owner.set(e, i);
    for (const c of e.getChildElmList() ?? []) claim(c, i);
  };
  elements.forEach((e, i) => claim(e, i));
  const byName = new Map<string, PartStats>();
  for (const [e, st] of sim.diagnostics.parts) {
    const i = owner.get(e);
    const name = i === undefined ? "?" : names[i];
    const p = byName.get(name) ?? { limited: 0, rejected: 0, ringing: 0, blocked: 0, loose: 0 };
    p.limited += st.limited;
    p.rejected += st.rejected;
    p.ringing += st.ringing;
    p.blocked += st.blocked;
    p.loose += st.loose;
    byName.set(name, p);
  }
  const d = sim.diagnostics;
  return {
    steps: d.steps, span: d.span, rejected: d.rejected, minStep: d.minStep, loose: sim.looseSteps,
    parts: [...byName].map(([name, stats]) => ({ name, stats })),
  };
}

interface Activity {
  /** Fastest oscillation with a meaningful swing (Hz), or 0. */
  fastest: number;
  /** Oscillation of the node with the largest swing (Hz), or 0. */
  dominant: number;
  /** Largest swing in the second half of the run (V). */
  swing: number;
  /** Time after which every node stays within 1% of the largest swing of its final value, or null if it never settles. */
  settle: number | null;
}

/**
 * Run a copy of the circuit for `steps` timesteps of `dt` (on the NodeForge engine, `dt` is the largest
 * step and the run lasts as long), recording node voltages every `every` steps' worth of time.
 */
function trial(input: AnalysisInput, dt: number, steps: number, every: number, tolerance: Tolerance | null): Run {
  const c = Circuit.parse(input.text);
  const sim = new Simulator();
  sim.maxTimeStep = sim.timeStep = dt;
  sim.minTimeStep = Math.min(c.options.minTimeStep, dt);
  sim.adjustTimeStep = c.options.adjustTimeStep;
  sim.accurate = input.accurate;
  sim.relTol = input.relTol;
  sim.useCircuitOptions(c.options);
  sim.setElements(c.simulatedElements);
  sim.resetTime();
  const designators = new Map<CircuitElm, string>(c.elements.map((e, i) => [e, input.names[i]] as const));
  // each part's own tolerances (the text form may not carry them)
  if (input.tolerance) c.elements.forEach((e, i) => (e.tolerance = input.tolerance!.perElement[i] ?? null));
  const run: Run = { samples: [], times: [], stopped: null, diagnostics: summarizeDiagnostics(sim, [], []) };
  let probes: { elm: CircuitElm; post: number }[] | null = null;
  const end = steps * dt, interval = every * dt;
  let next = interval;
  let prev: Float64Array | null = null, prevT = 0;
  tolerance?.apply(c.elements, (e) => designators.get(e) ?? null);
  try {
    while (sim.t < end - dt * 1e-6 && sim.stopMessage === null) {
      sim.update(() => true);
      // nodes are known once the circuit has been analyzed (first step)
      probes ??= sim.nodeList.slice(1).filter((nd) => nd.links.length && !nd.internal).slice(0, MAX_NODES)
        .map((nd) => ({ elm: nd.links[0].elm, post: nd.links[0].num }));
      // samples at exactly the sampling times, interpolated between steps (steps vary in the
      // NodeForge solver, so runs are compared at the same instants)
      const now = Float64Array.from(probes, (p) => p.elm.volts[p.post] ?? 0);
      while (next <= sim.t + dt * 1e-6) {
        const f = prev && sim.t > prevT ? Math.min(1, Math.max(0, (next - prevT) / (sim.t - prevT))) : 1;
        run.samples.push(prev ? now.map((v, j) => prev![j] + (v - prev![j]) * f) : Float64Array.from(now));
        run.times.push(next);
        next += interval;
      }
      prev = now;
      prevT = sim.t;
    }
  } finally {
    tolerance?.restore();
  }
  run.stopped = sim.stopMessage;
  run.diagnostics = summarizeDiagnostics(sim, c.elements, input.names);
  return run;
}

/** Oscillation frequencies and settling, from the second half of a run (the first half may be start-up). */
function activity(run: Run): Activity {
  const k0 = Math.floor(run.samples.length / 2);
  const tail = run.samples.slice(k0), tt = run.times.slice(k0);
  const empty: Activity = { fastest: 0, dominant: 0, swing: 0, settle: null };
  if (tail.length < 8) return empty;
  const nodes = tail[0].length, duration = tt[tt.length - 1] - tt[0];
  let swing = 0, fastest = 0, dominant = 0, dominantSwing = 0;
  const swings: number[] = [];
  for (let j = 0; j < nodes; j++) {
    let lo = Infinity, hi = -Infinity;
    for (const s of tail) {
      lo = Math.min(lo, s[j]);
      hi = Math.max(hi, s[j]);
    }
    swings.push(hi - lo);
    swing = Math.max(swing, hi - lo);
  }
  for (let j = 0; j < nodes; j++) {
    const sw = swings[j];
    if (sw < 0.05 * swing || sw < 1e-6) continue;
    // crossings of the middle, with hysteresis so noise doesn't count
    let mid = 0;
    for (const s of tail) mid += s[j];
    mid /= tail.length;
    let state = 0, crossings = 0;
    for (const s of tail) {
      const v = s[j] - mid;
      if (v > 0.2 * sw && state <= 0) {
        if (state < 0) crossings++;
        state = 1;
      } else if (v < -0.2 * sw && state >= 0) {
        if (state > 0) crossings++;
        state = -1;
      }
    }
    if (crossings < 4) continue;
    const f = crossings / 2 / duration;
    fastest = Math.max(fastest, f);
    if (sw > dominantSwing) {
      dominantSwing = sw;
      dominant = f;
    }
  }
  // settling: the last time any node was further than 1% of the largest swing (whole run) from its final value
  let fullSwing = 0;
  const last = run.samples[run.samples.length - 1];
  for (let j = 0; j < nodes; j++) for (const s of run.samples) fullSwing = Math.max(fullSwing, Math.abs(s[j] - last[j]));
  let settle: number | null = null;
  if (!fastest) {
    let lastOff = -1;
    run.samples.forEach((s, k) => {
      for (let j = 0; j < nodes; j++) if (Math.abs(s[j] - last[j]) > 0.01 * fullSwing) lastOff = k;
    });
    // settled only if it stayed put for the last quarter of the run
    if (lastOff < run.samples.length * 0.75) settle = lastOff < 0 ? run.times[0] : run.times[lastOff];
  }
  return { fastest, dominant, swing, settle };
}

/**
 * Largest difference between two runs, relative to the largest swing. Each sample is matched to
 * the closest of its neighbours in time, so an edge that lands a step later (normal for switching
 * circuits) isn't counted as a full-swing error; a wrong level or shape still is.
 */
function disagreement(a: Run, b: Run): number {
  const n = Math.min(a.samples.length, b.samples.length);
  let diff = 0, lo = Infinity, hi = -Infinity;
  for (let k = 0; k < n; k++) {
    const x = a.samples[k];
    for (let j = 0; j < x.length; j++) {
      let d = Infinity;
      for (let q = Math.max(0, k - 1); q <= Math.min(n - 1, k + 1); q++) d = Math.min(d, Math.abs(x[j] - b.samples[q][j]));
      diff = Math.max(diff, d);
      lo = Math.min(lo, x[j]);
      hi = Math.max(hi, x[j]);
    }
  }
  return hi > lo ? diff / (hi - lo) : diff > 1e-9 ? 1 : 0;
}

/** Round down to 1, 2 or 5 × a power of ten. */
function nice(x: number): number {
  const e = Math.floor(Math.log10(x)), m = x / 10 ** e;
  return +((m >= 5 ? 5 : m >= 2 ? 2 : 1) * 10 ** e).toPrecision(1);
}

/** Work out recommended settings for a circuit (runs for up to a few seconds: call it from a worker). */
export function analyzeCircuit(input: AnalysisInput): Recommendation {
  let tol: Tolerance | null = null;
  if (input.tolerance) {
    tol = new Tolerance();
    tol.enabled = true;
    tol.seed = input.tolerance.seed;
  }
  const findings: string[] = [];
  /** What lowers confidence in the results: [1 medium / 2 low, why]. */
  const doubts: [number, string][] = [];

  // a noise source takes a new random value every step (max step), so what it drives has activity
  // at any step: there's no oscillation to resolve, and halving the step changes the noise itself
  const circuit = Circuit.parse(input.text);
  const noisy = circuit.simulatedElements.some((e) => e instanceof VoltageElm && e.waveform === Waveform.noise);
  // the highest LC resonance, from part values: a step that resolves it, even before it's excited
  let resonant = 0;
  try {
    resonant = resonances(circuit)[0] ?? 0;
  } catch {
    resonant = 0;
  }

  // 1. find what the circuit does, with a step fine enough to see it (its fastest source and its
  // highest resonance)
  let dt = input.timeStep;
  const fs = Math.max(input.sourceFrequency, resonant);
  if (fs > 0 && dt > 1 / (50 * fs)) dt = nice(1 / (50 * fs));
  let act: Activity = { fastest: 0, dominant: 0, swing: 0, settle: null };
  let run: Run | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    run = trial(input, dt, TRIAL_STEPS, 1, tol);
    act = activity(run);
    if (noisy) {
      // activity near the step's own rate is the noise, not an oscillation
      if (act.fastest * dt > 1 / 20) act.fastest = 0;
      if (act.dominant * dt > 1 / 20) act.dominant = act.fastest;
      break;
    }
    if (act.fastest && act.fastest * dt > 1 / 20) {
      dt = nice(dt / 10); // too few steps per cycle to trust what was seen
      continue;
    }
    if (!act.fastest && act.settle === null && !run.stopped && attempt < 2) {
      dt = nice(dt * 10); // still moving at the end: look at a longer stretch
      continue;
    }
    break;
  }
  if (run?.stopped) findings.push(`The trial run stopped: ${run.stopped}`);

  // 2. a step for the fastest oscillation, then halve until halving changes nothing
  let step = act.fastest ? nice(1 / (STEPS_PER_CYCLE * act.fastest)) : dt;
  const window = act.dominant ? 6 / act.dominant : act.settle ? Math.max(act.settle * 1.5, 200 * step) : TRIAL_STEPS * dt;
  /** How much the result changes when a step is halved, over the window. */
  const check = (s: number) => {
    const steps = Math.min(Math.ceil(window / s), 200000);
    const every = Math.max(1, Math.floor(steps / 400));
    const a = trial(input, s, steps, every, tol);
    const b = trial(input, s / 2, steps * 2, every * 2, tol);
    return disagreement(a, b);
  };
  let agreed = false, lastDiff = noisy ? 0 : check(step);
  if (noisy) {
    // the step sets the noise's bandwidth: keep the circuit's own
    step = input.timeStep;
    agreed = true;
  } else if (lastDiff <= AGREEMENT) {
    // already accurate: try coarser steps (less computing), as long as they still agree and keep
    // enough steps per cycle and across the window
    agreed = true;
    const coarsest = Math.min(act.fastest ? 1 / (STEPS_PER_CYCLE * act.fastest) : Infinity, window / 200);
    for (let i = 0; i < 6; i++) {
      const next = nice(step * 2.5);
      if (next <= step || next > coarsest) break;
      const d = check(next);
      if (d > AGREEMENT) break;
      step = next;
      lastDiff = d;
    }
  } else {
    for (let i = 0; i < 6; i++) {
      step = nice(step / 2);
      lastDiff = check(step);
      if (lastDiff <= AGREEMENT) {
        agreed = true;
        break;
      }
    }
  }

  // a step that resolves the highest LC resonance (the solver's error control refines within it)
  if (resonant > 0 && !noisy) {
    const cap = nice(1 / (RESONANCE_STEPS * resonant));
    if (step > cap) {
      step = cap;
      // (what halving this step changes, for the findings below)
      lastDiff = check(step);
      agreed ||= lastDiff <= AGREEMENT;
      findings.push(`LC resonance (from part values): ${si(resonant, "Hz", true)}. Time step limited to ${si(cap, "s", true)} (${RESONANCE_STEPS} steps per cycle).`);
    } else findings.push(`LC resonance (from part values): ${si(resonant, "Hz", true)}.`);
  }

  if (act.fastest) {
    const f = act.dominant || act.fastest;
    findings.push(`Oscillation frequency: ${si(f, "Hz", true)}${act.fastest > f * 1.5 ? `. Faster activity: ${si(act.fastest, "Hz", true)}` : ""}.`);
  } else if (act.settle !== null) {
    findings.push(`No oscillation detected. Estimated settling time: ${si(Math.max(act.settle, step), "s", true)}.`);
  } else if (!noisy) {
    findings.push("No steady oscillation detected during the trial.");
  }
  findings.push(noisy
    ? `Noise sample interval: ${si(step, "s", true)}. Bandwidth limit: ${si(1 / (2 * step), "Hz", true)}. Time step unchanged.`
    : agreed
    ? `Time step: ${si(step, "s", true)}. Difference after halving it: ${(lastDiff * 100).toFixed(1)}%.`
    : `Time step: ${si(step, "s", true)}. Halving it changes results by ${(lastDiff * 100).toFixed(0)}%. Try a smaller step.`);

  // 3. speed: about two cycles a second (or settling in ~3 s), within what the computer can do
  const f = act.dominant || act.fastest;
  let ratio = f ? 2 / f : act.settle ? Math.max(act.settle, step * 100) / 3 : (TRIAL_STEPS * dt) / 5;
  const limit = STEP_RATE_LIMIT * step;
  if (ratio > limit) {
    ratio = limit;
    findings.push(`Recommended speed capped at ${si(limit, "s", true)} of circuit time per second.`);
  }
  ratio = Math.min(input.maxSpeed, Math.max(input.minSpeed, nice(ratio)));

  // 4. scopes: about four cycles across (or the settling, with some room)
  const scopeSpan = f ? 4 / f : act.settle ? act.settle * 1.5 : null;

  // 5. NodeForge solver: is the tolerance tight enough? Compare with 10× tighter runs and keep the
  // loosest that stays within 1% of the next tighter one
  let relTol: number | null = null, accuracy: number | null = null;
  if (input.accurate) {
    const steps = Math.min(Math.ceil(window / step), 100000);
    const every = Math.max(1, Math.floor(steps / 400));
    const at = (rt: number) => trial({ ...input, relTol: rt }, step, steps, every, tol);
    let rt = input.relTol, here = at(rt), within = false;
    const base = here;
    for (let i = 0; i < 3; i++) {
      const tighter = at(rt / 10);
      const d = disagreement(here, tighter);
      if (i === 0) accuracy = d;
      if (d <= 0.01) {
        within = true;
        break;
      }
      if (rt / 10 < MIN_RELTOL * 0.999) break;
      rt /= 10;
      here = tighter;
    }
    relTol = rt;
    if (accuracy !== null) {
      const pct = (x: number) => `${+(x * 100).toPrecision(2)}%`;
      // an estimate this small is as good as exact
      const off = (x: number) => (x < 1e-5 ? "0.001%" : pct(x));
      const now = `Relative tolerance: ${pct(input.relTol)}`;
      findings.push(relTol === input.relTol
        ? within
          ? `${now}. Difference from a 10× tighter trial: ${off(accuracy)}.`
          : `${now}. Difference from a 10× tighter trial: ${off(accuracy)}. No tighter setting is available.`
        : within
          ? `${now}. Difference from a 10× tighter trial: ${off(accuracy)}. At ${pct(relTol)}, the difference is within 1%.`
          : `${now}. Difference from a 10× tighter trial: ${off(accuracy)}. At ${pct(relTol)}, the difference still exceeds 1%.`);
    }
    // 6. what made the solver work
    solverFindings(base.diagnostics, step, findings, doubts);
  }

  // 7. confidence: what could make the results wrong, by how much
  if (!agreed && lastDiff > 0.5 && (accuracy === null || accuracy > 0.5)) {
    findings.push("The waveform is sensitive to time step and tolerance. These trials do not establish a repeatable result.");
    doubts.push([2, "waveform is sensitive to numerical settings"]);
  }
  if (run?.stopped) doubts.push([2, `the circuit stops: ${run.stopped}`]);
  if (!agreed) doubts.push([2, `results still change by ${(lastDiff * 100).toFixed(0)}% when the time step is halved`]);
  if (accuracy !== null && accuracy > 0.005) doubts.push([accuracy > 0.02 ? 2 : 1, `results are ${+(accuracy * 100).toPrecision(2)}% off a run with a 10× tighter tolerance`]);
  if (!input.accurate) doubts.push([1, "the CircuitJS solver doesn't control each step's error (the NodeForge solver does)"]);
  doubts.sort((a, b) => b[0] - a[0]);
  const worst = doubts[0]?.[0] ?? 0;
  const confidence: Confidence = { level: worst >= 2 ? "low" : worst === 1 ? "medium" : "high", reasons: doubts.map(([, r]) => r) };
  findings.push(confidence.level === "high" ? "Trial consistency: high." : `Trial consistency: ${confidence.level} (${confidence.reasons.join("; ")}).`);

  return { timeStep: step, speedRatio: ratio, scopeSpan, findings, relTol, accuracy, confidence };
}
