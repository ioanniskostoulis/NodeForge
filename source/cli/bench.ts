// nfsim bench: run circuits for a while and report which stop (convergence failure, singular
// matrix, exceptions) and how long they take, to track the solver's robustness and speed.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Circuit, Simulator, SparseLU } from "../engine";
import { SimulationModel } from "../app/model";
import { type DiagnosticSummary, summarizeDiagnostics } from "../app/recommend";

export interface BenchOptions {
  accurate: boolean;
  /** NodeForge solver with dense LU instead of sparse (for comparison). */
  dense?: boolean;
  relTol?: number;
  /** Simulated time, in each circuit's own time steps. */
  steps: number;
  /** Wall-clock limit per circuit (ms). */
  limitMs: number;
}

export interface BenchResult {
  file: string;
  /** Why it stopped early (not counting stop triggers, which are part of some circuits). */
  failure: string | null;
  /** How far it got (0–1). */
  reached: number;
  ms: number;
  steps: number;
  /** Size of the largest matrix (rows). */
  size: number;
  /** Sparse factorizations: pivot orders chosen, numeric refactorizations, reused unchanged. */
  lu: { analyzed: number; refactored: number; reused: number };
  /** NodeForge solver: what made it work, by part. */
  diagnostics: DiagnosticSummary | null;
}

export function bench(path: string, opts: BenchOptions): BenchResult {
  const file = basename(path);
  let circuit: Circuit;
  try {
    circuit = Circuit.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { file, failure: `load: ${(e as Error).message}`, reached: 0, ms: 0, steps: 0, size: 0, lu: { analyzed: 0, refactored: 0, reused: 0 }, diagnostics: null };
  }
  const sim = new Simulator();
  sim.maxTimeStep = circuit.options.maxTimeStep;
  sim.minTimeStep = circuit.options.minTimeStep;
  sim.adjustTimeStep = circuit.options.adjustTimeStep;
  sim.accurate = opts.accurate;
  if (opts.dense) sim.sparse = false;
  if (opts.relTol) sim.relTol = opts.relTol;
  if (process.env.NFSIM_LOG) sim.log = (m) => console.error(m);
  sim.useCircuitOptions(circuit.options);
  sim.setElements(circuit.simulatedElements);
  sim.resetTime();
  let steps = 0;
  sim.onTimeStep = () => steps++;
  const end = circuit.options.maxTimeStep * opts.steps;
  const t0 = performance.now();
  let failure: string | null = null;
  try {
    for (let guard = 0; sim.t < end && sim.stopMessage === null && performance.now() - t0 < opts.limitMs; guard++) {
      const before = sim.t;
      sim.update((n) => n >= 200 || performance.now() - t0 > opts.limitMs);
      if (sim.t === before && guard > 3) break; // nothing to simulate
    }
  } catch (e) {
    failure = `exception: ${(e as Error).message}`;
  }
  const msg = sim.stopMessage;
  if (!failure && msg && !circuit.elements.some((element) => element.constructor.name.includes("StopTrigger"))) failure = msg;
  const size = Math.max(0, ...sim.matrices.map((matrix) => matrix.size));
  const lu = { analyzed: 0, refactored: 0, reused: 0 };
  for (const matrix of sim.matrices) {
    if (!(matrix.solver instanceof SparseLU)) continue;
    lu.analyzed += matrix.solver.counts.analyzed;
    lu.refactored += matrix.solver.counts.refactored;
    lu.reused += matrix.solver.counts.reused;
  }
  let diagnostics: DiagnosticSummary | null = null;
  if (opts.accurate) {
    // designators as the app shows them
    const model = new SimulationModel(readFileSync(path, "utf8"));
    const names = model.circuit.elements.map((element, index) => model.designator(element) ?? `${element.constructor.name.replace(/^_/, "").replace(/Elm$/, "")}#${index}`);
    diagnostics = summarizeDiagnostics(sim, circuit.elements, names);
  }
  return { file, failure, reached: Math.min(1, sim.t / end), ms: performance.now() - t0, steps, size, lu, diagnostics };
}
