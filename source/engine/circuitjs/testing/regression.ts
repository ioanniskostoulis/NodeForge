// Replays a circuit carrying upstream TestManager reference data and compares the result.
// Behavior mirrors TestManager.java and ScopePlot.java from CircuitJS1 (Paul Falstad, Iain Sharp).
// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { CircuitElm } from "../core/elm";
import { Simulator } from "../core/simulator";
import { SwitchElm } from "../elements/basic";
import type { Circuit } from "../io/circuit";

/**
 * Records one trace the way ScopePlot does: per-bucket max values, one bucket per
 * speed × maxTimeStep of simulated time. Unlike the on-screen ring buffer it never wraps.
 */
class ScopeRecorder {
  maxValues = [0];
  ptr = 0;
  lastUpdateTime = 0;

  constructor(readonly elm: CircuitElm, readonly value: number, readonly speed: number) {}

  timeStep(sim: Simulator): void {
    const v = this.elm.getScopeValue(this.value);
    if (v > this.maxValues[this.ptr]) this.maxValues[this.ptr] = v;
    if (sim.t - this.lastUpdateTime >= sim.maxTimeStep * this.speed) {
      this.ptr++;
      this.maxValues.push(v);
      this.lastUpdateTime += sim.maxTimeStep * this.speed;
    }
  }

  /** The `count` completed buckets before the current one (what upstream dumps / compares). */
  completedBuckets(count: number): number[] {
    return Array.from({ length: count }, (_, j) => {
      const i = this.ptr - count + j;
      return i >= 0 ? this.maxValues[i] : 0;
    });
  }
}

export interface RegressionResult {
  name: string;
  status: "pass" | "fail" | "skip";
  details: string[];
  simulatedTime: number;
  /** Largest |actual - expected| / max(|expected|, 1e-9) over all compared samples. */
  maxRelativeError: number;
}

/** Relative tolerance used by upstream. */
export const TOLERANCE = 1e-3;

export function runRegression(circuit: Circuit, name: string): RegressionResult {
  const result: RegressionResult = { name, status: "pass", details: [], simulatedTime: 0, maxRelativeError: 0 };
  const test = circuit.test;
  if (!test || test.length <= 0) return { ...result, status: "skip", details: ["no <test> reference data"] };
  if (!circuit.isFullySupported) {
    const missing = [...circuit.unsupportedTypes].sort().map(([k, v]) => `${k}×${v}`);
    return { ...result, status: "skip", details: ["unported elements: " + missing.join(", ")] };
  }

  const sim = new Simulator();
  const o = circuit.options;
  sim.maxTimeStep = sim.timeStep = o.maxTimeStep;
  sim.minTimeStep = o.minTimeStep;
  sim.adjustTimeStep = o.adjustTimeStep;
  sim.solverType = o.solverType;
  sim.setElements(circuit.simulatedElements);

  // equivalent of the Reset button, as TestManager.startTest does
  sim.reset();
  if (o.autoDCOnReset) sim.dcAnalysisFlag = true;

  const recorders = test.scopeData.map((d) => new ScopeRecorder(circuit.elements[d.elementIndex], d.value, d.speed));
  let nextEvent = 0;
  let finished = false;
  sim.onTimeStep = () => recorders.forEach((r) => r.timeStep(sim));
  sim.clampTimeStep = (t, timeStep) => {
    // land exactly on the next switch event, or on the end of the test
    if (nextEvent < test.switchEvents.length) {
      const evTime = test.switchEvents[nextEvent].t;
      if (evTime > t && evTime < t + timeStep) return evTime - t;
    }
    if (test.length > t && test.length < t + timeStep) return test.length - t;
    return timeStep;
  };
  sim.checkTime = () => {
    let fired = false;
    while (nextEvent < test.switchEvents.length) {
      const ev = test.switchEvents[nextEvent];
      if (ev.t > sim.t) break;
      const sw = circuit.elements[ev.elementIndex];
      if (sw instanceof SwitchElm) {
        sw.toggle();
        fired = true;
      }
      nextEvent++;
    }
    if (fired) {
      sim.analyzeFlag = true;
      return true;
    }
    if (sim.t >= test.length) {
      finished = true;
      return true;
    }
    return false;
  };

  for (let safety = 0; !finished && sim.stopMessage === null && safety < 1_000_000; safety++) sim.update(() => false);

  result.simulatedTime = sim.t;
  if (sim.stopMessage !== null) return { ...result, status: "fail", details: [`simulation stopped: ${sim.stopMessage}`] };

  test.scopeData.forEach((ref, k) => {
    const actual = recorders[k].completedBuckets(ref.values.length);
    let mismatches = 0;
    let maxDiff = 0;
    let firstBad: string | null = null;
    ref.values.forEach((e, i) => {
      const a = actual[i];
      const diff = Math.abs(a - e);
      result.maxRelativeError = Math.max(result.maxRelativeError, diff / Math.max(Math.abs(e), 1e-9));
      if (diff > Math.max(TOLERANCE * Math.abs(e), 1e-9)) {
        mismatches++;
        maxDiff = Math.max(maxDiff, diff);
        firstBad ??= `ix ${i}: got ${a}, expected ${e}`;
      }
    });
    if (mismatches > 0) {
      result.status = "fail";
      result.details.push(
        `scope ${ref.scopeIndex} plot ${ref.plotIndex} (elm ${ref.elementIndex}, value ${ref.value}): ` +
          `${mismatches}/${ref.values.length} mismatches, max diff ${maxDiff}; first ${firstBad}`,
      );
    }
  });
  return result;
}
