// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { portedClassNames } from "../engine";
import { menuCommand } from "./commands";
import { actionIcons, iecPartIcons, partGroups, type PartTool } from "./icons";
import type { DrawItem } from "./library";
import type { MenuState } from "./menus";
import { PALETTE_GROUPS, paletteParts, searchPalette, type PalettePart } from "./part-palette";
import { settings } from "./settings";
import { createFlyoutGroup, type FlyoutTool } from "forge-shell/app/tool-flyout";
import { TOOL_ICONS } from "forge-shell/app/tool-icons";
import { createToolSearch } from "forge-shell/app/tool-search";
import { createToolStrip } from "forge-shell/app/tool-strip";
import { modeLabel } from "forge-shell/app/tool-modes";

const TOOLBAR_SEARCH = false;

export interface ToolStrip {
  /** Reflect the active tab: enabled actions and the current tool. */
  update(state: MenuState, toolName: string | null): void;
}

/** The tool strip: edit actions, view actions, the select tool, then the part palette. */
export function buildToolStrip(root: HTMLElement, draw: DrawItem[], run: (id: string) => void): ToolStrip {
  const strip = createToolStrip(root, run);
  const { group, tool, buttons: byId } = strip;
  // label and accelerator come from the action registry (`commands.ts`)
  const action = (id: string, icon: string, placement?: string): HTMLButtonElement => {
    const { label, key, hint } = menuCommand(id);
    return tool({ id, icon, label, shortcut: key ?? hint, placement });
  };

  group([action("edit.undo", TOOL_ICONS.undo), action("edit.redo", TOOL_ICONS.redo)], "", "history");
  group([
    action("edit.cut", TOOL_ICONS.cut),
    action("edit.copy", TOOL_ICONS.copy),
    action("edit.paste", TOOL_ICONS.paste),
    action("edit.duplicate", actionIcons.duplicate),
    action("edit.rotateCW", actionIcons.rotate),
    action("edit.delete", actionIcons.trash),
  ], "", "clipboard");
  group([action("view.fit", TOOL_ICONS.fit), action("view.zoomIn", TOOL_ICONS.zoomIn), action("view.zoomOut", TOOL_ICONS.zoomOut)], "", "view");
  group([action("tool.select", actionIcons.select, "drag components to move them or empty space to select.")]);
  const toolClasses = new Map<string, string>();
  const basicTools = new Map(partGroups.flat().map((t) => [t.id, t] as const));
  const palette = paletteParts(draw);
  const parts = new Map(palette.map((part) => [part.className, part]));
  const iconFor = (part: PalettePart): string => {
    const tool = part.icon;
    if (tool) return settings.symbolStyle === "iec" && tool.id in iecPartIcons
      ? iecPartIcons[tool.id as keyof typeof iecPartIcons] : tool.icon;
    return "";
  };
  // a letter key: lower case is the bare key, upper case is Shift with it
  const partKey = (key?: string): string | undefined => key && (/^[A-Z]$/.test(key) ? `Shift+${key}` : key);
  const partButton = (t: PartTool): HTMLButtonElement => {
    const ported = t.classes.some((c) => portedClassNames.has(c));
    const id = `tool:${t.classes[0]}`;
    toolClasses.set(id, t.classes[0]);
    return tool({
      id, icon: iconFor(parts.get(t.classes[0])!), label: t.name, shortcut: partKey(t.shortcut),
      placement: ported ? "click or drag to place." : "unsupported component.", enabled: ported,
    });
  };
  // Keep the five basic parts visible; each remaining family opens a compact picker.
  group(BASIC_PARTS.map((id) => partButton(basicTools.get(id)!)));
  const flyouts = PALETTE_GROUPS.map(({ name, classes }) => {
    const members = classes.map((className) => parts.get(className));
    if (members.some((part) => !part?.icon)) throw new Error(`Missing toolbar part or icon in ${name}`);
    const availableMembers = members as PalettePart[];
    const tools: (FlyoutTool & { part: PalettePart })[] = availableMembers.map((part) => ({
      id: `tool:${part.className}`, icon: iconFor(part), label: part.name, shortcut: partKey(part.icon?.shortcut), enabled: part.available, part,
    }));
    const flyout = createFlyoutGroup({ id: `flyout:${name}`, label: name, tools, onSelect: run });
    for (const t of availableMembers) toolClasses.set(`tool:${t.className}`, t.className);
    return { ...flyout, name, tools };
  });
  group(flyouts.map(({ button }) => button), "flyout-group");

  if (TOOLBAR_SEARCH) {
    const search = createToolSearch({
      name: "parts",
      icon: actionIcons.search,
      search: (query) => searchPalette(palette.filter((part) => part.available), query)
        .map((part) => ({ id: part.className, label: part.name, category: part.group })),
      onSelect: (className) => run(`tool:${className}`),
    });
    root.append(search.root);
  }

  let shownStyle = "";
  strip.finish();
  return {
    update(state, toolName) {
      if (shownStyle !== settings.symbolStyle) {
        for (const f of flyouts) {
          f.close();
          for (const t of f.tools) t.icon = iconFor(t.part);
          f.setTool(f.tool.id);
        }
        for (const id of BASIC_PARTS) {
          const t = basicTools.get(id)!;
          byId.get(`tool:${t.classes[0]}`)!.innerHTML = iconFor(parts.get(t.classes[0])!);
        }
        shownStyle = settings.symbolStyle;
      }
      strip.setEnabled("edit.undo", state.canUndo);
      strip.setEnabled("edit.redo", state.canRedo);
      for (const id of ["edit.cut", "edit.copy", "edit.duplicate", "edit.rotateCW", "edit.delete"]) strip.setEnabled(id, state.hasSelection);
      strip.setSelected("tool.select", state.tool === null);
      for (const [id, cls] of toolClasses) strip.setSelected(id, state.tool === cls);
      for (const f of flyouts) {
        const active = f.tools.find((t) => t.part.className === state.tool);
        if (active) f.setTool(active.id);
        f.setSelected(!!active);
      }
      strip.setMode(state.tool ? modeLabel("Place", toolName ?? state.tool) : "Select");
    },
  };
}

const BASIC_PARTS = ["wire", "resistor", "capacitor", "inductor", "ground"];
