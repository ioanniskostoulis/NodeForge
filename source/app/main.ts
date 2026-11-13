// Entry point of the interface. The same code runs in a browser and in the Electron desktop app;
// `desktop` (from the preload script) adds native menus, file dialogs and the terminal.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { type CircuitElm, type CircuitFormat, classForName, CurrentElm, CustomCompositeElm, grid as engineGrid, ScopeElm, ScopeFlag, ScopeValue, SwitchElm, VoltageElm } from "../engine";
import { showAbout, showLicenses } from "./about";
import { menuShortcutGroups, showShortcuts, showWhatsNew } from "forge-shell/app/about";
import { currentShape } from "./current-flow";
import { askToApply, askToSave, askToSaveAll } from "./dialogs";
import { modelLibrary, saveCustomModel } from "./model-library";
import { openModelLibrary } from "./model-library-dialog";
import { Analyzer } from "./analyzer";
import type { AnalysisInput, Recommendation } from "./recommend";
import { desktop, type OpenedFile } from "./bridge";
import { CanvasView } from "./canvas";
import { type MenuEntry, showContextMenu } from "forge-shell/app/context-menu";
import {
  CircuitDocument, copySelection, deleteSelection, flipSelection, gridSize, MoveOperation, newSeed, pasteOffset, pasteText, rotateSelection,
} from "./document";
import { parseSI, si } from "./format";
import { formatTemperature, parseTemperature, temperatureSymbol } from "./temperature";
import { partGroups } from "./icons";
import { PALETTE_GROUPS } from "./part-palette";
import { circuitNotes, Inspector, timesRealTime } from "./inspector";
import { type DrawItem, drawLabel, type Library, loadText, parseLibrary } from "./library";
import { availableWithoutDocument, collectShortcuts, displayKey, type MenuState, renderMenubar } from "./menus";
import { MathTrace, type MathOp, MAX_SPEED_RATIO, MIN_SPEED_RATIO, type ScopeRuntime, type ScopeScale, type ScopeTrace, SHEET_SCOPES, type SimulationModel } from "./model";
import { MEASURES, measureOn, setMeasure, WHOLE_CYCLES } from "./scope-measure";
import { quantitiesFor } from "./scope-quantities";
import { storesEnergy } from "./power";
import { stepScale } from "./scope-math";
import { MEASUREMENT_CURSORS, type ScopePanel, type ScopeTile, ScopeStrip } from "./scopes";
import { ScopeAudio, type ScopeAudioMode } from "./scope-audio";
import { DEFAULTS, onSettingsChange, settings, type Settings, updateSettings } from "./settings";
import { buildToolStrip } from "./tool-strip";
import { availableWithoutCircuit, completeConsole, menuCommand, plotToScope, STANDARD } from "./commands";
import type { ScopeDropEdge } from "./scope-layout";
import { commandHelp, generalHelp, invalidUsage } from "./command-help";
import { numberedItem, prepareTrigger, triggerRows, scopeQuantity, preparePlot, scopeCSV } from "./console-scope";
import { runFor } from "./console-run";
import { prepareSwitch, switchState } from "./console-switch";
import { type MessageKind, MessagesPanel } from "./messages";
import { DocumentTabs } from "forge-shell/app/tabs";
import { applyDesktopClasses } from "forge-shell/app/desktop-classes";
import { validateName } from "forge-shell/app/rename";
import { StatusBar } from "forge-shell/app/status-bar";
import { setTip } from "forge-shell/app/tips";
import { createPanelLayout } from "forge-shell/app/panel-layout";
import { createBottomTabs } from "forge-shell/app/bottom-tabs";
import { shellPreferenceCommand } from "forge-shell/app/shell-preferences";
import { saveDocument } from "forge-shell/app/file-save";
import { openBrowserFiles } from "forge-shell/app/file-open";
import { attachFileDrop } from "forge-shell/app/file-drop";
import { closeDocumentTab, confirmWindowClose, documentWindowTitle, initialDocumentFiles, insertDocument, openDocumentFiles } from "forge-shell/app/documents";
import { createEmptyState } from "forge-shell/app/empty-state";
import { helpAlias } from "forge-shell/app/command-help";
import { dispatchShellAction } from "forge-shell/app/actions";
import { consoleTabCommand } from "forge-shell/app/console-tabs";
import { createTextInputState } from "forge-shell/app/text-input";
import { drawsMenubar, shortcutText, titleBarColors, type MenuNode } from "forge-shell/app/menus";
import { installWorkspaceKeys } from "forge-shell/app/workspace-keys";
import type { InfoOptions } from "forge-shell/app/about";
import { askToRecover, createAutosave, createRecentFiles, createRecovery, parseAutosave } from "forge-shell/app/saving";
import { moveItem } from "forge-shell/app/content-selection";
import { runSharedCommand } from "forge-shell/app/shared-commands";
import { installScrollbars } from "forge-shell/app/scrollbars";
import { exportFiles } from "forge-shell/app/export-files";
import { EXPORT_FORMATS } from "./export-formats";
import { createHealthTracker, healthCommand, healthPage } from "forge-shell/app/health";
import { createTerminalPreferences } from "forge-shell/app/terminal-preferences";
import { terminalPreferencesStorageKey } from "forge-shell/app/profile";
import { generalPage, showSettings, terminalPage, updatesPage, visiblePages, type SettingsPage } from "forge-shell/app/settings-dialog";
import { partNamed, partsForList, prepareProperty, prepareModel, prepareTolerance, settableName, settableProperties, tokenizeConsole } from "./console-edit";
import { formatPartInfo, formatVerification, numberedTable } from "./console-format";
import { findModels } from "./model-catalog";
import { configureSlider, removeSlider, sliderFieldNamed, sliderFields, sliderNumbers } from "./sliders";
import { toSpice } from "../engine";
import { forgeApp } from "./profile";
import { nodeforgeRuntime } from "./domain-profile";

declare const __FORGE_VERSION__: string;
const VERSION = desktop?.version ?? __FORGE_VERSION__;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Single-key part shortcuts, as in CircuitJS (from the palette). */
const PART_KEYS = new Map(partGroups.flat().filter((t) => t.shortcut).map((t) => [t.shortcut!, t.classes[0]] as const));

async function main(): Promise<void> {
  applyDesktopClasses(desktop);
  installScrollbars();
  const [list, drawJson, logo] = await Promise.all([
    loadText("circuits/setuplist.txt"),
    loadText("drawmenu.json"),
    loadText(forgeApp.identity.wordmarkPath).catch(() => forgeApp.identity.name),
  ]);
  const library = parseLibrary(list);
  const draw = (JSON.parse(drawJson) as DrawItem[]).filter((d) => d.class || d.items?.length);
  const drawNames = new Map<string, string>();
  const collect = (items: DrawItem[]) => items.forEach((d) => (d.class ? drawNames.set(d.class, drawLabel(d.label)) : collect(d.items ?? [])));
  collect(draw);
  const info: InfoOptions = { productName: forgeApp.identity.name, purpose: forgeApp.identity.purpose, logo: logo.trimEnd(), version: VERSION };
  // active use and the daily break reminder (Settings › Health, `health reminder`); kept in this app's local storage
  // the Terminal's history limit, banner, caret, spacing and wrap, shared by the Terminal and Settings › Terminal
  const terminalPreferences = createTerminalPreferences(terminalPreferencesStorageKey(forgeApp));
  const health = createHealthTracker({ storageKey: `${forgeApp.identity.id}.health` });
  // the public GitHub repository whose releases Settings › Updates reads
  const { repository } = forgeApp.identity;
  const settingsUpdateOptions = {
    platform: desktop?.platform ?? "browser",
    install: desktop ? (asset: Parameters<NonNullable<typeof desktop>["installUpdate"]>[0]) => desktop!.installUpdate(asset) : undefined,
    onProgress: desktop ? (listener: (progress: { done: number; total: number }) => void) => desktop!.onUpdateProgress(listener) : undefined,
    storageKey: `${forgeApp.identity.id}.updates`,
  };
  // File › Open recent (desktop: the browser has no paths to reopen)
  const recent = createRecentFiles(`${forgeApp.identity.id}.recent`);


  const docs: CircuitDocument[] = await initialDocuments(library);
  // with nothing to open, start on the welcome screen; an unlisted blank sheet stands behind it
  let doc = docs[0] ?? CircuitDocument.empty();

  const status = { hint: "", hintUntil: 0 };
  const flash = (msg: string) => {
    status.hint = msg;
    status.hintUntil = performance.now() + 4000;
    refreshStatus(true);
  };
  /** The answer to something the user just did: in the status bar for a moment, and in the circuit's Messages log. */
  const note = (msg: string, kind: MessageKind = "info", d = doc) => {
    d.messages.add(kind, msg);
    flash(msg);
  };

  const canvas = new CanvasView($<HTMLCanvasElement>("schematic"), doc, {
    onFocusChange: () => {
      refreshStatus(true);
      refreshMenus();
    },
    onEdit: () => edited(),
    onToolChange: () => refreshMenus(),
    editProperties: () => {
      updateSettings({ showInspector: true });
      inspector.focusProperties();
    },
    contextMenu: (x, y, elm) => partMenu(x, y, elm),
  });
  const scopeAudio = new ScopeAudio();
  const lastAudio = new WeakMap<ScopeRuntime, { trace: ScopeTrace; mode: ScopeAudioMode }>();
  const audioTrace = (scope: ScopeRuntime) => {
    const remembered = scopeAudio.listeningScope === scope ? scopeAudio.listeningTrace : lastAudio.get(scope)?.trace;
    return scope.visibleTraces.find((trace) => trace === remembered
      || (trace.elm === remembered?.elm && trace.value === remembered?.value)) ?? scope.visibleTraces[0];
  };
  const listenTo = (scope: ScopeRuntime, trace: ScopeTrace, mode: ScopeAudioMode) => {
    if (scopeAudio.listeningScope === scope && scopeAudio.listeningTrace === trace && scopeAudio.mode === mode) {
      return;
    }
    lastAudio.set(scope, { trace, mode });
    void scopeAudio.listen(scope, trace, mode, scopes.audioRange(scope, trace), doc.model)
      .catch((error: unknown) => note(`Couldn't play scope audio: ${error instanceof Error ? error.message : String(error)}`, "error"));
  };
  const scopes = new ScopeStrip($<HTMLCanvasElement>("scopes"), doc.model, {
    beginTriggerEdit: () => doc.beginChange(),
    endTriggerEdit: (changed) => { doc.endChange(changed); if (changed) edited(); },
    moveScope: (source, target, edge) => {
      let changed = false;
      doc.edit(() => { changed = doc.model.moveScope(source, target, edge); });
      if (changed) edited();
      return changed;
    },
  }, {
    listeningTrace: (scope) => scopeAudio.listeningScope === scope ? scopeAudio.listeningTrace : null,
    toggle: (scope, tile) => toggleTile(scope, tile),
    panel: scopePanel,
    traceMenu,
  });
  const inspector = new Inspector($("inspector"), doc.model, {
    run: (id) => run(id),
    edit: (change) => {
      doc.edit(change);
      edited();
    },
    beginChange: () => doc.beginChange(),
    endChange: () => {
      doc.endChange(true);
      edited();
    },
    // the blank sheet behind the welcome screen has no name to show
    circuitName: () => docs.length ? doc.circuitTitle ?? doc.name.replace(/\.(txt|xml)$/, "") : "",
    circuitNameProblem: (name) => doc.path || doc.circuitTitle ? "Use Save as to give this circuit another name."
      : validateName(name, { taken: docs.filter((d) => d !== doc).map((d) => d.name) }),
    renameCircuit: (name) => {
      doc.name = name.trim();
      renderTabs();
      refreshTitle();
      note(`Circuit renamed to ${doc.name}.`);
    },
    report: (kind, text) => note(text, kind),
  });
  // the model library: parts' SPICE model choices follow it
  modelLibrary.onChange(() => {
    for (const d of docs) d.model.toleranceChanged();
    inspector.refreshProperties(true);
  });
  void modelLibrary.load();
  // debugging handle for the browser console
  Object.assign(window, {
    nodeforgeDebug: {
      get doc() { return doc; }, docs, canvas, run: (id: string) => run(id),
      open: (text: string, name?: string) => openDocument(new CircuitDocument(text, { name })),
    },
  });

  /** Show a document: canvas, inspector, scopes, title. */
  function activate(d: CircuitDocument): void {
    if (d !== doc) doc.model.pauseClock();
    scopeAudio.stop();
    doc = d;
    // element geometry snaps to the circuit's grid while it's edited
    engineGrid.size = gridSize(d.model);
    canvas.setDocument(d);
    scopes.setModel(d.model);
    inspector.setModel(d.model);
    renderTabs();
    refreshEmptyState();
    refreshTitle();
    messages.setLog(d.messages);
    watchConditions(d);
    refreshMenus();
    refreshStatus(true);
  }

  function openDocument(d: CircuitDocument, replaceBlank = true): void {
    // an opened circuit replaces an untouched empty tab rather than sitting next to it
    insertDocument(docs, doc, d, replaceBlank && doc.isBlank);
    activate(d);
    // a newly opened circuit starts on the terminal, with no command history
    selectTab("terminal");
    terminal?.clearHistory();
    if (d.model.loadError) return note(`Couldn't read the circuit: ${d.model.loadError}`, "error", d);
    // every warning goes to the log; the status bar shows the first
    const warnings = d.model.circuit.warnings;
    for (const w of warnings) d.messages.add("warning", w);
    if (warnings.length) flash(warnings.length === 1 ? warnings[0] : `${warnings[0]} ${warnings.length - 1} more in Messages.`);
    watchConditions(d);
  }

  function openFiles(files: OpenedFile[]): void {
    for (const file of files) rememberFile(file.path);
    openDocumentFiles(docs, files, activate,
      (f) => new CircuitDocument(f.text, { path: f.path, title: library.titles.get(f.path.split(/[\\/]/).pop()!) ?? null }),
      openDocument);
  }

  /**
   * Whether a circuit has work to lose, the circuit form of the shell's `hasUnsavedWork`: a saved file while it is
   * dirty, an untitled one only once it has parts, so an untitled circuit emptied again closes without a question.
   */
  function hasWork(target: CircuitDocument): boolean {
    return target.dirty && !!(target.path || target.model.circuit.elements.length);
  }

  /** Close a tab, offering to save its changes first. The last tab can close too: the window then shows an empty state. */
  async function closeDocument(d: CircuitDocument): Promise<void> {
    await closeDocumentTab({
      documents: docs, active: doc, closing: d,
      needsPrompt: hasWork,
      askToSave, save: (target) => save(false, target), activate,
      dispose: (target) => {
        target.model.pauseClock();
        target.model.clearScopes();
        autosave.forget(target);
        forgetDraft(target);
      },
      emptyDocument: () => CircuitDocument.empty(), renderTabs, afterClose: refreshEdited,
    });
  }

  /** No tabs open: New / Open in place of the schematic; the terminal stays usable, the inspector greys out. */
  const emptyState = createEmptyState($("center"), {
    ...forgeApp.document.welcome,
    newShortcut: shortcutText("CmdOrCtrl+N"),
    openShortcut: shortcutText("CmdOrCtrl+O"),
    onNew: () => { void run("file.new"); },
    onOpen: () => { void run("file.open"); },
  });
  function refreshEmptyState(): void {
    const none = docs.length === 0;
    document.body.classList.toggle("no-docs", none);
    $("inspector").inert = none;
    if (none) {
      canvas.setTool({ kind: "select" });
      selectTab("terminal");
    }
    emptyState.hidden = !none;
  }

  /** After an edit: tab marks, title, menus. */
  function edited(): void {
    autosave.edited(doc);
    keepDraft(doc);
    inspector.refreshProperties(true);
    renderTabs();
    refreshTitle();
    refreshMenus();
    refreshEdited();
  }

  // the window closing (or ⌘Q) with unsaved circuits: save the chosen ones, discard, or stay
  const host = desktop;
  if (host) host.onCloseRequest(() => { void confirmWindowClose({
    documents: docs, askToSaveAll, activate, hasWork,
    save: (document) => save(false, document),
    closeWindow: () => host.closeWindow(),
    closeCancelled: () => host.closeCancelled(),
  }); });

  const refreshEdited = () => desktop?.setEdited(docs.some((d) => d.dirty));

  function refreshTitle(): void {
    document.title = documentWindowTitle(forgeApp.identity.name, docs.length ? doc : undefined);
    // The circuit name and dirty mark belong to the document tab, not the window chrome.
    desktop?.setTitle(forgeApp.identity.name);
  }


  const documentTabs = new DocumentTabs<CircuitDocument>($("doc-tabs"), {
    newTitle: `${forgeApp.document.tabs.newTitle} (${shortcutText("CmdOrCtrl+N")})`,
    closeTitle: `${forgeApp.document.tabs.closeTitle} (${shortcutText("CmdOrCtrl+W")})`,
    onNew: () => { void run("file.new"); },
    onActivate: activate,
    onClose: (document) => { void closeDocument(document); },
    // drag a tab to rearrange the tabs (the tabs and tab commands number them in this order)
    onReorder: (from, to) => {
      docs.splice(0, docs.length, ...moveItem(docs, from, to));
      renderTabs();
    },
  });
  function renderTabs(): void { documentTabs.render(docs, doc); }

  let clipboard: string | null = null;
  // A field where text is typed, and whether something was typed in it since it took focus or was
  // last committed (Enter, leaving it, a console command run): only then do undo and redo act on its
  // text; otherwise on the circuit (a checkbox just ticked, the console prompt after a command)
  const { isTextEntry, typingInField } = createTextInputState();
  const grid = () => gridSize(doc.model);
  const sel = () => doc.model.selection;

  async function run(id: string, fromConsole = false): Promise<void> {
    if (id.startsWith("file.recent.")) return openRecent(id.slice(12));
    if (id.startsWith("file.autosave.")) {
      const choice = parseAutosave(id.slice(14));
      if (choice) updateSettings({ autosave: choice });
      return;
    }
    const consoleSelection = window.getSelection();
    if ((id === "edit.copy" || id === "edit.cut") && consoleSelection && !consoleSelection.isCollapsed && $("terminal-pane").contains(consoleSelection.anchorNode)) {
      document.execCommand("copy");
      return;
    }
    if (!fromConsole && (id === "view.zoomIn" || id === "view.zoomOut") && $("terminal-pane").contains(document.activeElement)) {
      terminal?.zoom(id === "view.zoomIn" ? 1 : -1);
      return;
    }
    // no tabs: only commands that open a circuit or change app options
    if (!docs.length && !availableWithoutDocument(id)) return;
    if (id === "app.settings") {
      showSettings({ pages: settingsPages() });
      return;
    }
    if (id.startsWith("temperature.")) {
      updateSettings({ temperatureUnit: id.slice(12) as Settings["temperatureUnit"] });
      if (docs.length) inspector.setModel(doc.model);
      return;
    }
    if (id === "symbols.us" || id === "symbols.iec") {
      updateSettings({ symbolStyle: id.slice(8) as Settings["symbolStyle"] });
      return;
    }
    if (id === "view.inspector") return updateSettings({ showInspector: !settings.showInspector });
    if (id === "view.bottomPanel") return updateSettings({ showBottomPanel: !settings.showBottomPanel });
    if (id.startsWith("toggle.")) {
      const key = id.slice(7) as keyof Settings;
      if (key === "backgroundAnalysis") return setBackgroundAnalysis(!settings.backgroundAnalysis);
      updateSettings({ [key]: !settings[key] } as Partial<Settings>);
      if (key === "showValues") doc.model.labelLayout = null;
      return;
    }
    if (id === "current.electron") return updateSettings({ conventionalCurrent: !settings.conventionalCurrent });
    if (id === "current.steadyArrows") return updateSettings({ currentSteadyArrows: !settings.currentSteadyArrows });
    if (id === "current.steadyBand") return updateSettings({ currentSteadyBand: !settings.currentSteadyBand });
    if (id.startsWith("current.shape.")) {
      const shape = currentShape(id.slice("current.shape.".length));
      if (shape) updateSettings({ currentShape: shape });
      return;
    }
    if (id === "appearance.light" || id === "appearance.dark") {
      updateSettings({ appearance: id.slice(11) as Settings["appearance"] });
      return;
    }
    if (id === "solver.nodeforge" || id === "solver.circuitjs") {
      updateSettings({ solver: id === "solver.nodeforge" ? "nodeforge" : "circuitjs" });
      inspector.setModel(doc.model);
      return;
    }
    // menu items the console does: run there, where the result (or why not) shows
    const consoleLine = { "file.exportNfg": "export nfg", "file.exportXml": "export xml", "file.exportText": "export txt", "file.exportSpice": "export spice", "sim.power": "power" }[id];
    if (consoleLine) {
      selectTab("terminal");
      await showTerminal();
      await terminal?.run(consoleLine);
      return;
    }
    if (id.startsWith("circuit:")) return openLibraryCircuit(id.slice(8));
    if (id.startsWith("tool:")) {
      const name = id.slice(5);
      const cls = classForName(name) ?? (name.startsWith("CustomCompositeElm:") ? CustomCompositeElm : undefined);
      if (!cls) return note(`${drawNames.get(name) ?? name}: unsupported component`, "error");
      canvas.setTool({ kind: "place", cls, className: name });
      return;
    }
    // focus in the terminal's text (not its prompt): select all and paste stay with the terminal
    const terminalPane = $("terminal-pane");
    if (!fromConsole && /^edit\.(selectAll|paste)$/.test(id) && terminalPane.contains(document.activeElement)) {
      const prompt = terminalPane.querySelector("input");
      if (id === "edit.paste") {
        if (prompt && !prompt.readOnly) { prompt.focus(); document.execCommand("paste"); }
      } else {
        // the prompt's text while one is typed there, otherwise the transcript, also while a command runs
        terminal?.selectAll();
      }
      return;
    }
    // text fields keep the usual editing keys: undo and redo while typing in one, cut, copy, paste
    // and select all whenever one has the focus
    if (!fromConsole && ((/^edit\.(undo|redo)$/.test(id) && typingInField()) || (isTextEntry(document.activeElement) && /^edit\.(cut|copy|paste|selectAll)$/.test(id)))) {
      document.execCommand(id === "edit.selectAll" ? "selectAll" : id.slice(5));
      return;
    }
    if (await dispatchShellAction(id, {
      documents: () => docs,
      activeDocument: () => doc,
      activate,
      createDocument: () => openDocument(CircuitDocument.empty(docs), false),
      newWindow: () => { desktop?.newWindow(); },
      open: openFile,
      save: (as) => save(as),
      close: closeDocument,
      showAbout: () => showAbout(info),
      showWhatsNew: () => { void showWhatsNew(info); },
      showShortcuts: () => showShortcuts(info, shortcutGroups(nodeforgeRuntime.menus.build(draw, library, !!desktop, menuState()))),
      showLicenses: () => { void showLicenses(info); },
    })) {
      refreshStatus(true);
      return;
    }
    const m = doc.model;
    switch (id) {
      case "edit.undo":
        canvas.cancelGesture();
        doc.undo();
        edited();
        inspector.setModel(doc.model);
        break;
      case "edit.redo":
        canvas.cancelGesture();
        doc.redo();
        edited();
        inspector.setModel(doc.model);
        break;
      case "edit.copy":
      case "edit.cut": {
        const text = copySelection(m);
        if (!text) break;
        clipboard = text;
        navigator.clipboard?.writeText(text).catch(() => {});
        if (id === "edit.cut") {
          doc.edit(() => deleteSelection(m));
          edited();
        }
        break;
      }
      case "edit.paste": {
        let text = clipboard;
        try {
          const sys = await navigator.clipboard?.readText();
          if (sys && /^\s*(\$|<cir|[a-zA-Z0-9]+ -?\d+ -?\d+ -?\d+ -?\d+ -?\d+)/.test(sys)) text = sys;
        } catch {
          // no permission: use our own clipboard
        }
        if (!text) break;
        const [dx, dy] = pasteOffset(text, canvas.mouseWorld, grid());
        doc.edit(() => pasteText(m, text!, dx, dy));
        canvas.setTool({ kind: "select" });
        edited();
        break;
      }
      case "edit.duplicate": {
        const text = copySelection(m);
        if (!text) break;
        doc.edit(() => pasteText(m, text, grid() * 2, grid() * 2));
        edited();
        break;
      }
      case "edit.delete":
        if (!sel().size) break;
        doc.edit(() => deleteSelection(m));
        edited();
        break;
      case "edit.selectAll":
        sel().clear();
        for (const e of m.circuit.elements) sel().add(e);
        refreshStatus(true);
        refreshMenus();
        break;
      case "edit.rotateCW":
      case "edit.rotateCCW":
        if (!sel().size) break;
        doc.edit(() => rotateSelection(m, id === "edit.rotateCW", grid()));
        edited();
        break;
      case "edit.flipH":
      case "edit.flipV":
        if (!sel().size) break;
        doc.edit(() => flipSelection(m, id === "edit.flipH", grid()));
        edited();
        break;
      case "edit.properties":
        if (m.selected) {
          updateSettings({ showInspector: true });
          inspector.focusProperties();
        }
        break;
      case "tool.select":
        canvas.setTool({ kind: "select" });
        break;
      // sweep scopes follow the circuit: Run and Reset run their sweeps again
      case "sim.toggle":
        m.running = !m.running;
        if (m.running) m.rerunSweeps();
        break;
      case "sim.start": m.running = true; m.rerunSweeps(); break;
      case "sim.pause": m.running = false; break;
      case "sim.step":
        if (!m.running) m.step();
        break;
      case "sim.reset":
        m.reset();
        m.rerunSweeps();
        break;
      case "sim.recommend":
        await recommend();
        break;
      case "models.library":
        openModelLibrary();
        break;
      case "sim.operatingPoint": {
        let method: string | null = null;
        doc.edit(() => (method = m.findOperatingPoint()));
        edited();
        if (method) note(`DC operating point found${method === "newton" ? "" : ` (${method})`}. Simulation time reset to 0.`);
        else note("No DC operating point found. The circuit may not have a stable equilibrium.", "warning");
        break;
      }
      case "view.zoomIn":
        canvas.zoom(1.25);
        break;
      case "view.zoomOut":
        canvas.zoom(0.8);
        break;
      case "view.fit":
        canvas.zoomToFit();
        break;
      case "view.actualSize":
        canvas.zoomTo(1);
        break;
      case "scope.add":
        if (m.selected) addScope(m.selected);
        break;
      case "scopes.clear":
        doc.edit(() => m.clearScopes()); edited();
        break;
      case "scopes.stack":
        doc.edit(() => m.stackScopes()); edited();
        break;
      case "scopes.unstack":
        doc.edit(() => m.unstackScopes()); edited();
        break;
      case "scopes.combine":
        doc.edit(() => m.combineScopes()); edited();
        break;
      case "scopes.separate":
        doc.edit(() => m.separateScopes()); edited();
        break;
    }
    refreshStatus(true);
  }

  async function openLibraryCircuit(file: string): Promise<void> {
    try {
      const text = await loadText(`circuits/${file}`);
      openDocument(new CircuitDocument(text, { name: file, title: library.titles.get(file) ?? null, sample: true }));
    } catch (err) {
      note((err as Error).message, "error");
    }
  }

  /** Remember a circuit file in File › Open recent and the system's recent documents. */
  function rememberFile(path: string | null): void {
    if (!desktop || !path) return;
    recent.add(path);
    desktop.addRecentDocument(path);
    refreshMenus(true);
  }

  async function openRecent(which: string): Promise<void> {
    if (which === "clear") {
      recent.clear();
      refreshMenus(true);
      return;
    }
    const path = recent.list()[Number(which)];
    if (!desktop || !path) return;
    try {
      openFiles([await desktop.openCircuit(path)]);
    } catch {
      recent.remove(path);
      refreshMenus(true);
      note(`Couldn't open ${path.split(/[\\/]/).pop()}. It was moved or deleted.`, "error");
    }
  }

  async function openFile(): Promise<void> {
    if (desktop) return openFiles(await desktop.openFileDialog());
    openBrowserFiles(".nfg,.txt,.xml,.circuitjs,text/plain,application/json", async (file) => {
      openDocument(new CircuitDocument(await file.text(), { name: file.name, title: library.titles.get(file.name) ?? null }));
    });
  }

  /** Circuit files are saved as .nfg; CircuitJS XML and text are exports. */
  const withoutCircuitExtension = (name: string) => name.replace(/\.(nfg|txt|xml|circuitjs)$/i, "");

  /** What an .nfg file says about itself, brought up to date as it is saved. */
  function stampMeta(d: CircuitDocument): void {
    const old = d.model.circuit.meta;
    const now = new Date().toISOString();
    const { title, description, author, created, modified: _modified, app: _app, ...rest } = old;
    const kept = title ?? d.circuitTitle;
    d.model.circuit.meta = {
      ...(kept ? { title: kept } : {}), ...(description !== undefined ? { description } : {}), ...(author !== undefined ? { author } : {}),
      created: created ?? now, modified: now, app: `${forgeApp.identity.name} ${VERSION}`, ...rest,
    };
  }

  /**
   * Save a tab as an .nfg file (as a new file when `as`, when it has none, or when it was opened
   * from a CircuitJS file: that file is left as it is). Returns false if cancelled or failed.
   */
  async function save(as: boolean, d = doc, suggestedName?: string, quiet = false): Promise<boolean> {
    const saved = await saveDocument({
      document: d, as, suggestedName, extension: "nfg", mimeType: "application/json",
      stripExtension: withoutCircuitExtension,
      beforeSave: () => canvas.cancelGesture(),
      prepare: stampMeta,
      serialize: (target) => target.model.serialize("nfg"),
      nativeFormat: "nfg",
      unsupportedMessage: "This circuit has parts that only CircuitJS text can keep. Export it with export txt.",
      // an autosave reports only a failure
      report: (message, kind, target) => { if (!quiet || kind !== "info") note(message, kind, target); },
      afterSave: edited,
      desktop,
    });
    if (saved) {
      rememberFile(d.path);
      autosave.forget(d);
      recovery.clear(draftKey(d));
    }
    return saved;
  }

  /**
   * Autosave (desktop): a circuit that has an .nfg file is saved a while after its last edit, or when the window loses
   * focus. An untitled circuit, or one opened from a CircuitJS file, is left to Save and to recovery.
   */
  const autosave = createAutosave<CircuitDocument>({
    choice: () => settings.autosave,
    canSave: (d) => !!desktop && docs.includes(d) && d.dirty && !!d.path && /\.nfg$/i.test(d.path),
    save: (d) => save(false, d, undefined, true),
  });
  window.addEventListener("blur", () => autosave.blurred(docs));

  /**
   * Recovery: while a circuit has unsaved edits, its text is kept in local storage a moment after each edit. Closing
   * the window (after saving or discarding) clears this window's drafts; after a crash they are offered at the next
   * launch. Windows share the storage, so each marks itself live and drafts of a live window are never offered.
   */
  const recovery = createRecovery(`${forgeApp.identity.id}.recovery`);
  const liveKey = `${forgeApp.identity.id}.recovery.live`;
  const session = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const LIVE_MS = 15000, DRAFT_DELAY_MS = 2000;
  const draftKey = (d: CircuitDocument) => `${session}:${d.id}`;
  const draftTimers = new Map<CircuitDocument, ReturnType<typeof setTimeout>>();
  function liveSessions(): Record<string, number> {
    try {
      const stored = JSON.parse(localStorage.getItem(liveKey) ?? "{}") as Record<string, number>;
      return stored && typeof stored === "object" ? stored : {};
    } catch {
      return {};
    }
  }
  function markLive(alive: boolean): void {
    const now = Date.now();
    const sessions = Object.fromEntries(Object.entries(liveSessions()).filter(([id, at]) => id !== session && now - at < LIVE_MS));
    if (alive) sessions[session] = now;
    try { localStorage.setItem(liveKey, JSON.stringify(sessions)); } catch { /* storage unavailable: nothing is offered */ }
  }
  markLive(true);
  setInterval(() => markLive(true), LIVE_MS / 3);
  function keepDraft(d: CircuitDocument): void {
    clearTimeout(draftTimers.get(d));
    draftTimers.set(d, setTimeout(() => {
      draftTimers.delete(d);
      if (!docs.includes(d)) return;
      if (!hasWork(d)) return recovery.clear(draftKey(d));
      recovery.keep({ key: draftKey(d), name: d.name, path: d.path, text: d.model.serialize("nfg").text });
    }, DRAFT_DELAY_MS));
  }
  function forgetDraft(d: CircuitDocument): void {
    clearTimeout(draftTimers.get(d));
    draftTimers.delete(d);
    recovery.clear(draftKey(d));
  }
  window.addEventListener("pagehide", () => {
    for (const d of docs) forgetDraft(d);
    markLive(false);
  });
  async function offerRecovery(): Promise<void> {
    const live = liveSessions(), now = Date.now();
    const drafts = recovery.list().filter((draft) => {
      const owner = draft.key.split(":")[0];
      return owner !== session && !(owner in live && now - live[owner] < LIVE_MS);
    });
    if (!drafts.length) return;
    const chosen = await askToRecover(drafts, forgeApp.identity.name);
    if (!chosen) return;
    for (const draft of drafts) recovery.clear(draft.key);
    for (const draft of drafts.filter((item) => chosen.includes(item.key))) {
      const d = new CircuitDocument(draft.text, { path: draft.path, name: draft.name });
      d.dirty = true;
      openDocument(d);
      keepDraft(d);
    }
    edited();
  }


  /**
   * Recommended settings come from a background analysis (a worker runs the circuit). With
   * background analysis on, a circuit that has sat unedited for a moment is analyzed on its own.
   * With it off, the button or menu action analyzes on demand (still in the background).
   */
  const IDLE_BEFORE_ANALYSIS_MS = 1500;
  const analyzer = new Analyzer();
  /** Latest result per tab, for the version of the circuit it was worked out for. */
  const analyses = new WeakMap<CircuitDocument, { key: string; result?: Recommendation; error?: string }>();
  /** The analysis being run: which tab and version. */
  let analysisJob: { doc: CircuitDocument; key: string; automatic: boolean } | null = null;
  /** When the active tab's circuit last changed (for "left unedited for a moment"). */
  let lastSeen: { doc: CircuitDocument; key: string; at: number } | null = null;

  /** What an analysis depends on: the circuit's version and its tolerance settings. */
  function analysisKey(d: CircuitDocument): string {
    const t = d.model.tolerance;
    return `${d.revision}|${t.enabled ? t.seed : "ideal"}|${settings.solver}:${settings.relTol}`;
  }

  function analysisInput(m: SimulationModel): AnalysisInput {
    const t = m.tolerance;
    return {
      text: m.serialize(m.circuit.format === "nfg" ? "xml" : m.circuit.format).text,
      names: m.circuit.elements.map((e, i) => m.designator(e) ?? `#${i}`),
      tolerance: t.enabled ? { seed: t.seed, perElement: m.circuit.elements.map((e) => (e.tolerance ? { ...e.tolerance } : null)) } : null,
      timeStep: m.sim.maxTimeStep,
      sourceFrequency: m.fastestSource()?.frequency ?? 0,
      accurate: settings.solver === "nodeforge",
      relTol: settings.relTol,
      minSpeed: MIN_SPEED_RATIO,
      maxSpeed: MAX_SPEED_RATIO,
    };
  }

  /** Analyze a tab's circuit in the background and remember the result. */
  async function analyze(d: CircuitDocument, automatic = false): Promise<void> {
    const key = analysisKey(d);
    analysisJob = { doc: d, key, automatic };
    try {
      analyses.set(d, { key, result: await analyzer.run(analysisInput(d.model)) });
    } catch (err) {
      if ((err as Error).message === "cancelled") return;
      analyses.set(d, { key, error: (err as Error).message });
    } finally {
      if (analysisJob?.doc === d && analysisJob.key === key) analysisJob = null;
    }
    refreshRecommend();
  }

  /** Start or cancel background analysis and reflect its state on the recommendation button. */
  function refreshRecommend(): void {
    if (!docs.length) return;
    const d = doc, key = analysisKey(d), now = performance.now();
    if (!lastSeen || lastSeen.doc !== d || lastSeen.key !== key) lastSeen = { doc: d, key, at: now };
    // an analysis of a version that's gone (or another tab) is no use any more
    if (analysisJob && (analysisJob.doc !== d || analysisJob.key !== key || (!settings.backgroundAnalysis && analysisJob.automatic))) {
      analyzer.cancel();
      analysisJob = null;
    }
    const empty = !d.model.circuit.simulatedElements.length;
    const ready = analyses.get(d)?.key === key;
    if (settings.backgroundAnalysis && !empty && !ready && !analysisJob && now - lastSeen.at >= IDLE_BEFORE_ANALYSIS_MS) void analyze(d, true);
    inspector.setRecommendState(
      empty ? "empty" : analysisJob ? "analyzing" : ready || !settings.backgroundAnalysis ? "ready" : "waiting",
    );
  }
  setInterval(refreshRecommend, 250);

  function setBackgroundAnalysis(enabled: boolean): void {
    updateSettings({ backgroundAnalysis: enabled });
    refreshRecommend();
  }

  /** Show the recommended settings for the active tab (analyzing first if needed) and offer to apply them. */
  async function recommend(): Promise<void> {
    const d = doc, m = d.model;
    if (!m.circuit.simulatedElements.length) return note("Add components to run the simulation.");
    const key = analysisKey(d);
    if (analyses.get(d)?.key !== key) {
      if (!analysisJob) void analyze(d);
      refreshRecommend();
      while (analysisJob) await new Promise((r) => setTimeout(r, 100));
    }
    const a = analyses.get(d);
    if (d !== doc || a?.key !== analysisKey(d)) return;
    if (!a.result) return note(`Analysis failed: ${a.error}`, "error", d);
    const rec = a.result;
    const plotWidth = Math.max(100, $("scopes").clientWidth / Math.max(1, m.scopes.length) - 64);
    // scopes sample on whole timesteps: aim for the span, show the scale they'll really get
    const scopeSample = rec.scopeSpan !== null && m.scopes.length ? Math.max(1, Math.round(rec.scopeSpan / plotWidth / rec.timeStep)) * rec.timeStep : null;
    const pct = (x: number) => `${+(x * 100).toPrecision(2)}%`;
    const changes: [string, string, string][] = [
      [settings.solver === "nodeforge" ? "Maximum time step" : "Time step", si(m.sim.maxTimeStep, "s", true), si(rec.timeStep, "s", true)],
      ["Speed", timesRealTime(m.speedRatio), timesRealTime(rec.speedRatio)],
    ];
    if (rec.relTol !== null) changes.push(["Relative tolerance (app setting)", pct(settings.relTol), pct(rec.relTol)]);
    if (scopeSample !== null) {
      const perDiv = (sample: number) => `${si((sample * plotWidth) / 10, "s", true)}/div`;
      changes.push(["Scopes", perDiv(m.scopes[0].speed * m.sim.maxTimeStep), perDiv(scopeSample)]);
    }
    if (!(await askToApply("Recommended settings", rec.findings, changes)) || d !== doc) return;
    applyRecommendation(d, rec);
  }

  function applyRecommendation(d: CircuitDocument, rec: Recommendation): void {
    const m = d.model;
    const plotWidth = Math.max(100, $("scopes").clientWidth / Math.max(1, m.scopes.length) - 64);
    const scopeSample = rec.scopeSpan !== null && m.scopes.length ? Math.max(1, Math.round(rec.scopeSpan / plotWidth / rec.timeStep)) * rec.timeStep : null;
    if (rec.relTol !== null && rec.relTol !== settings.relTol) updateSettings({ relTol: rec.relTol });
    d.edit(() => {
      m.setTimeStep(rec.timeStep);
      m.speedRatio = rec.speedRatio;
      if (scopeSample !== null) for (const s of m.scopes) s.setSpeed(scopeSample / rec.timeStep, m.sim.t);
    });
    inspector.setModel(m);
    edited();
    refreshRecommend();
  }


  function addScope(elm: CircuitElm): void {
    let s: ScopeRuntime | null = null;
    doc.edit(() => { s = doc.model.addScope(elm); });
    edited();
    if (!s) return;
    updateSettings({ showBottomPanel: true });
    selectTab("scopes");
  }

  function partMenu(x: number, y: number, elm: CircuitElm | null): void {
    const m = doc.model;
    const k = (key: string) => displayKey(key);
    // a menu command's label and key, as the menus show them
    const entry = (id: string) => { const { label, key, hint } = menuCommand(id); return { label, key: key ? k(key) : hint ? k(hint) : undefined }; };
    if (!elm) {
      showContextMenu(x, y, [
        { ...entry("edit.paste"), action: () => run("edit.paste") },
        { ...entry("edit.selectAll"), action: () => run("edit.selectAll") },
        { separator: true, label: "" },
        { ...entry("view.fit"), action: () => run("view.fit") },
      ]);
      return;
    }
    const many = m.selection.size > 1;
    // a scope on the sheet: its scope settings
    const sheet = !many && elm instanceof ScopeElm ? m.sheetScopes.get(elm) : undefined;
    if (sheet) return scopeMenu(x, y, sheet, elm as ScopeElm);
    const items: MenuEntry[] = [
      { label: many ? `${m.selection.size} parts selected` : [m.designator(elm), m.kindName(elm)].filter(Boolean).join("  "), header: true },
    ];
    if (!many) {
      items.push({ label: "Properties", action: () => run("edit.properties") });
      if (elm instanceof SwitchElm) items.push({ label: "Toggle switch", action: () => { doc.edit(() => doc.model.toggle(elm)); edited(); } });
      items.push({ label: "View in scope", action: elm.isPlaceholder() ? undefined : () => addScope(elm) });
      // a source: a DC sweep of it, as a command to edit (range, step, what to plot)
      if (elm instanceof VoltageElm || elm instanceof CurrentElm) {
        const name = m.designator(elm);
        if (name) items.push({ label: "DC sweep…", action: () => {
          const now = elm instanceof VoltageElm ? elm.maxVoltage + elm.bias : elm.currentValue;
          const hi = now ? Math.abs(now) * 2 : 10, unit = elm instanceof VoltageElm ? "" : "A";
          selectTab("terminal");
          void showTerminal().then(() => terminal?.prefill(`dcsweep ${name} 0 ${si(hi, unit)} ${si(hi / 100, unit)} I(${name})`));
        } });
        if (name) items.push({ label: "AC sweep…", action: () => {
          selectTab("terminal");
          void showTerminal().then(() => terminal?.prefill(`ac ${name} 10 1Meg V(${name})`));
        } });
      }
      m.scopes.forEach((s, i) => items.push({ label: `Add to scope ${i + 1}`, action: elm.isPlaceholder() ? undefined : () => { doc.edit(() => m.addToScope(s, elm)); edited(); } }));
    }
    items.push(
      { separator: true, label: "" },
      { ...entry("edit.cut"), action: () => run("edit.cut") },
      { ...entry("edit.copy"), action: () => run("edit.copy") },
      { ...entry("edit.duplicate"), action: () => run("edit.duplicate") },
      { ...entry("edit.delete"), action: () => run("edit.delete") },
      { separator: true, label: "" },
      { ...entry("edit.rotateCW"), action: () => run("edit.rotateCW") },
      { ...entry("edit.rotateCCW"), action: () => run("edit.rotateCCW") },
      { label: "Flip horizontal", action: () => run("edit.flipH") },
      { label: "Flip vertical", action: () => run("edit.flipV") },
    );
    showContextMenu(x, y, items);
  }

  /** Put a docked scope on the sheet, right of the circuit (an edit: it can be undone). */
  function undockScope(s: ScopeRuntime): void {
    const m = doc.model, els = m.circuit.elements;
    const g = 16;
    const xs = els.flatMap((e) => [e.x, e.x2]), ys = els.flatMap((e) => [e.y, e.y2]);
    const x = xs.length ? Math.ceil((Math.max(...xs) + 3 * g) / g) * g : 0, y = ys.length ? Math.floor(Math.min(...ys) / g) * g : 0;
    let elm: ScopeElm | null = null;
    doc.edit(() => (elm = m.undockScope(s, x, y, 24 * g, 14 * g)));
    if (elm) {
      m.selection.clear();
      m.selection.add(elm);
      run("view.fit");
    }
  }

  function audioItems(s: ScopeRuntime): MenuEntry[] {
    const active = scopeAudio.listeningScope === s;
    const selected = audioTrace(s);
    const mode = (label: string, mode: ScopeAudioMode, title: string): MenuEntry => ({
      label, title, checked: active && scopeAudio.mode === mode,
      action: selected ? () => listenTo(s, selected, mode) : undefined,
    });
    return [
      { label: "Off", checked: !active, action: () => {
        if (scopeAudio.listeningScope === s) scopeAudio.stop();
      } },
      mode("Map value to pitch", "graph", "Higher values produce higher pitches. Uses the initial scope scale. Pausing silences audio."),
      mode("Play operating waveform", "signal", "Play the selected waveform at simulation speed. Slower simulation lowers pitch. DC is silent. Pausing silences playback."),
      ...(s.visibleTraces.length ? [{ separator: true, label: "" } as MenuEntry] : []),
      ...s.visibleTraces.map((trace): MenuEntry => ({
        label: `On ${scopes.traceLabel(s, trace)}`, checked: trace === selected,
        action: () => {
          if (scopeAudio.listeningScope === s) listenTo(s, trace, scopeAudio.mode);
          else lastAudio.set(s, { trace, mode: lastAudio.get(s)?.mode ?? "signal" });
        },
      })),
      ...(s.visibleTraces.length ? [{ separator: true, label: "" } as MenuEntry] : []),
      mode("Listen at real-time speed", "realtime", "Repeat a recent waveform segment at its original pitch, regardless of simulation speed. Audio starts after enough circuit time is recorded. Pausing silences playback."),
    ];
  }

  /**
   * Scope settings follow one system. Header tiles are on/off switches (sound, Trigger or dB, Auto),
   * coloured when on; a right-click on one opens its options. The label beside them (time/div, FFT,
   * X-Y) opens the plot type. The right-click menu has everything: what's plotted, the plot type,
   * the tiles' settings in their order, measurements, time and navigation, then layout.
   */
  const scopeEdit = (change: () => void) => { doc.edit(change); edited(); };
  /** The edge a trigger switched off had, so switching it back on restores it (session only). */
  const lastEdge = new WeakMap<ScopeRuntime, number>();

  function setPlot(s: ScopeRuntime, type: "time" | "xy" | "fft"): void {
    if (type === "xy" && s.visibleTraces.length < 2) return;
    scopeEdit(preparePlot(s, type));
  }

  function toggleTile(s: ScopeRuntime, tile: ScopeTile): void {
    const tr = s.view.trigger;
    switch (tile) {
      case "auto":
        if (s.has(ScopeFlag.fft)) return scopes.setFFTAuto(s, !!(s.view.fftX || s.view.fftY));
        return s.isXY ? scopes.setXYAuto(s, !s.xyAuto) : scopes.setAutoY(s, !s.view.autoY);
      case "db": return scopeEdit(() => s.toggle(ScopeFlag.logSpectrum));
      case "trigger": return triggerEdit(() => {
        if (tr.edge) { lastEdge.set(s, tr.edge); tr.edge = 0; } else tr.edge = lastEdge.get(s) ?? 1;
      });
      case "audio": {
        if (scopeAudio.listeningScope === s) { scopeAudio.stop(); return; }
        const trace = audioTrace(s);
        if (trace) listenTo(s, trace, lastAudio.get(s)?.mode ?? "signal");
      }
    }
  }

  /**
   * Measurements by group, then where they're taken: whole cycles or not, and between cursors A
   * and B when both are placed (a click on the plot places them).
   */
  function measureItems(s: ScopeRuntime): MenuEntry[] {
    const items: MenuEntry[] = [];
    for (const group of ["Level", "Timing", "Power"] as const) {
      items.push(...(items.length ? [{ separator: true, label: "" } as MenuEntry] : []), { label: group, header: true });
      for (const def of MEASURES.filter((d) => d.group === group)) {
        const on = measureOn(s, def.key);
        items.push({ label: def.name, checked: on, action: () => scopeEdit(() => setMeasure(s, def.key, !on)) });
      }
    }
    const cycles = s.measures.has(WHOLE_CYCLES);
    items.push(
      { separator: true, label: "" },
      { label: "Over whole cycles", checked: cycles, title: "From the first to the last rising crossing in the window, so a part-cycle at either end doesn't bias averages and energy.",
        action: () => scopeEdit(() => { if (cycles) s.measures.delete(WHOLE_CYCLES); else s.measures.add(WHOLE_CYCLES); }) },
      { label: s.view.cursors.length === 2 ? "Between cursors A and B" : "Click the plot twice to measure between cursors", checked: s.view.cursors.length === 2 },
    );
    return items;
  }

  const triggerEdit = (change: () => void) => { doc.edit(change); edited(); };

  /** Trigger options: Off, the edge, its trace (when there's a choice) and its level. */
  function triggerItems(s: ScopeRuntime): MenuEntry[] {
    const tr = s.view.trigger;
    const edge = (label: string, e: number): MenuEntry => ({ label, checked: tr.edge === e, action: () => triggerEdit(() => { tr.edge = e; }) });
    const traceOf = s.traces[tr.trace];
    return [
      edge("Off", 0),
      edge("Rising edge", 1),
      edge("Falling edge", -1),
      ...(s.visibleTraces.length > 1 ? [{ separator: true, label: "" } as MenuEntry, ...s.visibleTraces.map((t): MenuEntry => {
        const k = s.traces.indexOf(t);
        return { label: `On ${scopes.traceLabel(s, t)}`, checked: traceOf === t || (!s.visibleTraces.includes(traceOf) && t === s.visibleTraces[0]), action: () => triggerEdit(() => { tr.trace = k; tr.level = null; }) };
      })] : []),
      { separator: true, label: "" },
      { label: "Level: midpoint", checked: tr.level === null, action: () => triggerEdit(() => { tr.level = null; }) },
      ...(tr.level !== null ? [{ label: `Level: ${si(tr.level, traceOf?.unit ?? "V", true, 4)}`, checked: true, title: "Set by dragging the marker on the axis." }] : []),
    ];
  }

  /** The vertical scale: Auto, then per unit a step in or out and centring on zero (manual). */
  function scaleItems(s: ScopeRuntime): MenuEntry[] {
    if (s.isXY && !s.has(ScopeFlag.fft)) return xyScaleItems(s);
    const names: Record<string, string> = { V: "Voltage", A: "Current", W: "Power", C: "Charge" };
    const units = [...new Set(s.visibleTraces.map((t) => t.unit))];
    const change = (u: string, edit: (sc: ScopeScale) => void) => () => {
      const sc = scopes.manualScales(s).get(u);
      if (sc) edit(sc);
    };
    return [
      { label: "Auto", checked: s.view.autoY, action: () => scopes.setAutoY(s, !s.view.autoY) },
      ...units.flatMap((u): MenuEntry[] => {
        const sc = s.view.autoY ? undefined : s.view.scales.get(u);
        return [
          { separator: true, label: "" },
          { label: `${names[u] ?? u}${sc ? `  ${si(sc.perDiv, u)}/div` : ""}`, header: true },
          { label: "Zoom in", action: change(u, (x) => { x.perDiv = stepScale(x.perDiv, -1); }) },
          { label: "Zoom out", action: change(u, (x) => { x.perDiv = stepScale(x.perDiv, 1); }) },
          { label: "Center on zero", action: change(u, (x) => { x.center = 0; }) },
        ];
      }),
    ];
  }

  /** X-Y scale: Auto (fit and center the figure), or the origin in the middle, each axis zoomed. */
  function xyScaleItems(s: ScopeRuntime): MenuEntry[] {
    const [tx, ty] = s.visibleTraces;
    const zoom = (axis: "x" | "y", dir: number) => () => {
      if (s.xyAuto) scopes.setXYAuto(s, false);
      const sc = s.xyManual![axis];
      sc.perDiv = stepScale(sc.perDiv, dir);
    };
    const axis = (name: "X" | "Y", t: ScopeTrace | undefined): MenuEntry[] => {
      const sc = s.xyAuto ? undefined : s.xyManual?.[name === "X" ? "x" : "y"];
      return [
        { separator: true, label: "" },
        { label: `${name}${sc && t ? `  ${si(sc.perDiv, t.unit)}/div` : ""}`, header: true },
        { label: "Zoom in", action: zoom(name === "X" ? "x" : "y", -1) },
        { label: "Zoom out", action: zoom(name === "X" ? "x" : "y", 1) },
      ];
    };
    return [
      { label: "Auto", checked: s.xyAuto, title: "Fit and center the figure gathered so far. Off: the origin in the middle.", action: () => scopes.setXYAuto(s, !s.xyAuto) },
      ...axis("X", tx),
      ...axis("Y", ty),
    ];
  }

  function plotItems(s: ScopeRuntime): MenuEntry[] {
    const fft = s.has(ScopeFlag.fft), xy = !fft && s.isXY;
    // V–I: a part's current against its voltage (the first part offering both)
    const viPart = [...new Set(s.traces.filter((t) => !(t instanceof MathTrace)).map((t) => t.elm))]
      .find((e) => quantitiesFor(e).some((q) => q.value === ScopeValue.voltage) && quantitiesFor(e).some((q) => q.value === ScopeValue.current));
    return [
      { label: "Time", checked: !fft && !xy, action: () => setPlot(s, "time") },
      { label: "X-Y", checked: xy, title: "One trace against another (choose them under X-Y axes). Requires two traces.", action: s.visibleTraces.length >= 2 ? () => setPlot(s, "xy") : undefined },
      { label: "V–I curve", title: "A part's current against its voltage, on X-Y.", action: viPart ? () => scopeEdit(() => {
        const m = doc.model;
        for (const [flag, v] of [[ScopeFlag.showVoltage, ScopeValue.voltage], [ScopeFlag.showCurrent, ScopeValue.current]] as const) {
          if (!s.has(flag) || !s.traces.some((t) => t.elm === viPart && t.value === v)) {
            if (!s.has(flag)) s.toggle(flag);
            if (!s.traces.some((t) => t.elm === viPart && t.value === v)) m.addToScope(s, viPart, v);
          }
        }
        s.setXYTrace("x", s.traces.find((t) => t.elm === viPart && t.value === ScopeValue.voltage)!);
        s.setXYTrace("y", s.traces.find((t) => t.elm === viPart && t.value === ScopeValue.current)!);
        if (!s.isXY) s.clearXY();
        s.flags = (s.flags & ~ScopeFlag.fft) | ScopeFlag.plotXY;
      }) : undefined },
      { label: "FFT", checked: fft, action: () => setPlot(s, "fft") },
    ];
  }

  /** A spectrum's options: window, harmonics, logarithmic frequency. */
  function fftItems(s: ScopeRuntime): MenuEntry[] {
    const win = (label: string, w: "hann" | "flattop" | "rect", title: string): MenuEntry => ({ label, title, checked: s.fftWindow === w, action: () => scopeEdit(() => { s.fftWindow = w; }) });
    const option = (label: string, key: string, title?: string): MenuEntry => ({ label, title, checked: s.measures.has(key), action: () => scopeEdit(() => s.setOption(key, !s.measures.has(key))) });
    return [
      { label: "dB", checked: s.has(ScopeFlag.logSpectrum), action: () => toggleTile(s, "db") },
      option("Logarithmic frequency", "logfreq"),
      option("Harmonics and THD", "harmonics", "Mark harmonics 2–10 of the strongest peak; THD in the legend."),
      { separator: true, label: "" },
      { label: "Window", header: true },
      win("Hann", "hann", "Clean, narrow peaks."),
      win("Flat-top", "flattop", "Accurate amplitudes (wider peaks)."),
      win("Rectangular", "rect", "No window: exact for whole periods, leaky otherwise."),
    ];
  }

  /** X-Y's options: which trace on each axis, and the trail. */
  function xyItems(s: ScopeRuntime): MenuEntry[] {
    const axes = s.xyTraces;
    const pick = (axis: "x" | "y"): MenuEntry[] => s.visibleTraces.map((t) => ({
      label: scopes.traceLabel(s, t), checked: axes?.[axis === "x" ? 0 : 1] === t,
      action: () => scopeEdit(() => s.setXYTrace(axis, t)),
    }));
    return [
      { label: "X axis", items: pick("x") },
      { label: "Y axis", items: pick("y") },
      { label: "Long trail", checked: s.measures.has("xylong"), title: "Keep the last 65 536 points instead of 4096.", action: () => scopeEdit(() => s.setOption("xylong", !s.measures.has("xylong"))) },
    ];
  }

  /** What the header opens: tile options stay open while settings change; the plot type closes. */
  function scopePanel(s: ScopeRuntime, panel: ScopePanel, x: number, y: number, top?: number): void {
    if (panel === "plot") return showContextMenu(x, y, plotItems(s), top);
    const build = { measure: measureItems, trigger: triggerItems, audio: audioItems, scale: scaleItems }[panel];
    showContextMenu(x, y, () => build(s), top);
  }

  /** A trace's menu, from its legend entry. */
  function traceMenu(s: ScopeRuntime, t: ScopeTrace, x: number, y: number, top?: number): void {
    showContextMenu(x, y, () => {
      const timePlot = !s.has(ScopeFlag.fft) && !s.isXY;
      const tr = s.view.trigger;
      const playing = scopeAudio.listeningScope === s && scopeAudio.listeningTrace === t;
      const others = s.traces.filter((o) => o !== t && !(o instanceof MathTrace));
      const math = (op: MathOp, b: ScopeTrace | null) => scopeEdit(() => doc.model.addMathTrace(s, op, t, b));
      const withOther = (label: string, op: MathOp, sign: string): MenuEntry => ({
        label, items: others.map((o) => ({ label: `${sign} ${scopes.traceLabel(s, o)}`, action: () => math(op, o) })),
      });
      return [
        { label: t instanceof MathTrace ? scopes.traceLabel(s, t) : `${doc.model.designator(t.elm) ?? doc.model.kindName(t.elm)}  ${scopes.traceLabel(s, t)}`, header: true },
        ...(timePlot ? [{ label: "Trigger on this trace", checked: tr.edge !== 0 && s.traces[tr.trace] === t,
          action: () => triggerEdit(() => {
            if (tr.edge !== 0 && s.traces[tr.trace] === t) tr.edge = 0;
            else { tr.trace = s.traces.indexOf(t); tr.level = null; tr.edge ||= 1; }
          }) }] : []),
        { label: "Listen to this trace", checked: playing, action: () => {
          if (playing) scopeAudio.stop();
          else listenTo(s, t, lastAudio.get(s)?.mode ?? "signal");
        } },
        { separator: true, label: "" },
        // trace math with the scope's other traces (A − B: a differential probe between two voltages)
        ...(t instanceof MathTrace ? [{ label: "Remove trace", action: () => scopeEdit(() => doc.model.removeTrace(s, t)) }] : [
          ...(others.length ? [withOther("Subtract", "sub", "−"), withOther("Add", "add", "+"), withOther("Multiply by", "mul", "×"), withOther("Divide by", "div", "÷")] : []),
          { label: "Integrate", action: () => math("int", null) },
          { label: "Differentiate", action: () => math("der", null) },
        ]),
      ];
    }, top);
  }

  /** The right-click menu: every setting, in the header's order (see scopeEdit). */
  function scopeMenu(x: number, y: number, s: ScopeRuntime, sheet?: ScopeElm): void {
    const m = doc.model;
    const has = (f: number) => s.has(f);
    const fft = has(ScopeFlag.fft), xy = !fft && s.isXY, timePlot = !fft && !xy;
    const value = (label: string, v: number): MenuEntry => ({
      label,
      checked: v === ScopeValue.voltage ? has(ScopeFlag.showVoltage) && s.traces.some((tr) => tr.value === v)
        : v === ScopeValue.current ? has(ScopeFlag.showCurrent) && s.traces.some((tr) => tr.value === v) : s.traces.some((tr) => !(tr instanceof MathTrace) && tr.value === v),
      action: () => scopeEdit(() => m.toggleScopeValue(s, v)),
    });
    // what the scope's parts offer: voltage, current and power, and each part's own (Vgs, Ic, R…)
    const quantities = new Map<number, string>();
    for (const e of new Set(s.traces.filter((t) => !(t instanceof MathTrace)).map((t) => t.elm))) {
      for (const q of quantitiesFor(e)) if (!quantities.has(q.value)) quantities.set(q.value, q.name);
    }
    const sep: MenuEntry = { separator: true, label: "" };
    showContextMenu(x, y, [
      { label: sheet ? "Scope on schematic" : "Scope", header: true },
      ...[...quantities].map(([v, name]) => value(name, v)),
      sep,
      ...plotItems(s),
      sep,
      ...(s.visibleTraces.length ? [{ label: "Sound", items: audioItems(s) }] : []),
      ...(timePlot ? [{ label: "Trigger", items: triggerItems(s) }] : []),
      ...(fft ? [{ label: "Spectrum", items: fftItems(s) }] : []),
      ...(xy ? [{ label: "X-Y axes", items: xyItems(s) }] : []),
      ...(xy ? [{ label: "Scale", items: scaleItems(s) }] : []),
      ...(timePlot ? [{ label: "Scale", items: scaleItems(s) }, { label: "Measurements", items: measureItems(s) }] : []),
      sep,
      ...(timePlot ? [
        { label: "Faster time scale", action: () => s.setSpeed(s.speed / 2, m.sim.t) },
        { label: "Slower time scale", action: () => s.setSpeed(s.speed * 2, m.sim.t) },
        { label: "Return to live", action: s.view.live ? undefined : () => s.goLive() },
      ] : []),
      { label: "Zoom back", action: s.canNavBack ? () => s.navBack() : undefined },
      { label: "Fit", key: "Space", title: "Live at its own time per division, every axis automatic. Double-click does the same.", action: () => s.resetView(m.sim.t) },
      ...(MEASUREMENT_CURSORS ? [{ label: "Clear cursors", action: s.view.cursors.length ? () => (s.view.cursors = []) : undefined }] : []),
      { label: "Clear recording", action: () => s.reset() },
      sep,
      ...(sheet
        ? [
          { label: "Dock in scope panel", action: () => {
            doc.edit(() => m.dockScope(sheet));
            updateSettings({ showBottomPanel: true });
            selectTab("scopes");
          } },
          { label: "Delete", action: () => doc.edit(() => (m.circuit.elements = m.circuit.elements.filter((e) => e !== sheet))) },
        ] as MenuEntry[]
        : [
          { label: "Stack with previous", action: s.position > 0 ? () => { doc.edit(() => m.stackScope(s)); edited(); } : undefined },
          { label: "Move to own column", action: m.isStacked(s) ? () => { doc.edit(() => m.unstackScope(s)); edited(); } : undefined },
          ...(SHEET_SCOPES ? [{ label: "Undock onto schematic", action: () => undockScope(s) }] : []),
          { label: "Remove scope", action: () => { doc.edit(() => m.removeScope(s.id)); edited(); } },
        ] as MenuEntry[]),
    ]);
  }


  let menuKey = "";
  let shortcuts: { key: string; id: string }[] = [];
  const drawnMenus = drawsMenubar(desktop?.platform ?? "browser", !!desktop);
  function menuState(): MenuState {
    return {
      canUndo: doc.canUndo, canRedo: doc.canRedo, hasSelection: doc.model.selection.size > 0,
      tool: canvas.tool.kind === "place" ? canvas.tool.className : null,
      hasDocument: docs.length > 0,
      recent: desktop ? recent.list() : [],
    };
  }
  /** Rebuild the menus when something they show changed. */
  function refreshMenus(force = false): void {
    const state = menuState();
    toolstrip.update(state, state.tool ? drawNames.get(state.tool) ?? null : null);
    const key = JSON.stringify(state) + JSON.stringify(settings);
    if (key === menuKey && !force) return;
    menuKey = key;
    const menus = nodeforgeRuntime.menus.build(draw, library, !!desktop, state);
    // The browser and Windows draw the menus in the page; on Windows the bar is the title bar, beside the window controls.
    if (desktop && !drawnMenus) desktop.setMenu(menus);
    else {
      renderMenubar($("menubar"), menus, run, { titleBar: !!desktop });
      desktop?.setTitleBar(titleBarColors());
    }
    shortcuts = collectShortcuts(menus);
  }
  const toolstrip = buildToolStrip($("toolstrip"), draw, run);
  desktop?.onCommand(run);
  desktop?.onOpenFiles(openFiles);
  // circuit files dropped from the system open as tabs, as File › Open does
  attachFileDrop($("center"), {
    accept: [".nfg", ".txt", ".xml", ".circuitjs"],
    label: "Drop circuit files to open them.",
    pathFor: desktop ? desktop.pathForFile : undefined,
    onRefused: (message) => note(message, "error"),
    onFiles: (files) => {
      for (const { name, path, file } of files) void (async () => {
        try {
          if (desktop && path) openFiles([await desktop.openCircuit(path)]);
          else openDocument(new CircuitDocument(await file.text(), { name, title: library.titles.get(name) ?? null }));
        } catch { note(`Couldn't open ${name}.`, "error"); }
      })();
    },
  });
  window.addEventListener("focus", () => refreshMenus(true));
  onSettingsChange(() => {
    refreshMenus(true);
    applyLayout();
    for (const d of docs) d.model.applySolverSettings();
    doc.model.applySolverSettings();
  });

  installWorkspaceKeys({
    // Without a native menu (browser, Windows) the page routes the menu shortcuts itself.
    desktop: !!desktop && !drawnMenus, hasDocuments: () => docs.length > 0, typingInField, shortcuts: () => shortcuts,
    run: (id) => { void run(id); },
    escape: () => {
      if (canvas.tool.kind !== "select") canvas.setTool({ kind: "select" });
      else canvas.clearSelection();
      canvas.cancelGesture();
    },
    domainKeyDown: (e) => {
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
      if (e.key === " " && plain) {
        if (!e.repeat) {
          canvas.spaceHeld = scopes.spaceHeld = true;
          canvas.spacePanned = scopes.spacePanned = false;
          canvas.refreshCursor();
          scopes.refreshCursor();
        }
        return true;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && (plain || (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey))) {
        void run("edit.delete");
        return true;
      }
      if (plain && (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") && sel().size) {
        const g = (e.shiftKey ? 4 : 1) * grid();
        const [dx, dy] = { ArrowLeft: [-g, 0], ArrowRight: [g, 0], ArrowUp: [0, -g], ArrowDown: [0, g] }[e.key];
        doc.edit(() => { const op = new MoveOperation(doc.model, [...sel()]); op.apply(dx, dy); });
        edited();
        return true;
      }
      const part = plain ? PART_KEYS.get(e.key) : null;
      if (part) { void run(`tool:${part}`); return true; }
      return false;
    },
    domainKeyUp: (e) => {
      if (e.key !== " ") return;
      const tapped = !(e.target instanceof Element && e.target.closest("input, textarea, select"));
      // A tap resets the view under the pointer; a hold pans it.
      if (tapped && canvas.spaceHeld && !canvas.spacePanned && !scopes.spacePanned) {
        if (scopes.hovered) scopes.resetHovered();
        else void run("view.fit");
      }
      canvas.spaceHeld = scopes.spaceHeld = false;
      canvas.refreshCursor();
      scopes.refreshCursor();
    },
  });
  window.addEventListener("beforeunload", (e) => {
    if (!desktop && docs.some((d) => d.dirty)) e.preventDefault();
  });


  const applyLayout = createPanelLayout({
    center: $("center"), inspector: $("inspector"), inspectorSplit: $("inspector-split"),
    bottom: $("bottom"), bottomSplit: $("bottom-split"), settings, defaults: DEFAULTS,
    save: updateSettings,
    afterApply: () => {
      document.body.classList.toggle("paper", settings.whiteBackground);
      document.body.dataset.theme = settings.appearance;
      document.body.dataset.inspectorSide = settings.inspectorSide;
      if (desktop && drawnMenus) desktop.setTitleBar(titleBarColors());
    },
  });

  let terminal: import("./terminal").TerminalPanel | null = null;
  const tabs = $("bottom-tabs");
  const paneSettings = {
    terminal: { element: $("terminal-pane"), onSelect: () => { void showTerminal(); } },
    scopes: { element: $("scopes-pane") },
    messages: { element: $("messages-pane"), onSelect: () => {
      messages.refresh(true);
      doc.messages.markSeen();
      refreshStatus(true);
    } },
  };
  const selectBottomTab = createBottomTabs(tabs, nodeforgeRuntime.panes.map((name) => ({ name, ...paneSettings[name] })));
  /** The terminal is shown first at every launch. */
  function selectTab(name: "scopes" | "terminal" | "messages"): void { selectBottomTab(name); }
  // The Messages tab's one action, shown at the right of its tab bar.
  const clearMessages = Object.assign(document.createElement("button"), { className: "tab-action messages-clear", textContent: "Clear" });
  setTip(clearMessages, "Clear this circuit's messages.");
  tabs.append(clearMessages);

  const messages = new MessagesPanel($("messages-pane"), {
    subjectName: (part) => doc.model.circuit.elements.includes(part as CircuitElm) ? doc.model.designator(part as CircuitElm) ?? doc.model.kindName(part as CircuitElm) : null,
    selectSubject: (part) => {
      if (!doc.model.circuit.elements.includes(part as CircuitElm)) return;
      doc.model.selected = part as CircuitElm;
      refreshStatus(true);
      refreshMenus();
    },
  }, clearMessages);

  // one Terminal per window: calls made while the module loads wait for the same panel instead of building another
  let terminalLoad: Promise<void> | null = null;
  async function showTerminal(): Promise<void> {
    terminalLoad ??= import("./terminal").then(({ TerminalPanel }) => {
      terminal = new TerminalPanel($("terminal-pane"), logo.trimEnd(), VERSION, {
        execute: consoleCommand,
        complete: consoleComplete,
      }, terminalPreferences);
    });
    await terminalLoad;
    terminal!.show();
  }

  /** Export one text file through the shell's export dialog (desktop); never a circuit file or an open original. */
  async function exportText(name: string, format: string, text: string, cancelled = "Export cancelled."): Promise<import("./terminal").ConsoleResult> {
    const result = await exportFiles({
      bridge: desktop ?? null, formats: EXPORT_FORMATS, overwrite: "ask",
      protectedPaths: () => docs.flatMap((d) => (d.path ? [d.path] : [])),
    }, [{ name, format: EXPORT_FORMATS.find((f) => f.id === format)!, bytes: () => new TextEncoder().encode(text) }]);
    if (!result) return { lines: [cancelled] };
    return { lines: [`Exported ${result.written.map((path) => path.split(/[\\/]/).pop()).join(", ")}.`] };
  }

  /** Settings pages supplied by the shell and the application's repository profile. */
  function settingsPages(): SettingsPage[] {
    return [
      generalPage({ settings, update: updateSettings, subscribe: onSettingsChange }),
      terminalPage({ fontSize: () => settings.terminalFontSize, setFontSize: (size) => updateSettings({ terminalFontSize: size }), preferences: terminalPreferences, subscribe: onSettingsChange }),
      healthPage(health),
      ...(repository ? [updatesPage({ info, repository, ...settingsUpdateOptions })] : []),
    ];
  }

  async function consoleCommand(line: string, signal?: AbortSignal): Promise<import("./terminal").ConsoleResult> {
    // <command> -h, --help and ? are help <command>, before any argument is checked (the shell's TERMINAL.md).
    line = helpAlias(line) ?? line;
    let [command, ...args] = tokenizeConsole(line);
    // plot's verbs on an existing scope (plot trigger 1 rising, plot V(R1) in 2) run as the scope command's
    if (command === "plot") {
      const designators = new Set(doc.model.circuit.elements.map((e) => doc.model.designator(e)?.toLowerCase()));
      const alias = plotToScope(args, (name) => designators.has(name.toLowerCase()));
      if (alias) [command, ...args] = alias;
    }
    const arg = args.join(" ");
    const spec = nodeforgeRuntime.commands.find((entry) => entry.name === command);
    const switchStatus = (label: string, before: boolean, after: boolean): string =>
      before === after ? `${label[0].toUpperCase()}${label.slice(1)} is already ${after ? "on" : "off"}.` : `${label[0].toUpperCase()}${label.slice(1)} ${after ? "enabled" : "disabled"}.`;
    const sliderHelp = () => commandHelp("slider");
    if (!spec) return { lines: [`${command}: unknown command. Type help to list commands.`] };
    const noCircuit = docs.length === 0;
    if (noCircuit && !availableWithoutCircuit(command, arg) && !(command === "scope" && (!arg || args[0] === "help")))
      return { lines: ["Open a circuit first."] };
    if (!spec.args.test(arg)) return invalidUsage(spec);
    if (command === "scope" && (!arg || args[0] === "help")) return commandHelp(args[1] ? `scope ${args[1]}` : "scope", noCircuit);
    if (command === "slider" && arg === "help") return sliderHelp();
    if (command === "help") return arg ? commandHelp(arg, noCircuit) : generalHelp(noCircuit);
    const tabResult = await consoleTabCommand(command, arg, {
      documents: () => docs, activeDocument: () => doc, activate, close: closeDocument,
      documentNoun: forgeApp.document!.noun,
    });
    if (tabResult) return tabResult;
    // the shell's shared commands (new, open, recent, save, undo, fit, zoom, font, about, version…) run the menu actions;
    // NodeForge's further forms (open <file>, save as <name>, zoom <percent>, zoom alone) are handled below
    const extended = (command === "open" && !!arg) || (command === "save" && args.length > 1) || (command === "zoom" && (!arg || arg.endsWith("%")));
    const shared = extended ? null : runSharedCommand(command, arg, {
      run: (action) => { void run(action, true); }, actions: STANDARD, hasDocument: docs.length > 0, noun: forgeApp.document.noun,
      productName: forgeApp.identity.name, version: VERSION,
      recent: () => (desktop ? recent.list() : []), openPath: (path) => { void openRecent(String(recent.list().indexOf(path))); },
      openSettings: (page) => showSettings({ pages: settingsPages(), page }),
      settingsPages: () => visiblePages(settingsPages()).map((page) => page.id),
    });
    if (shared) return shared;
    if (command === "status") {
      if (!docs.length) return { lines: ["No circuit open."] };
      const m = doc.model;
      return { tables: [{ headers: [], rows: [
        ["Circuit", doc.displayTitle], ["State", m.sim.stopMessage ? "Stopped" : m.running ? "Running" : "Paused"],
        ["Time", si(m.sim.t, "s", true, 4)], ["Solver", settings.solver === "nodeforge" ? "NodeForge" : "CircuitJS"],
        ["Relative tolerance", `${Number((settings.relTol * 100).toPrecision(6))}%${settings.solver === "circuitjs" ? " (inactive)" : ""}`],
        ["Maximum time step", si(m.sim.maxTimeStep, "s", true)], ["Simulation speed", `${Number(m.speedRatio.toPrecision(6))}×`],
        ...(m.sim.stopMessage ? [["Stopped because", m.sim.stopMessage]] : []),
      ] }] };
    }
    if (command === "run" && args[0] === "for") {
      if (!docs.length) return { lines: ["Open a circuit first."] };
      const duration = scopeQuantity(args[1], "s", true);
      const target = doc, revision = target.revision, sim = target.model.sim, solver = settings.solver, relTol = settings.relTol;
      const elapsed = await runFor(target.model, duration, signal, () => doc === target && target.revision === revision && target.model.sim === sim && settings.solver === solver && settings.relTol === relTol);
      return { lines: [`Advanced ${si(elapsed, "s", true, 6)}. Paused at ${si(target.model.sim.t, "s", true, 6)}.`] };
    }
    if (spec.action && !docs.length && command !== "new") return { lines: ["Open a circuit first."] };
    if (spec?.action) { await run(spec.action, true); return { lines: command === "run" ? ["Simulation running."] : command === "pause" ? ["Simulation paused."] : command === "reset" ? ["Simulation reset."] : [] }; }
    const shellPreference = shellPreferenceCommand(command, arg, {
      settings, update: updateSettings, panes: nodeforgeRuntime.panes, selectPane: selectTab,
    });
    if (shellPreference) return shellPreference;
    if (command === "open") {
      if (!arg) await openFile();
      else if (library.titles.has(arg)) await openLibraryCircuit(arg);
      else if (desktop) openFiles([await desktop.openCircuit(arg)]);
      else return { lines: ["That is not a bundled circuit. Use open without a path to choose a local file."] };
      return { lines: [] };
    }
    if (command === "models") return await consoleModels(args, signal);
    if (command === "analyze" && args[0] === "auto") {
      const before = settings.backgroundAnalysis;
      if (args[1]) setBackgroundAnalysis(args[1] === "on");
      return { lines: [args[1] ? switchStatus("automatic analysis", before, settings.backgroundAnalysis) : `Automatic analysis is ${settings.backgroundAnalysis ? "on" : "off"}.`] };
    }
    if (command === "scope" && args[0] === "linked") {
      const before = settings.linkedReadout;
      if (args[1]) updateSettings({ linkedReadout: args[1] === "on" });
      return { lines: [args[1] ? switchStatus("linked scope readout", before, settings.linkedReadout) : `Linked scope readout is ${settings.linkedReadout ? "on" : "off"}.`] };
    }
    if (command === "switch") {
      const part = partNamed(doc.model, args[0]);
      if (!(part instanceof SwitchElm)) throw new Error("This component is not a switch or logic input.");
      if (args[1] !== "status") {
        const change = prepareSwitch(doc.model, part, args[1]);
        doc.edit(change); edited();
      }
      return { lines: [`${args[0]}: ${switchState(part)}.`] };
    }
    if (["delete", "duplicate", "rotate"].includes(command)) {
      const elm = partNamed(doc.model, arg);
      canvas.cancelGesture();
      doc.model.selection.clear();
      doc.model.selection.add(elm);
      await run(command === "rotate" ? "edit.rotateCW" : `edit.${command}`, true);
      inspector.refreshProperties(true);
      return { lines: [`${command === "delete" ? "Deleted" : command === "duplicate" ? "Duplicated" : "Rotated"} ${arg}${command === "rotate" ? " 90° clockwise" : ""}.`] };
    }
    if (command === "slider") {
      if (!args.length) {
        return { lines: doc.model.sliders.length ? [] : ["No adjustable sliders."],
          tables: doc.model.sliders.length ? [{ headers: ["Part", "Property", "Minimum", "Maximum", "Value", "Step"], rows: doc.model.sliders.map((s) => {
            const field = sliderFields(s.elm).find((f) => f.index === s.adj.editItem);
            const unit = field?.unit ?? "";
            return [doc.model.designator(s.elm) ?? doc.model.kindName(s.elm), field?.name ?? s.adj.label,
              si(s.adj.minValue, unit), si(s.adj.maxValue, unit), field ? si(field.value, unit) : doc.model.sliderValueText(s), si(s.adj.step, unit)];
          }) }] : [] };
      }
      if (args[0] === "remove") {
        if (args.length < 3) return sliderHelp();
        const e = partNamed(doc.model, args[1]);
        const field = sliderFieldNamed(e, args.slice(2).join(" "));
        doc.edit(() => removeSlider(doc.model, e, field));
        edited(); inspector.setModel(doc.model);
        return { lines: [`Removed ${args[1]} ${field.name} slider.`] };
      }
      if (args.length < 6) return sliderHelp();
      const e = partNamed(doc.model, args[0]);
      const field = sliderFieldNamed(e, args.slice(1, -4).join(" "));
      const [min, max, value, step] = sliderNumbers(field, args.slice(-4));
      const before = doc.model.snapshot();
      try { doc.edit(() => configureSlider(doc.model, e, field, min, max, value, step)); }
      catch (error) { doc.model.restore(before); inspector.setModel(doc.model); throw error; }
      edited(); inspector.setModel(doc.model);
      return { lines: [`${args[0]} ${field.name} slider set to ${doc.model.sliderValueText(doc.model.sliders.find((s) => s.elm === e && s.adj.editItem === field.index)!)}.`] };
    }
    if (command === "model" && args[1]?.toLowerCase() === "save") {
      // model PART save NAME: a custom model kept in the library, the part put on it
      const e = partNamed(doc.model, args[0]);
      if (!doc.model.isCustomModel(e)) throw new Error("Only a custom model can be saved. Use model PART custom first.");
      const name = args.slice(2).join(" ");
      const card = doc.model.modelCard(e);
      const problem = card ? await saveCustomModel(card, name) : "This part has no model card.";
      if (problem) throw new Error(problem);
      doc.edit(() => doc.model.setSpiceModel(e, name)); edited(); inspector.setModel(doc.model);
      return { lines: [`Saved ${name} to the model library.`] };
    }
    if (command === "set" && args.length === 1) {
      const e = partNamed(doc.model, args[0]);
      const props = settableProperties(e, doc.model);
      return { lines: [props.length ? `${doc.model.designator(e)}: ${props.map(settableName).join(", ")}` : `${doc.model.designator(e)} has no editable properties.`] };
    }
    if (command === "set" || command === "model" || (command === "tolerance" && args.length === 2)) {
      const e = partNamed(doc.model, args[0]);
      const change = command === "set" ? prepareProperty(e, args.slice(1), doc.model) : command === "model" ? prepareModel(doc.model, e, args.slice(1)) : prepareTolerance(e, args[1]);
      const before = doc.model.snapshot();
      try { doc.edit(change); } catch (error) { doc.model.restore(before); inspector.setModel(doc.model); throw error; }
      edited(); inspector.setModel(doc.model);
      return { lines: [] };
    }
    if (command === "save") {
      const name = args.slice(1).join(" ");
      if (name && /[/\\]/.test(name)) throw new Error("Use a filename, not a path; the save dialog chooses the folder.");
      const oldName = doc.name;
      if (name) doc.name = name;
      if (!desktop) {
        stampMeta(doc);
        const { text, format } = doc.model.serialize("nfg");
        const filename = withoutCircuitExtension(doc.name) + ".nfg";
        doc.name = oldName;
        // (a circuit with parts only the text format keeps comes back as text: not an .nfg file)
        if (format !== "nfg") throw new Error("This circuit has parts that only CircuitJS text can keep. Export it with export txt.");
        return { download: { name: filename, text } };
      }
      const saved = await save(args[0] === "as", doc, name || undefined);
      if (!saved) doc.name = oldName;
      return { lines: [saved ? "Saved." : "Save cancelled or failed."] };
    }
    if (command === "export" || command === "spice") {
      const spice = command === "spice" || arg === "spice";
      const kind = spice ? "spice" : arg === "nfg" ? "nfg" : arg === "txt" ? "txt" : "xml";
      doc.model.serialize("xml"); // Synchronize edited settings before exporting.
      const net = spice ? toSpice(doc.model.circuit) : null;
      if (net?.unsupported.length) throw new Error(`SPICE export does not support: ${net.unsupported.join(", ")}`);
      if (kind === "nfg") stampMeta(doc);
      const wanted: CircuitFormat = kind === "nfg" ? "nfg" : kind === "txt" ? "text" : "xml";
      const written = net ? null : doc.model.serialize(wanted);
      // a format that can't keep the circuit is refused, never written under another format's name
      if (written && written.format !== wanted) {
        throw new Error(wanted === "text"
          ? "The CircuitJS text format can't keep this circuit's settings. Export it as xml or nfg."
          : "This circuit has parts that only CircuitJS text can keep. Export it with export txt.");
      }
      const text = net?.text ?? written!.text;
      if (command === "spice") return { lines: text.trimEnd().split("\n") };
      const name = doc.name.replace(/\.[^.]+$/, "") + (spice ? ".cir" : `.${kind}`);
      if (!desktop) return { download: { name, text } };
      if (kind === "nfg") {
        // a circuit file is saved, never exported
        const path = await desktop.saveDialog(name, kind);
        if (!path) return { lines: ["Export cancelled."] };
        await desktop.writeFile(path, text);
        return { lines: [`Exported ${name}.`] };
      }
      return exportText(name, kind, text);
    }
    if (command === "compare" || (command === "accuracy" && (!arg || arg === "check"))) {
      if (!docs.length) throw new Error("Open a circuit first.");
      if (!desktop) return { lines: ["Comparison with ngspice requires the desktop app. No comparison was run."] };
      const cancel = () => desktop?.cancelChecks();
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        const output = await desktop.verifyCircuit(doc.model.serialize("xml").text, settings.solver === "nodeforge", settings.relTol);
        if (signal?.aborted) throw new Error("Cancelled.");
        return formatVerification(output);
      } finally { signal?.removeEventListener("abort", cancel); }
    }
    if (command === "bench" || command === "montecarlo") {
      const count = Number(arg || (command === "bench" ? 4000 : 20));
      const max = command === "bench" ? 1000000 : 200;
      if (!Number.isInteger(count) || count < 1 || count > max) throw new Error(`${command}: use an integer from 1 to ${max}`);
      return await consoleTool(command, count, signal);
    }
    if (command === "analyze") {
      const target = doc, key = analysisKey(target);
      const worker = new Analyzer();
      const cancel = () => worker.cancel();
      signal?.addEventListener("abort", cancel, { once: true });
      let rec: Recommendation;
      try { rec = await worker.run(analysisInput(target.model)); } finally { signal?.removeEventListener("abort", cancel); worker.dispose(); }
      if (signal?.aborted) throw new Error("Cancelled.");
      if (target !== doc || key !== analysisKey(target)) throw new Error("Circuit changed during analysis; run the command again.");
      if (arg === "apply") applyRecommendation(target, rec);
      return { lines: [...rec.findings,
        `Maximum time step: ${si(rec.timeStep, "s", true)}`, `Simulation speed: ${Number(rec.speedRatio.toPrecision(4))}×`, ...(rec.relTol === null ? [] : [`Relative tolerance: ${rec.relTol * 100}%`]),
        ...(arg === "apply" ? ["Recommended settings applied."] : ["Use analyze apply to apply these settings."])] };
    }
    if (command === "step") { const n = Number(args[0] ?? 1); if (!Number.isInteger(n) || n < 1 || n > 1000) return { lines: ["step: use an integer from 1 to 1000"] }; doc.model.running = false; for (let i = 0; i < n; i++) doc.model.step(); return { lines: [`Advanced ${n} time step${n === 1 ? "" : "s"}.`] }; }
    if (command === "op") { await run("sim.operatingPoint"); return { lines: [] }; }
    if (command === "solver" && !arg) return { lines: [`Solver: ${settings.solver === "nodeforge" ? "NodeForge" : "CircuitJS"}.`] };
    if (command === "solver" && (arg === "nodeforge" || arg === "accurate" || arg === "circuitjs")) {
      // ("accurate": the NodeForge engine's name before it had one)
      const want = arg === "circuitjs" ? "circuitjs" : "nodeforge";
      if (settings.solver !== want) await run(`solver.${want}`);
      return { lines: [`${want === "nodeforge" ? "NodeForge" : "CircuitJS"} solver selected.`] };
    }
    if (command === "accuracy" || command === "reltol") {
      if (!arg) return { lines: [`Relative tolerance: ${Number((settings.relTol * 100).toPrecision(6))}%.`] };
      const value = Number.parseFloat(arg.replace("%", "")) / (arg.includes("%") ? 100 : 1);
      if (![0.001, 0.0001, 0.00001, 0.000001].some((choice) => Math.abs(choice - value) < choice * 1e-9)) return { lines: ["Unsupported relative tolerance. Type help reltol for available values."] };
      updateSettings({ relTol: value }); return { lines: [`Relative tolerance set to ${arg}.`] };
    }
    if (command === "temp") {
      if (!arg) return { lines: [`Temperature: ${formatTemperature(doc.model.circuit.options.temperature)}.`] };
      const unit = arg.match(/^unit\s+(?:°?([CFK])|celsius|fahrenheit|kelvin)$/i);
      if (unit) {
        const key = (unit[1] ?? arg.trim().split(/\s+/)[1][0]).toUpperCase() as Settings["temperatureUnit"];
        updateSettings({ temperatureUnit: key });
        if (docs.length) inspector.setModel(doc.model);
        return { lines: [`Temperatures are shown in ${temperatureSymbol(key)}.`] };
      }
      const value = parseTemperature(arg);
      if (!Number.isFinite(value) || value <= -273.15) return { lines: [`temp: use a temperature above absolute zero, such as 85, 185F or 358K (a bare number is in ${temperatureSymbol()})`] };
      doc.edit(() => doc.model.setTemperature(value)); edited(); inspector.setModel(doc.model); return { lines: [`Temperature set to ${formatTemperature(value)}.`] };
    }
    if (command === "maxstep") {
      if (!arg) return { lines: [`Maximum time step: ${si(doc.model.sim.maxTimeStep, "s", true)}.`] };
      const value = parseSI(arg, "s");
      if (!Number.isFinite(value) || value <= 0) return { lines: ["maxstep: use a positive time such as 50ns"] };
      doc.edit(() => doc.model.setTimeStep(value)); edited(); inspector.setModel(doc.model); return { lines: [`Maximum time step set to ${si(value, "s")}.`] };
    }
    if (command === "speed") {
      if (!arg) return { lines: [`Simulation speed: ${Number(doc.model.speedRatio.toPrecision(6))}×.`] };
      const value = Number.parseFloat(arg.replace(/[x×]$/, ""));
      if (!Number.isFinite(value) || value < MIN_SPEED_RATIO || value > MAX_SPEED_RATIO) return { lines: [`speed: use ${MIN_SPEED_RATIO}x to ${MAX_SPEED_RATIO}x`] };
      doc.edit(() => { doc.model.speedRatio = value; }); edited(); return { lines: [`Speed set to ${value}x.`] };
    }
    if (command === "ramp") {
      const m = doc.model, now = () => m.circuit.options.startupRamp;
      if (arg) {
        const v = arg.toLowerCase() === "off" ? 0 : parseSI(arg.replace(/μ/g, "µ"), "s");
        if (!(v >= 0)) return { lines: [`${arg}: not a time`] };
        doc.edit(() => m.setStartupRamp(v)); edited(); inspector.setModel(m);
      }
      return { lines: [now() > 0 ? `Start-up ramp: ${si(now(), "s", true)}.` : "Start-up ramp: off."] };
    }
    if (command === "selfheat") { const before = doc.model.circuit.options.selfHeating; doc.edit(() => doc.model.setSelfHeating(arg ? arg === "on" : !before)); edited(); inspector.setModel(doc.model); return { lines: [switchStatus("self-heating", before, doc.model.circuit.options.selfHeating)] }; }
    if (command === "tolerance") { const before = doc.model.tolerance.enabled; doc.edit(() => doc.model.setTolerance(arg ? arg === "on" : !before)); edited(); return { lines: [switchStatus("part tolerances", before, doc.model.tolerance.enabled)] }; }
    if (command === "seed") {
      if (!arg) return { lines: [`seed: ${doc.model.tolerance.seed}`] };
      const seed = arg === "new" ? newSeed() : Number(arg);
      if (!Number.isInteger(seed) || seed < 1 || seed > 99999) return { lines: ["seed: use 1–99999 or new"] };
      doc.edit(() => doc.model.setTolerance(doc.model.tolerance.enabled, seed)); edited(); return { lines: [`Seed set to ${seed}.`] };
    }
    if (command === "zoom" && !arg) return { lines: [`Zoom: ${Number((canvas.viewport.scale * 100).toFixed(1))}%.`] };
    if (command === "zoom") { const value = Number.parseFloat(arg) / 100; if (!Number.isFinite(value) || value <= 0) return { lines: ["zoom: use a positive percentage"] }; canvas.zoomTo(value); return { lines: [`Zoom set to ${Number((canvas.viewport.scale * 100).toFixed(1))}%.`] }; }
    const displays: { name: string; key: "showCurrent" | "showVoltage" | "showValues" | "showReadout" | "showWireJumps"; comment: string }[] = [
      { name: "Current", key: "showCurrent", comment: "animate current flow" },
      { name: "Voltage", key: "showVoltage", comment: "colour wires by voltage" },
      { name: "Values", key: "showValues", comment: "show part values" },
      { name: "Readout", key: "showReadout", comment: "show values under the pointer" },
      { name: "Jumps", key: "showWireJumps", comment: "bridge unconnected conductor crossings" },
    ];
    if (command === "show") {
      if (args[0] === "current" && args[1]) {
        if (args[1] === "steady") {
          updateSettings({ currentSteadyBand: args[2] ? args[2] === "on" : !settings.currentSteadyBand });
          return { lines: [`Fast-current steady band ${settings.currentSteadyBand ? "on" : "off"}.`] };
        }
        if (args[1] === "direction") {
          updateSettings({ currentSteadyArrows: args[2] === "on" });
          return { lines: [`Steady direction arrows ${settings.currentSteadyArrows ? "on" : "off"}.`] };
        }
        const shape = currentShape(args[1]);
        if (shape) { updateSettings({ currentShape: shape }); return { lines: [`Current markers set to ${shape}.`] }; }
      }
      const display = displays.find((x) => x.name.toLowerCase() === args[0]?.toLowerCase());
      if (display && (args[1] === "on" || args[1] === "off")) { const before = settings[display.key]; updateSettings({ [display.key]: args[1] === "on" }); return { lines: [switchStatus(`${display.name.toLowerCase()} display`, before, settings[display.key])] }; }
      if (display) { const before = settings[display.key]; updateSettings({ [display.key]: !before }); return { lines: [switchStatus(`${display.name.toLowerCase()} display`, before, settings[display.key])] }; }
      return { lines: displays.map((x) => ({ label: x.name, comment: x.comment, enabled: settings[x.key] })) };
    }
    if (command === "symbols") {
      const requested = arg.toLowerCase();
      const style = (requested === "eu" ? "iec" : requested === "ansi" ? "us" : requested) as Settings["symbolStyle"];
      updateSettings({ symbolStyle: style });
      return { lines: [`${style === "us" ? "ANSI" : "IEC"} symbols selected.`] };
    }
    if (command === "electron") { const before = !settings.conventionalCurrent; updateSettings({ conventionalCurrent: arg ? arg !== "on" : !settings.conventionalCurrent }); return { lines: [switchStatus("electron flow", before, !settings.conventionalCurrent)] }; }
    if (command === "health") return healthCommand(arg, health);
    if (command === "wheel" && (arg === "zoom" || arg === "auto")) { updateSettings({ wheelZooms: arg === "zoom" }); return { lines: [`Wheel mode set to ${arg}.`] }; }
    // plot <expression> [vs <expression>] / plot fft <expression>: a new scope of them
    if (command === "plot") {
      const fft = args[0]?.toLowerCase() === "fft";
      const parts = (fft ? args.slice(1) : args).join(" ").split(/\s+vs\s+/i);
      if (!parts[0] || parts.length > 2 || (fft && parts.length > 1)) return invalidUsage(spec);
      let traces: ScopeTrace[];
      try { traces = parts.map((p) => doc.model.traceFor(p)); } catch (error) { return { lines: [error instanceof Error ? error.message : String(error)] }; }
      // "Y vs X": X first, as X-Y plots it
      const ordered = parts.length === 2 ? [traces[1], traces[0]] : traces;
      let scope: ScopeRuntime | null = null;
      doc.edit(() => { scope = doc.model.addPlotScope(ordered, parts.length === 2 ? "xy" : fft ? "fft" : "time"); }); edited();
      const s = scope!, name = (t: ScopeTrace) => scopes.traceLabel(s, t);
      const what = parts.length === 2 ? `${name(ordered[1])} vs ${name(ordered[0])}` : `${fft ? "spectrum of " : ""}${name(ordered[0])}`;
      return { lines: [`Scope ${doc.model.scopes.indexOf(s) + 1}: ${what}.`] };
    }
    if (command === "scope") {
      const index = Number(args[1]) - 1;
      if (args[0] === "add" && args[1]) {
        const elm = doc.model.circuit.elements.find((e) => doc.model.designator(e)?.toLowerCase() === args[1].toLowerCase());
        if (!elm) return { lines: [`${args[1]}: no such part`] };
        let scope: ScopeRuntime | null | undefined;
        // a quantity: any the part offers (V, I, P, Vgs, Ic…)
        let trace: ScopeTrace | null = null;
        if (args[2]) {
          try { trace = doc.model.traceFor(`${args[2]}(${args[1]})`); } catch (error) { return { lines: [error instanceof Error ? error.message : String(error)] }; }
        }
        doc.edit(() => { scope = trace ? doc.model.addPlotScope([trace], "time") : doc.model.addScope(elm); }); edited();
        return { lines: [scope ? `scope ${doc.model.scopes.indexOf(scope) + 1} added` : "that part cannot be scoped"] };
      }
      const scope = doc.model.scopes[index];
      if (["span", "scale", "plot", "measure", "export", "trace"].includes(args[0])) {
        const target = numberedItem(doc.model.scopes, args[1], "Scope");
        if (args[0] === "span") {
          if (target.isXY || target.has(ScopeFlag.fft)) throw new Error("Time span requires a time plot.");
          const span = scopeQuantity(args[2], "s", true);
          if (span < doc.model.sim.maxTimeStep) throw new Error("Time span must be at least one maximum time step.");
          target.view.liveSpan = span;
          target.goLive();
          return { lines: [`Scope ${args[1]} time span set to ${si(span, "s", true)}.`] };
        }
        if (args[0] === "scale") {
          const automatic = target.isXY || target.has(ScopeFlag.fft) || target.view.autoY;
          if (!args[2]) return {
            lines: [`Vertical scale: ${automatic ? "automatic" : "manual"}.`],
            tables: automatic ? [] : [{ headers: ["Unit", "Per division", "Center"],
              rows: [...target.view.scales].map(([unit, scale]) => [unit, si(scale.perDiv, unit, true), si(scale.center, unit, true)]) }],
          };
          if (target.isXY || target.has(ScopeFlag.fft)) throw new Error("Manual vertical scale requires a time plot.");
          if (args[2] === "auto") scopes.setAutoY(target, true);
          else {
            const unit = args[2];
            if (!target.visibleTraces.some((t) => t.unit === unit)) throw new Error(`No visible trace uses ${unit}.`);
            const perDiv = scopeQuantity(args[3], unit, true), center = scopeQuantity(args[4] ?? "0", unit);
            scopes.setAutoY(target, false);
            target.view.scales.set(unit, { perDiv, center });
          }
          return { lines: [`Scope ${args[1]} vertical scale updated.`] };
        }
        if (args[0] === "plot") {
          const change = preparePlot(target, args[2]);
          doc.edit(change); edited();
          return { lines: [`Scope ${args[1]} plot set to ${args[2]}.`] };
        }
        if (args[0] === "trace") {
          let trace: ScopeTrace;
          try { trace = doc.model.traceFor(args.slice(2).join(" ")); } catch (error) { return { lines: [error instanceof Error ? error.message : String(error)] }; }
          doc.edit(() => { target.addTrace(trace); target.reset(); }); edited();
          return { lines: [`Scope ${args[1]}: added ${scopes.traceLabel(target, trace)}.`] };
        }
        if (args[0] === "measure") {
          if (!args[2]) return { lines: MEASURES.map((m) => ({ label: m.name, comment: "", enabled: measureOn(target, m.key) })) };
          const measurement = MEASURES.find((m) => m.key === args[2])!;
          const enabled = args[3] === "on";
          doc.edit(() => setMeasure(target, measurement.key, enabled)); edited();
          return { lines: [`${measurement.name} ${enabled ? "enabled" : "disabled"} for scope ${args[1]}.`] };
        }
        const owner = doc, revision = doc.revision;
        owner.model.running = false;
        const text = await scopeCSV(target, target.visibleTraces.map((t) => `${doc.model.designator(t.elm) ?? doc.model.kindName(t.elm)} ${scopes.traceLabel(target, t)}`), signal);
        if (doc !== owner || owner.revision !== revision || owner.model.running) throw new Error("Circuit changed during export. Run the export again.");
        const name = `${owner.name.replace(/\.[^.]+$/, "")}-scope-${args[1]}.csv`;
        if (!desktop) return { download: { name, text, mimeType: "text/csv" } };
        return exportText(name, "csv", text, "CSV export cancelled.");
      }
      if (args[0] === "list") {
        if (!doc.model.scopes.length) return { lines: ["No scopes."] };
        return { tables: doc.model.scopes.flatMap((s, i) => [
          { headers: [], rows: [[`Scope ${i + 1}`, s.isXY ? "X-Y plot" : s.has(ScopeFlag.fft) ? "FFT spectrum" : "Time plot"], ...triggerRows(s)] },
          numberedTable(["Part", "Quantity"], s.visibleTraces.map((t) => [doc.model.designator(t.elm) ?? doc.model.kindName(t.elm), scopes.traceLabel(s, t)])),
        ]) };
      }
      if (args[0] === "clear") {
        if (scopeAudio.listeningScope && doc.model.scopes.includes(scopeAudio.listeningScope)) scopeAudio.stop();
        await run("scopes.clear", true);
        return { lines: ["Scopes cleared."] };
      }
      if (args[0] === "trigger") {
        const target = numberedItem(doc.model.scopes, args[1], "Scope");
        if (!args[2]) return { tables: [{ headers: [], rows: triggerRows(target) }] };
        const change = prepareTrigger(target, args[2], args[3]);
        doc.edit(change); edited();
        return { lines: ["Trigger updated."] };
      }
      if (args[0] === "audio") {
        const target = numberedItem(doc.model.scopes, args[1], "Scope");
        const active = scopeAudio.listeningScope === target;
        let trace = audioTrace(target);
        let mode = active ? scopeAudio.mode : lastAudio.get(target)?.mode ?? "signal";
        if (!args[2]) return { tables: [{ headers: [], rows: [
          ["Audio", active ? "On" : "Off"], ["Mode", mode === "signal" ? "Waveform" : mode === "realtime" ? "Real-time speed" : "Pitch"],
          ["Trace", trace ? String(target.visibleTraces.indexOf(trace) + 1) : "None"],
        ] }] };
        if (args[2] === "off") {
          if (active) scopeAudio.stop();
          return { lines: [`Scope ${args[1]} audio disabled.`] };
        }
        if (args[2] === "trace") trace = numberedItem(target.visibleTraces, args[3], "Trace");
        if (args[2] === "mode") mode = args[3] === "waveform" ? "signal" : args[3] === "realtime" ? "realtime" : "graph";
        if (!trace) throw new Error("This scope has no visible traces.");
        if (args[2] === "on" || active) {
          await scopeAudio.listen(target, trace, mode, scopes.audioRange(target, trace), doc.model);
        }
        lastAudio.set(target, { trace, mode });
        return { lines: [args[2] === "on" ? `Scope ${args[1]} audio enabled.` : `Scope ${args[1]} audio ${args[2]} set to ${args[3]}.`] };
      }
      if (args[0] === "move") {
        const source = numberedItem(doc.model.scopes, args[1], "Scope"), target = numberedItem(doc.model.scopes, args[3], "Scope");
        if (source === target) return { lines: ["A scope can't be placed beside itself."] };
        let changed = false;
        doc.edit(() => { changed = doc.model.moveScope(source, target, args[2] as ScopeDropEdge); }); edited();
        return { lines: [changed ? `Scope ${args[1]} placed ${args[2]} scope ${args[3]}.` : `Scope ${args[1]} is already there.`] };
      }
      if (args[0] === "combine" || args[0] === "separate") { await run(args[0] === "combine" ? "scopes.combine" : "scopes.separate"); return { lines: [] }; }
      if (args[0] === "remove") {
        const target = numberedItem(doc.model.scopes, args[1], "Scope");
        if (scopeAudio.listeningScope === target) scopeAudio.stop();
        doc.edit(() => doc.model.removeScope(target.id)); edited();
        return { lines: [`Scope ${args[1]} removed.`] };
      }
      if (args[0] === "live") { const target = args[1] ? scope : doc.model.scopes[0]; if (!target) return { lines: ["scope: no such scope"] }; target.goLive(); return { lines: [] }; }
      if (args[0] === "stack" || args[0] === "unstack") { await run(`scopes.${args[0]}`, true); return { lines: [] }; }
      return { lines: ["Invalid scope command. Type scope help for available actions."] };
    }
    if (command === "list") { const parts = partsForList(doc.model, arg); return parts.length
      ? { tables: [numberedTable(["Part", "Type"], parts.map((e) => [doc.model.designator(e) ?? "?", doc.model.kindName(e)]))] }
      : { lines: ["No matching parts."] }; }
    if (command === "power") return powerCommand(args);
    if (command === "dcsweep") return dcSweepCommand(args);
    if (command === "stepsweep") return stepSweepCommand(args);
    if (command === "ac") return acSweepCommand(args);
    if ((command === "info" || command === "select") && args[0]) {
      const elm = doc.model.circuit.elements.find((e) => doc.model.designator(e)?.toLowerCase() === args[0].toLowerCase());
      if (!elm) return { lines: [`${args[0]}: no such part`] };
      if (command === "select") { doc.model.selection.clear(); doc.model.selection.add(elm); refreshMenus(); return { lines: [`selected ${doc.model.designator(elm)}`] }; }
      return formatPartInfo(doc.model.infoLines(elm));
    }
    return { lines: [`${command}: unknown command. Type help to list commands.`] };
  }

  /** `dcsweep <source> <start> <stop> <step> <quantity>…`: a DC sweep, plotted in a new scope. */
  function dcSweepCommand(args: string[]): import("./terminal").ConsoleResult {
    const m = doc.model;
    const [name, ...rest] = args;
    const source = m.circuit.elements.find((e) => m.designator(e)?.toLowerCase() === name?.toLowerCase());
    if (!source) return { lines: [`${name ?? ""}: no such part`] };
    const nums = rest.slice(0, 3).map((x) => parseSI(x, source instanceof CurrentElm ? "A" : "V"));
    if (nums.length < 3 || nums.some((x) => !Number.isFinite(x))) return { lines: ["Give the start, stop and step, e.g. dcsweep V1 0 10 0.1 V(R1)"] };
    const quantities = rest.slice(3);
    if (!quantities.length) return { lines: ["Name what to plot, e.g. V(R1) Ic(Q1)"] };
    const traces = [];
    for (const q of quantities) {
      try { traces.push(m.traceFor(q)); } catch (error) { return { lines: [error instanceof Error ? error.message : String(error)] }; }
    }
    const r = m.dcSweep(source, nums[0], nums[1], nums[2], traces);
    if (typeof r === "string") return { lines: [`DC sweep: ${r}.`] };
    selectTab("scopes");
    const sw = r.sweep!;
    return { lines: [`DC sweep of ${sw.label}: ${sw.x.length} points in scope ${m.scopes.indexOf(r) + 1}${sw.failed.length ? `, ${sw.failed.length} without an operating point` : ""}.`] };
  }

  /** `ac <source> <fstart> <fstop> [points per decade] <quantity>…`: a Bode plot in a new scope. */
  function acSweepCommand(args: string[]): import("./terminal").ConsoleResult {
    const m = doc.model;
    const [name, ...rest] = args;
    const source = m.circuit.elements.find((e) => m.designator(e)?.toLowerCase() === name?.toLowerCase());
    if (!source) return { lines: [`${name ?? ""}: no such part`] };
    const [fStart, fStop] = rest.slice(0, 2).map((x) => parseSI(x, "Hz"));
    if (!(fStart > 0) || !(fStop > fStart)) return { lines: ["Give the start and stop frequencies, e.g. ac V1 10 1Meg V(R2)"] };
    // points per decade: a plain number before the quantities (20 when none)
    const perDecade = /^\d+$/.test(rest[2] ?? "") ? Number(rest[2]) : 20;
    const quantities = rest.slice(/^\d+$/.test(rest[2] ?? "") ? 3 : 2);
    if (!quantities.length) return { lines: ["Name what to plot, e.g. V(R2)"] };
    const traces = [];
    for (const q of quantities) {
      try { traces.push(m.traceFor(q)); } catch (error) { return { lines: [error instanceof Error ? error.message : String(error)] }; }
    }
    const r = m.acSweep(source, fStart, fStop, perDecade, traces);
    if (typeof r === "string") return { lines: [`AC sweep: ${r}.`] };
    selectTab("scopes");
    const sw = r.sweep!;
    return { lines: [`${sw.title}: ${sw.x.length} points from ${si(fStart, "Hz", true)} to ${si(sw.x[sw.x.length - 1], "Hz", true)} in scope ${m.scopes.indexOf(r) + 1}.`] };
  }

  /**
   * `stepsweep <part> [property] <values> for <time> <quantity>…`: a run per value (a list a,b,c or
   * start:stop:step), each from the start, the quantities overlaid in a new scope.
   */
  function stepSweepCommand(args: string[]): import("./terminal").ConsoleResult {
    const m = doc.model;
    const usage = "e.g. stepsweep R1 1k,4.7k,10k for 2ms V(C1)  or  stepsweep C1 capacitance 1u:10u:3u for 5ms V(C1)";
    const forAt = args.indexOf("for");
    if (forAt < 2 || !args[forAt + 1]) return { lines: [`Give the values and the time, ${usage}`] };
    const part = m.circuit.elements.find((e) => m.designator(e)?.toLowerCase() === args[0].toLowerCase());
    if (!part) return { lines: [`${args[0]}: no such part`] };
    const words = args.slice(1, forAt - 1), spec = args[forAt - 1];
    let values: number[];
    const range = spec.split(":");
    if (range.length === 3) {
      const [a, b, s] = range.map((x) => parseSI(x));
      const n = Math.round((b - a) / s);
      values = n >= 0 && n < 100 ? Array.from({ length: n + 1 }, (_, i) => a + i * s) : [];
    } else values = spec.split(",").map((x) => parseSI(x));
    if (!values.length || values.some((v) => !Number.isFinite(v))) return { lines: [`${spec}: not a list (a,b,c) or range (start:stop:step) of values`] };
    const seconds = parseSI(args[forAt + 1], "s");
    if (!(seconds > 0)) return { lines: [`${args[forAt + 1]}: not a time`] };
    // the property and every value checked on the part itself (nothing is changed on it)
    try { for (const v of values) prepareProperty(part, [...words, String(v)]); } catch (error) { return { lines: [error instanceof Error ? error.message : String(error)] }; }
    const traces = [];
    for (const q of args.slice(forAt + 2)) {
      try { traces.push(m.traceFor(q)); } catch (error) { return { lines: [error instanceof Error ? error.message : String(error)] }; }
    }
    if (!traces.length) return { lines: [`Name what to plot, ${usage}`] };
    const r = m.paramSweep(part, values, (v) => si(v, ""), (copy, v) => prepareProperty(copy, [...words, String(v)])(), seconds, traces);
    if (typeof r === "string") return { lines: [`Parameter sweep: ${r}.`] };
    selectTab("scopes");
    return { lines: [`${r.sweep!.title}: ${values.length} runs of ${si(seconds, "s", true)} in scope ${m.scopes.indexOf(r) + 1}${r.sweep!.failed.length ? `, ${r.sweep!.failed.length} stopped` : ""}.`] };
  }

  /** `power`: the report; `power reset`; `power load <part> [on|off]`. */
  function powerCommand(args: string[]): import("./terminal").ConsoleResult {
    const m = doc.model;
    if (args[0] === "reset") { m.power.reset(); return { lines: ["Power averages restarted."] }; }
    if (args[0] === "load") {
      const elm = m.circuit.elements.find((e) => m.designator(e)?.toLowerCase() === args[1]?.toLowerCase());
      if (!elm) return { lines: [`${args[1]}: no such part`] };
      const name = m.designator(elm);
      if (args[2]) { doc.edit(() => (elm.powerLoad = args[2].toLowerCase() === "on")); edited(); inspector.setModel(m); }
      return { lines: [`${name} ${elm.powerLoad ? "is" : "isn't"} a load.`] };
    }
    const r = m.power.report();
    if (!r) return { lines: ["Run the simulation first."] };
    const name = (e: CircuitElm) => m.designator(e) ?? m.kindName(e);
    const w = (p: number) => si(p, "W", true);
    const lines: string[] = [r.marker
      ? `Averages over ${r.cycles} cycle${r.cycles === 1 ? "" : "s"} of ${name(r.marker)} (${si(r.seconds, "s", true)}, ${si(r.cycles / r.seconds, "Hz", true)}).`
      : `Averages over the run so far (${si(r.seconds, "s", true)}; no repeating switch or rectifier found).`];
    lines.push(`Input ${w(r.input)}${r.sources.length ? `: ${r.sources.map((x) => `${name(x.elm)} ${w(x.power)}`).join(", ")}` : ""}.`);
    const loads = r.parts.filter((x) => x.elm.powerLoad);
    lines.push(r.output === null
      ? "Output: no parts marked as loads (power load <part> on)."
      : `Output ${w(r.output)}: ${loads.map((x) => `${name(x.elm)} ${w(x.power)}`).join(", ")}. Efficiency ${r.input > 0 ? `${((100 * r.output) / r.input).toFixed(1)}%` : "–"}.`);
    // stored: what capacitors and inductors gained (not losses; about 0 once the circuit settles)
    const worth = (p: number) => Math.abs(p) > 1e-4 * Math.max(Math.abs(r.input), 1e-12);
    const stored = r.parts.filter((x) => !x.elm.powerLoad && storesEnergy(x.elm)).reduce((s, x) => s + x.power, 0);
    if (worth(stored)) lines.push(`Stored ${w(stored)} (capacitors and inductors, not yet settled).`);
    // the losses: everything else taking a share worth listing
    const losses = r.parts.filter((x) => !x.elm.powerLoad && !storesEnergy(x.elm) && worth(x.power));
    const total = losses.reduce((s, x) => s + x.power, 0);
    const rows = losses.map((x) => [name(x.elm), m.kindName(x.elm), w(x.power),
      x.switching !== undefined ? `conduction ${w(x.power - x.switching)}, switching ${w(x.switching)}` : ""]);
    return { lines: [...lines, `Losses ${w(total)}:`], tables: rows.length ? [{ headers: [], rows }] : [] };
  }

  function consoleComplete(line: string): string[] {
    return completeConsole(line, doc.model.circuit.elements.map((e) => doc.model.designator(e) ?? "").filter(Boolean), modelLibrary.all.map((m) => m.name), { scopeTraces: doc.model.scopes.map((s) => s.visibleTraces.length), tabs: docs.length, noCircuit: docs.length === 0 });
  }

  async function consoleModels(args: string[], signal?: AbortSignal): Promise<import("./terminal").ConsoleResult> {
    await modelLibrary.load();
    if (args[0] === "check") {
      const entry = modelLibrary.find(args.slice(1).join(" "));
      if (!entry) throw new Error("models check: no such model");
      if (!desktop) return { lines: ["Model comparison requires ngspice in the desktop app. No check was run."] };
      const cancel = () => desktop?.cancelChecks();
      signal?.addEventListener("abort", cancel, { once: true });
      let result;
      try { result = await desktop.models.check(JSON.stringify([entry])); }
      finally { signal?.removeEventListener("abort", cancel); }
      if (signal?.aborted) throw new Error("Cancelled.");
      if ("error" in result) throw new Error(result.error);
      return { tables: [numberedTable(["Model", "Difference", "Note"], result.results.map((r) => [r.name,
        r.error === null ? "—" : `${Number(r.error.toPrecision(4))}%`, r.error === null ? `not checked: ${r.note}` : "from ngspice"]), true)] };
    }
    if (args[0] === "import") {
      const link = args.slice(1).join(" ");
      let files: { text: string; path: string }[];
      if (link) {
        if (!/^https?:\/\//i.test(link)) throw new Error("models import: use a web link, or omit it to choose local files");
        if (desktop) {
          const result = await desktop.models.download(link);
          if ("error" in result) throw new Error(result.error);
          files = [{ path: result.name, text: result.text }];
        } else {
          const response = await fetch(link, { signal });
          if (!response.ok) throw new Error(`Download failed (${response.status})`);
          files = [{ path: link, text: await response.text() }];
        }
      } else if (desktop) files = await desktop.models.openFiles();
      else files = await new Promise<{ path: string; text: string }[]>((resolve) => {
        const input = Object.assign(document.createElement("input"), { type: "file", multiple: true, accept: ".lib,.mod,.cir,.txt,.spice" });
        input.oncancel = () => resolve([]);
        input.onchange = async () => resolve(await Promise.all(Array.from(input.files ?? []).map(async (f) => ({ path: f.name, text: await f.text() }))));
        input.click();
      });
      if (signal?.aborted) throw new Error("Cancelled.");
      const results = files.map((f) => findModels(f.text, f.path));
      const models = results.flatMap((r) => r.models);
      if (!models.length) return { lines: [files.length ? "No supported models found." : "Import cancelled."] };
      const collisions = models.filter((m) => modelLibrary.find(m.name));
      if (collisions.length) throw new Error(`Import would replace existing models (${collisions.map((m) => m.name).join(", ")}). Use the Model library dialog to review replacements.`);
      await modelLibrary.add(models);
      return { lines: [`Imported ${models.length} models.`, ...results.flatMap((r) => r.skipped.map((s) => `Skipped: ${s}`))],
        tables: [numberedTable(["Model", "Kind"], models.map((m) => [m.name, m.kind]))] };
    }
    const terms = args.map((s) => s.toLowerCase());
    const list = modelLibrary.all.filter((m) => terms.every((term) => `${m.kind} ${m.name} ${m.description ?? ""}`.toLowerCase().includes(term)));
    return list.length ? { tables: [numberedTable(["Model", "Kind", "Description"], list.map((m) => [m.name, m.kind, m.description ?? ""]))] }
      : { lines: ["No matching models."] };
  }

  function consoleTool(tool: string, count: number, signal?: AbortSignal): Promise<import("./terminal").ConsoleResult> {
    const text = doc.model.serialize("xml").text;
    return new Promise((resolve, reject) => {
      const worker = new Worker("console-tools-worker.js");
      const finish = (error?: string, result: import("./terminal").ConsoleResult = {}) => { clearTimeout(timeout); signal?.removeEventListener("abort", cancel); worker.terminate(); error ? reject(new Error(error)) : resolve(result); };
      const cancel = () => finish("Cancelled.");
      const timeout = setTimeout(() => finish("Tool stopped after the 120-second limit; try fewer runs/steps."), 120000);
      signal?.addEventListener("abort", cancel, { once: true });
      worker.onmessage = (e) => finish(e.data.error, { lines: e.data.lines, tables: e.data.tables });
      worker.onerror = (e) => finish(e.message || "Tool failed.");
      worker.postMessage({ text, tool, count, solver: settings.solver, relTol: settings.relTol });
    });
  }
  const requestedPanel = new URLSearchParams(location.search).get("panel");
  selectTab(requestedPanel === "scopes" ? "scopes" : "terminal");

  $("scopes").addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (scopes.tileMenuAt(e.clientX, e.clientY)) return;
    const s = scopes.scopeAt(e.clientX, e.clientY);
    if (s) scopeMenu(e.clientX, e.clientY, s);
  });


  const statusbar = new StatusBar($("statusbar"), () => {
    updateSettings({ showBottomPanel: true });
    selectTab("messages");
  });

  const partKeys = new WeakMap<object, number>();
  let nextPartKey = 0;
  const partKey = (e: object) => {
    let k = partKeys.get(e);
    if (k === undefined) partKeys.set(e, k = nextPartKey++);
    return k;
  };
  /** Log a circuit's standing problems (unsupported parts, model problems, a stopped run) as they appear. */
  function watchConditions(d: CircuitDocument): void {
    const m = d.model;
    const now: [string, MessageKind, string, object?][] = [];
    for (const type of [...m.circuit.unsupportedTypes.keys()].sort()) now.push([`unsupported ${type}`, "warning", `${type}: unsupported component, left out of the simulation.`]);
    for (const e of m.circuit.elements) {
      const { problems, warnings } = m.partIssues(e);
      for (const p of problems) now.push([`${partKey(e)} ${p}`, "error", p, e]);
      for (const w of warnings) now.push([`${partKey(e)} ${w}`, "warning", w, e]);
    }
    if (m.sim.stopMessage) now.push([`stop ${m.sim.stopMessage}`, "error", `Simulation stopped: ${m.sim.stopMessage}`]);
    // the inspector's notes on settings and the run (it shows none itself)
    now.push(...circuitNotes(m));
    d.conditions.update(d.messages, now);
  }
  let lastConditions = 0;

  let lastStatus = 0;
  function refreshStatus(force = false): void {
    const now = performance.now();
    if (!force && now - lastStatus < 100) return;
    lastStatus = now;
    if (now - lastConditions > 500) { lastConditions = now; watchConditions(doc); }
    if (!$("bottom").hidden && !$("messages-pane").hidden) { messages.refresh(); doc.messages.markSeen(); }
    const m = doc.model;
    const time = si(m.sim.t, "s", true, 4);
    const stopped = m.sim.stopMessage;
    const focus = m.selected ?? canvas.hover;
    statusbar.render({
      stateLabel: m.running ? "Running" : "Paused",
      stateColor: stopped ? "var(--error)" : m.running ? "var(--accent-light)" : "var(--text3)",
      summary: time,
      detail: stopped ?? (focus ? m.infoLines(focus).join("     ") : m.selection.size > 1 ? `${m.selection.size} parts selected` : ""),
      hint: status.hint && now < status.hintUntil ? status.hint : null,
      unseenProblems: doc.messages.unseen,
      problemKind: doc.messages.worstUnseen ?? undefined,
      readouts: [
        ...(canvas.mouseWorld ? [`X ${Math.round(canvas.mouseWorld[0])}   Y ${Math.round(canvas.mouseWorld[1])}`] : []),
        `Grid ${gridSize(m)}`,
        `${Math.round(canvas.viewport.scale * 100)}%`,
      ],
    });
    inspector.update(time, focus ? m.infoLines(focus) : [], m.selected !== null);
  }


  const frame = (t: number) => {
    doc.model.advance(t / 1000);
    const audible = scopeAudio.listeningScope;
    if (audible && (doc.model.scopes.includes(audible) || [...doc.model.sheetScopes.values()].includes(audible))
      && !audible.visibleTraces.includes(scopeAudio.listeningTrace!)) {
      const trace = audioTrace(audible);
      if (trace) listenTo(audible, trace, scopeAudio.mode);
    }
    scopeAudio.frame(doc.model);
    canvas.draw();
    if (!$("bottom").hidden && !$("scopes-pane").hidden) scopes.draw();
    refreshStatus();
    requestAnimationFrame(frame);
  };
  activate(doc);
  requestAnimationFrame(frame);
  // redraw immediately on resize, so the canvas never shows a frame laid out for the old size
  new ResizeObserver(() => {
    canvas.draw();
    scopes.draw();
  }).observe($("workspace"));

  // after a crash: offer the circuits it left unsaved
  void offerRecovery();
}

/** Keyboard shortcuts window: the menu shortcuts (from the command registry), then part keys. */
function shortcutGroups(menus: MenuNode[]): [string, [string, string][]][] {
  const partByClass = new Map(partGroups.flat().map((tool) => [tool.classes[0], tool] as const));
  const partOrder = [...partGroups[0].map((tool) => tool.classes[0]), ...PALETTE_GROUPS.flatMap((group) => group.classes)];
  const parts = partOrder.flatMap((className) => {
    const tool = partByClass.get(className);
    return tool?.shortcut ? [[tool.shortcut, tool.name] as [string, string]] : [];
  });
  // one group per menu, from the menus themselves, then the keys that place parts
  return [...menuShortcutGroups(menus, (key) => shortcutText(key)), ["Placing parts", parts]];
}

/** Start with desktop files or the browser's ?c= circuit; otherwise show the welcome screen. */
async function initialDocuments(library: Library): Promise<CircuitDocument[]> {
  const host = desktop;
  return initialDocumentFiles({
    desktopFiles: host ? () => host.initialFiles() : undefined,
    examplePath: new URLSearchParams(location.search).get("c"),
    fromDesktopFile: (f) => new CircuitDocument(f.text, { path: f.path, title: library.titles.get(f.path.split(/[\\/]/).pop()!) ?? null }),
    loadExample: async (file) => new CircuitDocument(await loadText(`circuits/${file}`), { name: file, title: library.titles.get(file) ?? null, sample: true }),
  });
}

main().catch((err) => {
  document.body.innerHTML = `<pre class="startup-error">NodeForge failed to start:\n${(err as Error).stack ?? err}</pre>`;
});
