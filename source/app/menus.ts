// Licensed under the GNU General Public License v2 or later. See LICENSE.
//
// One menu definition, rendered two ways: as the native menu bar in the desktop app (sent to the
// Electron main process), and as an HTML menu bar in the browser. CircuitJS's order, fewer menus:
// File · Edit · View · Draw · Scopes · Simulation · Help (its Options are in View and Scopes, its
// Circuits in File › Open example).

import { portedClassNames } from "../engine";
import { isStandardAction, menuCommand } from "./commands";
import { standardItem, zoomItems } from "forge-shell/app/standard-items";
import { type DrawItem, drawLabel, type Library, type LibraryEntry } from "./library";
import { settings } from "./settings";
import { forgeApp } from "./profile";
import { helpMenu } from "forge-shell/app/about";
import { autosaveMenu, recentMenu } from "forge-shell/app/saving";

import type { MenuNode } from "forge-shell/app/menus";
export type { MenuNode } from "forge-shell/app/menus";
export { displayKey, matchesKey, renderMenubar, collectShortcuts } from "forge-shell/app/menus";

const sep: MenuNode = { separator: true };

/** What the menus need to know about the active tab. */
export interface MenuState {
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  /** CircuitJS class name of the active part tool, or null for the select tool. */
  tool: string | null;
  /** False on the welcome screen, where only the actions that need no circuit are enabled. */
  hasDocument: boolean;
  /** File › Open recent, newest first (desktop only: the browser has no paths to reopen). */
  recent: string[];
}

/** Actions that run with no circuit open: they open one or change an app preference. */
const WITHOUT_DOCUMENT = /^(file\.(new|newWindow|open|recent|autosave)|app\.settings|circuit:|toggle\.|current\.|solver\.|symbols\.|temperature\.|appearance\.|view\.(zoomIn|zoomOut|inspector|bottomPanel)$|about(?:\.|$))/;
export const availableWithoutDocument = (id: string): boolean => WITHOUT_DOCUMENT.test(id);

/** The welcome screen keeps every item of a menu, with the document-only ones disabled. */
function disableDocumentOnly(nodes: MenuNode[]): MenuNode[] {
  return nodes.map((node) => {
    if (node.submenu) {
      const submenu = disableDocumentOnly(node.submenu);
      const none = submenu.every((child) => child.separator || child.enabled === false);
      return { ...node, submenu, ...(none && submenu.length ? { enabled: false } : {}) };
    }
    return node.id && !availableWithoutDocument(node.id) ? { ...node, enabled: false } : node;
  });
}

export function buildMenus(draw: DrawItem[], library: Library, desktop: boolean, state: MenuState): MenuNode[] {
  // The standard items take their label and key from the shell (`standardItem`). NodeForge performs Cut, Copy, Paste and
  // Select all itself (parts on the sheet, or the focused text), so those items carry no native role.
  const product = { noun: forgeApp.document.noun, product: forgeApp.identity.name };
  const item = (id: string, state: Partial<MenuNode> = {}): MenuNode =>
    isStandardAction(id) ? standardItem(id, product, { role: undefined, ...state }) : { ...menuCommand(id), ...state };
  // only what can be placed: CircuitJS's own modes (Select/Drag Sel, the Drag submenu) are left out
  // (Select is the first item), and so is a group left empty
  const drawItems = (items: DrawItem[]): MenuNode[] => items.flatMap((d): MenuNode[] => {
    if (d.items) {
      const sub = drawItems(d.items);
      return sub.length ? [{ label: drawLabel(d.label), submenu: sub }] : [];
    }
    // (the old wattmeter stays only for files that have one)
    return d.class && portedClassNames.has(d.class) && !/\(old\)$/.test(d.label)
      ? [{ label: drawLabel(d.label), id: `tool:${d.class}`, checked: d.class === state.tool ? true : undefined }]
      : [];
  });
  const circuitItem = (e: LibraryEntry): MenuNode =>
    e.file ? { label: e.title, id: `circuit:${e.file}` } : { label: e.title, submenu: e.children.map(circuitItem) };
  const sel = state.hasSelection;

  // Each menu: what it's about, grouped by separators; a submenu's items don't repeat its name; a
  // setting with two options is a pair of choices; "…" only where more is asked (a dialog, or a
  // command to finish); keys beside items, never in their labels.
  const menus: MenuNode[] = [
    {
      label: "File",
      submenu: [
        item("file.new"),
        ...(desktop ? [item("file.newWindow")] : []),
        item("file.open"),
        ...(desktop ? [recentMenu(state.recent)] : []),
        // the CircuitJS circuit library (was its own Circuits menu)
        { label: "Open example", submenu: library.root.map(circuitItem) },
        sep,
        item("file.save"),
        item("file.saveAs"),
        ...(desktop ? [autosaveMenu(settings.autosave)] : []),
        { label: "Export as", submenu: [item("file.exportNfg"), item("file.exportXml"), item("file.exportText"), item("file.exportSpice")] },
        sep,
        item("file.close"),
        sep,
        item("app.settings"),
      ],
    },
    {
      label: "Edit",
      submenu: [
        item("edit.undo", { enabled: state.canUndo }),
        item("edit.redo", { enabled: state.canRedo }),
        sep,
        item("edit.cut"),
        item("edit.copy"),
        item("edit.paste"),
        item("edit.duplicate", { enabled: sel }),
        item("edit.delete", { enabled: sel }),
        sep,
        item("edit.selectAll"),
        sep,
        item("edit.rotateCW", { enabled: sel }),
        item("edit.rotateCCW", { enabled: sel }),
        item("edit.flipH", { enabled: sel }),
        item("edit.flipV", { enabled: sel }),
        sep,
        item("edit.properties", { enabled: sel }),
      ],
    },
    {
      // the view, the panels, then what the schematic shows (was Options)
      label: "View",
      submenu: [
        ...zoomItems(),
        sep,
        item("view.inspector", { checked: settings.showInspector }),
        item("view.bottomPanel", { checked: settings.showBottomPanel }),
        sep,
        item("toggle.showCurrent", { checked: settings.showCurrent }),
        item("toggle.showVoltage", { checked: settings.showVoltage }),
        item("toggle.showValues", { checked: settings.showValues }),
        item("toggle.showReadout", { checked: settings.showReadout }),
        item("toggle.showWireJumps", { checked: settings.showWireJumps }),
        sep,
        { label: "Current markers", submenu: [
          item("current.shape.dots", { checked: settings.currentShape === "dots" }),
          item("current.shape.arrows", { checked: settings.currentShape === "arrows" }),
          item("current.shape.squares", { checked: settings.currentShape === "squares" }),
          sep,
          item("current.electron", { checked: !settings.conventionalCurrent }),
          item("current.steadyBand", { checked: settings.currentSteadyBand }),
          ...(settings.currentSteadyBand ? [item("current.steadyArrows", { checked: settings.currentSteadyArrows })] : []),
        ] },
        { label: "Appearance", submenu: [
          item("appearance.light", { checked: settings.appearance === "light" }),
          item("appearance.dark", { checked: settings.appearance !== "light" }),
          sep,
          item("toggle.whiteBackground", { checked: settings.whiteBackground }),
          sep,
          item("symbols.us", { checked: settings.symbolStyle === "us" }),
          item("symbols.iec", { checked: settings.symbolStyle === "iec" }),
        ] },
        { label: "Temperature unit", submenu: [
          item("temperature.C", { checked: settings.temperatureUnit === "C" }),
          item("temperature.F", { checked: settings.temperatureUnit === "F" }),
          item("temperature.K", { checked: settings.temperatureUnit === "K" }),
        ] },
        item("toggle.wheelZooms", { checked: settings.wheelZooms }),
        sep,
        item("tab.next"),
        item("tab.prev"),
        ...(desktop ? [sep, { role: "togglefullscreen", label: "Toggle full screen" }, { role: "toggleDevTools", label: "Developer tools" }] : []),
      ],
    },
    { label: "Draw", submenu: [item("tool.select", { checked: state.tool === null }), sep, ...drawItems(draw)] },
    {
      label: "Scopes",
      submenu: [
        item("scopes.stack"),
        item("scopes.unstack"),
        item("scopes.combine"),
        item("scopes.separate"),
        sep,
        item("toggle.linkedReadout", { checked: settings.linkedReadout }),
        sep,
        // (after the arrangement, so a menu opened with nothing selected doesn't start greyed)
        item("scope.add", { enabled: sel }),
        item("scopes.clear"),
      ],
    },
    {
      label: "Simulation",
      submenu: [
        item("sim.toggle"),
        item("sim.step"),
        item("sim.reset"),
        sep,
        item("solver.nodeforge", { checked: settings.solver === "nodeforge" }),
        item("solver.circuitjs", { checked: settings.solver !== "nodeforge" }),
        sep,
        item("sim.operatingPoint"),
        item("sim.power"),
        sep,
        item("sim.recommend"),
        item("toggle.backgroundAnalysis", { checked: settings.backgroundAnalysis }),
        sep,
        item("models.library"),
      ],
    },
    // last, as on macOS (where About NodeForge is in the app menu instead); updates are offered in Settings › Updates
    helpMenu(forgeApp.identity.name, desktop && isMac),
  ];
  return state.hasDocument ? menus : disableDocumentOnly(menus);
}

const isMac = /Mac/.test(navigator.platform);
