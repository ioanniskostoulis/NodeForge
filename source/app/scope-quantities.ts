// What a scope trace can show of a part: its quantities, their labels and units, and how to read them.
// Codes 0–8 are CircuitJS's scope values (saved in its files); 100 and up are NodeForge's, read from
// the part's terminals (CircuitJS opens them as voltage). Reading never changes the simulation.
import { settings } from "./settings";
import { fromCelsius } from "./temperature";
import { CapacitorElm, type CircuitElm, hasThermalModel, junctionTemperature, LampElm, MemristorElm, MosfetElm, OhmMeterElm, TransistorElm } from "../engine";
import { DEFAULT_TEMPERATURE } from "../engine/circuitjs/io/circuit";

export interface Quantity {
  value: number;
  /** In legends and trace names: V, I, Vgs, Ic… */
  label: string;
  /** In menus. */
  name: string;
  unit: string;
}

const q = (value: number, label: string, name: string, unit: string): Quantity => ({ value, label, name, unit });
const VOLTAGE = q(0, "V", "Voltage", "V"), CURRENT = q(3, "I", "Current", "A"), POWER = q(7, "P", "Power", "W");
const BASIC = [VOLTAGE, CURRENT, POWER];
/** NodeForge's own codes. */
export const VGS = 100, IG = 101, TJ = 102, TJ_F = 103, TJ_K = 104;
/** A self-heating part's junction temperature (its model's thermal network; the circuit's temperature while heating is off). */
const JUNCTION = q(TJ, "Tj", "Junction temperature (°C)", "°C");
const JUNCTION_F = q(TJ_F, "TjF", "Junction temperature (°F)", "°F");
const JUNCTION_K = q(TJ_K, "TjK", "Junction temperature (K)", "K");
/** The same temperature in each unit, the app's unit first: a scope can plot it in two units at once, one axis each. */
function junctionQuantities(): Quantity[] {
  const all = { C: JUNCTION, F: JUNCTION_F, K: JUNCTION_K };
  const first = all[settings.temperatureUnit];
  return [first, ...Object.values(all).filter((x) => x !== first)];
}

/** The quantities a part offers, in menu order. */
export function quantitiesFor(elm: CircuitElm): Quantity[] {
  // a bipolar transistor has no plain voltage (CircuitJS reads 0): its junctions and currents
  if (elm instanceof TransistorElm) {
    return [q(4, "Vbe", "Vbe", "V"), q(5, "Vbc", "Vbc", "V"), q(6, "Vce", "Vce", "V"), q(1, "Ib", "Ib", "A"), q(2, "Ic", "Ic", "A"), q(3, "Ie", "Ie", "A"), POWER];
  }
  if (elm instanceof MosfetElm) {
    return [q(0, "Vds", "Vds", "V"), q(3, "Id", "Id", "A"), q(VGS, "Vgs", "Vgs", "V"), q(IG, "Ig", "Gate current", "A"), POWER,
      ...(hasThermalModel(elm) ? junctionQuantities() : [])];
  }
  if (hasThermalModel(elm)) return [...BASIC, ...junctionQuantities()];
  if (elm instanceof LampElm || elm instanceof MemristorElm || elm instanceof OhmMeterElm) return [...BASIC, q(2, "R", "Resistance", "Ω")];
  if (elm instanceof CapacitorElm) return [...BASIC, q(8, "Q", "Charge", "C")];
  return BASIC;
}

/** A trace's quantity (one the part doesn't list, e.g. from a file, as CircuitJS reads it). */
export function quantityOf(elm: CircuitElm, value: number): Quantity {
  return quantitiesFor(elm).find((x) => x.value === value)
    ?? (value === 3 ? CURRENT : value === 7 ? POWER : value === 8 ? q(8, "Q", "Charge", "C") : VOLTAGE);
}

/** The quantities a new scope on the part starts with. */
export function defaultQuantities(elm: CircuitElm): number[] {
  return elm instanceof TransistorElm ? [6, 2] : [0, 3];
}

/** Read a quantity now. */
export function readQuantity(elm: CircuitElm, value: number): number {
  // MOSFET posts: 0 gate, 1 source, 2 drain; the gate current is what flows in at the gate
  if (value === VGS) return (elm.volts[0] ?? 0) - (elm.volts[1] ?? 0);
  if (value === IG) return -elm.getCurrentIntoNode(0);
  if (value === TJ || value === TJ_F || value === TJ_K) {
    const c = junctionTemperature(elm) ?? ((elm.sim as { temperature?: number } | undefined)?.temperature ?? (DEFAULT_TEMPERATURE + 273.15)) - 273.15;
    return value === TJ ? c : fromCelsius(c, value === TJ_F ? "F" : "K");
  }
  return elm.getScopeValue(value);
}
