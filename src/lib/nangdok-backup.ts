import { cleanMemoryState, emptyMemoryState, type MemoryState } from "./memory-engine.ts";
import type { Turn } from "@/lib/transcript";
import { cleanPersonaKnowledge, type PersonaKnowledge } from "./persona-memory.ts";
import { isMusicRecord } from "./music-model.ts";

const SETTING_KEYS = [
  "rate",
  "gap",
  "voiceMe",
  "voiceGrok",
  "autoScroll",
  "onlyGrok",
  "voiceOnly",
  "requireVoiceName",
  "filterAnnouncements",
  "announcementLines",
  "autoReply",
  "silence",
  "wakeOn",
  "wakeIdleSeconds",
  "audio",
];
function backupSettings(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  return Object.fromEntries(Object.entries(value).filter(([key]) => SETTING_KEYS.includes(key)));
}

export type BackupPersona = PersonaKnowledge & {
  id: string;
  name: string;
  text: string;
  password: string;
  locked: boolean;
};

export type NangdokBackup = {
  app: "nangdok";
  version: 1;
  schemaVersion?: 2;
  memoryV2?: MemoryState;
  settings?: Record<string, unknown>;
  exportedAt: string;
  personaId: string;
  personas: BackupPersona[];
  threads: Record<string, Turn[]>;
  roomMembers?: Record<string, string[]>;
};

function isTurn(value: unknown): value is Turn {
  if (!value || typeof value !== "object") return false;
  const turn = value as Turn;
  return (
    (turn.speaker === "me" || turn.speaker === "grok") &&
    typeof turn.text === "string" &&
    typeof turn.id === "string" &&
    (turn.music === undefined || isMusicRecord(turn.music)) &&
    (turn.image === undefined ||
      (typeof turn.image === "string" && /^(https:\/\/|media:[a-zA-Z0-9_-]+$)/.test(turn.image))) &&
    (turn.video === undefined ||
      (typeof turn.video === "string" && /^(https:\/\/|media:[a-zA-Z0-9_-]+$)/.test(turn.video))) &&
    (turn.mediaIds === undefined ||
      (Array.isArray(turn.mediaIds) &&
        turn.mediaIds.every(
          (id) => typeof id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(id),
        ))) &&
    (turn.at === undefined || (typeof turn.at === "number" && Number.isFinite(turn.at)))
  );
}

function isPersona(value: unknown): value is BackupPersona {
  if (!value || typeof value !== "object") return false;
  const item = value as BackupPersona;
  return (
    typeof item.id === "string" &&
    item.id.length > 0 &&
    typeof item.name === "string" &&
    item.name.trim().length > 0 &&
    typeof item.text === "string" &&
    typeof item.password === "string" &&
    typeof item.locked === "boolean"
  );
}

export function buildBackup(input: {
  personaId: string;
  personas: BackupPersona[];
  threads: Record<string, Turn[]>;
  roomMembers?: Record<string, string[]>;
  memoryV2?: MemoryState;
  settings?: Record<string, unknown>;
}): NangdokBackup {
  return {
    app: "nangdok",
    version: 1,
    schemaVersion: 2,
    memoryV2: cleanMemoryState(input.memoryV2 ?? emptyMemoryState()),
    settings: backupSettings(input.settings),
    exportedAt: new Date().toISOString(),
    personaId: input.personaId,
    roomMembers: input.roomMembers,
    personas: input.personas.map((item) => ({ ...item })),
    threads: Object.fromEntries(
      Object.entries(input.threads).map(([key, turns]) => [
        key,
        turns.map((turn) => ({ ...turn })),
      ]),
    ),
  };
}

export function parseNangdokBackup(value: unknown): NangdokBackup | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    row.app !== "nangdok" ||
    (row.version !== 1 && row.version !== 2) ||
    !Array.isArray(row.personas)
  )
    return null;
  const personas = row.personas
    .filter(isPersona)
    .slice(0, 12)
    .map((item) => ({
      ...item,
      photo: undefined,
      showBackground: undefined,
      showAvatar: undefined,
      template: undefined,
      memories: undefined,
      ...cleanPersonaKnowledge(item),
      name: item.name.trim().slice(0, 16),
      text: item.text.slice(0, 240),
      password: item.password.slice(0, 32),
    }));
  if (personas.length === 0) return null;
  const threads: Record<string, Turn[]> = {};
  if (row.threads && typeof row.threads === "object") {
    for (const [key, list] of Object.entries(row.threads as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const turns = list.filter(isTurn);
      threads[key] = turns;
    }
  }
  const personaId = personas.some((item) => item.id === row.personaId)
    ? String(row.personaId)
    : personas[0].id;
  return {
    app: "nangdok",
    version: 1,
    schemaVersion: 2,
    memoryV2: cleanMemoryState(row.memoryV2),
    settings: backupSettings(row.settings),
    exportedAt: typeof row.exportedAt === "string" ? row.exportedAt : new Date().toISOString(),
    personaId,
    personas,
    threads,
    roomMembers:
      row.roomMembers && typeof row.roomMembers === "object"
        ? Object.fromEntries(
            Object.entries(row.roomMembers)
              .filter(([host, ids]) => personas.some((p) => p.id === host) && Array.isArray(ids))
              .map(([host, ids]) => [
                host,
                [
                  ...new Set([
                    host,
                    ...(ids as unknown[]).filter(
                      (id): id is string =>
                        typeof id === "string" && personas.some((p) => p.id === id),
                    ),
                  ]),
                ].slice(0, 6),
              ]),
          )
        : undefined,
  };
}
