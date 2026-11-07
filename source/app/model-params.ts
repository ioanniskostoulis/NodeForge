// A custom model's parameters as properties: which of a SPICE card's parameters a part shows to
// dial, with labels, units and SPICE's defaults (ngspice's), for diode, level 1 MOSFET, VDMOS,
// JFET and bipolar transistor cards.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

export interface ModelParam {
  /** SPICE name (lower case). */
  key: string;
  label: string;
  unit: string;
  /** SPICE's default when the card doesn't give it. */
  def: number;
  /** 0 means "none" (the parameter is left out of the card). */
  zeroIsNone?: boolean;
}

const DIODE: ModelParam[] = [
  { key: "is", label: "Saturation current", unit: "A", def: 1e-14 },
  { key: "n", label: "Emission coefficient", unit: "", def: 1 },
  { key: "rs", label: "Series resistance", unit: "Ω", def: 0 },
  { key: "bv", label: "Breakdown voltage", unit: "V", def: 0, zeroIsNone: true },
  { key: "ibv", label: "Breakdown current", unit: "A", def: 1e-3 },
  { key: "cjo", label: "Junction capacitance", unit: "F", def: 0 },
  { key: "vj", label: "Junction potential", unit: "V", def: 1 },
  { key: "m", label: "Grading coefficient", unit: "", def: 0.5 },
  { key: "tt", label: "Transit time", unit: "s", def: 0 },
];

const MOS1: ModelParam[] = [
  { key: "vto", label: "Threshold", unit: "V", def: 0 },
  { key: "kp", label: "Transconductance", unit: "A/V²", def: 2e-5 },
  { key: "lambda", label: "Length modulation", unit: "1/V", def: 0 },
  { key: "rd", label: "Drain resistance", unit: "Ω", def: 0 },
  { key: "rs", label: "Source resistance", unit: "Ω", def: 0 },
  { key: "cgso", label: "Gate-source overlap", unit: "F/m", def: 0 },
  { key: "cgdo", label: "Gate-drain overlap", unit: "F/m", def: 0 },
  { key: "is", label: "Body diode current", unit: "A", def: 1e-14 },
];

const VDMOS = (pnp: number): ModelParam[] => [
  { key: "vto", label: "Threshold", unit: "V", def: 3 * pnp },
  { key: "kp", label: "Transconductance", unit: "A/V²", def: 15 + 5 * pnp },
  { key: "lambda", label: "Length modulation", unit: "1/V", def: 0 },
  { key: "ksubthres", label: "Subthreshold slope", unit: "V", def: 0.1 },
  { key: "rd", label: "Drain resistance", unit: "Ω", def: 0 },
  { key: "rs", label: "Source resistance", unit: "Ω", def: 0 },
  { key: "rg", label: "Gate resistance", unit: "Ω", def: 0 },
  { key: "cgs", label: "Gate-source cap.", unit: "F", def: 1.4e-9 },
  { key: "cgdmax", label: "Gate-drain cap., max", unit: "F", def: 2e-9 },
  { key: "cgdmin", label: "Gate-drain cap., min", unit: "F", def: 2e-11 },
  { key: "is", label: "Body diode current", unit: "A", def: 1e-14 },
  { key: "n", label: "Body diode emission", unit: "", def: 1 },
  { key: "cjo", label: "Body diode cap.", unit: "F", def: 5e-10 },
  { key: "tt", label: "Body diode recovery", unit: "s", def: 0 },
  { key: "bv", label: "Breakdown voltage", unit: "V", def: 0, zeroIsNone: true },
];

const JFET: ModelParam[] = [
  { key: "vto", label: "Threshold", unit: "V", def: -2 },
  { key: "beta", label: "Transconductance", unit: "A/V²", def: 1e-4 },
  { key: "lambda", label: "Length modulation", unit: "1/V", def: 0 },
  { key: "rd", label: "Drain resistance", unit: "Ω", def: 0 },
  { key: "rs", label: "Source resistance", unit: "Ω", def: 0 },
  { key: "cgs", label: "Gate-source cap.", unit: "F", def: 0 },
  { key: "cgd", label: "Gate-drain cap.", unit: "F", def: 0 },
  { key: "is", label: "Gate junction current", unit: "A", def: 1e-14 },
];

const BJT: ModelParam[] = [
  { key: "is", label: "Saturation current", unit: "A", def: 1e-16 },
  { key: "bf", label: "Forward beta", unit: "", def: 100 },
  { key: "br", label: "Reverse beta", unit: "", def: 1 },
  { key: "vaf", label: "Early voltage", unit: "V", def: 0, zeroIsNone: true },
  { key: "ikf", label: "High-current knee", unit: "A", def: 0, zeroIsNone: true },
  { key: "ise", label: "B-E leakage current", unit: "A", def: 0 },
  { key: "ne", label: "B-E leakage emission", unit: "", def: 1.5 },
  { key: "rb", label: "Base resistance", unit: "Ω", def: 0 },
  { key: "rc", label: "Collector resistance", unit: "Ω", def: 0 },
  { key: "re", label: "Emitter resistance", unit: "Ω", def: 0 },
  { key: "cje", label: "B-E capacitance", unit: "F", def: 0 },
  { key: "cjc", label: "B-C capacitance", unit: "F", def: 0 },
  { key: "tf", label: "Forward transit time", unit: "s", def: 0 },
  { key: "tr", label: "Reverse transit time", unit: "s", def: 0 },
];

/** The parameters a custom model of this SPICE type shows (pnp: −1 for p-channel). */
export function modelParams(type: string, pnp = 1): ModelParam[] {
  if (type === "D") return DIODE;
  if (type === "VDMOS") return VDMOS(pnp);
  if (type === "NMOS" || type === "PMOS") return MOS1;
  if (type === "NJF" || type === "PJF") return JFET;
  if (type === "NPN" || type === "PNP") return BJT;
  return [];
}
