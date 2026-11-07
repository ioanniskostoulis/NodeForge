// The editable properties of each part: ports of the getEditInfo / setEditValue pairs of the
// CircuitJS1 elements (Paul Falstad, Iain Sharp and contributors). Indices match upstream, because
// slider definitions in circuit files refer to them. Buttons that open model editors are left out
// (their index is kept free).
// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { CircuitElm } from "../core/elm";
import { changeFlag, check, choice, type EditInfo, type EditInput, file, num, text, textarea } from "../core/editinfo";
import {
  AnalogSwitch2Elm, AnalogSwitchElm, ExtVoltageElm, LampElm, MemristorElm, NoiseElm, OpAmpElm, PotElm, SparkGapElm, SweepElm,
  Switch2Elm, TransformerElm, TransLineElm, VarRailElm,
} from "./analog";
import { CurrentElm, FuseElm, GroundElm, ResistorElm, SwitchElm, WireElm } from "./basic";
import { DiodeElm, DiodeModel, ZenerElm } from "./diode";
import { DiacElm, JfetElm, LEDElm, SCRElm, TransistorElm, TransistorModel, TriacElm, TriodeElm, VaractorElm } from "./semis";
import { LabeledNodeElm, OutputElm, ProbeElm, TextElm } from "./annotations";
import { BusSplitterElm, SRAMElm } from "./bus";
import {
  ADCElm, ChipElm, Counter2Elm, CounterElm, DACElm, DecimalDisplayElm, DeMultiplexerElm, DFlipFlopElm, FullAdderElm, JKFlipFlopElm, LatchElm,
  MonostableElm, MultiplexerElm, PisoShiftElm, RingCounterElm, SeqGenElm, SevenSegDecoderElm, SevenSegElm, SipoShiftElm, TFlipFlopElm, TimerElm,
} from "./chips";
import { VCCSElm } from "./controlled";
import { CustomLogicElm, CustomLogicModel } from "./customlogic";
import {
  AnalogMuxElm, BusTransceiverElm, CustomTransformerElm, DCMotorElm, DelayBufferElm, DPDTSwitchElm, LDRElm, MBBSwitchElm, OpAmpRealElm,
  OptocouplerElm, ThermistorNTCElm, TimeDelayRelayElm, TriStateElm,
} from "./extras";
import { CrossSwitchElm, LEDArrayElm } from "./more";
import { CustomCompositeElm, CustomCompositeModel } from "./composite";
import { CrystalElm, OTAElm } from "./compositeparts";
import { AMElm, AudioInputElm, BatteryElm, DataInputElm, DataRecorderElm, FMElm, StopTriggerElm, TestPointElm, WattmeterElm, WattmeterTrueElm } from "./meters";
import { MotorProtectionSwitchElm, ThreePhaseMotorElm } from "./motors";
import { BusLogicInputElm, InstructionDisplayElm } from "./bus";
import { GateElm, InverterElm, LogicInputElm, LogicOutputElm, XorGateElm } from "./logic";
import { MosfetElm, MosfetModel } from "./mosfet";
import { AmmeterElm, AudioOutputElm, GyratorElm, InvertingSchmittElm, PolarCapacitorElm, TappedTransformerElm } from "./more";
import { CapacitorElm, Inductor, InductorElm } from "./reactive";
import { RelayCoilElm, RelayContactElm, RelayElm, RelayModel } from "./relays";
import { RailElm, VoltageElm, Waveform } from "./sources";

type Ctor<E> = abstract new (...args: never[]) => E;
type Getter<E> = (e: E, n: number) => EditInfo | null;
type Setter<E> = (e: E, n: number, v: EditInput) => string | void;
interface Editor {
  get: Getter<CircuitElm>;
  set: Setter<CircuitElm>;
}

const table = new Map<unknown, Editor>();

function def<E extends CircuitElm>(C: Ctor<E>, get: Getter<E>, set: Setter<E>): void {
  table.set(C, { get: get as Getter<CircuitElm>, set: set as Setter<CircuitElm> });
}

/** The editor for an element's class, or the nearest base class with one (starting above `from`). */
function editorFor(e: CircuitElm, from?: Ctor<CircuitElm>): Editor | null {
  let p = from ? Object.getPrototypeOf(from.prototype) : Object.getPrototypeOf(e);
  while (p && p !== Object.prototype) {
    const ed = table.get(p.constructor);
    if (ed) return ed;
    p = Object.getPrototypeOf(p);
  }
  return null;
}

/** super.getEditInfo(n) from class C's editor. */
function superGet<E extends CircuitElm>(C: Ctor<E>, e: E, n: number): EditInfo | null {
  return editorFor(e, C)?.get(e, n) ?? null;
}
function superSet<E extends CircuitElm>(C: Ctor<E>, e: E, n: number, v: EditInput): string | void {
  return editorFor(e, C)?.set(e, n, v);
}

/** The editable property at upstream index `n`, or null if there is none. */
export function getEditInfo(e: CircuitElm, n: number): EditInfo | null {
  return editorFor(e)?.get(e, n) ?? null;
}

/**
 * Set the property at index `n`. Returns an error message if the value was rejected. The caller
 * must re-analyze the circuit (and redraw, as geometry may change).
 */
export function setEditValue(e: CircuitElm, n: number, v: EditInput): string | void {
  return editorFor(e)?.set(e, n, v);
}

/** All of an element's properties, with their indices. */
export function editInfos(e: CircuitElm): [number, EditInfo][] {
  const out: [number, EditInfo][] = [];
  for (let n = 0; n < 32; n++) {
    const ei = getEditInfo(e, n);
    if (ei) out.push([n, ei]);
  }
  return out;
}

const normalizedPhase = (degrees: number) => {
  const p = (degrees * Math.PI) / 180;
  return ((p % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
};

const FLAG_SHOW_BUS_VALUE = 4, FLAG_SHOW_BUS_VALUE_HEX = 8;
def(WireElm, (e, n) => {
  if (n === 0) return check("Show Current", (e.flags & WireElm.FLAG_SHOWCURRENT) !== 0);
  if (n === 1) return check("Show Voltage", (e.flags & WireElm.FLAG_SHOWVOLTAGE) !== 0);
  if (n === 2) return check("Show Bus Value", (e.flags & FLAG_SHOW_BUS_VALUE) !== 0);
  if (n === 3) return check("Show Bus Value (Hex)", (e.flags & FLAG_SHOW_BUS_VALUE_HEX) !== 0);
  return null;
}, (e, n, v) => {
  if (n === 0) e.flags = changeFlag(e.flags, WireElm.FLAG_SHOWCURRENT, v.checked);
  if (n === 1) e.flags = changeFlag(e.flags, WireElm.FLAG_SHOWVOLTAGE, v.checked);
  if (n === 2) e.flags = changeFlag(e.flags, FLAG_SHOW_BUS_VALUE, v.checked);
  if (n === 3) e.flags = changeFlag(e.flags, FLAG_SHOW_BUS_VALUE_HEX, v.checked);
});

def(GroundElm, (e, n) => (n === 0 ? choice("Symbol", ["Earth", "Chassis", "Signal", "Common"], e.symbolType) : null), (e, n, v) => {
  if (n === 0) e.symbolType = v.selected;
});

def(ResistorElm, (e, n) => (n === 0 ? num("Resistance (ohms)", e.resistance) : null), (e, n, v) => {
  if (n === 0) e.resistance = v.value <= 0 ? 1e-9 : v.value;
});

def(CapacitorElm, (e, n) => {
  if (n === 0) return num("Capacitance (F)", e.capacitance, 1e-6, 1e-3);
  if (n === 1) return check("Trapezoidal Approximation", e.isTrapezoidal);
  if (n === 2) return num("Initial Voltage (on Reset)", e.initialVoltage);
  if (n === 3) return num("Series Resistance", e.seriesResistance);
  return null;
}, (e, n, v) => {
  if (n === 0) e.capacitance = v.value > 0 ? v.value : 1e-12;
  if (n === 1) e.flags = changeFlag(e.flags, CapacitorElm.FLAG_BACK_EULER, !v.checked);
  if (n === 2) e.initialVoltage = v.value;
  if (n === 3) {
    e.seriesResistance = v.value;
    e.allocNodes();
  }
});

def(PolarCapacitorElm, (e, n) => (n === 4 ? num("Max Reverse Voltage", e.maxNegativeVoltage) : superGet(PolarCapacitorElm, e, n)), (e, n, v) => {
  if (n === 4) {
    if (v.value < 0) return "must be >= 0";
    e.maxNegativeVoltage = v.value;
  }
  return superSet(PolarCapacitorElm, e, n, v);
});

def(InductorElm, (e, n) => {
  if (n === 0) return num("Inductance (H)", e.inductance, 1e-2, 10, { positive: true });
  if (n === 1) return check("Trapezoidal Approximation", e.ind.isTrapezoidal);
  if (n === 2) return num("Initial Current (on Reset) (A)", e.initialCurrent);
  if (n === 3) return num("Saturation Current (A) (0=none)", e.saturationCurrent);
  return null;
}, (e, n, v) => {
  let err: string | undefined;
  if (n === 0) e.inductance = v.value;
  if (n === 1) e.flags = changeFlag(e.flags, Inductor.FLAG_BACK_EULER, !v.checked);
  if (n === 2) e.initialCurrent = v.value;
  if (n === 3) {
    if (v.value >= 0) e.saturationCurrent = v.value;
    else err = "must be >= 0";
  }
  e.ind.setup(e.inductance, e.current, e.flags, e.saturationCurrent);
  return err;
});

def(PotElm, (e, n) => {
  if (n === 0) return num("Resistance (ohms)", e.maxResistance);
  if (n === 1) return text("Slider Text", e.sliderText);
  if (n === 2) return check("Show Values", (e.flags & PotElm.FLAG_SHOW_VALUES) !== 0);
  if (n === 3) return num("Group Number (for linking)", e.link, -1, -1);
  return null;
}, (e, n, v) => {
  if (n === 0) e.maxResistance = v.value;
  if (n === 1) e.sliderText = v.text;
  if (n === 2) e.flags = changeFlag(e.flags, PotElm.FLAG_SHOW_VALUES, v.checked);
  if (n === 3) e.link = Math.trunc(v.value);
  e.setPoints();
});

def(TransformerElm, (e, n) => {
  if (n === 0) return num("Primary Inductance (H)", e.inductance, 0.01, 5, { positive: true });
  if (n === 1) return num("Ratio (N1/N2)", 1 / e.ratio, 1, 10, { dimensionless: true, positive: true });
  if (n === 2) return num("Coupling Coefficient", e.couplingCoef, 0, 1, { dimensionless: true, positive: true });
  if (n === 3) return check("Trapezoidal Approximation", e.isTrapezoidal());
  if (n === 4) return check("Swap Secondary Polarity", e.polarity === -1);
  if (n === 5) return num("Saturation Current (A) (0=none)", e.saturationCurrent);
  return null;
}, (e, n, v) => {
  if (n === 0 && v.value > 0) e.inductance = v.value;
  if (n === 1 && v.value > 0) e.ratio = 1 / v.value;
  if (n === 2) {
    if (!(v.value > 0 && v.value < 1)) return "must be > 0 and < 1";
    e.couplingCoef = v.value;
  }
  if (n === 3) e.flags = changeFlag(e.flags, TransformerElm.FLAG_BACK_EULER, !v.checked);
  if (n === 4) {
    e.polarity = v.checked ? -1 : 1;
    e.flags = changeFlag(e.flags, TransformerElm.FLAG_REVERSE, v.checked);
    e.setPoints();
  }
  if (n === 5) {
    if (v.value < 0) return "must be >= 0";
    e.saturationCurrent = v.value;
  }
});

def(TappedTransformerElm, (e, n) => {
  if (n === 0) return num("Primary Inductance (H)", e.inductance, 0.01, 5, { positive: true });
  if (n === 1) return num("Ratio (N1/N2)", 1 / e.ratio, 1, 10, { dimensionless: true, positive: true });
  if (n === 2) return num("Coupling Coefficient", e.couplingCoef, 0, 1, { dimensionless: true, positive: true });
  if (n === 3) return check("Trapezoidal Approximation", e.isTrapezoidal());
  return null;
}, (e, n, v) => {
  if (n === 0 && v.value > 0) e.inductance = v.value;
  if (n === 1 && e.ratio > 0) e.ratio = 1 / v.value;
  if (n === 2) {
    if (!(v.value > 0 && v.value < 1)) return "must be > 0 and < 1";
    e.couplingCoef = v.value;
  }
  if (n === 3) e.flags = changeFlag(e.flags, TappedTransformerElm.FLAG_BACK_EULER, !v.checked);
});

def(TransLineElm, (e, n) => {
  if (n === 0) return num("Delay (s)", e.delay, 0, 0, { positive: true });
  if (n === 1) return num("Impedance (ohms)", e.imped, 0, 0, { positive: true });
  return null;
}, (e, n, v) => {
  if (n === 0 && v.value > 0) {
    e.delay = v.value;
    e.reset();
  }
  if (n === 1 && v.value > 0) {
    e.imped = v.value;
    e.reset();
  }
});

def(MemristorElm, (e, n) => {
  if (n === 0) return num("Min Resistance (ohms)", e.r_on);
  if (n === 1) return num("Max Resistance (ohms)", e.r_off);
  if (n === 2) return num("Width of Doped Region (nm)", e.dopeWidth * 1e9);
  if (n === 3) return num("Total Width (nm)", e.totalWidth * 1e9);
  if (n === 4) return num("Mobility (um^2/(s*V))", e.mobility * 1e12);
  return null;
}, (e, n, v) => {
  if (n === 0) e.r_on = v.value;
  if (n === 1) e.r_off = v.value;
  if (n === 2) e.dopeWidth = v.value * 1e-9;
  if (n === 3) e.totalWidth = v.value * 1e-9;
  if (n === 4) e.mobility = v.value * 1e-12;
});

def(SparkGapElm, (e, n) => {
  if (n === 0) return num("On resistance (ohms)", e.onresistance);
  if (n === 1) return num("Off resistance (ohms)", e.offresistance);
  if (n === 2) return num("Breakdown voltage", e.breakdown);
  if (n === 3) return num("Holding current (A)", e.holdcurrent);
  return null;
}, (e, n, v) => {
  if (v.value > 0 && n === 0) e.onresistance = v.value;
  if (v.value > 0 && n === 1) e.offresistance = v.value;
  if (v.value > 0 && n === 2) e.breakdown = v.value;
  if (v.value > 0 && n === 3) e.holdcurrent = v.value;
});

def(LampElm, (e, n) => {
  if (n === 0) return num("Nominal Power", e.nom_pow, 0, 0, { positive: true });
  if (n === 1) return num("Nominal Voltage", e.nom_v, 0, 0, { positive: true, unitStep: true });
  if (n === 2) return num("Warmup Time (s)", e.warmTime, 0, 0, { positive: true });
  if (n === 3) return num("Cooldown Time (s)", e.coolTime, 0, 0, { positive: true });
  return null;
}, (e, n, v) => {
  if (n === 0 && v.value > 0) e.nom_pow = v.value;
  if (n === 1 && v.value > 0) e.nom_v = v.value;
  if (n === 2 && v.value > 0) e.warmTime = v.value;
  if (n === 3 && v.value > 0) e.coolTime = v.value;
});

def(SwitchElm, (e, n) => {
  if (n === 0) return check("Momentary Switch", e.momentary);
  if (n === 1) return check("IEC Symbol", (e.flags & SwitchElm.FLAG_IEC) !== 0);
  if (n === 2) return text("Label (for linking)", e.label ?? "");
  if (n === 3) return text("Keyboard Shortcut", e.keyShortcut ?? "");
  if (n === 4) return num("On Resistance (ohms)", e.resistance, 0, 0, { nonNegative: true });
  return null;
}, (e, n, v) => {
  if (n === 0) e.momentary = v.checked;
  if (n === 1) {
    e.flags = changeFlag(e.flags, SwitchElm.FLAG_IEC, v.checked);
    e.setPoints();
  }
  if (n === 2) {
    e.label = v.text.length ? v.text : null;
    e.flags = changeFlag(e.flags, SwitchElm.FLAG_LABEL, v.text.length > 0);
  }
  if (n === 3) e.keyShortcut = v.text.length ? v.text.substring(0, 1) : null;
  if (n === 4) e.resistance = v.value;
});

def(Switch2Elm, (e, n) => {
  if (n === 1) return num("Group Number (for linking)", e.link, 0, 100, { dimensionless: true, noSliders: true });
  if (n === 2) return num("# of Throws", e.throwCount, 2, 10, { dimensionless: true, noSliders: true });
  return superGet(Switch2Elm, e, n);
}, (e, n, v) => {
  if (n === 1) e.link = Math.trunc(v.value);
  else if (n === 2) {
    if (v.value >= 2) e.throwCount = Math.trunc(v.value);
    if (e.throwCount > 2) e.momentary = false;
    e.allocNodes();
    e.setPoints();
  } else return superSet(Switch2Elm, e, n, v);
});

def(AnalogSwitchElm, (e, n) => {
  if (n === 0) return check("Normally closed", e.hasFlag(AnalogSwitchElm.FLAG_INVERT));
  if (n === 1) return num("On Resistance (ohms)", e.r_on, 0, 0, { positive: true });
  if (n === 2) return num("Off Resistance (ohms)", e.r_off, 0, 0, { positive: true });
  if (n === 3) return check("Pulldown Resistor", e.needsPulldown());
  if (n === 4) return num("Threshold", e.threshold, 10, -10);
  return null;
}, (e, n, v) => {
  if (n === 0) e.flags = changeFlag(e.flags, AnalogSwitchElm.FLAG_INVERT, v.checked);
  if (n === 1 && v.value > 0) e.r_on = v.value;
  if (n === 2 && v.value > 0) e.r_off = v.value;
  if (n === 3) e.flags = changeFlag(e.flags, AnalogSwitchElm.FLAG_PULLDOWN, v.checked);
  if (n === 4) e.threshold = v.value;
});

def(AnalogSwitch2Elm, (e, n) => (n === 0 ? check("Swap NO/NC", e.hasFlag(AnalogSwitchElm.FLAG_INVERT)) : superGet(AnalogSwitch2Elm, e, n)), (e, n, v) => {
  if (n === 0) {
    e.flags = changeFlag(e.flags, AnalogSwitchElm.FLAG_INVERT, v.checked);
    return;
  }
  return superSet(AnalogSwitch2Elm, e, n, v);
});

def(RelayElm, (e, n) => {
  if (n === 0) {
    const models = RelayModel.getModelList();
    return choice("Model", models.map((m) => m.getDescription()), Math.max(0, models.indexOf(e.model!)));
  }
  return null;
}, (e, n, v) => {
  if (n !== 0) return;
  const m = RelayModel.getModelList()[v.selected];
  if (!m) return;
  e.setModel(m.name);
});

def(RelayCoilElm, (e, n) => {
  if (n === 0) return choice("Type", ["Normal", "On Delay", "Off Delay", "Latching", "Latching (Set Coil)", "Latching (Reset Coil)"], e.type);
  if (n === 1) return num("Inductance (H)", e.inductance, 0, 0, { positive: true });
  if (n === 2) return num("On Current (A)", e.onCurrent, 0, 0, { positive: true });
  if (n === 3) return num("Off Current (A)", e.offCurrent, 0, 0, { positive: true });
  if (n === 4) return num("Coil Resistance (ohms)", e.coilR, 0, 0, { positive: true });
  if (n === 5) return num("Switching Time (s)", e.switchingTime, 0, 0, { positive: true });
  if (n === 6) return text("Label (for linking)", e.label);
  return null;
}, (e, n, v) => {
  if (n === 0) {
    e.type = v.selected;
    e.setPoints();
  }
  if (n === 1 && v.value > 0) {
    e.inductance = v.value;
    e.ind.setup(e.inductance, e.coilCurrent, Inductor.FLAG_BACK_EULER);
  }
  if (n === 2 && v.value > 0) e.onCurrent = v.value;
  if (n === 3 && v.value > 0) e.offCurrent = v.value;
  if (n === 4 && v.value > 0) e.coilR = v.value;
  if (n === 5 && v.value > 0) e.switchingTime = v.value;
  if (n === 6) e.label = v.text;
});

def(RelayContactElm, (e, n) => {
  if (n === 0) return num("On Resistance (ohms)", e.r_on, 0, 0, { positive: true });
  if (n === 1) return num("Off Resistance (ohms)", e.r_off, 0, 0, { positive: true });
  if (n === 2) return text("Label (for linking)", e.label);
  if (n === 3) return check("Normally Closed", e.isNormallyClosed());
  if (n === 4) return check("IEC Symbol", e.hasFlag(RelayContactElm.FLAG_IEC));
  return null;
}, (e, n, v) => {
  if (n === 0 && v.value > 0) e.r_on = v.value;
  if (n === 1 && v.value > 0) e.r_off = v.value;
  if (n === 2) e.label = v.text;
  if (n === 3) e.flags = changeFlag(e.flags, RelayContactElm.FLAG_NORMALLY_CLOSED, v.checked);
  if (n === 4) {
    e.flags = changeFlag(e.flags, RelayContactElm.FLAG_IEC, v.checked);
    e.setPoints();
  }
});

def(VoltageElm, (e, n) => {
  const isRail = e instanceof RailElm;
  if (n === 0) return num(e.waveform === Waveform.dc ? "Voltage" : "Max Voltage", e.maxVoltage, -20, 20, { unitStep: true });
  if (n === 1) return choice("Waveform", ["D/C", "A/C", "Square Wave", "Triangle", "Sawtooth", "Pulse", "Noise"], e.waveform);
  if (n === 2) return num("DC Offset (V)", e.bias, -20, 20, { unitStep: true });
  if (n === 3) return num("Internal Resistance (ohms)", e.internalResistance, 0, 0, { nonNegative: true });
  if (n === 4 && !(isRail && (e.waveform === Waveform.dc || e.waveform === Waveform.variable))) {
    const sv = isRail ? VoltageElm.FLAG_SHOW_VOLTAGE_RAIL : VoltageElm.FLAG_SHOW_VOLTAGE;
    return check("Show Voltage", (e.flags & sv) !== 0);
  }
  if (n === 5 && e.waveform === Waveform.dc && !isRail) return check("Circle Symbol", (e.flags & VoltageElm.FLAG_CIRCLE_SYMBOL) !== 0);
  if (e.waveform === Waveform.dc || e.waveform === Waveform.noise) return null;
  const n2 = n - 5;
  const timing = e.waveform === Waveform.pulse || e.waveform === Waveform.square;
  const timeSpec = timing && e.hasFlag(VoltageElm.FLAG_TIME_SPEC);
  if (timing) {
    if (n2 === 0) return choice("Specify As", ["Frequency/Duty Cycle", "High Time/Low Time"], timeSpec ? 1 : 0);
    if (n2 === 1) return timeSpec ? num("High Time (s)", e.dutyCycle / e.frequency) : num("Frequency (Hz)", e.frequency, 4, 500);
    if (n2 === 2) return num("Phase Offset (degrees)", (e.phaseShift * 180) / Math.PI, -180, 180, { dimensionless: true });
    if (n2 === 3) return timeSpec ? num("Low Time (s)", (1 - e.dutyCycle) / e.frequency) : num("Duty Cycle", e.dutyCycle * 100, 0, 100, { dimensionless: true });
    if (n2 === 4) return num("Rise/Fall Time (s)", e.riseTime);
    return null;
  }
  if (n2 === 0) return num("Frequency (Hz)", e.frequency, 4, 500);
  if (n2 === 1) return num("Phase Offset (degrees)", (e.phaseShift * 180) / Math.PI, -180, 180, { dimensionless: true });
  return null;
}, (e, n, v) => {
  const isRail = e instanceof RailElm;
  if (n === 0) e.maxVoltage = v.value;
  if (n === 2) e.bias = v.value;
  if (n === 3) e.internalResistance = v.value;
  if (n === 4) e.flags = changeFlag(e.flags, isRail ? VoltageElm.FLAG_SHOW_VOLTAGE_RAIL : VoltageElm.FLAG_SHOW_VOLTAGE, v.checked);
  if (n === 5 && e.waveform === Waveform.dc && !isRail) {
    e.flags = changeFlag(e.flags, VoltageElm.FLAG_CIRCLE_SYMBOL, v.checked);
    e.setPoints();
  }
  if (n === 1) setWaveform(e, v.selected);
  const n2 = n - 5;
  const timing = e.waveform === Waveform.pulse || e.waveform === Waveform.square;
  const timeSpec = timing && e.hasFlag(VoltageElm.FLAG_TIME_SPEC);
  // items 0–4 and a DC source's 5 are handled above; from 5 on, the waveform's own (frequency first)
  if (n < 5 || (n === 5 && e.waveform === Waveform.dc)) return;
  if (timing) {
    if (n2 === 0) e.flags = changeFlag(e.flags, VoltageElm.FLAG_TIME_SPEC, v.selected === 1);
    if (n2 === 1) {
      if (timeSpec) {
        const lowTime = (1 - e.dutyCycle) / e.frequency;
        if (v.value > 0 && lowTime > 0) e.setFrequencyFromTimes(v.value, lowTime);
      } else if (v.value !== 0) e.setFrequency(v.value);
    }
    if (n2 === 2) e.phaseShift = normalizedPhase(v.value);
    if (n2 === 3) {
      if (timeSpec) {
        const highTime = e.dutyCycle / e.frequency;
        if (highTime > 0 && v.value > 0) e.setFrequencyFromTimes(highTime, v.value);
      } else e.dutyCycle = v.value * 0.01;
    }
    if (n2 === 4) e.riseTime = v.value;
  } else {
    if (n2 === 0 && e.waveform !== Waveform.dc && v.value !== 0) e.setFrequency(v.value);
    if (n2 === 1) e.phaseShift = normalizedPhase(v.value);
  }
});

/** Waveform choice of a voltage source (VoltageElm.setEditValue, item 1). */
export function setWaveform(e: VoltageElm, waveform: number): void {
  const ow = e.waveform;
  e.waveform = waveform;
  if (waveform === Waveform.dc && ow !== Waveform.dc) e.bias = 0;
  // change duty cycle if we're changing to or from pulse
  if (waveform === Waveform.pulse && ow !== Waveform.pulse) e.dutyCycle = VoltageElm.defaultPulseDuty;
  else if (ow === Waveform.pulse && waveform !== Waveform.pulse) e.dutyCycle = 0.5;
  e.setPoints();
}

def(VarRailElm, (e, n) => {
  if (n === 0) return num("Min Voltage", e.bias, -20, 20, { unitStep: true });
  if (n === 1) return num("Max Voltage", e.maxVoltage, -20, 20, { unitStep: true });
  if (n === 2) return text("Slider Text", e.sliderText);
  return null;
}, (e, n, v) => {
  if (n === 0) e.bias = v.value;
  if (n === 1) e.maxVoltage = v.value;
  if (n === 2) e.sliderText = v.text;
});

def(ExtVoltageElm, (e, n) => (n === 0 ? text("Name", e.name) : null), (e, n, v) => {
  if (n === 0) e.name = v.text;
});

def(NoiseElm, (e, n) => superGet(NoiseElm, e, n), (e, n, v) => superSet(NoiseElm, e, n, v));

def(SweepElm, (e, n) => {
  if (n === 0) return num("Min Frequency (Hz)", e.minF);
  if (n === 1) return num("Max Frequency (Hz)", e.maxF);
  if (n === 2) return num("Sweep Time (s)", e.sweepTime);
  if (n === 3) return check("Logarithmic", (e.flags & SweepElm.FLAG_LOG) !== 0);
  if (n === 4) return num("Max Voltage", e.maxV, 0, 0, { unitStep: true });
  if (n === 5) return check("Bidirectional", (e.flags & SweepElm.FLAG_BIDIR) !== 0);
  return null;
}, (e, n, v) => {
  const maxfreq = 1 / (8 * (e.sim?.timeStep ?? 5e-6));
  if (n === 0) e.minF = Math.min(v.value, maxfreq);
  if (n === 1) e.maxF = Math.min(v.value, maxfreq);
  if (n === 2) e.sweepTime = v.value;
  if (n === 3) e.flags = changeFlag(e.flags, SweepElm.FLAG_LOG, v.checked);
  if (n === 4) e.maxV = v.value;
  if (n === 5) e.flags = changeFlag(e.flags, SweepElm.FLAG_BIDIR, v.checked);
  e.setParams();
});

def(CurrentElm, (e, n) => {
  if (n === 0) return num("Current (A)", e.currentValue, 0, 0.1);
  if (n === 1) return num("Max Voltage (V, 0=unlimited)", e.maxVoltage, 0, 0, { unitStep: true });
  return null;
}, (e, n, v) => {
  if (n === 0) e.currentValue = v.value;
  if (n === 1 && v.value >= 0) e.maxVoltage = v.value;
});

def(FuseElm, (e, n) => {
  if (n === 0) return num("I2t", e.i2t, 0, 0, { positive: true });
  if (n === 1) return num("Resistance", e.resistance, 0, 0, { positive: true });
  if (n === 2) return check("IEC Symbol", e.isIECSymbol());
  return null;
}, (e, n, v) => {
  if (n === 0 && v.value > 0) e.i2t = v.value;
  if (n === 1 && v.value > 0) e.resistance = v.value;
  if (n === 2) {
    e.flags = changeFlag(e.flags, FuseElm.FLAG_IEC_SYMBOL, v.checked);
    e.setPoints();
  }
});

def(DiodeElm, (e, n) => {
  if (n === 0) {
    const models = DiodeModel.getModelList(e instanceof ZenerElm);
    const names = models.map((m) => m.getDescription());
    let sel = models.indexOf(e.model!);
    if (sel < 0) {
      // a model from the file that isn't in the list
      names.unshift(e.model!.oldStyle ? `${e.modelName} (from file)` : e.modelName);
      sel = 0;
    }
    return choice("Model", names, sel);
  }
  return null;
}, (e, n, v) => {
  if (n !== 0) return;
  const models = DiodeModel.getModelList(e instanceof ZenerElm);
  const offset = models.includes(e.model!) ? 0 : 1;
  const m = models[v.selected - offset];
  if (m) e.setModel(m.name);
});

def(LEDElm, (e, n) => {
  if (n === 0) return num("Red Value (0-1)", e.colorR, 0, 1, { dimensionless: true });
  if (n === 1) return num("Green Value (0-1)", e.colorG, 0, 1, { dimensionless: true });
  if (n === 2) return num("Blue Value (0-1)", e.colorB, 0, 1, { dimensionless: true });
  if (n === 3) return num("Max Brightness Current (A)", e.maxBrightnessCurrent, 0, 0.1);
  return superGet(LEDElm, e, n - 4);
}, (e, n, v) => {
  if (n === 0) e.colorR = v.value;
  if (n === 1) e.colorG = v.value;
  if (n === 2) e.colorB = v.value;
  if (n === 3) e.maxBrightnessCurrent = v.value;
  return superSet(LEDElm, e, n - 4, v);
});

def(VaractorElm, (e, n) => (n === 1 ? num("Capacitance @ 0V (F)", e.baseCapacitance, 10, 1000) : superGet(VaractorElm, e, n)), (e, n, v) => {
  if (n === 1) {
    e.baseCapacitance = v.value;
    return;
  }
  return superSet(VaractorElm, e, n, v);
});

def(TransistorElm, (e, n) => {
  if (n === 0) return num("Beta/hFE", e.beta, 10, 1000, { dimensionless: true });
  if (n === 1) return check("Swap E/C", (e.flags & TransistorElm.FLAG_FLIP) !== 0);
  if (n === 2) return check("Draw Circle", e.hasCircle);
  if (n === 3) {
    const models = TransistorModel.getModelList();
    return choice("Model", models.map((m) => m.getDescription()), Math.max(0, models.indexOf(e.model!)));
  }
  return null;
}, (e, n, v) => {
  if (n === 0) e.setBeta(v.value);
  if (n === 1) {
    e.flags = changeFlag(e.flags, TransistorElm.FLAG_FLIP, v.checked);
    e.setPoints();
  }
  if (n === 2) e.flags = changeFlag(e.flags, TransistorElm.FLAG_CIRCLE, v.checked);
  if (n === 3) {
    const m = TransistorModel.getModelList()[v.selected];
    if (m) e.setModel(m.name);
  }
});

def(MosfetElm, (e, n) => {
  if (n === 0) {
    const models = MosfetModel.getModelList(e.isJfet());
    let sel = models.indexOf(e.model!);
    const names = models.map((m) => m.getDescription());
    if (sel < 0) {
      names.unshift(e.modelName);
      sel = 0;
    }
    return choice("Model", names, sel);
  }
  if (n === 1) return check("Swap D/S", (e.flags & MosfetElm.FLAG_FLIP) !== 0);
  return null;
}, (e, n, v) => {
  if (n === 0) {
    const models = MosfetModel.getModelList(e.isJfet());
    const offset = models.includes(e.model!) ? 0 : 1;
    const m = models[v.selected - offset];
    if (m) e.setModel(m.name);
  } else if (n === 1) e.flags = changeFlag(e.flags, MosfetElm.FLAG_FLIP, v.checked);
  e.allocNodes();
  e.setPoints();
});

def(JfetElm, (e, n) => (n < 3 ? superGet(JfetElm, e, n) : null), (e, n, v) => superSet(JfetElm, e, n, v));

def(OpAmpElm, (e, n) => {
  if (n === 0) return num("Max Output (V)", e.maxOut, 1, 20);
  if (n === 1) return num("Min Output (V)", e.minOut, -20, 0);
  if (n === 2) return num("Gain", e.gain, 10, 1000000, { positive: true });
  return null;
}, (e, n, v) => {
  if (n === 0) e.maxOut = v.value;
  if (n === 1) e.minOut = v.value;
  if (n === 2) e.gain = v.value;
});

def(InvertingSchmittElm, (e, n) => {
  if (n === 0) return num("Lower threshold (V)", e.lowerTrigger, 0.01, 5);
  if (n === 1) return num("Upper threshold (V)", e.upperTrigger, 0.01, 5);
  if (n === 2) return num("Slew Rate (V/ns)", e.slewRate);
  if (n === 3) return num("High Logic Voltage", e.logicOnLevel, 0, 0, { unitStep: true });
  if (n === 4) return num("Low Voltage (V)", e.logicOffLevel, 0, 0, { unitStep: true });
  return null;
}, (e, n, v) => {
  // upstream keeps the edited thresholds in statics until both are known; this is the same
  let dlt = e.lowerTrigger, dut = e.upperTrigger;
  if (n === 0) dlt = v.value;
  if (n === 1) dut = v.value;
  if (n === 2) e.slewRate = v.value;
  if (n === 3) e.logicOnLevel = v.value;
  if (n === 4) e.logicOffLevel = v.value;
  e.upperTrigger = Math.max(dlt, dut);
  e.lowerTrigger = Math.min(dlt, dut);
});

def(AmmeterElm, (e, n) => {
  if (n === 0) return choice("Value", ["Current", "RMS Current"], e.meter);
  if (n === 1) return choice("Scale", ["Auto", "A", "mA", "µA"], e.scale);
  if (n === 2) return check("Circular Symbol", (e.flags & AmmeterElm.FLAG_CIRCLE) !== 0);
  return null;
}, (e, n, v) => {
  if (n === 0) e.meter = v.selected;
  if (n === 1) e.scale = v.selected;
  if (n === 2) e.flags = changeFlag(e.flags, AmmeterElm.FLAG_CIRCLE, v.checked);
});

def(GyratorElm, (e, n) => (n === 0 ? num("Gyration Resistance (Ω)", e.gyrResistance, 1, 0) : null), (e, n, v) => {
  if (n === 0 && v.value > 0) e.gyrResistance = v.value;
});

def(AudioOutputElm, (e, n) => {
  if (n === 0) return num("Duration (s)", e.duration, 0, 5, { positive: true });
  if (n === 1) {
    const rates = AudioOutputElm.samplingRateChoices;
    return choice("Sampling Rate", rates.map(String), Math.max(0, rates.indexOf(e.samplingRate)));
  }
  return null;
}, (e, n, v) => {
  if (n === 0 && v.value > 0) {
    e.duration = v.value;
    e.setDataCount();
  }
  if (n === 1) {
    const nsr = AudioOutputElm.samplingRateChoices[v.selected];
    if (nsr !== undefined && nsr !== e.samplingRate) {
      e.samplingRate = nsr;
      e.setDataCount();
    }
  }
});

const probeMeters = [0, 1, 10, 2, 3, 4, 5];
def(ProbeElm, (e, n) => {
  if (n === 0) return check("Show Value", (e.flags & ProbeElm.FLAG_SHOWVOLTAGE) !== 0);
  if (n === 1) return choice("Value", ["Voltage", "RMS Voltage", "Average Voltage", "Max Voltage", "Min Voltage", "P2P Voltage", "Binary Value"],
    Math.max(0, probeMeters.indexOf(e.meter)));
  if (n === 2) return choice("Scale", ["Auto", "V", "mV", "µV"], e.scale);
  if (n === 3) return check("Use Circle Symbol", (e.flags & ProbeElm.FLAG_CIRCLE) !== 0);
  if (n === 4) return num("Series Resistance (0 = infinite)", e.resistance);
  return null;
}, (e, n, v) => {
  if (n === 0) {
    // upstream replaces the flags when turning this on
    if (v.checked) e.flags = ProbeElm.FLAG_SHOWVOLTAGE;
    else e.flags &= ~ProbeElm.FLAG_SHOWVOLTAGE;
  }
  if (n === 1) e.meter = probeMeters[v.selected] ?? 0;
  if (n === 2) e.scale = v.selected;
  if (n === 3) e.flags = changeFlag(e.flags, ProbeElm.FLAG_CIRCLE, v.checked);
  if (n === 4) e.resistance = v.value;
});

def(OutputElm, (e, n) => {
  if (n === 0) return check("Show Voltage", e.showsVoltage);
  if (!e.showsVoltage) return null;
  if (n === 1) return choice("Scale", ["Auto", "V", "mV", "µV"], e.scale);
  if (e.scale === 0) return null;
  if (n === 2) return check("Fixed Precision", (e.flags & OutputElm.FLAG_FIXED) !== 0);
  return null;
}, (e, n, v) => {
  if (n === 0) e.flags = changeFlag(e.flags, OutputElm.FLAG_VALUE, v.checked);
  if (n === 1) e.scale = v.selected;
  if (n === 2) e.flags = changeFlag(e.flags, OutputElm.FLAG_FIXED, v.checked);
});

def(TextElm, (e, n) => {
  if (n === 0) return textarea("Text", e.text.replace(/\\n/g, "\n"));
  if (n === 1) return num("Size", e.size, 5, 100);
  if (n === 2) return check("Draw Bar On Top", (e.flags & TextElm.FLAG_BAR) !== 0);
  if (n === 3) return text("Color", e.color ?? "");
  return null;
}, (e, n, v) => {
  if (n === 0) e.setText(v.text);
  if (n === 1) e.size = Math.trunc(v.value);
  if (n === 2) e.flags = changeFlag(e.flags, TextElm.FLAG_BAR, v.checked);
  if (n === 3) e.color = v.text.length ? v.text : null;
});

def(LabeledNodeElm, (e, n) => {
  if (n === 0) return text("Text", e.text);
  if (n === 1) return check("Internal Node", e.isInternal);
  if (n === 2) return check("Rotate Text When Vertical", (e.flags & LabeledNodeElm.FLAG_ROTATE_TEXT) !== 0);
  return null;
}, (e, n, v) => {
  if (n === 0) e.text = v.text;
  if (n === 1) e.flags = changeFlag(e.flags, LabeledNodeElm.FLAG_INTERNAL, v.checked);
  if (n === 2) e.flags = changeFlag(e.flags, LabeledNodeElm.FLAG_ROTATE_TEXT, v.checked);
});

def(LogicInputElm, (e, n) => {
  if (n === 0) return check("Momentary Switch", e.momentary);
  if (n === 1) return num("High Logic Voltage", e.hiV, 10, -10, { unitStep: true });
  if (n === 2) return num("Low Voltage", e.loV, 10, -10, { unitStep: true });
  if (n === 3) return check("Numeric", e.isNumeric);
  if (n === 4) return check("Ternary", e.isTernary);
  if (n === 5) return text("Keyboard Shortcut", e.keyShortcut ?? "");
  return null;
}, (e, n, v) => {
  if (n === 0) e.momentary = v.checked;
  if (n === 1) e.hiV = v.value;
  if (n === 2) e.loV = v.value;
  if (n === 3) e.flags = changeFlag(e.flags, LogicInputElm.FLAG_NUMERIC, v.checked);
  if (n === 4) {
    e.flags = changeFlag(e.flags, LogicInputElm.FLAG_TERNARY, v.checked);
    e.posCount = e.isTernary ? 3 : 2;
  }
  if (n === 5) e.keyShortcut = v.text.length ? v.text.substring(0, 1) : null;
});

def(LogicOutputElm, (e, n) => {
  if (n === 0) return num("Threshold", e.threshold, 10, -10);
  if (n === 1) return check("Current Required", e.needsPullDown);
  if (n === 2) return check("Numeric", e.isNumeric);
  if (n === 3) return check("Ternary", e.isTernary);
  return null;
}, (e, n, v) => {
  if (n === 0) e.threshold = v.value;
  if (n === 1) e.flags = changeFlag(e.flags, LogicOutputElm.FLAG_PULLDOWN, v.checked);
  if (n === 2) e.flags = changeFlag(e.flags, LogicOutputElm.FLAG_NUMERIC, v.checked);
  if (n === 3) e.flags = changeFlag(e.flags, LogicOutputElm.FLAG_TERNARY, v.checked);
});

def(GateElm, (e, n) => {
  if (n === 0) return num("# of Inputs", e.inputCount, 1, 8, { dimensionless: true });
  if (n === 1) return num("High Logic Voltage", e.highVoltage, 1, 10, { unitStep: true });
  if (n === 2) return check("Schmitt Inputs", e.hasSchmittInputs);
  if (n === 3) return check("Invert Inputs", e.hasFlag(GateElm.FLAG_INVERT_INPUTS));
  if (n === 4) return num("Propagation Delay (s)", e.propagationDelay);
  if (n === 5) return check("DeMorgan's Symbol", e.hasFlag(GateElm.FLAG_DEMORGAN));
  return null;
}, (e, n, v) => {
  if (n === 0) {
    if (v.value < 1) return "must be >= 1";
    e.inputCount = Math.trunc(v.value);
    e.allocNodes();
    e.setupVolts();
    e.setPoints();
  }
  if (n === 1) e.highVoltage = GateElm.lastHighVoltage = v.value;
  if (n === 2) {
    e.flags = changeFlag(e.flags, GateElm.FLAG_SCHMITT, v.checked);
    e.setPoints();
  }
  if (n === 3) {
    // Invert Inputs and DeMorgan's Symbol are mutually exclusive
    e.flags = changeFlag(e.flags, GateElm.FLAG_INVERT_INPUTS, v.checked);
    if (v.checked) e.flags &= ~GateElm.FLAG_DEMORGAN;
    e.setPoints();
  }
  if (n === 4) e.propagationDelay = v.value;
  if (n === 5) {
    e.flags = changeFlag(e.flags, GateElm.FLAG_DEMORGAN, v.checked);
    if (v.checked) e.flags &= ~GateElm.FLAG_INVERT_INPUTS;
    e.setPoints();
  }
});

// XOR gates have no "Invert Inputs" (index 3); later items shift down
def(XorGateElm, (e, n) => superGet(XorGateElm, e, n >= 3 ? n + 1 : n), (e, n, v) => superSet(XorGateElm, e, n >= 3 ? n + 1 : n, v));

def(InverterElm, (e, n) => {
  if (n === 0) return num("Slew Rate (V/ns)", e.slewRate);
  if (n === 1) return num("High Logic Voltage", e.highVoltage, 1, 10, { unitStep: true });
  if (n === 2) return check("DeMorgan's Symbol", e.hasFlag(InverterElm.FLAG_DEMORGAN));
  return null;
}, (e, n, v) => {
  if (n === 0) e.slewRate = v.value;
  if (n === 1) e.highVoltage = GateElm.lastHighVoltage = v.value;
  if (n === 2) {
    e.flags = changeFlag(e.flags, InverterElm.FLAG_DEMORGAN, v.checked);
    e.setPoints();
  }
});

const chipTable = new Map<unknown, Editor>();

function defChip<E extends ChipElm>(C: Ctor<E>, get: Getter<E>, set: Setter<E>): void {
  chipTable.set(C, { get: get as Getter<CircuitElm>, set: set as Setter<CircuitElm> });
}

function chipEditorFor(e: ChipElm, from?: Ctor<ChipElm>): Editor | null {
  let p = from ? Object.getPrototypeOf(from.prototype) : Object.getPrototypeOf(e);
  while (p && p !== Object.prototype) {
    const ed = chipTable.get(p.constructor);
    if (ed) return ed;
    p = Object.getPrototypeOf(p);
  }
  return null;
}

/** Rebuild a chip's pins after a change. */
function repin(e: ChipElm): void {
  e.setupPins();
  e.allocNodes();
  e.setPoints();
}

def(ChipElm, (e, n) => {
  if (e.isDigitalChip()) {
    if (n === 0) return num("High Logic Voltage", e.highVoltage, 0, 0, { unitStep: true });
    n--;
  }
  if (e.allowBus()) {
    if (n === 0) return choice("Bit Order", ["MSB First", "LSB First", "Bus"], e.bitOrder);
    n--;
  }
  return chipEditorFor(e)?.get(e, n) ?? null;
}, (e, n, v) => {
  if (e.isDigitalChip()) {
    if (n === 0) {
      e.highVoltage = v.value;
      return;
    }
    n--;
  }
  if (e.allowBus()) {
    if (n === 0) {
      e.bitOrder = v.selected;
      repin(e);
      return;
    }
    n--;
  }
  return chipEditorFor(e)?.set(e, n, v);
});

/** "# of Bits" for chips whose only option is their width. */
function bitsEditor<E extends ChipElm>(C: Ctor<E>, min = 2): void {
  defChip(C, (e, n) => (n === 0 ? num("# of Bits", e.bits, 1, 1, { dimensionless: true }) : null), (e, n, v) => {
    if (n !== 0) return;
    if (v.value < min) return `must be >= ${min}`;
    e.bits = Math.trunc(v.value);
    repin(e);
  });
}

defChip(DFlipFlopElm, (e, n) => {
  if (n === 0) return check("Reset Pin", e.hasReset());
  if (n === 1) return check("Set Pin", e.hasSet());
  if (n === 2) return check("Invert Set/Reset", e.invertSetReset());
  return null;
}, (e, n, v) => {
  if (n === 0) {
    // (upstream's "flags &= ~FLAG_RESET|FLAG_SET" only clears the reset flag)
    e.flags = changeFlag(e.flags, DFlipFlopElm.FLAG_RESET, v.checked);
    repin(e);
  }
  if (n === 1) {
    e.flags = changeFlag(e.flags, DFlipFlopElm.FLAG_SET, v.checked);
    repin(e);
  }
  if (n === 2) {
    e.flags = changeFlag(e.flags, DFlipFlopElm.FLAG_INVERT_SET_RESET, v.checked);
    repin(e);
  }
});

defChip(JKFlipFlopElm, (e, n) => {
  if (n === 0) return check("Reset Pin", e.hasReset());
  if (n === 1) return check("Positive Edge Triggered", e.positiveEdgeTriggered());
  if (n === 2) return check("Invert Reset", e.invertReset());
  return null;
}, (e, n, v) => {
  if (n === 0) {
    e.flags = changeFlag(e.flags, JKFlipFlopElm.FLAG_RESET, v.checked);
    repin(e);
  }
  if (n === 1) {
    e.flags = changeFlag(e.flags, JKFlipFlopElm.FLAG_POSITIVE_EDGE, v.checked);
    e.pins[1].bubble = !e.positiveEdgeTriggered();
  }
  if (n === 2) {
    e.flags = changeFlag(e.flags, JKFlipFlopElm.FLAG_INVERT_RESET, v.checked);
    repin(e);
  }
});

defChip(TFlipFlopElm, (e, n) => {
  if (n === 0) return check("Reset Pin", e.hasReset());
  if (n === 1) return check("Set Pin", e.hasSet());
  return null;
}, (e, n, v) => {
  if (n === 0) e.flags = changeFlag(e.flags, TFlipFlopElm.FLAG_RESET, v.checked);
  if (n === 1) e.flags = changeFlag(e.flags, TFlipFlopElm.FLAG_SET, v.checked);
  if (n <= 1) repin(e);
});

defChip(CounterElm, (e, n) => {
  if (n === 0) return check("Invert reset pin", e.invertreset);
  if (n === 1) return num("# of Bits", e.bits, 1, 1, { dimensionless: true });
  if (n === 2) return num("Modulus", e.modulus, 1, 1, { dimensionless: true });
  if (n === 3) return check("Up/Down Pin", e.hasUpDown());
  if (n === 4) return check("Negative Edge Triggered", e.negativeEdgeTriggered());
  return null;
}, (e, n, v) => {
  if (n === 0) {
    e.invertreset = v.checked;
    repin(e);
  }
  if (n === 1) {
    if (v.value < 3) return "must be >= 3";
    e.bits = Math.trunc(v.value);
    repin(e);
  }
  if (n === 2) e.modulus = Math.trunc(v.value);
  if (n === 3) {
    e.flags = changeFlag(e.flags, CounterElm.FLAG_UP_DOWN, v.checked);
    repin(e);
  }
  if (n === 4) {
    e.flags = changeFlag(e.flags, CounterElm.FLAG_NEGATIVE_EDGE, v.checked);
    repin(e);
  }
});

defChip(Counter2Elm, (e, n) => {
  if (n === 0) return num("# of Bits", e.bits, 1, 1, { dimensionless: true });
  if (n === 1) return num("Modulus", e.modulus, 1, 1, { dimensionless: true });
  return null;
}, (e, n, v) => {
  if (n === 0) {
    if (v.value < 2) return "must be >= 2";
    e.bits = Math.trunc(v.value);
    repin(e);
  }
  if (n === 1) e.modulus = Math.trunc(v.value);
});

defChip(RingCounterElm, (e, n) => {
  if (n === 0) return check("Invert reset pin", e.hasInvertReset());
  if (n === 1) return num("# of Bits", e.bits, 1, 1, { dimensionless: true });
  return null;
}, (e, n, v) => {
  if (n === 0) {
    e.flags = changeFlag(e.flags, RingCounterElm.FLAG_RESET_HIGH, !v.checked);
    repin(e);
  }
  if (n === 1) {
    if (v.value < 2) return "must be >= 2";
    e.bits = Math.trunc(v.value);
    repin(e);
  }
});

defChip(LatchElm, (e, n) => {
  if (n === 0) return num("# of Bits", e.bits, 1, 1, { dimensionless: true });
  if (n === 1) return check("Edge Triggered", e.isEdgeTriggered());
  if (n === 2) return check("Reset Pin", e.hasReset());
  if (n === 3) return check("Set Pin", e.hasSet());
  if (n === 4) return choice("Enable Pins", ["None", "1 Input/Output Enable", "2 Input/Output Enables"], e.enableMode());
  if (n === 5 && e.hasReset()) return check("Invert Reset", e.resetActiveLow());
  return null;
}, (e, n, v) => {
  if (n === 0) {
    if (v.value < 2) return "must be >= 2";
    e.bits = Math.trunc(v.value);
  }
  if (n === 1) e.flags = changeFlag(e.flags, LatchElm.FLAG_NO_EDGE, !v.checked);
  if (n === 2) e.flags = changeFlag(e.flags, LatchElm.FLAG_RESET, v.checked);
  if (n === 3) e.flags = changeFlag(e.flags, LatchElm.FLAG_SET, v.checked);
  if (n === 4) e.flags = (e.flags & ~LatchElm.FLAG_ENABLE_MASK) | (v.selected << LatchElm.FLAG_ENABLE_SHIFT);
  if (n === 5) e.flags = changeFlag(e.flags, LatchElm.FLAG_RESET_INVERT, v.checked);
  repin(e);
});

defChip(FullAdderElm, (e, n) => (n === 0 ? num("# of Bits", e.bits, 1, 1, { dimensionless: true, positive: true }) : null), (e, n, v) => {
  if (n !== 0) return;
  e.bits = Math.trunc(v.value);
  e.flags |= FullAdderElm.FLAG_BITS;
  repin(e);
});

defChip(MultiplexerElm, (e, n) => {
  if (n === 0) return num("# of Select Bits", e.selectBitCount, 1, 8, { dimensionless: true });
  if (n === 1) return check("Inverted Output", e.hasFlag(MultiplexerElm.FLAG_INVERTED_OUTPUT));
  if (n === 2) return check("Strobe Pin", e.hasFlag(MultiplexerElm.FLAG_STROBE));
  if (n === 3) return choice("Input Mode", ["Individual Inputs", "Bus Input (Bit Select)", "Bus Input/Output"], e.inputMode);
  if (n === 4) return check("Bus Select", e.busSelect());
  if (n === 5 && e.inputMode === 2) return num("Data Bus Width", e.dataBusWidth, 2, 32, { dimensionless: true });
  return null;
}, (e, n, v) => {
  if (n === 0) {
    if (!(v.value >= 1 && v.value <= 6)) return "must be between 1 and 6";
    e.selectBitCount = Math.trunc(v.value);
  }
  if (n === 1) e.flags = changeFlag(e.flags, MultiplexerElm.FLAG_INVERTED_OUTPUT, v.checked);
  if (n === 2) e.flags = changeFlag(e.flags, MultiplexerElm.FLAG_STROBE, v.checked);
  if (n === 3) e.inputMode = v.selected;
  if (n === 4) e.flags = changeFlag(e.flags, MultiplexerElm.FLAG_BUS_SELECT, v.checked);
  if (n === 5) {
    if (v.value < 2) return "must be >= 2";
    e.dataBusWidth = Math.trunc(v.value);
  }
  repin(e);
});

defChip(DeMultiplexerElm, (e, n) => {
  if (n === 0) return num("# of Select Bits", e.selectBitCount, 0, 0, { dimensionless: true });
  if (n === 1) return choice("Output Mode", ["Individual Outputs", "Bus Output (Bit Distribute)", "Bus Input/Output"], e.outputMode);
  if (n === 2) return check("Bus Select", e.busSelect());
  if (n === 3) return check("Keep Inactive Outputs High (74139)", e.hasFlag(DeMultiplexerElm.FLAG_INVERT_OUTPUTS));
  if (n === 4 && e.outputMode === 2) return num("Data Bus Width", e.dataBusWidth, 2, 32, { dimensionless: true });
  return null;
}, (e, n, v) => {
  if (n === 0) {
    if (!(v.value >= 1 && v.value <= 6)) return "must be between 1 and 6";
    e.selectBitCount = Math.trunc(v.value);
  }
  if (n === 1) e.outputMode = v.selected;
  if (n === 2) e.flags = changeFlag(e.flags, DeMultiplexerElm.FLAG_BUS_SELECT, v.checked);
  if (n === 3) e.flags = changeFlag(e.flags, DeMultiplexerElm.FLAG_INVERT_OUTPUTS, v.checked);
  if (n === 4) {
    if (v.value < 2) return "must be >= 2";
    e.dataBusWidth = Math.trunc(v.value);
  }
  repin(e);
});

defChip(SevenSegElm, (e, n) => {
  if (n === 0) return choice("Segments", ["7 Segment", "14 Segment", "16 Segment"], e.baseSegmentCount === 7 ? 0 : e.baseSegmentCount === 14 ? 1 : 2);
  if (n === 1) return choice("Extra Segment", ["None", "Decimal Point", "Colon"], e.extraSegment);
  if (n === 2) return choice("Diodes", ["Common Cathode", "Common Anode", "None (logic inputs)"], e.diodeDirection === 1 ? 0 : e.diodeDirection === -1 ? 1 : 2);
  return null;
}, (e, n, v) => {
  if (n === 0) e.baseSegmentCount = v.selected === 0 ? 7 : v.selected === 1 ? 14 : 16;
  if (n === 1) e.extraSegment = v.selected;
  if (n === 2) e.diodeDirection = v.selected === 0 ? 1 : v.selected === 1 ? -1 : 0;
  if (n <= 2) {
    e.setPinCount();
    e.allocNodes();
    e.setPoints();
  }
});

defChip(SevenSegDecoderElm, (e, n) => {
  if (n === 0) return choice("Segments", ["7 Segment", "14 Segment", "16 Segment"], e.segmentType);
  if (n === 1) return check("Blank Pin", e.hasBlank());
  if (n === 2) return check("Blank on 1111", e.blankOnF());
  return null;
}, (e, n, v) => {
  if (n === 0) {
    e.segmentType = v.selected;
    repin(e);
  }
  if (n === 1) {
    e.flags = changeFlag(e.flags, SevenSegDecoderElm.FLAG_ENABLE, v.checked);
    repin(e);
  }
  if (n === 2) e.flags = changeFlag(e.flags, SevenSegDecoderElm.FLAG_BLANK_F, v.checked);
});

defChip(DecimalDisplayElm, (e, n) => {
  if (n === 0) return num("# of Bits", e.bitCount, 1, 8, { dimensionless: true });
  if (n === 1) return choice("Display Mode", ["Decimal", "Hexadecimal", "Octal"], e.displayMode);
  return null;
}, (e, n, v) => {
  if (n === 0) {
    if (!(v.value >= 1 && v.value <= 16)) return "must be between 1 and 16";
    const nb = Math.trunc(v.value);
    if (nb !== e.bitCount) {
      e.bitCount = nb;
      repin(e);
    }
  }
  if (n === 1) e.displayMode = v.selected;
});

bitsEditor(ADCElm);
bitsEditor(DACElm);
bitsEditor(BusSplitterElm);

defChip(TimerElm, (e, n) => {
  if (n === 0) return check("Ground Pin", e.hasGroundPin());
  if (n === 1) return check("Show Pin Numbers", !e.usePinNames());
  return null;
}, (e, n, v) => {
  if (n === 0) {
    e.flags = changeFlag(e.flags, TimerElm.FLAG_GROUND, v.checked);
    e.allocNodes();
    e.setPoints();
  }
  if (n === 1) {
    e.flags = changeFlag(e.flags, TimerElm.FLAG_NUMBERS, v.checked);
    repin(e);
  }
});

defChip(MonostableElm, (e, n) => {
  if (n === 0) return check("Retriggerable", e.retriggerable);
  if (n === 1) return num("Period (s)", e.delay, 0.001, 0.1);
  return null;
}, (e, n, v) => {
  if (n === 0) e.retriggerable = v.checked;
  if (n === 1) e.delay = v.value;
});

defChip(SipoShiftElm, (e, n) => (n === 0 ? num("# of Bits", e.bits, 1, 1, { dimensionless: true }) : null), (e, n, v) => {
  if (n === 0 && v.value !== e.bits && v.value >= 1) {
    e.bits = Math.trunc(v.value);
    repin(e);
  }
});

defChip(PisoShiftElm, (e, n) => (n === 0 ? num("# of Bits", e.bits, 1, 1, { dimensionless: true }) : null), (e, n, v) => {
  if (n === 0 && v.value !== e.bits && v.value >= 1) {
    e.bits = Math.trunc(v.value);
    e.data = new Array<boolean>(e.bits).fill(false);
    repin(e);
  }
});

defChip(SeqGenElm, (e, n) => {
  if (n === 0) return check("Play Once", e.hasPlayOnce());
  if (n === 1) {
    let s = "";
    for (let i = 0; i < e.bitCount; i++) s += (e.data[Math.trunc(i / 32)] & (1 << (i % 32))) !== 0 ? "1" : "0";
    return textarea("Sequence", s);
  }
  return null;
}, (e, n, v) => {
  if (n === 0) e.flags = changeFlag(e.flags, SeqGenElm.FLAG_PLAY_ONCE, v.checked);
  if (n === 1) {
    const bits = [...v.text].filter((c) => c === "0" || c === "1");
    // (upstream sizes the array with bitCount/32, losing a partial last word; this keeps it)
    const data = new Array<number>(Math.max(1, Math.ceil(bits.length / 32))).fill(0);
    bits.forEach((c, i) => {
      if (c === "1") data[Math.trunc(i / 32)] |= 1 << (i % 32);
    });
    e.bitCount = bits.length;
    e.data = data;
  }
});

defChip(CustomLogicElm, (e, n) => (n === 0 ? { ...text("Model Name", e.modelName ?? ""), noSliders: true } : null), (e, n, v) => {
  if (n !== 0 || v.text === e.modelName) return;
  e.modelName = CustomLogicElm.lastModelName = v.text;
  e.model = CustomLogicModel.getModelWithNameOrCopy(e.modelName, e.model);
  repin(e);
});

defChip(LEDArrayElm, (e, n) => {
  if (n === 0) return num("Grid Width", e.sizeX, 0, 0, { dimensionless: true });
  if (n === 1) return num("Grid Height", e.sizeY, 0, 0, { dimensionless: true });
  return null;
}, (e, n, v) => {
  if (!(v.value >= 2 && v.value <= 16)) return "must be between 2 and 16";
  if (n === 0) e.sizeX = Math.trunc(v.value);
  if (n === 1) e.sizeY = Math.trunc(v.value);
  repin(e);
});

defChip(SRAMElm, (e, n) => {
  if (n === 0) return num("# of Address Bits", e.addressBits, 1, 1, { dimensionless: true });
  if (n === 1) return num("# of Data Bits", e.dataBits, 1, 1, { dimensionless: true });
  if (n === 2) return textarea("Contents", e.contentsToString());
  if (n === 3) return check("Hex Display", e.hasFlag(SRAMElm.FLAG_HEX_DISPLAY));
  // index 4 is upstream's "Load Contents From File"
  if (n === 5) return check("Restore Contents on Reset", (e.flags & SRAMElm.FLAG_RELOAD_ON_RESET) !== 0);
  return null;
}, (e, n, v) => {
  if (n === 0 || n === 1) {
    if (!(v.value >= 2 && v.value <= 16)) return "must be between 2 and 16";
    if (n === 0) e.addressBits = Math.trunc(v.value);
    else e.dataBits = Math.trunc(v.value);
    repin(e);
  }
  if (n === 2) {
    e.parseContentsString(v.text);
    if ((e.flags & SRAMElm.FLAG_RELOAD_ON_RESET) !== 0) e.initialMap = new Map(e.map);
  }
  if (n === 3) e.flags = changeFlag(e.flags, SRAMElm.FLAG_HEX_DISPLAY, v.checked);
  if (n === 5) {
    e.flags = changeFlag(e.flags, SRAMElm.FLAG_RELOAD_ON_RESET, v.checked);
    e.initialMap = v.checked ? new Map(e.map) : null;
  }
});

defChip(AnalogMuxElm, (e, n) => {
  if (n === 0) return num("# of Select Bits", e.selectBitCount, 1, 8, { dimensionless: true });
  if (n === 1) return num("On Resistance (ohms)", e.r_on, 0, 0, { positive: true });
  if (n === 2) return num("Off Resistance (ohms)", e.r_off, 0, 0, { positive: true });
  if (n === 3) return num("Threshold Voltage", e.threshold);
  if (n === 4) return check("Pulldown Resistor", e.needsPulldown());
  return null;
}, (e, n, v) => {
  if (n === 0) {
    if (!(v.value >= 1 && v.value <= 6)) return "must be between 1 and 6";
    e.selectBitCount = Math.trunc(v.value);
    repin(e);
  }
  if (n === 1 && v.value > 0) e.r_on = v.value;
  if (n === 2 && v.value > 0) e.r_off = v.value;
  if (n === 3) e.threshold = v.value;
  if (n === 4) e.flags = changeFlag(e.flags, AnalogMuxElm.FLAG_PULLDOWN, v.checked);
});

defChip(BusTransceiverElm, (e, n) => (n === 0 ? num("# of Bits", e.dataBits, 1, 1, { dimensionless: true }) : null), (e, n, v) => {
  if (n !== 0) return;
  if (!(v.value >= 1 && v.value <= 16)) return "must be between 1 and 16";
  e.dataBits = Math.trunc(v.value);
  repin(e);
});

defChip(TimeDelayRelayElm, (e, n) => {
  if (n === 0) return num("On Delay (s)", e.onDelay);
  if (n === 1) return num("Off Delay (s)", e.offDelay);
  if (n === 2) return num("On Resistance (ohms)", e.onResistance, 0, 0, { positive: true });
  if (n === 3) return num("Off Resistance (ohms)", e.offResistance, 0, 0, { positive: true });
  return null;
}, (e, n, v) => {
  if (n === 0) e.onDelay = v.value;
  if (n === 1) e.offDelay = v.value;
  if (n === 2) e.onResistance = v.value;
  if (n === 3) e.offResistance = v.value;
});

defChip(VCCSElm, (e, n) => {
  if (n === 0) return { ...text("Output Function", e.exprString), noSliders: true };
  if (n === 1) return num("# of Inputs", e.inputCount, 1, 8, { dimensionless: true });
  return null;
}, (e, n, v) => {
  if (n === 0) {
    e.setExpr(v.text);
    if (e.exprError) return `Parse error in expression: ${e.exprString}: ${e.exprError}`;
  }
  if (n === 1) e.setInputCount(Math.trunc(v.value));
});

def(CustomCompositeElm, (e, n) => {
  // an internal model can't be changed
  if (e.model?.internal) n += 2;
  if (n === 0) {
    const models = CustomCompositeModel.getModelList();
    const names = models.map((m) => m.name);
    let sel = e.model ? models.indexOf(e.model) : -1;
    if (sel < 0) {
      names.unshift(e.model ? e.model.name : `Model not found: ${e.modelName}`);
      sel = 0;
    }
    return choice("Model Name", names, sel);
  }
  if (!e.model) return null;
  // 1, 2: upstream's pin layout editor and component viewer
  if (n === 3) return num("High Logic Voltage (0=default)", e.highVoltage, 0, 10, { unitStep: true });
  return null;
}, (e, n, v) => {
  if (e.model?.internal) n += 2;
  if (n === 0) {
    const models = CustomCompositeModel.getModelList();
    const offset = e.model && models.includes(e.model) ? 0 : 1;
    const m = models[v.selected - offset];
    if (!m) return;
    CustomCompositeElm.lastModelName = e.modelName = m.name;
    e.updateModels();
    e.setPoints();
  }
  if (n === 3) {
    e.highVoltage = v.value;
    e.propagateHighVoltage();
  }
});

def(CrystalElm, (e, n) => {
  if (n === 0) return num("Parallel Capacitance", e.parallelCapacitance, 0, 0, { positive: true });
  if (n === 1) return num("Series Capacitance (F)", e.seriesCapacitance, 0, 0, { positive: true });
  if (n === 2) return num("Inductance (H)", e.inductance, 0, 0, { positive: true });
  if (n === 3) return num("Resistance (ohms)", e.resistance, 0, 0, { positive: true });
  if (n === 4) return check("Show Frequency", e.hasFlag(CrystalElm.FLAG_SHOW_FREQ));
  return null;
}, (e, n, v) => {
  if (n === 0 && v.value > 0) e.parallelCapacitance = v.value;
  if (n === 1 && v.value > 0) e.seriesCapacitance = v.value;
  if (n === 2 && v.value > 0) e.inductance = v.value;
  if (n === 3 && v.value > 0) e.resistance = v.value;
  if (n === 4) e.flags = changeFlag(e.flags, CrystalElm.FLAG_SHOW_FREQ, v.checked);
  e.initCrystal();
});

def(OTAElm, (e, n) => {
  if (n === 0) return num("Positive Supply Voltage (5-20V)", e.posVolt, 5, 20, { unitStep: true });
  if (n === 1) return num("Negative Supply Voltage (V)", e.negVolt, -20, -5, { unitStep: true });
  return null;
}, (e, n, v) => {
  if (n === 0) e.posVolt = v.value;
  if (n === 1) e.negVolt = v.value;
  e.initOTA();
});

def(OptocouplerElm, (e, n) => {
  if (n === 0) return num("CTR Scale", e.ctr, 0, 0, { dimensionless: true });
  if (n === 1) {
    const models = DiodeModel.getModelList(false);
    return choice("LED Model", models.map((m) => m.getDescription()), Math.max(0, models.indexOf(e.diode.model!)));
  }
  return null;
}, (e, n, v) => {
  if (n === 0 && v.value > 0) {
    e.ctr = v.value;
    e.initOptocoupler();
  }
  if (n === 1) {
    const m = DiodeModel.getModelList(false)[v.selected];
    if (m) e.diode.setModel(m.name);
  }
});

def(OpAmpRealElm, (e, n) => {
  const T = OpAmpRealElm;
  if (n === 0) {
    // the old LM324 model is only offered to circuits that already use it
    if (e.modelType === T.MODEL_324) return choice("Model", ["LM741", "LM324, old", "LM324, fixed"], e.modelType);
    return choice("Model", ["LM741", "LM324"], e.modelType === T.MODEL_741 ? 0 : 1);
  }
  if (n === 1) return check("Swap Inputs", (e.flags & T.FLAG_SWAP) !== 0);
  if (e.modelType === T.MODEL_324v2) return null;
  if (n === 2) return num("Slew Rate (V/usec)", e.slewRate);
  if (n === 3) return num("Output Current Limit (A)", e.currentLimit);
  return null;
}, (e, n, v) => {
  const T = OpAmpRealElm;
  if (n === 0) {
    const twoChoices = e.modelType !== T.MODEL_324;
    e.modelType = twoChoices && v.selected === 1 ? T.MODEL_324v2 : v.selected;
    e.capValue = 0;
    e.initModel();
  }
  if (n === 1) {
    e.flags = changeFlag(e.flags, T.FLAG_SWAP, v.checked);
    e.setPoints();
  }
  if (n === 2) {
    e.slewRate = v.value;
    e.initModel();
  }
  if (n === 3) {
    e.currentLimit = v.value;
    e.initModel();
  }
});

def(TriodeElm, (e, n) => {
  if (n === 0) return num("mu", e.mu, 0, 0, { dimensionless: true, positive: true });
  if (n === 1) return num("kg1", e.kg1, 0, 0, { dimensionless: true, positive: true });
  return null;
}, (e, n, v) => {
  if (n === 0) e.mu = v.value;
  if (n === 1) e.kg1 = v.value;
});

def(TriacElm, (e, n) => {
  if (n === 0) return num("Trigger Current (A)", e.triggerI, 0, 0, { positive: true });
  if (n === 1) return num("Holding Current (A)", e.holdingI, 0, 0, { positive: true });
  if (n === 2) return num("Gate-MT1 Resistance (ohms)", e.cresistance, 0, 0, { positive: true });
  return null;
}, (e, n, v) => {
  if (n === 0) e.triggerI = v.value;
  if (n === 1) e.holdingI = v.value;
  if (n === 2) e.cresistance = v.value;
});

def(SCRElm, (e, n) => {
  if (n === 0) return num("Trigger Current (A)", e.triggerI, 0, 0, { positive: true });
  if (n === 1) return num("Holding Current (A)", e.holdingI, 0, 0, { positive: true });
  if (n === 2) return num("Gate Resistance (ohms)", e.gresistance, 0, 0, { positive: true });
  return null;
}, (e, n, v) => {
  if (n === 0) e.triggerI = v.value;
  if (n === 1) e.holdingI = v.value;
  if (n === 2) e.gresistance = v.value;
});

def(DiacElm, (e, n) => {
  if (n === 0) return num("On resistance (ohms)", e.onresistance);
  if (n === 1) return num("Off resistance (ohms)", e.offresistance);
  if (n === 2) return num("Breakdown voltage (volts)", e.breakdown);
  if (n === 3) return num("Hold current (amps)", e.holdcurrent);
  return null;
}, (e, n, v) => {
  if (v.value > 0 && n === 0) e.onresistance = v.value;
  if (v.value > 0 && n === 1) e.offresistance = v.value;
  if (v.value > 0 && n === 2) e.breakdown = v.value;
  if (v.value > 0 && n === 3) e.holdcurrent = v.value;
});

def(CrossSwitchElm, (e, n) => {
  if (n === 0) return check("IEC Symbol", (e.flags & SwitchElm.FLAG_IEC) !== 0);
  if (n === 1) return text("Keyboard Shortcut", e.keyShortcut ?? "");
  if (n === 2) return num("On Resistance (ohms)", e.resistance, 0, 0, { nonNegative: true });
  return null;
}, (e, n, v) => {
  if (n === 0) {
    e.flags = changeFlag(e.flags, SwitchElm.FLAG_IEC, v.checked);
    e.setPoints();
  }
  if (n === 1) e.keyShortcut = v.text.length ? v.text.substring(0, 1) : null;
  if (n === 2) e.resistance = v.value;
});

def(DPDTSwitchElm, (e, n) => {
  if (n === 0) return num("# of Poles", e.poleCount, 2, 10, { dimensionless: true });
  if (n === 1) return check("IEC Symbol", (e.flags & SwitchElm.FLAG_IEC) !== 0);
  if (n === 2) return text("Keyboard Shortcut", e.keyShortcut ?? "");
  if (n === 3) return num("On Resistance (ohms)", e.resistance, 0, 0, { nonNegative: true });
  return null;
}, (e, n, v) => {
  if (n === 0) {
    if (v.value < 2) return "must be >= 2";
    e.poleCount = Math.trunc(v.value);
    e.allocNodes();
    e.setPoints();
  }
  if (n === 1) {
    e.flags = changeFlag(e.flags, SwitchElm.FLAG_IEC, v.checked);
    e.setPoints();
  }
  if (n === 2) e.keyShortcut = v.text.length ? v.text.substring(0, 1) : null;
  if (n === 3) e.resistance = v.value;
});

def(MBBSwitchElm, (e, n) => {
  if (n === 0) return superGet(MBBSwitchElm, e, 0);
  if (n === 1) return num("Switch Group", e.link, 0, 100, { dimensionless: true });
  if (n === 2) return text("Keyboard Shortcut", e.keyShortcut ?? "");
  if (n === 3) return num("On Resistance (ohms)", e.resistance, 0, 0, { nonNegative: true });
  return null;
}, (e, n, v) => {
  if (n === 1) e.link = Math.trunc(v.value);
  else if (n === 2) e.keyShortcut = v.text.length ? v.text.substring(0, 1) : null;
  else if (n === 3) e.resistance = v.value;
  else return superSet(MBBSwitchElm, e, n, v);
});

def(BusLogicInputElm, (e, n) => {
  if (n === 0) return num("Bus Width", e.busWidth, 2, 32, { dimensionless: true });
  if (n === 1) return num("Value", e.value, 0, 0, { dimensionless: true });
  if (n === 2) return num("High Voltage", e.hiV, 0, 0, { unitStep: true });
  if (n === 3) return num("Low Voltage", e.loV, 0, 0, { unitStep: true });
  return null;
}, (e, n, v) => {
  if (n === 0) {
    if (v.value < 2) return "must be >= 2";
    e.busWidth = Math.trunc(v.value);
    e.allocNodes();
  }
  if (n === 1) e.value = Math.trunc(v.value);
  if (n === 2) e.hiV = v.value;
  if (n === 3) e.loV = v.value;
});

def(InstructionDisplayElm, (e, n) => {
  if (n === 0) return num("Bus Width", e.busWidth, 2, 32, { dimensionless: true });
  if (n === 1) return num("Threshold Voltage", e.threshold);
  if (n === 2) return textarea("Lookup Table", e.lookupText);
  return null;
}, (e, n, v) => {
  if (n === 0) {
    if (!(v.value >= 1 && v.value <= 32)) return "must be between 1 and 32";
    e.busWidth = Math.trunc(v.value);
    e.allocNodes();
  }
  if (n === 1) e.threshold = v.value;
  if (n === 2) e.setLookupText(v.text);
});

def(BatteryElm, (e, n) => {
  if (n === 0) return choice("Battery Type", [...BatteryElm.typeNames, "Custom"], e.batteryType === BatteryElm.BT_CUSTOM ? BatteryElm.typeNames.length : e.batteryType);
  if (n === 1) return num("Capacity (Ah)", e.capacityAh, 0, 0, { positive: true });
  if (n === 2) return num("Initial State of Charge (%)", e.initialSoc * 100, 0, 100, { dimensionless: true });
  if (n === 3) return num("R0, Ohmic Resistance (ohms)", e.r0, 0, 0, { positive: true });
  if (n === 4) return num("R1, Polarization Resistance (ohms)", e.r1, 0, 0, { positive: true });
  if (n === 5) return num("C1, Polarization Capacitance (F)", e.c1, 0, 0, { positive: true });
  if (n === 6) return check("Show Voltage", (e.flags & BatteryElm.FLAG_SHOW_VOLTAGE) !== 0);
  if (n === 7) return check("Show State of Charge", (e.flags & BatteryElm.FLAG_SHOW_SOC) !== 0);
  if (n === 8 && e.batteryType === BatteryElm.BT_CUSTOM) return textarea("SOC(%) = Voltage Table", e.socVoltageTable);
  return null;
}, (e, n, v) => {
  if (n === 0) e.setBatteryType(v.selected >= BatteryElm.typeNames.length ? BatteryElm.BT_CUSTOM : v.selected);
  if (n === 1) e.capacityAh = v.value;
  if (n === 2) e.initialSoc = Math.max(0, Math.min(100, v.value)) * 0.01;
  if (n === 3) e.r0 = v.value;
  if (n === 4) e.r1 = v.value;
  if (n === 5) e.c1 = v.value;
  if (n === 6) e.flags = changeFlag(e.flags, BatteryElm.FLAG_SHOW_VOLTAGE, v.checked);
  if (n === 7) e.flags = changeFlag(e.flags, BatteryElm.FLAG_SHOW_SOC, v.checked);
  if (n === 8) {
    e.socVoltageTable = v.text;
    e.parseSocTable();
  }
});

def(AMElm, (e, n) => {
  if (n === 0) return num("Max Voltage", e.maxVoltage, -20, 20, { unitStep: true });
  if (n === 1) return num("Carrier Frequency (Hz)", e.carrierfreq, 4, 500);
  if (n === 2) return num("Signal Frequency (Hz)", e.signalfreq, 4, 500);
  if (n === 3 && e instanceof FMElm) return num("Deviation (Hz)", e.deviation, 4, 500);
  return null;
}, (e, n, v) => {
  if (n === 0) e.maxVoltage = v.value;
  if (n === 1) e.carrierfreq = v.value;
  if (n === 2) e.signalfreq = v.value;
  if (n === 3 && e instanceof FMElm) e.deviation = v.value;
});

def(DataInputElm, (e, n) => {
  if (n === 0) return file("Data File", ".txt,.csv,.dat,text/plain");
  if (n === 1) return num("Scale Factor", e.scaleFactor);
  if (n === 2) return num("Sample Length (s)", e.sampleLength);
  if (n === 3) return check("Repeat", e.doesRepeat());
  return null;
}, (e, n, v) => {
  if (n === 1) e.scaleFactor = v.value;
  if (n === 2) e.sampleLength = v.value;
  if (n === 3) e.flags = changeFlag(e.flags, DataInputElm.FLAG_REPEAT, v.checked);
});

def(AudioInputElm, (e, n) => {
  if (n === 0) return file("Audio File", "audio/*");
  if (n === 1) return num("Max Voltage", e.maxVoltage, 0, 0, { unitStep: true });
  if (n === 2) return num("Start Position (s)", e.startPosition);
  return null;
}, (e, n, v) => {
  if (n === 1) e.maxVoltage = v.value;
  if (n === 2) e.startPosition = v.value;
});

def(WattmeterElm, (e, n) => (n === 0 ? choice("Value", ["Instantaneous", "Average"], e.meter) : null), (e, n, v) => {
  if (n === 0) e.meter = v.selected;
});
def(WattmeterTrueElm, (e, n) => (n === 0 ? choice("Value", ["Instantaneous Power", "Average Power"], e.meter) : null), (e, n, v) => {
  if (n === 0) e.meter = v.selected;
});

def(TestPointElm, (e, n) => {
  if (n === 0) return choice("Value", TestPointElm.meterNames, e.meter);
  if (n === 1) return text("Label", e.label);
  return null;
}, (e, n, v) => {
  if (n === 0) e.meter = v.selected;
  if (n === 1) {
    e.label = v.text.length ? v.text : "TP";
    e.flags = changeFlag(e.flags, TestPointElm.FLAG_LABEL, e.label !== "TP");
  }
});

def(StopTriggerElm, (e, n) => {
  if (n === 0) return num("Voltage", e.triggerVoltage, 0, 0, { unitStep: true });
  if (n === 1) return choice("Trigger Type", [">=", "<="], e.type);
  if (n === 2) return num("Delay (s)", e.delay);
  if (n === 3) return num("Required Duration (s)", e.requiredDuration);
  if (n === 4) return num("Required Count", e.count, -1, -1, { dimensionless: true, positive: true });
  return null;
}, (e, n, v) => {
  if (n === 0) e.triggerVoltage = v.value;
  if (n === 1) e.type = v.selected;
  if (n === 2) e.delay = v.value;
  if (n === 3) e.requiredDuration = Math.max(0, v.value);
  if (n === 4) e.count = Math.max(1, Math.trunc(v.value));
});

def(DataRecorderElm, (e, n) => (n === 0 ? num("# of Data Points", e.dataCount, -1, -1, { dimensionless: true, positive: true }) : null), (e, n, v) => {
  if (n === 0 && v.value > 0) e.setDataCount(Math.trunc(v.value));
});

def(LDRElm, (e, n) => (n === 0 ? text("Slider Text", e.sliderText) : null), (e, n, v) => {
  if (n === 0) e.sliderText = v.text;
});

def(ThermistorNTCElm, (e, n) => {
  if (n === 0) return num("R at 25°C", e.r25, e.r50 + 100, 100000);
  if (n === 1) return num("R at 50°C", e.r50, 100, e.r25 - 100);
  if (n === 2) return num("Slider min temp (°C)", e.minTempr, -40, e.maxTempr);
  if (n === 3) return num("Slider max temp (°C)", e.maxTempr, e.minTempr, 150);
  if (n === 4) return text("Slider Text", e.sliderText);
  return null;
}, (e, n, v) => {
  if (n === 0) e.r25 = v.value;
  if (n === 1) e.r50 = v.value;
  if (n === 2) e.minTempr = v.value;
  if (n === 3) e.maxTempr = v.value;
  if (n === 4) e.sliderText = v.text;
  e.setSliderValue(e.sliderValue);
});

def(DCMotorElm, (e, n) => {
  if (n === 0) return num("Armature inductance (H)", e.inductance, 0, 0, { positive: true });
  if (n === 1) return num("Armature Resistance (ohms)", e.resistance, 0, 0, { positive: true });
  if (n === 2) return num("Torque constant (Nm/A)", e.K, 0, 0, { positive: true });
  if (n === 3) return num("Moment of inertia (Kg.m^2)", e.J, 0, 0, { positive: true });
  if (n === 4) return num("Friction coefficient (Nms/rad)", e.b, 0, 0, { positive: true });
  if (n === 5) return num("Gear Ratio", e.gearRatio, 0, 0, { positive: true });
  return null;
}, (e, n, v) => {
  if (!(v.value > 0)) return;
  if (n === 0) {
    e.inductance = v.value;
    e.ind.setup(e.inductance, e.current, Inductor.FLAG_BACK_EULER);
  }
  if (n === 1) e.resistance = v.value;
  if (n === 2) e.K = e.Kb = v.value;
  if (n === 3) {
    e.J = v.value;
    e.indInertia.setup(e.J, e.inertiaCurrent, Inductor.FLAG_BACK_EULER);
  }
  if (n === 4) e.b = v.value;
  if (n === 5) e.gearRatio = v.value;
});

def(TriStateElm, (e, n) => {
  if (n === 0) return num("On Resistance (ohms)", e.r_on, 0, 0, { positive: true });
  if (n === 1) return num("Off Resistance (ohms)", e.r_off, 0, 0, { positive: true });
  if (n === 2) return num("Output Pulldown Resistance (ohms)", e.r_off_ground, 0, 0, { positive: true });
  if (n === 3) return num("High Logic Voltage", e.highVoltage, 1, 10, { unitStep: true });
  if (n === 4) return num("Bus Width", e.busWidth, 1, 32, { dimensionless: true });
  return null;
}, (e, n, v) => {
  if (n === 0 && v.value > 0) e.r_on = v.value;
  if (n === 1 && v.value > 0) e.r_off = v.value;
  if (n === 2 && v.value > 0) e.r_off_ground = v.value;
  if (n === 3) e.highVoltage = GateElm.lastHighVoltage = v.value;
  if (n === 4) {
    if (v.value < 1) return "must be >= 1";
    e.busWidth = Math.trunc(v.value);
    e.allocNodes();
  }
});

def(DelayBufferElm, (e, n) => {
  if (n === 0) return num("Delay (s)", e.delay);
  if (n === 1) return num("Threshold (V)", e.threshold);
  if (n === 2) return num("High Logic Voltage", e.highVoltage, 0, 0, { unitStep: true });
  return null;
}, (e, n, v) => {
  if (n === 0) e.delay = v.value;
  if (n === 1) e.threshold = v.value;
  if (n === 2) e.highVoltage = v.value;
});

def(CustomTransformerElm, (e, n) => {
  if (n === 0) return num("Base Inductance (H)", e.inductance, 0.01, 5, { positive: true });
  if (n === 1) return { ...text("Description", e.description), noSliders: true };
  if (n === 2) return num("Coupling Coefficient", e.couplingCoef, 0, 1, { dimensionless: true, positive: true });
  if (n === 3) return check("Trapezoidal Approximation", e.isTrapezoidal());
  return null;
}, (e, n, v) => {
  if (n === 0 && v.value > 0) {
    e.inductance = v.value;
    e.parseDescription(e.description);
  }
  if (n === 1 && v.text !== e.description) {
    if (!e.parseDescription(v.text)) {
      const err = e.error;
      e.parseDescription(e.description);
      return err ?? "bad description";
    }
    e.description = v.text;
    e.setPoints();
  }
  if (n === 2) {
    if (!(v.value > 0 && v.value < 1)) return "must be > 0 and < 1";
    e.couplingCoef = v.value;
    e.parseDescription(e.description);
  }
  if (n === 3) {
    e.flags = changeFlag(e.flags, CustomTransformerElm.FLAG_BACK_EULER, !v.checked);
    e.parseDescription(e.description);
  }
});

def(ThreePhaseMotorElm, (e, n) => {
  if (n === 0) return num("Stator Inductance (H)", e.Ls);
  if (n === 1) return num("Rotor Inductance (H)", e.Lr);
  if (n === 2) return num("Coupling Coefficient", e.Lm / Math.sqrt(e.Ls * e.Lr), 0, 0, { dimensionless: true });
  if (n === 3) return num("Stator Resistance (ohms)", e.Rs);
  if (n === 4) return num("Rotor Resistance (ohms)", e.Rr);
  if (n === 5) return num("Friction coefficient (Nms/rad)", e.b);
  if (n === 6) return num("Moment of inertia (Kg.m^2)", e.J);
  return null;
}, (e, n, v) => {
  if (v.value > 0 && n === 0) e.Ls = v.value;
  if (v.value > 0 && n === 1) e.Lr = v.value;
  if (v.value > 0 && v.value < 1 && n === 2) e.Lm = v.value * Math.sqrt(e.Ls * e.Lr);
  if (v.value > 0 && n === 3) e.Rs = v.value;
  if (v.value > 0 && n === 4) e.Rr = v.value;
  if (n === 5) e.b = v.value;
  if (v.value > 0 && n === 6) e.J = v.value;
});

def(MotorProtectionSwitchElm, (e, n) => {
  if (n === 0) return num("I2t", e.i2t, 0, 0, { positive: true });
  if (n === 1) return num("On Resistance", e.resistance, 0, 0, { positive: true });
  if (n === 2) return text("Label (for linking)", e.label);
  return null;
}, (e, n, v) => {
  if (n === 0) e.i2t = v.value;
  if (n === 1) e.resistance = v.value;
  if (n === 2) e.label = v.text;
});
