// Scope audio: actual-speed pitch, live sonification, bounded output, and playback lifecycle.
import assert from "node:assert/strict";
import { build } from "esbuild";

async function load(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", write: false,
    define: { "import.meta.url": JSON.stringify("http://localhost/app.js") } });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`);
}
const { AudioCapture, AUDIO_SAMPLE_RATE: rate, resampleSteps, SpeedPlayer, wholePeriods } = await load("source/app/audio-capture.ts");
const { speakerSamples, graphSamples, RealtimeLoop, ScopeAudio } = await load("source/app/scope-audio.ts");
const { AudioStream } = await load("source/app/audio-stream.ts");
const frequency = (samples) => {
  const crossings = [];
  for (let i = 1; i < samples.length; i++) if (samples[i - 1] <= 0 && samples[i] > 0) crossings.push(i);
  return (crossings.length - 1) * rate / (crossings.at(-1) - crossings[0]);
};

assert.deepEqual([...resampleSteps([0, 1], [0, 1], 4)], [0.125, 0.375, 0.625, 0.875]);
assert.ok(speakerSamples(new Float32Array(800).fill(24), { previousInput: null, highPass: 0, scale: null }).data.every((v) => v === 0), "DC is silent");
const huge = speakerSamples(new Float32Array([1e9, -1e9, 1e9]), { previousInput: 0, highPass: 0, scale: 1 });
assert.ok(huge.data.every((v) => Math.abs(v) <= 0.800001), "abrupt level changes remain bounded");

const range = { low: -10, high: 10 };
for (const [value, hz] of [[-10, 220 * Math.sqrt(2)], [0, 440], [10, 440 * Math.sqrt(2)]]) {
  const result = graphSamples(new Float32Array(rate / 2).fill(value), { phase: 0, position: null }, range);
  assert.ok(Math.abs(frequency(result.data) - hz) < 0.2, `graph value ${value} maps to ${hz} Hz`);
}
const beyond = [10, 20, 50].map((value) => frequency(graphSamples(new Float32Array(rate / 2).fill(value), { phase: 0, position: null }, range).data));
assert.ok(beyond[0] < beyond[1] && beyond[1] < beyond[2] && beyond[2] < 880, "values beyond the initial scale still change pitch");
const ramp = Float32Array.from({ length: 1600 }, (_, i) => -10 + 20 * i / 1599);
const whole = graphSamples(ramp, { phase: 0, position: null }, range);
const a = graphSamples(ramp.subarray(0, 800), { phase: 0, position: null }, range);
const b = graphSamples(ramp.subarray(800), a.state, range);
assert.deepEqual([...a.data, ...b.data], [...whole.data], "graph oscillator is continuous across frames");

const capture = new AudioCapture();
capture.select(0, 0, 0);
capture.add(1, [1]);
assert.deepEqual(capture.window(0, 1).values, [0, 1]);
const revision = capture.revision;
capture.add(0, [7]);
assert.ok(capture.revision > revision, "backward time invalidates queued audio");
assert.deepEqual(capture.window(0, 0).values, [7]);
capture.select(null);
capture.add(1, [999]);
assert.equal(capture.latestTime, null, "unselected scopes retain no audio");

// A 1× listener keeps the original pitch even if the solver takes longer to produce new data.
const recent = new AudioCapture();
recent.select(0, 0, 0);
for (let i = 1; i <= 12000; i++) {
  const t = i / 100000;
  recent.add(t, [Math.sin(2 * Math.PI * 600 * t)]);
}
const loop = recent.recentLoop();
assert.ok(loop && loop.length > rate * 0.07, "a circuit-time segment is ready after recording");
const listener = new RealtimeLoop();
listener.set(loop);
const normal = listener.render(rate);
assert.ok(Math.abs(frequency(normal) - 600) < 3, "the recent waveform plays at its 1× frequency");
assert.ok(Math.abs(normal[loop.length] - normal[0]) < 1e-6, "the segment repeats while waiting for more solver samples");
// whole periods: where it repeats it steps no more than the waveform does between any two samples
const naturalStep = Math.max(...normal.slice(1, loop.length).map((v, i) => Math.abs(v - normal[i])));
assert.ok(Math.abs(normal[loop.length - 1] - normal[loop.length]) <= naturalStep * 1.05, "the repeated segment has no sharp seam");
for (let i = 12001; i <= 24000; i++) {
  const t = i / 100000;
  recent.add(t, [Math.sin(2 * Math.PI * 800 * t)]);
}
listener.set(recent.recentLoop());
const updated = listener.render(rate);
assert.ok(updated.every((v) => Number.isFinite(v)), "a new segment blends into the old one");
assert.ok(Math.abs(frequency(updated.subarray(1000)) - 800) < 5, "new solver data changes the 1× sound");

// A continuous stream must not attenuate or splice its ordinary chunk boundaries, even when
// the producer delivers irregular batches. Keep enough queued to cover up to a 60 ms stall.
const stream = new AudioStream(rate);
let nextSample = 0;
const sine = (length) => Float32Array.from({ length }, () => 0.18 * Math.sin(2 * Math.PI * 440 * nextSample++ / rate));
stream.push(sine(3840));
let consumed = 0;
for (const length of [512, 896, 2880, 128, 1600, 2400, 768, 1920]) {
  const data = new Float32Array(length);
  stream.render(data);
  for (let i = 0; i < length; i++) {
    if (consumed + i >= 384) assert.ok(Math.abs(data[i] - 0.18 * Math.sin(2 * Math.PI * 440 * (consumed + i) / rate)) < 1e-7,
      "delayed batches retain phase and amplitude without per-frame fades");
  }
  consumed += length;
  stream.push(sine(length));
}
const drained = new Float32Array(5000);
stream.render(drained);
assert.ok(drained.slice(-100).every((v) => v === 0), "a longer stall becomes silence");
assert.ok(drained.every((v, i) => !i || Math.abs(v - drained[i - 1]) < 0.02), "underrun fades smoothly without a click");
stream.push(new Float32Array(3840).fill(0.5));
const steady = new Float32Array(1024);
stream.render(steady);
stream.clear();
const tail = new Float32Array(512);
stream.render(tail);
assert.ok(Math.abs(tail[0] - steady.at(-1)) < 0.002, "clearing preserves the instantaneous output then fades");
assert.ok(tail.slice(-100).every((v) => v === 0), "mute clears all queued samples");
// A full queue from a suspended device drops stale sound and re-primes with bounded storage.
stream.push(new Float32Array(rate).fill(0.25));
const recovered = new Float32Array(1024);
stream.render(recovered);
assert.equal(recovered.at(-1), 0.25);

// Exercise ScopeAudio lifecycle using a minimal audio clock and mocked worklet transport.
class Worklet {
  static last;
  messages = [];
  port = { postMessage: (data) => this.messages.push(data) };
  constructor() { Worklet.last = this; }
  connect() { return this; }
  disconnect() {}
}
class Context {
  static last;
  state = "running";
  currentTime = 0;
  audioWorklet = { addModule: async () => {} };
  destination = {};
  constructor() { Context.last = this; }
  async resume() {}
  async close() { this.state = "closed"; }
}
globalThis.AudioContext = Context;
globalThis.AudioWorkletNode = Worklet;
globalThis.document = { hidden: false };
const trace = { value: 0, elm: { getScopeValue: () => 0 } };
const scope = { audio: new AudioCapture(), traces: [trace], visibleTraces: [trace], latest: () => 0 };
const model = { scopes: [scope], sheetScopes: new Map(), sim: { t: 0, stopMessage: null }, running: false };
const player = new ScopeAudio();
await player.listen(scope, trace, "signal", range, model);
const ctx = Context.last;
const transport = Worklet.last;
ctx.currentTime += 0.016;
player.frame(model);
assert.equal(transport.messages.filter((m) => m !== null).length, 0, "paused stays silent");
model.running = true;
ctx.currentTime += 0.016;
player.frame(model);
// a few frames of microseconds each: sound starts after the player's small wall-clock latency
let ct = 0;
const frames = (n) => { for (let i = 0; i < n; i++) { ct += 1e-6; scope.audio.add(ct, [Math.sin(ct * 1e6)]); ctx.currentTime += 0.016; player.frame(model); } };
frames(7);
assert.ok(transport.messages.filter((m) => m !== null).length >= 1, "streams from microseconds of circuit data, without a circuit-time wait");
model.running = false;
ctx.currentTime += 0.016;
player.frame(model);
assert.equal(transport.messages.at(-1), null, "pause clears queued sound");
model.running = true;
ctx.currentTime += 0.016;
player.frame(model);
const before = transport.messages.filter((m) => m !== null).length;
frames(7);
assert.ok(transport.messages.filter((m) => m !== null).length > before, "resume starts new live samples");
scope.audio.reset();
ctx.currentTime += 0.016;
player.frame(model);
assert.equal(transport.messages.at(-1), null, "reset clears pre-reset sound");
await player.listen(scope, trace, "graph", range, model);
assert.equal(player.mode, "graph");
assert.equal(player.listeningTrace, trace);
scope.visibleTraces = [];
player.frame(model);
assert.equal(player.listeningScope, null, "hiding the trace stops audio");
scope.visibleTraces = [trace];
model.running = true;
await player.listen(scope, trace, "realtime", range, model);
for (let i = 1; i <= 3000; i++) {
  const t = i / 100000;
  scope.audio.add(t, [Math.sin(2 * Math.PI * 600 * t)]);
}
Context.last.currentTime += 0.016;
player.frame(model);
const realtimeOutput = Worklet.last.messages.at(-1);
assert.ok(realtimeOutput instanceof Float32Array && realtimeOutput.some((v) => v !== 0), "1× mode sends recorded audio to the worklet");
assert.equal(player.mode, "realtime");

// Playing at the speed reached: the solver works in uneven bursts (frames 60 fps ±35%, each batch
// ending ±30% of a frame early or late) yet the pitch is the circuit's frequency × speed, steady to
// well under a semitone (6%), and what's above hearing at that speed is removed, not folded down.
{
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const play = (hz, speed, seconds = 4) => {
    const cap = new AudioCapture(); cap.select(0, 0, 0);
    const sp = new SpeedPlayer();
    let wall = 0, t = 0, st = { previousInput: null, highPass: 0, scale: null };
    const chunks = [];
    while (wall < seconds) {
      const elapsed = (1 / 60) * (0.65 + 0.7 * rnd());
      wall += elapsed;
      const target = Math.max(t, speed * wall + speed * (1 / 60) * 0.3 * (2 * rnd() - 1));
      const steps = Math.max(4, Math.ceil((target - t) * hz * 40));
      for (let k = 1; k <= steps; k++) { const tt = t + (target - t) * k / steps; cap.add(tt, [5 * Math.sin(2 * Math.PI * hz * tt)]); }
      t = target;
      const p = sp.render(cap, elapsed, Math.round(elapsed * rate));
      if (!p) continue;
      const out = speakerSamples(p.data, st, p.amplitude);
      st = out.state;
      chunks.push(out.data);
    }
    const s = new Float32Array(chunks.reduce((a, c) => a + c.length, 0));
    let o = 0;
    for (const c of chunks) { s.set(c, o); o += c.length; }
    return s.subarray(2 * rate);
  };
  for (const [hz, speed] of [[440, 1], [4400, 0.1], [30000, 0.01]]) {
    const s = play(hz, speed), expect = hz * speed;
    const zc = [];
    for (let i = 1; i < s.length; i++) if (s[i - 1] <= 0 && s[i] > 0) zc.push(i - 1 + -s[i - 1] / (s[i] - s[i - 1]));
    const mean = (zc.length - 1) * rate / (zc.at(-1) - zc[0]);
    assert.ok(Math.abs(mean / expect - 1) < 0.01, `${hz} Hz at ${speed}× sounds at ${expect} Hz (${mean.toFixed(1)})`);
    const per = Math.max(2, Math.round(expect * 0.02)), blocks = [];
    for (let i = 0; i + per < zc.length; i += per) blocks.push(per * rate / (zc[i + per] - zc[i]));
    const wobble = Math.max(...blocks.map((b) => Math.abs(b / mean - 1)));
    assert.ok(wobble < 0.02, `${hz} Hz at ${speed}× holds its pitch over 20 ms (${(wobble * 100).toFixed(2)}%)`);
  }
  const rms = (a) => Math.sqrt(a.reduce((x, v) => x + v * v, 0) / a.length);
  assert.ok(rms(play(100000, 1)) < rms(play(1000, 1)) / 100, "100 kHz at 1× is inaudible: removed, not aliased and turned up");
}
// The 1× loop is a whole number of periods, so repeating it has no seam.
{
  const c = new AudioCapture();
  c.select(0, 0, 0);
  for (let i = 1; i <= 20000; i++) { const t = i / 200000; c.add(t, [Math.sin(2 * Math.PI * 239 * t)]); }
  const loop = c.recentLoop();
  const period = rate / 239;
  assert.ok(Math.abs(loop.length / period - Math.round(loop.length / period)) < 0.05, "the loop holds whole periods");
  const jump = Math.abs(loop[0] - loop.at(-1)), step = Math.max(...loop.slice(1).map((v, i) => Math.abs(v - loop[i])));
  assert.ok(jump <= step * 1.5, "no step where the loop repeats");
  assert.equal(wholePeriods(new Float32Array(100).fill(1)), null, "a flat signal isn't periodic");
}
// The level recovers after a loud start: a 10× transient, then the steady signal is loud again
// within a few seconds (instead of staying a tenth as loud).
{
  let st = { previousInput: null, highPass: 0, scale: null };
  const tone = (amp) => Float32Array.from({ length: 800 }, (_, i) => amp * Math.sin(2 * Math.PI * 440 * i / rate));
  st = speakerSamples(tone(10), st, 10).state;
  let last;
  for (let f = 0; f < 60 * 5; f++) { const r = speakerSamples(tone(1), st, 1); st = r.state; last = r.data; }
  assert.ok(Math.max(...last) > 0.3, `the steady tone is loud again (${Math.max(...last).toFixed(2)})`);
}
console.log("Scope audio passed: live pitch, sonification, 1× repeat, continuous playback, and lifecycle.");
