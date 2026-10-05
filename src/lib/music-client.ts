import { musicUrl, type MusicArtifact, type MusicJob, type MusicRequest } from "./music-model";
export const MUSIC_CONNECTION_CHANGED = "voice-grok-music-connection-changed";
export type MusicConnection = { url: string; token: string };
let current: MusicConnection | undefined;
let loaded = false;
const authorizedRequests = new Set<string>();
export const authorizeMusicRequest = (id: string) => {
  authorizedRequests.add(id);
};
export const musicRequestAuthorized = (id: string) => authorizedRequests.has(id);
function db() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("voice-grok-music-private-connection", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("connection");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(new Error("음악 연결 저장소를 열지 못했습니다."));
  });
}
export async function connection(): Promise<MusicConnection> {
  if (!loaded) {
    const d = await db();
    try {
      const record = await new Promise<
        { url: string; key: CryptoKey; iv: Uint8Array; ciphertext: ArrayBuffer } | undefined
      >((resolve, reject) => {
        const r = d.transaction("connection").objectStore("connection").get("nas");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      if (record) {
        const bytes = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: new Uint8Array(record.iv) },
          record.key,
          record.ciphertext,
        );
        current = { url: musicUrl(record.url), token: new TextDecoder().decode(bytes) };
      }
      loaded = true;
    } finally {
      d.close();
    }
  }
  if (!current) throw new Error("설정 → 음악 생성에서 NAS 연결을 먼저 저장해 주세요.");
  return current;
}
export async function saveConnection(input: MusicConnection) {
  const value = { url: musicUrl(input.url), token: input.token.trim() };
  if (!/^[A-Za-z0-9_-]{64}$/.test(value.token))
    throw new Error("NAS의 클라이언트 연결 키가 올바르지 않습니다.");
  await musicHealth(value);
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(value.token),
  );
  const d = await db();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction("connection", "readwrite");
      tx.objectStore("connection").put({ url: value.url, key, iv, ciphertext }, "nas");
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
    current = value;
    loaded = true;
  } finally {
    d.close();
  }
  window.dispatchEvent(new Event(MUSIC_CONNECTION_CHANGED));
}
export async function forgetConnection() {
  const d = await db();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction("connection", "readwrite");
      tx.objectStore("connection").delete("nas");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    d.close();
  }
  current = undefined;
  loaded = true;
  window.dispatchEvent(new Event(MUSIC_CONNECTION_CHANGED));
}
async function request(path: string, options: RequestInit = {}, config?: MusicConnection) {
  const c = config ?? (await connection());
  let response: Response;
  try {
    response = await fetch(c.url + path, {
      ...options,
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      headers: { ...options.headers, Authorization: `Bearer ${c.token}` },
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
    });
  } catch (e) {
    if (options.signal?.aborted) throw e;
    throw new Error(
      "NAS에 연결하지 못했습니다. 이 기기의 Tailscale 연결, NAS 상태, 브라우저의 로컬 네트워크 권한을 확인하세요. 기존 작업은 유지됩니다.",
    );
  }
  if (!response.ok) {
    const messages: Record<number, string> = {
      401: "NAS 연결 키가 맞지 않습니다. 연결 설정을 확인하세요.",
      403: "NAS에서 이 앱의 접근을 허용하지 않았습니다.",
      404: "NAS 작업을 찾지 못했습니다.",
      409: "요청 또는 음원 상태가 충돌했습니다.",
      429: "음악 대기열이 가득 찼습니다.",
      503: "음악 서비스가 아직 준비되지 않았습니다.",
      507: "NAS 저장 공간이 부족합니다.",
    };
    throw new Error(
      messages[response.status] ??
        `음악 서비스 오류 (${response.status}). 자동으로 새 작업을 만들지 않습니다.`,
    );
  }
  return response;
}
export async function musicHealth(
  config?: MusicConnection,
): Promise<{ workerState: string; heartbeatAgeSeconds?: number; supportedTasks?: string[] }> {
  const h = await (await request("/health", {}, config)).json();
  if (h.service !== "voice-grok-nas-music") throw new Error("음악 서비스 주소가 아닙니다.");
  return h;
}
export const submitMusic = async (body: MusicRequest, signal?: AbortSignal): Promise<MusicJob> =>
  (
    await (
      await request("/v1/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      })
    ).json()
  ).job;
export const getMusic = async (id: string, signal?: AbortSignal): Promise<MusicJob> =>
  (await request(`/v1/jobs/${jobId(id)}`, { signal })).json();
export const cancelMusic = async (id: string): Promise<MusicJob> =>
  (await request(`/v1/jobs/${jobId(id)}/cancel`, { method: "POST" })).json();
export const listMusic = async (): Promise<MusicJob[]> =>
  (await (await request("/v1/jobs?limit=100")).json()).jobs;
function jobId(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("음악 작업 번호가 올바르지 않습니다.");
  return id;
}
export async function musicBlob(
  id: string,
  kind: "wav" | "mp3",
  artifact: MusicArtifact,
  signal?: AbortSignal,
) {
  if (
    !Number.isSafeInteger(artifact.bytes) ||
    artifact.bytes < 1 ||
    artifact.bytes > 64 * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/.test(artifact.sha256)
  )
    throw new Error("음원 파일 정보가 올바르지 않습니다.");
  const response = await request(`/v1/jobs/${jobId(id)}/audio/${kind}`, { signal });
  const reader = response.body?.getReader();
  if (!reader) throw new Error("음원 파일을 읽지 못했습니다.");
  const chunks: ArrayBuffer[] = [];
  let count = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      count += value.byteLength;
      if (count > artifact.bytes) throw new Error("음원 크기가 기록과 다릅니다.");
      chunks.push(value.slice().buffer as ArrayBuffer);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const blob = new Blob(chunks, { type: kind === "wav" ? "audio/wav" : "audio/mpeg" });
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  if (count !== artifact.bytes || digest !== artifact.sha256)
    throw new Error("음원 무결성 확인에 실패했습니다. 파일을 저장하지 않았습니다.");
  return blob;
}
