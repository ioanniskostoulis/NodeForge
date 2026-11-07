// Writes tests/components/: every Draw-menu part, one circuit per menu group (plus all.xml),
// each part placed as a click places it (horizontal) and again rotated (vertical), with its name.
// Also drag-NN-*.xml: each part dragged out with the mouse in eight directions.
// Regenerate: npm run gallery. Open: tests/web.command, then ?c=_components/<file> (see README).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { Circuit, classForName, constructElement, createNew, TextElm, writeXml, type CircuitElm, type ElmClass } from "../source/engine";
import { defaultEnd, dragPart } from "../source/app/document";
import type { DrawItem } from "../source/app/library";

const CELL_W = 256, CELL_H = 192, COLUMNS = 6;
const menu = JSON.parse(readFileSync("public/drawmenu.json", "utf8")) as DrawItem[];

interface Group { name: string; parts: DrawItem[] }
// tools, not parts: Select and the Drag modes
const isPart = (d: DrawItem) => !!d.class && d.class !== "Select" && !d.class.startsWith("Drag");
const groups: Group[] = [{ name: "Basic", parts: [] }];
for (const d of menu) {
  if (isPart(d)) groups[0].parts.push(d);
  else if (d.items?.some(isPart)) groups.push({ name: d.label, parts: d.items.filter(isPart) });
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function text(x: number, y: number, s: string, size = 12): CircuitElm {
  const t = createNew(TextElm, x, y) as TextElm;
  t.text = s;
  t.size = size;
  (t as unknown as { split(): void }).split();
  t.setPosition(x, y, x + 16, y);
  return t;
}

function place(name: string, x: number, y: number, vertical: boolean): CircuitElm | null {
  const C = classForName(name);
  const e = constructElement(name, x, y) ?? (C ? createNew(C, x, y) : null);
  if (!e) return null;
  let [x2, y2] = defaultEnd(e.constructor as ElmClass, x, y);
  if (vertical) [x2, y2] = [x + (y2 - y), y + (x2 - x)];
  dragPart(e, e.constructor as ElmClass, x, y, x2, y2, 16);
  e.setPoints();
  return e;
}

function postsX(e: CircuitElm): { min: number; max: number } {
  const xs = Array.from({ length: e.getPostCount() }, (_, i) => e.getPost(i).x);
  return { min: Math.min(...xs), max: Math.max(...xs) };
}

function groupCircuit(group: Group, top = 0): { elements: CircuitElm[]; height: number; missing: string[] } {
  const elements: CircuitElm[] = [text(16, top + 8, group.name, 24)];
  const missing: string[] = [];
  group.parts.forEach((d, i) => {
    const x = 32 + (i % COLUMNS) * CELL_W, y = top + 64 + Math.floor(i / COLUMNS) * CELL_H;
    const label = d.label.replace(/^Add /, "");
    const h = place(d.class!, x + 32, y + 48, false);
    let v = place(d.class!, x + 160, y + 48, true);
    if (!h || !v) { missing.push(`${label} (${d.class})`); return; }
    // keep the rotated copy's terminals clear of the first copy's, so the two aren't connected
    const shift = Math.max(0, Math.ceil((postsX(h).max + 32 - postsX(v).min) / 16) * 16);
    if (shift) v = place(d.class!, x + 160 + shift, y + 48, true)!;
    elements.push(text(x, y - 24, label), h, v);
  });
  return { elements, height: 96 + Math.ceil(group.parts.length / COLUMNS) * CELL_H, missing };
}

function save(file: string, elements: CircuitElm[]): void {
  const c = new Circuit();
  c.elements = elements;
  writeFileSync(`tests/components/${file}`, writeXml(c));
}

// MARK: dragged out with the mouse in eight directions (drag-NN-*.xml), checked for broken geometry

const DIRECTIONS: [string, number, number][] = [
  ["→", 1, 0], ["←", -1, 0], ["↓", 0, 1], ["↑", 0, -1], ["↘", 1, 1], ["↗", 1, -1], ["↙", -1, 1], ["↖", -1, -1],
];
const DRAG = 64, DRAG_CELL = 224;

function dragged(name: string, x: number, y: number, dx: number, dy: number): CircuitElm | null {
  const C = classForName(name);
  const e = constructElement(name, x, y) ?? (C ? createNew(C, x, y) : null);
  if (!e) return null;
  dragPart(e, e.constructor as ElmClass, x, y, x + dx * DRAG, y + dy * DRAG, 16);
  e.setPoints();
  return e;
}

/** Problems a placement shouldn't have: no size, invalid numbers, two terminals in one place. */
function problems(e: CircuitElm): string[] {
  const out: string[] = [];
  const posts = Array.from({ length: e.getPostCount() }, (_, i) => e.getPost(i));
  if (posts.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) out.push("invalid terminal");
  const seen = new Set<string>();
  for (const p of posts) {
    const k = `${p.x},${p.y},${(p as { z?: number }).z ?? 0}`;
    if (seen.has(k)) { out.push("terminals overlap"); break; }
    seen.add(k);
  }
  if (e.getPostCount() >= 2 && e.x === e.x2 && e.y === e.y2) out.push("no length");
  return out;
}

function dragCircuit(group: Group): { elements: CircuitElm[]; issues: string[] } {
  const elements: CircuitElm[] = [text(16, 8, `${group.name}, dragged out`, 24)];
  const issues: string[] = [];
  DIRECTIONS.forEach(([arrow], j) => elements.push(text(160 + j * DRAG_CELL, 48, arrow, 18)));
  group.parts.forEach((d, i) => {
    const y = 160 + i * DRAG_CELL, label = d.label.replace(/^Add /, "");
    elements.push(text(16, y, label));
    DIRECTIONS.forEach(([arrow, dx, dy], j) => {
      const e = dragged(d.class!, 160 + j * DRAG_CELL + 64, y, dx, dy);
      if (!e) return;
      for (const p of problems(e)) issues.push(`${label} ${arrow}: ${p}`);
      elements.push(e);
    });
  });
  return { elements, issues };
}

mkdirSync("tests/components", { recursive: true });
const all: CircuitElm[] = [];
let top = 0, count = 0;
const index: string[] = [];
groups.forEach((g, n) => {
  const file = `${String(n + 1).padStart(2, "0")}-${slug(g.name)}.xml`;
  const one = groupCircuit(g);
  save(file, one.elements);
  const placed = groupCircuit(g, top);
  all.push(...placed.elements);
  top += placed.height;
  count += g.parts.length - one.missing.length;
  index.push(`${file}  ${g.name}: ${g.parts.length - one.missing.length} parts${one.missing.length ? `; not placeable: ${one.missing.join(", ")}` : ""}`);
});
save("all.xml", all);

// small views for inspection (gitignored): three parts by four directions, straight then diagonal
rmSync("tests/components/_views", { recursive: true, force: true });
mkdirSync("tests/components/_views");
groups.forEach((g, n) => {
  for (let first = 0; first < g.parts.length; first += 3) {
    for (const [half, dirs] of [["straight", DIRECTIONS.slice(0, 4)], ["diagonal", DIRECTIONS.slice(4)]] as const) {
      const elements: CircuitElm[] = [];
      g.parts.slice(first, first + 3).forEach((d, i) => {
        const y = 96 + i * DRAG_CELL;
        elements.push(text(16, y, d.label.replace(/^Add /, "")));
        dirs.forEach(([, dx, dy], j) => {
          const e = dragged(d.class!, 224 + j * DRAG_CELL, y, dx, dy);
          if (e) elements.push(e);
        });
      });
      const c = new Circuit();
      c.elements = elements;
      writeFileSync(`tests/components/_views/${String(n + 1).padStart(2, "0")}-${String(first / 3 + 1).padStart(2, "0")}-${half}.xml`, writeXml(c));
    }
  }
});
const dragIssues: string[] = [];
groups.forEach((g, n) => {
  const { elements, issues } = dragCircuit(g);
  save(`drag-${String(n + 1).padStart(2, "0")}-${slug(g.name)}.xml`, elements);
  dragIssues.push(...issues.map((t) => `${g.name}: ${t}`));
});
console.log(dragIssues.length ? `Dragged-out problems:\n${dragIssues.join("\n")}` : "Dragged out in 8 directions: no geometry problems found.");
console.log(index.join("\n"));
console.log(`${count} parts in ${groups.length} groups → tests/components/`);
