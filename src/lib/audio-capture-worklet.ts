// Kept outside the main thread so UI/model work does not stall capture.
declare class AudioWorkletProcessor {
  port: MessagePort;
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;
class RecentAudioProcessor extends AudioWorkletProcessor {
  private frames = new Float32Array(4096);
  private used = 0;
  process(inputs: Float32Array[][]) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let sum = 0;
      for (const channel of channels) sum += channel[i] ?? 0;
      this.frames[this.used++] = sum / channels.length;
      if (this.used === this.frames.length) {
        this.port.postMessage(this.frames, [this.frames.buffer]);
        this.frames = new Float32Array(4096);
        this.used = 0;
      }
    }
    return true;
  }
}
registerProcessor("recent-audio", RecentAudioProcessor);
