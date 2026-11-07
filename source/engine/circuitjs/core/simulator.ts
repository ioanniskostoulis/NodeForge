// Ported from CircuitJS1 (SimulationManager.java) by Paul Falstad and Iain Sharp.
// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Licensed under the GNU General Public License v2 or later. See LICENSE.
//
// Modified nodal analysis: every element stamps conductances / sources into one or more linear
// systems, which are LU-solved every (sub)iteration. Nonlinear elements re-stamp in doStep() and
// the solve repeats until all of them report convergence.

import type { CircuitElm } from "./elm";
import { type GridPoint, pointKey, pt, rectContains, samePoint } from "./geometry";
import { luFactorDense, luSolveDense } from "./lu";
import { CircuitMatrix, CircuitNode, type MatrixSolver, VoltageSource } from "./nodes";

/**
 * Bookkeeping for wire currents: wires are merged out of the matrix, so their current is
 * reconstructed from their neighbors after each step.
 */
export interface WireSegment {
  wire: CircuitElm;
  bit: number;
  endpoint0: string | null;
  endpoint1: string | null;
  neighbors: CircuitElm[];
  labelNeighbors: WireSegment[];
  /** 0 or 1: which endpoint is used for the current calculation. */
  post: number;
  current: number;
}

/** Maps grid points to (eventually allocated) nodes; entries are shared by joined points. */
class NodeMapEntry {
  constructor(public node: CircuitNode | null = null) {}
}

export const SolverType = { auto: 0, dense: 1, sparse: 2 } as const;

export class Simulator {
  /** Elements of the circuit being simulated (top level). */
  circuitElements: CircuitElm[] = [];

  /** Flattened simulation list (includes composite children). */
  elmList: CircuitElm[] = [];
  elmArr: CircuitElm[] = [];
  nodeList: CircuitNode[] = [];
  voltageSources: VoltageSource[] = [];
  matrices: CircuitMatrix[] = [];
  circuitNonLinear = false;
  voltageSourceCount = 0;
  needsStamp = false;
  analyzeFlag = true;
  simRunning = true;

  ground!: CircuitNode;
  /** Location of the first ground element seen during wire closure (all grounds are merged). */
  firstGround: GridPoint | null = null;
  /**
   * Random numbers for elements that need them (CirSim.getrand: noise, oscillating gates).
   * Seeded, so a run is repeatable; reset() restarts the sequence.
   */
  private rngState = 0x2f6b9a1d;
  random(): number {
    // mulberry32
    let t = (this.rngState = (this.rngState + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** CirSim.getrand(n): an integer in [0, n). */
  getrand(n: number): number {
    return Math.floor(this.random() * n);
  }

  /** Labeled nodes by name: the first post seen with each label, and its node (LabeledNodeElm.labelList). */
  labelList = new Map<string, { point: GridPoint; node: CircuitNode | null }>();

  // time
  t = 0;
  /** Current timestep (may drop below maxTimeStep when convergence is difficult). */
  timeStep = 5e-6;
  maxTimeStep = 5e-6;
  minTimeStep = 50e-12;
  timeStepAccum = 0;
  /** Incremented each time t advances by maxTimeStep. */
  timeStepCount = 0;
  adjustTimeStep = false;
  /**
   * The NodeForge engine is running (source/engine/nodeforge): set by it, read by the few parts that
   * behave differently under it. Always false here.
   */
  accurate = false;
  // solver state
  converged = false;
  subIterations = 0;
  solverType: number = SolverType.auto;
  dcAnalysisFlag = false;
  showResistanceInVoltageSources = true;
  /** When true, wire currents are only computed once per run call (fine when no scope watches a wire). */
  delayWireProcessing = false;

  stopMessage: string | null = null;
  stopElm: CircuitElm | null = null;

  // analysis scratch
  private nodeMap = new Map<string, NodeMapEntry>();
  wireInfoList: WireSegment[] = [];
  private wireInfoElmSet = new Set<CircuitElm>();
  private wireInfoResolved = new Map<CircuitElm, Set<number>>();
  unconnectedNodes: number[] = [];
  nodesWithGroundConnection: CircuitElm[] = [];
  postDrawList: GridPoint[] = [];
  badConnectionList: GridPoint[] = [];

  // hooks
  /** Called after every completed timestep (scopes sample here). */
  onTimeStep: (() => void) | null = null;
  /** Lets a test driver shorten the next timestep to land exactly on an event. */
  clampTimeStep: ((t: number, timeStep: number) => number) | null = null;
  /** Called after onTimeStep; return true to end the current run call (e.g. to re-analyze). */
  checkTime: (() => boolean) | null = null;
  log: ((s: string) => void) | null = null;

  /** Replace the element list (after loading or editing). Triggers re-analysis. */
  setElements(elements: CircuitElm[]): void {
    this.circuitElements = elements;
    for (const ce of elements) ce.sim = this;
    this.analyzeFlag = true;
  }

  resetTime(): void {
    this.rngState = 0x2f6b9a1d;
    this.t = 0;
    this.timeStepAccum = 0;
    this.timeStepCount = 0;
  }

  /** The Reset button: reset time and all element state. */
  reset(): void {
    this.analyzeFlag = true;
    this.resetTime();
    for (const ce of this.circuitElements) ce.reset();
  }

  /**
   * Analyze and stamp if needed, then run timesteps until `shouldStop` returns true.
   * `shouldStop` receives the number of maxTimeStep intervals completed during this call.
   */
  update(shouldStop: (completed: number) => boolean): void {
    const didAnalyze = this.analyzeFlag;
    if (this.analyzeFlag || this.dcAnalysisFlag) {
      this.analyzeCircuit();
      this.analyzeFlag = false;
    }
    if (this.needsStamp && this.simRunning) this.preStampAndStampCircuit();
    if (this.simRunning) this.run(didAnalyze, shouldStop);
    if (this.dcAnalysisFlag) {
      this.dcAnalysisFlag = false;
      this.analyzeFlag = true;
    }
  }

  /** Run timesteps (the NodeForge engine runs its own when it's on). */
  protected run(didAnalyze: boolean, shouldStop: (completed: number) => boolean): void {
    this.runCircuit(didAnalyze, shouldStop);
  }

  stop(s: string, ce: CircuitElm | null): void {
    this.stopMessage = s;
    this.stopElm = ce;
    this.simRunning = false;
    this.analyzeFlag = false;
    this.log?.(`stopped: ${s}`);
  }

  /** Analyze when something changes. Most work is deferred to preStampCircuit(). */
  analyzeCircuit(): void {
    this.stopMessage = null;
    this.stopElm = null;
    this.elmList = this.circuitElements;
    for (const ce of this.elmList) ce.sim = this;
    if (this.elmList.length === 0) {
      this.postDrawList = [];
      this.badConnectionList = [];
      return;
    }
    this.detectBusWidths(this.elmList);
    this.makePostDrawList();
    this.needsStamp = true;
  }

  /** Points where connected bus widths disagree (for the editor to flag). */
  busMismatchList: GridPoint[] = [];

  /** Give wires and labeled nodes the bus width of what they're connected to. */
  detectBusWidths(list: CircuitElm[]): void {
    this.busMismatchList = [];
    const key = (p: GridPoint) => `${p.x},${p.y}`;
    const mismatch = (k: string) => {
      const [x, y] = k.split(",").map(Number);
      this.busMismatchList.push(pt(x, y));
    };
    const widthMap = new Map<string, number>();
    for (const ce of list) {
      if (ce.isRemovableWire()) continue;
      for (let j = 0; j < ce.getPostCount(); j++) {
        const w = ce.getPostWidth(j);
        if (w <= 1) continue;
        const k = key(ce.getPost(j));
        const existing = widthMap.get(k);
        if (existing !== undefined && existing !== w) mismatch(k);
        if (existing === undefined || w > existing) widthMap.set(k, w);
      }
    }
    // propagate bus widths through wire chains and matching labels until stable
    const labelWidthMap = new Map<string, number>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const ce of list) {
        const label = ce.busLabel();
        const side = ce.busSide();
        if (ce.isWire()) {
          const k1 = key(ce.point1), k2 = key(ce.point2);
          const w1 = widthMap.get(k1), w2 = widthMap.get(k2);
          let w = 1;
          if (w1 !== undefined) w = w1;
          if (w2 !== undefined && w2 > w) w = w2;
          if (w !== ce.getBusWidth()) {
            ce.setBusWidth(w);
            changed = true;
          }
          if (w > 1) {
            if (w1 === undefined || w1 < w) { widthMap.set(k1, w); changed = true; }
            if (w2 === undefined || w2 < w) { widthMap.set(k2, w); changed = true; }
          }
        } else if (label !== null) {
          // max width from the position map and the label name map
          const k = key(ce.point1);
          const w = widthMap.get(k), lw = labelWidthMap.get(label);
          let bw = 1;
          if (w !== undefined) bw = w;
          if (lw !== undefined && lw > bw) bw = lw;
          if (bw !== ce.getBusWidth()) {
            ce.setBusWidth(bw);
            changed = true;
          }
          if (bw > 1) {
            if (w === undefined || w < bw) { widthMap.set(k, bw); changed = true; }
            if (lw === undefined || lw < bw) { labelWidthMap.set(label, bw); changed = true; }
          }
        } else if (side !== null) {
          // the bus side is at pin 0
          const k = key(side.post);
          const w = widthMap.get(k);
          if (w !== undefined && w !== side.width) mismatch(k);
          if (w === undefined || w < side.width) {
            widthMap.set(k, side.width);
            changed = true;
          }
        }
      }
    }
    // each non-wire element's post widths against the propagated widths
    for (const ce of list) {
      if (ce.isRemovableWire()) continue;
      for (let j = 0; j < ce.getPostCount(); j++) {
        const w = ce.getPostWidth(j);
        if (w <= 1) continue;
        const k = key(ce.getPost(j));
        const propagated = widthMap.get(k);
        if (propagated !== undefined && propagated !== w) mismatch(k);
      }
    }
  }

  /**
   * Find groups of points connected by wire equivalents and map them to the same entry, which
   * keeps wires out of the matrix. Node numbers are assigned later.
   */
  private calculateWireClosure(): void {
    this.firstGround = null;
    this.labelList = new Map();
    const nm = new Map<string, NodeMapEntry>();
    this.wireInfoList = [];
    this.wireInfoElmSet = new Set(this.elmList);
    for (const ce of this.elmList) {
      if (!ce.isRemovableWire()) continue;
      ce.getWireSegments(this.wireInfoList);

      for (let j = 0; j < ce.getBusWidth(); j++) {
        const p0 = pointKey(ce.getPost(j));
        let cn = nm.get(p0);

        // what post are we connected to
        const p1pt = ce.getConnectedPost(j);
        if (p1pt === null) {
          // no connected post (first ground, or a label seen for the first time)
          if (!cn) nm.set(p0, new NodeMapEntry());
          continue;
        }
        const p1 = pointKey(p1pt);
        const cn2 = nm.get(p1);
        if (cn && cn2) {
          // merge: redirect every key pointing at cn2 to cn
          if (cn !== cn2) for (const [key, entry] of nm) if (entry === cn2) nm.set(key, cn);
        } else if (cn) {
          nm.set(p1, cn);
        } else if (cn2) {
          nm.set(p0, cn2);
        } else {
          cn = new NodeMapEntry();
          nm.set(p0, cn);
          nm.set(p1, cn);
        }
      }
    }
    this.nodeMap = nm;
  }

  private isWireInfoResolved(ce: CircuitElm, bit: number): boolean {
    return this.wireInfoResolved.get(ce)?.has(bit) ?? false;
  }

  private setWireInfoResolved(ce: CircuitElm, bit: number): void {
    let bits = this.wireInfoResolved.get(ce);
    if (!bits) {
      bits = new Set();
      this.wireInfoResolved.set(ce, bits);
    }
    bits.add(bit);
  }

  /** Order wire segments so each one's current can be computed from already-resolved neighbors. */
  private calcWireInfo(): boolean {
    let moved = 0;
    this.wireInfoResolved = new Map();

    // label endpoint → segments sharing that label
    const labelMap = new Map<string, WireSegment[]>();
    for (const ws of this.wireInfoList) {
      if (ws.endpoint1 && ws.endpoint1.startsWith("label:")) {
        const list = labelMap.get(ws.endpoint1) ?? [];
        list.push(ws);
        labelMap.set(ws.endpoint1, list);
      }
    }

    for (let i = 0; i < this.wireInfoList.length; i++) {
      const ws = this.wireInfoList[i];
      const wire = ws.wire;
      const cn1 = wire.getNode(ws.bit);
      if (!cn1) {
        // dangling labeled node inside a composite: no current
        ws.neighbors = [];
        ws.labelNeighbors = [];
        this.setWireInfoResolved(wire, ws.bit);
        continue;
      }

      const neighbors0: CircuitElm[] = [];
      const neighbors1: CircuitElm[] = [];
      const labelNeighbors: WireSegment[] = [];
      let isReady0 = true;
      let isReady1 = !wire.isGround();

      // position-based matching via node links
      for (const cnl of cn1.links) {
        const ce = cnl.elm;
        if (ce === wire) continue;
        if (!this.wireInfoElmSet.has(ce)) continue;
        if (cnl.num >= ce.getPostCount()) continue;
        const ptKey = pointKey(ce.getPost(cnl.num));
        const neighborBit = cnl.num % ce.getBusWidth();
        const notReady = ce.isRemovableWire() && !this.isWireInfoResolved(ce, neighborBit);

        if (ws.endpoint0 === ptKey) {
          neighbors0.push(ce);
          if (notReady) isReady0 = false;
        } else if (ws.endpoint1 && !ws.endpoint1.startsWith("label:") && ws.endpoint1 === ptKey) {
          neighbors1.push(ce);
          if (notReady) isReady1 = false;
        }
      }

      // label-based matching
      if (ws.endpoint1 && ws.endpoint1.startsWith("label:")) {
        for (const other of labelMap.get(ws.endpoint1) ?? []) {
          if (other === ws) continue;
          labelNeighbors.push(other);
          if (!this.isWireInfoResolved(other.wire, other.bit)) isReady1 = false;
        }
      }

      if (isReady0) {
        ws.neighbors = neighbors0;
        ws.post = 0;
        this.setWireInfoResolved(wire, ws.bit);
        moved = 0;
      } else if (isReady1 && (ws.endpoint1 !== null || !wire.isGround())) {
        ws.neighbors = neighbors1;
        ws.labelNeighbors = labelNeighbors;
        ws.post = 1;
        this.setWireInfoResolved(wire, ws.bit);
        moved = 0;
      } else {
        // try again later
        this.wireInfoList.push(this.wireInfoList.splice(i--, 1)[0]);
        moved++;
        if (moved > this.wireInfoList.length * 2) {
          this.stop("wire loop detected", wire);
          return false;
        }
      }
    }
    return true;
  }

  /** Allocate the ground node and decide which point it is attached to. */
  private setGroundNode(subcircuit: boolean): void {
    let gotGround = false;
    let gotRail = false;
    let volt: CircuitElm | null = null;
    let battery: CircuitElm | null = null;

    const cn = new CircuitNode();
    cn.index = 0;
    this.nodeList.push(cn);
    this.ground = cn;

    for (const ce of this.elmList) {
      if (ce.isGround()) {
        gotGround = true;
        const e = this.nodeMap.get(pointKey(ce.getPost(0)));
        if (e) e.node = this.ground;
        break;
      }
      if (ce.isRail()) gotRail = true;
      if (volt === null && ce.isVoltageElm()) volt = ce;
      if (battery === null && ce.isBattery()) battery = ce;
    }

    // with no ground and no rails, the first voltage source's first terminal is ground; with no
    // plain voltage source, a battery's negative terminal (but not for subcircuits)
    const src = volt ?? battery;
    if (!subcircuit && !gotGround && !gotRail && src) {
      const key = pointKey(src.getPost(0));
      const cln = this.nodeMap.get(key);
      if (cln) cln.node = this.ground;
      else this.nodeMap.set(key, new NodeMapEntry(this.ground));
    }
  }

  /** Allocate nodes for every post and internal node. */
  private makeNodeList(): void {
    // preStamp first so composites can build internal node lists from final child state
    for (const ce of this.elmList) ce.preStamp();

    for (const ce of this.elmList) {
      const inodes = ce.getInternalNodeCount();
      const posts = ce.getPostCount();

      for (let j = 0; j < posts; j++) {
        const key = pointKey(ce.getPost(j));
        const cln = this.nodeMap.get(key);

        // Allocate lazily: allocation order affects behavior (and backward compatibility),
        // since unconnected nodes may get tied to ground differently.
        if (!cln || !cln.node) {
          const cn = new CircuitNode();
          cn.index = this.nodeList.length;
          cn.links.push({ num: j, elm: ce });
          ce.setNode(j, cn);
          if (cln) cln.node = cn;
          else this.nodeMap.set(key, new NodeMapEntry(cn));
          this.nodeList.push(cn);
        } else {
          const cn = cln.node;
          cn.links.push({ num: j, elm: ce });
          ce.setNode(j, cn);
          // the ground node's voltage may never get set otherwise
          if (cn === this.ground) ce.setNodeVoltage(j, 0);
        }
      }
      for (let j = 0; j < inodes; j++) {
        const cn = new CircuitNode();
        cn.index = this.nodeList.length;
        cn.internal = true;
        cn.links.push({ num: j + posts, elm: ce });
        ce.setNode(j + posts, cn);
        this.nodeList.push(cn);
      }
    }
  }

  /**
   * Find nodes not connected (even indirectly) to ground; they get tied to ground with a huge
   * resistor, otherwise the matrix would be singular.
   */
  private findUnconnectedNodes(): void {
    const totalNodes = this.nodeList.length;
    const closure = new Array<boolean>(totalNodes).fill(false);
    this.unconnectedNodes = [];
    this.nodesWithGroundConnection = [];
    closure[0] = true;

    // seed closure with implicit ground connections
    for (const ce of this.elmList) {
      let hasGround = false;
      for (let j = 0; j < ce.getPostCount(); j++) {
        if (ce.hasGroundConnection(j)) {
          hasGround = true;
          closure[ce.getNode(j)!.index] = true;
        }
      }
      if (hasGround) this.nodesWithGroundConnection.push(ce);
    }

    // BFS over node links. When the queue drains, seed the next unconnected node so its whole
    // component is absorbed before flagging another one.
    const queue: number[] = [];
    for (let i = 0; i < totalNodes; i++) if (closure[i]) queue.push(i);
    let qHead = 0;
    let scanFrom = 1;
    for (;;) {
      if (qHead < queue.length) {
        const n = queue[qHead++];
        for (const cnl of this.nodeList[n].links) {
          const ce = cnl.elm;
          const post1 = cnl.num;
          for (let k = 0; k < ce.getPostCount(); k++) {
            if (k === post1) continue;
            const kn = ce.getNode(k)!.index;
            if (!closure[kn] && ce.getConnection(post1, k)) {
              closure[kn] = true;
              queue.push(kn);
            }
          }
        }
      } else {
        let found = false;
        for (; scanFrom < totalNodes; scanFrom++) {
          if (!closure[scanFrom] && !this.nodeList[scanFrom].internal) {
            this.unconnectedNodes.push(scanFrom);
            closure[scanFrom] = true;
            queue.push(scanFrom++);
            found = true;
            break;
          }
        }
        if (!found) break;
      }
    }
    if (this.unconnectedNodes.length > 0) this.log?.(`unconnected nodes: ${this.unconnectedNodes.join(" ")}`);
  }

  /** Split the nodes into independent groups ("closures"), each solved as its own matrix. */
  private calculateClosures(): void {
    const totalNodes = this.nodeList.length;
    const closureIndex = new Array<number>(totalNodes).fill(-1);
    if (totalNodes > 0) closureIndex[0] = 0;

    let closureCount = 0;
    for (let i = 1; i < totalNodes; i++) {
      if (closureIndex[i] >= 0) continue;
      // flood-fill from node i
      const stack = [i];
      closureIndex[i] = closureCount;
      while (stack.length > 0) {
        const n = stack.pop()!;
        for (const cnl of this.nodeList[n].links) {
          const ce = cnl.elm;
          const post1 = cnl.num;
          for (let k = 0; k < ce.getNodeCount(); k++) {
            if (k === post1) continue;
            if (!ce.getMatrixConnection(post1, k)) continue;
            const kn = ce.getNode(k)!.index;
            if (kn === 0) continue; // don't flood through ground
            if (closureIndex[kn] < 0) {
              closureIndex[kn] = closureCount;
              stack.push(kn);
            }
          }
        }
      }
      closureCount++;
    }

    if (closureCount === 0) closureCount = 1;
    this.matrices = Array.from({ length: closureCount }, () => new CircuitMatrix());

    // count nodes per closure and assign 1-based row numbers
    for (let i = 1; i < totalNodes; i++) {
      const ci = closureIndex[i];
      if (ci < 0) continue;
      const cn = this.nodeList[i];
      const m = this.matrices[ci];
      m.nodeCount++;
      cn.row = m.nodeCount;
      cn.matrixIndex = ci;
      m.nodeList.push(cn);
    }
    this.ground.row = 0;
    this.ground.matrixIndex = -1;
  }

  /** Tie unconnected nodes to ground with a big resistor (it must be big, or the 555 breaks). */
  private connectUnconnectedNodes(): void {
    for (const n of this.unconnectedNodes) this.stampResistor(this.ground, this.nodeList[n], 1e8);
  }

  private validateCircuit(): boolean {
    for (const ce of this.elmList) if (!ce.validate()) return false;
    return true;
  }

  /**
   * Node allocation, voltage source assignment and validation. Returns false on error (which can
   * just mean an element adjusted itself and wants another pass).
   */
  private preStampCircuit(subcircuit: boolean): boolean {
    this.nodeList = [];
    this.elmList = this.circuitElements;
    this.calculateWireClosure();
    this.setGroundNode(subcircuit);
    this.makeNodeList();

    if (!this.calcWireInfo()) return false;
    this.nodeMap = new Map();

    // add composite children to the simulation list
    const flat: CircuitElm[] = [];
    for (const elm of this.circuitElements) {
      flat.push(elm);
      const children = elm.getChildElmList();
      if (children) this.addChildElms(children, flat);
    }
    this.elmList = flat;

    this.beforeVoltageSources();
    let vscount = 0;
    this.circuitNonLinear = false;
    this.voltageSources = [];

    // determine if circuit is nonlinear; also create voltage sources
    for (const ce of this.elmList) {
      if (ce.nonLinear()) this.circuitNonLinear = true;
      for (let j = 0; j < ce.getVoltageSourceCount(); j++) {
        const vs = new VoltageSource(ce);
        vs.index = vscount++;
        this.voltageSources.push(vs);
        ce.setVoltageSource(j, vs);
      }
    }
    this.voltageSourceCount = vscount;

    // show resistance in voltage sources if there's only one
    let gotVoltageSource = false;
    this.showResistanceInVoltageSources = true;
    for (const ce of this.elmList) {
      if (!ce.isVoltageElm()) continue;
      if (gotVoltageSource) this.showResistanceInVoltageSources = false;
      else gotVoltageSource = true;
    }

    this.findUnconnectedNodes();
    this.calculateClosures();

    if (!this.validateCircuit()) return false;

    // assign voltage sources to matrices, rows after the node rows
    const vsPerMatrix = new Array<number>(this.matrices.length).fill(0);
    for (const vs of this.voltageSources) vs.assignMatrix(this.ground);
    for (const vs of this.voltageSources) {
      const mi = vs.matrixIndex;
      if (mi < 0) {
        this.stop("voltage source with no matrix", vs.elm);
        return false;
      }
      const m = this.matrices[mi];
      vsPerMatrix[mi]++;
      vs.row = m.nodeCount + vsPerMatrix[mi];
      m.voltageSourceList.push(vs);
    }
    this.matrices.forEach((m, i) => (m.size = m.nodeCount + vsPerMatrix[i]));

    this.nodesWithGroundConnection = [];
    this.timeStep = this.maxTimeStep;
    this.needsStamp = true;
    return true;
  }

  /** Recursively add composite children and link their nodes. */
  private addChildElms(list: CircuitElm[], flat: CircuitElm[]): void {
    for (const ce of list) {
      const children = ce.getChildElmList();
      if (children) {
        this.addChildElms(children, flat);
        continue;
      }
      ce.sim = this;
      flat.push(ce);
      for (let i = 0; i < ce.getNodeCount(); i++) {
        const cn = ce.getNode(i)!;
        cn.links.push({ num: i, elm: ce });
        // NodeForge engine: a child's own inner nodes (a SPICE diode's behind RS) stay internal, as
        // a circuit's parts' are, so they aren't taken for unconnected nodes and tied to ground
        cn.internal = this.accurate && i >= ce.getPostCount() ? cn.internal : false;
        if (cn.index === 0) ce.setNodeVoltage(i, 0);
      }
    }
  }

  /** Allocate nodes and stamp the circuit's matrices (done before the first timestep). */
  preStampAndStampCircuit(): void {
    // preStampCircuit can fail just because an element adjusted itself (e.g. capacitor loops);
    // try again, up to 10 times
    let i = 0;
    for (; i !== 10; i++) if (this.preStampCircuit(false) || this.stopMessage !== null) break;
    if (this.stopMessage !== null) return;
    if (i === 10) {
      this.stop("failed to stamp circuit", null);
      return;
    }
    this.stampCircuit();
  }

  /** Populate the matrices. Called after the circuit changes and when the timestep changes. */
  stampCircuit(): void {
    for (const m of this.matrices) {
      const sz = m.size;
      if (m.matrix.length !== sz * sz) {
        m.matrix = new Float64Array(sz * sz);
        m.rightSide = new Float64Array(sz);
        m.origMatrix = new Float64Array(sz * sz);
        m.origRightSide = new Float64Array(sz);
        m.permute = new Int32Array(sz);
      } else {
        // restamped (e.g. a new time step): same size, start from zero
        if (m.solver?.covers) m.solver.clearPattern(m.matrix);
        else m.matrix.fill(0);
        m.rightSide.fill(0);
      }
      if (m.nodeVoltages.length !== m.nodeCount) m.nodeVoltages = new Float64Array(m.nodeCount);
      if (m.lastNodeVoltages.length !== m.nodeCount) m.lastNodeVoltages = new Float64Array(m.nodeCount);
      m.nonLinear = this.circuitNonLinear;
      m.solver = this.matrixSolver(m);
    }

    this.connectUnconnectedNodes();

    for (const ce of this.elmList) {
      ce.setParentList(this.elmList);
      ce.stamp();
    }
    if (this.stopMessage !== null) return;

    // save the linear part for restoring during nonlinear iterations
    for (const m of this.matrices) {
      m.origRightSide.set(m.rightSide);
      if (m.solver?.covers) m.solver.copyPattern(m.matrix, m.origMatrix);
      else m.origMatrix.set(m.matrix);
    }

    // linear matrices only need factoring once
    for (const m of this.matrices) {
      if (!m.nonLinear && !this.factorMatrix(m)) {
        this.stop("Singular matrix!", null);
        return;
      }
    }

    this.elmArr = this.elmList;
    this.needsStamp = false;
  }

  /** A matrix's own factorization (the NodeForge engine's sparse LU), or null: dense LU in place, as upstream. */
  protected matrixSolver(_m: CircuitMatrix): MatrixSolver | null {
    return null;
  }

  /** LU-factor a stamped matrix: with its own solver if it has one, else densely in place (as upstream). */
  private factorMatrix(m: CircuitMatrix): boolean {
    return m.solver ? m.solver.factor(m.matrix, m.size) : luFactorDense(m.matrix, m.size, m.permute);
  }

  /** Control voltage source `vs` with the voltage from n1 to n2 (also call stampVoltageSource). */
  stampVCVS(n1: CircuitNode, n2: CircuitNode, coef: number, vs: VoltageSource): void {
    this.stampMatrixVN(vs, n1, coef);
    this.stampMatrixVN(vs, n2, -coef);
  }

  /** Voltage source from n1 to n2; if `v` is given it's a fixed source, otherwise doStep updates it. */
  stampVoltageSource(n1: CircuitNode, n2: CircuitNode, vs: VoltageSource, v?: number): void {
    this.stampMatrixVN(vs, n1, -1);
    this.stampMatrixVN(vs, n2, 1);
    if (v !== undefined) this.stampRightSideV(vs, v);
    this.stampMatrixNV(n1, vs, 1);
    this.stampMatrixNV(n2, vs, -1);
  }

  updateVoltageSource(_n1: CircuitNode, _n2: CircuitNode, vs: VoltageSource, v: number): void {
    this.stampRightSideV(vs, v);
  }

  stampResistor(n1: CircuitNode, n2: CircuitNode, r: number): void {
    const r0 = 1 / r;
    if (Number.isNaN(r0) || !Number.isFinite(r0)) this.log?.(`bad resistance ${r} ${r0}`);
    this.stampMatrix(n1, n1, r0);
    this.stampMatrix(n2, n2, r0);
    this.stampMatrix(n1, n2, -r0);
    this.stampMatrix(n2, n1, -r0);
  }

  stampConductance(n1: CircuitNode, n2: CircuitNode, r0: number): void {
    this.stampMatrix(n1, n1, r0);
    this.stampMatrix(n2, n2, r0);
    this.stampMatrix(n1, n2, -r0);
    this.stampMatrix(n2, n1, -r0);
  }

  /** Current from cn1 to cn2 equal to the voltage from vn1 to vn2 times g. */
  stampVCCurrentSource(cn1: CircuitNode, cn2: CircuitNode, vn1: CircuitNode, vn2: CircuitNode, g: number): void {
    this.stampMatrix(cn1, vn1, g);
    this.stampMatrix(cn2, vn2, g);
    this.stampMatrix(cn1, vn2, -g);
    this.stampMatrix(cn2, vn1, -g);
  }

  stampCurrentSource(n1: CircuitNode, n2: CircuitNode, i: number): void {
    this.stampRightSide(n1, -i);
    this.stampRightSide(n2, i);
  }

  /** Current source from n1 to n2 proportional to the current through `vs`. */
  stampCCCS(n1: CircuitNode, n2: CircuitNode, vs: VoltageSource, gain: number): void {
    this.stampMatrixNV(n1, vs, gain);
    this.stampMatrixNV(n2, vs, -gain);
  }

  /** Add x at (row i, column j): a voltage change dv at node j increases the current into node i by x·dv. */
  stampMatrix(i: CircuitNode, j: CircuitNode, x: number): void {
    if (i.row > 0 && j.row > 0) {
      const m = this.matrices[i !== this.ground ? i.matrixIndex : j.matrixIndex];
      const k = (i.row - 1) * m.size + (j.row - 1);
      m.matrix[k] += x;
      if (m.solver !== null && m.solver.slotOf[k] < 0) m.solver.added.push(k);
    }
  }

  stampMatrixVN(i: VoltageSource, j: CircuitNode, x: number): void {
    if (j.row > 0) {
      const m = this.matrices[i.matrixIndex];
      const k = (i.row - 1) * m.size + (j.row - 1);
      m.matrix[k] += x;
      if (m.solver !== null && m.solver.slotOf[k] < 0) m.solver.added.push(k);
    }
  }

  stampMatrixNV(i: CircuitNode, j: VoltageSource, x: number): void {
    if (i.row > 0) {
      const m = this.matrices[j.matrixIndex];
      const k = (i.row - 1) * m.size + (j.row - 1);
      m.matrix[k] += x;
      if (m.solver !== null && m.solver.slotOf[k] < 0) m.solver.added.push(k);
    }
  }

  stampMatrixVV(i: VoltageSource, j: VoltageSource, x: number): void {
    const m = this.matrices[i.matrixIndex];
    const k = (i.row - 1) * m.size + (j.row - 1);
    m.matrix[k] += x;
    if (m.solver !== null && m.solver.slotOf[k] < 0) m.solver.added.push(k);
  }

  /** Independent current flowing into node n. */
  stampRightSide(n: CircuitNode, x: number): void {
    if (n.row > 0) this.matrices[n.matrixIndex].rightSide[n.row - 1] += x;
  }

  stampRightSideV(vs: VoltageSource, x: number): void {
    this.matrices[vs.matrixIndex].rightSide[vs.row - 1] += x;
  }

  /** Markers that a row changes in doStep() (no-ops, kept for parity with upstream). */
  markRightSide(_n: CircuitNode): void {}
  markNonLinear(_n: CircuitNode): void {}

  private runCircuit(_didAnalyze: boolean, shouldStop: (completed: number) => boolean): void {
    if (this.stopMessage !== null || this.elmList.length === 0) return;

    const timeStepCountAtFrameStart = this.timeStepCount;
    // iterations completed without convergence trouble
    let goodIterations = 100;

    for (;;) {
      if (goodIterations >= 3 && this.timeStep < this.maxTimeStep) {
        // things are going well, double the time step
        this.timeStep = Math.min(this.timeStep * 2, this.maxTimeStep);
        this.stampCircuit();
        goodIterations = 0;
        if (this.stopMessage !== null) return;
      }
      if (this.clampTimeStep) this.timeStep = this.clampTimeStep(this.t, this.timeStep);

      for (const ce of this.elmArr) ce.startIteration();
      const subiterCount = this.adjustTimeStep && this.timeStep / 2 > this.minTimeStep ? 100 : 5000;
      const subiter = this.iterate(subiterCount);
      if (subiter < 0) return;

      if (subiter === subiterCount) {
        // convergence failed
        goodIterations = 0;
        if (this.adjustTimeStep) {
          this.timeStep /= 2;
          this.log?.(`timestep down to ${this.timeStep} at ${this.t}`);
        }
        if (this.timeStep < this.minTimeStep || !this.adjustTimeStep) {
          this.stop("Convergence failed!", null);
          break;
        }
        // restore the state from the start of this iteration and retry
        for (const m of this.matrices) this.setNodeVoltages(m, m.lastNodeVoltages);
        this.stampCircuit();
        continue;
      }
      if (subiter < 3) goodIterations++;
      else goodIterations = 0;
      this.t += this.timeStep;
      this.timeStepAccum += this.timeStep;
      if (this.timeStepAccum >= this.maxTimeStep) {
        this.timeStepAccum -= this.maxTimeStep;
        this.timeStepCount++;
      }
      for (const ce of this.elmArr) ce.stepFinished();
      if (!this.delayWireProcessing) this.calcWireCurrents();
      this.onTimeStep?.();
      if (this.checkTime?.()) break;

      // save node voltages so a failed next iteration can restart from here
      for (const m of this.matrices) m.lastNodeVoltages.set(m.nodeVoltages);

      if (shouldStop(this.timeStepCount - timeStepCountAtFrameStart)) break;
      if (!this.simRunning) break;
    }
    if (this.delayWireProcessing) this.calcWireCurrents();
  }

  /**
   * Solve the current timestep: stamp, solve, and repeat (Newton iterations) until nonlinear
   * elements converge. Returns the iterations used (subiterCount: no convergence), or -1 if the
   * simulation stopped.
   */
  protected iterate(subiterCount: number): number {
    // keep iterating while the elements haven't converged, or (NodeForge engine) node voltages still move
    let moving = false;
    let subiter = 0;
    for (; subiter !== subiterCount; subiter++) {
      this.converged = true;
      this.subIterations = subiter;
      for (const m of this.matrices) {
        m.rightSide.set(m.origRightSide);
        if (m.nonLinear) {
          // sparse: only the pattern's entries can be nonzero, so only they need resetting
          if (m.solver?.covers) m.solver.copyPattern(m.origMatrix, m.matrix);
          else m.matrix.set(m.origMatrix);
        }
      }
      for (const ce of this.elmArr) ce.doStep();
      if (this.stopMessage !== null) return -1;
      this.stampExtra();

      let movedNow = false;
      for (const m of this.matrices) {
        if (m.size < 8) {
          for (let k = 0; k < m.matrix.length; k++) {
            if (!Number.isFinite(m.matrix[k])) {
              this.stop("nan/infinite matrix!", null);
              return -1;
            }
          }
        }
        if (m.nonLinear) {
          if (this.converged && subiter > 0 && !moving) continue;
          if (!this.factorMatrix(m)) {
            this.stop("Singular matrix!", null);
            return -1;
          }
        }
        if (m.nonLinear) this.beforeSolve(m);
        if (m.solver) m.solver.solve(m.rightSide);
        else luSolveDense(m.matrix, m.size, m.permute, m.rightSide);
        this.applySolvedRightSide(m);
        if (m.nonLinear && !movedNow) movedNow = this.movedInSolve(m);
      }
      moving = this.stillMoving(subiter, movedNow);
      if (!this.circuitNonLinear) break;
      if (this.converged && subiter > 0 && !moving) break;
    }
    return subiter;
  }

  // Hooks for the NodeForge engine (CircuitJS does none of this)

  /** Before a nonlinear matrix is solved. */
  protected beforeSolve(_m: CircuitMatrix): void {}
  /** After it's solved: did its node voltages move more than a Newton tolerance? */
  protected movedInSolve(_m: CircuitMatrix): boolean {
    return false;
  }
  /** Is the iteration still moving (beyond the elements' own convergence test)? */
  protected stillMoving(_subiter: number, _movedNow: boolean): boolean {
    return false;
  }
  /** Stamp anything else after the elements (e.g. the operating point's gmin). */
  protected stampExtra(): void {}
  /** Before voltage sources are counted, when the circuit is analyzed. */
  protected beforeVoltageSources(): void {}

  // State the NodeForge engine sets and some parts read (always off in CircuitJS mode)

  /** DC operating point: inductors are shorts (capacitors are open already). */
  dcShortInductors = false;
  /** DC operating point: independent sources' scale (source stepping ramps it from 0 to 1). */
  sourceScale = 1;
  /** DC operating point: is this inductor an exact short (a 0 V source), rather than a tiny resistance? */
  isExactDcShort(_ce: CircuitElm): boolean {
    return false;
  }

  /** Distribute one solved matrix's results to node voltages and voltage-source currents. */
  private applySolvedRightSide(m: CircuitMatrix): void {
    for (let j = 0; j < m.size; j++) {
      const res = m.rightSide[j];
      if (Number.isNaN(res)) {
        this.converged = false;
        break;
      }
      if (j < m.nodeCount) m.nodeVoltages[j] = res;
    }
    for (const vs of m.voltageSourceList) {
      const res = m.rightSide[vs.row - 1];
      if (!Number.isNaN(res)) vs.elm.setCurrent(vs, res);
    }
    this.setNodeVoltages(m, m.nodeVoltages);
  }

  /** NodeForge engine: also sets the predictor's starting point (protected for it). */
  protected setNodeVoltages(m: CircuitMatrix, nv: Float64Array): void {
    for (const cn of m.nodeList) {
      const res = nv[cn.row - 1];
      for (const cnl of cn.links) cnl.elm.setNodeVoltage(cnl.num, res);
    }
  }

  /** Wires were removed from the matrix, so reconstruct their currents from their neighbors. */
  protected calcWireCurrents(): void {
    for (const ws of this.wireInfoList) {
      let cur = 0;
      if (ws.post === 0) {
        const p = ws.wire.getPost(ws.bit);
        for (const ce of ws.neighbors) cur += ce.getCurrentIntoNode(ce.getNodeAtPoint(p));
      } else if (ws.endpoint1 && ws.endpoint1.startsWith("label:")) {
        for (const other of ws.labelNeighbors) cur += other.current;
      } else {
        const p = ws.wire.getConnectedPost(ws.bit);
        if (p) for (const ce of ws.neighbors) cur += ce.getCurrentIntoNode(ce.getNodeAtPoint(p));
      }
      if (ws.post !== 0) cur = -cur;
      ws.wire.setWireCurrent(ws.bit, cur);
      ws.current = cur;
    }
  }

  /**
   * Posts to draw: those not shared by exactly two elements. Also finds suspicious posts that
   * overlap another element without connecting to it.
   */
  private makePostDrawList(): void {
    const counts = new Map<string, { p: GridPoint; n: number }>();
    for (const ce of this.circuitElements) {
      for (let j = 0; j < ce.getPostCount(); j++) {
        const p = ce.getPost(j);
        const k = pointKey(p);
        const e = counts.get(k);
        if (e) e.n++;
        else counts.set(k, { p, n: 1 });
      }
    }
    this.postDrawList = [];
    this.badConnectionList = [];
    for (const { p, n } of counts.values()) {
      if (n !== 2) this.postDrawList.push(p);
      if (n !== 1) continue;
      for (const ce of this.circuitElements) {
        if (!rectContains(ce.boundingBox, p.x, p.y)) continue;
        let owns = false;
        for (let k = 0; k < ce.getPostCount(); k++) {
          if (samePoint(ce.getPost(k), p)) {
            owns = true;
            break;
          }
        }
        if (!owns) {
          this.badConnectionList.push(p);
          break;
        }
      }
    }
  }
}

