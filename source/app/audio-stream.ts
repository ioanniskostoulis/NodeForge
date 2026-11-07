// Continuous scope audio queue, consumed on the audio thread rather than the screen clock.
// Licensed under the GNU General Public License v2 or later. See LICENSE.

export class AudioStream {
  private chunks: Float32Array[] = [];
  private offset = 0;
  private available = 0;
  private started = false;
  private gain = 0;
  private lastOutput = 0;
  private tail = 0;
  private tailRemaining = 0;
  private readonly reserve: number;
  private readonly fade: number;
  private readonly capacity: number;

  constructor(rate: number) {
    // the player keeps its own margin of circuit time; this only absorbs frame timing
    this.reserve = Math.ceil(rate * 0.04);
    this.fade = Math.ceil(rate * 0.008);
    this.capacity = Math.ceil(rate * 0.25);
  }

  clear(): void {
    this.chunks = [];
    this.offset = this.available = 0;
    this.started = false;
    this.gain = 0;
    this.tail = this.lastOutput;
    this.tailRemaining = this.fade;
  }

  push(data: Float32Array): void {
    if (!data.length) return;
    // A suspended audio device must not accumulate seconds of stale circuit sound.
    if (this.available + data.length > this.capacity) this.clear();
    const chunk = data.length > this.capacity ? data.slice(-this.capacity) : data;
    this.chunks.push(chunk);
    this.available += chunk.length;
  }

  render(output: Float32Array): void {
    for (let i = 0; i < output.length; i++) {
      if (!this.started && this.available >= this.reserve) this.started = true;
      let value = 0;
      if (this.started && this.available > 0) {
        const chunk = this.chunks[0];
        value = chunk[this.offset++];
        this.available--;
        if (this.offset === chunk.length) { this.chunks.shift(); this.offset = 0; }
        // No fades at chunk boundaries. Only fade at startup or before an actual underrun.
        const target = Math.min(1, this.available / this.fade);
        this.gain += Math.max(-1 / this.fade, Math.min(1 / this.fade, target - this.gain));
        value *= this.gain;
        if (!this.available) { this.started = false; this.gain = 0; }
      }
      if (this.tailRemaining > 0) value += this.tail * (--this.tailRemaining / this.fade);
      output[i] = this.lastOutput = value;
    }
  }
}
