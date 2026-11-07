// Numeric edit items: the subset of a part's properties that sliders can drive (see
// elements/edits.ts for all of them). Indices match upstream, because slider definitions in
// circuit files refer to them.
// Copyright (C) Paul Falstad and Iain Sharp, CircuitJS1 (https://github.com/sharpie7/circuitjs1), GNU General Public License v2 or later.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { CircuitElm } from "./elm";
import { numberInput } from "./editinfo";
import { getEditInfo, setEditValue as setEdit } from "../elements/edits";

export { setWaveform } from "../elements/edits";

export interface EditItem {
  name: string;
  value: number;
}

/** The numeric edit item at upstream index `n`, or null if there is none (or it isn't numeric). */
export function editItem(e: CircuitElm, n: number): EditItem | null {
  const ei = getEditInfo(e, n);
  return ei && ei.kind === "number" ? { name: ei.name, value: ei.value } : null;
}

/** Set the numeric edit item at upstream index `n`. The caller must re-analyze the circuit. */
export function setEditValue(e: CircuitElm, n: number, v: number): void {
  setEdit(e, n, numberInput(v));
}
