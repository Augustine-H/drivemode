export type AudioSource = "microphone" | "system";
export type AudioClip = { pcm: Float32Array; sampleRate: number; at: number; source: AudioSource };

/** Wall-clock expiry matters even when no new frames arrive. Never persistent. */
export class AudioRing {
  private chunks: { pcm: Float32Array; end: number }[] = [];
  readonly sampleRate: number;
  private readonly seconds: number;
  constructor(sampleRate: number, seconds = 15) {
    this.sampleRate = sampleRate;
    this.seconds = seconds;
  }
  push(pcm: Float32Array, end = Date.now()) {
    const max = this.sampleRate * this.seconds;
    this.chunks.push({ pcm: pcm.slice(-max), end });
    this.prune(end);
    let count = this.chunks.reduce((n, c) => n + c.pcm.length, 0);
    while (count > max && this.chunks.length) {
      const first = this.chunks[0];
      const remove = Math.min(count - max, first.pcm.length);
      first.pcm.fill(0, 0, remove);
      first.pcm = first.pcm.slice(remove);
      count -= remove;
      if (!first.pcm.length) this.chunks.shift();
    }
  }
  prune(now = Date.now()) {
    const cutoff = now - this.seconds * 1000;
    while (this.chunks.length && this.chunks[0].end <= cutoff) {
      this.chunks.shift()!.pcm.fill(0);
    }
    const first = this.chunks[0];
    if (first) {
      const start = first.end - (first.pcm.length / this.sampleRate) * 1000;
      const trim = Math.min(
        first.pcm.length,
        Math.max(0, Math.floor(((cutoff - start) / 1000) * this.sampleRate)),
      );
      if (trim) {
        first.pcm.fill(0, 0, trim);
        first.pcm = first.pcm.slice(trim);
      }
    }
  }
  snapshot(source: AudioSource, now = Date.now()): AudioClip | null {
    this.prune(now);
    const size = this.chunks.reduce((n, c) => n + c.pcm.length, 0);
    if (!size) return null;
    const pcm = new Float32Array(size);
    let offset = 0;
    for (const c of this.chunks) {
      pcm.set(c.pcm, offset);
      offset += c.pcm.length;
    }
    return { pcm, sampleRate: this.sampleRate, at: this.chunks.at(-1)!.end, source };
  }
  clear() {
    for (const c of this.chunks) c.pcm.fill(0);
    this.chunks = [];
  }
}

export function resample(pcm: Float32Array, from: number, to = 48000) {
  if (from === to) return pcm.slice();
  const out = new Float32Array(Math.floor((pcm.length * to) / from));
  for (let i = 0; i < out.length; i++) {
    const pos = (i * from) / to;
    const left = Math.floor(pos),
      frac = pos - left;
    out[i] = pcm[left] * (1 - frac) + (pcm[Math.min(left + 1, pcm.length - 1)] ?? 0) * frac;
  }
  return out;
}

export function wavBytes(pcm: Float32Array, rate: number) {
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  };
  ascii(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  pcm.forEach((x, i) =>
    view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, x)) * 32767), true),
  );
  return bytes;
}
