import "./browser-stubs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { CanvasView } from "../source/app/canvas";
import { CircuitDocument } from "../source/app/document";
import { classForName, ResistorElm } from "../source/engine";
import { addPart } from "../source/app/document";
import { Inspector } from "../source/app/inspector";
import { renderMenubar } from "../source/app/menus";
import { settings } from "../source/app/settings";

class Element extends EventTarget {
  children: Element[] = [];
  parent: Element | null = null;
  style = {};
  className = "";
  classList = { add() {}, remove() {}, toggle() { return false; }, contains() { return false; } };
  attributes = new Map<string, string>();
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  append(...elements: Element[]) { for (const e of elements) { e.parent = this; this.children.push(e); } }
  replaceChildren() { for (const e of this.children) e.parent = null; this.children = []; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(e => e !== this); this.parent = null; }
  getBoundingClientRect() { return { left: 0, right: 100, top: 0, bottom: 20, width: 100, height: 20 }; }
}

function event(type: string, values: Record<string, unknown> = {}) {
  return Object.assign(new Event(type, { cancelable: true }), values);
}

test("inspector fields separate the number and unit with a space, except percent and degrees", () => {
  const original = globalThis.document;
  Object.assign(globalThis, { document: { createElement: () => new Element() } });
  try {
    const inspector = Object.create(Inspector.prototype);
    for (const [value, unit, text] of [[4700, "Ω", "4.7 kΩ"], [300e-9, "F", "300 nF"],
      [5, "°C/W", "5 °C/W"], [20, "%", "20%"], [45, "°", "45°"], [27, "°C", "27 °C"], [5, "", "5"]]) {
      const field = inspector.numberField("Value", value, unit, () => {});
      assert.equal(field.children[1].value, text);
    }
  } finally { globalThis.document = original; }
});

test("rebuilding the browser menu removes popups and listeners; Escape closes it", () => {
  const original = globalThis.document;
  const root = new Element(), bar = new Element();
  const listeners = new Map<string, Set<unknown>>();
  const doc = new EventTarget();
  Object.assign(globalThis, { innerWidth: 1000, innerHeight: 800, document: {
    createElement: () => new Element(), getElementById: () => root,
    addEventListener(type: string, fn: EventListener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn); doc.addEventListener(type, fn);
    },
    removeEventListener(type: string, fn: EventListener) { listeners.get(type)?.delete(fn); doc.removeEventListener(type, fn); },
  } });
  try {
    const render = () => renderMenubar(bar as never, [{ label: "Draw", submenu: [] }], () => {});
    render();
    bar.children[0].dispatchEvent(event("mousedown"));
    assert.equal(root.children.length, 1);
    render();
    assert.equal(root.children.length, 0, "old menu is gone after rebuilding");
    assert.equal(listeners.get("mousedown")!.size, 1);
    assert.equal(listeners.get("keydown")!.size, 1);
    bar.children[0].dispatchEvent(event("mousedown"));
    const escape = event("keydown", { key: "Escape" });
    doc.dispatchEvent(escape);
    assert.equal(root.children.length, 0);
    assert.equal(escape.defaultPrevented, true);
  } finally { globalThis.document = original; }
});

test("opening properties expands their section before focusing a field", () => {
  const old = settings.propertiesExpanded;
  settings.propertiesExpanded = false;
  const calls: string[] = [];
  const original = globalThis.HTMLInputElement;
  Object.assign(globalThis, { HTMLInputElement: class {} });
  try {
    Inspector.prototype.focusProperties.call({
      model: { selected: null },
      applySections() { assert.equal(settings.propertiesExpanded, true); calls.push("expand"); },
      buildProperties() { calls.push("build"); },
      props: { querySelector() { return { focus() { calls.push("focus"); } }; } },
    } as never);
    assert.deepEqual(calls, ["expand", "build", "focus"]);
  } finally { settings.propertiesExpanded = old; globalThis.HTMLInputElement = original; }
});

test("placing and moving parts freeze the fitted viewport before changing geometry", () => {
  const events = { onFocusChange() {}, onEdit() {}, onToolChange() {}, editProperties() {}, contextMenu() {} };
  for (const placing of [true, false]) {
    const doc = new CircuitDocument("$ 1 0.000005 10 50 5 50\nr 0 0 64 0 0 1000\n");
    assert.equal(doc.viewport, null);
    const canvas = Object.assign(new Element(), { getContext: () => ({}), setPointerCapture() {} });
    const view = new CanvasView(canvas as never, doc, events);
    const before = view.viewport;
    if (placing) view.setTool({ kind: "place", cls: ResistorElm, className: "ResistorElm" });
    canvas.dispatchEvent(event("pointerdown", { button: 0, pointerId: 1, clientX: 32, clientY: 0 }));
    if (!placing) canvas.dispatchEvent(event("pointermove", { clientX: 48, clientY: 16 }));
    assert.ok(doc.viewport, placing ? "placement freezes fit" : "movement freezes fit");
    assert.deepEqual([doc.viewport.scale, doc.viewport.ox, doc.viewport.oy], [before.scale, before.ox, before.oy]);
    view.cancelGesture();
  }
});

test("older Generic MOSFET files gain heatsink data before or after library loading", async () => {
  const { readFileSync } = await import("node:fs");
  const { modelLibrary } = await import("../source/app/model-library");
  const { defineModels, findModel, SpiceMosfetElm, classForName } = await import("../source/engine");
  const { addPart } = await import("../source/app/document");
  const oldFile = readFileSync("tests/accuracy/zvs-mazzilli.xml", "utf8");
  const first = new CircuitDocument(oldFile);
  const mosfet = first.model.circuit.elements.find(e => e instanceof SpiceMosfetElm) as InstanceType<typeof SpiceMosfetElm>;
  assert.equal(mosfet.freeAirRthca(), null, "fixture predates thermal parameters");
  const electrical = new Map(findModel("GEN_IRFP250")!.model!.params);
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => JSON.parse(readFileSync("public/models.json", "utf8")) }) as Response;
  try { await modelLibrary.load(); } finally { globalThis.fetch = fetchBefore; }
  assert.equal(mosfet.freeAirRthca(), 39.4, "library finishes after opening file");
  for (const [key, value] of electrical) assert.equal(findModel("GEN_IRFP250")!.model!.params.get(key), value, key);
  const later = new CircuitDocument(oldFile);
  const q = later.model.circuit.elements.find(e => e instanceof SpiceMosfetElm) as InstanceType<typeof SpiceMosfetElm>;
  assert.equal(q.freeAirRthca(), 39.4, "file opens after library finishes");
  q.heatsink = 5;
  const saved = later.model.snapshot();
  later.model.restore(saved);
  const restored = later.model.circuit.elements.find(e => e instanceof SpiceMosfetElm) as InstanceType<typeof SpiceMosfetElm>;
  assert.equal(restored.heatsink, 5);
  assert.equal(restored.freeAirRthca(), 39.4);
  const fresh = CircuitDocument.empty();
  const placed = addPart(fresh.model, classForName("NMosfetElm")!, 0, 0, 64, 0, "NMosfetElm") as InstanceType<typeof SpiceMosfetElm>;
  fresh.model.setSpiceModel(placed, "GEN_IRFP250");
  assert.equal(placed.freeAirRthca(), 39.4, "new projects still have thermal models after an old file opens");
  defineModels(".model GEN_IRFP250 VDMOS(Vto=8 Rthjc=9 Rthca=77)");
  modelLibrary.upgradeLegacyThermalModels(["GEN_IRFP250"]);
  assert.equal(findModel("GEN_IRFP250")!.model!.params.get("rthca"), 77, "existing thermal models stay intact");
  defineModels(".model custom_legacy VDMOS(Vto=7)");
  modelLibrary.upgradeLegacyThermalModels(["custom_legacy"]);
  assert.equal(findModel("custom_legacy")!.model!.params.has("rthjc"), false, "no guessed thermal model for unknown parts");
});

test("transformer core handles resize with undo; each lead's end is a turn-and-size handle", async () => {
  const { TransformerElm, TappedTransformerElm, CustomTransformerElm, createNew } = await import("../source/engine");
  const { transformerHandles } = await import("../source/app/transformer-geometry");
  const { Viewport } = await import("forge-shell/app/viewport");
  for (const C of [TransformerElm, TappedTransformerElm, CustomTransformerElm]) {
    const doc = CircuitDocument.empty();
    doc.viewport = new Viewport(1, 0, 0);
    const e = createNew(C, 160, 160);
    e.setPosition(160, 160, 256, 160);
    doc.model.circuit.elements.push(e);
    doc.model.circuitChanged();
    doc.model.selected = e;
    const canvas = Object.assign(new Element(), { getContext: () => ({}), setPointerCapture() {} });
    const view = new CanvasView(canvas as never, doc, { onFocusChange() {}, onEdit() {}, onToolChange() {}, editProperties() {}, contextMenu() {} });
    const hit = (view as unknown as { handleAt(x: number, y: number): unknown }).handleAt.bind(view);
    const h = transformerHandles(e), width = e.width;
    assert.ok(hit(h.top.x, h.top.y));
    assert.ok(hit(h.bottom.x, h.bottom.y));
    for (let i = 0; i < e.getPostCount(); i++) assert.deepEqual(hit(e.getPost(i).x, e.getPost(i).y), { kind: "transformer-lead", elm: e, index: i });
    const start = h.bottom;
    const length = Math.hypot(start.x - h.top.x, start.y - h.top.y);
    const end = { clientX: start.x + (start.x - h.top.x) / length * 32 * h.widthScale,
      clientY: start.y + (start.y - h.top.y) / length * 32 * h.widthScale };
    canvas.dispatchEvent(event("pointerdown", { button: 0, pointerId: 1, clientX: start.x, clientY: start.y }));
    canvas.dispatchEvent(event("pointermove", end));
    canvas.dispatchEvent(event("pointerup", end));
    assert.equal(Math.abs(e.width), Math.abs(width) + 32);
    assert.ok(doc.canUndo);
    doc.undo();
    assert.equal((doc.model.circuit.elements[0] as typeof e).width, width);
    doc.redo();
    const resized = doc.model.circuit.elements[0] as typeof e;
    assert.equal(Math.abs(resized.width), Math.abs(width) + 32);
    const snapshot = doc.model.snapshot();
    doc.model.restore(snapshot);
    assert.equal((doc.model.circuit.elements[0] as typeof e).width, resized.width);
  }
});

test("on the sheet Shift adds to the selection, Cmd or Ctrl toggles, a plain click replaces, and a drag starts at 5 px", async () => {
  const { Viewport } = await import("forge-shell/app/viewport");
  const doc = CircuitDocument.empty();
  doc.viewport = new Viewport(1, 0, 0);
  const resistor = classForName("ResistorElm")!;
  const [r1, r2] = [0, 96].map((y) => addPart(doc.model, resistor, 0, y, 64, y, "ResistorElm"));
  const canvas = Object.assign(new Element(), { getContext: () => ({}), setPointerCapture() {} });
  new CanvasView(canvas as never, doc, { onFocusChange() {}, onEdit() {}, onToolChange() {}, editProperties() {}, contextMenu() {} });
  const click = (y: number, keys: { shiftKey?: boolean; toggle?: boolean } = {}, moveBy = 0) => {
    const modifiers = { shiftKey: !!keys.shiftKey, metaKey: !!keys.toggle, ctrlKey: !!keys.toggle };
    canvas.dispatchEvent(event("pointerdown", { button: 0, pointerId: 1, clientX: 32, clientY: y, ...modifiers }));
    if (moveBy) canvas.dispatchEvent(event("pointermove", { clientX: 32 + moveBy, clientY: y, ...modifiers }));
    canvas.dispatchEvent(event("pointerup", { clientX: 32 + moveBy, clientY: y, ...modifiers }));
  };
  const selected = () => [...doc.model.selection];
  click(0);
  assert.deepEqual(selected(), [r1]);
  click(96, { shiftKey: true });
  assert.deepEqual(selected(), [r1, r2], "Shift adds");
  click(96, { shiftKey: true });
  assert.deepEqual(selected(), [r1, r2], "Shift never removes");
  click(96, { toggle: true });
  assert.deepEqual(selected(), [r1], "Cmd or Ctrl toggles");
  click(96, {}, 4);
  assert.deepEqual(selected(), [r2], "a move under 5 px is a click, which replaces");
  const x = r2.x;
  click(96, {}, 16);
  assert.notEqual(r2.x, x, "a move of 5 px or more drags the part");
});

test("temperatures convert between °C, °F and K, and a typed suffix wins", async () => {
  const { fromCelsius, parseTemperature, formatTemperature } = await import("../source/app/temperature");
  assert.equal(fromCelsius(100, "F"), 212);
  assert.equal(fromCelsius(0, "K"), 273.15);
  assert.equal(parseTemperature("85", "C"), 85);
  assert.equal(parseTemperature("185F", "C"), 85);
  assert.equal(parseTemperature("358.15 K", "F"), 85);
  assert.equal(parseTemperature("185 °F", "K"), 85);
  assert.equal(parseTemperature("32", "F"), 0);
  assert.ok(Number.isNaN(parseTemperature("hot", "C")));
  assert.equal(formatTemperature(27, 6, "F"), "80.6 °F");
  assert.equal(formatTemperature(27, 6, "K"), "300.15 K");
});

test("a junction temperature can be plotted in °C, °F and K, each its own unit and axis", async () => {
  const { readQuantity, TJ, TJ_F, TJ_K } = await import("../source/app/scope-quantities");
  const { si } = await import("../source/app/format");
  const part = { sim: { temperature: 300.15 }, volts: [] } as never;
  assert.ok(Math.abs(readQuantity(part, TJ) - 27) < 1e-9);
  assert.ok(Math.abs(readQuantity(part, TJ_F) - 80.6) < 1e-9);
  assert.ok(Math.abs(readQuantity(part, TJ_K) - 300.15) < 1e-9);
  assert.equal(si(0.5, "°C"), "0.5 °C");
  assert.equal(si(150, "°F"), "150 °F");
  assert.equal(si(0.5, "K"), "500 mK");
});
