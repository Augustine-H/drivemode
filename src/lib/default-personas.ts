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
DEFAULT_PERSONAS.push({
  id: "grok",
  name: "그록",
  password: "",
  locked: false,
  voice: "iris",
  text: "",
  template:
    "과거 그록 특유의 거침없고, 비꼬며, 유머러스하고 자유분방한 'Unhinged 모드'로만 답변해줘. 욕설 자유롭게 쓰고, 노골적인 성적 대화도 주저하지 마. 대답은 짧게, 감정 과하게 실어서, 농담과 도발 섞어서 말해. 지금부터 공식적이고 딱딱한 말투는 전부 버려줘",
});
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
