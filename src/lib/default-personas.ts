import type { PersonaKnowledge } from "./persona-memory.ts";

type Persona = PersonaKnowledge & {
  id: string;
  name: string;
  text: string;
  password: string;
  locked: boolean;
};
export const DEFAULT_PERSONAS: Persona[] = ["아라", "서연", "혜정", "나경", "알리나"].map(
  (name) => ({
    id: `grokbot-${encodeURIComponent(name)}`,
    name,
    text: "",
    password: "",
    locked: false,
  }),
);
const OLD_NAMES: Record<string, string> = {
  plain: "기본",
  friend: "친구",
  aide: "비서",
  teacher: "선생님",
};

export function migrateDefaultPersonas<T extends { id: string }>(
  personas: Persona[],
  threads: Record<string, T[]>,
  selected = DEFAULT_PERSONAS[0].id,
) {
  const removed = personas.filter((item) => OLD_NAMES[item.id] === item.name);
  const kept = personas.filter((item) => OLD_NAMES[item.id] !== item.name);
  const next = DEFAULT_PERSONAS.map(
    (item) => kept.find((existing) => existing.name === item.name) ?? { ...item },
  );
  next.push(
    ...kept.filter(
      (item) => !DEFAULT_PERSONAS.some((defaultItem) => defaultItem.name === item.name),
    ),
  );
  const migratedThreads = { ...threads };
  const home = next[0].id;
  for (const item of removed) {
    const existing = migratedThreads[home] ?? [];
    const seen = new Set(existing.map((turn) => turn.id));
    migratedThreads[home] = [
      ...existing,
      ...(migratedThreads[item.id] ?? []).filter((turn) => !seen.has(turn.id)),
    ];
    delete migratedThreads[item.id];
  }
  return {
    personas: next,
    threads: migratedThreads,
    personaId: next.some((item) => item.id === selected) ? selected : home,
  };
}
