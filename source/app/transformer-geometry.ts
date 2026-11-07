// Shared transformer display geometry. The engine's posts and electrical model stay unchanged.
import { type CircuitElm, CustomTransformerElm, type GridPoint, TappedTransformerElm, TransformerElm } from "../engine";
import { dist, type P, unit } from "./geom";

export type TransformerPart = TransformerElm | TappedTransformerElm | CustomTransformerElm;

export function isTransformer(e: CircuitElm): e is TransformerPart {
  return e instanceof TransformerElm || e instanceof TappedTransformerElm || e instanceof CustomTransformerElm;
}

export function windingShift(): number {
  // Keep a small gap between the winding outline and the core.
  return 6;
}

/** Winding baselines sit outside the core; each 16-unit loop curves inward. */
export function windingPoints(e: TransformerPart): GridPoint[] {
  const axis = unit(e.point1, e.point2);
  const shift = windingShift();
  const source = e instanceof CustomTransformerElm ? e.nodeTaps : e.ptCoil;
  const primaryNodes = e instanceof CustomTransformerElm
    ? (e.primaryCoils === e.coilCount ? e.nodeCount : e.coilNodes[e.primaryCoils])
    : e instanceof TappedTransformerElm ? 2 : -1;
  return source.map((p, i) => {
    const primary = e instanceof TransformerElm ? i === 0 || i === 2 : i < primaryNodes;
    const sign = primary ? -1 : 1;
    return { ...p, x: p.x + axis.x * sign * shift, y: p.y + axis.y * sign * shift };
  });
}

export function windingLoops(a: P, b: P): number {
  return Math.max(1, Math.round(dist(a, b) / 16));
}

function coreFrame(e: TransformerPart) {
  const axis = unit(e.point1, e.point2), normal = { x: -axis.y, y: axis.x };
  let farthest = 0;
  for (const p of e.ptCore) {
    const offset = (p.x - e.point1.x) * normal.x + (p.y - e.point1.y) * normal.y;
    if (Math.abs(offset) > Math.abs(farthest)) farthest = offset;
  }
  return { axis, normal, farthest };
}

/**
 * Two resize handles at the center of each end of the core. The core sits in the middle between the
 * leads, so its handles may fall between grid dots.
 */
export function transformerHandles(e: TransformerPart): { top: P; bottom: P; widthScale: number; widthSide: number } {
  const { normal, farthest } = coreFrame(e);
  const cx = (e.point1.x + e.point2.x) / 2, cy = (e.point1.y + e.point2.y) / 2;
  return {
    top: { x: cx, y: cy },
    bottom: { x: cx + normal.x * farthest, y: cy + normal.y * farthest },
    widthScale: e instanceof CustomTransformerElm ? Math.max(1, e.primaryCoils, e.coilCount - e.primaryCoils) : 1,
    widthSide: Math.sign(farthest) || 1,
  };
}
