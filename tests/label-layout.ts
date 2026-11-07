// Label placement (source/app/labels.ts): pure geometry, no canvas.
import assert from "node:assert/strict";
import { test } from "node:test";
import { intersects, type LabelGroup, type LabelLine, layoutLabels, type Obstacle, type PlacedLabel, type Rect } from "../source/app/labels";

type Part = { name: string; a: { x: number; y: number }; b: { x: number; y: number } };

const lines = (name: string, value = "10 kΩ"): LabelLine[] => [
  { text: name, kind: "designator", w: 7 * name.length, h: 13 },
  { text: value, kind: "value", w: 6 * value.length, h: 12.5 },
];

/** A two-terminal part: leads to a body 6 either side of the axis, 24 long. */
function part(name: string, ax: number, ay: number, bx: number, by: number): { group: LabelGroup<string>; obstacles: Obstacle<string>[] } {
  const a = { x: ax, y: ay }, b = { x: bx, y: by };
  const len = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / len, uy = (by - ay) / len;
  const m = { x: (ax + bx) / 2, y: (ay + by) / 2 };
  const p = (t: number) => ({ x: m.x + ux * t, y: m.y + uy * t });
  const [l1, l2] = [p(-12), p(12)];
  const body: Rect = { x: Math.min(l1.x, l2.x) - Math.abs(uy) * 6, y: Math.min(l1.y, l2.y) - Math.abs(ux) * 6, w: Math.abs(l2.x - l1.x) + Math.abs(uy) * 12, h: Math.abs(l2.y - l1.y) + Math.abs(ux) * 12 };
  return {
    group: { owner: name, lines: lines(name), anchor: { kind: "axis", a, b, clear: [7, 7] } },
    obstacles: [
      { owner: name, kind: "lead", seg: { ax, ay, bx: l1.x, by: l1.y, hw: 1 } },
      { owner: name, kind: "lead", seg: { ax: l2.x, ay: l2.y, bx, by, hw: 1 } },
      { owner: name, kind: "body", rect: body },
    ],
  };
}

function wire(name: string, ax: number, ay: number, bx: number, by: number): Obstacle<string> {
  return { owner: name, kind: "wire", seg: { ax, ay, bx, by, hw: 1 } };
}

function run(parts: ReturnType<typeof part>[], extra: Obstacle<string>[] = []): Map<string, PlacedLabel[]> {
  return layoutLabels(parts.map((p) => p.group), [...parts.flatMap((p) => p.obstacles), ...extra]);
}

function overlaps(layout: Map<string, PlacedLabel[]>, obstacles: Obstacle<string>[] = []): number {
  const all = [...layout].flatMap(([owner, ls]) => ls.map((l) => ({ owner, r: l.rect })));
  let n = 0;
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (intersects(all[i].r, all[j].r)) n++;
  for (const o of obstacles) if (o.rect && o.kind === "body") for (const l of all) if (intersects(l.r, o.rect)) n++;
  return n;
}

const centreY = (ls: PlacedLabel[]) => ls[0].rect.y;

test("a lone horizontal part: designator above, value below", () => {
  const out = run([part("R1", 0, 0, 64, 0)]);
  const [des, val] = out.get("R1")!;
  assert.ok(des.rect.y + des.rect.h <= -7, "designator above the body");
  assert.ok(val.rect.y >= 7, "value below the body");
  assert.equal(des.align, "center");
});

test("a lone upright part: labels to its right, left-aligned", () => {
  const out = run([part("R1", 0, 0, 0, 64)]);
  for (const l of out.get("R1")!) {
    assert.equal(l.align, "left");
    assert.ok(l.rect.x >= 7);
  }
});

test("a wire over a part sends both labels below it", () => {
  const p = part("R1", 0, 0, 64, 0);
  const out = run([p], [wire("W1", -40, -12, 104, -12)]);
  for (const l of out.get("R1")!) assert.ok(l.rect.y > 0, `${l.text} below`);
});

test("parts in a row keep to the same side", () => {
  const parts = [0, 1, 2, 3].map((i) => part(`R${i + 1}`, i * 64, 0, i * 64 + 64, 0));
  // a wire over the middle of R2 only: the row moves together rather than R2 alone
  const out = run(parts, [wire("W1", 80, -16, 112, -16)]);
  const sides = parts.map((p) => out.get(p.group.owner)!.every((l) => l.rect.y > 0) ? "below" : out.get(p.group.owner)![0].rect.y < 0 ? "above" : "?");
  assert.equal(new Set(sides).size, 1, `sides: ${sides.join(" ")}`);
});

test("upright parts side by side don't put labels on each other", () => {
  // 32 apart: R1's labels to its right would sit on R2
  const parts = [part("R1", 0, 0, 0, 64), part("R2", 32, 0, 32, 64), part("R3", 64, 0, 64, 64)];
  const out = run(parts);
  assert.equal(overlaps(out, parts.flatMap((p) => p.obstacles)), 0);
});

test("a dense grid of parts ends with no label on a label or a body", () => {
  const parts: ReturnType<typeof part>[] = [];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    const x = i * 96, y = j * 96;
    parts.push((i + j) % 2 ? part(`R${i}${j}`, x, y, x + 64, y) : part(`C${i}${j}`, x, y, x, y + 64));
  }
  const out = run(parts);
  assert.equal(overlaps(out, parts.flatMap((p) => p.obstacles)), 0);
  // and the free ones in conventional places
  assert.ok(centreY(out.get("R10")!) < 0);
});

test("a wire's readout moves off a part sitting on its middle", () => {
  const p = part("R1", 48, -40, 48, 24);
  const out = layoutLabels(
    [p.group, { owner: "W1", lines: [{ text: "1.00 mA", kind: "readout", w: 40, h: 12.5 }], anchor: { kind: "wire", points: [{ x: 0, y: 0 }, { x: 128, y: 0 }] } }],
    [...p.obstacles, wire("W1", 0, 0, 128, 0)],
  );
  const r = out.get("W1")![0];
  assert.equal(r.kind, "readout");
  assert.equal(overlaps(out, p.obstacles), 0);
});

test("unavoidable overlap is kept small", () => {
  // two parts on top of each other: the labels still separate
  const parts = [part("R1", 0, 0, 64, 0), part("R2", 0, 0, 64, 0)];
  const out = run(parts);
  const [a, b] = [out.get("R1")!, out.get("R2")!];
  for (const x of a) for (const y of b) assert.ok(!intersects(x.rect, y.rect), `${x.text} on ${y.text}`);
});
