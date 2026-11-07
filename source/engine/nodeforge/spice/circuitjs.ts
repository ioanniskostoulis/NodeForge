// CircuitJS's diode, MOSFET, JFET and transistor models as the SPICE models they are: its diode is SPICE's level 1
// diode (IS, N, RS, and a breakdown of 5 mA at −BV with the steepness of N = 1), its MOSFET is
// level 1 (VTO, KP = β with W = L, LAMBDA, fixed overlap capacitances) with CircuitJS's default
// diode as its body diode, its transistor is Gummel-Poon (BF from the part). The NodeForge engine simulates CircuitJS parts through these, and the
// model library lists them as models like any other.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { DiodeModel } from "../../circuitjs/elements/diode";
import type { MosfetModel } from "../../circuitjs/elements/mosfet";
import type { TransistorModel } from "../../circuitjs/elements/semis";
import type { SpiceModel } from "./parse";

/** CircuitJS's breakdown: 5 mA at the Zener voltage, as steep as an ideal (N = 1) junction. */
const ZENER_CURRENT = 5e-3;

const formatNumber = (value: number) => String(+value.toPrecision(10));

function card(name: string, type: string, params: [string, number][], flags: string[] = []): SpiceModel {
  const parameters = new Map(params);
  const body = [...params.map(([key, value]) => `${key.toUpperCase()}=${formatNumber(value)}`), ...flags.map((flag) => flag.toUpperCase())].join(" ");
  return { name, type, params: parameters, flags: new Set(flags), text: new Map(), source: `.model ${name} ${type}(${body})` };
}

/** A SPICE-safe model name from a CircuitJS one ("fwdrop=0.6" → "fwdrop_0.6"). */
export function spiceName(name: string): string {
  return name.replace(/[^\w.+-]/g, "_") || "model";
}

/** A CircuitJS diode model as a SPICE diode card. */
export function diodeCard(m: DiodeModel, name = spiceName(m.name)): SpiceModel {
  const params: [string, number][] = [["is", m.saturationCurrent], ["n", m.emissionCoefficient]];
  if (m.seriesResistance > 0) params.push(["rs", m.seriesResistance]);
  if (m.breakdownVoltage > 0) params.push(["bv", m.breakdownVoltage], ["ibv", ZENER_CURRENT], ["nbv", 1]);
  return card(name, "D", params);
}

/**
 * A CircuitJS MOSFET model as a SPICE level 1 card (its body diode is separate: see bodyDiodeCard).
 * Instances are W = L = 1, so KP is β and CGSO / CGDO are the capacitances.
 */
export function mosfetCard(m: MosfetModel, pnp: number, name = spiceName(m.name)): SpiceModel {
  return card(name, pnp < 0 ? "PMOS" : "NMOS", [
    ["level", 1], ["vto", pnp < 0 ? -m.threshold : m.threshold], ["kp", m.beta], ["lambda", m.lambda],
    ["is", 0], ["cgso", m.capGS], ["cgdo", m.capGD],
  ]);
}

/**
 * A CircuitJS MOSFET model as a stand-alone level 1 card, for tuning into a model of one's own: at
 * SPICE's default W = L = 100 µm (so CGSO / CGDO are per metre), with level 1's own drain-bulk
 * junction as the body diode, its IS chosen for the same drop at 1 A as CircuitJS's body diode.
 */
export function tunableMosfetCard(m: MosfetModel, pnp: number, name = spiceName(m.name)): SpiceModel {
  const body = DiodeModel.getDefaultModel();
  // V(1 A) = N·vt·ln(1/IS) for the default diode; level 1's junction has N = 1
  const vt = 0.025865, v1 = body.emissionCoefficient * vt * Math.log(1 / body.saturationCurrent);
  const is = m.bodyDiode ? Math.exp(-v1 / vt) : 0;
  return card(name, pnp < 0 ? "PMOS" : "NMOS", [
    ["level", 1], ["vto", pnp < 0 ? -m.threshold : m.threshold], ["kp", m.beta], ["lambda", m.lambda],
    ["is", +is.toPrecision(4)], ["cgso", m.capGS / 100e-6], ["cgdo", m.capGD / 100e-6],
  ]);
}

/**
 * CircuitJS's diode keeps a conductance of 1% of IS across the junction (so a junction that's off
 * still holds its nodes to the circuit: a floating bridge rectifier's output stays solvable). Its
 * SPICE equivalent has it as a resistor in parallel; the device as extra GMIN.
 */
export function circuitJSLeak(m: SpiceModel): number {
  return 0.01 * (m.params.get("is") ?? 1e-14);
}

/** The diode CircuitJS puts between a MOSFET's body and its source and drain. */
export function bodyDiodeCard(): SpiceModel {
  return diodeCard(DiodeModel.getDefaultModel(), "circuitjs_body");
}

/**
 * A CircuitJS transistor model as a SPICE Gummel-Poon card, with the part's beta as BF. CircuitJS's
 * transistor is SPICE's without resistances, substrate, XTF or excess phase: its fields are IS, IKF,
 * ISE, NE, IKR, ISC, NC, NF, NR, VAF, VAR, BR and the junction capacitances and transit times
 * (FC = 0.5, SPICE's default). Its 1/IKF, 1/VAF… are 0 when the knee or voltage is absent.
 */
export function transistorCard(m: TransistorModel, pnp: number, beta: number, name = spiceName(m.name)): SpiceModel {
  const params: [string, number][] = [
    ["is", m.satCur], ["bf", beta], ["br", m.betaR], ["nf", m.emissionCoeffF], ["nr", m.emissionCoeffR],
    ["ise", m.BEleakCur], ["ne", m.leakBEemissionCoeff], ["isc", m.BCleakCur], ["nc", m.leakBCemissionCoeff],
  ];
  if (m.invRollOffF > 0) params.push(["ikf", 1 / m.invRollOffF]);
  if (m.invRollOffR > 0) params.push(["ikr", 1 / m.invRollOffR]);
  if (m.invEarlyVoltF > 0) params.push(["vaf", 1 / m.invEarlyVoltF]);
  if (m.invEarlyVoltR > 0) params.push(["var", 1 / m.invEarlyVoltR]);
  if (m.junctionCapBE > 0) params.push(["cje", m.junctionCapBE], ["vje", m.junctionPotBE], ["mje", m.junctionExpBE]);
  if (m.junctionCapBC > 0) params.push(["cjc", m.junctionCapBC], ["vjc", m.junctionPotBC], ["mjc", m.junctionExpBC]);
  if (m.transitTimeF > 0) params.push(["tf", m.transitTimeF]);
  if (m.transitTimeR > 0) params.push(["tr", m.transitTimeR]);
  return card(name, pnp < 0 ? "PNP" : "NPN", params);
}

/**
 * A CircuitJS JFET model as a SPICE level 1 JFET card: CircuitJS runs its JFET on its MOSFET's
 * equations (I = β/2·(Vgs − Vt)² in saturation), so BETA is half its β, VTO its threshold. Its gate
 * diode (CircuitJS's default diode, gate to source only) and fixed gate capacitances are separate
 * parts: the card's own junctions are off (IS = 0, leaving SPICE's GMIN).
 */
export function jfetCard(m: MosfetModel, pnp: number, name = spiceName(m.name)): SpiceModel {
  const params: [string, number][] = [["vto", m.threshold], ["beta", m.beta / 2], ["is", 0]];
  if (m.lambda !== 0) params.push(["lambda", m.lambda]);
  return card(name, pnp < 0 ? "PJF" : "NJF", params);
}
