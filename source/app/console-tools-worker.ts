// Long-running console tools operate on a copy, never on the live sheet.
// Licensed under the GNU General Public License v2 or later. See LICENSE.
import { SimulationModel } from "./model";
import { settings } from "./settings";
import { monteCarlo, spread, MEASURES, MEASURE_UNITS } from "../cli/monte-carlo";
import { si } from "./format";
import type { ConsoleTable } from "./terminal";

self.onmessage = (event: MessageEvent<{ text: string; tool: string; count: number; solver: "nodeforge" | "circuitjs"; relTol: number }>) => {
  const { text, tool, count, solver, relTol } = event.data;
  settings.solver = solver;
  settings.relTol = relTol;
  try {
    const lines: string[] = [];
    let table: ConsoleTable | undefined;
    if (tool === "monte-carlo") {
      const result = monteCarlo(text, { runs: count, seed: 1, probes: [] });
      lines.push(`${result.runs.length} runs; seeds 1–${count}; ${si(result.seconds, "s")} per run`);
      for (const run of result.runs) if (run.stopped) lines.push(`seed ${run.seed}: Stopped: ${run.stopped}`);
      const monteTable: ConsoleTable = { headers: ["Part", "Measure", "Ideal", "Mean", "σ", "Min (seed)", "Max (seed)"], rows: [] };
      result.probes.forEach((probe, index) => {
        for (const key of MEASURES) {
          const values = spread(result, index, key);
          if (values) {
            const unit = MEASURE_UNITS[key];
            monteTable.rows.push([probe, key, si(result.nominal[index][key], unit), si(values.mean, unit), si(values.sd, unit),
              `${si(values.min.v, unit)} (${values.min.seed})`, `${si(values.max.v, unit)} (${values.max.seed})`]);
          }
        }
      });
      table = monteTable;
    } else {
      const model = new SimulationModel(text);
      const start = performance.now();
      let done = 0;
      while (done < count && !model.sim.stopMessage && performance.now() - start < 10000) { model.step(); done++; }
      lines.push(`${done}/${count} steps in ${(performance.now() - start).toFixed(1)} ms; circuit time ${si(model.sim.t, "s")}`);
      if (model.sim.stopMessage) lines.push(`Stopped: ${model.sim.stopMessage}`);
      else if (done < count) lines.push("Stopped at the 10-second benchmark limit.");
    }
    self.postMessage({ lines, tables: table?.rows.length ? [table] : [] });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
