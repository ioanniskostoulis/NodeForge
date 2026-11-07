// Licensed under the GNU General Public License v2 or later. See LICENSE.

// Background analysis for recommended settings: runs the trial simulations off the window's
// thread, so the interface stays responsive however long they take.

import { type AnalysisInput, analyzeCircuit } from "./recommend";

self.onmessage = (event: MessageEvent<{ id: number; input: AnalysisInput }>) => {
  const { id, input } = event.data;
  try {
    self.postMessage({ id, result: analyzeCircuit(input) });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
