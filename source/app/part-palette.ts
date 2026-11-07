// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { portedClassNames } from "../engine";
import { partGroups, type PartTool } from "./icons";
import { type DrawItem, drawLabel } from "./library";

export interface PalettePart {
  className: string;
  name: string;
  group: string;
  icon: PartTool | null;
  available: boolean;
}

export const PALETTE_GROUPS = [
  { name: "Switches / protection", iconClass: "SwitchElm", classes: ["SwitchElm", "PushSwitchElm", "Switch2Elm", "FuseElm"] },
  { name: "Sources", iconClass: "DCVoltageElm", classes: ["DCVoltageElm", "ACVoltageElm", "RailElm", "CurrentElm", "BatteryElm"] },
  { name: "Active parts", iconClass: "DiodeElm", classes: ["DiodeElm", "ZenerElm", "LEDElm", "NTransistorElm", "PTransistorElm", "NMosfetElm", "PMosfetElm", "OpAmpElm"] },
  { name: "Transformers", iconClass: "TransformerElm", classes: ["TransformerElm", "TappedTransformerElm", "CustomTransformerElm"] },
  { name: "Logic gates", iconClass: "AndGateElm", classes: ["AndGateElm", "OrGateElm", "InverterElm", "NandGateElm", "NorGateElm", "XorGateElm"] },
] as const;

const menuGroups: Record<string, string> = {
  "Passive Components": "Wires and passives",
  "Inputs and Sources": "Sources",
  "Outputs and Labels": "Outputs and labels",
  "Active Components": "Active devices",
  "Active Building Blocks": "Analog blocks",
  "Logic Gates, Input and Output": "Logic and digital",
  "Digital Chips": "Logic and digital",
  "Analog and Hybrid Chips": "Analog blocks",
};

const iconByClass = new Map(partGroups.flat().map((tool) => [tool.classes[0], tool]));

/** Every placeable Draw-menu part, indexed for the curated toolbar and optional search. */
export function paletteParts(draw: DrawItem[]): PalettePart[] {
  const parts: PalettePart[] = [], seen = new Set<string>();
  const add = (item: DrawItem, group: string): void => {
    if (!item.class || seen.has(item.class)) return;
    seen.add(item.class);
    parts.push({
      className: item.class,
      name: drawLabel(item.label),
      group,
      icon: iconByClass.get(item.class) ?? null,
      available: portedClassNames.has(item.class),
    });
  };
  for (const item of draw) {
    if (item.items) {
      const group = menuGroups[item.label];
      if (group) for (const child of item.items) add(child, group);
    } else if (item.class && item.class !== "Select") add(item, "Wires and passives");
  }
  return parts;
}

const normalize = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Match all query words and put exact and leading name matches first. */
export function searchPalette(parts: PalettePart[], query: string): PalettePart[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const ranked = parts.flatMap((part, order) => {
    const name = normalize(part.name), group = normalize(part.group), className = normalize(part.className);
    if (!words.every((word) => name.includes(word) || group.includes(word) || className.includes(word))) return [];
    const phrase = words.join(" ");
    const score = name === phrase ? 0 : name.startsWith(phrase) ? 1
      : words.every((word) => name.includes(word)) ? 2 : 3;
    return [{ part, score, order }];
  });
  ranked.sort((a, b) => a.score - b.score || a.order - b.order);
  return ranked.map(({ part }) => part);
}
