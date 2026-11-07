// Physical-side handles for fixed-size chips: only their straight pin leads resize.
import { ChipElm, CustomCompositeElm, Side, type CircuitElm } from "../engine";

export type LeadPart = ChipElm | CustomCompositeElm;
export type LeadHandle = { side: number; index: number; x: number; y: number };

export function isLeadPart(e: CircuitElm): e is LeadPart {
  return e instanceof ChipElm || e instanceof CustomCompositeElm && !!e.chip?.pins.length;
}

export function chipLeadHandles(e: LeadPart): LeadHandle[] {
  const chip = e instanceof ChipElm ? e : e.chip;
  if (!chip) return [];
  const handles: LeadHandle[] = [];
  for (const [index, pin] of chip.pins.entries()) {
    if (pin.busZ > 0) continue; // These bus bits do not draw individual leads.
    const dx = pin.post.x - pin.stub.x, dy = pin.post.y - pin.stub.y;
    const side = Math.abs(dx) > Math.abs(dy) ? dx < 0 ? Side.W : Side.E : dy < 0 ? Side.N : Side.S;
    handles.push({ side, index, x: pin.post.x, y: pin.post.y });
  }
  return handles;
}
