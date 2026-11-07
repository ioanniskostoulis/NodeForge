// The circuit's LC resonances from its part values, for Recommend Settings: the natural
// frequencies of its capacitors and inductors alone (sources shorted, as AC sees them; semiconductors
// left open; resistors once open and once shorted, as a series or a parallel RLC needs), worked out as the eigenvalues ω² of Γ·v = ω²·C·v, with C the nodes'
// capacitance matrix and Γ their inductive one (the 1/L of each inductor between its nodes).
// Nodes with no capacitance are eliminated first (Kron reduction); nodes with none of either drop out.
import { CapacitorElm, type Circuit, type CircuitElm, InductorElm, RailElm, ResistorElm, Simulator, VoltageElm } from "../engine";

/** Largest network handled (nodes carrying L or C); above it, no estimate. */
const MAX_NODES = 160;

/** Eigenvalues and vectors (columns) of a symmetric matrix (cyclic Jacobi). */
function symmetricEigen(m: number[][]): { values: number[]; vectors: number[][] } {
  const n = m.length;
  const a = m.map((r) => r.slice());
  const v = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j): number => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0, total = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) (i === j ? (total += a[i][j] ** 2) : (off += a[i][j] ** 2));
    if (off <= 1e-24 * (total + off)) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: a.map((row, i) => row[i]), vectors: v };
}

/** The LC network's resonant frequencies (Hz), highest first, with its resistors open and shorted (none: an empty list). */
export function resonances(circuit: Circuit): number[] {
  const sim = new Simulator();
  sim.accurate = true;
  sim.maxTimeStep = sim.timeStep = circuit.options.maxTimeStep;
  sim.useCircuitOptions(circuit.options);
  sim.setElements(circuit.simulatedElements);
  // its nodes (wires merged), as the solver sees them; no step is taken
  sim.analyzeCircuit();
  sim.preStampAndStampCircuit();
  const found = [...network(sim.elmList, false), ...network(sim.elmList, true)].sort((a, b) => b - a);
  // the same mode found both ways once
  return found.filter((f, i) => i === 0 || f < found[i - 1] * (1 - 1e-6));
}

/** One network's resonances: resistors open, or shorted. */
function network(elms: readonly CircuitElm[], shortResistors: boolean): number[] {
  // voltage sources short their nodes together (AC): union-find, ground as 0
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const join = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) (ra === 0 ? parent.set(rb, 0) : parent.set(ra, rb));
  };
  const nodeOf = (e: { nodes: ({ index: number } | null | undefined)[] }, i: number) => e.nodes[i]?.index ?? 0;
  for (const e of elms) {
    if (e instanceof RailElm) join(nodeOf(e, 0), 0);
    else if (e instanceof VoltageElm || (shortResistors && e instanceof ResistorElm)) join(nodeOf(e, 0), nodeOf(e, 1));
  }
  // the L and C branches between merged nodes
  const branches: { a: number; b: number; c: number; g: number }[] = [];
  for (const e of elms) {
    if (e instanceof CapacitorElm && e.capacitance > 0) branches.push({ a: find(nodeOf(e, 0)), b: find(nodeOf(e, 1)), c: e.capacitance, g: 0 });
    else if (e instanceof InductorElm && e.inductance > 0) branches.push({ a: find(nodeOf(e, 0)), b: find(nodeOf(e, 1)), c: 0, g: 1 / e.inductance });
  }
  const index = new Map<number, number>();
  for (const br of branches) for (const x of [br.a, br.b]) if (x !== 0 && !index.has(x)) index.set(x, index.size);
  const n = index.size;
  if (!n || n > MAX_NODES || !branches.some((b) => b.c) || !branches.some((b) => b.g)) return [];
  const C = Array.from({ length: n }, () => new Array<number>(n).fill(0)), G = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const stamp = (m: number[][], a: number, b: number, x: number) => {
    const i = index.get(a), j = index.get(b);
    if (i !== undefined) m[i][i] += x;
    if (j !== undefined) m[j][j] += x;
    if (i !== undefined && j !== undefined) {
      m[i][j] -= x;
      m[j][i] -= x;
    }
  };
  for (const br of branches) {
    if (br.a === br.b) continue;
    if (br.c) stamp(C, br.a, br.b, br.c);
    else stamp(G, br.a, br.b, br.g);
  }
  // C's own directions: those with capacitance (P) and those without (Z)
  const ce = symmetricEigen(C);
  const cmax = Math.max(...ce.values.map(Math.abs), 1e-300);
  const P = ce.values.map((x, i) => [x, i] as const).filter(([x]) => x > 1e-9 * cmax).map(([, i]) => i);
  const Z = ce.values.map((x, i) => [x, i] as const).filter(([x]) => !(x > 1e-9 * cmax)).map(([, i]) => i);
  if (!P.length) return [];
  // Γ in that basis: Γ' = Qᵀ Γ Q
  const Q = ce.vectors;
  const GQ = G.map((row) => Q[0].map((_, j) => row.reduce((s, x, k) => s + x * Q[k][j], 0)));
  const Gp = Q[0].map((_, i) => Q[0].map((__, j) => Q.reduce((s, row, k) => s + row[i] * GQ[k][j], 0)));
  // eliminate the directions without capacitance: Γr = Γpp − Γpz Γzz⁺ Γzp (pseudo-inverse: nodes
  // the inductors don't reach stay out)
  let Gr = P.map((i) => P.map((j) => Gp[i][j]));
  if (Z.length) {
    const ze = symmetricEigen(Z.map((i) => Z.map((j) => Gp[i][j])));
    const gmax = Math.max(...ze.values.map(Math.abs), 1e-300);
    const pinv = Z.map((_, i) => Z.map((__, j) => ze.values.reduce((s, x, k) => (Math.abs(x) > 1e-9 * gmax ? s + (ze.vectors[i][k] * ze.vectors[j][k]) / x : s), 0)));
    const Gpz = P.map((i) => Z.map((j) => Gp[i][j]));
    const X = Gpz.map((row) => Z.map((_, j) => row.reduce((s, x, k) => s + x * pinv[k][j], 0)));
    Gr = Gr.map((row, i) => row.map((x, j) => x - X[i].reduce((s, y, k) => s + y * Gpz[j][k], 0)));
  }
  // M = Λp^-1/2 Γr Λp^-1/2: its eigenvalues are ω²
  const scale = P.map((i) => 1 / Math.sqrt(ce.values[i]));
  const M = Gr.map((row, i) => row.map((x, j) => x * scale[i] * scale[j]));
  const w2 = symmetricEigen(M).values;
  const w2max = Math.max(...w2, 0);
  return w2
    .filter((x) => x > 1e-12 * w2max)
    .map((x) => Math.sqrt(x) / (2 * Math.PI))
    .sort((a, b) => b - a);
}
