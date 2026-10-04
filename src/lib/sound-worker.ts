import { pipeline, env } from "@huggingface/transformers";
import { soundLabels } from "./audio-tools";
env.allowLocalModels = false;
if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1;
let classifier: ReturnType<typeof pipeline<"zero-shot-audio-classification">> | null = null;
self.onmessage = async (event: MessageEvent<{ pcm: Float32Array }>) => {
  try {
    classifier ??= pipeline("zero-shot-audio-classification", "Xenova/clap-htsat-unfused", {
      device: "wasm",
      dtype: "q8",
      progress_callback: (p) =>
        self.postMessage({
          progress:
            p.status === "progress"
              ? `소리 모델 다운로드 ${Math.round(p.progress ?? 0)}%`
              : "소리 모델 준비 중",
        }),
    }).catch((e) => {
      classifier = null;
      throw e;
    });
    const model = await classifier;
    const scores = await model(event.data.pcm, Object.keys(soundLabels), {
      hypothesis_template: "{}",
    });
    self.postMessage({ scores });
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : "소리 분석 실패" });
  }
};
