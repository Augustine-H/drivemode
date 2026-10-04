export const VOICE_ID_KEY = "voice-grok-speaker-v1";
export const SPEAKER_MODEL = "Xenova/wavlm-base-plus-sv";
export const SPEAKER_MODEL_REVISION = "e61029603001bd11295c36d878698708bf59190f";
export type VoiceIdentity = {
  version: 1;
  model: typeof SPEAKER_MODEL;
  enabled: boolean;
  threshold: number;
  samples: number[][];
  registeredAt: string;
};
export function similarity(a: number[], b: number[]) {
  if (a.length !== b.length || !a.length) throw new Error("목소리 데이터 크기가 맞지 않습니다.");
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i]))
      throw new Error("목소리 데이터가 손상되었습니다.");
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  if (!aa || !bb) throw new Error("목소리 데이터가 비어 있습니다.");
  return dot / Math.sqrt(aa * bb);
}
export function parseVoiceIdentity(text: string | null): VoiceIdentity | null {
  try {
    const v = JSON.parse(text ?? "null");
    if (
      v?.version !== 1 ||
      v.model !== SPEAKER_MODEL ||
      typeof v.enabled !== "boolean" ||
      !Number.isFinite(v.threshold) ||
      v.threshold < 0.75 ||
      v.threshold > 0.95 ||
      !Array.isArray(v.samples) ||
      v.samples.length !== 3 ||
      typeof v.registeredAt !== "string"
    )
      return null;
    if (
      v.samples.some(
        (s: unknown) =>
          !Array.isArray(s) ||
          s.length !== 512 ||
          s.some((n) => typeof n !== "number" || !Number.isFinite(n)),
      )
    )
      return null;
    for (const s of v.samples) similarity(s, s);
    return v;
  } catch {
    return null;
  }
}
export function matchVoice(samples: number[][], candidate: number[], threshold: number) {
  if (samples.length !== 3 || !Number.isFinite(threshold) || threshold < 0.75 || threshold > 0.95)
    throw new Error("목소리를 다시 등록하세요.");
  const scores = samples.map((sample) => similarity(sample, candidate)).sort((a, b) => b - a);
  return { accepted: scores[1] >= threshold, score: scores[1] };
}
export async function voicePcm(blob: Blob): Promise<Float32Array> {
  if (!blob.size || blob.size > 5 * 1024 * 1024)
    throw new Error("음성 파일은 5MB 이내여야 합니다.");
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (decoded.duration < 2 || decoded.duration > 30)
      throw new Error("2초 이상, 30초 이내로 말해 주세요.");
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const pcm = (await offline.startRendering()).getChannelData(0);
    let first = pcm.length,
      last = 0,
      voiced = 0;
    for (let i = 0; i < pcm.length; i += 320) {
      let sum = 0;
      const end = Math.min(i + 320, pcm.length);
      for (let j = i; j < end; j++) sum += pcm[j] * pcm[j];
      if (Math.sqrt(sum / (end - i)) > 0.012) {
        first = Math.min(first, i);
        last = end;
        voiced += end - i;
      }
    }
    if (voiced < 16000 * 1.5)
      throw new Error("목소리가 너무 짧거나 작습니다. 3초 이상 또렷하게 말해 주세요.");
    const start = Math.max(0, first - 1600),
      end = Math.min(pcm.length, last + 1600, start + 16000 * 10);
    return pcm.slice(start, end);
  } finally {
    await context.close();
  }
}
