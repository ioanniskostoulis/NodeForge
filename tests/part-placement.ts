import assert from "node:assert/strict";
import { test } from "node:test";
import { createNew, CrossSwitchElm, DFlipFlopElm, TimerElm, CustomTransformerElm, GroundElm, GyratorElm, LineElm, PushSwitchElm, RailElm, ResistorElm, SwitchElm, TransformerElm, WireElm } from "../source/engine";
import { addPart, alignAxis, EndpointOperation, rotateSelection, partEndAtMinimumSpan } from "../source/app/document";
import type { SimulationModel } from "../source/app/model";

test("ground keeps one grid step, including when its handle reaches the other end", () => {
  const ground = createNew(GroundElm, 0, 0);
  assert.deepEqual(partEndAtMinimumSpan(ground, 0, 0, 0, 0, 16), [0, 16]);
  assert.deepEqual(partEndAtMinimumSpan(ground, 0, 0, 0, 0, 8), [0, 8]);

  ground.setPosition(0, 0, 0, 32);
  const model = { circuit: { options: { smallGrid: false } }, geometryChanged() {} } as SimulationModel;
  new EndpointOperation(model, ground, 1).apply(0, 32);
  assert.deepEqual([ground.x, ground.y, ground.x2, ground.y2], [0, 16, 0, 32]);
});

test("other parts keep their minimums; wires remain freely drawable", () => {
  assert.deepEqual(partEndAtMinimumSpan(createNew(RailElm, 0, 0), 0, 0, 0, 0, 16), [32, 0]);
  assert.deepEqual(partEndAtMinimumSpan(createNew(ResistorElm, 0, 0), 0, 0, 0, 0, 16), [32, 0]);
  assert.deepEqual(partEndAtMinimumSpan(createNew(LineElm, 0, 0), 0, 0, 0, 0, 16), [16, 0]);
  assert.deepEqual(partEndAtMinimumSpan(createNew(WireElm, 0, 0), 0, 0, 0, 0, 16), [0, 0]);
});

test("the cross switch keeps room for its crossed wiring", () => {
  assert.deepEqual(partEndAtMinimumSpan(createNew(CrossSwitchElm, 0, 0), 0, 0, 0, 0, 16), [64, 0]);
});

test("transformers and gyrators follow their direction instead of collapsing", () => {
  for (const C of [TransformerElm, GyratorElm, CustomTransformerElm]) {
    const e = createNew(C, 0, 0);
    e.setPosition(0, 0, 0, 64);
    alignAxis(e);
    assert.equal(e.point2.y, 64, `${C.name} vertical`);
    e.setPosition(0, 0, 64, 0);
    alignAxis(e);
    assert.equal(e.point2.x, 64, `${C.name} horizontal again`);
    assert.equal(e.point2.y, 0);
  }
});

test("a new switch is placed open; other switch kinds keep their defaults", () => {
  const model = { circuit: { elements: [], options: { smallGrid: false } } } as unknown as SimulationModel;
  const sw = addPart(model, SwitchElm, 0, 0, 64, 0);
  assert.equal((sw as SwitchElm).position, 1);
  const push = addPart(model, PushSwitchElm, 0, 64, 64, 64);
  assert.equal((push as PushSwitchElm).position, createNew(PushSwitchElm, 0, 0).position);
});

test("chips rotate a quarter turn at a time and come back after four", () => {
  const chip = createNew(DFlipFlopElm, 160, 160);
  chip.setPosition(160, 160, 224, 160);
  const model = { circuit: { elements: [chip], options: { smallGrid: false } }, selection: new Set([chip]) } as unknown as SimulationModel;
  const posts = () => Array.from({ length: chip.getPostCount() }, (_, i) => `${chip.getPost(i).x},${chip.getPost(i).y}`).join(" ");
  const box = () => [chip.boundingBox.width, chip.boundingBox.height];
  const [flags, start, [w, h]] = [chip.flags, posts(), box()];
  rotateSelection(model, true, 16);
  assert.deepEqual(box(), [h, w]);
  assert.notEqual(posts(), start);
  for (let i = 0; i < 3; i++) rotateSelection(model, true, 16);
  assert.equal(chip.flags, flags);
  assert.equal(posts(), start);
  for (const cw of [false, false, false, false]) rotateSelection(model, cw, 16);
  assert.equal(posts(), start);
});

test("a clockwise turn takes a chip's top pin to its right side", () => {
  const chip = createNew(TimerElm, 160, 160);
  chip.setPosition(160, 160, 224, 160);
  const model = { circuit: { elements: [chip], options: { smallGrid: false } }, selection: new Set([chip]) } as unknown as SimulationModel;
  const posts = () => Array.from({ length: chip.getPostCount() }, (_, i) => chip.getPost(i));
  const top = posts().reduce((best, p, i, all) => (p.y < all[best].y ? i : best), 0);
  rotateSelection(model, true, 16);
  const after = posts();
  assert.equal(after[top].x, Math.max(...after.map((p) => p.x)), "clockwise: top pin → right side");
  rotateSelection(model, false, 16);
  rotateSelection(model, false, 16);
  const ccw = posts();
  assert.equal(ccw[top].x, Math.min(...ccw.map((p) => p.x)), "counter-clockwise: top pin → left side");
});

test("every transformer resizes only along its core from either end", async () => {
  const { TappedTransformerElm } = await import("../source/engine");
  const { TransformerResizeOperation } = await import("../source/app/document");
  const { transformerHandles, windingPoints, windingLoops } = await import("../source/app/transformer-geometry");
  for (const C of [TransformerElm, TappedTransformerElm, CustomTransformerElm]) {
    for (const flip of [false, true]) for (const turns of [0, 1, 2, 3]) for (const kind of ["top", "bottom"] as const) {
      const e = createNew(C, 160, 160);
      e.setPosition(160, 160, 256, 160);
      if (flip) { e.flags |= C.FLAG_FLIP; e.setPoints(); }
      const model = { circuit: { elements: [e], options: { smallGrid: false } }, selection: new Set([e]), geometryChanged() {} } as unknown as SimulationModel;
      for (let i = 0; i < turns; i++) rotateSelection(model, true, 16);
      const h = transformerHandles(e), start = h[kind], other = kind === "top" ? "bottom" : "top";
      const coreLength = Math.hypot(h.bottom.x - h.top.x, h.bottom.y - h.top.y);
      const nx = (h.bottom.x - h.top.x) / coreLength, ny = (h.bottom.y - h.top.y) / coreLength;
      const width = e.width, span = Math.hypot(e.x2 - e.x, e.y2 - e.y);
      const extensions = [...e.terminalExtensions], inductance = e.inductance, coupling = e.couplingCoef;
      const loopCount = () => {
        const p = windingPoints(e);
        return windingLoops(p[0], p[e instanceof TransformerElm ? 2 : 1]);
      };
      const loops = loopCount();
      const op = new TransformerResizeOperation(model, e, { kind });
      op.apply(start.x + ny * 64, start.y - nx * 64);
      assert.equal(op.moved, false, `${C.name}: sideways movement ignored`);
      const delta = (kind === "top" ? -1 : 1) * h.widthScale * 32;
      op.apply(start.x + nx * delta, start.y + ny * delta);
      assert.equal(Math.abs(e.width), Math.abs(width) + 32);
      assert.ok(loopCount() > loops, `${C.name}: more visible loops`);
      assert.deepEqual(transformerHandles(e)[other], h[other], `${C.name}: opposite core end stays fixed`);
      assert.equal(Math.hypot(e.x2 - e.x, e.y2 - e.y), span);
      assert.deepEqual(e.terminalExtensions, extensions);
      assert.equal(e.inductance, inductance);
      assert.equal(e.couplingCoef, coupling);
      op.apply(start.x, start.y);
      assert.equal(op.moved, false, "returning the handle restores the original geometry");
      op.apply(start.x - nx * delta * 100, start.y - ny * delta * 100);
      assert.ok(Math.abs(e.width) >= (e instanceof CustomTransformerElm ? 16 : 32));
      assert.deepEqual(transformerHandles(e)[other], h[other], "minimum size keeps the other end fixed");
    }
  }
});

test("a transformer's lead ends turn it to face the pointer and change its width", async () => {
  const { TappedTransformerElm } = await import("../source/engine");
  const { TransformerLeadOperation } = await import("../source/app/document");
  const { transformerHandles } = await import("../source/app/transformer-geometry");
  for (const C of [TransformerElm, TappedTransformerElm, CustomTransformerElm]) {
    for (const flip of [false, true]) for (const turns of [0, 1, 2, 3]) {
      const fresh = () => {
        const e = createNew(C, 160, 160);
        e.setPosition(160, 160, 256, 160);
        if (flip) { e.flags |= C.FLAG_FLIP; e.setPoints(); }
        const model = { circuit: { elements: [e], options: { smallGrid: false } }, selection: new Set([e]), geometryChanged() {} } as unknown as SimulationModel;
        for (let i = 0; i < turns; i++) rotateSelection(model, true, 16);
        return { e, model };
      };
      const count = fresh().e.getPostCount();
      for (let index = 0; index < count; index++) {
        const name = `${C.name} flip ${flip} turns ${turns} lead ${index}`;
        const frame = (e: InstanceType<typeof C>) => {
          const p = e.getPost(index), dx = e.point2.x - e.point1.x, dy = e.point2.y - e.point1.y, d = Math.hypot(dx, dy);
          const ax = dx / d, ay = dy / d, mx = (e.point1.x + e.point2.x) / 2, my = (e.point1.y + e.point2.y) / 2;
          const along = (p.x - mx) * ax + (p.y - my) * ay;
          return { pivot: { x: p.x - 2 * ax * along, y: p.y - 2 * ay * along }, out: { x: ax * Math.sign(along), y: ay * Math.sign(along) }, span: d };
        };
        const core = (e: InstanceType<typeof C>) => {
          const h = transformerHandles(e);
          return { x: (h.top.x + h.bottom.x) / 2, y: (h.top.y + h.bottom.y) / 2 };
        };
        const posts = (e: InstanceType<typeof C>) => Array.from({ length: e.getPostCount() }, (_, i) => [e.getPost(i).x, e.getPost(i).y]);
        // held still: nothing changes
        {
          const { e, model } = fresh();
          const lead = e.getPost(index), op = new TransformerLeadOperation(model, e, index);
          op.apply(lead.x, lead.y);
          assert.equal(op.moved, false, `${name}: held still`);
        }
        // dragged outward: two grid steps wider, the other side kept, the core in the middle, the height kept
        {
          const { e, model } = fresh();
          const { out, span } = frame(e), width = e.width, lead = e.getPost(index);
          const otherSide = posts(e).filter((p) => (p[0] - lead.x) * out.x + (p[1] - lead.y) * out.y < -1);
          new TransformerLeadOperation(model, e, index).apply(lead.x + out.x * 32, lead.y + out.y * 32);
          assert.equal(frame(e).span, span + 32, `${name}: wider`);
          assert.equal(e.width, width, `${name}: height kept`);
          for (const p of otherSide) assert.ok(posts(e).some((q) => q[0] === p[0] && q[1] === p[1]), `${name}: other side kept`);
          const c = core(e), m = { x: (e.point1.x + e.point2.x) / 2, y: (e.point1.y + e.point2.y) / 2 };
          assert.ok(Math.abs((c.x - m.x) * out.x + (c.y - m.y) * out.y) < 1e-9, `${name}: core in the middle`);
        }
        // an odd span (five grid steps): kept while held still, a step wider after a drag, the core in the middle
        {
          const { e, model } = fresh();
          const { out } = frame(e);
          const p1 = e.point1, d = Math.hypot(e.point2.x - p1.x, e.point2.y - p1.y);
          e.setPosition(p1.x, p1.y, p1.x + (e.point2.x - p1.x) / d * 80, p1.y + (e.point2.y - p1.y) / d * 80);
          assert.equal(frame(e).span, 80, `${name}: odd span`);
          const lead = e.getPost(index), op = new TransformerLeadOperation(model, e, index);
          op.apply(lead.x, lead.y);
          assert.equal(op.moved, false, `${name}: odd span kept while held still`);
          op.apply(lead.x + out.x * 20, lead.y + out.y * 20);
          assert.equal(frame(e).span, 96, `${name}: a step wider after a drag`);
          const c = core(e), m = { x: (e.point1.x + e.point2.x) / 2, y: (e.point1.y + e.point2.y) / 2 };
          assert.ok(Math.abs((c.x - m.x) * out.x + (c.y - m.y) * out.y) < 1e-9, `${name}: drawn core in the middle`);
        }
        // dragged inward past the minimum: no narrower than 32
        {
          const { e, model } = fresh();
          const { out } = frame(e), lead = e.getPost(index);
          new TransformerLeadOperation(model, e, index).apply(lead.x - out.x * 64, lead.y - out.y * 64);
          assert.equal(frame(e).span, 32, `${name}: minimum width`);
        }
        // taken out around the part in each direction: it turns so the lead's side faces the pointer, about its
        // center, the height kept
        for (const swing of [1, 2, 3]) {
          const { e, model } = fresh();
          const { out } = frame(e), width = e.width, ps = posts(e);
          const cx = (Math.min(...ps.map((p) => p[0])) + Math.max(...ps.map((p) => p[0]))) / 2;
          const cy = (Math.min(...ps.map((p) => p[1])) + Math.max(...ps.map((p) => p[1]))) / 2;
          let tx = out.x, ty = out.y;
          for (let i = 0; i < swing; i++) [tx, ty] = [-ty, tx];
          const op = new TransformerLeadOperation(model, e, index);
          op.apply(cx + tx * 160, cy + ty * 160);
          const after = frame(e).out;
          assert.deepEqual([Math.round(after.x) || 0, Math.round(after.y) || 0], [tx || 0, ty || 0], `${name}: swing ${swing} faces the pointer`);
          assert.equal(e.width, width, `${name}: swing ${swing} keeps the height`);
          assert.ok(op.moved);
        }
        // moved inward over the part: narrower, never turned
        {
          const { e, model } = fresh();
          const { out } = frame(e), lead = e.getPost(index);
          new TransformerLeadOperation(model, e, index).apply(lead.x - out.x * 40, lead.y - out.y * 40);
          const after = frame(e).out;
          assert.deepEqual([Math.round(after.x) || 0, Math.round(after.y) || 0], [Math.round(out.x) || 0, Math.round(out.y) || 0], `${name}: not turned while narrowing`);
        }
      }
    }
  }
});

test("transformers and boxed subcircuits move, rotate and mirror as rigid grid-aligned parts", async () => {
  const { constructElement } = await import("../source/engine");
  const { MoveOperation, dragPart, flipSelection } = await import("../source/app/document");
  const { isTransformer } = await import("../source/app/transformer-geometry");
  const { isLeadPart, chipLeadHandles } = await import("../source/app/chip-handles");
  for (const grid of [8, 16]) for (const name of ["TransformerElm", "TappedTransformerElm", "CustomTransformerElm", "OptocouplerElm", "MotorProtectionSwitchElm", "OTAElm", "TransLineElm", "WattmeterTrueElm", "ThreePhaseMotorElm", "DFlipFlopElm", "TimerElm", "CustomCompositeElm:~LM317-v2", "CustomCompositeElm:~TL431"]) {
    const e = constructElement(name, 160, 160)!;
    assert.ok(e, name);
    dragPart(e, e.constructor as never, 160, 160, 160 + 5 * grid, 160, grid);
    if (isLeadPart(e)) { e.leadExtensions = [16, 32, 48, 64]; e.setPoints(); }
    const model = { circuit: { elements: [e], options: { smallGrid: grid === 8 } }, selection: new Set([e]), geometryChanged() {} } as unknown as SimulationModel;
    const posts = () => Array.from({ length: e.getPostCount() }, (_, i) => ({ x: e.getPost(i).x, y: e.getPost(i).y }));
    const checkGrid = () => {
      // a transformer's core sits in the middle between its leads, between dots on an odd span: only its posts are on the grid
      const handles = isTransformer(e) ? [] : isLeadPart(e) ? chipLeadHandles(e) : posts();
      for (const p of [...posts(), ...handles]) { assert.equal(p.x % grid, 0, `${name}: x ${p.x}`); assert.equal(p.y % grid, 0, `${name}: y ${p.y}`); }
    };
    checkGrid();
    const beforeMove = posts();
    new MoveOperation(model, [e]).apply(3 * grid, -2 * grid);
    assert.deepEqual(posts(), beforeMove.map(p => ({ x: p.x + 3 * grid, y: p.y - 2 * grid })));
    const initial = posts();
    for (let i = 0; i < 4; i++) {
      const before = posts(); rotateSelection(model, true, grid); const after = posts();
      for (let j = 0; j < before.length; j++) {
        assert.equal(after[j].x - after[0].x, -(before[j].y - before[0].y) || 0, `${name}: clockwise x`);
        assert.equal(after[j].y - after[0].y, before[j].x - before[0].x, `${name}: clockwise y`);
      }
      checkGrid();
    }
    assert.deepEqual(posts(), initial, `${name}: four turns return to the same pins`);
    for (const horizontal of [true, false]) {
      const before = posts(); flipSelection(model, horizontal, grid); const after = posts();
      for (let j = 0; j < before.length; j++) {
        assert.equal(after[j].x - after[0].x, (horizontal ? -1 : 1) * (before[j].x - before[0].x) || 0, `${name}: mirror x`);
        assert.equal(after[j].y - after[0].y, (horizontal ? 1 : -1) * (before[j].y - before[0].y) || 0, `${name}: mirror y`);
      }
      checkGrid(); flipSelection(model, horizontal, grid); assert.deepEqual(posts(), before);
    }
  }
});

test("a transformer's core sits in the middle between its leads, its handles at the core's ends", async () => {
  const { TappedTransformerElm } = await import("../source/engine");
  const { transformerHandles } = await import("../source/app/transformer-geometry");
  for (const C of [TransformerElm, TappedTransformerElm, CustomTransformerElm]) {
    // an older file's odd span and height: the core between dots, the terminals where they were
    const e = createNew(C, 160, 160);
    e.width = 43; e.setPosition(160, 160, 240, 160);
    const posts = Array.from({ length: e.getPostCount() }, (_, i) => ({ ...e.getPost(i) }));
    const h = transformerHandles(e);
    assert.deepEqual(h.top, { x: 200, y: 160 }, `${C.name}: top handle in the middle`);
    assert.equal(h.bottom.x, 200, `${C.name}: bottom handle in the middle`);
    const xs = e.ptCore.map((p) => p.x);
    assert.equal((Math.min(...xs) + Math.max(...xs)) / 2, 200, `${C.name}: core in the middle`);
    for (const p of [h.top, h.bottom]) assert.ok(e.ptCore.some((q) => Math.abs(q.x - p.x) <= 2 && Math.abs(q.y - p.y) <= 2), `${C.name}: handle on the core's end`);
    assert.deepEqual(Array.from({ length: e.getPostCount() }, (_, i) => e.getPost(i)), posts);
  }
});
