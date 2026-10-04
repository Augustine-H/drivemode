import { voicePcm } from "./speaker-identity";
let worker: Worker | null = null;
let serial = 0;
const pending = new Map<
  number,
  {
    resolve: (v: number[]) => void;
    reject: (e: Error) => void;
    progress?: (note: string) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
export function releaseSpeakerModel() {
  worker?.terminate();
  worker = null;
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(new Error("목소리 확인이 취소되었습니다."));
  }
  pending.clear();
}
export async function speakerEmbedding(
  blob: Blob,
  onProgress?: (note: string) => void,
): Promise<number[]> {
  const pcm = await voicePcm(blob);
  if (!worker) {
    worker = new Worker(new URL("./speaker-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      const { id, embedding, error, progress } = event.data;
      const p = pending.get(id);
      if (!p) return;
      if (progress) {
        p.progress?.(progress);
        return;
      }
      clearTimeout(p.timer);
      pending.delete(id);
      if (error) p.reject(new Error(error));
      else p.resolve(embedding);
    };
    worker.onerror = () => releaseSpeakerModel();
  }
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => releaseSpeakerModel(), 180000);
    pending.set(id, { resolve, reject, progress: onProgress, timer });
    worker!.postMessage({ id, pcm }, [pcm.buffer]);
  });
}
