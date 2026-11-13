// The formats NodeForge exports besides its circuit file (.nfg, written only by Save), shared by the page and the
// main process's export IPC (forge-shell's exportFiles and registerExportIpc).
// Licensed under the GNU General Public License v2 or later. See LICENSE.
import type { ExportFormat } from "forge-shell/app/export-plan";

export const EXPORT_FORMATS: ExportFormat[] = [
  { id: "xml", name: "CircuitJS XML", extensions: ["xml"], mime: "application/xml" },
  { id: "txt", name: "CircuitJS Text", extensions: ["txt"], mime: "text/plain" },
  { id: "spice", name: "SPICE netlist", extensions: ["cir"], mime: "text/plain" },
  { id: "csv", name: "CSV data", extensions: ["csv"], mime: "text/csv" },
];
