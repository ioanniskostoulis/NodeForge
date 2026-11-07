// Licensed under the GNU General Public License v2 or later. See LICENSE.

import type { ScopeRuntime, ScopeTrace, SimulationModel } from "./model";
import { AUDIO_SAMPLE_RATE, SpeedPlayer } from "./audio-capture";

export type ScopeAudioMode = "graph" | "signal" | "realtime";
export interface AudioRange { low: number; high: number }
export interface SpeakerState { previousInput: number | null; highPass: number; scale: number | null; envelope?: number }
export interface GraphState { phase: number; position: number | null }

/**
 * AC coupling and bounded output, with filter continuity between animation frames. The level is
 * set from `amplitude`, the waveform's own (half its peak-to-peak) when given, so loudness follows
 * the circuit's signal rather than what's left after band-limiting: inaudible content stays quiet;
 * an envelope (instant attack, ~2 s release) lets it come back up after a loud transient.
 */
export function speakerSamples(input: Float32Array, state: SpeakerState, amplitude?: number): { data: Float32Array; state: SpeakerState } {
  const out = new Float32Array(input.length);
  let previousInput = state.previousInput ?? input[0], highPass = state.highPass, peak = 0;
  const alpha = Math.exp(-2 * Math.PI * 5 / AUDIO_SAMPLE_RATE);
  for (let i = 0; i < input.length; i++) {
    highPass = alpha * (highPass + input[i] - previousInput);
    previousInput = input[i];
    out[i] = highPass;
    peak = Math.max(peak, Math.abs(highPass));
  }
  let scale = state.scale, envelope = state.envelope ?? 0;
  if (amplitude !== undefined) {
    // the level follows an envelope of the amplitude: up at once, back down over about 2 s, so a
    // loud start-up transient doesn't keep the steady sound quiet for good
    envelope = Math.max(amplitude, envelope * Math.exp(-input.length / (2 * AUDIO_SAMPLE_RATE)));
    if (envelope > 1e-9) scale = 0.45 / envelope;
  } else if (peak > 1e-9) scale = scale === null ? 0.45 / peak : Math.min(scale, 0.7 / peak);
  const oldScale = state.scale ?? scale ?? 0;
  for (let i = 0; i < out.length; i++) {
    const gain = oldScale + ((scale ?? 0) - oldScale) * ((i + 1) / out.length);
    out[i] = Math.max(-0.8, Math.min(0.8, out[i] * gain));
  }
  return { data: out, state: { previousInput, highPass, scale, envelope } };
}

/** Fixed vertical sensitivity → two octaves; smoothly approach the extremes without clipping.
 * Values beyond the initial scale can still change pitch when listening before the first run.
 */
export function graphSamples(input: Float32Array, state: GraphState, range: AudioRange): { data: Float32Array; state: GraphState } {
  const out = new Float32Array(input.length);
  const smoothing = 1 - Math.exp(-1 / (0.008 * AUDIO_SAMPLE_RATE));
  let phase = state.phase, position = state.position;
  for (let i = 0; i < input.length; i++) {
    const center = (range.low + range.high) / 2;
    const halfSpan = (range.high - range.low) / 2;
    const target = halfSpan > 0 ? 0.5 + Math.atan((input[i] - center) / halfSpan) / Math.PI : 0.5;
    position = position === null ? target : position + smoothing * (target - position);
    phase = (phase + 2 * Math.PI * (220 * 4 ** position) / AUDIO_SAMPLE_RATE) % (2 * Math.PI);
    out[i] = 0.18 * Math.sin(phase);
  }
  return { data: out, state: { phase, position } };
}

/** Repeat the latest recorded circuit-time segment, blending when a fresher one arrives. */
export class RealtimeLoop {
  private loop: Float32Array | null = null;
  private previous: Float32Array | null = null;
  private position = 0;
  private previousPosition = 0;
  private blend = 0;
  private readonly fade = Math.round(0.005 * AUDIO_SAMPLE_RATE);

  set(data: Float32Array): void {
    if (!data.length) return;
    this.previous = this.loop;
    this.previousPosition = this.position;
    this.loop = data;
    this.position = 0;
    this.blend = this.previous ? this.fade : 0;
  }

  render(count: number): Float32Array {
    const out = new Float32Array(count);
    if (!this.loop) return out;
    for (let i = 0; i < count; i++) {
      const next = this.loop[this.position++ % this.loop.length];
      if (this.blend && this.previous) {
        const old = this.previous[this.previousPosition++ % this.previous.length];
        out[i] = old * (this.blend / this.fade) + next * (1 - this.blend / this.fade);
        if (--this.blend === 0) this.previous = null;
      } else out[i] = next;
    }
    return out;
  }
}

export class ScopeAudio {
  private context: AudioContext | null = null;
  private output: AudioWorkletNode | null = null;
  private scope: ScopeRuntime | null = null;
  private trace: ScopeTrace | null = null;
  mode: ScopeAudioMode = "graph";
  private range: AudioRange = { low: -1, high: 1 };
  private lastFrame = 0;
  private fractionalSamples = 0;
  private captureRevision = 0;
  private running = false;
  private speaker: SpeakerState = { previousInput: null, highPass: 0, scale: null };
  private graph: GraphState = { phase: 0, position: null };
  private realtime = new RealtimeLoop();
  private player = new SpeedPlayer();
  private lastLoopTime: number | null = null;
  private generation = 0;

  get listeningScope(): ScopeRuntime | null { return this.scope; }
  get listeningTrace(): ScopeTrace | null { return this.trace; }

  async listen(scope: ScopeRuntime, trace: ScopeTrace, mode: ScopeAudioMode, range: AudioRange, model: SimulationModel): Promise<void> {
    this.stop();
    const generation = this.generation;
    const context = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
    this.context = context;
    this.scope = scope;
    this.trace = trace;
    this.mode = mode;
    this.range = { ...range }; // automatic graph rescaling must not move an unchanged value's pitch
    scope.audio.select(scope.traces.indexOf(trace), model.sim.t, scope.latest(trace));
    this.captureRevision = scope.audio.revision;
    try {
      await context.audioWorklet.addModule(new URL("./audio-worklet.js", import.meta.url));
      if (generation !== this.generation) return;
      this.output = new AudioWorkletNode(context, "scope-audio", {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
      });
      this.output.connect(context.destination);
      await context.resume();
      if (generation !== this.generation) return;
      if (context.state !== "running") throw new Error("Audio output is unavailable");
      // Discard samples accumulated while the browser was activating audio output.
      scope.audio.select(scope.traces.indexOf(trace), model.sim.t, scope.latest(trace));
      this.captureRevision = scope.audio.revision;
      this.lastFrame = context.currentTime;
      this.running = model.running;
    } catch (error) {
      if (generation === this.generation) this.stop();
      throw error;
    }
  }

  private clearPlayback(): void {
    this.output?.port.postMessage(null);
    this.fractionalSamples = 0;
    this.speaker = { previousInput: null, highPass: 0, scale: null };
    this.graph = { phase: 0, position: null };
    this.realtime = new RealtimeLoop();
    this.player = new SpeedPlayer();
    this.lastLoopTime = null;
  }

  stop(): void {
    this.generation++;
    this.scope?.audio.select(null);
    this.scope = this.trace = null;
    this.clearPlayback();
    const context = this.context;
    const output = this.output;
    this.context = null;
    this.output = null;
    this.running = false;
    if (context) setTimeout(() => {
      output?.disconnect();
      void context.close().catch(() => {});
    }, 30);
  }

  /** Each solver batch fills its actual elapsed wall time; the 1× mode repeats recent circuit time. */
  frame(model: SimulationModel): void {
    const context = this.context, scope = this.scope, trace = this.trace;
    if (!context || !this.output || !scope || !trace || context.state !== "running") return;
    if (![...model.scopes, ...model.sheetScopes.values()].includes(scope) || !scope.visibleTraces.includes(trace)) {
      this.stop(); return;
    }
    const now = context.currentTime, elapsed = now - this.lastFrame;
    this.lastFrame = now;
    const active = model.running && !model.sim.stopMessage && !document.hidden;
    if (!active || !this.running || scope.audio.revision !== this.captureRevision || elapsed > 0.15) {
      if (this.running || active) this.clearPlayback();
      scope.audio.select(scope.traces.indexOf(trace), model.sim.t, scope.latest(trace));
      this.captureRevision = scope.audio.revision;
      this.running = active;
      return;
    }
    const exact = elapsed * AUDIO_SAMPLE_RATE + this.fractionalSamples;
    const count = Math.floor(exact);
    this.fractionalSamples = exact - count;
    if (count < 1) return;
    let input: Float32Array, amplitude: number;
    if (this.mode === "realtime") {
      const latest = scope.audio.latestTime;
      if (latest !== null && (this.lastLoopTime === null || latest - this.lastLoopTime >= 0.02)) {
        const loop = scope.audio.recentLoop();
        if (loop) { this.realtime.set(loop); this.lastLoopTime = latest; }
      }
      input = this.realtime.render(count);
      amplitude = scope.audio.recentAmplitude();
    } else {
      // at the speed actually reached, band-limited; nothing yet while it fills its small latency
      const played = this.player.render(scope.audio, elapsed, count);
      if (!played) return;
      input = played.data;
      amplitude = played.amplitude;
    }
    let data: Float32Array;
    if (this.mode === "signal" || this.mode === "realtime") {
      const processed = speakerSamples(input, this.speaker, amplitude);
      data = processed.data;
      this.speaker = processed.state;
    } else {
      const processed = graphSamples(input, this.graph, this.range);
      data = processed.data;
      this.graph = processed.state;
    }
    this.output.port.postMessage(data, [data.buffer]);
  }
}
