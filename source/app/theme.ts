// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { OVERLAY_PICK } from "forge-shell/app/canvas-overlay";
import { settings } from "./settings";

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
const byte = (v: number): string => HEX[Math.max(0, Math.min(255, Math.round(v)))];

/** A colour from 0–255 channels and an optional alpha (0–1) as `#rrggbb` or `#rrggbbaa`. */
export function rgbColor(r: number, g: number, b: number, alpha = 1): string {
  return `#${byte(r)}${byte(g)}${byte(b)}${alpha < 1 ? byte(alpha * 255) : ""}`;
}

/** Electron-flow markers and fast bands use the same cyan on every sheet. */
export const ELECTRON_MARKER_COLOR = "#2fd3e6";

/** Signal colors on light sheets and plots. */
export const LIGHT_SIGNALS = {
  voltage: "#00a83c",
  negative: "#ed3434",
  current: "#ffd23f",
  power: "#ef541b",
  charge: "#0098b8",
};

/**
 * Schematic sheet colors. The dark sheet follows CircuitJS's conventions (green for positive,
 * red for negative voltage, yellow current, cyan selection); "White background" switches to paper.
 * Interface chrome colors live in app.css.
 */
export interface Theme {
  background: string;
  gridMinor: string;
  gridMajor: string;
  /** Component bodies and symbols. */
  ink: string;
  valueText: string;
  designatorText: string;
  openPin: string;
  /** Cyan hover/selection for schematic parts, handles and drag boxes, separate from the UI theme accent. */
  accent: string;
  current: string;
  unsupported: string;
  unsupportedText: string;
  error: string;
  readoutBackground: string;
  readoutBorder: string;
  readoutText: string;
  /** Wire colors along the voltage scale: negative ← neutral → positive (RGB 0–1). */
  negative: [number, number, number];
  neutral: [number, number, number];
  positive: [number, number, number];
}

export const darkTheme: Theme = {
  background: "#131313",
  gridMinor: "#ffffff14",
  gridMajor: "#ffffff0a",
  ink: "#f0f0f0",
  valueText: "#c4c4c4",
  designatorText: "#ededed",
  openPin: "#9a9a9a",
  accent: OVERLAY_PICK.dark,
  current: "#ffd23f",
  unsupported: "#e0a040",
  unsupportedText: "#e8b460",
  error: "#ff3b30",
  readoutBackground: "#232323",
  readoutBorder: "#ffffff24",
  readoutText: "#c8c8c8",
  negative: [1.0, 0.27, 0.21],
  neutral: [0.5, 0.5, 0.5],
  positive: [0.2, 0.88, 0.33],
};

export const paperTheme: Theme = {
  background: "#ffffff",
  gridMinor: "#0000001a",
  gridMajor: "#0000000d",
  ink: "#111111",
  valueText: "#292929",
  designatorText: "#111111",
  openPin: "#666666",
  accent: OVERLAY_PICK.light,
  current: LIGHT_SIGNALS.current,
  unsupported: "#b86e00",
  unsupportedText: "#b86e00",
  error: "#d70015",
  readoutBackground: "#ffffff",
  readoutBorder: "#00000033",
  readoutText: "#333333",
  negative: [237 / 255, 52 / 255, 52 / 255],
  // At zero volts, match symbol ink; voltage adds green/red continuously from this black base.
  neutral: [17 / 255, 17 / 255, 17 / 255],
  positive: [0, 168 / 255, 60 / 255],
};

/** Softer sheet for the light interface; explicit White background remains true white. */
export const lightTheme: Theme = {
  ...paperTheme,
  background: "#f8f8f7",
  unsupported: "#95601e",
  unsupportedText: "#95601e",
  readoutBackground: "#f2f2f1",
};

export function currentTheme(): Theme {
  if (settings.whiteBackground) return paperTheme;
  return settings.appearance === "light" ? lightTheme : darkTheme;
}

/** Wire color for a node voltage, saturating at ±range. */
export function voltageColor(t: Theme, v: number, range: number): string {
  const f = Number.isNaN(v) ? 0 : Math.max(-1, Math.min(1, v / range));
  const to = f >= 0 ? t.positive : t.negative;
  const a = Math.abs(f);
  const c = (i: number) => (t.neutral[i] + (to[i] - t.neutral[i]) * a) * 255;
  return rgbColor(c(0), c(1), c(2));
}

/**
 * A junction temperature's colour (°C): ice blue at 0 °C and below, green at 25 °C (data sheets'
 * reference), yellow at 85 °C (the industrial rating), red at 150 °C (silicon's usual Tj max) and
 * above; blended between.
 */
export function heatColor(celsius: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [[0, [120, 200, 255]], [25, [60, 200, 90]], [85, [245, 210, 40]], [150, [235, 50, 40]]];
  if (!(celsius > stops[0][0])) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i], [t0, c0] = stops[i - 1];
    if (celsius <= t1) {
      const f = (celsius - t0) / (t1 - t0);
      return [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * f)) as [number, number, number];
    }
  }
  return stops[stops.length - 1][1];
}

/** Monospaced stack: SF Mono on macOS, Cascadia / Consolas on Windows. */
export const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, "Cascadia Mono", Consolas, monospace';
/** Sans for labels on the sheet: easier to read than monospace at small sizes. */
export const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
export const DESIGNATOR_FONT = `600 11px ${SANS}`;
export const VALUE_FONT = `10.5px ${SANS}`;
/** Label fonts scaled by `k` (labels grow when zoomed out). */
export const designatorFont = (k: number) => `600 ${11 * k}px ${SANS}`;
export const valueFont = (k: number) => `${10.5 * k}px ${SANS}`;
export const PIN_FONT = `600 7px ${SANS}`;
export const READOUT_FONT = `11px ${MONO}`;
export const READOUT_TITLE_FONT = `600 11.5px ${SANS}`;
