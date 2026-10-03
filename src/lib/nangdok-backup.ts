import type { Turn } from "@/lib/transcript";
import { cleanPersonaKnowledge, type PersonaKnowledge } from "./persona-memory.ts";

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
  exportedAt: string;
  personaId: string;
  personas: BackupPersona[];
  threads: Record<string, Turn[]>;
};

function isTurn(value: unknown): value is Turn {
  if (!value || typeof value !== "object") return false;
  const turn = value as Turn;
  return (
    (turn.speaker === "me" || turn.speaker === "grok") &&
    typeof turn.text === "string" &&
    typeof turn.id === "string" &&
    (turn.image === undefined ||
      (typeof turn.image === "string" && turn.image.startsWith("https://"))) &&
    (turn.video === undefined ||
      (typeof turn.video === "string" && turn.video.startsWith("https://"))) &&
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
}): NangdokBackup {
  return {
    app: "nangdok",
    version: 1,
    exportedAt: new Date().toISOString(),
    personaId: input.personaId,
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
  if (row.app !== "nangdok" || row.version !== 1 || !Array.isArray(row.personas)) return null;
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
      const turns = list.filter(isTurn).slice(-2000);
      threads[key] = turns;
    }
  }
  const personaId = personas.some((item) => item.id === row.personaId)
    ? String(row.personaId)
    : personas[0].id;
  return {
    app: "nangdok",
    version: 1,
    exportedAt: typeof row.exportedAt === "string" ? row.exportedAt : new Date().toISOString(),
    personaId,
    personas,
    threads,
  };
}
