// Licensed under the GNU General Public License v2 or later. See LICENSE.
import { AudioStream } from "./audio-stream";

declare const sampleRate: number;
declare class AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

class ScopeAudioProcessor extends AudioWorkletProcessor {
  private readonly stream = new AudioStream(sampleRate);

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<Float32Array | null>) => {
      if (event.data === null) this.stream.clear();
      else this.stream.push(event.data);
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0]?.[0];
    if (output) this.stream.render(output);
    return true;
  }
}

registerProcessor("scope-audio", ScopeAudioProcessor);
