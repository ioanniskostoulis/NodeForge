// Ported from CircuitJS1 (SimulationManager.lu_factor_dense / lu_solve_dense) by Paul Falstad and Iain Sharp.
// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

/**
 * Dense LU factorization (Crout's method with partial pivoting) of a row-major n × n matrix,
 * in place. Returns false if the matrix is singular. The operation order matches upstream
 * exactly so results are bit-comparable.
 */
export function luFactorDense(a: Float64Array, n: number, ipvt: Int32Array): boolean {
  // check for a possible singular matrix by scanning for rows that are all zeroes
  for (let i = 0; i < n; i++) {
    let rowAllZeros = true;
    for (let j = 0; j < n; j++) {
      if (a[i * n + j] !== 0) {
        rowAllZeros = false;
        break;
      }
    }
    if (rowAllZeros) return false;
  }

  // use Crout's method; loop through the columns
  for (let j = 0; j < n; j++) {
    // calculate upper triangular elements for this column
    for (let i = 0; i < j; i++) {
      let q = a[i * n + j];
      for (let k = 0; k < i; k++) q -= a[i * n + k] * a[k * n + j];
      a[i * n + j] = q;
    }

    // calculate lower triangular elements for this column
    let largest = 0;
    let largestRow = -1;
    for (let i = j; i < n; i++) {
      let q = a[i * n + j];
      for (let k = 0; k < j; k++) q -= a[i * n + k] * a[k * n + j];
      a[i * n + j] = q;
      const x = Math.abs(q);
      if (x >= largest) {
        largest = x;
        largestRow = i;
      }
    }

    // pivoting
    if (j !== largestRow) {
      if (largestRow === -1) return false;
      for (let k = 0; k < n; k++) {
        const x = a[largestRow * n + k];
        a[largestRow * n + k] = a[j * n + k];
        a[j * n + k] = x;
      }
    }

    // keep track of row interchanges
    ipvt[j] = largestRow;

    // a zero pivot means a singular matrix (e.g. two inverter outputs tied together)
    if (a[j * n + j] === 0) return false;

    if (j !== n - 1) {
      const mult = 1 / a[j * n + j];
      for (let i = j + 1; i < n; i++) a[i * n + j] *= mult;
    }
  }
  return true;
}

/** Solve using a factorization from luFactorDense. `b` holds the right-hand side, then the solution. */
export function luSolveDense(a: Float64Array, n: number, ipvt: Int32Array, b: Float64Array): void {
  // find first nonzero b element
  let i = 0;
  for (; i !== n; i++) {
    const row = ipvt[i];
    const swap = b[row];
    b[row] = b[i];
    b[i] = swap;
    if (swap !== 0) break;
  }

  const bi = i++;
  for (; i < n; i++) {
    const row = ipvt[i];
    let tot = b[row];
    b[row] = b[i];
    // forward substitution using the lower triangular matrix
    for (let j = bi; j < i; j++) tot -= a[i * n + j] * b[j];
    b[i] = tot;
  }
  for (i = n - 1; i >= 0; i--) {
    let tot = b[i];
    // back-substitution using the upper triangular matrix
    for (let j = i + 1; j !== n; j++) tot -= a[i * n + j] * b[j];
    b[i] = tot / a[i * n + i];
  }
}

/** SimulationManager.invertMatrix: invert an n×n matrix in place (via LU). */
export function invertMatrix(a: number[][], n: number): void {
  const flat = new Float64Array(n * n);
  for (let i = 0; i !== n; i++) for (let j = 0; j !== n; j++) flat[i * n + j] = a[i][j];
  const ipvt = new Int32Array(n);
  luFactorDense(flat, n, ipvt);
  const b = new Float64Array(n);
  const inva = a.map(() => new Array<number>(n).fill(0));
  // solve for each column of the identity matrix
  for (let i = 0; i !== n; i++) {
    b.fill(0);
    b[i] = 1;
    luSolveDense(flat, n, ipvt, b);
    for (let j = 0; j !== n; j++) inva[j][i] = b[j];
  }
  for (let i = 0; i !== n; i++) for (let j = 0; j !== n; j++) a[i][j] = inva[i][j];
}
