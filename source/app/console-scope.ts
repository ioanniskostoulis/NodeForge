// Scope command validation shared by the console and its regression checks.
// Licensed under the GNU General Public License v2 or later. See LICENSE.
import { ScopeFlag } from "../engine";
import type { ScopeRuntime, ScopeTrace } from "./model";
import { parseSI, si } from "./format";
import { numberedItem } from "forge-shell/app/listing";
export { numberedItem } from "forge-shell/app/listing";

export function triggerTrace(scope: ScopeRuntime): ScopeTrace | undefined {
  const stored = scope.traces[scope.view.trigger.trace];
  return scope.visibleTraces.includes(stored) ? stored : scope.visibleTraces[0];
}

/** Validate the complete change before touching the document's undo state. */
export function prepareTrigger(scope: ScopeRuntime, action: string, value?: string): () => void {
  if (scope.isXY || scope.has(ScopeFlag.fft)) throw new Error("Triggers require a time plot.");
  if (["rising", "falling", "off"].includes(action)) {
    return () => { scope.view.trigger.edge = action === "rising" ? 1 : action === "falling" ? -1 : 0; };
  }
  if (action === "trace") {
    const trace = numberedItem(scope.visibleTraces, value ?? "", "Trace");
    return () => { scope.view.trigger.trace = scope.traces.indexOf(trace); scope.view.trigger.level = null; };
  }
  if (action === "level") {
    const trace = triggerTrace(scope);
    if (!trace) throw new Error("This scope has no visible traces.");
    if (value === "midpoint") return () => { scope.view.trigger.level = null; };
    // parseSI accepts other units too; explicitly reject units that do not match the trace.
    const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)([TGMkKmuµμnpf]?)([VAWC]?)$/.exec(value ?? "");
    if (!match || (match[3] && match[3] !== trace.unit)) throw new Error(`Trigger level must use ${trace.unit}, or midpoint.`);
    const level = parseSI(value!, trace.unit);
    if (!Number.isFinite(level)) throw new Error("Trigger level must be finite.");
    return () => { scope.view.trigger.level = level; };
  }
  throw new Error("Invalid trigger action. Type help scope trigger for usage.");
}

export function triggerRows(scope: ScopeRuntime): string[][] {
  const trigger = scope.view.trigger, trace = triggerTrace(scope);
  return [
    ["Edge", trigger.edge > 0 ? "Rising" : trigger.edge < 0 ? "Falling" : "Off"],
    ["Trace", trace ? String(scope.visibleTraces.indexOf(trace) + 1) : "None"],
    ["Level", trigger.level === null ? "Midpoint" : si(trigger.level, trace?.unit ?? "", true)],
  ];
}

export function scopeQuantity(text: string, unit: string, positive = false): number {
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)([TGMkKmuµμnpf]?)([VAWCs]?)$/.exec(text);
  const value = match && (!match[3] || match[3] === unit) ? parseSI(text, unit) : NaN;
  if (!Number.isFinite(value) || (positive && value <= 0)) throw new Error(`Use ${positive ? "a positive" : "a finite"} value in ${unit}.`);
  return value;
}

export function preparePlot(scope: ScopeRuntime, type: string): () => void {
  if (!["time", "fft", "xy"].includes(type)) throw new Error("Unknown plot type. Type help scope plot for choices.");
  if (type === "xy" && scope.visibleTraces.length < 2) throw new Error("X-Y plots require two visible traces.");
  return () => {
    if (type === "xy" && !scope.isXY) scope.clearXY();
    scope.flags &= ~(ScopeFlag.plotXY | ScopeFlag.fft);
    if (type === "xy") scope.flags |= ScopeFlag.plotXY;
    if (type === "fft") scope.flags |= ScopeFlag.fft;
  };
}

/** CSV columns describe the stored min/max envelope, not invented instantaneous samples. */
export async function scopeCSV(scope: ScopeRuntime, labels: string[], signal?: AbortSignal): Promise<string> {
  const recording = scope.recording;
  if (!recording) throw new Error("No recording. Run the simulation before exporting.");
  const recordedEnd = recording.end;
  const indices = scope.visibleTraces.map((trace) => scope.traces.indexOf(trace));
  if (!indices.length) throw new Error("This scope has no visible traces.");
  const escape = (s: string) => `"${s.replaceAll('"', '""')}"`;
  const header = ["Time start (s)", "Time end (s)", ...scope.visibleTraces.flatMap((t, i) => [`${labels[i]} minimum (${t.unit})`, `${labels[i]} maximum (${t.unit})`])];
  const lines = [header.map(escape).join(",")];
  let size = lines[0].length;
  await recording.exportCells((start, end, data, offset) => {
    const line = [start, end, ...indices.flatMap((i) => [data[offset + 2 * i], data[offset + 2 * i + 1]])].join(",");
    size += line.length + 2;
    if (size > 64 * 1024 * 1024) throw new Error("CSV export exceeds 64 MB. Use a shorter recording.");
    lines.push(line);
  }, signal);
  if (scope.recording !== recording || recording.end !== recordedEnd) throw new Error("Recording changed during export. Run the export again.");
  return lines.join("\r\n") + "\r\n";
}
