// Hooks the NodeForge engine's SPICE models into circuits. Diodes, zeners, LEDs, MOSFETs, JFETs
// and bipolar transistors use its device classes. <nfmodel> carries the model text a circuit uses
// (CircuitJS skips it), and a part's `nfm` attribute names its model.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { CircuitElm } from "../circuitjs/core/elm";
import { DiodeElm, ZenerElm } from "../circuitjs/elements/diode";
import { MosfetElm, NMosfetElm, PMosfetElm } from "../circuitjs/elements/mosfet";
import { JfetElm, LEDElm, NJfetElm, NTransistorElm, PJfetElm, PTransistorElm, TransistorElm } from "../circuitjs/elements/semis";
import { circuitExtensions } from "../circuitjs/io/circuit";
import { childClassSubstitutes, type ElmClass, partClassSubstitutes } from "../circuitjs/io/registry";
import { XmlNode } from "../circuitjs/io/tokens";
import { SpiceDiodeElm, SpiceLEDElm, SpiceZenerElm } from "./elements/spice-diode";
import { SpiceJfetElm, SpiceNJfetElm, SpicePJfetElm } from "./elements/spice-jfet";
import { SpiceMosfetElm, SpiceNMosfetElm, SpicePMosfetElm } from "./elements/spice-mosfet";
import { SpiceNTransistorElm, SpicePTransistorElm, SpiceTransistorElm } from "./elements/spice-transistor";
import { ParamMap } from "./spice/parse";
import { defineModels, findModel } from "./spice/registry";

/** Parts the NodeForge engine simulates as SPICE devices (diodes, zeners, LEDs, MOSFETs, JFETs, transistors). */
type SpicePart = SpiceDiodeElm | SpiceZenerElm | SpiceLEDElm | SpiceMosfetElm | SpiceJfetElm | SpiceTransistorElm;

/** Is the part simulated as a SPICE device under the NodeForge engine (it has a model)? */
export function isSpicePart(e: CircuitElm): e is SpicePart {
  return e instanceof SpiceDiodeElm || e instanceof SpiceZenerElm || e instanceof SpiceLEDElm || e instanceof SpiceMosfetElm ||
    e instanceof SpiceJfetElm || e instanceof SpiceTransistorElm;
}

/** A part's model from the library, by name, or null when it's on its CircuitJS model. */
export function spiceModelOf(e: CircuitElm): string | null {
  return isSpicePart(e) ? e.spiceModel || null : null;
}

/** A diode's or MOSFET's junction temperature (°C) while self-heating heats it, else null. */
export function junctionTemperature(e: CircuitElm): number | null {
  return e instanceof SpiceDiodeElm || e instanceof SpiceZenerElm || e instanceof SpiceLEDElm || e instanceof SpiceMosfetElm
    ? e.junctionTemperature()
    : null;
}

/** Does the part's model heat with self-heating (a diode card with RTH0, a VDMOS card with RTHJC, or a subcircuit doing so now)? */
export function hasThermalModel(e: CircuitElm): boolean {
  if (e instanceof SpiceMosfetElm) return e.freeAirRthca() !== null || e.junctionTemperature() !== null;
  if (!(e instanceof SpiceDiodeElm || e instanceof SpiceZenerElm || e instanceof SpiceLEDElm) || !e.spiceModel) return false;
  return (findModel(e.spiceModel)?.model?.params.get("rth0") ?? 0) > 0;
}

/**
 * Card parameters nothing in a transient run reads by design: LTspice's data-sheet fields
 * (manufacturer, ratings), the noise coefficients (no noise analysis).
 */
const INFORMATIONAL = new Set(["mfg", "vds", "ron", "qg", "iave", "vpk", "icrating", "vceo", "kf", "af"]);
/** Self-heating's parameters, read only while it's on. */
const THERMAL = new Set(["rth0", "cth0", "rthjc", "rthca", "cthj"]);

/**
 * The parameters a part's library card sets that its device didn't read (unsupported, misspelt,
 * or for another level), once the device is built; informational ones (and thermal ones while
 * self-heating is off) aren't counted. Upper case, as cards are written.
 */
export function ignoredParams(e: CircuitElm): string[] {
  if (!isSpicePart(e) || !e.spiceModel || !(e as { device?: unknown }).device) return [];
  const params = findModel(e.spiceModel)?.model?.params;
  if (!(params instanceof ParamMap)) return [];
  // thermal parameters count once the device has been built heating (self-heating turned on while
  // paused rebuilds it at the next step: until then they aren't unused, only not read yet)
  const heating = (e.sim as { selfHeating?: boolean } | undefined)?.selfHeating === true && junctionTemperature(e) !== null;
  return [...params.keys()].filter((k) => !params.read.has(k) && !INFORMATIONAL.has(k) && (heating || !THERMAL.has(k))).map((k) => k.toUpperCase());
}

/** The kinds of part that take a model. */
export type SpiceModelKind = "diode" | "mosfet" | "jfet" | "bjt";

/** Which kind of model a part takes, or null. */
export function spiceModelKind(e: CircuitElm): SpiceModelKind | null {
  if (e instanceof SpiceDiodeElm || e instanceof SpiceZenerElm || e instanceof SpiceLEDElm) return "diode";
  if (e instanceof SpiceMosfetElm) return "mosfet";
  if (e instanceof SpiceJfetElm) return "jfet";
  if (e instanceof SpiceTransistorElm) return "bjt";
  return null;
}

/** A part's polarity for its models: −1 for p-channel and PNP, else 1. */
export function spicePolarity(e: CircuitElm): number {
  return isSpicePart(e) && "pnp" in e ? e.pnp : 1;
}

/** A part's class name as CircuitJS knows it (its NodeForge-engine subclass hidden). */
export function partClassName(e: CircuitElm): string {
  const C = e.constructor as { baseName?: string; name: string };
  return C.baseName ?? C.name;
}

/**
 * Put a part on a model from the library (by name), or back on its CircuitJS model (`null`). The
 * part changes in place; returned for callers that replace it.
 */
export function withSpiceModel(e: CircuitElm, name: string | null): CircuitElm {
  if (isSpicePart(e)) e.setSpiceModel(name ?? "");
  return e;
}

// every diode, zener, LED, MOSFET, JFET and transistor of a circuit is created as the NodeForge engine's class
// diodes, zeners and LEDs inside subcircuits too (the optocoupler's LED, LM317's and TL431's zeners,
// a user's subcircuit's diodes),
childClassSubstitutes.set(DiodeElm as ElmClass, SpiceDiodeElm as unknown as ElmClass);
childClassSubstitutes.set(ZenerElm as ElmClass, SpiceZenerElm as unknown as ElmClass);
childClassSubstitutes.set(LEDElm as ElmClass, SpiceLEDElm as unknown as ElmClass);
// and their transistors, JFETs and MOSFETs (LM317, TL431, the optocoupler, the Darlington, the
// transistor-level op-amps and timers, a user's subcircuit's): on their CircuitJS models' SPICE cards
childClassSubstitutes.set(TransistorElm as ElmClass, SpiceTransistorElm as unknown as ElmClass);
childClassSubstitutes.set(NTransistorElm as ElmClass, SpiceNTransistorElm as unknown as ElmClass);
childClassSubstitutes.set(PTransistorElm as ElmClass, SpicePTransistorElm as unknown as ElmClass);
childClassSubstitutes.set(JfetElm as ElmClass, SpiceJfetElm as unknown as ElmClass);
childClassSubstitutes.set(NJfetElm as ElmClass, SpiceNJfetElm as unknown as ElmClass);
childClassSubstitutes.set(PJfetElm as ElmClass, SpicePJfetElm as unknown as ElmClass);
childClassSubstitutes.set(MosfetElm as ElmClass, SpiceMosfetElm as unknown as ElmClass);
childClassSubstitutes.set(NMosfetElm as ElmClass, SpiceNMosfetElm as unknown as ElmClass);
childClassSubstitutes.set(PMosfetElm as ElmClass, SpicePMosfetElm as unknown as ElmClass);
partClassSubstitutes.set(DiodeElm as ElmClass, SpiceDiodeElm as unknown as ElmClass);
partClassSubstitutes.set(ZenerElm as ElmClass, SpiceZenerElm as unknown as ElmClass);
partClassSubstitutes.set(LEDElm as ElmClass, SpiceLEDElm as unknown as ElmClass);
partClassSubstitutes.set(MosfetElm as ElmClass, SpiceMosfetElm as unknown as ElmClass);
partClassSubstitutes.set(NMosfetElm as ElmClass, SpiceNMosfetElm as unknown as ElmClass);
partClassSubstitutes.set(PMosfetElm as ElmClass, SpicePMosfetElm as unknown as ElmClass);
partClassSubstitutes.set(TransistorElm as ElmClass, SpiceTransistorElm as unknown as ElmClass);
partClassSubstitutes.set(NTransistorElm as ElmClass, SpiceNTransistorElm as unknown as ElmClass);
partClassSubstitutes.set(PTransistorElm as ElmClass, SpicePTransistorElm as unknown as ElmClass);
partClassSubstitutes.set(JfetElm as ElmClass, SpiceJfetElm as unknown as ElmClass);
partClassSubstitutes.set(NJfetElm as ElmClass, SpiceNJfetElm as unknown as ElmClass);
partClassSubstitutes.set(PJfetElm as ElmClass, SpicePJfetElm as unknown as ElmClass);

circuitExtensions.readers.set("nfmodel", (xml) => {
  defineModels(xml.text);
});

circuitExtensions.writers.push((c) => {
  const out: XmlNode[] = [];
  const seen = new Set<string>();
  for (const e of c.elements) {
    const name = spiceModelOf(e);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const def = findModel(name);
    if (!def) continue;
    const n = new XmlNode("nfmodel", { n: def.name });
    n.text = def.text;
    out.push(n);
  }
  return out;
});
