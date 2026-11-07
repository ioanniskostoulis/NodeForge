// SPICE models known to this session: from the circuits opened (each carries the models its parts
// use) and the model library. Parts refer to them by name, as SPICE netlists do.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { hasExpressions, libraryScope, resolveModel } from "./params";
import { parseSpice, type SpiceLibrary, type SpiceModel, type SpiceSubckt } from "./parse";

/** A model or subcircuit, with the SPICE text that defines it completely (its dependencies included). */
export interface ModelDef {
  name: string;
  /** "model" (a .model card) or "subckt". */
  kind: "model" | "subckt";
  /** The card, its expression values worked out with the text's parameters. */
  model: SpiceModel | null;
  subckt: SpiceSubckt | null;
  /** Self-contained SPICE text: the card or block, plus the models and subcircuits it uses. */
  text: string;
}

const defs = new Map<string, ModelDef>();

/**
 * The text a subcircuit needs: the top-level `.param` / `.func` lines (it may use them), itself, then
 * the outside models and subcircuits it refers to.
 */
function closure(lib: SpiceLibrary, sub: SpiceSubckt, seen = new Set<string>()): string[] {
  const out: string[] = seen.size ? [] : [...lib.globals];
  if (seen.has(sub.name.toLowerCase())) return out;
  seen.add(sub.name.toLowerCase());
  out.push(sub.source);
  for (const e of sub.elements) {
    if (e.kind === "X") {
      // X name n1 … nk subname [params]: the subcircuit is the last field before any name=value
      const fields = e.fields.filter((f) => !f.includes("=") && !/^params:$/i.test(f));
      const target = lib.subckts.get((fields[fields.length - 1] ?? "").toLowerCase());
      if (target) out.push(...closure(lib, target, seen));
      continue;
    }
    for (const f of e.fields) {
      const key = f.toLowerCase();
      if (sub.models.has(key) || seen.has(key)) continue;
      const m = lib.models.get(key);
      if (m) {
        seen.add(key);
        out.push(m.source);
      }
    }
  }
  return out;
}

/**
 * Register every model and subcircuit in some SPICE text (a library file, or a circuit's stored
 * models). Returns the names defined; later definitions of a name replace earlier ones.
 */
export function defineModels(text: string): ModelDef[] {
  const lib = parseSpice(text);
  const scope = libraryScope(lib);
  const out: ModelDef[] = [];
  for (const m of lib.models.values()) {
    const expr = hasExpressions(m);
    const d: ModelDef = { name: m.name, kind: "model", model: resolveModel(m, scope), subckt: null, text: expr ? [...lib.globals, m.source].join("\n") : m.source };
    defs.set(m.name.toLowerCase(), d);
    out.push(d);
  }
  for (const s of lib.subckts.values()) {
    const d: ModelDef = { name: s.name, kind: "subckt", model: null, subckt: s, text: closure(lib, s).join("\n") };
    defs.set(s.name.toLowerCase(), d);
    out.push(d);
  }
  return out;
}

/** A model or subcircuit by name (case-insensitive, as SPICE). */
export function findModel(name: string): ModelDef | null {
  return defs.get(name.toLowerCase()) ?? null;
}

/** Every model known, by name. */
export function knownModels(): ModelDef[] {
  return [...defs.values()];
}
