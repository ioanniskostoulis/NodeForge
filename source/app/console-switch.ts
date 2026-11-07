// Switch operations preserve linked-switch behavior and validate before recording an edit.
// Licensed under the GNU General Public License v2 or later. See LICENSE.
import { SwitchElm, type CircuitElm } from "../engine";
import type { SimulationModel } from "./model";

export function switchState(part: SwitchElm): string {
  return part.getPostCount() === 2 && part.posCount === 2
    ? part.position === 0 ? "Closed" : "Open"
    : `Position ${part.position + 1}`;
}

export function prepareSwitch(model: SimulationModel, part: CircuitElm, state?: string): () => void {
  if (!(part instanceof SwitchElm)) throw new Error("This component is not a switch or logic input.");
  if (!state) return () => { model.toggle(part); };
  let target: number;
  if (state === "on" || state === "off") {
    if (part.getPostCount() !== 2 || part.posCount !== 2) throw new Error(`Use a position from 1 to ${part.posCount} for this switch.`);
    target = state === "on" ? 0 : 1;
  } else {
    target = Number(state) - 1;
    if (!/^\d+$/.test(state) || !Number.isSafeInteger(target) || target < 0 || target >= part.posCount) throw new Error(`Use a position from 1 to ${part.posCount}.`);
  }
  const steps = (target - part.position + part.posCount) % part.posCount;
  return () => { for (let i = 0; i < steps; i++) model.toggle(part); };
}
