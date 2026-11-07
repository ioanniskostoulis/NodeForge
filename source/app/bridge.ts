// Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { ForgeDesktopBridge, OpenedFile } from "forge-shell/desktop/bridge";
export type { OpenedFile } from "forge-shell/desktop/bridge";

/** A model checked against ngspice: the worst shape difference (%), or why there's none. */
export interface ModelCheckResult {
  name: string;
  error: number | null;
  note?: string;
}

/**
 * What the Electron preload script exposes as `window.nodeforge`. In a plain browser it's
 * undefined, and the app falls back to web equivalents (HTML menu bar, file input, downloads,
 * the same NodeForge command console).
 */
export interface DesktopBridge extends ForgeDesktopBridge<"nfg" | "xml" | "txt" | "spice" | "csv"> {
  openCircuit(path: string): Promise<OpenedFile>;
  /** Compare only supplied circuit text against ngspice; no arbitrary process or path access. */
  verifyCircuit(text: string, accurate: boolean, relTol: number): Promise<string>;
  cancelChecks(): void;
  /** The model library: kept in the app's data folder, files and downloads, checks with ngspice. */
  models: {
    /** The user's library (JSON), or null if there's none yet. */
    load(): Promise<string | null>;
    save(json: string): Promise<void>;
    /** Show the Open dialog for SPICE model files and read them. */
    openFiles(): Promise<OpenedFile[]>;
    /** Download a model file from a link the user gave. */
    download(url: string): Promise<{ text: string; name: string } | { error: string }>;
    /** Run models (a JSON array) in NodeForge and ngspice and compare. */
    check(json: string): Promise<{ results: ModelCheckResult[] } | { error: string }>;
  };
}

declare global {
  interface Window {
    nodeforge?: DesktopBridge;
  }
}

export const desktop: DesktopBridge | undefined = typeof window === "undefined" ? undefined : window.nodeforge;
