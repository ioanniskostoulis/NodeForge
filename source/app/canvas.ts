// Licensed under the GNU General Public License v2 or later. See LICENSE.

import { type CircuitElm, type ElmClass, PlaceholderElm, SwitchElm, WireElm } from "../engine";
import {
  addPart, addWire, ChipLeadResizeOperation, dragPart, type CircuitDocument, defaultEnd, EndpointOperation, gridSize, MoveOperation, removeDegenerate, snap, TransformerLeadOperation, TransformerResizeOperation,
} from "./document";
import { chipLeadHandles, isLeadPart, type LeadPart } from "./chip-handles";
import { partHandles } from "./part-handles";
import { isTransformer, transformerHandles, type TransformerPart } from "./transformer-geometry";
import { SchematicRenderer } from "./renderer";
import { currentTheme } from "./theme";
import { dragStarted, nextSelection, selectionMode } from "forge-shell/app/content-selection";
import { Viewport } from "forge-shell/app/viewport";
import { wheelIntent } from "./wheel";

type SelectionMode = ReturnType<typeof selectionMode>;
const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

export type Tool = { kind: "select" } | { kind: "place"; cls: ElmClass; className: string };

export interface CanvasEvents {
  /** Hover or selection changed. */
  onFocusChange(): void;
  /** The circuit was edited (undo state, dirty mark). */
  onEdit(): void;
  onToolChange(): void;
  /** Double-click on a part. */
  editProperties(elm: CircuitElm): void;
  /** Right-click: the menu for a part (or the sheet, when `elm` is null). */
  contextMenu(x: number, y: number, elm: CircuitElm | null): void;
}

type Gesture =
  | { kind: "pan"; x: number; y: number }
  | { kind: "press"; x: number; y: number; elm: CircuitElm | null; mode: SelectionMode }
  | { kind: "move"; op: MoveOperation; wx: number; wy: number }
  | { kind: "endpoint"; op: EndpointOperation }
  | { kind: "transformer-resize"; op: TransformerResizeOperation | TransformerLeadOperation }
  | { kind: "chip-lead-resize"; op: ChipLeadResizeOperation }
  | { kind: "marquee"; wx: number; wy: number; mode: SelectionMode; base: Set<CircuitElm> }
  | { kind: "place"; elm: CircuitElm; cls: ElmClass; x: number; y: number; count: number };

type HitHandle =
  | { kind: "transformer"; elm: TransformerPart; handle: { kind: "top" | "bottom" } }
  | { kind: "transformer-lead"; elm: TransformerPart; index: number }
  | { kind: "chip"; elm: LeadPart; side: number; index: number }
  | { kind: "endpoint"; elm: CircuitElm; end: 1 | 2; x: number; y: number };

/**
 * The schematic canvas: draws the circuit every frame and handles editing and navigation.
 * Select tool: click selects (shift adds), drag moves the selection (it leaves its connections behind),
 * drag a wire end (or an end of a selected part) to reshape it, drag empty space to select an
 * area. Part tools: drag out a part, or click to place it at its default size.
 * Two-finger scroll, middle-drag or space-drag pans; pinch / ⌘-wheel / mouse wheel zooms.
 */
export class CanvasView {
  hover: CircuitElm | null = null;
  mouseWorld: [number, number] | null = null;
  /** Where the pointer last was over the canvas (pixels), to redo the cursor without a move. */
  private lastLocal: [number, number] | null = null;
  tool: Tool = { kind: "select" };
  /** Area being selected (world coordinates), for the renderer. */
  marquee: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** Space is held: dragging pans. */
  spaceHeld = false;
  /** Set if the space key was used to pan (so releasing it doesn't toggle run/pause). */
  spacePanned = false;
  private readonly renderer: SchematicRenderer;
  private readonly ctx: CanvasRenderingContext2D;
  private gesture: Gesture | null = null;
  private width = 0;
  private height = 0;
  private fitted = new Viewport();

  constructor(private readonly canvas: HTMLCanvasElement, private doc: CircuitDocument, private readonly events: CanvasEvents) {
    this.ctx = canvas.getContext("2d")!;
    this.renderer = new SchematicRenderer(doc.model);
    canvas.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    canvas.addEventListener("pointermove", (e) => this.onPointerMove(e));
    canvas.addEventListener("pointerup", (e) => this.onPointerUp(e));
    canvas.addEventListener("pointercancel", () => this.cancelGesture());
    canvas.addEventListener("pointerleave", () => {
      if (this.gesture) return;
      this.lastLocal = null;
      this.hover = null;
      this.mouseWorld = null;
      this.events.onFocusChange();
    });
    canvas.addEventListener("contextmenu", (e) => this.onContextMenu(e));
    canvas.addEventListener("dblclick", (e) => this.onDoubleClick(e));
    canvas.addEventListener("auxclick", (e) => e.button === 1 && e.preventDefault());
  }

  get model() {
    return this.doc.model;
  }

  setDocument(doc: CircuitDocument): void {
    this.cancelGesture();
    this.doc = doc;
    this.renderer.model = doc.model;
    this.hover = null;
  }

  /** The current view: the document's own, or fitted to the circuit. */
  get viewport(): Viewport {
    return this.doc.viewport ?? this.fitted;
  }

  /** Detach from auto-fit so the view can be changed. */
  /** Make the selection exactly `next`, keeping the model's Set. */
  private replaceSelection(next: Set<CircuitElm>): void {
    this.model.selection.clear();
    for (const elm of next) this.model.selection.add(elm);
  }

  private ownViewport(): Viewport {
    if (!this.doc.viewport) this.doc.viewport = new Viewport(this.fitted.scale, this.fitted.ox, this.fitted.oy);
    return this.doc.viewport;
  }

  draw(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.width = w;
    this.height = h;
    // undo/redo replace the parts: forget one that's gone
    if (this.hover && !this.model.circuit.elements.includes(this.hover)) this.hover = null;
    if (!this.doc.viewport) {
      const b = this.model.bounds;
      this.fitted = b ? Viewport.fit(b, w, h) : new Viewport(1, 40, 40);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.renderer.draw(this.ctx, w, h, this.viewport, currentTheme(), this.hover, {
      marquee: this.marquee,
      handles: this.tool.kind === "select",
      pointer: this.mouseWorld,
    });
  }

  setTool(tool: Tool): void {
    this.cancelGesture();
    this.tool = tool;
    this.canvas.style.cursor = tool.kind === "place" ? "crosshair" : "default";
    this.events.onToolChange();
  }

  zoom(factor: number, ax = this.width / 2, ay = this.height / 2): void {
    this.ownViewport().zoom(factor, ax, ay);
  }

  /** Fit: frame the selection, or keep the whole circuit fitted when nothing is selected (`fitBounds`). */
  zoomToFit(): void {
    const b = this.model.selection.size ? this.model.boundsOf(this.model.selection) : null;
    this.doc.viewport = b ? Viewport.fit(b, this.width, this.height) : null;
  }

  zoomTo(scale: number): void {
    this.zoom(scale / this.viewport.scale);
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const [x, y] = this.local(e);
    const w = wheelIntent(e);
    if (w.kind === "zoom") this.zoom(w.factor, x, y);
    else this.ownViewport().pan(-w.dx, -w.dy);
    this.updateHover(x, y);
  }

  private local(e: MouseEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private world(x: number, y: number): [number, number] {
    return this.viewport.toWorld(x, y);
  }

  private snapped(x: number, y: number): [number, number] {
    const [wx, wy] = this.world(x, y);
    const g = gridSize(this.model);
    return [snap(wx, g), snap(wy, g)];
  }

  private tolerance(): number {
    return 8 / this.viewport.scale;
  }

  /** Redo the cursor where the pointer rests: the space key and a cancelled gesture change it without a move. */
  refreshCursor(): void {
    if (this.lastLocal && !this.gesture) this.updateHover(...this.lastLocal);
    else if (!this.gesture) this.canvas.style.cursor = this.spaceHeld ? "grab" : this.tool.kind === "place" ? "crosshair" : "default";
  }

  private updateHover(x: number, y: number): void {
    this.lastLocal = [x, y];
    const [wx, wy] = this.world(x, y);
    this.mouseWorld = [wx, wy];
    const hover = this.tool.kind === "select" ? this.model.elementAt(wx, wy, this.tolerance()) : null;
    if (hover !== this.hover) {
      this.hover = hover;
      this.events.onFocusChange();
    }
    if (this.gesture) return;
    let cursor = "default";
    if (this.spaceHeld) cursor = "grab";
    else if (this.tool.kind === "place") cursor = "crosshair";
    else if (this.handleAt(wx, wy)) cursor = "move";
    this.canvas.style.cursor = cursor;
  }

  /** Selected handles are in front of wires; the last selected part is drawn and picked on top. */
  private handleAt(wx: number, wy: number): HitHandle | null {
    const tol = 7 / this.viewport.scale;
    for (const elm of [...this.model.selection].reverse()) {
      let best: HitHandle | null = null;
      let bestD = tol;
      if (isTransformer(elm)) {
        const handles = transformerHandles(elm);
        for (const kind of ["top", "bottom"] as const) {
          const p = handles[kind];
          const d = Math.hypot(p.x - wx, p.y - wy);
          if (d <= bestD) { bestD = d; best = { kind: "transformer", elm, handle: { kind } }; }
        }
        // each lead's end: turns the transformer and sizes its windings
        for (let index = 0; index < elm.getPostCount(); index++) {
          const p = elm.getPost(index);
          const d = Math.hypot(p.x - wx, p.y - wy);
          if (d < bestD) { bestD = d; best = { kind: "transformer-lead", elm, index }; }
        }
      } else if (isLeadPart(elm)) {
        for (const h of chipLeadHandles(elm)) {
          const d = Math.hypot(h.x - wx, h.y - wy);
          if (d <= bestD) { bestD = d; best = { kind: "chip", elm, side: h.side, index: h.index }; }
        }
      } else if (!(elm instanceof PlaceholderElm)) {
        for (const h of partHandles(elm)) {
          const d = Math.hypot(h.x - wx, h.y - wy);
          if (d <= bestD) { bestD = d; best = { kind: "endpoint", elm, ...h }; }
        }
      }
      if (best) return best;
    }
    let best: HitHandle | null = null;
    let bestD = tol;
    for (const elm of this.model.circuit.elements) {
      if (!(elm instanceof WireElm) || this.model.selection.has(elm)) continue;
      for (const h of partHandles(elm)) {
        const d = Math.hypot(h.x - wx, h.y - wy);
        if (d <= bestD) { bestD = d; best = { kind: "endpoint", elm, ...h }; }
      }
    }
    return best;
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button === 2) return;
    this.canvas.setPointerCapture(e.pointerId);
    const [x, y] = this.local(e);
    if (e.button === 1 || this.spaceHeld) {
      this.gesture = { kind: "pan", x, y };
      this.canvas.style.cursor = "grabbing";
      return;
    }
    if (e.button !== 0) return;
    const [sx, sy] = this.snapped(x, y);
    if (this.tool.kind === "place") {
      this.ownViewport();
      this.doc.beginChange();
      const count = this.model.circuit.elements.length;
      const elm = addPart(this.model, this.tool.cls, sx, sy, sx, sy, this.tool.className);
      this.model.selected = elm;
      this.gesture = { kind: "place", elm, cls: this.tool.cls, x: sx, y: sy, count };
      return;
    }
    const [wx, wy] = this.world(x, y);
    const handle = !e.shiftKey && this.handleAt(wx, wy);
    if (handle) {
      this.ownViewport();
      this.doc.beginChange();
      if (this.model.selection.has(handle.elm)) {
        this.model.selection.delete(handle.elm);
        this.model.selection.add(handle.elm);
      } else this.model.selected = handle.elm;
      if (handle.kind === "transformer")
        this.gesture = { kind: "transformer-resize", op: new TransformerResizeOperation(this.model, handle.elm, handle.handle) };
      else if (handle.kind === "transformer-lead")
        this.gesture = { kind: "transformer-resize", op: new TransformerLeadOperation(this.model, handle.elm, handle.index) };
      else if (handle.kind === "chip")
        this.gesture = { kind: "chip-lead-resize", op: new ChipLeadResizeOperation(this.model, handle.elm, handle.side, handle.index) };
      else
        this.gesture = { kind: "endpoint", op: new EndpointOperation(this.model, handle.elm, handle.end, handle) };
      this.events.onFocusChange();
      return;
    }
    const elm = this.model.elementAt(wx, wy, this.tolerance());
    // Shift adds to the selection, Cmd (macOS) or Ctrl toggles, a plain click or box replaces it
    this.gesture = { kind: "press", x, y, elm, mode: selectionMode(e, isMac) };
  }

  private onPointerMove(e: PointerEvent): void {
    const [x, y] = this.local(e);
    const g = this.gesture;
    if (!g) return this.updateHover(x, y);
    const [wx, wy] = this.world(x, y);
    this.mouseWorld = [wx, wy];
    const grid = gridSize(this.model);
    switch (g.kind) {
      case "pan":
        this.ownViewport().pan(x - g.x, y - g.y);
        g.x = x;
        g.y = y;
        if (this.spaceHeld) this.spacePanned = true;
        return;
      case "press": {
        if (!dragStarted(g.x, g.y, x, y)) return;
        const [px, py] = this.world(g.x, g.y);
        if (g.elm) {
          this.ownViewport();
          // drag a part: it moves with the rest of the selection
          if (!this.model.selection.has(g.elm)) {
            if (g.mode === "replace") this.model.selection.clear();
            this.model.selection.add(g.elm);
          }
          this.doc.beginChange();
          this.gesture = { kind: "move", op: new MoveOperation(this.model, [...this.model.selection]), wx: px, wy: py };
          this.canvas.style.cursor = "move";
        } else {
          this.gesture = { kind: "marquee", wx: px, wy: py, mode: g.mode, base: new Set(this.model.selection) };
        }
        this.events.onFocusChange();
        return this.onPointerMove(e);
      }
      case "move":
        g.op.apply(snap(wx - g.wx, grid), snap(wy - g.wy, grid));
        return;
      case "endpoint":
        g.op.apply(wx, wy);
        return;
      case "transformer-resize":
        g.op.apply(wx, wy);
        return;
      case "chip-lead-resize":
        g.op.apply(wx, wy);
        return;
      case "place": {
        dragPart(g.elm, g.cls, g.x, g.y, snap(wx, grid), snap(wy, grid), grid);
        this.model.geometryChanged();
        return;
      }
      case "marquee": {
        this.marquee = { x0: g.wx, y0: g.wy, x1: wx, y1: wy };
        this.replaceSelection(nextSelection(g.base, this.model.elementsIn(g.wx, g.wy, wx, wy), g.mode));
        this.events.onFocusChange();
        return;
      }
    }
  }

  private onPointerUp(e: PointerEvent): void {
    const [x, y] = this.local(e);
    const g = this.gesture;
    this.gesture = null;
    this.marquee = null;
    if (!g) return;
    switch (g.kind) {
      case "press":
        // a click: select (Shift adds, Cmd or Ctrl toggles); clicking a switch also flips it, as in CircuitJS
        if (!g.elm || g.mode !== "replace") {
          this.replaceSelection(nextSelection(this.model.selection, g.elm ? [g.elm] : [], g.mode));
        } else {
          this.model.selected = g.elm;
          // a switch flipped is a change to the circuit (its position is saved): one undoable step
          if (g.elm instanceof SwitchElm) {
            const elm = g.elm;
            this.doc.edit(() => this.model.toggle(elm));
            this.events.onEdit();
          }
        }
        this.events.onFocusChange();
        break;
      case "move":
        this.doc.endChange(g.op.moved);
        this.events.onEdit();
        break;
      case "endpoint":
        if (g.op.elm.x === g.op.elm.x2 && g.op.elm.y === g.op.elm.y2) removeDegenerate(this.model);
        this.doc.endChange(g.op.moved);
        this.events.onEdit();
        break;
      case "transformer-resize":
      case "chip-lead-resize":
        this.doc.endChange(g.op.moved);
        this.events.onEdit();
        break;
      case "place":
        this.finishPlacing(g.elm, g.cls, g.count);
        break;
    }
    this.updateHover(x, y);
  }

  private finishPlacing(elm: CircuitElm, cls: ElmClass, countBefore: number): void {
    const m = this.model;
    if (elm.x === elm.x2 && elm.y === elm.y2 && !(elm instanceof WireElm)) {
      // a click: the part's default size
      const [x2, y2] = defaultEnd(cls, elm.x, elm.y);
      dragPart(elm, cls, elm.x, elm.y, x2, y2, gridSize(m));
    }
    if (elm instanceof WireElm && elm.x !== elm.x2 && elm.y !== elm.y2) {
      m.circuit.elements.splice(m.circuit.elements.indexOf(elm), 1);
      const wires = addWire(m, elm.x, elm.y, elm.x2, elm.y2);
      m.selection.clear();
      for (const w of wires) m.selection.add(w);
    }
    removeDegenerate(m);
    this.doc.endChange(m.circuit.elements.length > countBefore);
    this.events.onEdit();
    this.events.onFocusChange();
  }

  cancelGesture(): void {
    const g = this.gesture;
    this.gesture = null;
    this.marquee = null;
    if (!g) return;
    if (g.kind === "place") {
      const els = this.model.circuit.elements;
      els.splice(els.indexOf(g.elm), 1);
      this.doc.endChange(false);
    } else if (g.kind === "move" || g.kind === "endpoint" || g.kind === "transformer-resize" || g.kind === "chip-lead-resize") {
      this.doc.endChange(g.op.moved);
      this.events.onEdit();
    }
    this.refreshCursor();
  }

  clearSelection(): void {
    this.model.selection.clear();
    this.events.onFocusChange();
  }

  private onDoubleClick(e: MouseEvent): void {
    if (this.tool.kind !== "select") return;
    const [x, y] = this.local(e);
    const [wx, wy] = this.world(x, y);
    const elm = this.model.elementAt(wx, wy, this.tolerance());
    if (elm && !(elm instanceof WireElm)) {
      this.model.selected = elm;
      this.events.onFocusChange();
      this.events.editProperties(elm);
    } else if (!elm) this.zoomToFit();
  }

  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    if (this.tool.kind === "place") return this.setTool({ kind: "select" });
    const [x, y] = this.local(e);
    this.updateHover(x, y);
    const elm = this.hover;
    if (elm && !this.model.selection.has(elm)) {
      this.model.selected = elm;
      this.events.onFocusChange();
    }
    this.events.contextMenu(e.clientX, e.clientY, elm);
  }
}
