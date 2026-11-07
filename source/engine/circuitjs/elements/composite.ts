// Ported from CircuitJS1 (CompositeElm.java, CustomCompositeElm.java, CustomCompositeModel.java,
// CustomCompositeChipElm.java) by Paul Falstad and Iain Sharp.
// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Licensed under the GNU General Public License v2 or later. See LICENSE.
//
// Composite elements are made of other elements (each simulated individually), wired together by
// a node list. Subcircuits are user-defined composites whose model (its parts and pin layout) is
// stored in the circuit file.

import { CircuitElm, type XmlAttrs } from "../core/elm";
import { type GridPoint, pt } from "../core/geometry";
import type { CircuitNode, CircuitNodeLink } from "../core/nodes";
import { CircuitText, TokenStream, XmlNode } from "../io/tokens";
import { ChipElm, fixPinName, type Pin, Side } from "./chips";
import { LM317_MODEL, TL431_MODEL } from "./compositemodels";
import { CustomLogicModel } from "./customlogic";
import { DiodeModel } from "./diode";
import { MosfetModel } from "./mosfet";
import { RelayModel } from "./relays";
import { TransistorModel } from "./semis";

/** Element construction, provided by io/registry.ts (which imports this module). */
export interface ElementFactory {
  /** CirSim.constructElement(name, 0, 0): a new element by CircuitJS class name. */
  construct(className: string): CircuitElm | null;
  /** CirSim.createCe(type, 0, 0, 0, 0, flags, st): an element from text-format fields. */
  fromText(type: number, flags: number, st: TokenStream): CircuitElm | null;
  /** CirSim.xmlDumpTypeMap: the CircuitJS class name for an XML tag. */
  classNameForXmlTag(tag: string): string | null;
}

let factory: ElementFactory | null = null;
export function setElementFactory(f: ElementFactory): void {
  factory = f;
}

const dumpTypeOf = (e: CircuitElm) => (e.constructor as typeof CircuitElm).dumpType;

/** Parts that only matter for display; subcircuits leave them out of the simulation. */
const DISPLAY_ONLY = new Set(["WireElm", "RoutedWireElm", "LabeledNodeElm", "ScopeElm", "GraphicElm"]);

/** Base for elements built from other elements. */
export abstract class CompositeElm extends CircuitElm {
  /** Children are written with escape() instead of '_' separators, so composites can nest. */
  static readonly FLAG_ESCAPE = 1;
  /** Elements contained in this subcircuit. */
  compElmList: CircuitElm[] = [];

  /** For each node (posts first, then internal), the child terminals that use it. */
  compNodeList: CircuitNodeLink[][] | null = null;
  numPosts = 0;
  numNodes = 0;
  posts: GridPoint[] = [];
  /** Node numbers of each child, kept so the node list can be rebuilt in preStamp(). */
  compNodeInfo: string[] = [];
  extNodeIds: number[] = [];

  /** The Java constructors that take a model: load it and allocate nodes. */
  initComposite(st: TokenStream | null, model: string, externalNodes: number[]): void {
    this.loadComposite(st, model, externalNodes);
    this.buildCompNodeList();
    this.allocNodes();
  }

  override getChildElmList(): CircuitElm[] {
    return this.compElmList;
  }

  useEscape(): boolean {
    return (this.flags & CompositeElm.FLAG_ESCAPE) !== 0;
  }

  /** Build the children from a model ("Class node node…" lines separated by \r). */
  loadComposite(stIn: TokenStream | null, model: string, externalNodes: number[]): void {
    this.compElmList = [];
    const nodeInfoList: string[] = [];
    for (const line of model.split("\r")) {
      if (line.length === 0) continue;
      const sp = line.indexOf(" ");
      const ceType = sp < 0 ? line : line.substring(0, sp);
      const nodeStr = sp < 0 ? "" : line.substring(sp + 1);
      let newce = factory!.construct(ceType);
      if (stIn !== null && newce !== null) {
        const tint = dumpTypeOf(newce);
        let dumpedCe = stIn.next();
        if (this.useEscape()) dumpedCe = CircuitText.unescape(dumpedCe);
        const stCe = new TokenStream(dumpedCe, this.useEscape() ? / +/ : /_+/);
        const flags = stCe.nextInt();
        newce = factory!.fromText(tint, flags, stCe);
      }
      if (newce === null) continue;
      if (newce.isGround()) newce.flags |= 1; // GroundElm.setOldStyle()
      newce.parent = this;
      this.compElmList.push(newce);
      nodeInfoList.push(nodeStr);
    }
    this.compNodeInfo = nodeInfoList;
    this.extNodeIds = externalNodes;
    this.numPosts = this.numNodes = externalNodes.length;
    this.posts = new Array<GridPoint>(this.numPosts).fill(pt(0, 0));
    // dump new circuits with escape()
    this.flags |= CompositeElm.FLAG_ESCAPE;
  }

  /** Build the children from XML element definitions (each with an "nn" node list). */
  loadCompositeXml(elmEntries: XmlNode[], externalNodes: number[]): void {
    this.compElmList = [];
    const nodeInfoList: string[] = [];
    for (const childElem of elmEntries) {
      if (childElem.tag === "ccm") {
        // referenced subcircuit model, embedded when this model was created from a selection
        // that included an instance of it
        CustomCompositeModel.undumpModelXml(childElem);
        continue;
      }
      const className = factory!.classNameForXmlTag(childElem.tag);
      if (className === null) continue;
      // skip parts only needed for display. Ground is only skipped if it has coordinates (a
      // newer dump where it's purely visual); old-style dumps need it for simulation.
      if (DISPLAY_ONLY.has(className) || (className === "GroundElm" && childElem.get("x") !== undefined)) continue;
      const newce = factory!.construct(className);
      if (newce === null) continue;
      if (newce.isGround()) newce.flags |= 1; // GroundElm.setOldStyle()
      newce.undumpXml(childElem);
      newce.parent = this;
      this.compElmList.push(newce);
      nodeInfoList.push(childElem.get("nn") ?? "");
    }
    this.compNodeInfo = nodeInfoList;
    this.extNodeIds = externalNodes;
    // the real node count is filled in by preStamp()
    this.numPosts = this.numNodes = externalNodes.length;
    this.posts = new Array<GridPoint>(this.numPosts).fill(pt(0, 0));
    this.flags |= CompositeElm.FLAG_ESCAPE;
  }

  /**
   * Build compNodeList from the stored node info. Called from preStamp() so children have their
   * final state when asked for their internal node counts.
   */
  buildCompNodeList(): void {
    const ground: CircuitNode | undefined = this.sim?.ground;
    const compNodeHash = new Map<number, CircuitNodeLink[]>();
    for (let i = 0; i !== this.compElmList.length; i++) {
      const ce = this.compElmList[i];
      const stNodes = new TokenStream(this.compNodeInfo[i], /[ +\t]+/);
      let thisPost = 0;
      while (stNodes.hasMoreTokens) {
        const nodeOfThisPost = stNodes.nextInt();
        // node = 0 means ground
        if (nodeOfThisPost === 0) {
          if (ground) {
            ce.setNode(thisPost, ground);
            ce.setNodeVoltage(thisPost, 0);
          }
          thisPost++;
          continue;
        }
        const link = { num: thisPost, elm: ce };
        const links = compNodeHash.get(nodeOfThisPost);
        if (links) links.push(link);
        else compNodeHash.set(nodeOfThisPost, [link]);
        thisPost++;
      }
    }

    // external nodes first
    const list: CircuitNodeLink[][] = [];
    for (const id of this.extNodeIds) {
      const links = compNodeHash.get(id);
      if (!links) {
        this.compNodeList = null;
        return;
      }
      list.push(links);
      compNodeHash.delete(id);
    }
    for (const links of compNodeHash.values()) list.push(links);

    // more nodes for the children's internal nodes
    for (const ce of this.compElmList) {
      const inodes = ce.getInternalNodeCount();
      for (let j = 0; j !== inodes; j++) list.push([{ num: j + ce.getPostCount(), elm: ce }]);
    }
    this.compNodeList = list;
    this.numNodes = list.length;
  }

  override preStamp(): void {
    for (const ce of this.compElmList) {
      // nested composites need the simulator before they're added to the element list
      ce.sim = this.sim;
      ce.preStamp();
    }
    this.buildCompNodeList();
    this.allocNodes();
  }

  override dumpValues(): string {
    return this.dumpElements();
  }

  /** The children's text-format lines, escaped, without their (unused) type and coordinates. */
  dumpElements(mask = -1): string {
    let s = "";
    for (let i = 0; i < this.compElmList.length; i++) {
      if (mask !== -1 && (mask & (1 << i)) === 0) continue;
      const t = this.compElmList[i].dump().replace(/[A-Za-z0-9]+ 0 0 0 0 /, "");
      s += " " + CircuitText.escape(t);
    }
    return s;
  }

  /** Children with state are saved as child tags, identified by index ("ix"). */
  override xmlChildren(): XmlNode[] {
    const out: XmlNode[] = [];
    this.compElmList.forEach((ce, i) => {
      const a: XmlAttrs = [];
      ce.dumpXmlState(a);
      const children = ce.xmlChildren();
      const text = ce.xmlStateText();
      if (a.length === 0 && children.length === 0 && !text) return;
      a.push(["ix", String(i)]);
      const n = new XmlNode(ce.xmlTag(), Object.fromEntries(a));
      n.children = children;
      n.text = text ?? "";
      out.push(n);
    });
    return out;
  }

  override undumpXml(xml: XmlNode): void {
    super.undumpXml(xml);
    for (const elem of xml.children) {
      const ix = elem.int("ix", -1);
      const ce = this.compElmList[ix];
      if (!ce) continue;
      if (elem.tag !== ce.xmlTag()) throw new Error("dump type mismatch for composite child: " + ix);
      ce.undumpXml(elem);
    }
  }

  /** Without FLAG_ESCAPE the children are read back with '_' separators, which escape() doesn't produce. */
  override textLossless(): boolean {
    return this.useEscape();
  }

  override getConnection(_n1: number, _n2: number): boolean {
    return false;
  }
  override hasGroundConnection(_n1: number): boolean {
    return false;
  }

  override reset(): void {
    for (const ce of this.compElmList) ce.reset();
  }

  override getPostCount(): number {
    return this.numPosts;
  }
  override getInternalNodeCount(): number {
    return this.numNodes - this.numPosts;
  }
  override getPost(n: number): GridPoint {
    return this.posts[n];
  }
  setPost(n: number, p: GridPoint): void {
    this.posts[n] = p;
  }

  override getPower(): number {
    let power = 0;
    for (const ce of this.compElmList) power += ce.getPower();
    return power;
  }

  override stamp(): void {
    for (const ce of this.compElmList) ce.setParentList(this.compElmList);
  }

  /** Set node p (local to this element) to n (global), for every child terminal using it. */
  override setNode(p: number, n: CircuitNode): void {
    super.setNode(p, n);
    if (this.compNodeList === null) return;
    for (const link of this.compNodeList[p]) link.elm.setNode(link.num, n);
  }

  override getCurrentIntoNode(n: number): number {
    if (this.compNodeList === null) return 0;
    let c = 0;
    for (const link of this.compNodeList[n]) c += link.elm.getCurrentIntoNode(link.num);
    return c;
  }
}

/** One external pin of a subcircuit model. */
export class ExtListEntry {
  busWidth = 1;
  busZ = 0;
  constructor(public name: string, public node: number, public pos = 0, public side: number = Side.W) {}
}

/** A subcircuit definition: its pins and the XML definitions of its parts. */
export class CustomCompositeModel {
  static globalModelMap: Map<string, CustomCompositeModel> | null = null;
  static localModelMap = new Map<string, CustomCompositeModel>();
  static readonly FLAG_SHOW_LABEL = 1;

  flags = 0;
  sizeX = 0;
  sizeY = 0;
  name = "";
  extList: ExtListEntry[] = [];
  /** Part definitions; each has its XML tag, an "nn" node list and its saved attributes. */
  elms: XmlNode[] = [];
  /** Not shown in the model list. */
  internal = false;
  /** Included by default. */
  builtin = false;

  static initModelMap(): void {
    CustomCompositeModel.globalModelMap = new Map();
    CustomCompositeModel.localModelMap = new Map();

    // default stub model
    const d = CustomCompositeModel.createModelFromOldFormat("default", "0 0", "GroundElm 1", [new ExtListEntry("gnd", 1)]);
    d.sizeX = d.sizeY = 1;
    d.builtin = true;
    CustomCompositeModel.localModelMap.delete(d.name);
    CustomCompositeModel.globalModelMap.set(d.name, d);
    CustomCompositeModel.loadInternalModels();
  }

  static getModelWithName(name: string): CustomCompositeModel | null {
    if (CustomCompositeModel.globalModelMap === null) CustomCompositeModel.initModelMap();
    return CustomCompositeModel.localModelMap.get(name) ?? CustomCompositeModel.globalModelMap!.get(name) ?? null;
  }

  /** Model from the old nodeList/elmDump format, converted to XML immediately. */
  static createModelFromOldFormat(name: string, elmDump: string, nodeList: string, extList: ExtListEntry[]): CustomCompositeModel {
    const lm = new CustomCompositeModel();
    lm.name = name;
    lm.extList = extList;
    lm.convertOldFormatToXml(nodeList, elmDump);
    CustomCompositeModel.localModelMap.set(name, lm);
    return lm;
  }

  /** Models defined by a circuit file are local to it (CircuitLoader clears them on load). */
  static clearLocalModels(): void {
    CustomCompositeModel.localModelMap.clear();
  }

  /** Model to define or update for a name read from a file (a global one gets a local shadow). */
  private static modelForUndump(name: string): CustomCompositeModel {
    let model = CustomCompositeModel.getModelWithName(name);
    const local = CustomCompositeModel.localModelMap;
    if (model === null || (CustomCompositeModel.globalModelMap!.has(name) && !local.has(name))) {
      model = new CustomCompositeModel();
      model.name = name;
      local.set(name, model);
    }
    return model;
  }

  /** A "." line of the text format. */
  static undumpModel(st: TokenStream): CustomCompositeModel {
    const model = CustomCompositeModel.modelForUndump(CircuitText.unescape(st.next()));
    model.undump(st);
    return model;
  }

  undump(st: TokenStream): void {
    this.flags = st.nextInt();
    this.sizeX = st.nextInt();
    this.sizeY = st.nextInt();
    const extCount = st.nextInt();
    this.extList = [];
    for (let i = 0; i !== extCount; i++) {
      const s = CircuitText.unescape(st.next());
      const n = st.nextInt(), p = st.nextInt(), sd = st.nextInt();
      this.extList.push(new ExtListEntry(s, n, p, sd));
    }
    const nodeList = CircuitText.unescape(st.next());
    const elmDump = CircuitText.unescape(st.next());
    this.convertOldFormatToXml(nodeList, elmDump);
  }

  /** Convert the old nodeList/elmDump strings to XML part definitions. */
  convertOldFormatToXml(nodeList: string, elmDump: string): void {
    this.elms = [];
    const elmSt = new TokenStream(elmDump, / +/);
    for (const line of nodeList.split("\r")) {
      if (line.length === 0) continue;
      const stModel = new TokenStream(line);
      const ceType = stModel.next();
      // node list from the remaining tokens
      const nn: string[] = [];
      while (stModel.hasMoreTokens) nn.push(stModel.next());

      // construct the element and apply its state from elmDump
      let ce = factory!.construct(ceType);
      if (ce === null) continue;
      if (elmSt.hasMoreTokens) {
        const stCe = new TokenStream(CircuitText.unescape(elmSt.next()), / +/);
        const ceFlags = stCe.nextInt();
        ce = factory!.fromText(dumpTypeOf(ce), ceFlags, stCe);
        if (ce === null) continue;
      }
      // needed for very old dumps which still have GroundElm
      if (ce.isGround()) ce.flags |= 1;

      const a: XmlAttrs = [["nn", nn.join(" ")]];
      ce.dumpXml(a);
      this.elms.push(new XmlNode(ce.xmlTag(), Object.fromEntries(a.filter(([k]) => k !== "x"))));
    }
  }

  /** A <ccm> tag. */
  static undumpModelXml(xml: XmlNode): CustomCompositeModel {
    const model = CustomCompositeModel.modelForUndump(xml.string("nm", null) ?? "");
    model.parseXmlElement(xml);
    return model;
  }

  parseXmlElement(xml: XmlNode): void {
    this.flags = xml.int("f", this.flags);
    this.sizeX = xml.int("sx", this.sizeX);
    this.sizeY = xml.int("sy", this.sizeY);
    const bcs = xml.int("bcs", 0) !== 0;
    this.extList = [];
    this.elms = [];
    for (const child of xml.children) {
      if (child.tag === "ext") {
        const s = child.string("nm", "") ?? "";
        const n = child.int("nd", 0), p = child.int("ps", 0), sd = child.int("sd", 0);
        const bw = child.int("bw", 1);
        if (bcs && bw > 1) {
          // expand compact bus entries
          for (let j = 0; j < bw; j++) {
            const ent = new ExtListEntry(s, n + j, p, sd);
            ent.busWidth = bw;
            ent.busZ = j;
            this.extList.push(ent);
          }
        } else {
          const ent = new ExtListEntry(s, n, p, sd);
          ent.busWidth = bw;
          ent.busZ = child.int("bz", 0);
          this.extList.push(ent);
        }
        continue;
      }
      this.elms.push(child);
      // models are registered right away: parts look theirs up as soon as they're created
      switch (child.tag) {
        case "dm": DiodeModel.undumpModelXml(child); break;
        case "rlm": RelayModel.undumpModelXml(child); break;
        case "tm": TransistorModel.undumpModelXml(child); break;
        case "mm": MosfetModel.undumpModelXml(child); break;
        case "ccm": CustomCompositeModel.undumpModelXml(child); break;
        case "clm": CustomLogicModel.undumpModelXml(child); break;
      }
    }
  }

  /** Are the bus entries' node numbers consecutive, so the compact format can be used? */
  busNodesConsecutive(): boolean {
    for (let i = 0; i < this.extList.length; i++) {
      const ent = this.extList[i];
      if (ent.busZ > 0 && ent.node !== this.extList[i - 1].node + 1) return false;
    }
    return true;
  }

  /** The model as a <ccm> tag. */
  toXml(): XmlNode {
    const a: XmlAttrs = [["nm", this.name], ["f", String(this.flags)], ["sx", String(this.sizeX)], ["sy", String(this.sizeY)]];
    const bcs = this.busNodesConsecutive();
    if (bcs) a.push(["bcs", "1"]);
    const n = new XmlNode("ccm", Object.fromEntries(a));
    for (const ent of this.extList) {
      if (bcs && ent.busZ > 0) continue;
      const ea: XmlAttrs = [["nm", ent.name], ["nd", String(ent.node)], ["ps", String(ent.pos)], ["sd", String(ent.side)]];
      if (ent.busWidth > 1) {
        ea.push(["bw", String(ent.busWidth)]);
        if (!bcs) ea.push(["bz", String(ent.busZ)]);
      }
      n.children.push(new XmlNode("ext", Object.fromEntries(ea)));
    }
    n.children.push(...this.elms);
    return n;
  }

  /** Part definitions for loadCompositeXml(). */
  getElmEntries(): XmlNode[] {
    return this.elms;
  }

  /** The old-format node list (for instances saved in the text format with per-part state). */
  getNodeList(): string {
    const lines: string[] = [];
    for (const child of this.elms) {
      const className = factory!.classNameForXmlTag(child.tag);
      if (className === null) continue;
      const nn = child.get("nn");
      lines.push(className + (nn ? " " + nn : ""));
    }
    return lines.join("\r");
  }

  /** Models to choose from: global and this circuit's (local ones win), without internal ones, by name. */
  static getModelList(): CustomCompositeModel[] {
    if (CustomCompositeModel.globalModelMap === null) CustomCompositeModel.initModelMap();
    const merged = new Map(CustomCompositeModel.globalModelMap!);
    for (const [k, m] of CustomCompositeModel.localModelMap) merged.set(k, m);
    return [...merged.values()].filter((m) => !m.internal).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  showLabel(): boolean {
    return (this.flags & CustomCompositeModel.FLAG_SHOW_LABEL) !== 0;
  }

  /** Models used by these elements (and nested subcircuits), dependencies first. */
  static modelsUsedBy(elements: CircuitElm[]): CustomCompositeModel[] {
    const out: CustomCompositeModel[] = [];
    const visit = (list: CircuitElm[]) => {
      for (const e of list) {
        if (!(e instanceof CustomCompositeElm)) continue;
        visit(e.compElmList);
        const m = e.model;
        if (m && !m.builtin && !m.internal && !out.includes(m)) out.push(m);
      }
    };
    visit(elements);
    return out;
  }

  static loadInternalModels(): void {
    for (const s of [LM317_MODEL, TL431_MODEL]) {
      const st = new TokenStream(s, / +/);
      st.next();
      const model = CustomCompositeModel.undumpModel(st);
      model.internal = model.builtin = true;
      // move from local to global since these are builtins
      CustomCompositeModel.localModelMap.delete(model.name);
      CustomCompositeModel.globalModelMap!.set(model.name, model);
    }
  }
}

/** Draws a subcircuit: a chip outline with the model's pins. */
export class CustomCompositeChipElm extends ChipElm {
  label: string | null = null;

  override setupPins(): void {}
  override getVoltageSourceCount(): number {
    return 0;
  }
  allocPins(n: number): void {
    this.pins = new Array<Pin>(n);
  }
  setPin(n: number, p: number, s: number, t: string): void {
    this.pins[n] = this.newPin(p, s, t);
    fixPinName(this.pins[n]);
  }
  setLabel(text: string | null): void {
    this.label = text;
  }
  override getPostCount(): number {
    return this.pins.length;
  }
}

/** An instance of a subcircuit model. */
export class CustomCompositeElm extends CompositeElm {
  static override dumpType = 410;
  static override get xmlTag(): string {
    return "cc";
  }
  static lastModelName = "default";
  static readonly FLAG_SMALL = 2;
  modelName = "default";
  chip: CustomCompositeChipElm | null = null;
  postCount = 0;
  model: CustomCompositeModel | null = null;
  highVoltage = 0;
  /** Extra straight pin length by physical side (N, S, W, E). */
  leadExtensions = [0, 0, 0, 0];

  override initNew(): void {
    // the last model for parts placed in the editor; default otherwise (avoids infinite
    // recursion creating nested subcircuits)
    this.modelName = this.x === 0 && this.y === 0 ? "default" : CustomCompositeElm.lastModelName;
    this.flags |= CompositeElm.FLAG_ESCAPE;
    this.updateModels();
  }

  /** CirSim.constructElement("CustomCompositeElm:name"). */
  initWithModel(name: string): void {
    this.modelName = name;
    this.flags |= CompositeElm.FLAG_ESCAPE;
    this.updateModels();
  }

  override readTokens(st: TokenStream): void {
    this.modelName = CircuitText.unescape(st.next());
    this.updateModelsFrom(st);
  }

  // upstream's text writer leaves the model name out; it's written so text files stay readable
  override dumpValues(): string {
    return " " + CircuitText.escape(this.modelName) + this.dumpElements();
  }

  override textLossless(): boolean {
    return false;
  }

  override dumpXml(a: XmlAttrs): void {
    super.dumpXml(a);
    a.push(["mo", this.modelName]);
    if (this.highVoltage !== 0) a.push(["hv", String(this.highVoltage)]);
    if (this.leadExtensions.some((v) => v !== 0)) a.push(["le", this.leadExtensions.join(",")]);
  }

  override undumpXml(xml: XmlNode): void {
    this.modelName = xml.string("mo", this.modelName) ?? this.modelName;
    this.highVoltage = xml.double("hv", 0);
    this.leadExtensions = (xml.string("le", "") ?? "").split(",").map(Number);
    if (this.leadExtensions.length !== 4 || this.leadExtensions.some((v) => !Number.isFinite(v) || v < 0)) this.leadExtensions = [0, 0, 0, 0];
    this.updateModels();
    super.undumpXml(xml);
  }

  override setPoints(): void {
    super.setPoints();
    const chip = new CustomCompositeChipElm(this.x, this.y, this.x, this.y, 0);
    chip.initNew();
    chip.x2 = this.x2;
    chip.y2 = this.y2;
    chip.flags = this.flags & (ChipElm.FLAG_FLIP_X | ChipElm.FLAG_FLIP_Y | ChipElm.FLAG_FLIP_XY);
    chip.leadExtensions = this.leadExtensions;
    this.chip = chip;

    const model = this.model;
    if (model === null) {
      // the model couldn't be resolved; drawn as a labeled placeholder
      chip.setSize((this.flags & CustomCompositeElm.FLAG_SMALL) !== 0 ? 1 : 2);
      chip.setLabel("?");
      chip.sizeX = chip.sizeY = 2;
      chip.allocPins(0);
      chip.setPoints();
      this.boundingBox = chip.boundingBox;
      return;
    }

    chip.setSize((this.flags & CustomCompositeElm.FLAG_SMALL) !== 0 ? 1 : 2);
    chip.setLabel(model.showLabel() ? model.name : null);
    chip.sizeX = model.sizeX;
    chip.sizeY = model.sizeY;
    chip.allocPins(this.postCount);
    for (let i = 0; i !== this.postCount; i++) {
      const pin = model.extList[i];
      chip.setPin(i, pin.pos, pin.side, pin.name);
      chip.pins[i].busWidth = pin.busWidth;
      chip.pins[i].busZ = pin.busZ;
    }
    chip.setPoints();
    this.boundingBox = chip.boundingBox;
    for (let i = 0; i !== this.getPostCount(); i++) this.setPost(i, chip.getPost(i));
  }

  override initBoundingBox(): void {
    if (this.chip) this.boundingBox = this.chip.boundingBox;
    else super.initBoundingBox();
  }

  isFlippedX(): boolean {
    return (this.flags & ChipElm.FLAG_FLIP_X) !== 0;
  }
  isFlippedY(): boolean {
    return (this.flags & ChipElm.FLAG_FLIP_Y) !== 0;
  }

  updateModels(): void {
    this.model = null;
    this.updateModelsFrom(null);
  }

  updateModelsFrom(st: TokenStream | null): void {
    if (this.model !== null && this.model.name === this.modelName) return;
    const model = (this.model = CustomCompositeModel.getModelWithName(this.modelName));
    if (model === null) {
      // the referenced model isn't available; keep the name so a later update can resolve it
      this.postCount = 0;
      this.compElmList = [];
      this.numPosts = this.numNodes = 0;
      this.posts = [];
      this.allocNodes();
      this.setPoints();
      return;
    }
    this.postCount = model.extList.length;
    const externalNodes = model.extList.map((e) => e.node);
    // the old format stores per-instance state for each part
    if (st !== null) this.loadComposite(st, model.getNodeList(), externalNodes);
    else this.loadCompositeXml(model.getElmEntries(), externalNodes);
    this.propagateHighVoltage();
    this.allocNodes();
    this.setPoints();
  }

  propagateHighVoltage(): void {
    if (this.highVoltage === 0) return;
    for (const ce of this.compElmList) {
      ce.setHighVoltage(this.highVoltage);
      if (ce instanceof CustomCompositeElm) ce.propagateHighVoltage();
    }
  }

  override setHighVoltage(hv: number): void {
    this.highVoltage = hv;
  }

  override getPostCount(): number {
    return this.postCount;
  }
  override getPostWidth(n: number): number {
    return this.chip !== null ? this.chip.getPostWidth(n) : 1;
  }
}
