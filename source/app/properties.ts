// How part properties are presented in the inspector, the same way for every part: sentence-case
// labels, the unit always in the unit column (never in the label), hints in the tooltip, one name
// per concept, and display-only options grouped apart. The engine keeps CircuitJS's own names
// (files and sliders refer to properties by them); this only changes what's shown.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { type CircuitElm, CrystalElm, CurrentElm, type EditInfo, GroundElm, partClassName, RailElm, VoltageElm, WireElm } from "../engine";

export interface FieldPresentation {
  label: string;
  unit: string;
  /** What the field means, beyond its label (tooltip). */
  hint?: string;
  /** A display option (shown under Display, after the electrical properties). */
  display: boolean;
}

/** Words that keep their capitals in sentence case. */
const KEEP = new Set([
  "DC", "AC", "IEC", "LED", "LEDs", "SPICE", "RMS", "MSB", "LSB", "CTR", "NO", "NC", "MT1", "E/C", "D/S", "I²t", "N1/N2",
  "ESR", "R0", "R1", "C1", "JavaScript", "De", "Morgan", "PWM", "ROM", "RAM", "hFE", "kg1", "°C",
]);

/** "Max Output Voltage" → "Max output voltage" (acronyms kept). */
export function sentenceCase(text: string): string {
  return text
    .split(" ")
    .map((w, i) => (!w || KEEP.has(w) || /^[A-Z0-9]{2,}$/.test(w) ? w : i === 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join(" ");
}

/** Units CircuitJS writes in labels, as the unit column shows them. */
const UNITS: [RegExp, string][] = [
  [/\((ohms|Ω)\)/i, "Ω"], [/\(F\)/, "F"], [/\(H\)/, "H"], [/\(Hz\)/, "Hz"], [/\((A|amps)\)/i, "A"],
  [/\((V|volts)\)/i, "V"], [/\(s\)/, "s"], [/\(degrees\)/i, "°"], [/\(%\)/, "%"], [/\(Ah\)/, "Ah"], [/\(nm\)/, "nm"],
  [/\(V\/usec\)/, "V/µs"], [/\(V\/ns\)/, "V/ns"], [/\(Nm\/A\)/, "N·m/A"], [/\(Kg\.m\^2\)/i, "kg·m²"],
  [/\(Nms\/rad\)/, "N·m·s"], [/\(um\^2\/\(s\*V\)\)/, "µm²/V·s"], [/\(°C\)/, "°C"],
];

/** Hints CircuitJS writes in labels: moved to the tooltip. */
const LINKING = "Switches with the same label operate together";
const HINTS: [RegExp, string][] = [
  [/\s*\(0\s*=\s*none\)/i, "0: none"],
  [/\s*\(0\s*=\s*infinite\)/i, "0 disables probe loading"],
  [/\s*\(0\s*=\s*default\)/i, "0 uses the circuit default"],
  [/\s*\(V,\s*0=unlimited\)/i, "0: unlimited"],
  [/\s*\(on Reset\)/i, "Value restored by Reset"],
  [/\s*\(for linking\)/i, LINKING],
  [/\s*\(0-1\)/, "0 to 1"],
  [/\s*\(5-20V\)/, "5 to 20 V"],
  [/\s*\(N1\/N2\)/, "Primary turns over secondary turns (N1/N2)"],
  [/\s*\(74139\)/, "Use 74139 output behavior"],
];

/** Labels that say something differently, or name it better (sentence case, units already out). */
const NAMES: Record<string, string> = {
  "# of Inputs": "Inputs", "# of Bits": "Bits", "# of Select Bits": "Select bits", "# of Address Bits": "Address bits",
  "# of Data Bits": "Data bits", "# of Data Points": "Data points", "# of Throws": "Throws", "# of Poles": "Poles",
  "High Logic Voltage": "Logic high", "High Voltage": "Logic high", "Low Voltage": "Logic low",
  "Threshold Voltage": "Threshold",
  "Group Number": "Link group", "Switch Group": "Link group",
  "Momentary Switch": "Momentary", "Keyboard Shortcut": "Keyboard shortcut",
  "Circle Symbol": "Circle symbol", "Use Circle Symbol": "Circle symbol", "Circular Symbol": "Circle symbol", "Draw Circle": "Circle symbol",
  "IEC Symbol": "IEC symbol", "DeMorgan's Symbol": "De Morgan symbol",
  "Slider Text": "Slider label", "Trapezoidal Approximation": "Trapezoidal integration",
  "Ratio": "Turns ratio", "Coupling Coefficient": "Coupling",
  "Capacitance @ 0V": "Capacitance at 0 V", "On Current": "Pull-in current", "Off Current": "Drop-out current",
  "R at 25°C": "Resistance at 25 °C", "R at 50°C": "Resistance at 50 °C", "Slider min temp": "Slider minimum", "Slider max temp": "Slider maximum",
  "Width of Doped Region": "Doped region width", "Hold current": "Holding current",
  "I2t": "I²t", "Battery Type": "Type", "Initial State of Charge": "Initial charge",
  "R0, Ohmic Resistance": "R0 (ohmic)", "R1, Polarization Resistance": "R1 (polarization)",
  "C1, Polarization Capacitance": "C1 (polarization)", "Current Required": "Draws current",
  "Start Position": "Start at", "Scale Factor": "Scale", "Sample Length": "Sample time",
  "Red Value": "Red", "Green Value": "Green", "Blue Value": "Blue", "Max Brightness Current": "Full-brightness current",
  "Warmup Time": "Warm-up time", "Cooldown Time": "Cool-down time", "Draw Bar On Top": "Bar on top",
  "Internal Node": "Internal", "Rotate Text When Vertical": "Rotate when vertical", "Trigger Type": "Condition",
  "Beta/hFE": "Gain (hFE)", "Swap E/C": "Swap emitter and collector", "Swap D/S": "Swap drain and source",
  "Swap NO/NC": "Swap NO and NC", "Gate-MT1 Resistance": "Gate–MT1 resistance", "mu": "Amplification (µ)", "kg1": "Perveance (kg1)",
  "Max Output": "Max output", "Min Output": "Min output", "Pulldown Resistor": "Pull-down resistor",
  "Output Pulldown Resistance": "Pull-down resistance", "Positive Supply Voltage": "Positive supply", "Negative Supply Voltage": "Negative supply",
  "Output Function": "Expression", "Model Name": "Model", "Keep Inactive Outputs High": "Inactive outputs high",
  "Hex Display": "Show hex", "Show Bus Value (Hex)": "Show bus value in hex",
  "Show Current": "Show current value", "Show Voltage": "Show voltage value", "Period": "Pulse length",
  "Low Voltage (V)": "Logic low",
  "Rise/Fall Time": "Rise/fall time", "Phase Offset": "Phase", "DC Offset": "DC offset", "Duty Cycle": "Duty cycle",
  "Nominal Power": "Nominal power", "Parallel Capacitance": "Parallel capacitance",
};

/** Units of labels CircuitJS gives none. */
const MISSING_UNITS: Record<string, string> = {
  "Nominal power": "W", "Parallel capacitance": "F", "Breakdown voltage": "V", "Holding current": "A",
  "Resistance at 25 °C": "Ω", "Resistance at 50 °C": "Ω", "Capacity": "Ah", "Initial charge": "%", "Threshold": "V",
  "Gyration resistance": "Ω", "I²t": "A²s", "Resistance": "Ω", "On resistance": "Ω", "Max output": "V", "Min output": "V",
  "Logic high": "V", "Logic low": "V", "Size": "", "Sampling rate": "Hz",
};

/** Hints for labels whose meaning isn't obvious. */
const EXTRA_HINTS: Record<string, string> = {
  "Trapezoidal integration": "Disable to use backward Euler integration, which reduces numerical ringing",
  "Duty cycle": "High-state fraction of each cycle, from 0 to 1",
  "Link label": "Parts with the same label switch together",
  "Link group": "Parts in the same group switch together",
  "Momentary": "Closed only while held",
  "ESR": "Equivalent series resistance (0: none)",
  "Coupling": "Coupling coefficient between windings (0 to 1)",
  "Voltage limit": "Maximum source voltage. 0 disables the limit",
  "Expression": "Output expression using inputs a, b, c and time t",
  "Show current value": "Show the current value beside the wire",
  "Show voltage value": "Show the voltage value beside the wire",
  "Show bus value": "Show the bus value in decimal",
  "Show bus value in hex": "Show the bus value in hexadecimal",
};

/** What a wave source's "Max Voltage" is. */
const AMPLITUDE_CLASSES = /^(VoltageElm|DCVoltageElm|ACVoltageElm|RailElm|ACRailElm|SquareRailElm|ClockElm|AntennaElm|NoiseElm|SweepElm|AMElm|FMElm|AudioInputElm)$/;

/** Labels for a display option (not electrical). */
const DISPLAY = /^show |symbol$|^slider label$|^label$|^bar on top$|^rotate when vertical$|^show hex$|^color$|^size$/i;

/** CircuitJS keeps this file flag for round-tripping; NodeForge uses the app symbol style. */
export const isLegacySymbolField = (ei: EditInfo): boolean => ei.name === "IEC Symbol";

/**
 * Display options NodeForge's value labels already cover, so the inspector leaves them out (they're
 * still saved): a source's or rail's Show voltage value, a crystal's Show frequency.
 */
export const isCoveredByLabels = (e: CircuitElm, ei: EditInfo): boolean =>
  (e instanceof VoltageElm && ei.name === "Show Voltage") || (e instanceof CrystalElm && ei.name === "Show Frequency");

/** The presentation of one of a part's properties. */
export function presentField(e: CircuitElm, ei: EditInfo, unitFromName: (name: string) => string): FieldPresentation {
  let name = ei.name.trim();
  const hints: string[] = [];
  for (const [re, hint] of HINTS) {
    if (re.test(name)) {
      name = name.replace(re, "");
      hints.push(hint);
    }
  }
  let unit = "";
  for (const [re, u] of UNITS) {
    if (re.test(name)) {
      name = name.replace(re, "").trim();
      unit = u;
      break;
    }
  }
  if (!unit && !ei.dimensionless && (!ei.kind || ei.kind === "number")) unit = unitFromName(ei.name);
  // context: a wave source's maximum is its amplitude; a current source's, its voltage limit
  const cls = partClassName(e).replace(/^_/, "");
  let label: string;
  if (name === "Max Voltage" && AMPLITUDE_CLASSES.test(cls)) label = cls === "AudioInputElm" ? "Peak voltage" : "Amplitude";
  else if (name === "Max Voltage" && /CurrentElm|OhmMeterElm/.test(cls)) label = "Voltage limit";
  else if (name === "Max Voltage" && cls === "VarRailElm") label = "Maximum";
  else if (name === "Min Voltage" && cls === "VarRailElm") label = "Minimum";
  else if (name === "Label" && hints.includes(LINKING)) label = "Link label";
  else if (name === "Series Resistance" && /CapacitorElm/.test(cls)) label = "ESR";
  else label = NAMES[name] ?? sentenceCase(name);
  if (!unit) unit = MISSING_UNITS[label] ?? "";
  if (!ei.kind || ei.kind === "number") {
    if (ei.dimensionless) unit = label === "Initial charge" ? "%" : unit;
  } else unit = "";
  const hint = [EXTRA_HINTS[label], ...hints].filter(Boolean).join(". ") || undefined;
  return { label, unit, hint, display: DISPLAY.test(label) };
}

/** Choice options, written the same way (sentence case, no shorthand). */
const CHOICES: Record<string, string> = {
  "D/C": "DC", "A/C": "Sine", "Square Wave": "Square", "Frequency/Duty Cycle": "Frequency and duty cycle",
  "High Time/Low Time": "High and low times", "MSB First": "MSB first", "LSB First": "LSB first",
  "7 Segment": "7-segment", "14 Segment": "14-segment", "16 Segment": "16-segment",
  "Common Cathode": "Common cathode", "Common Anode": "Common anode", "None (logic inputs)": "None (logic inputs)",
  "Individual Inputs": "Separate inputs", "Bus Input (Bit Select)": "Bus input (bit select)", "Bus Input/Output": "Bus input and output",
  "Individual Outputs": "Separate outputs", "Bus Output (Bit Distribute)": "Bus output (bit distribute)",
  "1 Input/Output Enable": "One input/output enable", "2 Input/Output Enables": "Two input/output enables",
  "P2P Voltage": "Peak-to-peak voltage", "RMS Voltage": "RMS voltage", "Average Voltage": "Average voltage",
  "Max Voltage": "Max voltage", "Min Voltage": "Min voltage", "Binary Value": "Binary value", "RMS Current": "RMS current",
  "V": "Voltage", "V(rms)": "RMS voltage", "Vmax": "Max voltage", "Vmin": "Min voltage", "Peak to peak": "Peak-to-peak voltage",
  "V(avg)": "Average voltage", "Pulse width": "Pulse width", "Duty cycle": "Duty cycle",
  "Instantaneous Power": "Instantaneous power", "Average Power": "Average power",
  ">=": "Rises to the voltage (≥)", "<=": "Falls to the voltage (≤)",
  "On Delay": "On delay", "Off Delay": "Off delay", "Latching (Set Coil)": "Latching (set coil)", "Latching (Reset Coil)": "Latching (reset coil)",
  "Alkaline 1.5V": "Alkaline 1.5 V", "NiMH 1.2V": "NiMH 1.2 V", "NiCd 1.2V": "NiCd 1.2 V", "Lead-Acid": "Lead-acid", "Lithium-Ion": "Lithium-ion",
  "Decimal Point": "Decimal point", "Colon": "Colon",
};

export function presentChoice(option: string, fieldName: string): string {
  // scale choices are units (A, mA, …), not voltages
  if (/^Scale$/i.test(fieldName)) return option;
  return CHOICES[option] ?? option;
}

/** Parts whose power the power report can count as output: two or more terminals, not a source, wire or ground. */
export function takesPower(e: CircuitElm): boolean {
  return e.getPostCount() >= 2 && !(e instanceof WireElm || e instanceof VoltageElm || e instanceof CurrentElm || e instanceof RailElm || e instanceof GroundElm);
}

/**
 * Symbols a property can also be named by in the console (`set R1 R 4.7k`), by its label; a
 * tolerance is Δ and its value's symbol (ΔR, Δβ), the heatsink Rth, a custom model's parameter its
 * SPICE name (vto, kp).
 */
export const PROPERTY_SYMBOLS: Record<string, string[]> = {
  "Resistance": ["R"], "Capacitance": ["C"], "Inductance": ["L"], "Voltage": ["V"], "Current": ["I"],
  "Frequency": ["f"], "Amplitude": ["Vpk"], "Peak voltage": ["Vpk"], "DC offset": ["Voff"], "Phase": ["φ", "phi"],
  "Duty cycle": ["D"], "Gain (hFE)": ["β", "beta", "hFE"], "Gain": ["Av"], "ESR": ["ESR"],
  "Initial voltage": ["V0"], "Initial current": ["I0"], "Internal resistance": ["Rs"], "Series resistance": ["Rs"],
  "Coupling": ["k"], "Saturation current": ["Isat"], "Turns ratio": ["n"], "Impedance": ["Z0"], "Delay": ["td"],
  "Breakdown voltage": ["Vbr"], "Holding current": ["Ih"], "Trigger current": ["Igt"], "On resistance": ["Ron"],
  "Off resistance": ["Roff"], "Primary inductance": ["Lp"], "Threshold": ["Vth"], "Upper threshold": ["Vth+"],
  "Lower threshold": ["Vth-"], "Maximum": ["Vmax"], "Minimum": ["Vmin"], "Voltage limit": ["Vmax"],
  "Nominal power": ["P"], "Nominal voltage": ["V"], "Capacity": ["Ah"], "Heatsink": ["Rth", "Rthca"],
};

