// Sparse LU factorization for the NodeForge solver: circuit matrices are mostly zeros (a node
// connects to a few others), so eliminating only where there are entries costs a fraction of
// dense LU. The pivot order (Markowitz, with threshold pivoting) and the fill pattern are worked
// out once; every later factorization of a matrix with the same pattern replays a compiled list
// of operations, and one whose values haven't changed isn't factored at all.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { MatrixSolver } from "../circuitjs/core/nodes";

/** A pivot may be this much smaller than the largest entry of its column (SPICE's relative threshold). */
const PIVOT_THRESHOLD = 1e-3;

export class SparseLU implements MatrixSolver {
  /** Factorizations: pivot orders worked out, numeric replays, and skipped (matrix unchanged). */
  readonly counts = { analyzed: 0, refactored: 0, reused: 0 };

  private n = 0;
  private valid = false;
  /**
   * How much smaller than its column's largest entry a pivot may be. Starts at PIVOT_THRESHOLD
   * (favouring sparsity); a badly scaled matrix where that loses a pivot to cancellation switches
   * to 1 (always the largest, as dense partial pivoting does).
   */
  private threshold = PIVOT_THRESHOLD;
  /**
   * Dense index (row · n + column) → slot of a structural nonzero (fill included), or -1. Stamping
   * checks it, so the whole matrix needn't be scanned for new entries.
   */
  slotOf = new Int32Array(0);
  /** Entries stamped outside the pattern since the last factorization (the stamping code adds them). */
  added: number[] = [];
  /** Slot → dense index. */
  private src = new Int32Array(0);
  /** The matrix's values at the slots, last time (to tell if it changed). */
  private input = new Float64Array(0);
  /** The factors, by slot. */
  private vals = new Float64Array(0);
  /** Step k pivots on row prow[k], column pcol[k] (original indices); its slot. */
  private prow = new Int32Array(0);
  private pcol = new Int32Array(0);
  private pivot = new Int32Array(0);
  /** Step k's column of L: lSlot/lRow[lStart[k] .. lStart[k+1]). */
  private lStart = new Int32Array(0);
  private lSlot = new Int32Array(0);
  private lRow = new Int32Array(0);
  /** Step k's row of U: uSlot/uCol[uStart[k] .. uStart[k+1]). */
  private uStart = new Int32Array(0);
  private uSlot = new Int32Array(0);
  private uCol = new Int32Array(0);
  /** Step k's updates, L entry by U entry: the slots they subtract from (from tStart[k]). */
  private tStart = new Int32Array(0);
  private target = new Int32Array(0);
  private y = new Float64Array(0);
  private x = new Float64Array(0);

  /** Structural nonzeros of the factors (fill included). */
  get nonzeros(): number {
    return this.src.length;
  }

  /** Forget the pivot order (the next factorization works it out again). */
  invalidate(): void {
    this.valid = false;
  }

  /**
   * Does the pattern hold every entry the matrix can have (so only its slots need copying or
   * clearing)? Not before the first factorization, or after a stamp outside it.
   */
  get covers(): boolean {
    return this.valid && this.added.length === 0;
  }

  /** Copy the pattern's entries from one dense matrix to another (when `covers`). */
  copyPattern(from: Float64Array, to: Float64Array): void {
    const src = this.src;
    for (let s = 0; s < src.length; s++) to[src[s]] = from[src[s]];
  }

  /** Zero the pattern's entries of a dense matrix (when `covers`, that's all of them). */
  clearPattern(a: Float64Array): void {
    const src = this.src;
    for (let s = 0; s < src.length; s++) a[src[s]] = 0;
  }

  /**
   * Factor a row-major n × n matrix (left unchanged). Returns false if it's singular. Entries
   * outside the pattern must have been reported in `added` (the simulator's stamping does).
   */
  factor(a: Float64Array, n: number): boolean {
    if (!this.valid || this.added.length || n !== this.n) return this.analyze(a, n);
    // gather, and see whether anything changed
    const src = this.src, input = this.input;
    let changed = false;
    for (let s = 0; s < src.length; s++) {
      const v = a[src[s]];
      if (v !== input[s]) {
        input[s] = v;
        changed = true;
      }
    }
    if (!changed) {
      this.counts.reused++;
      return true;
    }
    if (this.numeric()) {
      this.counts.refactored++;
      return true;
    }
    // a pivot got too small for these values: choose the pivots again
    return this.analyze(a, n);
  }

  /** Replay the factorization on new values with the saved pivot order; false if a pivot is too small. */
  private numeric(): boolean {
    const vals = this.vals, lStart = this.lStart, lSlot = this.lSlot, uStart = this.uStart, uSlot = this.uSlot;
    const tStart = this.tStart, target = this.target, pivot = this.pivot;
    vals.set(this.input);
    for (let k = 0; k < this.n; k++) {
      const p = vals[pivot[k]];
      const l0 = lStart[k], l1 = lStart[k + 1];
      let big = 0;
      for (let a = l0; a < l1; a++) big = Math.max(big, Math.abs(vals[lSlot[a]]));
      if (!(Math.abs(p) > this.threshold * big * 0.999) || !Number.isFinite(p)) return false;
      const inv = 1 / p;
      for (let a = l0; a < l1; a++) vals[lSlot[a]] *= inv;
      const u0 = uStart[k], u1 = uStart[k + 1];
      let t = tStart[k];
      for (let a = l0; a < l1; a++) {
        const l = vals[lSlot[a]];
        if (l === 0) {
          t += u1 - u0;
          continue;
        }
        for (let b = u0; b < u1; b++) vals[target[t++]] -= l * vals[uSlot[b]];
      }
    }
    return true;
  }

  /**
   * Choose the pivots (Markowitz: the entry whose row and column have the fewest other entries,
   * among those at least PIVOT_THRESHOLD of their column's largest) and factor, recording the
   * pattern and the operations so later factorizations can replay them.
   */
  private analyze(a: Float64Array, n: number): boolean {
    let ok = this.choose(a, n);
    if (!ok && this.threshold < 1) {
      // no pivot left in some column: entries cancelled out exactly. Choose by magnitude instead
      this.threshold = 1;
      ok = this.choose(a, n);
    }
    this.added.length = 0;
    return ok;
  }

  private choose(a: Float64Array, n: number): boolean {
    this.valid = false;
    this.n = n;
    this.counts.analyzed++;
    const w = Float64Array.from(a);
    const nz = new Uint8Array(n * n);
    const slotOf = (this.slotOf = this.slotOf.length === n * n ? this.slotOf : new Int32Array(n * n));
    slotOf.fill(-1);
    const src: number[] = [];
    const rowCols: number[][] = [], colRows: number[][] = [];
    const rowCount = new Int32Array(n), colCount = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      rowCols.push([]);
      colRows.push([]);
    }
    // the entries: the nonzeros, and anything stamped (an entry that's zero now may not be later)
    for (const k of this.added) nz[k] = 1;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const k = i * n + j;
        if (w[k] === 0 && !nz[k]) continue;
        nz[k] = 1;
        slotOf[k] = src.length;
        src.push(k);
        rowCols[i].push(j);
        colRows[j].push(i);
        rowCount[i]++;
        colCount[j]++;
      }
    }
    const rowDone = new Uint8Array(n), colDone = new Uint8Array(n);
    const prow = new Int32Array(n), pcol = new Int32Array(n), pivot = new Int32Array(n);
    const lStart = new Int32Array(n + 1), uStart = new Int32Array(n + 1), tStart = new Int32Array(n + 1);
    const lSlot: number[] = [], lRow: number[] = [], uSlot: number[] = [], uCol: number[] = [], target: number[] = [];
    const L: number[] = [], U: number[] = [];

    for (let k = 0; k < n; k++) {
      // the pivot
      let pr = -1, pc = -1, bestCost = Infinity, bestMag = 0;
      for (let j = 0; j < n; j++) {
        if (colDone[j]) continue;
        const rows = colRows[j];
        let big = 0;
        for (const i of rows) if (!rowDone[i]) big = Math.max(big, Math.abs(w[i * n + j]));
        if (big === 0 || !Number.isFinite(big)) continue;
        const cc = colCount[j] - 1;
        for (const i of rows) {
          if (rowDone[i]) continue;
          const v = Math.abs(w[i * n + j]);
          if (v < this.threshold * big) continue;
          const cost = (rowCount[i] - 1) * cc;
          if (cost < bestCost || (cost === bestCost && v > bestMag)) {
            bestCost = cost;
            bestMag = v;
            pr = i;
            pc = j;
          }
        }
        if (bestCost === 0 && bestMag >= big) break;
      }
      if (pr < 0) return false;
      prow[k] = pr;
      pcol[k] = pc;
      pivot[k] = slotOf[pr * n + pc];
      rowDone[pr] = colDone[pc] = 1;

      L.length = U.length = 0;
      for (const i of colRows[pc]) if (!rowDone[i]) L.push(i);
      for (const j of rowCols[pr]) if (!colDone[j]) U.push(j);
      for (const i of L) rowCount[i]--;
      for (const j of U) colCount[j]--;

      const p = w[pr * n + pc];
      lStart[k] = lSlot.length;
      uStart[k] = uSlot.length;
      tStart[k] = target.length;
      for (const i of L) {
        w[i * n + pc] /= p;
        lSlot.push(slotOf[i * n + pc]);
        lRow.push(i);
      }
      for (const j of U) {
        uSlot.push(slotOf[pr * n + j]);
        uCol.push(j);
      }
      for (const i of L) {
        const l = w[i * n + pc];
        for (const j of U) {
          const idx = i * n + j;
          if (!nz[idx]) {
            // fill-in
            nz[idx] = 1;
            slotOf[idx] = src.length;
            src.push(idx);
            rowCols[i].push(j);
            colRows[j].push(i);
            rowCount[i]++;
            colCount[j]++;
          }
          w[idx] -= l * w[pr * n + j];
          target.push(slotOf[idx]);
        }
      }
    }
    lStart[n] = lSlot.length;
    uStart[n] = uSlot.length;
    tStart[n] = target.length;

    this.src = Int32Array.from(src);
    this.input = new Float64Array(src.length);
    this.vals = new Float64Array(src.length);
    for (let s = 0; s < src.length; s++) {
      this.input[s] = a[src[s]];
      this.vals[s] = w[src[s]];
    }
    this.prow = prow;
    this.pcol = pcol;
    this.pivot = pivot;
    this.lStart = lStart;
    this.lSlot = Int32Array.from(lSlot);
    this.lRow = Int32Array.from(lRow);
    this.uStart = uStart;
    this.uSlot = Int32Array.from(uSlot);
    this.uCol = Int32Array.from(uCol);
    this.tStart = tStart;
    this.target = Int32Array.from(target);
    if (this.y.length !== n) {
      this.y = new Float64Array(n);
      this.x = new Float64Array(n);
    }
    this.valid = true;
    return true;
  }

  /** Solve A·x = b with the last factorization; `b` holds the right-hand side, then x. */
  solve(b: Float64Array): void {
    const n = this.n, vals = this.vals, y = this.y, x = this.x;
    const prow = this.prow, pcol = this.pcol, pivot = this.pivot;
    const lStart = this.lStart, lSlot = this.lSlot, lRow = this.lRow;
    const uStart = this.uStart, uSlot = this.uSlot, uCol = this.uCol;
    // forward: L·y = b, in pivot order
    for (let k = 0; k < n; k++) {
      const yk = b[prow[k]];
      y[k] = yk;
      if (yk === 0) continue;
      for (let a = lStart[k], e = lStart[k + 1]; a < e; a++) b[lRow[a]] -= vals[lSlot[a]] * yk;
    }
    // back: U·x = y
    for (let k = n - 1; k >= 0; k--) {
      let s = y[k];
      for (let a = uStart[k], e = uStart[k + 1]; a < e; a++) s -= vals[uSlot[a]] * x[uCol[a]];
      x[pcol[k]] = s / vals[pivot[k]];
    }
    b.set(x);
  }
}
