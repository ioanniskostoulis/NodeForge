// Generic part handles live on visible electrical terminals, or on geometry ends for sheet objects.
import { TextElm, type CircuitElm } from "../engine";

export type PartHandle = { x: number; y: number; end: 1 | 2 };

export function partHandles(part: CircuitElm): PartHandle[] {
  if (part instanceof TextElm) return [{ x: part.point1.x, y: part.point1.y, end: 1 }];
  if (part.getPostCount() === 0) return [
    { x: part.point1.x, y: part.point1.y, end: 1 },
    { x: part.point2.x, y: part.point2.y, end: 2 },
  ];
  const handles: PartHandle[] = [];
  for (let index = 0; index < part.getPostCount(); index++) {
    const post = part.getPost(index);
    if (handles.some((handle) => handle.x === post.x && handle.y === post.y)) continue;
    const distanceToStart = Math.hypot(post.x - part.point1.x, post.y - part.point1.y);
    const distanceToEnd = Math.hypot(post.x - part.point2.x, post.y - part.point2.y);
    handles.push({ x: post.x, y: post.y, end: distanceToStart <= distanceToEnd ? 1 : 2 });
  }
  return handles;
}
