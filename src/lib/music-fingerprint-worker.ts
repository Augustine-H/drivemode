// Explicit instantiation avoids unsupported bundler WASM imports in Vite.
import wasmUrl from "rusty-chromaprint-wasm/dist/rusty_chromaprint_wasm_bg.wasm?url";
import * as bindings from "rusty-chromaprint-wasm/dist/rusty_chromaprint_wasm_bg.js";
const api = bindings as unknown as {
  __wbg_set_wasm(exports: WebAssembly.Exports): void;
  fingerprintFromSamples(
    rate: number,
    channels: number,
    samples: Int16Array,
  ): { compressed: string; free(): void };
};
let ready: Promise<void> | null = null;
self.onmessage = async (event: MessageEvent<{ pcm: Float32Array; rate: number }>) => {
  try {
    ready ??= fetch(wasmUrl)
      .then((r) => r.arrayBuffer())
      .then((bytes) =>
        WebAssembly.instantiate(bytes, { "./rusty_chromaprint_wasm_bg.js": bindings }),
      )
      .then(({ instance }) => {
        api.__wbg_set_wasm(instance.exports);
        (instance.exports.__wbindgen_start as () => void)();
      })
      .catch((e) => {
        ready = null;
        throw e;
      });
    await ready;
    const samples = Int16Array.from(event.data.pcm, (x) =>
      Math.round(Math.max(-1, Math.min(1, x)) * 32767),
    );
    const result = api.fingerprintFromSamples(event.data.rate, 1, samples);
    const fingerprint = result.compressed;
    result.free();
    samples.fill(0);
    self.postMessage({ fingerprint });
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : "음악 지문 생성 실패" });
  }
};
