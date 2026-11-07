// Smooth canvas curves through sampled schematic points.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { P } from "./geom";

/** Append a continuous cubic curve through every point to the current canvas path. */
export function traceSmoothCurve(ctx: CanvasRenderingContext2D, points: readonly P[]): void {
  if (!points.length) return;
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 0; i + 1 < points.length; i++) {
    const before = points[Math.max(0, i - 1)];
    const start = points[i];
    const end = points[i + 1];
    const after = points[Math.min(points.length - 1, i + 2)];
    ctx.bezierCurveTo(
      start.x + (end.x - before.x) / 6, start.y + (end.y - before.y) / 6,
      end.x - (after.x - start.x) / 6, end.y - (after.y - start.y) / 6,
      end.x, end.y,
    );
  }
}
