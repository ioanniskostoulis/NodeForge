// nfsim accuracy: run a circuit in NodeForge and in ngspice (tight tolerances, a much finer step:
// the reference) and report how far each node voltage is from the reference.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { Circuit, type CircuitElm, CurrentElm, Simulator, toSpice, VoltageElm, Waveform } from "../engine";

/** ngspice's Windows console binary is named differently from its macOS binary. */
function ngspiceExecutable(): string {
  if (process.platform !== "win32") return "ngspice";
  const name = "ngspice_con.exe";
  const paths = (process.env.PATH ?? process.env.Path ?? "").split(delimiter);
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  for (const dir of [...paths, join(programFiles, "Spice64", "bin")]) {
    const file = join(dir, name);
    if (existsSync(file)) return file;
  }
  return name;
}

export interface AccuracyOptions {
  /** Circuit time to simulate (default: 2000 of the circuit's time steps). */
  seconds?: number;
  /** Time step for NodeForge instead of the circuit's own (the largest step, in accurate mode). */
  step?: number;
  /** Use the NodeForge solver (error-controlled steps). */
  accurate?: boolean;
  /** NodeForge solver relative tolerance. */
  relTol?: number;
}

export interface NodeError {
  node: string;
  /** Largest difference from the reference at the same instant (V). */
  max: number;
  /**
   * Largest difference allowing a time shift of up to one step (V), measured at both
   * simulators' points and the smaller taken: edges a step apart and either side's sampling
   * between its points don't count; wrong levels, amplitudes and drift do.
   */
  shape: number;
  /** RMS difference (V). */
  rms: number;
  /** The reference's swing (max − min, V), what the errors are relative to. */
  swing: number;
}

export interface AccuracyReport {
  /** The reference's relative tolerance (the tightest ngspice managed), or null if it failed. */
  referenceTol: number | null;
  /** ngspice's integration method for the reference: "gear" or "trap". */
  referenceMethod?: string;
  /** Why the reference couldn't be computed. */
  error: string | null;
  seconds: number;
  step: number;
  steps: number;
  nodes: NodeError[];
  unsupported: string[];
  stopped: string | null;
}

/** Simulate a circuit in NodeForge, recording every node voltage after every step. */
function runEngine(text: string, step: number, seconds: number, nodes: number[], opts: AccuracyOptions) {
  const c = Circuit.parse(text);
  const sim = new Simulator();
  sim.maxTimeStep = sim.timeStep = step;
  sim.minTimeStep = Math.min(c.options.minTimeStep, step);
  sim.adjustTimeStep = c.options.adjustTimeStep;
  sim.accurate = opts.accurate ?? false;
  if (opts.relTol) sim.relTol = opts.relTol;
  if (process.env.NFSIM_LOG) sim.log = (m) => console.error(m);
  sim.useCircuitOptions(c.options);
  // self-heating MOSFETs from 0 °C, as ngspice's in its uic run
  sim.coldThermalStart = true;
  sim.setElements(c.simulatedElements);
  sim.resetTime();
  const times: number[] = [0];
  const values: number[][] = nodes.map(() => [0]);
  let probes: (readonly [CircuitElm, number] | null)[] | null = null;
  while (sim.t < seconds - step / 2 && sim.stopMessage === null) {
    sim.update(() => true);
    // the node's voltage is any of its terminals' (wires are merged, so they all agree)
    probes ??= nodes.map((n) => {
      const link = sim.nodeList[n]?.links[0];
      return link ? ([link.elm, link.num] as const) : null;
    });
    times.push(sim.t);
    probes.forEach((p, j) => values[j].push(p ? (p[0].volts[p[1]] ?? 0) : 0));
  }
  return { times, values, stopped: sim.stopMessage };
}

/** Index of the last sample at or before t. */
function sampleBefore(times: number[], t: number): number {
  let lo = 0, hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Value of a recorded series at time t (linear between samples). */
function interpolate(times: number[], values: number[], t: number): number {
  const i = sampleBefore(times, t);
  if (i + 1 >= times.length) return values[values.length - 1];
  const t0 = times[i], t1 = times[i + 1];
  return t1 > t0 && t > t0 ? values[i] + ((values[i + 1] - values[i]) * (t - t0)) / (t1 - t0) : values[i];
}

/**
 * Distance from v to the range a series' samples cover around [t0, t1], the samples just outside
 * included (0 if they pass through v): a reference sparse there (ngspice at its default step) is
 * held to its own points, not to a chord between them.
 */
function distanceAround(times: number[], values: number[], t0: number, t1: number, v: number): number {
  let lo = Infinity, hi = -Infinity;
  for (let i = sampleBefore(times, t0); i < times.length; i++) {
    lo = Math.min(lo, values[i]);
    hi = Math.max(hi, values[i]);
    if (times[i] >= t1) break;
  }
  return v < lo ? lo - v : v > hi ? v - hi : 0;
}

export function accuracy(text: string, opts: AccuracyOptions = {}): AccuracyReport {
  const circuit = Circuit.parse(text);
  const step = opts.step ?? circuit.options.maxTimeStep;
  const seconds = opts.seconds ?? step * 2000;
  const net = toSpice(circuit);
  const nodeIds = [...net.nodeNames.keys()].filter((n) => n !== 0).sort((a, b) => a - b);
  const report: AccuracyReport = { referenceTol: null, error: null, seconds, step, steps: 0, nodes: [], unsupported: net.unsupported, stopped: null };
  if (net.unsupported.length) return report;

  // reference: ngspice with tight tolerances and a step a tenth of ours, at its own time points
  // (dense where it had to resolve something, as at the start), interpolated at ours
  const dir = mkdtempSync(join(tmpdir(), "nfsim-"));
  try {
    // (the print step: ngspice's first step and breakpoints follow it, so it's kept as it was)
    const grid = Math.min(step, seconds / 4000);
    const vectors = nodeIds.map((n) => `v(${net.nodeNames.get(n)})`).join(" ");
    // the tightest reference ngspice manages: Gear with tight tolerances and a step limit a tenth
    // of ours; else the trapezoidal rule; else (hard switching with charge storage can defeat the
    // tight absolute tolerances) only a tight relative tolerance, no step limit; else its defaults
    const tight = "abstol=1e-12 vntol=1e-9 chgtol=1e-16";
    const limit = `0 ${step / 10}`;
    const ladder: { method: string; tol: number; options: string; tmax: string }[] = [
      ...[1e-6, 1e-5, 1e-4].map((tol) => ({ method: "gear", tol, options: `reltol=${tol} ${tight} method=gear maxord=2`, tmax: limit })),
      ...[1e-6, 1e-5, 1e-4].map((tol) => ({ method: "trap", tol, options: `reltol=${tol} ${tight} method=trap`, tmax: limit })),
      ...[1e-5, 1e-4].map((tol) => ({ method: "trap, default abstol", tol, options: `reltol=${tol} method=trap`, tmax: "" })),
      { method: "ngspice defaults", tol: 1e-3, options: "", tmax: "" },
    ];
    for (const { method, tol, options, tmax } of ladder) {
      writeFileSync(join(dir, "c.cir"), [
        "NodeForge accuracy reference",
        net.text,
        options ? `.options ${options}` : "",
        `.tran ${grid} ${seconds} ${tmax} uic`,
        ".control",
        "run",
        `wrdata ref.dat ${vectors}`,
        ".endc",
        ".end",
      ].join("\n"));
      rmSync(join(dir, "ref.dat"), { force: true });
      let log = "";
      try {
        // a rung ngspice can't finish in reasonable time (tight tolerances it keeps cutting the step
        // for) counts as failed: on to the next
        log = execFileSync(ngspiceExecutable(), ["-b", "c.cir"], { cwd: dir, stdio: "pipe", maxBuffer: 1 << 26, timeout: 60_000 }).toString();
      } catch (err) {
        const e = err as { stderr?: Buffer; signal?: string };
        log = e.signal ? "aborted: took too long" : String(e.stderr ?? err);
      }
      if (!/too small|aborted/i.test(log) && existsSync(join(dir, "ref.dat"))) {
        report.referenceTol = tol;
        report.referenceMethod = method;
        break;
      }
      report.error = log.split("\n").find((l) => /too small|singular|error/i.test(l))?.trim() ?? "ngspice failed";
    }
    if (report.referenceTol === null) return report;
    report.error = null;
    // wrdata: time, value pairs for each vector on every row
    const rows = readFileSync(join(dir, "ref.dat"), "utf8").trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number));
    const engine = runEngine(text, step, seconds, nodeIds, opts);
    report.steps = engine.times.length - 1;
    report.stopped = engine.stopped;
    // the shape is measured both ways and the smaller taken: at each of the engine's points, how
    // far it is from what the reference passes through within a step either side, and at each of
    // the reference's, how far it is from the engine's. Each waveform is only exact at its own
    // points: one way alone counts the other's sampling (a sine's peak cut by the chord between
    // our steps, or a reference that ngspice sampled sparsely or damped) as an error. An edge a
    // step early or late doesn't count; wrong levels, amplitudes and drift do. Raw and RMS are at
    // the engine's points against the reference interpolated there.
    const refTimes = rows.map((r) => r[0]);
    const refLast = refTimes[refTimes.length - 1] ?? 0;
    // from one step in: at t = 0 (uic) every node is at 0 while the sources are switched on, a
    // state neither simulator can be in, and how each crosses it in the first nanoseconds is its
    // own (a start-up that ends up different, as a regulator's, still shows after it)
    const from = Math.max(refTimes[1] ?? Infinity, step);
    const times = engine.times.slice(1), last = times[times.length - 1] ?? 0;
    nodeIds.forEach((n, j) => {
      const ref = rows.map((r) => r[2 * j + 1]);
      const ours = engine.values[j].slice(1);
      let max = 0, oursShape = 0, sum2 = 0, span = 0;
      for (let i = 0; i < times.length; i++) {
        const t = times[i];
        if (t < from) continue;
        if (t > refLast - step) break;
        const d = Math.abs(ours[i] - interpolate(refTimes, ref, t));
        max = Math.max(max, d);
        oursShape = Math.max(oursShape, distanceAround(refTimes, ref, t - step, t + step, ours[i]));
        // RMS over time (the steps aren't evenly spaced)
        const dt = t - Math.max(times[i - 1] ?? 0, from);
        sum2 += d * d * dt;
        span += dt;
      }
      let refShape = 0;
      for (let k = 0; k < refTimes.length; k++) {
        const t = refTimes[k];
        if (t < from) continue;
        if (t > last - step) break;
        refShape = Math.max(refShape, distanceAround(times, ours, t - step, t + step, ref[k]));
      }
      const shape = Math.min(oursShape, refShape);
      if (process.env.NFSIM_DEBUG) console.error(`node ${net.nodeNames.get(n)}: ours→reference ${oursShape}, reference→ours ${refShape}`);
      // (a loop: a long run's reference has more points than spread arguments may)
      let hi = -Infinity, lo = Infinity;
      for (const v of ref) { if (v > hi) hi = v; if (v < lo) lo = v; }
      const swing = hi - lo;
      report.nodes.push({ node: net.nodeNames.get(n)!, max, shape, rms: Math.sqrt(sum2 / Math.max(span, 1e-300)), swing });
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return report;
}

export interface OperatingPointReport {
  method: string | null;
  error: string | null;
  unsupported: string[];
  nodes: { node: string; ours: number; ref: number }[];
}

/** Compare NodeForge's DC operating point with ngspice's .op. */
export function operatingPoint(text: string): OperatingPointReport {
  const net = toSpice(Circuit.parse(text), { dc: true });
  const report: OperatingPointReport = { method: null, error: null, unsupported: net.unsupported, nodes: [] };
  if (net.unsupported.length) return report;
  const nodeIds = [...net.nodeNames.keys()].filter((n) => n !== 0).sort((a, b) => a - b);

  const c = Circuit.parse(text);
  const sim = new Simulator();
  sim.maxTimeStep = sim.timeStep = c.options.maxTimeStep;
  sim.accurate = true;
  sim.useCircuitOptions(c.options);
  sim.setElements(c.simulatedElements);
  sim.resetTime();
  report.method = sim.solveOperatingPoint();
  if (!report.method) {
    report.error = "NodeForge found no operating point";
    return report;
  }
  const ours = new Map(nodeIds.map((n) => {
    const link = sim.nodeList[n]?.links[0];
    return [n, link ? (link.elm.volts[link.num] ?? 0) : 0] as const;
  }));

  const dir = mkdtempSync(join(tmpdir(), "nfsim-"));
  try {
    const vectors = nodeIds.map((n) => `v(${net.nodeNames.get(n)})`).join(" ");
    writeFileSync(join(dir, "c.cir"), ["NodeForge operating point", net.text, ".options reltol=1e-6 abstol=1e-12 vntol=1e-9", ".control", "op", `print ${vectors}`, ".endc", ".end"].join("\n"));
    let out = "";
    try {
      out = execFileSync(ngspiceExecutable(), ["-b", "c.cir"], { cwd: dir, stdio: "pipe" }).toString();
    } catch (err) {
      report.error = `ngspice: ${String((err as { stderr?: Buffer }).stderr ?? err).split("\n").find((l) => l.trim()) ?? "failed"}`;
      return report;
    }
    const ref = new Map<string, number>();
    for (const m of out.matchAll(/^v\((\w+)\)\s*=\s*(\S+)/gm)) ref.set(m[1], Number(m[2]));
    for (const n of nodeIds) {
      const name = net.nodeNames.get(n)!;
      report.nodes.push({ node: name, ours: ours.get(n)!, ref: ref.get(name) ?? NaN });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return report;
}

/**
 * An error as a percentage of the node's swing, the swing taken as at least a tenth of the
 * circuit's largest (a node that barely moves isn't held to its own tiny swing: microvolts on a
 * millivolt ripple beside a 100 V switch node aren't a large error).
 */
export function relativeError(r: AccuracyReport): (v: number, e: NodeError) => number {
  const scale = Math.max(...r.nodes.map((e) => e.swing), 1e-9);
  return (v, e) => (v / Math.max(e.swing, scale * 0.1)) * 100;
}

export function worstShape(r: AccuracyReport): { node: string; percent: number } | null {
  if (!r.nodes.length) return null;
  const rel = relativeError(r);
  const worst = r.nodes.reduce((a, b) => (rel(b.shape, b) > rel(a.shape, a) ? b : a), r.nodes[0]);
  return { node: worst.node, percent: rel(worst.shape, worst) };
}

export interface DcSweepReport {
  /** The swept source: its SPICE name and kind. */
  source: string | null;
  error: string | null;
  unsupported: string[];
  values: number[];
  /** Values whose operating point NodeForge didn't find. */
  failed: number[];
  /** Per node: the largest difference from ngspice over the sweep (V) and the node's range there. */
  nodes: { node: string; max: number; swing: number }[];
}

/** The circuit's independent sources (voltage sources and rails, current sources), in file order. */
function sources(c: Circuit): CircuitElm[] {
  return c.elements.filter((e) => e instanceof VoltageElm || e instanceof CurrentElm);
}

/** Set a source's DC value (a voltage source's or rail's, a current source's). */
function setSourceValue(e: CircuitElm, v: number): void {
  if (e instanceof VoltageElm) {
    e.waveform = Waveform.dc;
    e.maxVoltage = v - e.bias;
  } else if (e instanceof CurrentElm) e.currentValue = v;
}

/**
 * Sweep a source's DC value (`which`: 1 for the circuit's first independent source…) from start
 * to stop by step, and compare every node's DC voltage with ngspice's `.dc` of the same source.
 */
export function dcSweep(text: string, which: number, start: number, stop: number, step: number): DcSweepReport {
  const report: DcSweepReport = { source: null, error: null, unsupported: [], values: [], failed: [], nodes: [] };
  const n = Math.round((stop - start) / step);
  if (!(n >= 1) || n > 100000) {
    report.error = "start, stop and step don't make a sweep";
    return report;
  }
  report.values = Array.from({ length: n + 1 }, (_, i) => start + i * step);
  const exported = Circuit.parse(text);
  const net = toSpice(exported, { dc: true });
  report.unsupported = net.unsupported;
  const target = sources(exported)[which - 1];
  report.source = target ? (net.sourceNames.get(target) ?? null) : null;
  if (!target || !report.source) {
    report.error = `no independent source ${which} (the circuit has ${sources(exported).length})`;
    return report;
  }
  if (net.unsupported.length) return report;
  const nodeIds = [...net.nodeNames.keys()].filter((k) => k !== 0).sort((a, b) => a - b);

  // NodeForge: the same circuit, the same source, swept
  const c = Circuit.parse(text);
  const sim = new Simulator();
  sim.maxTimeStep = sim.timeStep = c.options.maxTimeStep;
  sim.accurate = true;
  sim.useCircuitOptions(c.options);
  sim.setElements(c.simulatedElements);
  sim.resetTime();
  const source = sources(c)[which - 1];
  const ours = new Map<number, number[]>();
  report.failed = sim.dcSweep(report.values, (v) => setSourceValue(source, v), (v) => {
    ours.set(v, nodeIds.map((k) => {
      const link = sim.nodeList[k]?.links[0];
      return link ? (link.elm.volts[link.num] ?? 0) : 0;
    }));
  });

  // ngspice's .dc of the source
  const dir = mkdtempSync(join(tmpdir(), "nfsim-"));
  try {
    const vectors = nodeIds.map((k) => `v(${net.nodeNames.get(k)})`).join(" ");
    writeFileSync(join(dir, "c.cir"), [
      "NodeForge DC sweep reference", net.text, ".options reltol=1e-6 abstol=1e-12 vntol=1e-9",
      `.dc ${report.source} ${start} ${stop} ${step}`, ".control", "run", `wrdata ref.dat ${vectors}`, ".endc", ".end",
    ].join("\n"));
    try {
      execFileSync(ngspiceExecutable(), ["-b", "c.cir"], { cwd: dir, stdio: "pipe", timeout: 60_000 });
    } catch (err) {
      report.error = `ngspice: ${String((err as { stderr?: Buffer }).stderr ?? err).split("\n").find((l) => l.trim()) ?? "failed"}`;
      return report;
    }
    if (!existsSync(join(dir, "ref.dat"))) {
      report.error = "ngspice wrote no result";
      return report;
    }
    // wrdata: sweep value, node value pairs for each vector on every row
    const rows = readFileSync(join(dir, "ref.dat"), "utf8").trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number));
    nodeIds.forEach((k, j) => {
      let max = 0, lo = Infinity, hi = -Infinity;
      for (const row of rows) {
        const v = row[0], ref = row[2 * j + 1];
        lo = Math.min(lo, ref);
        hi = Math.max(hi, ref);
        // the sweep value nearest (both step the same way)
        const got = ours.get(report.values[Math.round((v - start) / step)] ?? NaN);
        if (got) max = Math.max(max, Math.abs(got[j] - ref));
      }
      report.nodes.push({ node: net.nodeNames.get(k)!, max, swing: hi - lo });
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return report;
}

export interface AcReport {
  source: string | null;
  error: string | null;
  unsupported: string[];
  freqs: number[];
  /** Per node: the largest magnitude difference from ngspice (dB, where ngspice's is above −120 dB) and phase difference (degrees, likewise). */
  nodes: { node: string; db: number; deg: number }[];
}

/**
 * Small-signal (AC) analysis of the circuit with a unit AC value on one independent source
 * (`which`: 1 for the first…), at `perDecade` points per decade from fStart to fStop, compared node
 * by node with ngspice's `.ac dec` on the same source.
 */
export function acCompare(text: string, which: number, fStart: number, fStop: number, perDecade: number): AcReport {
  const report: AcReport = { source: null, error: null, unsupported: [], freqs: [], nodes: [] };
  const decades = Math.log10(fStop / fStart);
  if (!(decades > 0) || !(perDecade >= 1)) {
    report.error = "fStart, fStop and points per decade don't make a sweep";
    return report;
  }
  const n = Math.round(decades * perDecade);
  report.freqs = Array.from({ length: n + 1 }, (_, i) => fStart * 10 ** (i / perDecade));
  const exported = Circuit.parse(text);
  // the sources at their DC values (a wave at its offset), as the engine's operating point takes them
  const net = toSpice(exported, { dc: true });
  report.unsupported = net.unsupported;
  const target = sources(exported)[which - 1];
  report.source = target ? (net.sourceNames.get(target) ?? null) : null;
  if (!target || !report.source) {
    report.error = `no independent source ${which} (the circuit has ${sources(exported).length})`;
    return report;
  }
  if (net.unsupported.length) return report;
  const nodeIds = [...net.nodeNames.keys()].filter((k) => k !== 0).sort((a, b) => a - b);

  const c = Circuit.parse(text);
  const sim = new Simulator();
  sim.maxTimeStep = sim.timeStep = c.options.maxTimeStep;
  sim.accurate = true;
  sim.useCircuitOptions(c.options);
  sim.setElements(c.simulatedElements);
  sim.resetTime();
  const source = sources(c)[which - 1];
  const result = sim.acAnalysis(report.freqs, (m, rhs) => {
    if (source instanceof VoltageElm) {
      const vs = (source as unknown as { voltSource: { row: number; matrixIndex: number } | null }).voltSource;
      if (vs && sim.matrices[vs.matrixIndex] === m) rhs[vs.row - 1] = 1;
    } else {
      const [a, b] = [source.getNode(0), source.getNode(1)];
      if (a && a.row > 0 && sim.matrices[a.matrixIndex] === m) rhs[a.row - 1] -= 1;
      if (b && b.row > 0 && sim.matrices[b.matrixIndex] === m) rhs[b.row - 1] += 1;
    }
  });
  if (!result) {
    report.error = "NodeForge found no operating point";
    return report;
  }
  const ours = (k: number) => {
    const node = sim.nodeList[k];
    return node ? result.get(node) : undefined;
  };

  const dir = mkdtempSync(join(tmpdir(), "nfsim-"));
  try {
    // the source with AC 1 on its line
    const lines = net.text.split("\n").map((l) => (l.split(/\s+/)[0] === report.source ? `${l} AC 1` : l));
    const vectors = nodeIds.map((k) => `v(${net.nodeNames.get(k)})`).join(" ");
    writeFileSync(join(dir, "c.cir"), [
      "NodeForge AC reference", ...lines, ".options reltol=1e-6 abstol=1e-12 vntol=1e-9",
      `.ac dec ${perDecade} ${fStart} ${fStop}`, ".control", "run", `wrdata ref.dat ${vectors}`, ".endc", ".end",
    ].join("\n"));
    try {
      execFileSync(ngspiceExecutable(), ["-b", "c.cir"], { cwd: dir, stdio: "pipe", timeout: 60_000 });
    } catch (err) {
      report.error = `ngspice: ${String((err as { stderr?: Buffer }).stderr ?? err).split("\n").find((l) => l.trim()) ?? "failed"}`;
      return report;
    }
    if (!existsSync(join(dir, "ref.dat"))) {
      report.error = "ngspice wrote no result";
      return report;
    }
    // wrdata: frequency, real, imaginary for each vector on every row
    const rows = readFileSync(join(dir, "ref.dat"), "utf8").trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number));
    const db = (re: number, im: number) => 20 * Math.log10(Math.hypot(re, im));
    nodeIds.forEach((k, j) => {
      const o = ours(k);
      let dbMax = 0, degMax = 0;
      rows.forEach((row, i) => {
        const rr = row[3 * j + 1], ri = row[3 * j + 2];
        if (!o || i >= o.re.length || !(db(rr, ri) > -120)) return;
        dbMax = Math.max(dbMax, Math.abs(db(o.re[i], o.im[i]) - db(rr, ri)));
        let dp = ((Math.atan2(o.im[i], o.re[i]) - Math.atan2(ri, rr)) * 180) / Math.PI;
        dp = ((dp + 540) % 360) - 180;
        degMax = Math.max(degMax, Math.abs(dp));
      });
      report.nodes.push({ node: net.nodeNames.get(k)!, db: dbMax, deg: degMax });
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return report;
}
