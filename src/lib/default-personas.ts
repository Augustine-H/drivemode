import type { PersonaKnowledge } from "./persona-memory.ts";

type Persona = PersonaKnowledge & {
  id: string;
  name: string;
  text: string;
  password: string;
  locked: boolean;
};
export const DEFAULT_PERSONAS: Persona[] = ["아라", "서연", "혜정", "나경", "알리나"].map(
  (name, index) => ({
    id: `grokbot-${encodeURIComponent(name)}`,
    name,
    text: "",
    password: "",
    locked: false,
    voice: ["ara", "eve", "luna", "aurora", "carina"][index],
  }),
);
const OLD_NAMES: Record<string, string> = {
  plain: "기본",
  friend: "친구",
  aide: "비서",
  teacher: "선생님",
};
export const ARA_CLEAR_KEY = "voice-grok-ara-cleared";

export function migrateDefaultPersonas<T extends { id: string }>(
  personas: Persona[],
  threads: Record<string, T[]>,
  selected = DEFAULT_PERSONAS[0].id,
) {
  const removed = personas.filter((item) => OLD_NAMES[item.id] === item.name);
  const kept = personas.filter((item) => OLD_NAMES[item.id] !== item.name);
  const next = DEFAULT_PERSONAS.map((item) => {
    const existing = kept.find((candidate) => candidate.name === item.name);
    return existing ? { ...existing, voice: existing.voice ?? item.voice } : { ...item };
  });
  next.push(
    ...kept.filter(
      (item) => !DEFAULT_PERSONAS.some((defaultItem) => defaultItem.name === item.name),
    ),
  );
  const migratedThreads = { ...threads };
  for (const item of removed) delete migratedThreads[item.id];
  const home = next[0].id;
  return {
    personas: next,
    threads: migratedThreads,
    personaId: next.some((item) => item.id === selected) ? selected : home,
  };
}

export function withoutAraThreads<T>(
  personas: { id: string; name: string }[],
  threads: Record<string, T[]>,
): Record<string, T[]> {
  const next = { ...threads };
  const araIds = new Set(
    personas
      .filter((item) => item.name.trim().normalize("NFC") === "아라")
      .map((item) => item.id),
  );
  araIds.add(DEFAULT_PERSONAS[0].id);
  for (const id of araIds) next[id] = [];
  return next;
}

export function takeAraClear<T>(
  storage: Pick<Storage, "getItem" | "setItem">,
  personas: { id: string; name: string }[],
  threads: Record<string, T[]>,
): Record<string, T[]> {
  if (storage.getItem(ARA_CLEAR_KEY) === "1") return threads;
  const next = withoutAraThreads(personas, threads);
  storage.setItem(ARA_CLEAR_KEY, "1");
  return next;
}
