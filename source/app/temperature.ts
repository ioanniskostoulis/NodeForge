// Licensed under the GNU General Public License v2 or later. See LICENSE.
import { settings } from "./settings";

/** The circuit's temperature is stored in °C; these show and read it in °C, °F or K. */
export type TemperatureUnit = "C" | "F" | "K";

const SYMBOLS: Record<TemperatureUnit, string> = { C: "°C", F: "°F", K: "K" };

export function temperatureSymbol(unit: TemperatureUnit = settings.temperatureUnit): string {
  return SYMBOLS[unit];
}

/** °C → the unit. */
export function fromCelsius(celsius: number, unit: TemperatureUnit = settings.temperatureUnit): number {
  return unit === "F" ? (celsius * 9) / 5 + 32 : unit === "K" ? celsius + 273.15 : celsius;
}

/** The unit → °C. */
export function toCelsius(value: number, unit: TemperatureUnit = settings.temperatureUnit): number {
  return unit === "F" ? ((value - 32) * 5) / 9 : unit === "K" ? value - 273.15 : value;
}

/** A temperature as text in the app's unit: "77 °F", "298.15 K". */
export function formatTemperature(celsius: number, digits = 6, unit: TemperatureUnit = settings.temperatureUnit): string {
  return `${+fromCelsius(celsius, unit).toPrecision(digits)} ${SYMBOLS[unit]}`;
}

/**
 * A typed temperature in °C: "85", "185F", "358.15 K", "85 °C". A bare number is in the app's
 * unit; a suffix (C, F or K, with or without °) overrides it. NaN if it isn't one.
 */
export function parseTemperature(text: string, unit: TemperatureUnit = settings.temperatureUnit): number {
  const match = text.trim().replace(/,/g, ".").match(/^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*(?:°?\s*([CFK]))?$/i);
  if (!match) return NaN;
  const typedUnit = (match[2]?.toUpperCase() as TemperatureUnit | undefined) ?? unit;
  return toCelsius(Number(match[1]), typedUnit);
}
