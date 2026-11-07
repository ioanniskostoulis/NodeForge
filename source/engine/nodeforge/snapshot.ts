// Element state snapshots, so the NodeForge solver can take a timestep back: when a step turns out
// too inaccurate (or doesn't converge) every element returns to exactly where it was.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { recordingFields } from "./parts";

/** Fields that are wiring or shared configuration, never per-step state. */
const SKIP = new Set(["sim", "nodes", "model", "voltSources", "voltSource", "parentList", "compNodeList", "extList"]);

/**
 * An object whose fields are worth saving: an element, or a helper an element owns that does its
 * own stepping (an Inductor, a Diode, a composite's parts).
 */
function stateful(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || ArrayBuffer.isView(v) || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  // or a holder of state that says so (a device's charge history)
  if ((o.constructor as { stateful?: boolean }).stateful === true) return true;
  return typeof o.doStep === "function" || typeof o.startIteration === "function" || typeof o.calculateCurrent === "function";
}

interface Entry {
  obj: Record<string, unknown>;
  /** Number fields, boolean fields, and number arrays (Float64Array or number[]). */
  nums: string[];
  bools: string[];
  arrays: string[];
}

/**
 * Which fields hold the numeric state of a set of elements (and what they own). Working this out
 * looks at every field, so it's done once per circuit; saving and restoring then just copy values.
 */
export class StatePlan {
  readonly entries: Entry[] = [];
  private numCount = 0;

  constructor(roots: readonly object[]) {
    const seen = new Set<object>();
    const visit = (obj: Record<string, unknown>) => {
      if (seen.has(obj)) return;
      seen.add(obj);
      const e: Entry = { obj, nums: [], bools: [], arrays: [] };
      const records = recordingFields(obj);
      for (const key of Object.keys(obj)) {
        if (SKIP.has(key) || records?.includes(key)) continue;
        const v = obj[key];
        if (typeof v === "number") e.nums.push(key);
        else if (typeof v === "boolean") e.bools.push(key);
        else if (v instanceof Float64Array) e.arrays.push(key);
        else if (Array.isArray(v)) {
          if (v.length && v.every((x) => typeof x === "number")) e.arrays.push(key);
          else for (const item of v) if (stateful(item)) visit(item);
        } else if (stateful(v)) visit(v);
      }
      this.entries.push(e);
      this.numCount += e.nums.length + e.bools.length;
    };
    for (const r of roots) visit(r as Record<string, unknown>);
    this.compile();
  }

  /**
   * Saving and restoring run every time step, and looking fields up by name is slow (every element
   * class has its own shape): compile, for each kind of object, small functions that read and write
   * its fields directly. Objects of the same class share them, so they get hot and optimized.
   */
  private fast: { obj: Record<string, unknown>; at: number; save: Copier; restore: Copier }[] | null = null;
  /** Every saved array field, flattened. */
  private arrayFields: { obj: Record<string, unknown>; key: string }[] = [];

  private compile(): void {
    const fast: NonNullable<StatePlan["fast"]> = [];
    let at = 0;
    try {
      for (const e of this.entries) {
        if (e.nums.length || e.bools.length) {
          const sig = `${e.obj.constructor?.name}|${e.nums.join(",")}|${e.bools.join(",")}`;
          let c = copiers.get(sig);
          if (!c) {
            const save: string[] = [], restore: string[] = [];
            let i = 0;
            for (const k of e.nums) {
              save.push(`n[at + ${i}] = o[${JSON.stringify(k)}];`);
              restore.push(`o[${JSON.stringify(k)}] = n[at + ${i++}];`);
            }
            for (const k of e.bools) {
              save.push(`n[at + ${i}] = o[${JSON.stringify(k)}] ? 1 : 0;`);
              restore.push(`o[${JSON.stringify(k)}] = n[at + ${i++}] !== 0;`);
            }
            c = { save: new Function("o", "n", "at", save.join("\n")) as Copier, restore: new Function("o", "n", "at", restore.join("\n")) as Copier };
            copiers.set(sig, c);
          }
          fast.push({ obj: e.obj, at, save: c.save, restore: c.restore });
        }
        at += e.nums.length + e.bools.length;
      }
      this.fast = fast;
      this.arrayFields = this.entries.flatMap((e) => e.arrays.map((key) => ({ obj: e.obj, key })));
    } catch {
      // no code generation allowed (a strict content security policy): look fields up by name
      this.fast = null;
    }
  }

  /** Copy the current state out. */
  save(into?: SavedState): SavedState {
    const s = into ?? { nums: new Float64Array(this.numCount), arrays: [] };
    if (this.fast) {
      for (const f of this.fast) f.save(f.obj, s.nums, f.at);
      this.saveArrays(s);
      return s;
    }
    let i = 0, a = 0;
    for (const e of this.entries) {
      const o = e.obj;
      for (const k of e.nums) s.nums[i++] = o[k] as number;
      for (const k of e.bools) s.nums[i++] = o[k] ? 1 : 0;
      for (const k of e.arrays) {
        const src = o[k] as ArrayLike<number>;
        let dst = s.arrays[a];
        if (!dst || dst.length !== src.length) dst = s.arrays[a] = new Float64Array(src.length);
        for (let j = 0; j < src.length; j++) dst[j] = src[j];
        a++;
      }
    }
    return s;
  }

  private saveArrays(s: SavedState): void {
    const fields = this.arrayFields;
    for (let a = 0; a < fields.length; a++) {
      const src = fields[a].obj[fields[a].key] as ArrayLike<number>;
      let dst = s.arrays[a];
      if (!dst || dst.length !== src.length) dst = s.arrays[a] = new Float64Array(src.length);
      for (let j = 0; j < src.length; j++) dst[j] = src[j];
    }
  }

  /** Put a saved state back (arrays in place, so references held elsewhere stay valid). */
  restore(s: SavedState): void {
    if (this.fast) {
      for (const f of this.fast) f.restore(f.obj, s.nums, f.at);
      const fields = this.arrayFields;
      for (let a = 0; a < fields.length; a++) {
        const { obj, key } = fields[a];
        const dst = obj[key] as Float64Array | number[], src = s.arrays[a];
        if (dst.length === src.length) for (let j = 0; j < src.length; j++) dst[j] = src[j];
        else obj[key] = Array.isArray(dst) ? Array.from(src) : src.slice();
      }
      return;
    }
    let i = 0, a = 0;
    for (const e of this.entries) {
      const o = e.obj;
      for (const k of e.nums) o[k] = s.nums[i++];
      for (const k of e.bools) o[k] = s.nums[i++] !== 0;
      for (const k of e.arrays) {
        const dst = o[k] as Float64Array | number[], src = s.arrays[a++];
        if (dst.length === src.length) for (let j = 0; j < src.length; j++) dst[j] = src[j];
        else o[k] = Array.isArray(dst) ? Array.from(src) : src.slice();
      }
    }
  }
}

type Copier = (o: Record<string, unknown>, n: Float64Array, at: number) => void;
/** Compiled copiers, by class and fields (shared by every plan). */
const copiers = new Map<string, { save: Copier; restore: Copier }>();

export interface SavedState {
  nums: Float64Array;
  arrays: Float64Array[];
}
