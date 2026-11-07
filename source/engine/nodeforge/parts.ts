// What the NodeForge engine needs to know about parts, kept out of the CircuitJS part classes:
//  - reactive states: the values a part integrates over time (capacitor voltages, inductor
//    currents), as solved for the step being taken, each with an absolute tolerance (what's
//    negligible in its unit), for the truncation error estimate;
//  - breakpoints: when a part next changes abruptly, so steps land on it;
//  - recordings: array fields only written when a step is accepted (stepFinished), which taking a
//    rejected step back never touches, so snapshots skip them (they can be big).
// A part's subclasses share its entry (an NMOSFET is a MOSFET).
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { CircuitElm } from "../circuitjs/core/elm";
import { TransformerElm, TransLineElm } from "../circuitjs/elements/analog";
import { CustomTransformerElm, DCMotorElm } from "../circuitjs/elements/extras";
import { BatteryElm, DataRecorderElm } from "../circuitjs/elements/meters";
import { AudioOutputElm, TappedTransformerElm } from "../circuitjs/elements/more";
import { MosfetElm } from "../circuitjs/elements/mosfet";
import { ThreePhaseMotorElm } from "../circuitjs/elements/motors";
import { CapacitorElm, InductorElm } from "../circuitjs/elements/reactive";
import { RelayCoilElm, RelayElm } from "../circuitjs/elements/relays";
import { TransistorElm, VaractorElm } from "../circuitjs/elements/semis";
import { VoltageElm, Waveform } from "../circuitjs/elements/sources";
import { SpiceDiodeElm, SpiceZenerElm } from "./elements/spice-diode";
import { SpiceMosfetElm } from "./elements/spice-mosfet";
import { SpiceJfetElm } from "./elements/spice-jfet";
import { SpiceTransistorElm } from "./elements/spice-transistor";

type Class<T> = abstract new (...args: never[]) => T;
type States<T> = (e: T, values: number[], abstol: number[]) => void;

/** The entry for a part's class or its nearest ancestor with one (cached per class). */
function lookup<V>(table: Map<Function, V>, cache: Map<Function, V | null>, e: object): V | null {
  const cls = e.constructor;
  let hit = cache.get(cls);
  if (hit !== undefined) return hit;
  hit = null;
  for (let c: Function | null = cls; c && c !== CircuitElm && c !== Object; c = Object.getPrototypeOf(c)) {
    const v = table.get(c);
    if (v !== undefined) {
      hit = v;
      break;
    }
  }
  cache.set(cls, hit);
  return hit;
}

// MARK: reactive states

const STATES = new Map<Function, States<never>>();
function states<T>(cls: Class<T>, fn: States<T>): void {
  STATES.set(cls, fn as States<never>);
}
const coils = (e: { coilCurrents: number[] }, values: number[], abstol: number[]) => {
  for (const current of e.coilCurrents) {
    values.push(current);
    abstol.push(1e-9);
  }
};
const coil = (e: { ind: { current: number } }, values: number[], abstol: number[]) => {
  values.push(e.ind.current);
  abstol.push(1e-9);
};

states(CapacitorElm, (e, values, abstol) => {
  values.push(e.volts[0] - e.volts[e.capNode2]);
  abstol.push(1e-6);
});
states(InductorElm, coil);
states(RelayElm, coil);
states(RelayCoilElm, coil);
states(TransformerElm, coils);
states(TappedTransformerElm, coils);
states(CustomTransformerElm, coils);
states(ThreePhaseMotorElm, coils);
states(DCMotorElm, (e, values, abstol) => {
  values.push(e.ind.current, e.indInertia.current);
  abstol.push(1e-9, 1e-9);
});
// the internal polarization capacitance
states(BatteryElm, (e, values, abstol) => {
  values.push(e.volts[3] - e.volts[1]);
  abstol.push(1e-6);
});
// gate capacitances
states(MosfetElm, (e, values, abstol) => {
  const m = e.model!;
  if (m.capGS > 0) {
    values.push(e.volts[0] - e.volts[1]);
    abstol.push(1e-6);
  }
  if (m.capGD > 0) {
    values.push(e.volts[0] - e.volts[2]);
    abstol.push(1e-6);
  }
});
// junction capacitance voltages (models with capacitances)
states(TransistorElm, (e, values, abstol) => {
  const m = e.model;
  if (!m) return;
  if (m.junctionCapBE > 0 || m.transitTimeF > 0) {
    values.push(e.volts[0] - e.volts[2]);
    abstol.push(1e-6);
  }
  if (m.junctionCapBC > 0 || m.transitTimeR > 0) {
    values.push(e.volts[0] - e.volts[1]);
    abstol.push(1e-6);
  }
});
// the junction capacitance's voltage (anode to cathode)
states(VaractorElm, (e, values, abstol) => {
  values.push(e.volts[0] - e.volts[1]);
  abstol.push(1e-6);
});

// parts with SPICE models: their devices' charges
const devices = (e: { device: { states(v: number[], a: number[]): void } | null }, values: number[], abstol: number[]) => e.device?.states(values, abstol);
states(SpiceDiodeElm, devices);
states(SpiceZenerElm, devices);
states(SpiceMosfetElm, devices);
// a JFET on a SPICE device: its charges (and the CircuitJS model's gate capacitors); else CircuitJS's gate capacitances
states(SpiceJfetElm, (e, values, abstol) => {
  if (e.device) e.device.states(values, abstol);
  else STATES.get(MosfetElm)!(e as never, values, abstol);
});
// a transistor on a SPICE device: its charges; else CircuitJS's junction capacitances
states(SpiceTransistorElm, (e, values, abstol) => {
  if (e.device) e.device.states(values, abstol);
  else STATES.get(TransistorElm)!(e as never, values, abstol);
});

const statesCache = new Map<Function, States<never> | null>();

/** Push a part's reactive states (nothing for a part without any). */
export function reactiveStates(e: CircuitElm, values: number[], abstol: number[]): void {
  lookup(STATES, statesCache, e)?.(e as never, values, abstol);
}

// MARK: breakpoints

/**
 * When a part next changes abruptly after time t (Infinity: never). Sources: the next corner or
 * edge of the waveform (square and pulse edges, both ends of a ramp when there's a rise time,
 * triangle corners, sawtooth resets), or when a noise source's held value changes.
 */
export function nextBreakpoint(e: CircuitElm, t: number): number {
  if (!(e instanceof VoltageElm)) return Infinity;
  if (e.waveform === Waveform.noise) return e.noiseUntil > t ? e.noiseUntil : Infinity;
  const f = e.frequency;
  if (!(f > 0)) return Infinity;
  const half = (e.riseTime * f) / 2, duty = e.dutyCycle;
  let marks: number[];
  switch (e.waveform) {
    case Waveform.square:
    case Waveform.pulse:
      marks = half > 0 ? [-half, half, duty - half, duty + half] : [0, duty];
      break;
    case Waveform.triangle:
      marks = [0, 0.5];
      break;
    case Waveform.sawtooth:
      marks = [0];
      break;
    default:
      return Infinity;
  }
  // position in cycles at time t
  const offset = e.phaseShift / (2 * Math.PI);
  const c = (t - e.freqTimeZero) * f + offset;
  const n = Math.floor(c);
  let next = Infinity;
  for (let k = n - 1; k <= n + 1; k++) {
    for (const m of marks) {
      const time = e.freqTimeZero + (k + m - offset) / f;
      if (time > t && time < next) next = time;
    }
  }
  return next;
}

// MARK: recordings

const RECORDINGS = new Map<Function, readonly string[]>([
  [TransLineElm, ["voltageL", "voltageR", "waveT", "waveL", "waveR"]],
  [AudioOutputElm, ["data"]],
  [DataRecorderElm, ["data"]],
]);
const recordingsCache = new Map<Function, readonly string[] | null>();

/** A part's array fields that are recordings (snapshots skip them). */
export function recordingFields(obj: object): readonly string[] | null {
  return lookup(RECORDINGS, recordingsCache, obj);
}
