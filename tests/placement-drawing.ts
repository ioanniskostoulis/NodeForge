// Every Draw-menu part can be drawn during placement in eight directions. Rotation,
// mirroring and saving must preserve pin positions.
import "./browser-stubs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { classForName, constructElement, createNew, type CircuitElm, type ElmClass } from "../source/engine";
import { dragPart } from "../source/app/document";
import type { DrawItem } from "../source/app/library";
import { SimulationModel } from "../source/app/model";
import { SchematicRenderer } from "../source/app/renderer";
import { currentTheme } from "../source/app/theme";
import { Viewport } from "forge-shell/app/viewport";

// a canvas that accepts every call
const ctx = new Proxy({} as Record<string | symbol, unknown>, {
  get(target, key) {
    if (key in target) return target[key];
    if (key === "measureText") return () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
    if (key === "getTransform") return () => new DOMMatrix();
    if (key === "createLinearGradient" || key === "createRadialGradient") return () => ({ addColorStop() {} });
    if (key === "getLineDash") return () => [];
    return () => undefined;
  },
  set(target, key, value) { target[key] = value; return true; },
}) as unknown as CanvasRenderingContext2D;

const menu = JSON.parse(readFileSync("public/drawmenu.json", "utf8")) as DrawItem[];
const names: string[] = [];
const collect = (items: DrawItem[]) => items.forEach((d) => {
  if (d.class && d.class !== "Select" && !d.class.startsWith("Drag")) names.push(d.class);
  else if (d.items) collect(d.items);
});
collect(menu);

const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const EMPTY = '<cir f="1" ts="0.000005" ic="10" cb="50" pb="50" vr="5" mts="5e-11">\n</cir>\n';

function drawErrors(model: SimulationModel, hover: CircuitElm | null): string[] {
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  try {
    new SchematicRenderer(model).draw(ctx, 2000, 2000, new Viewport(1, 0, 0), currentTheme(), hover, { marquee: null, handles: true, pointer: null } as never);
  } catch (error) {
    errors.push(String(error));
  } finally {
    console.error = original;
  }
  return errors;
}

test("every part draws while being dragged out, in eight directions", () => {
  const failures: string[] = [];
  for (const name of names) {
    for (const [dx, dy] of DIRECTIONS) {
      const model = new SimulationModel(EMPTY);
      const C = classForName(name);
      const e = constructElement(name, 160, 160) ?? (C ? createNew(C, 160, 160) : null);
      assert.ok(e, name);
      dragPart(e, e.constructor as ElmClass, 160, 160, 160 + dx * 64, 160 + dy * 64, 16);
      model.circuit.elements.push(e);
      // the part under the mouse is highlighted while it's dragged
      for (const message of drawErrors(model, e)) failures.push(`${name} (${dx},${dy}): ${message.split("\n")[0]}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("every multi-terminal part preserves pin identity when rotated and mirrored", async () => {
  const { rotateSelection, flipSelection } = await import("../source/app/document");
  const { Circuit, grid, writeCircuit } = await import("../source/engine");
  const failures: string[] = [];
  try {
    for (const spacing of [8, 16]) for (const name of names) {
      grid.size = spacing;
      const C = classForName(name);
      const e = constructElement(name, 160, 160) ?? (C ? createNew(C, 160, 160) : null);
      if (!e || e.getPostCount() < 3) continue;
      const model = new SimulationModel(EMPTY);
      model.circuit.options.smallGrid = spacing === 8;
      grid.size = spacing;
      dragPart(e, e.constructor as ElmClass, 160, 160, 160 + 5 * spacing, 160, spacing);
      model.circuit.elements.push(e); model.selection.add(e);
      const posts = () => Array.from({ length: e.getPostCount() }, (_, i) => ({ ...e.getPost(i) }));
      for (let turn = 0; turn < 4; turn++) for (const operation of ["cw", "horizontal", "vertical"]) {
        const before = posts();
        if (operation === "cw") rotateSelection(model, true, spacing);
        else flipSelection(model, operation === "horizontal", spacing);
        const after = posts();
        const label = `${name}, grid ${spacing}, turn ${turn}, ${operation}`;
        for (let i = 0; i < before.length; i++) {
          const dx = before[i].x - before[0].x, dy = before[i].y - before[0].y;
          const want = operation === "cw" ? [-dy, dx] : operation === "horizontal" ? [-dx, dy] : [dx, -dy];
          if (after[i].x - after[0].x !== want[0] || after[i].y - after[0].y !== want[1]) failures.push(`${label}: pin ${i} changed side`);
          if (after[i].x % spacing || after[i].y % spacing) failures.push(`${label}: pin ${i} off grid`);
        }
        failures.push(...drawErrors(model, e).map(error => `${label}: ${error}`));
        const saved = Circuit.parse(writeCircuit(model.circuit, "xml")).elements[0];
        for (let i = 0; i < after.length; i++) {
          const p = saved.getPost(i);
          if (p.x !== after[i].x || p.y !== after[i].y) failures.push(`${label}: saved pin ${i} moved`);
        }
        if (operation !== "cw") flipSelection(model, operation === "horizontal", spacing);
      }
    }
  } finally { grid.size = 16; }
  assert.deepEqual(failures, []);
});
