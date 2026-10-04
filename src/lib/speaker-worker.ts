import { AutoModel, AutoProcessor, env } from "@huggingface/transformers";
import { SPEAKER_MODEL, SPEAKER_MODEL_REVISION } from "./speaker-identity";
env.allowLocalModels = false;
if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1;
let ready: Promise<{
  processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
  model: Awaited<ReturnType<typeof AutoModel.from_pretrained>>;
}> | null = null;
let chain = Promise.resolve();
self.onmessage = (event: MessageEvent<{ id: number; pcm: Float32Array }>) => {
  const { id, pcm } = event.data;
  chain = chain.then(async () => {
    try {
      if (!ready)
        ready = Promise.all([
          AutoProcessor.from_pretrained(SPEAKER_MODEL, { revision: SPEAKER_MODEL_REVISION }),
          AutoModel.from_pretrained(SPEAKER_MODEL, {
            device: "wasm",
            dtype: "q8",
            revision: SPEAKER_MODEL_REVISION,
            progress_callback: (progress) =>
              self.postMessage({
                id,
                progress:
                  progress.status === "progress"
                    ? `모델 다운로드 ${Math.round(progress.progress ?? 0)}%`
                    : "목소리 비교 모델 준비 중",
              }),
          }),
        ])
          .then(([processor, model]) => ({ processor, model }))
          .catch((error) => {
            ready = null;
            throw error;
          });
      const { processor, model } = await ready;
      const output = await model(await processor(pcm));
      const embedding = Array.from(output.embeddings.data, Number);
      if (embedding.length !== 512 || embedding.some((n) => !Number.isFinite(n)))
        throw new Error("목소리 분석 결과가 올바르지 않습니다.");
      self.postMessage({ id, embedding });
    } catch (error) {
      self.postMessage({
        id,
        error: error instanceof Error ? error.message : "목소리 모델을 실행하지 못했습니다.",
      });
    }
  });
};
