import { mediaGet, mediaPut, mediaTransaction } from "./media-db.ts";
import { validMediaId, type MediaItem } from "./media-model.ts";
import { allowedMediaSource } from "./media-source.ts";
import { networkFetch } from './network.ts';
export const MAX_MEDIA_BYTES = 200 * 1024 * 1024;
export interface MediaStorageAdapter {
  id: "opfs" | "idb";
  write(key: string, blob: Blob): Promise<void>;
  read(key: string): Promise<Blob | undefined>;
  remove(key: string): Promise<void>;
}
function safeKey(key: string) {
  if (!validMediaId(key)) throw new Error("안전하지 않은 파일 경로입니다.");
  return key;
}
async function directory() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle("voice-grok-media", { create: true });
}
export const opfsAdapter: MediaStorageAdapter = {
  id: "opfs",
  async write(key, blob) {
    const f = await (await directory()).getFileHandle(safeKey(key), { create: true });
    const writer = await f.createWritable();
    try {
      await writer.write(blob);
      await writer.close();
    } catch (e) {
      await writer.abort().catch(() => {});
      throw e;
    }
  },
  async read(key) {
    try {
      return await (await (await directory()).getFileHandle(safeKey(key))).getFile();
    } catch (e) {
      if (e instanceof DOMException && e.name === "NotFoundError") return undefined;
      throw e;
    }
  },
  async remove(key) {
    try {
      await (await directory()).removeEntry(safeKey(key));
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "NotFoundError")) throw e;
    }
  },
};
export const idbAdapter: MediaStorageAdapter = {
  id: "idb",
  async write(key, blob) {
    await mediaPut("blobs", safeKey(key), blob);
  },
  read(key) {
    return mediaGet<Blob>("blobs", safeKey(key));
  },
  remove(key) {
    return mediaTransaction<void>(["blobs"], "readwrite", (tx, done) => {
      tx.objectStore("blobs").delete(safeKey(key));
      done();
    });
  },
};
export async function sha256(blob: Blob) {
  const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, "0")).join("");
}
export function adapterFor(item: Pick<MediaItem, "storageAdapter">) {
  return item.storageAdapter === "opfs"
    ? opfsAdapter
    : item.storageAdapter === "idb"
      ? idbAdapter
      : undefined;
}
export async function storeMediaBlob(key: string, blob: Blob) {
  if (!blob.size || blob.size > MAX_MEDIA_BYTES)
    throw new Error("파일은 0바이트보다 크고 200MiB 이하여야 합니다.");
  if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
    const { usage, quota } = await navigator.storage.estimate();
    if (
      blob.size > 10 * 1024 * 1024 &&
      quota &&
      usage !== undefined &&
      (usage + blob.size) / quota >= 0.9
    )
      throw new Error(
        "예상 origin 사용량이 90% 이상입니다. 큰 파일 저장 전에 백업·정리를 확인하세요. 보관 원본은 자동 삭제하지 않습니다.",
      );
  }
  const checksum = await sha256(blob);
  const adapters =
    typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function"
      ? [opfsAdapter, idbAdapter]
      : [idbAdapter];
  let error: unknown;
  for (const adapter of adapters) {
    try {
      await adapter.write(key, blob);
      const check = await adapter.read(key);
      if (!check || check.size !== blob.size || (await sha256(check)) !== checksum)
        throw new Error("파일 쓰기 검증에 실패했습니다.");
      return { storageAdapter: adapter.id, checksum, localByteSize: blob.size };
    } catch (e) {
      error = e; /* Keep the pending journal. Failed OPFS writes are not claimed as saved. */
    }
  }
  throw error;
}
export async function sourceBlob(url: string): Promise<Blob> {
  if (!/^(https:|blob:|data:(image|audio|video)\/)/.test(url))
    throw new Error("미디어 원본 주소가 올바르지 않습니다.");
  const target = allowedMediaSource(url) ? "/api/media-source?url=" + encodeURIComponent(url) : url;
  const response = await (target.startsWith('/api/') ? networkFetch(target, { signal: AbortSignal.timeout(30000) }) : fetch(target, { credentials: "omit", signal: AbortSignal.timeout(30000) }));
  if (!response.ok) throw new Error("원본 접근 실패: 링크 만료·CORS·권한을 확인하세요.");
  if (Number(response.headers.get("content-length")) > MAX_MEDIA_BYTES)
    throw new Error("원본이 200MiB보다 큽니다.");
  // Bound remote responses even when Content-Length is absent.
  if (!response.body) return response.blob();
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    size += step.value.byteLength;
    if (size > MAX_MEDIA_BYTES) {
      await reader.cancel();
      throw new Error("원본이 200MiB보다 큽니다.");
    }
    chunks.push(new Uint8Array(step.value));
  }
  return new Blob(chunks, { type: response.headers.get("content-type")?.split(";")[0] ?? "" });
}
