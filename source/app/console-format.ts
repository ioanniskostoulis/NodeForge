// Structured console reports keep repeated values aligned at every panel width.
// Licensed under the GNU General Public License v2 or later. See LICENSE.
import type { ConsoleResult, ConsoleTable } from "./terminal";
export { listNumber, numberedTable } from "forge-shell/app/listing";

export function formatPartInfo(lines: string[]): ConsoleResult {
  const [heading, ...details] = lines;
  const notes: string[] = heading ? [heading] : [];
  const rows: string[][] = [];
  for (const line of details) {
    for (const field of line.split(/,\s+(?=[^,=]+ = )/)) {
      const match = /^([^=]+) = (.*)$/.exec(field);
      if (match) rows.push([match[1].trim(), match[2]]);
      else notes.push(field);
    }
  }
  return { lines: notes, tables: rows.length ? [{ headers: [], rows }] : [] };
}

/** nfsim prints a known per-node numeric report; keep other diagnostics verbatim. */
export function formatVerification(text: string): ConsoleResult {
  const lines = text.trim().split(/\r?\n/);
  const header = lines.findIndex((line) => /^\s*node\s+raw max\s+shape\s+rms\s+swing\s+raw %\s+shape %\s*$/.test(line));
  if (header < 0) return { lines };
  const rows: string[][] = [];
  let end = header + 1;
  while (end < lines.length) {
    const cells = lines[end].trim().split(/\s+/);
    if (cells.length !== 7 || !cells.slice(1).every((value) => Number.isFinite(Number(value)))) break;
    rows.push(cells);
    end++;
  }
  if (!rows.length) return { lines };
  const table: ConsoleTable = {
    headers: ["Node", "Raw max (V)", "Shape (V)", "RMS (V)", "Swing (V)", "Raw %", "Shape %"], rows,
  };
  return { lines: [...lines.slice(0, header), ...lines.slice(end)], tables: [table] };
}
