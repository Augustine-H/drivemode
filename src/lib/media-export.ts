import { mediaGet, mediaPut, mediaTransaction, withMediaLock } from "./media-db.ts";
import { getMedia, readMediaBlob, listMedia } from "./media-repository.ts";
import { mediaExtension, validateMediaItem, validMediaId, type MediaItem } from "./media-model.ts";
import { MAX_MEDIA_BYTES, sha256, storeMediaBlob } from "./media-storage.ts";
export type MediaManifest = {
  formatId: "voice-grok-media";
  version: 1;
  createdAt: number;
  files: {
    mediaId: string;
    relativePath: string;
    byteSize: number;
    checksum: string;
    fileRevision: number;
    state: "verified" | "exported-unverified" | "failed";
    error?: string;
    metadata: MediaItem;
  }[];
};
export function mediaPath(item: MediaItem) {
  if (!validMediaId(item.id)) throw new Error("올바르지 않은 media ID");
  return `VoiceGrok/Media/${item.retentionClass === "saved" ? "Saved" : "Temporary"}/${item.type}/${item.id}.${mediaExtension(item.mimeType)}`;
}
export function safeExportPath(path: string) {
  return (
    path.length < 300 &&
    !path.includes("\\") &&
    !path.startsWith("/") &&
    path.split("/").every((p) => /^[a-zA-Z0-9_.-]+$/.test(p) && p !== "." && p !== "..")
  );
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[\\/]/g, "_");
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function fileHandle(dir: FileSystemDirectoryHandle, path: string) {
  if (!safeExportPath(path)) throw new Error("안전하지 않은 내보내기 경로");
  const pieces = path.split("/");
  for (const piece of pieces.slice(0, -1))
    dir = await dir.getDirectoryHandle(piece, { create: true });
  return dir.getFileHandle(pieces.at(-1)!, { create: true });
}
export async function writeVerified(dir: FileSystemDirectoryHandle, path: string, blob: Blob) {
  const handle = await fileHandle(dir, path);
  const current = await handle.getFile();
  const checksum = await sha256(blob);
  if (current.size === blob.size && (await sha256(current)) === checksum) return;
  const writer = await handle.createWritable();
  try {
    await writer.write(blob);
    await writer.close();
  } catch (e) {
    await writer.abort().catch(() => {});
    throw e;
  }
  const checked = await handle.getFile();
  if (checked.size !== blob.size || (await sha256(checked)) !== checksum)
    throw new Error("내보낸 파일 검증 실패");
}
export async function selectExportFolder() {
  const picker = (
    window as Window & {
      showDirectoryPicker?: (o: { mode: string; id: string }) => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;
  if (!picker || !window.isSecureContext)
    throw new Error(
      "이 브라우저에서는 폴더 쓰기를 지원하지 않습니다. 기기로 내보내기를 사용하세요.",
    );
  const dir = await picker.call(window, { mode: "readwrite", id: "voice-grok-v21-export" });
  await writeVerified(
    dir,
    `VoiceGrok/Manifests/write-test-${crypto.randomUUID()}.json`,
    new Blob(['{"writeCheck":true}']),
  );
  await mediaPut("settings", "export-folder", dir);
  return dir;
}
export async function savedExportFolder() {
  return mediaGet<FileSystemDirectoryHandle>("settings", "export-folder");
}
export async function exportMedia(
  items: MediaItem[],
  dir?: FileSystemDirectoryHandle,
): Promise<MediaManifest> {
  const manifest: MediaManifest = {
    formatId: "voice-grok-media",
    version: 1,
    createdAt: Date.now(),
    files: [],
  };
  for (const snapshot of items) {
    const item = await getMedia(snapshot.id);
    if (!item || item.revision !== snapshot.revision || item.lifecycle !== "active")
      throw new Error("내보내는 동안 미디어가 변경되었습니다. 다시 선택하세요.");
    const { remoteUrl: _url, error: _error, ...metadata } = item;
    const entry: MediaManifest["files"][number] = {
      mediaId: item.id,
      relativePath: mediaPath(item),
      byteSize: item.localByteSize,
      checksum: item.checksum ?? "",
      fileRevision: item.fileRevision,
      state: "failed",
      metadata,
    };
    try {
      const blob = await readMediaBlob(item.id);
      if (!blob) throw new Error("로컬 원본이 없습니다.");
      if ((await sha256(blob)) !== item.checksum) throw new Error("로컬 원본 해시 불일치");
      if (dir) {
        await writeVerified(dir, entry.relativePath, blob);
        entry.state = "verified";
      } else {
        downloadBlob(blob, entry.relativePath.split("/").at(-1)!);
        entry.state = "exported-unverified";
      }
      await withMediaLock(async () => {
        const latest = await getMedia(item.id);
        if (latest?.fileRevision === item.fileRevision)
          await mediaPut("index", item.id, {
            ...latest,
            backupState: entry.state === "verified" ? "verified" : "exported-unverified",
            lastExportedAt: Date.now(),
            lastVerifiedBackupAt: dir ? Date.now() : latest.lastVerifiedBackupAt,
          });
      });
    } catch (e) {
      entry.error = e instanceof Error ? e.message : "파일 내보내기 실패";
    }
    manifest.files.push(entry);
    await mediaPut("backups", "last-media", manifest);
  }
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
  if (dir) await writeVerified(dir, `VoiceGrok/Manifests/media-${manifest.createdAt}.json`, blob);
  else downloadBlob(blob, `VoiceGrok_Media_manifest_${manifest.createdAt}.json`);
  return manifest;
}
export function parseMediaManifest(value: unknown): MediaManifest {
  const m = value as MediaManifest;
  if (
    m?.formatId !== "voice-grok-media" ||
    m.version !== 1 ||
    !Array.isArray(m.files) ||
    m.files.length > 10000 ||
    new Set(m.files.map((f) => f.mediaId)).size !== m.files.length
  )
    throw new Error("미디어 manifest 형식 오류");
  for (const f of m.files)
    if (
      !safeExportPath(f.relativePath) ||
      !validateMediaItem(f.metadata) ||
      f.mediaId !== f.metadata.id ||
      !["verified", "exported-unverified", "failed"].includes(f.state) ||
      (f.state !== "failed" &&
        (!/^[a-f0-9]{64}$/.test(f.checksum) ||
          f.checksum !== f.metadata.checksum ||
          f.byteSize <= 0)) ||
      f.byteSize > MAX_MEDIA_BYTES ||
      f.byteSize !== f.metadata.localByteSize
    )
      throw new Error("미디어 경로/해시/크기 검증 오류");
  return m;
}
export async function reconnectMedia(manifest: MediaManifest, files: File[]) {
  const results: { id: string; ok: boolean; reason?: string }[] = [];
  for (const f of manifest.files) {
    if (!f.checksum || !f.byteSize) {
      results.push({ id: f.mediaId, ok: false, reason: "내보낸 원본 파일 없음" });
      continue;
    }
    const candidates = files.filter((file) => file.size === f.byteSize);
    let blob: File | undefined;
    for (const file of candidates)
      if ((await sha256(file)) === f.checksum) {
        blob = file;
        break;
      }
    if (!blob) {
      results.push({ id: f.mediaId, ok: false, reason: "검증된 원본 파일 없음" });
      continue;
    }
    try {
      await withMediaLock(async () => {
        const latest = await getMedia(f.mediaId);
        if (latest?.lifecycle === "deleted")
          throw new Error("사용자가 삭제한 원본입니다. 새 ID로 가져오세요.");
        if (latest?.checksum && latest.checksum !== f.checksum)
          throw new Error("같은 ID의 다른 원본과 충돌합니다.");
        const original = new Blob([blob!], { type: f.metadata.mimeType });
        const operationId = crypto.randomUUID();
        const pending = {
          ...f.metadata,
          storageKey: f.mediaId,
          storageAdapter: "none" as const,
          availability: "missing" as const,
          localByteSize: 0,
          ingestState: "pending" as const,
          operationId,
          protected: true,
          restorePending: true,
          revision: (latest?.revision ?? f.metadata.revision) + 1,
        };
        if (latest?.availability !== "local")
          await mediaTransaction<void>(["index", "journal"], "readwrite", (tx, done) => {
            tx.objectStore("index").put(pending, f.mediaId);
            tx.objectStore("journal").put(
              {
                id: f.mediaId,
                operation: "ingest",
                operationId,
                expectedChecksum: f.checksum,
                expectedSize: f.byteSize,
                mimeType: f.metadata.mimeType,
              },
              f.mediaId,
            );
            done();
          });
        const stored = await storeMediaBlob(f.mediaId, original);
        await mediaPut("index", f.mediaId, {
          ...f.metadata,
          ...stored,
          storageKey: f.mediaId,
          availability: "local",
          ingestState: "complete",
          restorePending: true,
          protected: true,
          revision: (latest?.revision ?? f.metadata.revision) + 1,
          refs: [
            ...new Map(
              [...(latest?.refs ?? []), ...f.metadata.refs].map((r) => [
                `${r.conversationId}\0${r.messageId}`,
                r,
              ]),
            ).values(),
          ],
          lastVerifiedAt: Date.now(),
        });
        await mediaTransaction<void>(["journal"], "readwrite", (tx, done) => {
          tx.objectStore("journal").delete(f.mediaId);
          done();
        });
        await mediaPut("settings", "policy", {
          ...(await import("./media-repository.ts").then((m) => m.getMediaPolicy())),
          paused: true,
          pauseReason: "미디어 복원 후 보존기간 검토 필요",
        });
      });
      results.push({ id: f.mediaId, ok: true });
    } catch (e) {
      results.push({
        id: f.mediaId,
        ok: false,
        reason: e instanceof Error ? e.message : "재연결 실패",
      });
    }
  }
  return results;
}
export async function mediaRestorePreview(items: MediaItem[]) {
  const local = await listMedia();
  return {
    total: items.length,
    missing: items.filter(
      (i) =>
        !local.some(
          (l) => l.id === i.id && l.checksum === i.checksum && l.availability === "local",
        ),
    ).length,
    conflicts: items
      .filter((i) =>
        local.some((l) => l.id === i.id && l.checksum && i.checksum && l.checksum !== i.checksum),
      )
      .map((i) => i.id),
    expired: items.filter((i) => i.expiresAt && i.expiresAt <= Date.now()).length,
    trashed: items.filter((i) => i.lifecycle === "trashed").length,
  };
}
