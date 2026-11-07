// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Ported from CircuitJS1 (VoltageElm.java, DCVoltageElm.java, ACVoltageElm.java, RailElm.java)
// by Paul Falstad and Iain Sharp. Licensed under the GNU General Public License v2 or later. See LICENSE.

import { CircuitElm, type XmlAttrs } from "../core/elm";
import { FindPathInfo, PathKind } from "../core/findpath";
import { interpPoint } from "../core/geometry";
import type { CircuitNode, VoltageSource } from "../core/nodes";
import type { TokenStream, XmlNode } from "../io/tokens";

export const Waveform = { dc: 0, ac: 1, square: 2, triangle: 3, sawtooth: 4, pulse: 5, noise: 6, variable: 7 } as const;

/**
 * Two-terminal voltage source with a selectable waveform. Loading a `v` element always creates
 * this class; DCVoltageElm / ACVoltageElm only differ in their defaults for newly placed parts.
 */
export class VoltageElm extends CircuitElm {
  static override dumpType = "v".charCodeAt(0);
  static readonly FLAG_COS = 2;
  static readonly FLAG_PULSE_DUTY = 4;
  static readonly FLAG_CIRCLE_SYMBOL = 8;
  static readonly FLAG_SHOW_VOLTAGE = 16;
  static readonly FLAG_TIME_SPEC = 32;
  /** Separate from FLAG_SHOW_VOLTAGE because old RailElms may have that set without effect. */
  static readonly FLAG_SHOW_VOLTAGE_RAIL = 64;
  static readonly defaultPulseDuty = 1 / (2 * Math.PI);
  static readonly circleSize = 17;
  /** Waveform of a newly placed element. */
  static defaultWaveform: number = Waveform.dc;

  waveform = 0;
  frequency = 0;
  maxVoltage = 0;
  freqTimeZero = 0;
  bias = 0;
  phaseShift = 0;
  dutyCycle = 0;
  noiseValue = 0;
  riseTime = 0;
  internalResistance = 0;

  override initNew(): void {
    this.waveform = (this.constructor as typeof VoltageElm).defaultWaveform;
    this.maxVoltage = 5;
    this.frequency = 60;
    this.dutyCycle = 0.5;
    this.flags |= VoltageElm.FLAG_SHOW_VOLTAGE;
    this.reset();
  }

  override readTokens(st: TokenStream): void {
    this.maxVoltage = 5;
    this.frequency = 40;
    this.waveform = Waveform.dc;
    this.dutyCycle = 0.5;
    // optional fields, in order; keep whatever parsed before the first failure.
    // (Don't change this format; it isn't generated anymore and VarRailElm appends to it.)
    const fields: ((v: number) => void)[] = [
      (v) => (this.waveform = v),
      (v) => (this.frequency = v),
      (v) => (this.maxVoltage = v),
      (v) => (this.bias = v),
      (v) => (this.phaseShift = v),
      (v) => (this.dutyCycle = v),
    ];
    for (let i = 0; i < fields.length; i++) {
      const v = i === 0 ? st.tryInt() : st.tryDouble();
      if (v === undefined) break;
      fields[i](v);
    }
    if ((this.flags & VoltageElm.FLAG_COS) !== 0) {
      this.flags &= ~VoltageElm.FLAG_COS;
      this.phaseShift = Math.PI / 2;
    }
    // old files have the wrong duty cycle for pulse waveforms (it wasn't configurable)
    if ((this.flags & VoltageElm.FLAG_PULSE_DUTY) === 0 && this.waveform === Waveform.pulse) {
      this.dutyCycle = VoltageElm.defaultPulseDuty;
    }
    this.reset();
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.waveform = xml.int("wf", this.waveform);
    this.frequency = xml.double("fr", this.frequency);
    this.maxVoltage = xml.double("maxv", this.maxVoltage);
    this.bias = xml.double("bias", this.bias);
    this.phaseShift = xml.double("phaseShift", this.phaseShift);
    this.dutyCycle = xml.double("dutyCycle", this.dutyCycle);
    this.riseTime = xml.double("riseTime", this.riseTime);
    this.internalResistance = xml.double("ir", 0);
  }

  override dump(): string {
    // the duty cycle is only read back for pulse waveforms when this flag is set
    this.flags |= VoltageElm.FLAG_PULSE_DUTY;
    return super.dump();
  }

  override dumpValues(): string {
    return ` ${this.waveform} ${this.frequency} ${this.maxVoltage} ${this.bias} ${this.phaseShift} ${this.dutyCycle}`;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["wf", String(this.waveform)], ["fr", String(this.frequency)], ["maxv", String(this.maxVoltage)], ["bias", String(this.bias)],
      ["phaseShift", String(this.phaseShift)], ["dutyCycle", String(this.dutyCycle)]);
    if (this.riseTime !== 0) a.push(["riseTime", String(this.riseTime)]);
    if (this.internalResistance !== 0) a.push(["ir", String(this.internalResistance)]);
  }

  override textLossless(): boolean {
    return this.riseTime === 0 && this.internalResistance === 0;
  }

  override getInternalNodeCount(): number {
    return this.internalResistance > 0 ? 1 : 0;
  }

  override reset(): void {
    this.freqTimeZero = 0;
    this.curcount = 0;
  }

  /** Draw a DC source as a circle with +/- instead of battery plates. */
  get usesCircleSymbol(): boolean {
    return (this.flags & VoltageElm.FLAG_CIRCLE_SYMBOL) !== 0;
  }

  triangleFunc(x: number): number {
    if (x < Math.PI) return x * (2 / Math.PI) - 1;
    return 1 - (x - Math.PI) * (2 / Math.PI);
  }

  override setVoltageSource(n: number, v: VoltageSource): void {
    super.setVoltageSource(n, v);
    v.setNodes(this.nodes[0]!, this.internalResistance > 0 ? this.nodes[2]! : this.nodes[1]!);
  }

  override stamp(): void {
    const vsNode2 = this.internalResistance > 0 ? this.nodes[2]! : this.nodes[1]!;
    // NodeForge engine: sourceScale ramps sources up for the operating point (1 in CircuitJS mode)
    if (this.waveform === Waveform.dc) this.sim.stampVoltageSource(this.nodes[0]!, vsNode2, this.voltSource!, this.getVoltage() * this.sim.sourceScale);
    else this.sim.stampVoltageSource(this.nodes[0]!, vsNode2, this.voltSource!);
    if (this.internalResistance > 0) this.sim.stampResistor(this.nodes[2]!, this.nodes[1]!, this.internalResistance);
  }

  override doStep(): void {
    const vsNode2 = this.internalResistance > 0 ? this.nodes[2]! : this.nodes[1]!;
    if (this.waveform !== Waveform.dc) this.sim.updateVoltageSource(this.nodes[0]!, vsNode2, this.voltSource!, this.getVoltage() * this.sim.sourceScale);
  }

  /** NodeForge engine: when the noise value next changes. */
  noiseUntil = 0;

  override stepFinished(): void {
    if (this.waveform !== Waveform.noise) return;
    const sim = this.sim;
    if (sim.accurate) {
      // NodeForge engine: a new value every max step, held in between (a breakpoint at each change), so the error
      // control doesn't chase a new random jump every step
      // (hold unless the value is due, or time went back: a reset)
      const hold = this.noiseUntil - sim.t;
      if (hold > sim.maxTimeStep * 1e-6 && hold <= sim.maxTimeStep * (1 + 1e-6)) return;
      this.noiseUntil = (Math.floor(sim.t / sim.maxTimeStep + 1e-6) + 1) * sim.maxTimeStep;
    }
    this.noiseValue = (sim.random() * 2 - 1) * this.maxVoltage + this.bias;
  }

  /** Source voltage at the current simulation time. (`%` is fmod, as in Java.) */
  getVoltage(): number {
    if (this.waveform !== Waveform.dc && this.sim.dcAnalysisFlag) return this.bias;
    const pi = Math.PI;
    const w = 2 * pi * (this.sim.t - this.freqTimeZero) * this.frequency + this.phaseShift;
    const { maxVoltage, bias, dutyCycle, riseTime, frequency } = this;
    switch (this.waveform) {
      case Waveform.dc:
        return maxVoltage + bias;
      case Waveform.ac:
        return Math.sin(w) * maxVoltage + bias;
      case Waveform.square: {
        const wm = w % (2 * pi);
        const dutyPhase = 2 * pi * dutyCycle;
        if (riseTime > 0) {
          const risePhase = riseTime * frequency * 2 * pi;
          const halfRise = risePhase / 2;
          // rising edge centered at phase 0 (wraps around the cycle boundary)
          if (wm < halfRise) return bias + maxVoltage * (2 * ((wm + halfRise) / risePhase) - 1);
          if (wm < dutyPhase - halfRise) return bias + maxVoltage;
          // falling edge centered at dutyPhase
          if (wm < dutyPhase + halfRise) return bias + maxVoltage * (1 - 2 * ((wm - dutyPhase + halfRise) / risePhase));
          if (wm < 2 * pi - halfRise) return bias - maxVoltage;
          return bias + maxVoltage * (2 * ((wm - (2 * pi - halfRise)) / risePhase) - 1);
        }
        return bias + (wm > dutyPhase ? -maxVoltage : maxVoltage);
      }
      case Waveform.triangle:
        return bias + this.triangleFunc(w % (2 * pi)) * maxVoltage;
      case Waveform.sawtooth:
        return bias + (w % (2 * pi)) * (maxVoltage / pi) - maxVoltage;
      case Waveform.pulse: {
        const wm = w % (2 * pi);
        const dutyPhase = 2 * pi * dutyCycle;
        if (riseTime > 0) {
          const risePhase = riseTime * frequency * 2 * pi;
          const halfRise = risePhase / 2;
          if (wm < halfRise) return bias + maxVoltage * ((wm + halfRise) / risePhase);
          if (wm < dutyPhase - halfRise) return bias + maxVoltage;
          if (wm < dutyPhase + halfRise) return bias + maxVoltage * (1 - (wm - dutyPhase + halfRise) / risePhase);
          if (wm < 2 * pi - halfRise) return bias;
          return bias + maxVoltage * ((wm - (2 * pi - halfRise)) / risePhase);
        }
        return wm < dutyPhase ? maxVoltage + bias : bias;
      }
      case Waveform.noise:
        return this.noiseValue;
      default:
        return 0;
    }
  }

  override setPoints(): void {
    super.setPoints();
    const c = VoltageElm.circleSize;
    if (this.waveform === Waveform.dc && this.usesCircleSymbol) this.calcLeads(c * 2);
    else this.calcLeads(this.waveform === Waveform.dc || this.waveform === Waveform.variable ? 8 : c * 2);
  }

  override getVoltageSourceCount(): number {
    return 1;
  }
  override getPower(): number {
    return -this.getVoltageDiff() * this.current;
  }
  override getVoltageDiff(): number {
    return this.volts[1] - this.volts[0];
  }
  override isVoltageElm(): boolean {
    return true;
  }

  override validate(): boolean {
    if (this.internalResistance > 0) return true;
    if (this.getPostCount() === 2) {
      const fpi = new FindPathInfo(PathKind.Voltage, this, this.getNode(1)!, this.sim);
      if (fpi.findPath(this.getNode(0)!)) {
        // voltage source / wire loop with no resistance: add a tiny internal resistance
        this.internalResistance = 0.001;
        return false;
      }
    }
    return true;
  }

  setFrequency(newFreq: number): void {
    const oldfreq = this.frequency;
    this.frequency = newFreq;
    const t = this.sim?.t ?? 0;
    this.freqTimeZero = this.frequency === 0 ? 0 : t - (oldfreq * (t - this.freqTimeZero)) / this.frequency;
  }

  setFrequencyFromTimes(highTime: number, lowTime: number): void {
    this.setFrequency(1 / (highTime + lowTime));
    this.dutyCycle = highTime / (highTime + lowTime);
  }
}

export class DCVoltageElm extends VoltageElm {}

export class ACVoltageElm extends VoltageElm {
  static override defaultWaveform: number = Waveform.ac;

  override initNew(): void {
    super.initNew();
    this.maxVoltage = 120 * Math.sqrt(2);
  }
}

/** Single-terminal source referenced to ground. */
export class RailElm extends VoltageElm {
  static override dumpType = "R".charCodeAt(0);
  static readonly FLAG_CLOCK = 1;

  override getPostCount(): number {
    return 1;
  }

  override setPoints(): void {
    super.setPoints();
    this.lead1 = interpPoint(this.point1, this.point2, 1 - VoltageElm.circleSize / this.dn);
  }

  override getVoltageDiff(): number {
    return this.volts[0];
  }

  private get vsNode(): CircuitNode {
    return this.internalResistance > 0 ? this.nodes[1]! : this.nodes[0]!;
  }

  override setVoltageSource(_n: number, v: VoltageSource): void {
    this.voltSource = v;
    v.setNodes(this.sim.ground, this.vsNode);
  }

  override stamp(): void {
    // NodeForge engine: sourceScale ramps sources up for the operating point (1 in CircuitJS mode)
    if (this.waveform === Waveform.dc) this.sim.stampVoltageSource(this.sim.ground, this.vsNode, this.voltSource!, this.getVoltage() * this.sim.sourceScale);
    else this.sim.stampVoltageSource(this.sim.ground, this.vsNode, this.voltSource!);
    if (this.internalResistance > 0) this.sim.stampResistor(this.nodes[1]!, this.nodes[0]!, this.internalResistance);
  }

  override doStep(): void {
    if (this.waveform !== Waveform.dc) this.sim.updateVoltageSource(this.sim.ground, this.vsNode, this.voltSource!, this.getVoltage() * this.sim.sourceScale);
  }

  override hasGroundConnection(): boolean {
    return true;
  }
  override isRail(): boolean {
    return true;
  }

  override validate(): boolean {
    if (this.internalResistance > 0) return true;
    const fpi = new FindPathInfo(PathKind.Voltage, this, this.getNode(0)!, this.sim);
    if (fpi.findPath(this.sim.ground)) {
      this.internalResistance = 0.001;
      return false;
    }
    return true;
  }
}

/** Rail variants for the Draw menu; they're saved as plain rails. */
export class ACRailElm extends RailElm {
  static override defaultWaveform: number = Waveform.ac;
  override initNew(): void {
    super.initNew();
    this.maxVoltage = 120 * Math.sqrt(2);
  }
}

export class SquareRailElm extends RailElm {
  static override defaultWaveform: number = Waveform.square;
}

export class ClockElm extends RailElm {
  static override defaultWaveform: number = Waveform.square;
  override initNew(): void {
    super.initNew();
    this.maxVoltage = 2.5;
    this.bias = 2.5;
    this.frequency = 100;
    this.flags |= RailElm.FLAG_CLOCK;
  }
}
