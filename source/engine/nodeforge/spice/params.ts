// Parameters of SPICE text: a library's `.param` / `.func` lines as a scope, and model cards whose
// values are expressions (`Vto={vth+dvth}`) worked out in one.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { ParamScope } from "./expr";
import { copyParams, type SpiceFuncDef, type SpiceLibrary, type SpiceModel } from "./parse";

/** Fill a scope from `.param` lines (in order) and `.func` lines; problems are reported, not thrown. */
export function addParams(scope: ParamScope, params: [string, string][], funcs: SpiceFuncDef[], problems: string[]): void {
  // functions first: parameters may call them
  for (const f of funcs) {
    try {
      scope.define(f.name, f.args, f.body);
    } catch (err) {
      problems.push(`.func ${f.name}: ${(err as Error).message}`);
    }
  }
  for (const [name, text] of params) {
    try {
      scope.set(name, text);
    } catch (err) {
      problems.push(`.param ${name}: ${(err as Error).message}`);
    }
  }
}

/** The top-level parameters and functions of parsed SPICE text. */
export function libraryScope(lib: SpiceLibrary, problems: string[] = []): ParamScope {
  const scope = new ParamScope();
  addParams(scope, lib.params, lib.funcs, problems);
  return scope;
}

/** Does a model card have values that are expressions? */
export function hasExpressions(m: SpiceModel): boolean {
  for (const v of m.text.values()) if (v.includes("{")) return true;
  return false;
}

/**
 * A model card with its expression values worked out in a scope. Values in braces must evaluate
 * (a problem otherwise); bare words that do (`Vto=vth`) are taken, others (`mfg=Vishay`) stay text.
 */
export function resolveModel(m: SpiceModel, scope: ParamScope, problems: string[] = []): SpiceModel {
  if (!m.text.size) return m;
  const out: SpiceModel = { ...m, params: copyParams(m.params), text: new Map() };
  for (const [k, v] of m.text) {
    try {
      out.params.set(k, scope.eval(v));
    } catch (err) {
      if (v.includes("{")) problems.push(`${m.name} ${k}: ${(err as Error).message}`);
      out.text.set(k, v);
    }
  }
  return out;
}
