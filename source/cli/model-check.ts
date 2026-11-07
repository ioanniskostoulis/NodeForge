// Checking a library model: its kind's test circuit run in the NodeForge engine and in
// ngspice, and the worst difference in waveform shape.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { defineModels } from "../engine";
import { checkCircuit, type LibraryModel } from "../app/model-catalog";
import { accuracy, worstShape } from "./accuracy";

export function checkModel(model: LibraryModel): { error: number | null; note?: string } {
  defineModels(model.spice);
  const { xml, seconds } = checkCircuit(model);
  const comparison = accuracy(xml, { seconds, accurate: true });
  if (comparison.unsupported.length) return { error: null, note: `not exportable to ngspice: ${comparison.unsupported.join(", ")}` };
  if (comparison.referenceTol === null) return { error: null, note: `ngspice couldn't run it: ${comparison.error}` };
  if (comparison.stopped) return { error: null, note: `NodeForge stopped: ${comparison.stopped}` };
  const worst = worstShape(comparison);
  const loose = comparison.referenceMethod === "ngspice defaults" ? " (against ngspice at its default tolerance)" : "";
  return { error: worst ? worst.percent : null, note: loose || undefined };
}
