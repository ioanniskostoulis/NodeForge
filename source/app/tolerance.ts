// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { CapacitorElm, type CircuitElm, InductorElm, MosfetElm, ResistorElm, SpiceMosfetElm, spiceModelOf, TransistorElm } from "../engine";

/** A MOSFET on a library model (or a custom one): its model's threshold and gain vary instead of the part's. */
const libraryMosfet = (e: CircuitElm): e is SpiceMosfetElm => e instanceof SpiceMosfetElm && !!e.spiceModel && e.modelThreshold() !== null;

/**
 * Each part uses its saved tolerance or its type's default. The seed, designator and parameter
 * fix a uniform deviation within ±tolerance. Varied values are installed only during a run;
 * the inspector, edits and saved circuit keep the nominal values.
 */

export type ToleranceKind = "resistance" | "capacitance" | "inductance" | "threshold" | "gain";

interface Param {
  kind: ToleranceKind;
  /** A part's tolerance field. */
  label: string;
  /** Symbol and unit for the part's info. */
  symbol: string;
  unit: string;
  applies(e: CircuitElm): boolean;
  get(e: CircuitElm): number;
  set(e: CircuitElm, v: number): void;
}

/** The parameters that vary, with the values the simulator reads while it steps. */
export const TOLERANCE_PARAMS: Param[] = [
  {
    kind: "resistance", label: "Tolerance", symbol: "R", unit: "Ω",
    applies: (e) => e instanceof ResistorElm,
    get: (e) => (e as ResistorElm).resistance,
    set: (e, v) => ((e as ResistorElm).resistance = v),
  },
  {
    kind: "capacitance", label: "Tolerance", symbol: "C", unit: "F",
    applies: (e) => e instanceof CapacitorElm,
    get: (e) => (e as CapacitorElm).capacitance,
    set: (e, v) => ((e as CapacitorElm).capacitance = v),
  },
  {
    // the Inductor helper holds the value the simulator uses
    kind: "inductance", label: "Tolerance", symbol: "L", unit: "H",
    applies: (e) => e instanceof InductorElm,
    get: (e) => (e as InductorElm).ind.inductance,
    set: (e, v) => ((e as InductorElm).ind.inductance = v),
  },
  {
    kind: "threshold", label: "Threshold tolerance", symbol: "Vt", unit: "V",
    applies: (e) => e instanceof MosfetElm,
    get: (e) => (libraryMosfet(e) ? e.modelThreshold()! : (e as MosfetElm).vt),
    set: (e, v) => {
      if (libraryMosfet(e)) e.variedVt = v === e.modelThreshold() ? null : v;
      else (e as MosfetElm).vt = v;
    },
  },
  {
    kind: "gain", label: "Beta tolerance", symbol: "β", unit: "",
    applies: (e) => e instanceof MosfetElm || e instanceof TransistorElm,
    get: (e) => (libraryMosfet(e) ? e.modelGain()! : (e as MosfetElm | TransistorElm).beta),
    set: (e, v) => {
      if (libraryMosfet(e)) e.variedGain = v === e.modelGain() ? null : v;
      else (e as MosfetElm | TransistorElm).beta = v;
    },
  },
];

/** Typical spreads: 1% resistors, 10% capacitors and inductors, threshold and gain vary more. */
export const DEFAULT_TOLERANCES: Record<ToleranceKind, number> = {
  resistance: 1,
  capacitance: 10,
  inductance: 10,
  threshold: 5,
  gain: 20,
};

/** A parameter's ± percent for a part: its own setting, or its type's default. */
export function tolerancePercent(e: CircuitElm, p: Param): number {
  return e.tolerance?.[p.kind] ?? DEFAULT_TOLERANCES[p.kind];
}

/** The parameters of a part that vary. */
export function toleranceParams(e: CircuitElm): Param[] {
  // a part with a SPICE model doesn't use the parameters these vary, except a MOSFET's model's
  // threshold and gain (a VDMOS's or level 1–3 card's VTO and KP, a subcircuit's MOSFETs')
  if (spiceModelOf(e) && !libraryMosfet(e)) return [];
  return TOLERANCE_PARAMS.filter((p) => p.applies(e));
}

export class Tolerance {
  enabled = false;
  seed = 1;
  /** Nominal values while the varied ones are in place. */
  private saved: [CircuitElm, Param, number][] = [];

  /** Deviation of one parameter of one part, as a factor (1.007 = +0.7%). */
  factor(designator: string, p: Param, percent: number): number {
    return 1 + (percent / 100) * unitNoise(`${this.seed}:${designator}:${p.kind}`);
  }

  /** Put the varied values in place (before the simulator runs). */
  apply(elements: readonly CircuitElm[], designator: (e: CircuitElm) => string | null): void {
    if (!this.enabled || this.saved.length) return;
    for (const e of elements) {
      const des = designator(e);
      if (!des) continue;
      for (const p of toleranceParams(e)) {
        const percent = tolerancePercent(e, p);
        if (!percent) continue;
        const nominal = p.get(e);
        this.saved.push([e, p, nominal]);
        p.set(e, nominal * this.factor(des, p, percent));
      }
    }
  }

  /** Put the nominal values back (after the simulator ran). */
  restore(): void {
    for (const [e, p, nominal] of this.saved) p.set(e, nominal);
    this.saved = [];
  }

  /** Each varied parameter of a part: symbol, actual value, unit, deviation in percent. */
  deviations(e: CircuitElm, designator: string | null): { symbol: string; value: number; unit: string; percent: number }[] {
    if (!this.enabled || !designator) return [];
    return toleranceParams(e).filter((p) => tolerancePercent(e, p)).map((p) => {
      const f = this.factor(designator, p, tolerancePercent(e, p));
      return { symbol: p.symbol, value: p.get(e) * f, unit: p.unit, percent: (f - 1) * 100 };
    });
  }
}

/** A repeatable pseudo-random number in [-1, 1) from a string (FNV-1a hash, then a Mulberry32 round). */
function unitNoise(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  let t = (h + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
}
