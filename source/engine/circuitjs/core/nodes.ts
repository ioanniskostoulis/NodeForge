// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Ported from CircuitJS1 (CircuitNode.java, CircuitNodeLink.java, VoltageSource.java, CircuitMatrix.java)
// by Paul Falstad and Iain Sharp. Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { CircuitElm } from "./elm";

/** A connection from a node back to one terminal of an element. */
export interface CircuitNodeLink {
  /** Which of the element's nodes this link refers to. */
  num: number;
  elm: CircuitElm;
}

/** One electrical node of the analyzed circuit. */
export class CircuitNode {
  links: CircuitNodeLink[] = [];
  internal = false;
  index = 0;
  /** Index into Simulator.matrices, or -1 for ground / not in any matrix. */
  matrixIndex = -1;
  /** 1-based row in its matrix; 0 means ground (excluded from the matrix). */
  row = 0;
}

/** An independent (or controlled) voltage source row in the MNA matrix. */
export class VoltageSource {
  index = 0;
  matrixIndex = -1;
  /** 1-based row in its matrix, placed after the node rows. */
  row = 0;
  n1: CircuitNode | null = null;
  n2: CircuitNode | null = null;

  constructor(public elm: CircuitElm) {}

  /** Save the nodes this source is stamped between; used to decide which matrix it belongs to. */
  setNodes(n1: CircuitNode, n2: CircuitNode): void {
    this.n1 = n1;
    this.n2 = n2;
  }

  /** Assign a matrix from the saved nodes (uses the non-ground node's matrix). */
  assignMatrix(ground: CircuitNode): void {
    if (this.n1 && this.n1 !== ground && this.n1.matrixIndex >= 0) {
      this.matrixIndex = this.n1.matrixIndex;
    } else if (this.n2 && this.n2 !== ground && this.n2.matrixIndex >= 0) {
      this.matrixIndex = this.n2.matrixIndex;
    } else {
      // fallback: use the element's last post
      this.matrixIndex = this.elm.getNode(this.elm.getPostCount() - 1)?.matrixIndex ?? -1;
    }
  }
}

/**
 * A factorization that keeps the matrix as stamped and tracks its pattern (the NodeForge engine's
 * sparse LU). Stamping reports entries outside the pattern in `added`.
 */
export interface MatrixSolver {
  /** Dense index (row · size + column) → slot in the pattern, or -1. */
  readonly slotOf: Int32Array;
  added: number[];
  /** The pattern holds every entry the matrix can have, so only its slots need copying or clearing. */
  readonly covers: boolean;
  copyPattern(from: Float64Array, to: Float64Array): void;
  clearPattern(a: Float64Array): void;
  factor(a: Float64Array, n: number): boolean;
  solve(b: Float64Array): void;
}

/**
 * One independent linear system. Groups of nodes that cannot influence each other through the
 * matrix are solved separately, which keeps each LU factorization small.
 */
export class CircuitMatrix {
  size = 0;
  /** Number of node rows (voltage source rows follow). */
  nodeCount = 0;
  nonLinear = false;

  /** Row-major size × size storage. */
  matrix = new Float64Array(0);
  rightSide = new Float64Array(0);
  origMatrix = new Float64Array(0);
  origRightSide = new Float64Array(0);
  permute = new Int32Array(0);
  nodeVoltages = new Float64Array(0);
  lastNodeVoltages = new Float64Array(0);
  /** Its own factorization (the NodeForge engine's sparse LU); null: dense LU in place, as upstream. */
  solver: MatrixSolver | null = null;

  nodeList: CircuitNode[] = [];
  voltageSourceList: VoltageSource[] = [];
}
