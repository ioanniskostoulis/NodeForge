// Ported from CircuitJS1 (CustomLogicElm.java, CustomLogicModel.java) by Paul Falstad.
// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Licensed under the GNU General Public License v2 or later. See LICENSE.
//
// A chip whose behavior is a truth table of rules like "01+=1_" (inputs, then outputs), with
// don't-cares, edges, pattern letters and tri-state outputs.

import type { XmlAttrs } from "../core/elm";
import { CircuitText, type TokenStream, XmlNode } from "../io/tokens";
import { ChipElm, fixPinName, Side } from "./chips";

/** Java's String.split for a literal separator (trailing empty strings are dropped). */
function javaSplit(s: string, sep: string): string[] {
  if (!s.includes(sep)) return [s];
  const parts = s.split(sep);
  while (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

export class CustomLogicModel {
  static readonly FLAG_SCHMITT = 1;
  static modelMap = new Map<string, CustomLogicModel>();
  flags = 0;
  name = "";
  inputs: string[] = javaSplit("A,B", ",");
  outputs: string[] = javaSplit("C,D", ",");
  infoText = "";
  rules = "";
  rulesLeft: string[] = [];
  rulesRight: string[] = [];
  triState = false;
  /** The first rule error, if any (shown by the editor). */
  error: string | null = null;

  static getModelWithName(name: string): CustomLogicModel {
    let lm = CustomLogicModel.modelMap.get(name);
    if (lm) return lm;
    lm = new CustomLogicModel();
    lm.name = name;
    lm.infoText = name === "default" ? "custom logic" : name;
    CustomLogicModel.modelMap.set(name, lm);
    return lm;
  }

  static getModelWithNameOrCopy(name: string, oldmodel: CustomLogicModel | null): CustomLogicModel {
    let lm = CustomLogicModel.modelMap.get(name);
    if (lm) return lm;
    lm = new CustomLogicModel();
    if (oldmodel) {
      lm.flags = oldmodel.flags;
      lm.inputs = oldmodel.inputs;
      lm.outputs = oldmodel.outputs;
      lm.rules = oldmodel.rules;
      lm.rulesLeft = oldmodel.rulesLeft;
      lm.rulesRight = oldmodel.rulesRight;
    }
    lm.name = name;
    lm.infoText = name;
    CustomLogicModel.modelMap.set(name, lm);
    return lm;
  }

  /** A "!" line of the text format. */
  static undumpModel(st: TokenStream): void {
    CustomLogicModel.getModelWithName(CircuitText.unescape(st.next())).undump(st);
  }

  undump(st: TokenStream): void {
    this.flags = st.nextInt();
    this.inputs = javaSplit(CircuitText.unescape(st.next()), ",");
    this.outputs = javaSplit(CircuitText.unescape(st.next()), ",");
    this.infoText = CircuitText.unescape(st.next());
    this.rules = CircuitText.unescape(st.next());
    this.parseRules();
  }

  dump(): string {
    const e = CircuitText.escape;
    return `! ${e(this.name)} ${this.flags} ${e(this.inputs.join(","))} ${e(this.outputs.join(","))} ${e(this.infoText)} ${e(this.rules)}`;
  }

  /** A <clm> tag. */
  static undumpModelXml(xml: XmlNode): void {
    CustomLogicModel.getModelWithName(xml.string("nm", null) ?? "").undumpXml(xml);
  }

  undumpXml(xml: XmlNode): void {
    this.flags = xml.int("f", this.flags);
    this.inputs = javaSplit(xml.string("in", null) ?? "", ",");
    this.outputs = javaSplit(xml.string("o", null) ?? "", ",");
    this.infoText = xml.string("if", null) ?? "";
    this.rules = xml.text.trim();
    this.parseRules();
  }

  toXml(): XmlNode {
    const n = new XmlNode("clm", { nm: this.name, f: String(this.flags), in: this.inputs.join(","), o: this.outputs.join(","), if: this.infoText });
    n.text = this.rules;
    return n;
  }

  setRules(rules: string): void {
    this.rules = rules;
    this.parseRules();
  }

  parseRules(): void {
    const lines = javaSplit(this.rules, "\n");
    this.rulesLeft = [];
    this.rulesRight = [];
    this.triState = false;
    this.error = null;
    for (let i = 0; i !== lines.length; i++) {
      const s = lines[i].toLowerCase().trim();
      if (s.length === 0 || s.startsWith("#")) continue;
      const s0 = javaSplit(s.replaceAll(" ", ""), "=");
      if (s0.length !== 2) {
        this.error = `error on line ${i + 1}`;
        return;
      }
      if (s0[0].length < this.inputs.length) {
        this.error = `must have >= ${this.inputs.length} digits on left side (line ${i + 1})`;
        return;
      }
      if (s0[0].length > this.inputs.length + this.outputs.length) {
        this.error = `must have <= ${this.inputs.length + this.outputs.length} digits on left side (line ${i + 1})`;
        return;
      }
      if (s0[1].length !== this.outputs.length) {
        this.error = `must have ${this.outputs.length} digits on right side (line ${i + 1})`;
        return;
      }
      const rl = s0[0];
      const used = new Array<boolean>(26).fill(false);
      let newRl = "";
      for (const x of rl) {
        if (x === "?" || x === "+" || x === "-" || x === "0" || x === "1") {
          newRl += x;
          continue;
        }
        if (x < "a" || x > "z") {
          this.error = `error on line ${i + 1}`;
          return;
        }
        // if a letter appears twice, capitalize it the 2nd time so we can compare
        const k = x.charCodeAt(0) - 97;
        if (used[k]) {
          newRl += x.toUpperCase();
          continue;
        }
        used[k] = true;
        newRl += x;
      }
      if (s0[1].includes("_")) this.triState = true;
      this.rulesLeft.push(newRl);
      this.rulesRight.push(s0[1]);
    }
  }
}

/** A chip defined by a custom logic model. */
export class CustomLogicElm extends ChipElm {
  static override dumpType = 208;
  static override get xmlTag(): string {
    return "cl";
  }
  static lastModelName = "default";
  modelName: string | null = null;
  postCount = 0;
  inputCount = 0;
  outputCount = 0;
  model: CustomLogicModel | null = null;
  lastValues: boolean[] = [];
  patternValues: boolean[] = [];
  highImpedance: boolean[] = [];

  override initNew(): void {
    super.initNew();
    this.modelName = CustomLogicElm.lastModelName;
    this.setupPins();
    this.allocNodes();
  }

  override readTokens(st: TokenStream): void {
    super.readTokens(st);
    this.modelName = CircuitText.unescape(st.next());
    this.updateModels();
    for (let i = 0; i !== this.getPostCount(); i++) {
      if (this.pins[i].output) {
        this.volts[i] = st.nextDouble();
        this.pins[i].value = this.volts[i] > this.getThreshold();
      }
    }
  }

  // upstream has no text writer for this part; the fields are written so text files stay readable
  override dumpChipValues(): string {
    let s = " " + CircuitText.escape(this.modelName ?? "");
    for (let i = 0; i !== this.getPostCount(); i++) if (this.pins[i].output) s += " " + this.volts[i];
    return s;
  }

  override textLossless(): boolean {
    return false;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["mo", this.modelName ?? ""]);
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    this.modelName = xml.string("mo", null);
    this.updateModels();
  }

  updateModels(): void {
    this.model = CustomLogicModel.getModelWithNameOrCopy(this.modelName ?? "", this.model);
    this.setupPins();
    this.allocNodes();
    this.setPoints();
  }

  override setupPins(): void {
    if (this.modelName === null) {
      this.postCount = this.bits;
      this.allocNodes();
      return;
    }
    const model = (this.model = CustomLogicModel.getModelWithName(this.modelName));
    this.inputCount = model.inputs.length;
    this.outputCount = model.outputs.length;
    this.sizeY = Math.max(this.inputCount, this.outputCount) || 1;
    this.sizeX = 2;
    this.postCount = this.inputCount + this.outputCount;
    this.pins = [];
    for (let i = 0; i !== this.inputCount; i++) {
      this.pins[i] = this.newPin(i, Side.W, model.inputs[i]);
      fixPinName(this.pins[i]);
    }
    for (let i = 0; i !== this.outputCount; i++) {
      const p = (this.pins[i + this.inputCount] = this.newPin(i, Side.E, model.outputs[i]));
      p.output = true;
      fixPinName(p);
    }
    this.lastValues = new Array<boolean>(this.postCount).fill(false);
    this.patternValues = new Array<boolean>(26).fill(false);
    this.highImpedance = new Array<boolean>(this.postCount).fill(false);
  }

  override getPostCount(): number {
    return this.postCount;
  }
  override getVoltageSourceCount(): number {
    return this.outputCount;
  }

  /** Without tri-state outputs things are much simpler (and faster). */
  hasTriState(): boolean {
    return this.model?.triState ?? false;
  }
  override nonLinear(): boolean {
    return this.hasTriState();
  }
  /** Tri-state outputs drive an internal node, with a resistor from there to the output. */
  override getInternalNodeCount(): number {
    return this.hasTriState() ? this.outputCount : 0;
  }

  override stamp(): void {
    const add = this.hasTriState() ? this.outputCount : 0;
    for (let i = 0; i !== this.getPostCount(); i++) {
      const p = this.pins[i];
      if (p.output) this.sim.stampVoltageSource(this.sim.ground, this.nodes[i + add]!, p.voltSource!);
    }
  }

  override doStep(): void {
    const add = this.hasTriState() ? this.outputCount : 0;
    for (let i = 0; i !== this.getPostCount(); i++) {
      const p = this.pins[i];
      if (!p.output) continue;
      // the output source drives the internal node if tri-state, otherwise the output directly
      this.sim.updateVoltageSource(this.sim.ground, this.nodes[i + add]!, p.voltSource!, p.value ? this.highVoltage : 0);
      if (this.hasTriState()) this.sim.stampResistor(this.nodes[i + add]!, this.nodes[i]!, this.highImpedance[i] ? 1e8 : 1e-3);
    }
  }

  override execute(): void {
    const model = this.model!, pins = this.pins;
    for (let i = 0; i !== model.rulesLeft.length; i++) {
      // check for a match
      const rl = model.rulesLeft[i];
      let j: number;
      for (j = 0; j !== rl.length; j++) {
        const x = rl[j];
        if (x === "0" || x === "1") {
          if (pins[j].value === (x === "1")) continue;
          break;
        }
        // don't care
        if (x === "?") continue;
        // up transition
        if (x === "+") {
          if (pins[j].value && !this.lastValues[j]) continue;
          break;
        }
        // down transition
        if (x === "-") {
          if (!pins[j].value && this.lastValues[j]) continue;
          break;
        }
        // save pattern values
        if (x >= "a" && x <= "z") {
          this.patternValues[x.charCodeAt(0) - 97] = pins[j].value;
          continue;
        }
        // compare pattern values
        if (x >= "A" && x <= "z") {
          if (this.patternValues[x.charCodeAt(0) - 65] !== pins[j].value) break;
          continue;
        }
      }
      if (j !== rl.length) continue;
      // success
      const rr = model.rulesRight[i];
      for (j = 0; j !== rr.length; j++) {
        const x = rr[j];
        this.highImpedance[j + this.inputCount] = false;
        if (x >= "a" && x <= "z") pins[j + this.inputCount].value = this.patternValues[x.charCodeAt(0) - 97];
        else if (x === "_") this.highImpedance[j + this.inputCount] = true;
        else pins[j + this.inputCount].value = x === "1";
      }
      break;
    }
    // save values for transition checking
    for (let j = 0; j !== this.postCount; j++) this.lastValues[j] = pins[j].value;
  }
}
