// Electron main process: the window (circuits open as tabs inside it), the native menu bar, file
// dialogs and restricted ngspice verification. The interface itself is the same web app as the
// browser version, served from the app:// protocol.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { app, BrowserWindow, dialog, ipcMain, Menu, type MenuItemConstructorOptions, net, protocol, shell } from "electron";
import { execFile, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ModelCheckResult, OpenedFile } from "../app/bridge";
import type { MenuNode } from "../app/menus";
import { createNativeMenuTemplate } from "forge-shell/desktop/native-menu";
import { DesktopWindowState } from "forge-shell/desktop/window-state";
import { forwardFullScreen } from "forge-shell/desktop/full-screen";
import { DARK_WINDOW_BACKGROUND, registerTitleBarIpc, usesNativeMenu, windowChrome } from "forge-shell/desktop/title-bar";
import { documentArguments, readOpenedFiles } from "forge-shell/desktop/files";
import { registerShellMainIpc } from "forge-shell/desktop/ipc-main";
import { registerUpdater } from "forge-shell/desktop/updater";
import forgeConfig from "../../forge.config.json";

const isMac = process.platform === "darwin";
const devUrl = !app.isPackaged ? process.env.FORGE_DEV_URL ?? process.env.NODEFORGE_DEV_URL : undefined;
if (devUrl) app.setPath("userData", join(app.getPath("appData"), `${forgeConfig.identity.name} Dev`));
const verificationEnv = () => ({
  ...process.env,
  ELECTRON_RUN_AS_NODE: "1",
  // Finder omits Homebrew from PATH. Windows uses its normal PATH; nfsim also looks in Spice64.
  ...(isMac ? { PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}` } : {}),
});
/** Root of the bundled files: build/ in development, resources/app.asar/build when packaged. */
const buildRoot = join(__dirname, "..");
const nfsimPath = app.isPackaged ? join(process.resourcesPath, "bin", "nfsim.cjs") : join(buildRoot, "nfsim.cjs");
const CIRCUIT_FILE = /\.(nfg|txt|xml|circuitjs)$/i;

const windows = new DesktopWindowState<OpenedFile>();
const checks = new Map<number, Set<ChildProcess>>();
const allowedWrites = new Map<number, Set<string>>();
function trackCheck(id: number, child: ChildProcess): void {
  const jobs = checks.get(id) ?? new Set<ChildProcess>();
  checks.set(id, jobs); jobs.add(child);
  child.once("close", () => { jobs.delete(child); if (!jobs.size) checks.delete(id); });
}
ipcMain.on("console:cancel", (e) => { for (const child of checks.get(e.sender.id) ?? []) child.kill(); });
let pendingOpen: string[] = [];

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

function readFiles(paths: string[]): OpenedFile[] {
  return readOpenedFiles(paths, (path) => readFileSync(path, "utf8"),
    (path, error) => dialog.showErrorBox("Can't open circuit", `${path}\n${error.message}`));
}

/** A NodeForge circuit the person opened can be saved back (Save, autosave); a CircuitJS file is saved as a new .nfg. */
function allowWrites(id: number, paths: string[]): void {
  const approved = allowedWrites.get(id) ?? new Set<string>();
  for (const path of paths) if (/\.nfg$/i.test(path)) approved.add(path);
  allowedWrites.set(id, approved);
}

/** Open files as tabs in the frontmost window (or a new window if there is none). */
function openFiles(paths: string[]): void {
  const files = readFiles(paths);
  if (!files.length) return;
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (win) {
    allowWrites(win.webContents.id, files.map((file) => file.path));
    win.webContents.send("openFiles", files);
    if (win.isMinimized()) win.restore();
    win.focus();
  } else openWindow(files);
}

function openWindow(files: OpenedFile[] = []): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    backgroundColor: DARK_WINDOW_BACKGROUND,
    title: forgeConfig.identity.name,
    // The active circuit is named in its tab; macOS keeps this row for its window controls and the tools, and Windows
    // draws its menu bar here beside its own window controls.
    ...windowChrome(process.platform),
    show: false,
    webPreferences: { preload: join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: false },
  });
  const id = win.webContents.id;
  windows.setStartupFiles(id, files);
  allowWrites(id, files.map((file) => file.path));
  win.once("ready-to-show", () => win.show());
  forwardFullScreen(win);
  // unsaved circuits: the window asks in its own prompt (save the chosen ones, discard or cancel)
  win.on("close", (e) => {
    if (!windows.needsClosePrompt(id)) return;
    e.preventDefault();
    win.webContents.send("closeRequest");
  });
  win.on("closed", () => {
    allowedWrites.delete(id);
    if (windows.closed(id, BrowserWindow.getAllWindows().length)) app.quit();
    for (const child of checks.get(id) ?? []) child.kill();
  });
  // links (About window credits) open in the browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  // A panel selection and a launch capture are used by desktop smoke checks.
  const requestedPanel = process.env.FORGE_PANEL ?? process.env.NODEFORGE_PANEL;
  const panel = requestedPanel ? `?panel=${encodeURIComponent(requestedPanel)}` : "";
  win.loadURL(`${devUrl ?? `app://${forgeConfig.identity.id}`}/index.html${panel}`);
  const capture = process.env.FORGE_CAPTURE ?? process.env.NODEFORGE_CAPTURE;
  if (capture) {
    win.webContents.once("did-finish-load", () => setTimeout(async () => {
      try {
        const image = await win.webContents.capturePage();
        // Publish only the complete PNG: CI polls for its existence before opening it.
        writeFileSync(`${capture}.tmp`, image.toPNG());
        renameSync(`${capture}.tmp`, capture);
        console.log(`capture: wrote ${capture}`);
      } catch (error) {
        console.error(`capture: ${String(error)}`);
      }
    }, Number(process.env.FORGE_CAPTURE_DELAY ?? process.env.NODEFORGE_CAPTURE_DELAY ?? 5000)));
  }
}

// MARK: native menu from the renderer's menu definition

function installMenu(nodes: MenuNode[]): void {
  // Windows draws the menus in the page; no native menu bar is installed.
  if (!usesNativeMenu(process.platform)) { Menu.setApplicationMenu(null); return; }
  const template = createNativeMenuTemplate(nodes, {
    productName: forgeConfig.identity.name,
    isMac,
    isPackaged: app.isPackaged,
    onCommand: (id, win) => (win as BrowserWindow | undefined)?.webContents.send("command", id),
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template as MenuItemConstructorOptions[]));
}

// MARK: IPC

const shellIpcOptions = {
  windows,
  windowFor: (event: { sender: { id: number } }) => BrowserWindow.fromWebContents(event.sender as Electron.WebContents),
  focusedWindow: () => BrowserWindow.getFocusedWindow(),
  installMenu,
  newWindow: () => openWindow(),
  canWriteFile: (event: { sender: { id: number } }, path: string) => allowedWrites.get(event.sender.id)?.has(path) ?? false,
  writeFile: (path: string, text: string) => writeFile(path, text, "utf8"),
  // File › Open recent keeps its own list; this adds the file to the Dock menu and Jump Lists too
  addRecentDocument: (path: string) => app.addRecentDocument(path),
};
registerShellMainIpc(ipcMain, shellIpcOptions);
// One-click updates from the releases of the repository named in the profile (Help › Check for updates…).
const { repository } = forgeConfig.identity;
if (repository && app.isPackaged) registerUpdater(ipcMain, { repository, executable: process.execPath, platform: process.platform, quit: () => app.quit(), openPath: (path) => shell.openPath(path) });
// The colours of the Windows window controls follow the page's appearance.
registerTitleBarIpc(ipcMain, (event) => BrowserWindow.fromWebContents(event.sender as Electron.WebContents));
ipcMain.handle("openFileDialog", async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
  const r = await dialog.showOpenDialog(win!, {
    title: "Open Circuit",
    filters: [{ name: "Circuits", extensions: ["nfg", "txt", "xml", "circuitjs"] }, { name: "All Files", extensions: ["*"] }],
    properties: ["openFile", "multiSelections"],
  });
  if (r.canceled) return [];
  const files = readFiles(r.filePaths);
  allowWrites(e.sender.id, files.map((file) => file.path));
  return files;
});
ipcMain.handle("saveDialog", async (e, defaultName: string, format?: "nfg" | "xml" | "txt" | "spice" | "csv") => {
  const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
  const nfg = { name: "NodeForge Circuit", extensions: ["nfg"] };
  const xml = { name: "CircuitJS XML", extensions: ["xml"] };
  const text = { name: "CircuitJS Text", extensions: ["txt"] };
  const r = await dialog.showSaveDialog(win!, {
    title: format === "csv" ? "Export scope data" : "Save Circuit",
    defaultPath: defaultName,
    // circuits are saved as .nfg; CircuitJS XML and text are exports
    filters: format === "csv" ? [{ name: "CSV data", extensions: ["csv"] }] : format === "spice" ? [{ name: "SPICE netlist", extensions: ["cir"] }] : format === "xml" ? [xml] : format === "txt" ? [text] : [nfg],
  });
  if (r.canceled || !r.filePath) return null;
  const extension = format === "csv" ? ".csv" : format === "spice" ? ".cir" : format === "xml" ? ".xml" : format === "txt" ? ".txt" : ".nfg";
  const path = r.filePath.toLowerCase().endsWith(extension) ? r.filePath : `${r.filePath}${extension}`;
  const approved = allowedWrites.get(e.sender.id) ?? new Set<string>();
  approved.add(path);
  allowedWrites.set(e.sender.id, approved);
  return path;
});
ipcMain.handle("console:open", async (e, name: string): Promise<OpenedFile> => {
  if (typeof name !== "string" || !CIRCUIT_FILE.test(name)) throw new Error("Choose a .nfg, .txt, .xml or .circuitjs circuit file");
  const path = resolve(name.startsWith("~/") ? join(app.getPath("home"), name.slice(2)) : name);
  const text = await readFile(path, "utf8");
  allowWrites(e.sender.id, [path]);
  return { path, text };
});
ipcMain.handle("console:verify", async (event, text: string, accurate: boolean, relTol: number) => {
  if (typeof text !== "string" || text.length > 16 * 1024 * 1024 || typeof accurate !== "boolean" || !Number.isFinite(relTol) || relTol <= 0) throw new Error("Invalid verification request");
  const dir = mkdtempSync(join(tmpdir(), "nodeforge-verify-"));
  const file = join(dir, "circuit.xml");
  try {
    writeFileSync(file, text);
    return await new Promise<string>((resolve) => {
      const child = execFile(process.execPath, [nfsimPath, "accuracy", file, ...(accurate ? [] : ["--circuitjs"]), "--reltol", String(relTol)],
        { env: verificationEnv(), maxBuffer: 1 << 24, timeout: 120000 },
        (error, stdout, stderr) => resolve([stdout, stderr, error ? `Verification failed: ${error.message}` : ""].filter(Boolean).join("\n").trim()));
      trackCheck(event.sender.id, child);
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// MARK: model library

const modelsFile = () => join(app.getPath("userData"), "models.json");
ipcMain.handle("models:load", async () => {
  try {
    return await readFile(modelsFile(), "utf8");
  } catch {
    return null;
  }
});
ipcMain.handle("models:save", (_e, json: string) => writeFile(modelsFile(), json, "utf8"));
ipcMain.handle("models:open", async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
  const r = await dialog.showOpenDialog(win!, {
    title: "Import SPICE Models",
    filters: [
      { name: "SPICE models", extensions: ["lib", "mod", "spi", "sp", "cir", "sub", "model", "txt", "inc", "ckt"] },
      { name: "All Files", extensions: ["*"] },
    ],
    properties: ["openFile", "multiSelections"],
  });
  return r.canceled ? [] : readFiles(r.filePaths);
});
ipcMain.handle("models:download", async (_e, url: string) => {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return { error: "Only web links (https://…) can be downloaded" };
    const r = await net.fetch(u.toString());
    if (!r.ok) return { error: `The server answered ${r.status} ${r.statusText}` };
    const size = Number(r.headers.get("content-length") ?? 0);
    if (size > 20e6) return { error: "The file is over 20 MB" };
    const text = await r.text();
    if (/^\s*<(!doctype|html)/i.test(text)) return { error: "That link leads to a web page, not a model file (it may need you to accept terms in a browser first)" };
    return { text, name: decodeURIComponent(u.pathname.split("/").pop() || u.hostname) };
  } catch (err) {
    return { error: (err as Error).message };
  }
});
ipcMain.handle("models:check", (event, json: string) => new Promise<{ results: ModelCheckResult[] } | { error: string }>((resolve) => {
  const dir = mkdtempSync(join(tmpdir(), "nodeforge-check-"));
  const file = join(dir, "models.json");
  writeFileSync(file, json);
  const env = verificationEnv();
  const child = execFile(process.execPath, [nfsimPath, "check-models", file], { env, maxBuffer: 1 << 24, timeout: 10 * 60e3 }, (err, stdout, stderr) => {
    rmSync(dir, { recursive: true, force: true });
    try {
      resolve({ results: JSON.parse(stdout) as ModelCheckResult[] });
    } catch {
      resolve({ error: (stderr || (err as Error | null)?.message || "the check didn't run").trim().split("\n").pop()! });
    }
  });
  trackCheck(event.sender.id, child);
}));

// MARK: app lifecycle

/** Circuit files among command-line arguments. */
function argFiles(argv: string[], cwd = process.cwd()): string[] {
  return documentArguments(argv, cwd, (path) => CIRCUIT_FILE.test(path), resolve, existsSync);
}

// one NodeForge: a second launch (e.g. opening a file from the command line) adds tabs here
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", (_e, argv, cwd) => {
  const files = argFiles(argv.slice(1), cwd);
  if (files.length) openFiles(files);
  else BrowserWindow.getAllWindows()[0]?.focus();
});

// macOS: files opened from Finder (before or after launch)
app.on("open-file", (event, path) => {
  event.preventDefault();
  if (app.isReady()) openFiles([path]);
  else pendingOpen.push(path);
});

app.whenReady().then(() => {
  protocol.handle("app", (req) => {
    const path = decodeURIComponent(new URL(req.url).pathname);
    return net.fetch(pathToFileURL(join(buildRoot, "app", path)).toString());
  });
  // Windows / Linux: files passed on the command line
  const files = [...pendingOpen, ...argFiles(process.argv.slice(app.isPackaged ? 1 : 2))];
  pendingOpen = [];
  openWindow(readFiles(files));
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) openWindow();
});

app.on("before-quit", () => {
  windows.beginQuit();
});
app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});
