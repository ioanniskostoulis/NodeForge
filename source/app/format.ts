// Licensed under the GNU General Public License v2 or later. See LICENSE.

const PREFIXES: [number, string][] = [
  [1e12, "T"], [1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"], [1e-15, "f"],
];

/** Plane angle and percent are written against the number: 90°, 20%. */
const NO_SPACE = new Set(["°", "%"]);

/** Engineering notation: si(4700, "Ω") = "4.7 kΩ", si(0.0123, "A", true) = "12.3 mA". */
export function si(v: number, unit: string, spaced = true, digits = 3): string {
  const sp = spaced && unit && !NO_SPACE.has(unit) ? " " : "";
  if (Number.isNaN(v)) return "–" + sp + unit;
  const a = Math.abs(v);
  if (a < 1e-14) return "0" + sp + unit;
  // °C and °F are written as they are: 0.5 °C, never 500 m°C
  if (unit.startsWith("°")) return significant(v, digits) + sp + unit;
  for (const [scale, p] of PREFIXES) {
    if (a >= scale * 0.9995) return significant(v / scale, digits) + sp + p + unit;
  }
  return significant(v / 1e-15, digits) + sp + "f" + unit;
}

/**
 * Labels for one axis in one form of its unit: the SI prefix of its largest value, and as many
 * decimals as its step needs, the same on every label (0.5 V, 1.0 V, 1.5 V; never 500mV and 1V).
 */
export function axisFormat(max: number, step: number, unit: string): (v: number) => string {
  const a = Math.abs(max);
  let scale = 1, prefix = "";
  if (a >= 1e-14 && !unit.startsWith("°")) {
    const found = PREFIXES.find(([s]) => a >= s * 0.9995) ?? [1e-15, "f"];
    [scale, prefix] = found;
  }
  const decimals = step > 0 ? Math.min(6, Math.max(0, Math.ceil(-Math.log10(step / scale) - 1e-9))) : 0;
  return (v: number) => {
    const s = (v / scale).toFixed(decimals);
    return `${/^-0(\.0*)?$/.test(s) ? s.slice(1) : s}${unit && !NO_SPACE.has(unit) ? " " : ""}${prefix}${unit}`;
  };
}

/** Up to `digits` significant digits, without trailing zeros. */
function significant(x: number, digits: number): string {
  const a = Math.abs(x);
  const decimals = a >= 100 ? Math.max(0, digits - 3) : a >= 10 ? Math.max(0, digits - 2) : Math.max(0, digits - 1);
  let s = x.toFixed(decimals);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
}

const MULTIPLIERS: Record<string, number> = { T: 1e12, G: 1e9, M: 1e6, k: 1e3, K: 1e3, m: 1e-3, u: 1e-6, "µ": 1e-6, "μ": 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 };

/**
 * Parse a typed value with an optional SI prefix and unit (CircuitJS's EditDialog.parseUnits):
 * "4.7k", "10u", "2.2 µF", "1M" (mega; "m" is milli), "5e-3". Returns NaN if it isn't a number.
 */
export function parseSI(text: string, unit = ""): number {
  let s = text.trim().replace(/,/g, ".");
  // a trailing unit symbol is optional
  for (const u of [unit, "Ω", "ohms", "ohm", "Hz", "F", "H", "V", "A", "W", "s", "°"]) {
    if (u && s.endsWith(u) && s.length > u.length) {
      s = s.slice(0, -u.length).trim();
      break;
    }
  }
  if (/meg$/i.test(s)) return Number(s.slice(0, -3)) * 1e6;
  const m = MULTIPLIERS[s.slice(-1)];
  if (m !== undefined && s.length > 1) return Number(s.slice(0, -1).trim()) * m;
  return s === "" ? NaN : Number(s);
}
