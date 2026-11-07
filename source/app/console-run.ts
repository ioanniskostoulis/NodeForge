// Bounded, cancellable advancement of the active circuit without changing solver settings.
// Licensed under the GNU General Public License v2 or later. See LICENSE.
import type { SimulationModel } from "./model";

export async function runFor(model: SimulationModel, duration: number, signal?: AbortSignal, unchanged = () => true): Promise<number> {
  const start = model.sim.t, target = start + duration;
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(target) || target <= start) throw new Error("Use a positive, representable duration.");
  model.running = false;
  model.pauseClock();
  const deadline = performance.now() + 120000;
  let stalled = 0;
  try {
    while (model.sim.t < target) {
      if (signal?.aborted) throw new Error("Timed run cancelled. The circuit remains at its current time.");
      if (!unchanged() || model.running) throw new Error("Timed run stopped because the circuit or simulation controls changed.");
      if (performance.now() >= deadline) throw new Error("Timed run reached the 120-second limit. Use a shorter duration.");
      const batchEnd = performance.now() + 12;
      do {
        if (model.sim.stopMessage) throw new Error(`Simulation stopped: ${model.sim.stopMessage}`);
        const before = model.sim.t;
        model.step();
        if (!model.sim.simRunning || model.sim.stopMessage) throw new Error(`Simulation stopped: ${model.sim.stopMessage ?? "stop trigger"}`);
        stalled = model.sim.t > before ? 0 : stalled + 1;
        if (stalled >= 4) throw new Error("Simulation time is not advancing.");
      } while (model.sim.t < target && performance.now() < batchEnd);
      if (model.sim.t < target) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return model.sim.t - start;
  } finally {
    model.running = false;
    model.pauseClock();
  }
}
