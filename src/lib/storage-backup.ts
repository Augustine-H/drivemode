import { buildBackup, parseNangdokBackup, type NangdokBackup } from "./nangdok-backup.ts";
import { sha256 } from "./media-storage.ts";
import { validateMediaItem, type MediaItem } from "./media-model.ts";
export const MAX_MEMORY_ARCHIVE = 25 * 1024 * 1024;
export type MemoryArchive = {
  formatId: "voice-grok-memory";
  backupSchemaVersion: 3;
  appVersion: string;
  backupId: string;
  deviceId: string;
  createdAt: number;
  scope: "memory-index-only";
  recordCounts: Record<string, number>;
  payloads: Record<string, { byteSize: number; sha256: string }>;
  files: Record<string, string>;
};
const PARTS = [
  "conversations.json",
  "personas.json",
  "settings.json",
  "summaries.json",
  "memories.json",
  "media-index.json",
  "deletion-journal.json",
  "app.json",
];
export function archiveName(deviceId: string, backupId: string, now = Date.now()) {
  return `VoiceGrok_Memory_${new Date(now).toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15)}_${deviceId}_${backupId}.vgb`;
}
export function cleanArchiveBackup(input: NangdokBackup) {
  const result = buildBackup(input);
  result.personas = result.personas.map((p) => ({
    id: p.id,
    name: p.name,
    text: p.text,
    template: p.template,
    memories: p.memories,
    voice: p.voice,
    photo: p.photo,
    showAvatar: p.showAvatar,
    showBackground: p.showBackground,
    password: "",
    locked: false,
  }));
  result.threads = Object.fromEntries(
    Object.entries(result.threads).map(([room, list]) => [
      room,
      list.map((t) => ({
        ...t,
        image: t.mediaIds?.length
          ? t.image
            ? `media:${t.mediaIds[0]}`
            : undefined
          : t.image?.split("?")[0],
        video: t.mediaIds?.length
          ? t.video
            ? `media:${t.mediaIds[0]}`
            : undefined
          : t.video?.split("?")[0],
      })),
    ]),
  );
  if (result.settings?.audio) {
    const a = result.settings.audio as Record<string, unknown>;
    result.settings.audio = Object.fromEntries(
      ["enabled", "microphone", "system", "music", "environment", "remember"]
        .filter((k) => typeof a[k] === "boolean")
        .map((k) => [k, a[k]]),
    );
  }
  return result;
}
export async function makeMemoryArchive(
  backup: NangdokBackup,
  media: MediaItem[],
  journal: unknown[],
  deviceId: string,
  appVersion: string,
): Promise<MemoryArchive> {
  backup = cleanArchiveBackup(backup);
  const parts: Record<string, unknown> = {
    "conversations.json": backup.threads,
    "personas.json": backup.personas,
    "settings.json": backup.settings ?? {},
    "summaries.json": backup.memoryV2?.summaries ?? {},
    "memories.json": backup.memoryV2 ?? {},
    "media-index.json": media.map(({ remoteUrl: _remote, error: _error, ...m }) => m),
    "deletion-journal.json": journal,
    "app.json": {
      app: backup.app,
      version: backup.version,
      schemaVersion: 2,
      exportedAt: backup.exportedAt,
      personaId: backup.personaId,
      roomMembers: backup.roomMembers,
    },
  };
  const files: Record<string, string> = {},
    payloads: MemoryArchive["payloads"] = {};
  for (const [name, value] of Object.entries(parts)) {
    const text = JSON.stringify(value);
    const blob = new Blob([text]);
    files[name] = text;
    payloads[name] = { byteSize: blob.size, sha256: await sha256(blob) };
  }
  const archive: MemoryArchive = {
    formatId: "voice-grok-memory",
    backupSchemaVersion: 3,
    appVersion,
    backupId: crypto.randomUUID(),
    deviceId,
    createdAt: Date.now(),
    scope: "memory-index-only",
    recordCounts: {
      messages: Object.values(backup.threads).reduce((n, l) => n + l.length, 0),
      personas: backup.personas.length,
      memories: Object.values(backup.memoryV2?.longTerm ?? {}).reduce((n, l) => n + l.length, 0),
      summaries: Object.values(backup.memoryV2?.summaries ?? {}).reduce((n, l) => n + l.length, 0),
      media: media.length,
    },
    files,
    payloads,
  };
  if (new Blob([JSON.stringify(archive)]).size > MAX_MEMORY_ARCHIVE)
    throw new Error("기억 백업이 25MiB를 초과합니다. 대화를 나누어 백업하세요.");
  return archive;
}
function encode(bytes: Uint8Array) {
  let str = "";
  for (let i = 0; i < bytes.length; i += 8192)
    str += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(str);
}
function decode(text: string, max: number) {
  if (
    typeof text !== "string" ||
    text.length > Math.ceil(max / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(text)
  )
    throw new Error("암호화 형식 오류");
  const str = atob(text);
  if (str.length > max) throw new Error("암호화 파일이 너무 큽니다.");
  return Uint8Array.from(str, (c) => c.charCodeAt(0));
}
const KDF_ITERATIONS = 310000;
async function passwordKey(password: string, salt: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: KDF_ITERATIONS, hash: "SHA-256" },
    key,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function encodeMemoryArchive(archive: MemoryArchive, password?: string) {
  const text = JSON.stringify(archive);
  if (!password) return new Blob([text], { type: "application/json" });
  if (password.length < 8) throw new Error("백업 암호는 8글자 이상 입력하세요.");
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    nonce = crypto.getRandomValues(new Uint8Array(12));
  const header = {
    formatId: "voice-grok-encrypted",
    version: 1,
    algorithm: "AES-GCM-256",
    kdf: "PBKDF2-SHA256",
    iterations: KDF_ITERATIONS,
    salt: encode(salt),
    nonce: encode(nonce),
  };
  const additionalData = new TextEncoder().encode(JSON.stringify(header));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData },
    await passwordKey(password, salt),
    new TextEncoder().encode(text),
  );
  return new Blob([JSON.stringify({ ...header, ciphertext: encode(new Uint8Array(encrypted)) })], {
    type: "application/json",
  });
}
export async function parseMemoryArchive(
  blob: Blob,
  password?: string,
): Promise<{
  backup: NangdokBackup;
  media: MediaItem[];
  journal: unknown[];
  archive?: MemoryArchive;
}> {
  if (blob.size > MAX_MEMORY_ARCHIVE * 1.4) throw new Error("백업은 35MiB 이하로 선택하세요.");
  let value = JSON.parse(await blob.text());
  if (value.formatId === "voice-grok-encrypted") {
    if (!password) throw new Error("이 백업의 암호를 입력하세요.");
    if (
      value.version !== 1 ||
      value.iterations !== KDF_ITERATIONS ||
      value.algorithm !== "AES-GCM-256" ||
      value.kdf !== "PBKDF2-SHA256"
    )
      throw new Error("지원하지 않는 암호화 설정입니다.");
    const { ciphertext, ...header } = value;
    const salt = decode(value.salt, 16),
      nonce = decode(value.nonce, 12);
    if (salt.length !== 16 || nonce.length !== 12) throw new Error("암호화 헤더가 손상되었습니다.");
    try {
      const bytes = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: nonce,
          additionalData: new TextEncoder().encode(JSON.stringify(header)),
        },
        await passwordKey(password, salt),
        decode(ciphertext, MAX_MEMORY_ARCHIVE + 16),
      );
      value = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Error("암호가 틀렸거나 백업이 변조되었습니다. 복원을 중단했습니다.");
    }
  }
  if (value.formatId !== "voice-grok-memory") {
    const backup = parseNangdokBackup(value);
    if (!backup) throw new Error("지원하지 않는 백업입니다.");
    return { backup, media: [], journal: [] };
  }
  const a = value as MemoryArchive;
  if (
    a.backupSchemaVersion !== 3 ||
    a.scope !== "memory-index-only" ||
    !a.files ||
    Object.keys(a.files).length !== PARTS.length ||
    !a.payloads
  )
    throw new Error("백업 스키마가 올바르지 않습니다.");
  const parsed: Record<string, unknown> = {};
  for (const name of PARTS) {
    const text = a.files[name],
      meta = a.payloads[name];
    if (typeof text !== "string" || !meta) throw new Error("백업 항목이 누락되었습니다.");
    const part = new Blob([text]);
    if (part.size !== meta.byteSize || (await sha256(part)) !== meta.sha256)
      throw new Error(`${name}: 크기/해시 검증 실패`);
    parsed[name] = JSON.parse(text);
  }
  const backup = parseNangdokBackup({
    ...(parsed["app.json"] as object),
    threads: parsed["conversations.json"],
    personas: parsed["personas.json"],
    settings: parsed["settings.json"],
    memoryV2: { ...(parsed["memories.json"] as object), summaries: parsed["summaries.json"] },
  });
  const media = parsed["media-index.json"];
  if (
    !backup ||
    !Array.isArray(media) ||
    !media.every(validateMediaItem) ||
    new Set(media.map((m) => m.id)).size !== media.length
  )
    throw new Error("백업 데이터/미디어 ID 검증 실패");
  // New archives are strict: legacy's permissive cleaner must not silently drop corrupt rows.
  const sourceThreads = parsed["conversations.json"];
  const sourcePersonas = parsed["personas.json"];
  if (
    !sourceThreads ||
    typeof sourceThreads !== "object" ||
    Array.isArray(sourceThreads) ||
    !Array.isArray(sourcePersonas) ||
    sourcePersonas.length !== backup.personas.length ||
    new Set(backup.personas.map((p) => p.id)).size !== backup.personas.length
  )
    throw new Error("백업 페르소나/대화 스키마 검증 실패");
  for (const [room, rows] of Object.entries(sourceThreads)) {
    if (
      !Array.isArray(rows) ||
      rows.length !== backup.threads[room]?.length ||
      new Set(rows.map((t) => t.id)).size !== rows.length
    )
      throw new Error("백업 대화 항목 검증 실패");
  }
  const ids = new Set(media.map((m) => m.id));
  for (const list of Object.values(backup.threads))
    for (const t of list)
      if (t.mediaIds?.some((id) => !ids.has(id))) throw new Error(`미디어 참조 누락: ${t.id}`);
  return {
    backup,
    media,
    journal: Array.isArray(parsed["deletion-journal.json"]) ? parsed["deletion-journal.json"] : [],
    archive: a,
  };
}
export function mergeMemoryBackup(current: NangdokBackup, incoming: NangdokBackup): NangdokBackup {
  const canonical = (value: unknown): string =>
    JSON.stringify(value, (_key, v) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
        : v,
    );
  const cleanedCurrent = cleanArchiveBackup(current);
  const personas = [...current.personas];
  for (const p of incoming.personas) {
    const old = personas.find((x) => x.id === p.id);
    if (
      old &&
      canonical(cleanedCurrent.personas.find((x) => x.id === p.id)) !==
        canonical(cleanArchiveBackup({ ...incoming, personas: [p] }).personas[0])
    )
      throw new Error(`페르소나 충돌: ${p.name} (교체 또는 ID 변경 필요)`);
    if (!old) personas.push(p);
  }
  const threads = { ...current.threads };
  for (const [room, list] of Object.entries(incoming.threads)) {
    const map = new Map((threads[room] ?? []).map((t) => [t.id, t]));
    for (const t of list) {
      const old = map.get(t.id);
      if (old && canonical(old) !== canonical(t)) throw new Error(`대화 메시지 충돌: ${t.id}`);
      map.set(t.id, t);
    }
    threads[room] = [...map.values()].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  }
  const memory = { ...current.memoryV2! };
  for (const key of ["longTerm", "summaries"] as const) {
    memory[key] = { ...memory[key] };
    for (const [id, docs] of Object.entries(incoming.memoryV2?.[key] ?? {})) {
      const map = new Map((memory[key][id] ?? []).map((d) => [d.id, d]));
      for (const d of docs) {
        const old = map.get(d.id);
        if (old && old.content !== d.content) throw new Error(`기억 충돌: ${d.id}`);
        map.set(d.id, d);
      }
      memory[key][id] = [...map.values()];
    }
  }
  return {
    ...current,
    personas,
    threads,
    memoryV2: memory,
    roomMembers: { ...incoming.roomMembers, ...current.roomMembers },
  };
}
