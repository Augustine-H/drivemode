import { mediaAll, mediaGet, mediaPut, mediaTransaction, withMediaLock } from "./media-db.ts";
import { adapterFor, sha256, sourceBlob, storeMediaBlob } from "./media-storage.ts";
import {
  defaultMediaPolicy,
  newMedia,
  retentionAction,
  transitionMedia,
  validMediaMime,
  detachMediaReferences,
  DAY_MS,
  type MediaItem,
  type MediaPolicy,
  type MediaRef,
} from "./media-model.ts";
export const MEDIA_CHANGED = "voice-grok-media-changed";
function changed() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(MEDIA_CHANGED));
    if (typeof BroadcastChannel !== "undefined") {
      const c = new BroadcastChannel(MEDIA_CHANGED);
      c.postMessage("changed");
      c.close();
    }
  }
}
export const listMedia = () => mediaAll<MediaItem>("index");
export const getMedia = (id: string) => mediaGet<MediaItem>("index", id);
export async function getMediaPolicy() {
  return (await mediaGet<MediaPolicy>("settings", "policy")) ?? defaultMediaPolicy();
}
export async function saveMediaPolicy(policy: MediaPolicy) {
  for (const days of Object.values(policy.days))
    if (days !== null && ![7, 14, 30, 90].includes(days))
      throw new Error("보존기간이 올바르지 않습니다.");
  await withMediaLock(() => mediaPut("settings", "policy", policy));
  changed();
}
type Ingest = Parameters<typeof newMedia>[0] & {
  blob?: Blob;
  url?: string;
  provider?: string;
  model?: string;
};
async function ingestLocked(input: Ingest, retry?: MediaItem) {
  const policy = await getMediaPolicy();
  let item = retry ?? newMedia({ ...input, remoteUrl: input.url }, policy);
  if (item.lifecycle === "deleted" || item.ingestState === "deletion-pending")
    throw new Error("삭제한 원본을 다시 저장할 수 없습니다.");
  item = {
    ...item,
    provider: input.provider ?? item.provider,
    model: input.model ?? item.model,
    ingestState: "pending",
    operationId: crypto.randomUUID(),
    revision: item.revision + 1,
  };
  await mediaTransaction<void>(["index", "journal"], "readwrite", (tx, done) => {
    tx.objectStore("index").put(item, item.id);
    tx.objectStore("journal").put(
      { id: item.id, operation: "ingest", operationId: item.operationId, startedAt: Date.now() },
      item.id,
    );
    done();
  });
  try {
    const blob = input.blob ?? (await sourceBlob(input.url ?? item.remoteUrl ?? ""));
    if (!validMediaMime(item.type, blob.type)) throw new Error("파일 유형과 실제 MIME이 다릅니다.");
    const expectedChecksum = await sha256(blob);
    item = { ...item, checksum: expectedChecksum, mimeType: blob.type };
    await mediaTransaction<void>(["index", "journal"], "readwrite", (tx, done) => {
      tx.objectStore("index").put(item, item.id);
      tx.objectStore("journal").put(
        {
          id: item.id,
          operation: "ingest",
          operationId: item.operationId,
          expectedChecksum,
          expectedSize: blob.size,
          mimeType: blob.type,
        },
        item.id,
      );
      done();
    });
    const stored = await storeMediaBlob(item.storageKey, blob);
    // The writer lock and operationId prevent a late ingest from resurrecting a deletion.
    const latest = await getMedia(item.id);
    if (latest?.operationId !== item.operationId || latest.lifecycle !== "active")
      throw new Error("파일 상태가 변경되었습니다.");
    const now = Date.now();
    item = {
      ...item,
      ...stored,
      mimeType: blob.type,
      availability: "local",
      ingestState: "complete",
      error: undefined,
      fileRevision: item.fileRevision + 1,
      updatedAt: now,
      lastVerifiedAt: now,
      retainedFrom: retry ? item.retainedFrom : now,
      expiresAt:
        item.retentionClass === "temporary" && policy.days[item.type] !== null
          ? now + policy.days[item.type]! * DAY_MS
          : undefined,
    };
    await mediaTransaction<void>(["index", "journal"], "readwrite", (tx, done) => {
      tx.objectStore("index").put(item, item.id);
      tx.objectStore("journal").delete(item.id);
      done();
    });
  } catch (e) {
    item = {
      ...item,
      ingestState: "failed",
      availability: item.remoteUrl?.startsWith("https://") ? "remote-only" : "missing",
      error: e instanceof Error ? e.message : "원본 저장 실패",
      updatedAt: Date.now(),
    };
    await mediaPut("index", item.id, item);
  }
  changed();
  return item;
}
export function ingestMedia(input: Ingest) {
  return withMediaLock(async () => {
    if (input.id && (await getMedia(input.id)))
      throw new Error("같은 ID의 미디어가 이미 있습니다. 원본 재시도 또는 새 ID를 사용하세요.");
    return ingestLocked(input);
  });
}
export async function retryMedia(id: string, blob?: Blob) {
  return withMediaLock(async () => {
    const item = await getMedia(id);
    if (!item) throw new Error("기록이 없습니다.");
    return ingestLocked({ id, type: item.type, origin: item.origin, url: item.remoteUrl, blob }, item);
  });
}
export async function readMediaBlob(id: string) {
  const item = await getMedia(id);
  if (
    !item ||
    item.lifecycle === "deleted" ||
    item.ingestState === "deletion-pending" ||
    item.availability !== "local"
  )
    return undefined;
  const blob = await adapterFor(item)?.read(item.storageKey);
  if (!blob || blob.size !== item.localByteSize) {
    await withMediaLock(async () => {
      const current = await getMedia(id);
      if (current?.revision === item.revision)
        await mediaPut("index", id, {
          ...current,
          availability: "missing",
          localByteSize: 0,
          error: "원본 파일이 없습니다. 백업에서 복원하세요.",
          revision: current.revision + 1,
        });
    });
    changed();
    return undefined;
  }
  return blob.type ? blob : new Blob([blob], { type: item.mimeType });
}
export function changeMedia(
  id: string,
  revision: number,
  action: "save" | "unsave" | "trash" | "restore",
) {
  return withMediaLock(async () => {
    const item = await getMedia(id);
    if (!item || item.revision !== revision)
      throw new Error("다른 창에서 항목이 변경되었습니다. 목록을 새로 확인하세요.");
    const next = transitionMedia(item, action, await getMediaPolicy());
    await mediaPut("index", id, next);
    changed();
    return next;
  });
}
async function purgeLocked(item: MediaItem, automatic = false, now = Date.now()) {
  const latest = await getMedia(item.id);
  const policy = await getMediaPolicy();
  if (
    !latest ||
    latest.revision !== item.revision ||
    latest.lifecycle !== "trashed" ||
    (automatic && retentionAction(latest, policy, now) !== "purge")
  )
    return false;
  const pending = {
    ...latest,
    ingestState: "deletion-pending" as const,
    revision: latest.revision + 1,
    operationId: crypto.randomUUID(),
  };
  await mediaTransaction<void>(["index", "journal"], "readwrite", (tx, done) => {
    tx.objectStore("index").put(pending, item.id);
    tx.objectStore("journal").put(
      { id: item.id, operation: "purge", operationId: pending.operationId },
      item.id,
    );
    done();
  });
  try {
    const { opfsAdapter, idbAdapter } = await import("./media-storage.ts");
    // Failed writes can leave bytes in either adapter before an index is finalized.
    const copies = [idbAdapter];
    if (typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function")
      copies.push(opfsAdapter);
    for (const adapter of copies) {
      await adapter.remove(pending.storageKey);
      if (await adapter.read(pending.storageKey))
        throw new Error("파일 삭제를 확인하지 못했습니다.");
    }
    const tombstone: MediaItem = {
      ...pending,
      lifecycle: "deleted",
      ingestState: "complete",
      availability: "missing",
      localByteSize: 0,
      storageAdapter: "none",
      description: undefined,
      remoteUrl: undefined,
      filename: item.id,
      mimeType: "",
      error: undefined,
      deletionReason: latest.deletionReason ?? (automatic ? "trash-expired" : "user"),
      deletedAt: now,
      updatedAt: now,
    };
    await mediaTransaction<void>(["index", "journal"], "readwrite", (tx, done) => {
      tx.objectStore("index").put(tombstone, item.id);
      tx.objectStore("journal").delete(item.id);
      done();
    });
    return true;
  } catch (e) {
    await mediaPut("index", item.id, {
      ...pending,
      error: e instanceof Error ? e.message : "원본 삭제 실패",
    });
    return false;
  }
}
export function purgeMedia(id: string, revision: number) {
  return withMediaLock(async () => {
    const item = await getMedia(id);
    if (!item || item.revision !== revision) throw new Error("항목이 변경되었습니다.");
    const ok = await purgeLocked(item);
    changed();
    return ok;
  });
}
export async function maintainMedia(now = Date.now()) {
  return withMediaLock(async () => {
    let policy = await getMediaPolicy();
    if (
      policy.lastMaintenance &&
      (now < policy.lastMaintenance - 300000 || now - policy.lastMaintenance > 180 * DAY_MS)
    ) {
      policy = {
        ...policy,
        paused: true,
        pauseReason: "기기 시각 변화 또는 장기 미접속: 보존 상태를 검토한 후 재개하세요.",
      };
    }
    for (const item of await listMedia()) {
      const action = retentionAction(item, policy, now);
      if (action === "trash")
        await mediaPut("index", item.id, {
          ...transitionMedia(item, "trash", policy, now),
          deletionReason: "expired",
        });
      if (action === "purge") await purgeLocked(item, true, now);
    }
    await mediaPut("settings", "policy", { ...policy, lastMaintenance: now });
    changed();
  });
}
export async function recoverMediaJobs() {
  return withMediaLock(async () => {
    for (const item of await listMedia()) {
      if (item.ingestState === "pending") {
        const journal = await mediaGet<{
          expectedChecksum?: string;
          expectedSize?: number;
          mimeType?: string;
        }>("journal", item.id);
        const adapters = await import("./media-storage.ts");
        const possible =
          item.storageAdapter === "none"
            ? [adapters.opfsAdapter, adapters.idbAdapter]
            : [adapterFor(item)!];
        let recovered = false;
        for (const adapter of possible) {
          try {
            let blob = await adapter.read(item.storageKey);
            if (blob && !blob.type && journal?.mimeType)
              blob = new Blob([blob], { type: journal.mimeType });
            if (!blob || !validMediaMime(item.type, blob.type)) continue;
            const checksum = await sha256(blob);
            if (
              journal?.expectedChecksum &&
              (checksum !== journal.expectedChecksum || blob.size !== journal.expectedSize)
            )
              continue;
            await mediaPut("index", item.id, {
              ...item,
              storageAdapter: adapter.id,
              checksum,
              localByteSize: blob.size,
              mimeType: blob.type,
              availability: "local",
              ingestState: "complete",
              protected: true,
              revision: item.revision + 1,
              lastVerifiedAt: Date.now(),
            });
            recovered = true;
            break;
          } catch {
            /* Another adapter may contain a verified copy. */
          }
        }
        if (!recovered)
          await mediaPut("index", item.id, {
            ...item,
            ingestState: "failed",
            availability: item.remoteUrl ? "remote-only" : "missing",
            error: "중단된 파일 저장입니다. 재시도하세요.",
          });
      }
      if (item.ingestState === "deletion-pending") {
        // Resume only the same trashed operation; protection changes cannot be overwritten.
        if (item.lifecycle === "trashed") await purgeLocked(item, false);
      }
    }
    changed();
  });
}
export async function detachConversationMedia(messages: Set<string>, trashTemporary = false) {
  await withMediaLock(async () => {
    const policy = await getMediaPolicy();
    for (const item of await listMedia()) {
      const next = detachMediaReferences(item, messages, trashTemporary, policy, Date.now());
      if (next !== item) await mediaPut("index", item.id, next);
    }
    await mediaPut("journal", `delete-${crypto.randomUUID()}`, {
      operation: "conversation-delete",
      at: Date.now(),
      messages: [...messages],
      trashTemporary,
    });
  });
  changed();
}
export async function linkMedia(id: string, ref: MediaRef) {
  await withMediaLock(async () => {
    const item = await getMedia(id);
    if (
      !item ||
      item.refs.some(
        (r) => r.conversationId === ref.conversationId && r.messageId === ref.messageId,
      )
    )
      return;
    await mediaPut("index", id, {
      ...item,
      refs: [...item.refs, ref],
      revision: item.revision + 1,
    });
  });
  changed();
}
export async function importMediaIndex(items: MediaItem[]) {
  return withMediaLock(async () => {
    const updates: MediaItem[] = [];
    const policy = await getMediaPolicy();
    for (const incoming of items) {
      const existing = await getMedia(incoming.id);
      if (existing?.checksum && incoming.checksum && existing.checksum !== incoming.checksum)
        throw new Error(`미디어 ID 충돌: ${incoming.id}`);
      if (existing?.lifecycle === "deleted") continue;
      const local = existing?.availability === "local";
      updates.push({
        ...incoming,
        ...(local
          ? {
              storageAdapter: existing.storageAdapter,
              storageKey: existing.storageKey,
              localByteSize: existing.localByteSize,
              availability: "local" as const,
            }
          : {
              storageAdapter: "none" as const,
              localByteSize: 0,
              availability: "missing" as const,
            }),
        refs: [
          ...new Map(
            [...(existing?.refs ?? []), ...incoming.refs].map((r) => [
              `${r.conversationId}\0${r.messageId}`,
              r,
            ]),
          ).values(),
        ],
        retentionClass: existing?.retentionClass === "saved" ? "saved" : incoming.retentionClass,
        expiresAt: existing?.retentionClass === "saved" ? undefined : incoming.expiresAt,
        restorePending: true,
        protected: true,
        revision: (existing?.revision ?? incoming.revision) + 1,
      });
    }
    await mediaTransaction<void>(["index", "settings"], "readwrite", (tx, done) => {
      for (const item of updates) tx.objectStore("index").put(item, item.id);
      tx.objectStore("settings").put(
        { ...policy, paused: true, pauseReason: "백업 복원 후 만료·휴지통 항목 검토 필요" },
        "policy",
      );
      done();
    });
    changed();
  });
}
