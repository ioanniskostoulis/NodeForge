// Every Draw-menu part's Display options (properties.ts's DISPLAY rule, as the inspector shows them):
// each one changes how the part is drawn (or, for a slider's name and a memory's hex display, where
// it shows itself), and is kept when the circuit is saved and opened again (XML).
import "./browser-stubs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Circuit, classForName, constructElement, createNew, editInfos, getEditInfo, setEditInput, WireElm, writeXml, type CircuitElm, type ElmClass } from "../source/engine";
import { dragPart } from "../source/app/document";
import type { DrawItem } from "../source/app/library";
import { SimulationModel } from "../source/app/model";
import { isCoveredByLabels, isLegacySymbolField, presentField } from "../source/app/properties";
import { SchematicRenderer } from "../source/app/renderer";
import { currentTheme } from "../source/app/theme";
import { Viewport } from "forge-shell/app/viewport";

/** A canvas that records what's drawn (calls with their arguments, and style settings). */
function recorder(): { ctx: CanvasRenderingContext2D; log: string[] } {
  const log: string[] = [];
  const target: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(target, {
    get(t, key) {
      if (key in t) return t[key];
      if (key === "measureText") return (s: string) => ({ width: String(s).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
      if (key === "getTransform") return () => new DOMMatrix();
      if (key === "createLinearGradient" || key === "createRadialGradient") return () => ({ addColorStop() {} });
      if (key === "getLineDash") return () => [];
      return (...args: unknown[]) => { log.push(`${String(key)}(${args.map((a) => (typeof a === "number" ? a.toFixed(1) : String(a))).join(",")})`); };
    },
    set(t, key, value) { t[key] = value; log.push(`${String(key)}=${String(value)}`); return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, log };
}

const menu = JSON.parse(readFileSync("public/drawmenu.json", "utf8")) as DrawItem[];
const names: string[] = [];
const collect = (items: DrawItem[]) => items.forEach((d) => {
  if (d.class && d.class !== "Select" && !d.class.startsWith("Drag")) names.push(d.class);
  else if (d.items) collect(d.items);
});
collect(menu);
const EMPTY = '<cir f="1" ts="0.000005" ic="10" cb="50" pb="50" vr="5" mts="5e-11">\n</cir>\n';

function place(name: string, vertical = false): { model: SimulationModel; e: CircuitElm } {
  const model = new SimulationModel(EMPTY);
  const C = classForName(name);
  const e = constructElement(name, 160, 160) ?? (C ? createNew(C, 160, 160) : null);
  assert.ok(e, name);
  dragPart(e, e.constructor as ElmClass, 160, 160, vertical ? 160 : 288, vertical ? 288 : 160, 16);
  model.circuit.elements.push(e);
  model.circuitChanged();
  return { model, e };
}

function draw(model: SimulationModel): string {
  const { ctx, log } = recorder();
  new SchematicRenderer(model).draw(ctx, 2000, 2000, new Viewport(1, 0, 0), currentTheme(), null, { marquee: null, handles: false, pointer: null } as never);
  return log.join("\n");
}

/** Set display option n to "off" (0) or "on" (1), as its kind allows. */
function setOption(e: CircuitElm, n: number, on: boolean): string | void {
  const ei = getEditInfo(e, n)!;
  const input = { value: ei.value, checked: on, selected: on ? Math.min(1, ei.choices.length - 1) : 0, text: on ? "Hz" : "", file: null } as never;
  if (ei.kind === "number") (input as { value: number }).value = on ? ei.value * 2 || 2 : ei.value;
  return setEditInput(e, n, input);
}

/** What option n is set to, for comparing after a reload. */
function optionState(e: CircuitElm, n: number): string {
  const ei = getEditInfo(e, n)!;
  return JSON.stringify([ei.checked, ei.selected, ei.text, ei.kind === "number" ? ei.value : 0]);
}

test("every Display option changes the drawing and is saved", () => {
  const report: string[] = [];
  const failures: string[] = [];
  for (const name of names) {
    const probe = place(name).e;
    // the options the inspector shows (as buildProperties: no legacy IEC flags, a single wire's
    // value labels but not a bus's)
    const options = editInfos(probe).filter(([n, ei]) => presentField(probe, ei, () => "").display && !isLegacySymbolField(ei) && !isCoveredByLabels(probe, ei) &&
      !(probe instanceof WireElm && (probe.busWidth > 1 ? n < 2 : n >= 2)));
    for (const [n, ei] of options) {
      const label = presentField(probe, ei, () => "").label;
      // drawn: off, then on
      // (an option for vertical parts is tried on one)
      const a = place(name, /vertical/i.test(label));
      setOption(a.e, n, false);
      a.model.circuitChanged();
      const off = draw(a.model);
      setOption(a.e, n, true);
      a.model.circuitChanged();
      const on = draw(a.model);
      // shown: on the schematic, or where the option shows itself (a slider's name in Adjust, a
      // memory's contents as text)
      let drawn = off !== on;
      if (label === "Slider label") drawn = a.e.partSlider()?.label === "Hz";
      if (label === "Show hex") {
        const c = editInfos(a.e).find(([, x]) => x.kind === "textarea")!;
        setEditInput(a.e, c[0], { value: 0, checked: false, selected: 0, text: "0: 26 27", file: null } as never);
        const hex = getEditInfo(a.e, c[0])!.text;
        setOption(a.e, n, false);
        drawn = hex !== getEditInfo(a.e, c[0])!.text;
      }
      // saved: the "on" state survives XML (and the "off" one too, as some default to on)
      let saved = true;
      for (const state of [true, false]) {
        const b = place(name);
        setOption(b.e, n, state);
        const before = optionState(b.e, n);
        const reloaded = Circuit.parse(writeXml(b.model.circuit)).elements[b.model.circuit.elements.indexOf(b.e)];
        if (!reloaded || optionState(reloaded, n) !== before) saved = false;
      }
      report.push(`${name.padEnd(20)} ${label.padEnd(26)} drawn ${drawn ? "yes" : "NO "}  saved ${saved ? "yes" : "NO"}`);
      if (!drawn || !saved) failures.push(`${name}: ${label}${drawn ? "" : " (not drawn)"}${saved ? "" : " (not saved)"}`);
    }
  }
  if (process.env.DISPLAY_REPORT) console.log(report.join("\n"));
  assert.deepEqual(failures, []);
});
