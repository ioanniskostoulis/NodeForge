// Licensed under the GNU General Public License v2 or later. See LICENSE.
//
// Tool icons as SVG. Parts are drawn as their schematic symbols (26×16), like CircuitJS's toolbar
// and CAD palettes; edit/view actions are the shell's line icons (16×16).

import { BUTTON_GLYPHS, UI_ICONS } from "forge-shell/app/tool-icons";
import { inductorCurves } from "./geom";

const inductorPath = "M0 8H3" + inductorCurves(20, 4).map((curve) =>
  "C" + curve.map((p) => `${p.x + 3} ${p.y + 8}`).join(" ")).join("") + "H26";

const svg = (w: number, h: number, body: string, stroke = 1.3) =>
  `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const part = (body: string) => svg(26, 16, body);

/** IEC schematic symbols, sized and stroked like the other palette parts. */
export const iecPartIcons = {
  resistor: part('<path d="M0 8H5M5 5H21V11H5ZM21 8H26"/>'),
  fuse: part('<path d="M0 8H6M20 8H26M6 4H20V12H6ZM8.5 4V12M17.5 4V12"/>'),
  and: part('<path d="M1 5H6M1 11H6M6 2H20V14H6ZM20 8H25"/><text x="13" y="8" fill="currentColor" stroke="none" font-size="9" font-weight="600" text-anchor="middle" dominant-baseline="central">&amp;</text>'),
  or: part('<path d="M1 5H6M1 11H6M6 2H20V14H6ZM20 8H25"/><text x="13" y="8" fill="currentColor" stroke="none" font-size="7" font-weight="600" text-anchor="middle" dominant-baseline="central">≥1</text>'),
  not: part('<path d="M1 8H7M7 2H18V14H7ZM22 8H25"/><circle cx="20" cy="8" r="2"/><text x="12.5" y="8" fill="currentColor" stroke="none" font-size="9" font-weight="600" text-anchor="middle" dominant-baseline="central">1</text>'),
  nand: part('<path d="M1 5H6M1 11H6M6 2H19V14H6ZM23 8H25"/><circle cx="21" cy="8" r="2"/><text x="12.5" y="8" fill="currentColor" stroke="none" font-size="9" font-weight="600" text-anchor="middle" dominant-baseline="central">&amp;</text>'),
  nor: part('<path d="M1 5H6M1 11H6M6 2H19V14H6ZM23 8H25"/><circle cx="21" cy="8" r="2"/><text x="12.5" y="8" fill="currentColor" stroke="none" font-size="7" font-weight="600" text-anchor="middle" dominant-baseline="central">≥1</text>'),
  xor: part('<path d="M1 5H6M1 11H6M6 2H20V14H6ZM20 8H25"/><text x="13" y="8" fill="currentColor" stroke="none" font-size="8" font-weight="600" text-anchor="middle" dominant-baseline="central">=1</text>'),
};

export interface PartTool {
  id: string;
  name: string;
  /** CircuitJS class names that implement it (to know whether it has been ported). */
  classes: string[];
  shortcut?: string;
  icon: string;
}

/** The default palette, grouped like CircuitJS's toolbar. */
export const partGroups: PartTool[][] = [
  [
    { id: "wire", name: "Wire", classes: ["WireElm"], shortcut: "w", icon: part('<path d="M3 12L23 4"/><circle cx="3" cy="12" r="1.5"/><circle cx="23" cy="4" r="1.5"/>') },
    { id: "resistor", name: "Resistor", classes: ["ResistorElm"], shortcut: "r", icon: part('<path d="M0 8H5l1-3 2 6 2-6 2 6 2-6 2 6 2-6 2 6 1-3H26"/>') },
    { id: "capacitor", name: "Capacitor", classes: ["CapacitorElm"], shortcut: "c", icon: part('<path d="M0 8H11M15 8H26M11 2V14M15 2V14"/>') },
    { id: "inductor", name: "Inductor", classes: ["InductorElm"], shortcut: "L", icon: part(`<path d="${inductorPath}"/>`) },
    { id: "ground", name: "Ground", classes: ["GroundElm"], shortcut: "g", icon: part('<path d="M13 1V8M6 8H20M8.5 11H17.5M11 14H15"/>') },
  ],
  [
    { id: "dcsource", name: "DC voltage source", classes: ["DCVoltageElm"], shortcut: "v", icon: part('<path d="M0 8H11M15 8H26M11 1.5V14.5"/><rect x="13.75" y="3.75" width="2.5" height="8.5" rx="1.25" fill="currentColor" stroke="none"/>') },
    { id: "acsource", name: "AC voltage source", classes: ["ACVoltageElm"], shortcut: "A", icon: part('<path d="M0 8H6.5M19.5 8H26M9 8q2-6 4 0t4 0"/><circle cx="13" cy="8" r="6.5"/>') },
    { id: "rail", name: "Voltage rail", classes: ["RailElm"], shortcut: "V", icon: part('<path d="M13 15V5M6 5H20"/>') },
    { id: "switch", name: "Switch", classes: ["SwitchElm"], shortcut: "s", icon: part('<path d="M0 11H7L19 4M19 11H26"/><circle cx="7" cy="11" r="1"/><circle cx="19" cy="11" r="1"/>') },
    { id: "current", name: "Current source", classes: ["CurrentElm"], shortcut: "i", icon: part('<path d="M0 8H6.5M19.5 8H26M9.5 8H16.5M14 5.5L16.5 8L14 10.5"/><circle cx="13" cy="8" r="6.5"/>') },
    { id: "battery", name: "Battery", classes: ["BatteryElm"], shortcut: "b", icon: part('<path d="M0 8H7M19 8H26M7 2V14M15 2V14"/><rect x="9.75" y="3.75" width="2.5" height="8.5" rx="1.25" fill="currentColor" stroke="none"/><rect x="17.75" y="3.75" width="2.5" height="8.5" rx="1.25" fill="currentColor" stroke="none"/>') },
    { id: "transformer", name: "Transformer", classes: ["TransformerElm"], shortcut: "T", icon: part('<path d="M0 2H4C8 2 8 5 4 5C8 5 8 8 4 8C8 8 8 11 4 11C8 11 8 14 4 14H0M26 2H22C18 2 18 5 22 5C18 5 18 8 22 8C18 8 18 11 22 11C18 11 18 14 22 14H26M11 1V15M15 1V15"/>') },
    { id: "tapped-transformer", name: "Tapped transformer", classes: ["TappedTransformerElm"], shortcut: "y", icon: part('<path d="M0 2H4C8 2 8 5 4 5C8 5 8 8 4 8C8 8 8 11 4 11C8 11 8 14 4 14H0M26 2H22C18 2 18 5 22 5C18 5 18 8 22 8C18 8 18 11 22 11C18 11 18 14 22 14H26M26 8H22M11 1V15M15 1V15"/>') },
    { id: "custom-transformer", name: "Custom transformer", classes: ["CustomTransformerElm"], shortcut: "C", icon: part('<path d="M0 1H4C8 1 8 4 4 4C8 4 8 7 4 7H0M0 9H4C8 9 8 12 4 12C8 12 8 15 4 15H0M26 2H22C18 2 18 5 22 5C18 5 18 8 22 8C18 8 18 11 22 11C18 11 18 14 22 14H26M11 1V15M15 1V15"/>') },
    { id: "push-switch", name: "Push switch", classes: ["PushSwitchElm"], shortcut: "S", icon: part('<path d="M0 11H7M19 11H26M7 7H19M13 7V3"/><circle cx="7" cy="11" r="1"/><circle cx="19" cy="11" r="1"/>') },
    { id: "spdt-switch", name: "SPDT switch", classes: ["Switch2Elm"], shortcut: "P", icon: part('<path d="M0 8H7L19 3M19 3H26M19 13H26"/><circle cx="7" cy="8" r="1"/><circle cx="19" cy="3" r="1"/><circle cx="19" cy="13" r="1"/>') },
  ],
  [
    { id: "diode", name: "Diode", classes: ["DiodeElm"], shortcut: "d", icon: part('<path d="M0 8H26M9 3L16 8L9 13ZM16 3V13"/>') },
    { id: "zener", name: "Zener diode", classes: ["ZenerElm"], shortcut: "z", icon: part('<path d="M0 8H26M9 3L16 8L9 13ZM14 1.5L16 3V13L18 14.5"/>') },
    { id: "led", name: "LED", classes: ["LEDElm"], shortcut: "l", icon: part('<path d="M0 8H6.5M19.5 8H26M6.5 8H10M16 8H19.5M10 5L16 8L10 11ZM16 5V11"/><circle cx="13" cy="8" r="6.5"/>') },
    { id: "npn", name: "NPN transistor", classes: ["NTransistorElm"], shortcut: "t", icon: part('<path d="M2 8H10M10 2V14M10 5.5L17 1M10 10.5L17 15M13.5 14.5L17 15L15.5 11.8"/>') },
    { id: "pnp", name: "PNP transistor", classes: ["PTransistorElm"], shortcut: "p", icon: part('<path d="M2 8H10M10 2V14M10 5.5L17 1M10 10.5L17 15M10.5 10.8L10 10.5L13.6 10.1"/>') },
    { id: "nmos", name: "N-MOSFET", classes: ["NMosfetElm"], shortcut: "f", icon: part('<path d="M2 13H8V3M11 2V14M11 3.5H18V0M11 12.5H18V16M11 8H18M13.5 6L11.5 8L13.5 10"/>') },
    { id: "pmos", name: "P-MOSFET", classes: ["PMosfetElm"], shortcut: "F", icon: part('<path d="M2 13H8V3M11 2V14M11 3.5H18V0M11 12.5H18V16M11 8H18M15.5 6L17.5 8L15.5 10"/>') },
    { id: "fuse", name: "Fuse", classes: ["FuseElm"], shortcut: "u", icon: part('<path d="M0 8H26M6 4H20V12H6Z"/>') },
    { id: "opamp", name: "Op amp", classes: ["OpAmpElm"], shortcut: "a", icon: part('<path d="M6 1L21 8L6 15ZM0 4.5H6M0 11.5H6M21 8H26M7.5 4.5H10.5M7.5 11.5H10.5M9 10V13"/>') },
  ],
  [
    { id: "and", name: "AND gate", classes: ["AndGateElm"], shortcut: "n", icon: part('<path d="M7 2H13A6 6 0 0 1 13 14H7ZM1 5H7M1 11H7M19 8H25"/>') },
    { id: "or", name: "OR gate", classes: ["OrGateElm"], shortcut: "o", icon: part('<path d="M6 2Q16 2 20 8Q16 14 6 14Q10 8 6 2ZM1 5H8M1 11H8M20 8H25"/>') },
    { id: "not", name: "Inverter", classes: ["InverterElm"], shortcut: "1", icon: part('<path d="M7 2L17 8L7 14ZM1 8H7M21 8H25"/><circle cx="19" cy="8" r="2"/>') },
    { id: "nand", name: "NAND gate", classes: ["NandGateElm"], shortcut: "N", icon: part('<path d="M7 2H12A6 6 0 0 1 12 14H7ZM1 5H7M1 11H7M21 8H25"/><circle cx="19.5" cy="8" r="1.5"/>') },
    { id: "nor", name: "NOR gate", classes: ["NorGateElm"], shortcut: "O", icon: part('<path d="M6 2Q15 2 19 8Q15 14 6 14Q10 8 6 2ZM1 5H8M1 11H8M22 8H25"/><circle cx="20.5" cy="8" r="1.5"/>') },
    { id: "xor", name: "XOR gate", classes: ["XorGateElm"], shortcut: "x", icon: part('<path d="M6 2Q16 2 20 8Q16 14 6 14Q10 8 6 2ZM3.5 2Q7.5 8 3.5 14M1 5H6M1 11H6M20 8H25"/>') },
  ],
];

/** The tool strip's edit actions and the inspector's run controls: the shell's shared icons and glyphs. */
export const actionIcons = {
  search: UI_ICONS.search,
  duplicate: UI_ICONS.duplicate,
  rotate: UI_ICONS.rotate,
  trash: UI_ICONS.delete,
  select: UI_ICONS.pointer,
  play: BUTTON_GLYPHS.play,
  stop: BUTTON_GLYPHS.stop,
  reset: BUTTON_GLYPHS.reset,
  step: BUTTON_GLYPHS.step,
};
