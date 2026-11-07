// Licensed under the GNU General Public License v2 or later. See LICENSE.

export const AUDIO_SAMPLE_RATE = 48_000;
const MAX_STEPS = 262_144;
const RECENT_SECONDS = 0.2;
const LOOP_SECONDS = 0.08;
const MIN_LOOP_SECONDS = 0.02;

/** Average the piecewise-linear waveform over each output sample's time interval.
 * Preserve solver timestamps: sampling at 48 kHz of circuit time would discard ultrasonic
 * signals that become audible when the simulation is slowed down.
 */
export function resampleSteps(times: readonly number[], values: readonly number[], count: number): Float32Array {
  if (!values.length) return new Float32Array(count);
  if (times.length < 2 || !(times[times.length - 1] > times[0])) return new Float32Array(count).fill(values[values.length - 1]);
  return resampleRange(times, values, times[0], times[times.length - 1], count);
}

/**
 * The waveform's average over each of `count` equal intervals of start…end (exact for the
 * piecewise-linear steps; before the first step and after the last it holds their values).
 */
export function resampleRange(times: readonly number[], values: readonly number[], start: number, end: number, count: number): Float32Array {
  const out = new Float32Array(count);
  const n = times.length;
  if (!n) return out;
  const width = (end - start) / count;
  if (n < 2 || !(width > 0)) return out.fill(values[n - 1]);
  let segment = 0;
  for (let i = 0; i < count; i++) {
    let a = start + i * width;
    const b0 = a + width;
    let area = 0;
    // held before the first step and after the last
    if (a < times[0]) { const b = Math.min(b0, times[0]); area += values[0] * (b - a); a = b; }
    while (a < b0 && a < times[n - 1]) {
      while (segment + 2 < n && times[segment + 1] <= a) segment++;
      const t0 = times[segment], t1 = times[segment + 1];
      const b = Math.min(b0, t1);
      if (b <= a) break;
      const slope = (values[segment + 1] - values[segment]) / (t1 - t0);
      area += (values[segment] + slope * ((a + b) / 2 - t0)) * (b - a);
      a = b;
    }
    if (a < b0) area += values[n - 1] * (b0 - a);
    out[i] = area / width;
  }
  return out;
}

/** Oversampling and the low-pass (windowed sinc) that keeps inaudible content from folding down. */
const OVERSAMPLE = 4;
const KERNEL = (() => {
  const half = 24, cutoff = 0.45 / OVERSAMPLE; // ≈ 21.6 kHz at 48 kHz, in cycles per oversampled sample
  const k = new Float32Array(2 * half + 1);
  let sum = 0;
  for (let i = -half; i <= half; i++) {
    const x = i === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * i) / (Math.PI * i);
    const w = 0.42 + 0.5 * Math.cos((Math.PI * i) / half) + 0.08 * Math.cos((2 * Math.PI * i) / half); // Blackman
    k[i + half] = x * w;
    sum += x * w;
  }
  return k.map((v) => v / sum);
})();

/**
 * Plays recorded circuit time at the simulation's actual speed. A playback clock moves through
 * circuit time at the speed measured over the last second (circuit time produced per second of
 * audio clock), nudged slowly to keep about LATENCY of it in hand, so the pitch is the circuit's
 * frequency times the speed actually reached, without the wobble of stretching each frame's uneven
 * solver batch over that frame. The waveform is band-limited first (4× oversampled, then a
 * ~21.6 kHz low-pass): what is inaudible at this speed stays inaudible.
 */
export class SpeedPlayer {
  /** Wall seconds of circuit time kept in hand (absorbs uneven solver batches). */
  static readonly LATENCY = 0.08;
  /** Over how long the speed is measured (wall seconds). */
  static readonly WINDOW = 1;
  private cursor: number | null = null;
  private wall = 0;
  /** (wall time, newest circuit time) at each frame, over the last WINDOW. */
  private progress: [number, number][] = [];
  private correction = 0;
  private started = false;
  private history = new Float32Array(KERNEL.length - 1);

  /** `count` samples covering `elapsed` wall seconds, or null while it first fills its latency. */
  render(capture: AudioCapture, elapsed: number, count: number): { data: Float32Array; amplitude: number } | null {
    const latest = capture.latestTime, first = capture.earliestTime;
    if (latest === null || first === null) return null;
    this.wall += elapsed;
    this.progress.push([this.wall, latest]);
    while (this.progress.length > 2 && this.wall - this.progress[1][0] >= SpeedPlayer.WINDOW) this.progress.shift();
    if (this.cursor === null) this.cursor = first;
    if (!this.started) {
      if (this.wall < SpeedPlayer.LATENCY) return null;
      this.started = true;
    }
    // steps dropped before they were played (the capture's limit): skip to what's there
    if (this.cursor < first) this.cursor = first;
    const [w0, c0] = this.progress[0];
    const speed = this.wall > w0 ? Math.max(0, (latest - c0) / (this.wall - w0)) : 0;
    // keep about LATENCY in hand: a slow, small correction (±5%), smoothed over a second
    const inHand = speed > 0 ? (latest - this.cursor) / (speed * SpeedPlayer.LATENCY) - 1 : 0;
    this.correction += Math.min(1, elapsed / SpeedPlayer.WINDOW) * (Math.max(-1, Math.min(1, inHand)) - this.correction);
    const ratio = speed * (1 + 0.05 * this.correction);
    const span = (ratio * count) / AUDIO_SAMPLE_RATE;
    const t0 = this.cursor, t1 = t0 + span;
    this.cursor = t1;
    const { times, values } = capture.window(t0, t1);
    let lo = Infinity, hi = -Infinity;
    for (const v of values) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const over = resampleRange(times, values, t0, t1, count * OVERSAMPLE);
    capture.discardBefore(t1);
    // low-pass and take every OVERSAMPLE-th sample, continuing from the last frame's tail
    const h = this.history.length, all = new Float32Array(h + over.length);
    all.set(this.history);
    all.set(over, h);
    const data = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      let acc = 0;
      const base = i * OVERSAMPLE + OVERSAMPLE;
      for (let k = 0; k < KERNEL.length; k++) acc += KERNEL[k] * all[base + k - 1];
      data[i] = acc;
    }
    this.history = all.slice(all.length - h);
    return { data, amplitude: hi > lo ? (hi - lo) / 2 : 0 };
  }
}

/** Only the selected trace retains solver steps, until the next frame or in a short 1× loop window. */
export class AudioCapture {
  private trace: number | null = null;
  private times: number[] = [];
  private values: number[] = [];
  revision = 0;

  select(trace: number | null, time = 0, value = 0): void {
    this.trace = trace;
    this.reset();
    if (trace !== null && Number.isFinite(value)) {
      this.times.push(time);
      this.values.push(value);
    }
  }

  reset(): void {
    this.times = [];
    this.values = [];
    this.revision++;
  }

  add(time: number, values: ArrayLike<number>): void {
    if (this.trace === null || !Number.isFinite(time)) return;
    const value = values[this.trace];
    if (!Number.isFinite(value)) { this.reset(); return; }
    const last = this.times.at(-1);
    if (last !== undefined && time < last) this.reset();
    if (time === this.times.at(-1)) this.values[this.values.length - 1] = value;
    else { this.times.push(time); this.values.push(value); }
    // The 1× listener keeps a short recent window. Ordinary modes drain every frame.
    if (this.times.length >= MAX_STEPS || time - this.times[0] > RECENT_SECONDS) {
      const cutoff = time - LOOP_SECONDS * 1.5;
      let first = 0;
      while (first + 1 < this.times.length && this.times[first + 1] < cutoff) first++;
      if (this.times.length - first > MAX_STEPS / 2) first = this.times.length - MAX_STEPS / 2;
      if (first > 0) { this.times.splice(0, first); this.values.splice(0, first); }
    }
  }

  get latestTime(): number | null { return this.times.at(-1) ?? null; }
  get earliestTime(): number | null { return this.times[0] ?? null; }

  /** The steps covering t0…t1: those inside and one either side. */
  window(t0: number, t1: number): { times: number[]; values: number[] } {
    let a = 0;
    while (a + 1 < this.times.length && this.times[a + 1] <= t0) a++;
    let b = a;
    while (b + 1 < this.times.length && this.times[b] < t1) b++;
    return { times: this.times.slice(a, b + 1), values: this.values.slice(a, b + 1) };
  }

  /** Drop steps played (keeping the last one before t, the start of the next interval). */
  discardBefore(t: number): void {
    let first = 0;
    while (first + 1 < this.times.length && this.times[first + 1] <= t) first++;
    if (first > 0) { this.times.splice(0, first); this.values.splice(0, first); }
  }

  /**
   * The newest 20–80 ms of circuit time, sampled at the audio device's rate, cut to a whole number
   * of the waveform's periods when it has some (rising crossings of its middle), so repeating it
   * is seamless; anything else is tapered at its ends.
   */
  recentLoop(): Float32Array | null {
    if (this.times.length < 2) return null;
    const end = this.times.at(-1)!;
    let first = this.times.length - 2;
    while (first > 0 && end - this.times[first] < LOOP_SECONDS) first--;
    const span = end - this.times[first];
    if (span < MIN_LOOP_SECONDS || span > RECENT_SECONDS) return null;
    const count = Math.round(span * AUDIO_SAMPLE_RATE);
    // band-limited as at simulation speed: what's inaudible at 1× stays inaudible
    const raw = lowpass(resampleSteps(this.times.slice(first), this.values.slice(first), count * OVERSAMPLE), count);
    const periodic = wholePeriods(raw);
    if (periodic) return periodic;
    // Taper the boundaries without shortening circuit time or changing pitch.
    const fade = Math.min(Math.round(0.003 * AUDIO_SAMPLE_RATE), Math.floor(raw.length / 8));
    for (let i = 0; i < fade; i++) {
      const gain = (i + 1) / (fade + 1);
      raw[i] *= gain;
      raw[raw.length - 1 - i] *= gain;
    }
    return raw;
  }

  /** Half the newest loop window's peak-to-peak (sets the level, so filtered-out content stays quiet). */
  recentAmplitude(): number {
    const end = this.times.at(-1);
    if (end === undefined) return 0;
    let lo = Infinity, hi = -Infinity;
    for (let i = this.times.length - 1; i >= 0 && end - this.times[i] <= LOOP_SECONDS; i--) {
      lo = Math.min(lo, this.values[i]);
      hi = Math.max(hi, this.values[i]);
    }
    return hi > lo ? (hi - lo) / 2 : 0;
  }

}

/** Low-pass oversampled samples (the edges held) and keep every OVERSAMPLE-th: `count` of them. */
function lowpass(over: Float32Array, count: number): Float32Array {
  const half = (KERNEL.length - 1) / 2, out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let acc = 0;
    const center = i * OVERSAMPLE + OVERSAMPLE / 2;
    for (let k = 0; k < KERNEL.length; k++) acc += KERNEL[k] * over[Math.min(over.length - 1, Math.max(0, center + k - half))];
    out[i] = acc;
  }
  return out;
}

/**
 * The part of a sampled waveform from its first to its last rising crossing of the middle of its
 * range (at least one period of 0.5 ms or more), or null when it isn't periodic enough.
 */
export function wholePeriods(raw: Float32Array): Float32Array | null {
  let lo = Infinity, hi = -Infinity;
  for (const v of raw) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (!(hi > lo)) return null;
  const mid = (lo + hi) / 2, hyst = (hi - lo) * 0.1;
  const rises: number[] = [];
  let armed = false;
  for (let i = 1; i < raw.length; i++) {
    if (raw[i] < mid - hyst) armed = true;
    if (armed && raw[i - 1] < mid && raw[i] >= mid) { rises.push(i); armed = false; }
  }
  if (rises.length < 2) return null;
  const a = rises[0], b = rises[rises.length - 1];
  if (b - a < 0.0005 * AUDIO_SAMPLE_RATE) return null;
  return raw.slice(a, b);
}
