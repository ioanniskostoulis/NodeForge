// Electron preload: exposes `window.nodeforge` (see source/app/bridge.ts) to the interface.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "../app/bridge";
import { createDesktopBridge } from "forge-shell/desktop/bridge";

const bridge: DesktopBridge = {
  ...createDesktopBridge<"nfg" | "xml" | "txt" | "spice" | "csv">(ipcRenderer, process.platform as DesktopBridge["platform"], require("../../package.json").version),
  openCircuit: (path) => ipcRenderer.invoke("console:open", path),
  verifyCircuit: (text, accurate, relTol) => ipcRenderer.invoke("console:verify", text, accurate, relTol),
  cancelChecks: () => ipcRenderer.send("console:cancel"),
  models: {
    load: () => ipcRenderer.invoke("models:load"),
    save: (json) => ipcRenderer.invoke("models:save", json),
    openFiles: () => ipcRenderer.invoke("models:open"),
    download: (url) => ipcRenderer.invoke("models:download", url),
    check: (json) => ipcRenderer.invoke("models:check", json),
  },
};

contextBridge.exposeInMainWorld("nodeforge", bridge);
