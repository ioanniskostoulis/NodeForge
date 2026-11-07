// Ported from CircuitJS1 (FindPathInfo.java) by Paul Falstad and Iain Sharp.
// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { CircuitElm } from "./elm";
import type { CircuitNode } from "./nodes";
import type { Simulator } from "./simulator";

export const enum PathKind {
  /** Inductors need a path free of current sources. */
  Induct,
  /** Voltage source loops: only voltage sources, wires and ground count. */
  Voltage,
  /** Shorts: only wires count. */
  Short,
  /** Capacitor / voltage source loops. */
  CapV,
}

/**
 * Searches the analyzed circuit for a loop from one node of an element back to another node of
 * the same element, restricted to certain element kinds.
 */
export class FindPathInfo {
  private readonly visited: boolean[];

  constructor(
    private readonly kind: PathKind,
    private readonly firstElm: CircuitElm,
    private readonly dest: CircuitNode,
    private readonly sim: Simulator,
  ) {
    this.visited = new Array<boolean>(sim.nodeList.length).fill(false);
  }

  /** Depth-first search from n1 for a path back to the destination node. */
  findPath(n1: CircuitNode): boolean {
    if (n1 === this.dest) return true;
    if (this.visited[n1.index]) return false;
    this.visited[n1.index] = true;

    for (const cnl of n1.links) if (this.checkElm(n1, cnl.elm)) return true;
    if (n1 === this.sim.ground) {
      for (const ce of this.sim.nodesWithGroundConnection) if (this.checkElm(this.sim.ground, ce)) return true;
    }
    return false;
  }

  private checkElm(n1: CircuitNode, ce: CircuitElm): boolean {
    if (ce === this.firstElm) return false;
    switch (this.kind) {
      case PathKind.Induct:
        if (ce.isCurrentSource()) return false;
        break;
      case PathKind.Voltage:
        if (!(ce.isWireEquivalent() || ce.isVoltageElm() || ce.isLogicInput() || ce.isGround())) return false;
        break;
      case PathKind.Short:
        if (!ce.isWireEquivalent()) return false;
        break;
      case PathKind.CapV:
        if (!(ce.isWireEquivalent() || ce.isIdealCapacitor() || ce.isVoltageElm() || ce.isLogicInput())) return false;
        break;
    }

    if (n1 === this.sim.ground) {
      // our path can go through ground via posts with a ground connection
      for (let j = 0; j < ce.getPostCount(); j++) {
        if (ce.hasGroundConnection(j) && this.findPath(ce.getNode(j)!)) return true;
      }
    }
    for (let j = 0; j < ce.getPostCount(); j++) {
      if (ce.getNode(j) !== n1) continue;
      if (ce.hasGroundConnection(j) && this.findPath(this.sim.ground)) return true;
      if (this.kind === PathKind.Induct && ce.isInductor()) {
        // inductors can use paths with other inductors of matching current
        let c = ce.getCurrent();
        if (j === 0) c = -c;
        if (Math.abs(c - this.firstElm.getCurrent()) > 1e-10) continue;
      }
      for (let k = 0; k < ce.getPostCount(); k++) {
        if (j === k) continue;
        if (ce.getConnection(j, k) && this.findPath(ce.getNode(k)!)) return true;
      }
    }
    return false;
  }
}

/** CircuitElm.validateRailNode: an output driven from ground must not be shorted to ground. */
export function validateRailNode(e: CircuitElm, n: number): boolean {
  const fpi = new FindPathInfo(PathKind.Voltage, e, e.getNode(n)!, e.sim);
  if (fpi.findPath(e.sim.ground)) {
    e.sim.stop("Path to ground with no resistance!", e);
    return false;
  }
  return true;
}
