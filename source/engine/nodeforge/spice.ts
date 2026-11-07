// SPICE netlist export: the same circuit, for ngspice and nfsim spice. Parts are written with the
// equations the engine uses, so differences come from numerical methods rather than the models.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { Circuit } from "../circuitjs/io/circuit";
import type { CircuitElm } from "../circuitjs/core/elm";
import { CurrentElm, GroundElm, ResistorElm, SwitchElm, WireElm } from "../circuitjs/elements/basic";
import { TransLineElm } from "../circuitjs/elements/analog";
import { DiodeElm, DiodeModel } from "../circuitjs/elements/diode";
import { CapacitorElm, InductorElm } from "../circuitjs/elements/reactive";
import { RailElm, VoltageElm, Waveform } from "../circuitjs/elements/sources";
import { mosfetPins } from "./devices/subckt";
import { laplaceForNgspice } from "./spice/laplace";
import { SpiceMosfetElm } from "./elements/spice-mosfet";
import { SpiceJfetElm } from "./elements/spice-jfet";
import { SpiceTransistorElm } from "./elements/spice-transistor";
import { isSpicePart, spiceModelOf } from "./extensions";
import { AccurateSimulator } from "./simulator";
import { circuitJSLeak, diodeCard, jfetCard, mosfetCard, transistorCard } from "./spice/circuitjs";
import { findModel } from "./spice/registry";

export interface SpiceNetlist {
  /** The netlist, without the analysis and control lines. */
  text: string;
  /** SPICE node name for each engine node index that has one (index 0, ground, is "0"). */
  nodeNames: Map<number, string>;
  /** Parts that couldn't be written (by kind), so the comparison would be meaningless. */
  unsupported: string[];
  /** The SPICE name of each independent source (V…, I…), for analyses that name one (`.dc`). */
  sourceNames: Map<CircuitElm, string>;
}

const num = (v: number) => (Number.isFinite(v) ? String(+v.toPrecision(12)) : "0");

/**
 * A two-level periodic wave (high for the duty fraction of each cycle, starting at phase 0) as a
 * SPICE PULSE that starts at the right level: time p into the cycle at t = 0.
 */
function twoLevel(low: number, high: number, T: number, duty: number, p: number, edge: number): string {
  const tFall = duty * T;
  if (p < tFall) {
    // starts high: the pulse is the low part, beginning at the next falling edge
    return `PULSE(${num(high)} ${num(low)} ${num(Math.max(0, tFall - p - edge / 2))} ${num(edge)} ${num(edge)} ${num((1 - duty) * T - edge)} ${num(T)})`;
  }
  // starts low: the pulse is the high part, beginning at the next rising edge
  return `PULSE(${num(low)} ${num(high)} ${num(Math.max(0, T - p - edge / 2))} ${num(edge)} ${num(edge)} ${num(duty * T - edge)} ${num(T)})`;
}

/** A constant source's value, or under a start-up ramp of `ramp` s its rise from 0 (PWL). */
const steady = (v: number, ramp: number): string => (ramp > 0 ? `PWL(0 0 ${num(ramp)} ${num(v)})` : `DC ${num(v)}`);

/**
 * A CircuitJS source waveform as a SPICE source specification (null if it has no equivalent yet;
 * under a start-up ramp, only constant sources have one).
 */
function sourceSpec(e: VoltageElm, dc = false, ramp = 0): string | null {
  const { maxVoltage: amp, bias, frequency: f, phaseShift, dutyCycle: duty } = e;
  if (e.waveform === Waveform.dc) return steady(amp + bias, ramp);
  // a slider-controlled rail: its present value
  if (e.waveform === Waveform.variable) return steady(e.getVoltage(), ramp);
  // for an operating point: a wave's DC value is its offset (as in the engine's DC analysis)
  if (dc) return `DC ${num(bias)}`;
  if (ramp > 0) return null;
  if (f <= 0) return null;
  const T = 1 / f;
  // CircuitJS: the wave at time t is at phase 2πft + phaseShift, i.e. p into its cycle at t = 0
  const p = ((((phaseShift / (2 * Math.PI)) % 1) + 1) % 1) * T;
  // CircuitJS edges are instant unless a rise time is set; SPICE needs some, so make them tiny
  const edge = Math.max(e.riseTime, T * 1e-7);
  switch (e.waveform) {
    case Waveform.ac:
      return `SIN(${num(bias)} ${num(amp)} ${num(f)} 0 0 ${num((phaseShift * 180) / Math.PI)})`;
    case Waveform.square:
      return twoLevel(bias - amp, bias + amp, T, duty, p, edge);
    case Waveform.pulse:
      return twoLevel(bias, bias + amp, T, duty, p, edge);
    default:
      return null;
  }
}

/**
 * Write a circuit as an ngspice netlist. The circuit is analyzed on a scratch simulator to get
 * its nodes (wires merged, as the engine sees them).
 */
export function toSpice(circuit: Circuit, opts: { dc?: boolean } = {}): SpiceNetlist {
  // the NodeForge engine's analysis: its SPICE devices' inner nodes counted, so nodes are numbered
  // as when it runs the circuit
  const sim = new AccurateSimulator();
  sim.accurate = true;
  sim.maxTimeStep = sim.timeStep = circuit.options.maxTimeStep;
  sim.useCircuitOptions(circuit.options);
  sim.setElements(circuit.simulatedElements);
  // nodes are allocated when the circuit is first stamped (no timestep is taken)
  sim.analyzeCircuit();
  sim.preStampAndStampCircuit();
  const nodeNames = new Map<number, string>([[0, "0"]]);
  const node = (e: CircuitElm, i: number): string => {
    const n = e.nodes[i];
    if (!n || n.index === 0) return "0";
    let name = nodeNames.get(n.index);
    if (!name) nodeNames.set(n.index, (name = `n${n.index}`));
    return name;
  };
  const lines: string[] = [`* ${circuit.elements.length} parts, exported by NodeForge`];
  // the start-up ramp (sources rise from 0), unless exported for an operating point
  const ramp = opts.dc ? 0 : circuit.options.startupRamp;
  const models: string[] = [];
  const unsupported = new Set<string>();
  let k = 0;
  const id = (prefix: string) => `${prefix}${++k}`;
  const sourceNames = new Map<CircuitElm, string>();
  const sourceName = (e: CircuitElm, prefix: string) => {
    const name = id(prefix);
    sourceNames.set(e, name);
    return name;
  };
  /** One .model line per CircuitJS diode model used (its SPICE equivalent, as the engine simulates it). */
  const diodeModels = new Map<DiodeModel, string>();
  const diodeModel = (m: DiodeModel): string => {
    let name = diodeModels.get(m);
    if (!name) {
      name = `D${models.length + 1}`;
      diodeModels.set(m, name);
      models.push(diodeCard(m, name).source);
    }
    return name;
  };

  /** Parts' SPICE models: written as they are, once each. */
  const spiceModels = new Set<string>();
  const spiceModel = (name: string): string | null => {
    const def = findModel(name);
    if (!def) return null;
    if (!spiceModels.has(def.name.toLowerCase())) {
      spiceModels.add(def.name.toLowerCase());
      // LAPLACE sources as ngspice's s_xfer (it has no LAPLACE of its own)
      models.push(laplaceForNgspice(def.text));
    }
    return def.name;
  };

  // the simulator's list: subcircuits' parts in place of the subcircuits (their nodes are the
  // circuit's, as the simulator links them)
  for (const e of sim.elmList) {
    if (e instanceof GroundElm || e.getChildElmList()) continue;
    const sm = spiceModelOf(e);
    if (sm !== null) {
      const name = spiceModel(sm);
      if (!name) unsupported.add(`SPICE model ${sm} (not defined)`);
      else if (e instanceof DiodeElm) {
        // self-heating: ngspice's thermal diode, its temperature-rise node the part's own
        const th = (e as { device?: { thermal?: { tn: number } | null } }).device?.thermal;
        lines.push(th ? `${id("D")} ${node(e, 0)} ${node(e, 1)} ${node(e, th.tn)} ${name} thermal` : `${id("D")} ${node(e, 0)} ${node(e, 1)} ${name}`);
      }
      // a transistor: collector, base, emitter (the substrate on ground)
      else if (e instanceof SpiceTransistorElm) lines.push(`${id("Q")} ${node(e, 1)} ${node(e, 0)} ${node(e, 2)} ${name}`);
      // a JFET: drain, gate, source
      else if (e instanceof SpiceJfetElm) lines.push(`${id("J")} ${node(e, 2)} ${node(e, 0)} ${node(e, 1)} ${name}`);
      else if (e instanceof SpiceMosfetElm) {
        const sub = findModel(name)?.subckt;
        if (sub) {
          // a subcircuit: its pins in its own order (any beyond drain, gate, source left open)
          const order = mosfetPins(sub);
          const pins = sub.pins.map((_, i) => (i === order.d ? node(e, e.drainPost) : i === order.g ? node(e, 0) : i === order.s ? node(e, e.sourcePost) : `open${++k}`));
          lines.push(`${id("X")} ${pins.join(" ")} ${name}`);
        } else if (findModel(name)?.model?.type === "VDMOS") {
          // self-heating: ngspice's thermal VDMOS, its junction and case nodes the part's own
          const th = (e.device as { thermal?: { tj: number; tc: number } | null } | null)?.thermal;
          // a heatsink: the part's own copy of the card with its case-to-ambient resistance as RTHCA
          let card = name;
          if (th && e.heatsink !== null) {
            card = `${name}_hs${models.length + 1}`;
            const text = findModel(name)!.text.trimEnd().replace(/^(\s*\.model\s+)\S+/i, `$1${card}`).replace(/\s+rthca\s*=\s*[^\s)]+/gi, "");
            const rthca = ` Rthca=${num(e.heatsink)}`;
            models.push(text.endsWith(")") ? `${text.slice(0, -1)}${rthca})` : text + rthca);
          }
          lines.push(th
            ? `${id("M")} ${node(e, e.drainPost)} ${node(e, 0)} ${node(e, e.sourcePost)} ${node(e, th.tj)} ${node(e, th.tc)} ${card} thermal`
            : `${id("M")} ${node(e, e.drainPost)} ${node(e, 0)} ${node(e, e.sourcePost)} ${name}`);
        }
        // a plain MOSFET card: bulk on the source
        else lines.push(`${id("M")} ${node(e, e.drainPost)} ${node(e, 0)} ${node(e, e.sourcePost)} ${node(e, e.sourcePost)} ${name}`);
      }
      continue;
    }
    if (e instanceof WireElm) {
      const a = node(e, 0), b = node(e, 1);
      if (a !== b) lines.push(`${id("V")} ${a} ${b} DC 0`);
    } else if (e instanceof ResistorElm) {
      lines.push(`${id("R")} ${node(e, 0)} ${node(e, 1)} ${num(e.resistance)}`);
    } else if (e instanceof CapacitorElm) {
      lines.push(`${id("C")} ${node(e, 0)} ${node(e, 1)} ${num(e.capacitance)} IC=${num(e.voltdiff)}`);
    } else if (e instanceof InductorElm) {
      lines.push(`${id("L")} ${node(e, 0)} ${node(e, 1)} ${num(e.inductance)} IC=${num(e.current)}`);
    } else if (e instanceof RailElm) {
      const spec = sourceSpec(e, opts.dc, ramp);
      if (spec) lines.push(`${sourceName(e, "V")} ${node(e, 0)} 0 ${spec}`);
      else unsupported.add(`rail (waveform ${e.waveform}${ramp ? ", start-up ramp" : ""})`);
    } else if (e instanceof VoltageElm) {
      const spec = sourceSpec(e, opts.dc, ramp);
      // CircuitJS: V(post 1) − V(post 0) = the source voltage
      if (spec) lines.push(`${sourceName(e, "V")} ${node(e, 1)} ${node(e, 0)} ${spec}`);
      else unsupported.add(`voltage source (waveform ${e.waveform}${ramp ? ", start-up ramp" : ""})`);
    } else if (e instanceof CurrentElm) {
      lines.push(`${sourceName(e, "I")} ${node(e, 0)} ${node(e, 1)} ${steady(e.currentValue, ramp)}`);
    } else if (e instanceof SwitchElm && e.constructor === SwitchElm) {
      if (e.position === 0 && node(e, 0) !== node(e, 1)) lines.push(`${id("V")} ${node(e, 0)} ${node(e, 1)} DC 0`);
    } else if (e instanceof DiodeElm && isSpicePart(e)) {
      // diodes, zeners and LEDs: CircuitJS's diode is SPICE's (its breakdown: 5 mA at BV, N = 1),
      // with its junction leak
      lines.push(`${id("D")} ${node(e, 0)} ${node(e, 1)} ${diodeModel(e.model!)}`);
      lines.push(`${id("R")} ${node(e, 0)} ${node(e, 1)} ${num(1 / circuitJSLeak(diodeCard(e.model!)))}`);
    } else if (e instanceof SpiceMosfetElm) {
      // the engine's MOSFET is SPICE level 1 with KP = β (W = L) and fixed overlap gate
      // capacitances; its body diodes are CircuitJS's default diode (not level 1's junctions,
      // which are switched off), from the body to source and drain
      const m = e.model!;
      const pmos = e.pnp === -1;
      const name = `M${models.length + 1}`;
      models.push(mosfetCard(m, e.pnp, name).source);
      const bulk = e.getPostCount() > 3 ? node(e, 3) : node(e, e.bodyTerminal);
      lines.push(`${id("M")} ${node(e, 2)} ${node(e, 0)} ${node(e, 1)} ${bulk} ${name} W=1 L=1`);
      // the engine's MOSFET leaks 10 nS drain to source when off (it keeps the matrix solvable)
      lines.push(`${id("R")} ${node(e, 2)} ${node(e, 1)} 1e8`);
      if (e.doBodyDiode()) {
        const dm = diodeModel(DiodeModel.getDefaultModel());
        for (const terminal of [1, 2]) {
          const other = node(e, terminal);
          if (other === bulk) continue;
          lines.push(pmos ? `${id("D")} ${other} ${bulk} ${dm}` : `${id("D")} ${bulk} ${other} ${dm}`);
          lines.push(`${id("R")} ${other} ${bulk} ${num(1 / circuitJSLeak(diodeCard(DiodeModel.getDefaultModel())))}`);
        }
      }
    } else if (e instanceof SpiceJfetElm && e.model) {
      // the engine's JFET: level 1 with BETA = β/2, CircuitJS's drain-source leak, its gate diode
      // (CircuitJS's default diode, to the source) with its leak, and its fixed gate capacitances
      const m = e.model, d = node(e, 2), g = node(e, 0), s = node(e, 1);
      const name = `J${models.length + 1}`;
      models.push(jfetCard(m, e.pnp, name).source);
      lines.push(`${id("J")} ${d} ${g} ${s} ${name}`);
      lines.push(`${id("R")} ${d} ${s} 1e8`);
      const dm = diodeModel(DiodeModel.getDefaultModel());
      lines.push(e.pnp < 0 ? `${id("D")} ${s} ${g} ${dm}` : `${id("D")} ${g} ${s} ${dm}`);
      lines.push(`${id("R")} ${g} ${s} ${num(1 / circuitJSLeak(diodeCard(DiodeModel.getDefaultModel())))}`);
      if (m.capGS > 0) lines.push(`${id("C")} ${g} ${s} ${num(m.capGS)}`);
      if (m.capGD > 0) lines.push(`${id("C")} ${g} ${d} ${num(m.capGD)}`);
    } else if (e instanceof SpiceTransistorElm && e.model) {
      // the engine's transistor is Gummel-Poon with the part's beta as BF (one card per part)
      const name = `Q${models.length + 1}`;
      models.push(transistorCard(e.model, e.pnp, e.beta, name).source);
      lines.push(`${id("Q")} ${node(e, 1)} ${node(e, 0)} ${node(e, 2)} ${name}`);
    } else if (e instanceof TransLineElm) {
      // a lossless line: port 1 is (post 2, post 0), port 2 is (post 3, post 1)
      lines.push(`${id("T")} ${node(e, 2)} ${node(e, 0)} ${node(e, 3)} ${node(e, 1)} Z0=${num(e.imped)} TD=${num(e.delay)}`);
    } else {
      unsupported.add(e.constructor.name.replace(/^_/, ""));
    }
  }
  // nodes with no path to ground: the engine ties them to it through 100 MΩ
  for (const n of sim.unconnectedNodes) {
    const name = n === 0 ? "0" : (nodeNames.get(n) ?? `n${n}`);
    nodeNames.set(n, name);
    if (name !== "0") lines.push(`${id("R")} ${name} 0 1e8`);
  }
  // the circuit's temperature (ngspice's nominal one, 27 °C, needs no line)
  if (circuit.options.temperature !== 27) lines.push(`.temp ${num(circuit.options.temperature)}`);
  return { text: [...lines, ...models].join("\n"), nodeNames, unsupported: [...unsupported].sort(), sourceNames };
}
