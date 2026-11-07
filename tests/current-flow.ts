import assert from "node:assert/strict";
import { AmmeterElm, CapacitorElm, GroundElm, MosfetElm, OpAmpElm, PotElm, RailElm, ResistorElm, RoutedWireElm, SweepElm, TransformerElm, TransistorElm, WireElm } from "../source/engine";
import { advancePhase, chevronPoints, CurrentFlow, currentPaths, currentShape, FLOW_SPACING, MARKER_SPACING, markerMetrics, pathMarkers, pathSegments, steadyMarkers, type FlowPath } from "../source/app/current-flow";
import { completeConsole, CONSOLE_COMMANDS } from "../source/app/commands";

let passed = 0;
function test(name: string, run: () => void): void { run(); passed++; console.log(`PASS ${name}`); }
const wire = () => { const elm = new WireElm(0, 0, 96, 0, 0); elm.setPoints(); elm.current = 1; return elm; };
const line: FlowPath = { id: "line", points: [{ x: 0, y: 0 }, { x: 96, y: 0 }], current: 1 };

test("bounded phase, negative current, and no special 100 sentinel", () => {
  assert.equal(advancePhase(99, 1), 4);
  assert.equal(advancePhase(0, -5), 19);
  assert.equal(advancePhase(24, 0), 0);
  for (let i = -10000; i < 10000; i += 137) { const p = advancePhase(i, 5); assert.ok(p >= 0 && p < FLOW_SPACING); }
});
test("polyline bends use continuous distance and local direction", () => {
  const points = [{ x: 0, y: 0 }, { x: 48, y: 0 }, { x: 48, y: 48 }];
  const markers = pathMarkers({ ...line, points }, 6, 1, false);
  assert.deepEqual(markers.map(({ x, y }) => [x, y]), [[6, 0], [30, 0], [48, 6], [48, 30]]);
  assert.equal(markers[2].dy, 1);
  assert.equal(pathMarkers({ ...line, points }, 6, 1, true)[2].dy, -1);
});
test("zoom preserves the same circuit positions and electron count", () => {
  const path = { ...line, points: [{ x: 0, y: 0 }, { x: 500, y: 0 }] };
  const expected = pathMarkers(path, 5, 1, false, MARKER_SPACING);
  for (const zoom of [0.2, 0.89, 0.9, 1, 2, 5]) {
    assert.deepEqual(pathMarkers(path, 5, zoom, false, MARKER_SPACING), expected);
  }
});
test("zero, tiny and nonfinite currents do not leave stale markers", () => {
  for (const current of [0, 1e-10, NaN, Infinity]) assert.deepEqual(pathMarkers({ ...line, current }, 5, 1, false), []);
  assert.deepEqual(pathMarkers(line, 0, 0, false), []);
  assert.deepEqual(pathMarkers({ ...line, points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] }, 5, 1, false), []);
});
test("two-terminal signs and continuous phase through hidden bodies", () => {
  for (const Class of [ResistorElm, CapacitorElm]) {
    const elm = new Class(0, 0, 96, 0, 0); elm.setPoints(); elm.current = 2;
    const path = currentPaths(elm)[0]; assert.equal(path.current, 2);
    assert.deepEqual(path.segments, [0, 2]);
    for (const m of pathMarkers(path, 5, 1, false)) { assert.equal(m.dx, 1); assert.ok(m.x <= elm.lead1!.x || m.x >= elm.lead2!.x); }
  }
  const rail = new RailElm(0, 0, 96, 0, 0); rail.setPoints(); rail.current = 2;
  assert.equal(currentPaths(rail)[0].current, -2);
});
test("ground and other one-terminal leads carry their local current", () => {
  const ground = new GroundElm(0, 0, 0, 32, 0); ground.setPoints();
  const wire = new WireElm(0, -64, 0, 0, 0); wire.setPoints(); wire.current = 1;
  ground.current = 1;
  const flow = new CurrentFlow(); flow.advance([wire, ground], 0.1, 1, false);
  assert.equal(currentPaths(ground)[0].current, 1);
  assert.deepEqual(currentPaths(ground)[0].points, [ground.point1, ground.point2]);
  assert.ok(flow.markers(ground, 1, false).some((marker) => marker.y > 0));
  const sweep = new SweepElm(0, 0, 64, 0, 0); sweep.setPoints(); sweep.current = 1;
  assert.deepEqual(currentPaths(sweep)[0].points, [sweep.point1, sweep.lead1]);
});
test("captured symbol leads cover multi-terminal parts without tracing through bodies", () => {
  const amp = new OpAmpElm(0, 0, 96, 0, 0); amp.setPoints();
  amp.getCurrentIntoNode = (n) => -(n + 1);
  const flow = new CurrentFlow();
  flow.setVisibleLeads(amp, [
    { terminal: 0, a: amp.in1p[0], b: amp.in1p[1] },
    { terminal: 1, a: amp.in2p[0], b: amp.in2p[1] },
    { terminal: 2, a: amp.lead2!, b: amp.point2 },
  ]);
  assert.deepEqual(flow.pathsFor(amp).map((path) => path.current), [1, 2, 3]);
  assert.ok(flow.pathsFor(amp).every((path) => path.visibleConductor));

  const meter = new AmmeterElm(0, 0, 96, 0, 0); meter.setPoints(); meter.current = 1;
  flow.setVisibleLeads(meter, [
    { terminal: 0, a: meter.point1, b: { x: 32, y: 0 } },
    { terminal: 1, a: { x: 64, y: 0 }, b: meter.point2 },
  ]);
  assert.deepEqual(flow.pathsFor(meter).map((path) => path.points.map((p) => p.x)), [[0, 32], [96, 64]]);
});
test("routed wires follow their actual route", () => {
  const elm = new RoutedWireElm(0, 0, 48, 48, 0); elm.setPoints(); elm.current = 1;
  assert.deepEqual(currentPaths(elm)[0].points, elm.routePoints);
  assert.ok(currentPaths(elm)[0].points.length >= 3);
});
test("MOSFET markers use distinct gate/source/drain/bulk currents", () => {
  const elm = new MosfetElm(0, 0, 96, 0, 0);
  elm.showBulk = () => true; elm.hasBodyTerminal = () => true; elm.setPoints();
  elm.getCurrentIntoNode = (n) => [-0.1, 1, -0.8, -0.1][n];
  const paths = currentPaths(elm);
  assert.deepEqual(paths.map((p) => p.current), [0.1, -1, 0.8, 0.1]);
  for (let n = 0; n < paths.length; n++) assert.deepEqual(paths[n].points[0], elm.getPost(n));
});
test("transistor, potentiometer and transformer currents use terminal APIs", () => {
  for (const Class of [TransistorElm, PotElm, TransformerElm]) {
    const elm = new Class(0, 0, 96, 0, 0); elm.setPoints();
    elm.getCurrentIntoNode = (n) => -(n + 1);
    const paths = currentPaths(elm); assert.equal(paths.length, elm.getPostCount());
    for (let n = 0; n < paths.length; n++) { assert.equal(paths[n].current, n + 1); assert.deepEqual(paths[n].points[0], elm.getPost(n)); }
  }
});
test("electron reversal happens once, including animation travel", () => {
  for (const electron of [false, true]) {
    const elm = wire(), flow = new CurrentFlow(); flow.advance([elm], 0.1, 1, electron);
    const marker = flow.markers(elm, 1, electron)[0];
    assert.equal(marker.x, electron ? 19 : 5); assert.equal(marker.dx, electron ? -1 : 1);
    assert.equal(flow.markers(elm, 2, electron)[0].x, marker.x);
  }
});
test("reset, stopping current, bounded high speed, and no solver mutation", () => {
  const elm = wire(), flow = new CurrentFlow(); elm.curcount = 100;
  flow.advance([elm], 0.1, 5, false); assert.equal(flow.markers(elm, 1, false)[0].x, 1);
  assert.equal(elm.curcount, 100); assert.equal(flow.currentsVisible, true);
  elm.current = 0; assert.deepEqual(flow.markers(elm, 1, false), []);
  flow.advance([elm], 0.1, 1, false); assert.equal(flow.currentsVisible, false);
  flow.reset(); assert.deepEqual(flow.markers(elm, 1, false), []);
});
test("marker commands, aliases, validation and completion", () => {
  const show = CONSOLE_COMMANDS.find((c) => c.name === "show")!;
  for (const name of ["dot", "dots", "arrow", "arrows", "square", "squares"]) { assert.ok(currentShape(name)); assert.ok(show.args!.test(`current ${name}`)); }
  for (const value of ["current on", "current off", "voltage on", "values", ""]) assert.ok(show.args!.test(value));
  assert.equal(currentShape("triangle"), null); assert.equal(show.args!.test("voltage square"), false);
  assert.deepEqual(completeConsole("show current sq", []), ["show current squares"]);
});
test("markers keep the reference wire proportion at every supported zoom", () => {
  for (const zoom of [0.05, 0.2, 0.9, 1, 2, 5, 12]) for (const factor of [0.85, 1]) for (const base of [2, 4]) {
    const width = Math.max(base, 1 / zoom) * factor;
    const metrics = markerMetrics(zoom, width);
    assert.ok(Math.abs(metrics.size * 4.2 / width - 1.8) < 1e-9);
    assert.equal(metrics.dotRadius * 2 / width, 2);
    assert.ok(Math.abs(metrics.chevronSize * 6.2 / width - 3) < 1e-9);
    assert.equal(metrics.spacing, MARKER_SPACING);
    assert.ok(metrics.bandWidth >= width * 1.35 - 1e-9);
  }
});
test("steady bands skip bodies, zero-current and degenerate segments", () => {
  assert.deepEqual(pathSegments({ ...line, current: 0 }), []);
  const path = { ...line, points: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 36, y: 0 }, { x: 48, y: 0 }], segments: [0, 2] };
  assert.deepEqual(pathSegments(path), [[path.points[0], path.points[1]], [path.points[2], path.points[3]]]);
});
test("steady arrows keep their positions when current reverses, but flip direction", () => {
  const a = pathMarkers(line, 12, 2, false, 48), b = pathMarkers({ ...line, current: -1 }, 12, 2, false, 48);
  assert.deepEqual(a.map(({ x, y }) => [x, y]), b.map(({ x, y }) => [x, y]));
  assert.equal(a[0].dx, -b[0].dx);
});
test("steady band is a toggle, not a marker shape; commands validate and complete", () => {
  const show = CONSOLE_COMMANDS.find((c) => c.name === "show")!;
  assert.equal(currentShape("steady"), null);
  for (const text of ["current steady", "current steady on", "current steady off", "current direction on", "current direction off"]) assert.ok(show.args!.test(text));
  assert.equal(show.args!.test("current direction square"), false);
  assert.deepEqual(completeConsole("show current direction o", []), ["show current direction on", "show current direction off"]);
});
test("fast current detection uses intended speed, not capped marker travel", () => {
  const elm = wire(), flow = new CurrentFlow(), id = currentPaths(elm)[0].id;
  flow.advance([elm], 1 / 60, 1, false); assert.equal(flow.isFast(elm, id), false);
  flow.advance([elm], 1 / 60, 5, false); assert.equal(flow.isFast(elm, id), true);
  flow.advance([elm], 1 / 60, 5, true); assert.equal(flow.isFast(elm, id), true);
  flow.advance([elm], 1 / 60, 1, false); assert.equal(flow.isFast(elm, id), false);
  flow.advance([elm], 1 / 60, 5, false); elm.current = 0;
  flow.advance([elm], 1 / 60, 5, false); assert.equal(flow.isFast(elm, id), false);
  flow.reset(); assert.equal(flow.isFast(elm, id), false);
});
test("fast-current fallback is per lead, with hysteresis near the threshold", () => {
  const elm = wire(), slow = wire(), flow = new CurrentFlow(), id = currentPaths(elm)[0].id; slow.current = 0.1;
  flow.advance([elm, slow], 1 / 60, 3.3, false);
  assert.equal(flow.isFast(elm, id), true); assert.equal(flow.isFast(slow, id), false);
  flow.advance([elm, slow], 1 / 60, 3, false); assert.equal(flow.isFast(elm, id), true);
  flow.advance([elm, slow], 1 / 60, 2.5, false); assert.equal(flow.isFast(elm, id), false);
});
test("steady arrows sit at segment midpoints and leave short leads uncluttered", () => {
  assert.deepEqual(steadyMarkers(line, false, 12), [{ x: 48, y: 0, dx: 1, dy: 0 }]);
  assert.equal(steadyMarkers(line, true, 12)[0].dx, -1);
  assert.deepEqual(steadyMarkers(line, false, 100), []);
  assert.deepEqual(steadyMarkers({ ...line, current: 0 }, false, 12), []);
  const bent = { ...line, points: [{ x: 0, y: 0 }, { x: 48, y: 0 }, { x: 48, y: 48 }] };
  assert.deepEqual(steadyMarkers(bent, false, 12).map(({ x, y }) => [x, y]), [[24, 0], [48, 24]]);
});
test("chevrons match the original centered 2.6 by 4.8 geometry", () => {
  assert.deepEqual(chevronPoints({ x: 0, y: 0, dx: 1, dy: 0 }, 1), [{ x: -1.3, y: 2.4 }, { x: 1.3, y: 0 }, { x: -1.3, y: -2.4 }]);
  const reversed = chevronPoints({ x: 0, y: 0, dx: -1, dy: 0 }, 1);
  assert.equal(reversed[1].x, -1.3);
});
test("one second of motion has the same phase at 10, 30 and 60 fps", () => {
  for (const speed of [1, 2.4, 5]) {
    let expected: number | undefined;
    for (const fps of [60, 30, 10]) {
      const elm = wire(), flow = new CurrentFlow();
      for (let n = 0; n < fps; n++) flow.advance([elm], 1 / fps, speed, false);
      const phase = flow.markers(elm, 1, false)[0].x;
      if (expected === undefined) expected = phase;
      else assert.ok(Math.abs(phase - expected) < 1e-9);
    }
  }
});
test("frame-time jitter does not flicker the steady-band classification", () => {
  for (const speed of [2.4, 5]) {
    const elm = wire(), flow = new CurrentFlow(), id = currentPaths(elm)[0].id;
    for (const dt of [0.05, 1 / 60, 0.05, 1 / 60, 0.1]) {
      flow.advance([elm], dt, speed, false);
      assert.equal(flow.isFast(elm, id), speed === 5);
    }
  }
});
test("live marker count and positions remain unchanged across all supported zooms", () => {
  const elm = wire(), flow = new CurrentFlow(); flow.advance([elm], 0.02, 1, false);
  const expected = flow.markers(elm, 1, false, MARKER_SPACING);
  for (const zoom of [0.05, 0.2, 0.9, 1, 2, 5, 12]) {
    const metrics = markerMetrics(zoom, Math.max(2, 1 / zoom));
    assert.deepEqual(flow.markers(elm, zoom, false, metrics.spacing), expected);
  }
});
test("joined wires have continuous spacing with either drawing orientation", () => {
  for (const reversed of [false, true]) for (const electron of [false, true]) {
    const a = new WireElm(0, 0, 40, 0, 0), b = new WireElm(reversed ? 100 : 40, 0, reversed ? 40 : 100, 0, 0);
    a.setPoints(); b.setPoints(); a.current = 1; b.current = reversed ? -1 : 1;
    const flow = new CurrentFlow();
    for (let n = 0; n < 20; n++) {
      flow.advance([a, b], 0.017, 1, electron);
      const xs = [a, b].flatMap((elm) => flow.markers(elm, 1, electron, MARKER_SPACING)).map((m) => m.x).sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) assert.ok(Math.abs(xs[i] - xs[i - 1] - MARKER_SPACING) < 1e-8);
    }
  }
});
test("resistor leads and adjoining wires share phase through the hidden body", () => {
  const a = new WireElm(0, 0, 40, 0, 0), r = new ResistorElm(40, 0, 120, 0, 0), b = new WireElm(120, 0, 220, 0, 0);
  for (const elm of [a, r, b]) { elm.setPoints(); elm.current = 1; }
  const flow = new CurrentFlow(); flow.advance([a, r, b], 0.1, 1, false);
  const xs = [a, r, b].flatMap((elm) => flow.markers(elm, 1, false, MARKER_SPACING)).map((m) => m.x).sort((a, b) => a - b);
  for (const x of xs) assert.ok(Math.abs(((x - 6) / MARKER_SPACING) - Math.round((x - 6) / MARKER_SPACING)) < 1e-8);
});
test("closed loops have even spacing at the seam", () => {
  const coords = [[0,0,40,0], [40,0,40,30], [40,30,0,30], [0,30,0,0]];
  const elements = coords.map(([x,y,x2,y2]) => { const elm = new WireElm(x,y,x2,y2,0); elm.setPoints(); elm.current=1; return elm; });
  const flow = new CurrentFlow(); flow.advance(elements, 0.02, 1, false);
  const arc = elements.flatMap((elm, n) => flow.markers(elm, 1, false, MARKER_SPACING).map((m) =>
    n === 0 ? m.x : n === 1 ? 40+m.y : n === 2 ? 70+40-m.x : 110+30-m.y)).sort((a,b) => a-b);
  const interval = 140 / Math.round(140 / MARKER_SPACING);
  for(let n=0;n<arc.length;n++) assert.ok(Math.abs((n+1<arc.length ? arc[n+1]-arc[n] : 140+arc[0]-arc[n])-interval)<1e-8);
});
test("a marker exactly on a shared endpoint is drawn only once", () => {
  for (const reverse of [false, true]) {
    const a = new WireElm(0,0,48,0,0), b = new WireElm(reverse ? 96 : 48,0,reverse ? 48 : 96,0,0);
    a.setPoints(); b.setPoints(); a.current=1; b.current=reverse ? -1 : 1;
    const flow = new CurrentFlow(); flow.advance([a,b],0.1,0,false);
    const markers = [a,b].flatMap((elm) => flow.markers(elm,1,false,24));
    assert.equal(markers.filter((m) => Math.abs(m.x-48)<1e-8).length,1);
  }
});
test("branching junctions leave room around the node", () => {
  const elements = [[0,0,48,0], [48,0,96,0], [48,0,48,48]].map(([x,y,x2,y2]) => {
    const elm = new WireElm(x,y,x2,y2,0); elm.setPoints(); elm.current=1; return elm;
  });
  const flow = new CurrentFlow(); flow.advance(elements,0.1,1,false);
  for (const elm of elements) for(const m of flow.markers(elm,1,false,MARKER_SPACING)) assert.ok(Math.hypot(m.x-48,m.y)>=MARKER_SPACING*0.2);
});
console.log(`${passed} current-flow checks passed.`);
