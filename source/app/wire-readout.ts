// Values printed beside a wire when its CircuitJS display flags request them.
// Licensed under the GNU General Public License v2 or later. See LICENSE.
import { WireElm } from "../engine";
import { si } from "./format";

export const SHOW_BUS_VALUE = 4;
export const SHOW_BUS_VALUE_HEX = 8;

/** CircuitJS uses > 2.5 V as a high bit, with bit 0 at the first bus post. */
export function wireReadout(wire: Pick<WireElm, "flags" | "busWidth" | "volts" | "getCurrent">): string | null {
  const labels: string[] = [];
  if (wire.busWidth > 1) {
    if (!(wire.flags & (SHOW_BUS_VALUE | SHOW_BUS_VALUE_HEX))) return null;
    let value = 0n;
    for (let bit = 0; bit < wire.busWidth; bit++) {
      if ((wire.volts[bit] ?? 0) > 2.5) value |= 1n << BigInt(bit);
    }
    if (wire.flags & SHOW_BUS_VALUE) labels.push(value.toString(10));
    if (wire.flags & SHOW_BUS_VALUE_HEX) labels.push(`0x${value.toString(16).toUpperCase()}`);
  } else {
    if (wire.flags & WireElm.FLAG_SHOWCURRENT) labels.push(si(Math.abs(wire.getCurrent()), "A"));
    if (wire.flags & WireElm.FLAG_SHOWVOLTAGE) labels.push(si(wire.volts[0] ?? 0, "V"));
  }
  return labels.length ? labels.join(" ") : null;
}
