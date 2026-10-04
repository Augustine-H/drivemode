export const DAY_MS = 86_400_000;
export const MEDIA_TYPES = ["image", "voice", "audio", "music", "video"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];
export type MediaRef = { conversationId: string; messageId: string; personaId?: string };
export type MediaItem = {
  id: string;
  type: MediaType;
  filename: string;
  mimeType: string;
  personaId?: string;
  storageAdapter: "opfs" | "idb" | "none";
  storageKey: string;
  localByteSize: number;
  checksum?: string;
  createdAt: number;
  updatedAt: number;
  retainedFrom: number;
  origin: "generated" | "uploaded" | "imported" | "legacy";
  provider?: string;
  model?: string;
  description?: string;
  remoteUrl?: string;
  refs: MediaRef[];
  relatedMemoryIds?: string[];
  retentionClass: "temporary" | "saved";
  lifecycle: "active" | "trashed" | "deleted";
  expiresAt?: number;
  trashedAt?: number;
  purgeAfter?: number;
  deletedAt?: number;
  deletionReason?: string;
  protected?: boolean;
  restorePending?: boolean;
  availability: "local" | "remote-only" | "missing" | "unknown";
  ingestState: "pending" | "complete" | "failed" | "deletion-pending";
  error?: string;
  lastVerifiedAt?: number;
  fileRevision: number;
  revision: number;
  operationId: string;
  metadataSchemaVersion: 1;
  backupState: "none" | "exported-unverified" | "verified";
  lastExportedAt?: number;
  lastVerifiedBackupAt?: number;
};
export type MediaPolicy = {
  days: Record<MediaType, number | null>;
  autoPurge: boolean;
  paused: boolean;
  pauseReason?: string;
  lastMaintenance?: number;
  exportSaves: boolean;
};
export const defaultMediaPolicy = (): MediaPolicy => ({
  days: { image: 30, music: 30, voice: 14, audio: 14, video: 14 },
  autoPurge: true,
  paused: false,
  exportSaves: false,
});
export function mediaId() {
  return `m-${crypto.randomUUID()}`;
}
export function validMediaId(id: string) {
  return /^[a-zA-Z0-9_-]{1,100}$/.test(id);
}
export function mediaExtension(mime: string) {
  return (
    (
      {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif",
        "video/mp4": "mp4",
        "video/webm": "webm",
        "audio/mpeg": "mp3",
        "audio/mp4": "m4a",
        "audio/wav": "wav",
        "audio/webm": "webm",
        "audio/ogg": "ogg",
      } as Record<string, string>
    )[mime.split(";")[0]] ?? "bin"
  );
}
export function validMediaMime(type: MediaType, mime: string) {
  return type === "image"
    ? /^image\/(jpeg|png|webp|gif)$/.test(mime)
    : type === "video"
      ? /^video\/(mp4|webm|ogg)$/.test(mime)
      : /^audio\/(mpeg|mp4|wav|x-wav|webm|ogg|aac|flac)(;.*)?$/.test(mime);
}
export function newMedia(
  input: {
    id?: string;
    type: MediaType;
    origin: MediaItem["origin"];
    filename?: string;
    personaId?: string;
    refs?: MediaRef[];
    description?: string;
    remoteUrl?: string;
    createdAt?: number;
  },
  policy = defaultMediaPolicy(),
  now = Date.now(),
): MediaItem {
  const id = input.id ?? mediaId();
  if (!validMediaId(id)) throw new Error("올바르지 않은 미디어 ID입니다.");
  const saved = input.origin !== "generated";
  const days = policy.days[input.type];
  return {
    ...input,
    id,
    filename: input.filename ?? id,
    refs: input.refs ?? [],
    mimeType: "",
    storageAdapter: "none",
    storageKey: id,
    localByteSize: 0,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
    retainedFrom: now,
    retentionClass: saved ? "saved" : "temporary",
    lifecycle: "active",
    expiresAt: !saved && days !== null ? now + days * DAY_MS : undefined,
    protected: input.origin === "legacy",
    availability: input.remoteUrl?.startsWith("https://") ? "remote-only" : "unknown",
    ingestState: "pending",
    fileRevision: 0,
    revision: 1,
    operationId: crypto.randomUUID(),
    metadataSchemaVersion: 1,
    backupState: "none",
  };
}
export function transitionMedia(
  item: MediaItem,
  action: "save" | "unsave" | "trash" | "restore",
  policy: MediaPolicy,
  now = Date.now(),
) {
  if (item.lifecycle === "deleted" || item.ingestState === "deletion-pending")
    throw new Error("원본 삭제가 진행되었거나 완료된 항목입니다.");
  if (action !== "restore" && item.lifecycle !== "active")
    throw new Error("휴지통에서 먼저 복원하세요.");
  const next = { ...item, revision: item.revision + 1, updatedAt: now };
  if (action === "trash")
    return { ...next, lifecycle: "trashed" as const, trashedAt: now, purgeAfter: now + 7 * DAY_MS };
  if (action === "save")
    return { ...next, retentionClass: "saved" as const, expiresAt: undefined, protected: false };
  const saved = action === "restore" && item.retentionClass === "saved";
  const days = policy.days[item.type];
  return {
    ...next,
    lifecycle: "active" as const,
    retentionClass: saved ? ("saved" as const) : ("temporary" as const),
    retainedFrom: now,
    expiresAt: !saved && days !== null ? now + days * DAY_MS : undefined,
    trashedAt: undefined,
    purgeAfter: undefined,
    restorePending: false,
    protected: false,
  };
}
export function retentionAction(item: MediaItem, policy: MediaPolicy, now: number) {
  if (policy.paused || item.protected || item.restorePending || item.ingestState === "pending")
    return null;
  if (
    item.lifecycle === "active" &&
    item.retentionClass === "temporary" &&
    item.expiresAt !== undefined &&
    item.expiresAt <= now
  )
    return "trash";
  if (
    item.lifecycle === "trashed" &&
    policy.autoPurge &&
    item.purgeAfter !== undefined &&
    item.purgeAfter <= now
  )
    return "purge";
  return null;
}
export function mediaTotals(items: MediaItem[]) {
  const byType = Object.fromEntries(MEDIA_TYPES.map((t) => [t, 0])) as Record<MediaType, number>;
  let trashBytes = 0,
    missing = 0,
    unverified = 0;
  const counted = new Set<string>();
  for (const item of items) {
    if (item.lifecycle === "deleted") continue;
    if (item.availability === "missing" || item.availability === "remote-only") missing++;
    if (item.ingestState !== "complete") unverified++;
    const key = `${item.storageAdapter}:${item.storageKey}`;
    if (item.availability !== "local" || counted.has(key)) continue;
    counted.add(key);
    byType[item.type] += item.localByteSize;
    if (item.lifecycle === "trashed") trashBytes += item.localByteSize;
  }
  return {
    byType,
    total: Object.values(byType).reduce((a, b) => a + b, 0),
    trashBytes,
    missing,
    unverified,
  };
}
export function validateMediaItem(value: unknown): value is MediaItem {
  const i = value as MediaItem;
  return (
    !!i &&
    validMediaId(i.id ?? "") &&
    MEDIA_TYPES.includes(i.type) &&
    ["active", "trashed", "deleted"].includes(i.lifecycle) &&
    ["temporary", "saved"].includes(i.retentionClass) &&
    ["opfs", "idb", "none"].includes(i.storageAdapter) &&
    validMediaId(i.storageKey ?? "") &&
    i.storageKey === i.id &&
    ["local", "remote-only", "missing", "unknown"].includes(i.availability) &&
    ["pending", "complete", "failed", "deletion-pending"].includes(i.ingestState) &&
    ["generated", "uploaded", "imported", "legacy"].includes(i.origin) &&
    Number.isFinite(i.localByteSize) &&
    i.localByteSize >= 0 &&
    Number.isFinite(i.createdAt) &&
    Number.isFinite(i.revision) &&
    Array.isArray(i.refs) &&
    i.refs.every((r) => typeof r.conversationId === "string" && typeof r.messageId === "string") &&
    typeof i.filename === "string" &&
    typeof i.mimeType === "string" &&
    (!i.checksum || /^[a-f0-9]{64}$/.test(i.checksum))
  );
}
export function detachMediaReferences(
  item: MediaItem,
  messages: Set<string>,
  trashTemporary: boolean,
  policy: MediaPolicy,
  now: number,
) {
  const refs = item.refs.filter((r) => !messages.has(`${r.conversationId}\0${r.messageId}`));
  if (refs.length === item.refs.length) return item;
  const next = { ...item, refs, revision: item.revision + 1, updatedAt: now };
  return trashTemporary &&
    !refs.length &&
    next.retentionClass === "temporary" &&
    next.lifecycle === "active"
    ? transitionMedia(next, "trash", policy, now)
    : next;
}
