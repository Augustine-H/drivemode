import type { SoundScore } from "./audio-tools";
let worker: Worker | null = null;
let rejectPending: ((reason: Error) => void) | null = null;
export function cancelAudioWorker() {
  worker?.terminate();
  worker = null;
  rejectPending?.(new Error("소리 분석을 취소했습니다."));
  rejectPending = null;
}
export function analyzeAudioWorker(
  pcm: Float32Array,
  rate: number,
  music: boolean,
  progress: (text: string) => void,
): Promise<{ scores?: SoundScore[]; fingerprint?: string }> {
  cancelAudioWorker();
  worker = music
    ? new Worker(new URL("./music-fingerprint-worker.ts", import.meta.url), { type: "module" })
    : new Worker(new URL("./sound-worker.ts", import.meta.url), { type: "module" });
  const active = worker;
  return new Promise((resolve, reject) => {
    rejectPending = reject;
    const timer = setTimeout(() => cancelAudioWorker(), 180000);
    const finish = () => {
      clearTimeout(timer);
      active.terminate();
      if (worker === active) {
        worker = null;
        rejectPending = null;
      }
    };
    // Also clear timeout on cancellation, which may happen while loading a model.
    rejectPending = (error) => {
      finish();
      reject(error);
    };
    active.onmessage = (e) => {
      if (e.data.progress) {
        progress(e.data.progress);
        return;
      }
      finish();
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data);
    };
    active.onerror = () => {
      finish();
      reject(
        new Error("소리 분석 모델을 실행하지 못했습니다. 브라우저 메모리와 네트워크를 확인하세요."),
      );
    };
    active.postMessage({ pcm, rate }, [pcm.buffer]);
  });
}
