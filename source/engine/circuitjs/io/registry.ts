// Maps file-format type codes to element classes (upstream: CirSim.dumpTypeMap / xmlDumpTypeMap).
// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { CircuitElm } from "../core/elm";
import { CurrentElm, FuseElm, GroundElm, PlaceholderElm, ResistorElm, SwitchElm, WireElm } from "../elements/basic";
import {
  AnalogSwitch2Elm, AnalogSwitchElm, CC2Elm, CC2NegElm, ExtVoltageElm, LampElm, MemristorElm, NoiseElm, OpAmpElm, OpAmpSwapElm, PotElm,
  PushSwitchElm, SparkGapElm, SweepElm, Switch2Elm, TransformerElm, TransLineElm, VarRailElm,
} from "../elements/analog";
import { BoxElm, LabeledNodeElm, LineElm, OutputElm, ProbeElm, RoutedWireElm, TextElm } from "../elements/annotations";
import {
  ADCElm, Counter2Elm, CounterElm, DACElm, DecimalDisplayElm, DeMultiplexerElm, DFlipFlopElm, FullAdderElm, HalfAdderElm, JKFlipFlopElm,
  LatchElm, MonostableElm, MultiplexerElm, PhaseCompElm, PisoShiftElm, RingCounterElm, SeqGenElm, SevenSegDecoderElm, SevenSegElm,
  SipoShiftElm, TFlipFlopElm, TimerElm, VCOElm,
} from "../elements/chips";
import { CCCSElm, CCVSElm, VCCSElm, VCVSElm } from "../elements/controlled";
import { CustomCompositeElm, setElementFactory } from "../elements/composite";
import { CustomLogicElm } from "../elements/customlogic";
import { BusLogicInputElm, BusSplitterElm, InstructionDisplayElm, ROMElm, SRAMElm } from "../elements/bus";
import { MotorProtectionSwitchElm, ThreePhaseMotorElm } from "../elements/motors";
import {
  AMElm, AudioInputElm, BatteryElm, DataInputElm, DataRecorderElm, FMElm, OhmMeterElm, StopTriggerElm, TestPointElm, WattmeterElm,
  WattmeterTrueElm,
} from "../elements/meters";
import {
  AnalogMuxElm, BusTransceiverElm, ComparatorElm, CustomTransformerElm, DCMotorElm, DelayBufferElm, DPDTSwitchElm, LDRElm, MBBSwitchElm,
  OpAmpRealElm, OptocouplerElm, ThermistorNTCElm, TimeDelayRelayElm, TriStateElm,
} from "../elements/extras";
import { CrystalElm, DarlingtonElm, NDarlingtonElm, NortonAmpElm, OTAElm, PDarlingtonElm, UnijunctionElm } from "../elements/compositeparts";
import { DiodeElm, ZenerElm } from "../elements/diode";
import { RelayCoilElm, RelayContactElm, RelayElm } from "../elements/relays";
import { AmmeterElm, AntennaElm, AudioOutputElm, CrossSwitchElm, LEDArrayElm, ScopeElm, GyratorElm, InvertingSchmittElm, PolarCapacitorElm, SchmittElm, TappedTransformerElm } from "../elements/more";
import {
  DiacElm, JfetElm, LEDElm, NJfetElm, NTransistorElm, PJfetElm, PTransistorElm, SCRElm, TransistorElm, TriacElm, TriodeElm,
  TunnelDiodeElm, VaractorElm,
} from "../elements/semis";
import {
  AndGateElm, InverterElm, LogicInputElm, LogicOutputElm, NandGateElm, NorGateElm, OrGateElm, XnorGateElm, XorGateElm,
} from "../elements/logic";
import { MosfetElm, NMosfetElm, PMosfetElm } from "../elements/mosfet";
import { CapacitorElm, InductorElm } from "../elements/reactive";
import { ACRailElm, ACVoltageElm, ClockElm, DCVoltageElm, RailElm, SquareRailElm, VoltageElm } from "../elements/sources";
import type { TokenStream } from "./tokens";

export type ElmClass = (new (xa: number, ya: number, xb: number, yb: number, f: number) => CircuitElm) & {
  dumpType: number;
  xmlTag: string;
};

/** Every ported element class. Add new ports here. Earlier entries win for shared type codes. */
export const elementClasses: ElmClass[] = [
  WireElm,
  GroundElm,
  ResistorElm,
  CapacitorElm,
  InductorElm,
  VoltageElm,
  RailElm,
  SwitchElm,
  CurrentElm,
  DiodeElm,
  ZenerElm,
  FuseElm,
  MosfetElm,
  TextElm,
  LineElm,
  BoxElm,
  OutputElm,
  ProbeElm,
  LabeledNodeElm,
  RoutedWireElm,
  LogicInputElm,
  LogicOutputElm,
  AndGateElm,
  NandGateElm,
  OrGateElm,
  NorGateElm,
  XorGateElm,
  XnorGateElm,
  InverterElm,
  DFlipFlopElm,
  JKFlipFlopElm,
  TFlipFlopElm,
  CounterElm,
  Counter2Elm,
  RingCounterElm,
  LatchElm,
  FullAdderElm,
  HalfAdderElm,
  MultiplexerElm,
  DeMultiplexerElm,
  SevenSegElm,
  SevenSegDecoderElm,
  DecimalDisplayElm,
  DACElm,
  ADCElm,
  TimerElm,
  MonostableElm,
  VCOElm,
  PhaseCompElm,
  SipoShiftElm,
  PisoShiftElm,
  SeqGenElm,
  TransistorElm,
  LEDElm,
  VaractorElm,
  TunnelDiodeElm,
  JfetElm,
  SCRElm,
  TriacElm,
  DiacElm,
  TriodeElm,
  OpAmpElm,
  VarRailElm,
  ExtVoltageElm,
  NoiseElm,
  SweepElm,
  PotElm,
  Switch2Elm,
  AnalogSwitchElm,
  AnalogSwitch2Elm,
  TransLineElm,
  MemristorElm,
  SparkGapElm,
  LampElm,
  CC2Elm,
  CC2NegElm,
  TransformerElm,
  RelayElm,
  RelayCoilElm,
  RelayContactElm,
  InvertingSchmittElm,
  SchmittElm,
  AntennaElm,
  PolarCapacitorElm,
  TappedTransformerElm,
  AmmeterElm,
  GyratorElm,
  AudioOutputElm,
  ScopeElm,
  LEDArrayElm,
  CrossSwitchElm,
  VCCSElm,
  VCVSElm,
  CCVSElm,
  CCCSElm,
  CustomCompositeElm,
  DarlingtonElm,
  UnijunctionElm,
  CrystalElm,
  OTAElm,
  NortonAmpElm,
  CustomLogicElm,
  ThreePhaseMotorElm,
  MotorProtectionSwitchElm,
  BusSplitterElm,
  BusLogicInputElm,
  InstructionDisplayElm,
  SRAMElm,
  ROMElm,
  BatteryElm,
  AMElm,
  FMElm,
  DataInputElm,
  AudioInputElm,
  OhmMeterElm,
  WattmeterElm,
  WattmeterTrueElm,
  TestPointElm,
  StopTriggerElm,
  DataRecorderElm,
  LDRElm,
  ThermistorNTCElm,
  DCMotorElm,
  ComparatorElm,
  TriStateElm,
  DelayBufferElm,
  AnalogMuxElm,
  OptocouplerElm,
  TimeDelayRelayElm,
  BusTransceiverElm,
  OpAmpRealElm,
  DPDTSwitchElm,
  MBBSwitchElm,
  CustomTransformerElm,
];

/** CircuitJS class names (as used by the Draw menu) that this build implements. */
export const portedClassNames = new Set([
  "WireElm", "GroundElm", "ResistorElm", "CapacitorElm", "InductorElm", "VoltageElm", "DCVoltageElm",
  "ACVoltageElm", "RailElm", "SwitchElm", "CurrentElm", "DiodeElm", "ZenerElm", "FuseElm", "NMosfetElm", "PMosfetElm",
  "TextElm", "LineElm", "BoxElm", "OutputElm", "ProbeElm", "LabeledNodeElm",
  "LogicInputElm",
  "LogicOutputElm",
  "AndGateElm",
  "NandGateElm",
  "OrGateElm",
  "NorGateElm",
  "XorGateElm",
  "XnorGateElm",
  "InverterElm",
  "DFlipFlopElm",
  "JKFlipFlopElm",
  "TFlipFlopElm",
  "CounterElm",
  "Counter2Elm",
  "RingCounterElm",
  "LatchElm",
  "FullAdderElm",
  "HalfAdderElm",
  "MultiplexerElm",
  "DeMultiplexerElm",
  "SevenSegElm",
  "SevenSegDecoderElm",
  "DecimalDisplayElm",
  "DACElm",
  "ADCElm",
  "TimerElm",
  "MonostableElm",
  "VCOElm",
  "PhaseCompElm",
  "SipoShiftElm",
  "PisoShiftElm",
  "SeqGenElm",
  "DecadeElm",
  "NTransistorElm", "PTransistorElm", "LEDElm", "VaractorElm", "TunnelDiodeElm", "NJfetElm", "PJfetElm", "SCRElm", "TriacElm", "DiacElm", "TriodeElm",
  "OpAmpElm", "VarRailElm", "ExtVoltageElm", "SweepElm", "PotElm", "Switch2Elm", "AnalogSwitchElm", "AnalogSwitch2Elm", "TransLineElm", "MemristorElm", "SparkGapElm", "LampElm", "CC2Elm", "TransformerElm", "OpAmpSwapElm", "PushSwitchElm", "CC2NegElm",
  "RelayElm", "RelayCoilElm", "RelayContactElm",
  "InvertingSchmittElm", "SchmittElm", "AntennaElm", "PolarCapacitorElm", "TappedTransformerElm", "AmmeterElm", "GyratorElm",
  "AudioOutputElm", "LEDArrayElm", "CrossSwitchElm",
  "VCCSElm", "VCVSElm", "CCVSElm", "CCCSElm",
  "CustomCompositeElm",
  "NDarlingtonElm", "PDarlingtonElm", "UnijunctionElm", "CrystalElm", "OTAElm", "NortonAmpElm",
  "CustomLogicElm", "ThreePhaseMotorElm", "MotorProtectionSwitchElm",
  "BusSplitterElm", "BusLogicInputElm", "InstructionDisplayElm", "SRAMElm", "ROMElm",
  "RoutedWireElm", "NoiseElm", "UserDefinedLogicElm", "CustomCompositeElm:~LM317-v2", "CustomCompositeElm:~TL431",
  "BatteryElm", "AMElm", "FMElm", "DataInputElm", "AudioInputElm", "OhmMeterElm", "WattmeterElm", "WattmeterTrueElm", "TestPointElm",
  "StopTriggerElm", "DataRecorderElm", "ACRailElm", "SquareRailElm", "ClockElm",
  "LDRElm", "ThermistorNTCElm", "DCMotorElm", "ComparatorElm", "TriStateElm", "DelayBufferElm", "AnalogMuxElm", "OptocouplerElm", "TimeDelayRelayElm", "BusTransceiverElm", "OpAmpRealElm", "DPDTSwitchElm", "MBBSwitchElm", "CustomTransformerElm",
]);

/** Classes for newly placed parts, by CircuitJS class name. */
export const newElementClasses: Record<string, ElmClass> = {
  WireElm, GroundElm, ResistorElm, CapacitorElm, InductorElm, DCVoltageElm, ACVoltageElm, RailElm, SwitchElm, CurrentElm,
  DiodeElm, ZenerElm, FuseElm, NMosfetElm, PMosfetElm, TextElm, LineElm, BoxElm, OutputElm, ProbeElm, LabeledNodeElm,
  LogicInputElm, LogicOutputElm, AndGateElm, NandGateElm, OrGateElm, NorGateElm, XorGateElm, XnorGateElm, InverterElm, DFlipFlopElm, JKFlipFlopElm, TFlipFlopElm, CounterElm, Counter2Elm, RingCounterElm, LatchElm, FullAdderElm, HalfAdderElm, MultiplexerElm, DeMultiplexerElm, SevenSegElm, SevenSegDecoderElm, DecimalDisplayElm, DACElm, ADCElm, TimerElm, MonostableElm, VCOElm, PhaseCompElm, SipoShiftElm, PisoShiftElm, SeqGenElm, DecadeElm: RingCounterElm,
  NTransistorElm, PTransistorElm, LEDElm, VaractorElm, TunnelDiodeElm, NJfetElm, PJfetElm, SCRElm, TriacElm, DiacElm, TriodeElm,
  OpAmpElm, VarRailElm, ExtVoltageElm, SweepElm, PotElm, Switch2Elm, AnalogSwitchElm, AnalogSwitch2Elm, TransLineElm, MemristorElm, SparkGapElm, LampElm, CC2Elm, TransformerElm, OpAmpSwapElm, PushSwitchElm, CC2NegElm,
  RelayElm, RelayCoilElm, RelayContactElm,
  InvertingSchmittElm, SchmittElm, AntennaElm, PolarCapacitorElm, TappedTransformerElm, AmmeterElm, GyratorElm,
  AudioOutputElm, LEDArrayElm, CrossSwitchElm,
  VCCSElm, VCVSElm, CCVSElm, CCCSElm,
  CustomCompositeElm,
  NDarlingtonElm, PDarlingtonElm, UnijunctionElm, CrystalElm, OTAElm, NortonAmpElm,
  CustomLogicElm, ThreePhaseMotorElm, MotorProtectionSwitchElm,
  BusSplitterElm, BusLogicInputElm, InstructionDisplayElm, SRAMElm, ROMElm,
  RoutedWireElm, NoiseElm, UserDefinedLogicElm: CustomLogicElm,
  BatteryElm, AMElm, FMElm, DataInputElm, AudioInputElm, OhmMeterElm, WattmeterElm, WattmeterTrueElm, TestPointElm, StopTriggerElm,
  DataRecorderElm, ACRailElm, SquareRailElm, ClockElm,
  LDRElm, ThermistorNTCElm, DCMotorElm, ComparatorElm, TriStateElm, DelayBufferElm, AnalogMuxElm, OptocouplerElm, TimeDelayRelayElm, BusTransceiverElm, OpAmpRealElm, DPDTSwitchElm, MBBSwitchElm, CustomTransformerElm,
};

const byDumpType = new Map<number, ElmClass>();
const byXmlTag = new Map<string, ElmClass>();
for (const c of elementClasses) {
  // dump type 0: XML-only elements
  if (c.dumpType !== 0 && !byDumpType.has(c.dumpType)) byDumpType.set(c.dumpType, c);
  if (!byXmlTag.has(c.xmlTag)) byXmlTag.set(c.xmlTag, c);
}

function finish(e: CircuitElm): CircuitElm {
  if (e.nodes.length === 0) e.allocNodes();
  e.initBoundingBox();
  return e;
}

/**
 * NodeForge engine: classes a circuit's own parts are created as instead of CircuitJS's (subclasses
 * that the NodeForge engine simulates its own way; parts inside subcircuits keep CircuitJS's).
 */
export const partClassSubstitutes = new Map<ElmClass, ElmClass>();

/** The class a circuit's own part of class C is created as. */
export function partClass(C: ElmClass): ElmClass {
  return partClassSubstitutes.get(C) ?? C;
}

/**
 * NodeForge engine: the same for parts inside subcircuits (composites), for the classes that run
 * as CircuitJS's own under the CircuitJS solver (so CircuitJS mode is unchanged).
 */
export const childClassSubstitutes = new Map<ElmClass, ElmClass>();

/**
 * An element from a text-format line, or null if its type isn't ported. `part`: one of the
 * circuit's own parts (not inside a subcircuit).
 */
export function createFromText(type: number, x1: number, y1: number, x2: number, y2: number, f: number, st: TokenStream, part = false, child = false): CircuitElm | null {
  let C = byDumpType.get(type);
  if (!C) return null;
  if (part) C = partClass(C);
  else if (child) C = childClassSubstitutes.get(C) ?? C;
  const e = new C(x1, y1, x2, y2, f);
  e.allocNodes();
  e.initBoundingBox();
  e.readTokens(st);
  return finish(e);
}

/** A newly placed element at (x, y): what the Java "new element" constructor produces. */
export function createNew(C: ElmClass, x: number, y: number): CircuitElm {
  const e = new C(x, y, x, y, 0);
  e.flags = e.getDefaultFlags();
  e.allocNodes();
  e.initBoundingBox();
  e.initNew();
  return finish(e);
}

/** The class for a newly placed part, by CircuitJS class name (as in the Draw menu). */
export function classForName(name: string): ElmClass | undefined {
  const C = newElementClasses[name];
  return C && partClass(C);
}

/** The class for an XML tag, or undefined if its type isn't ported. */
export function classForXmlTag(tag: string): ElmClass | undefined {
  return byXmlTag.get(tag);
}

export function createPlaceholder(typeName: string, x1: number, y1: number, x2: number, y2: number, f: number, source: string): PlaceholderElm {
  const e = new PlaceholderElm(x1, y1, x2, y2, f);
  e.typeName = typeName;
  e.source = source;
  return finish(e) as PlaceholderElm;
}

const byClassName = new Map<string, ElmClass>();
for (const c of elementClasses) byClassName.set(c.name, c);
for (const [name, c] of Object.entries(newElementClasses)) byClassName.set(name, c);
/** Names that construct a specific subclass (upstream keeps these for old files and subcircuits). */
const classAliases: Record<string, ElmClass> = {
  VoltageElm: DCVoltageElm, TransistorElm: NTransistorElm, MosfetElm: NMosfetElm, JfetElm: NJfetElm,
  DecadeElm: RingCounterElm, RingCounterElm, DarlingtonElm: NDarlingtonElm,
  UserDefinedLogicElm: CustomLogicElm,
};

/** A new element by CircuitJS class name ("CustomCompositeElm:model" for a subcircuit), or null. */
export function constructElement(name: string, x = 0, y = 0): CircuitElm | null {
  if (name.startsWith("CustomCompositeElm:")) {
    const e = new CustomCompositeElm(x, y, x, y, 0);
    e.allocNodes();
    e.initWithModel(name.substring(name.indexOf(":") + 1));
    return finish(e);
  }
  const C = classAliases[name] ?? byClassName.get(name);
  return C ? createNew(C, x, y) : null;
}

setElementFactory({
  // NodeForge engine: composites' children as its classes where it has them (childClassSubstitutes)
  construct: (name) => {
    const C = classAliases[name] ?? byClassName.get(name);
    const S = C && childClassSubstitutes.get(C);
    return S ? createNew(S, 0, 0) : constructElement(name);
  },
  fromText: (type, flags, st) => createFromText(type, 0, 0, 0, 0, flags, st, false, true),
  classNameForXmlTag: (tag) => byXmlTag.get(tag)?.name ?? null,
});
