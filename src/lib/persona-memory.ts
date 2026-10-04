import { isFemaleVoice } from "./voices.ts";
export type PersonaMemory = { source: string; content: string };
export const PERSONA_TEMPLATE_LIMIT = 60000;
export const PERSONA_INSTRUCTIONS_LIMIT = PERSONA_TEMPLATE_LIMIT + 1000;
export type PersonaKnowledge = {
  template?: string;
  memories?: PersonaMemory[];
  voice?: string;
  photo?: string;
  showBackground?: boolean;
  showAvatar?: boolean;
};
export type PersonaAsset =
  | { kind: "template"; bot: string; content: string; source: string }
  | { kind: "memory"; bot: string; content: string; source: string };

export function normalizedBot(name: string) {
  return name.trim().normalize("NFC");
}
export function findPersonaByName<T extends { id: string; name: string }>(
  personas: T[],
  bot: string,
) {
  const matches = personas.filter((item) => normalizedBot(item.name) === normalizedBot(bot));
  if (matches.length > 1)
    throw new Error("같은 이름의 페르소나가 여러 개입니다. 이름을 구분해 주세요.");
  return matches[0];
}

export function parsePersonaTemplate(value: unknown, source: string): PersonaAsset | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const profile =
    row.profile && typeof row.profile === "object" ? (row.profile as Record<string, unknown>) : {};
  const fields = ["description", "rules", "skills", "routines", "설명", "룰", "스킬", "루틴"];
  // Conversation exports must never be interpreted as persona instructions.
  if (Array.isArray(row.messages) || Array.isArray(row.turns)) return null;
  if (row.type !== "persona_template" && !fields.some((key) => row[key] != null) && !row.profile)
    return null;
  const name = row.name ?? row.bot ?? row["이름"] ?? profile.name ?? profile["이름"];
  const bot = typeof name === "string" ? normalizedBot(name) : "";
  if (!bot || bot.length > 16) throw new Error("템플릿의 name에 봇 이름을 16자 이내로 입력하세요.");
  const content = [
    typeof row.system_prompt === "string" ? row.system_prompt.trim() : "",
    row.profile ? `설정:\n${JSON.stringify(row.profile, null, 2)}` : "",
    ...fields
      .filter((key) => row[key] != null)
      .map(
        (key) =>
          `${key}:\n${typeof row[key] === "string" ? row[key] : JSON.stringify(row[key], null, 2)}`,
      ),
  ]
    .filter(Boolean)
    .join("\n\n");
  if (!content.trim()) throw new Error("템플릿에 프로필·설명·룰·스킬·루틴 중 하나가 필요합니다.");
  if (content.length > PERSONA_TEMPLATE_LIMIT)
    throw new Error("페르소나 템플릿은 60000자 이내로 만들어 주세요.");
  return { kind: "template", bot, content, source };
}

export function parsePersonaMarkdown(
  text: string,
  source: string,
  fallbackBot: string,
): PersonaAsset {
  let content = text.replace(/^\uFEFF/, "").trim();
  let bot = normalizedBot(fallbackBot);
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (frontmatter) {
    const named = frontmatter[1]
      .match(/^(?:bot|name):\s*([^\r\n]+)$/m)?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, "");
    if (named) bot = normalizedBot(named);
    content = content.slice(frontmatter[0].length).trim();
  }
  if (!bot || bot.length > 16) throw new Error("기억 파일의 봇 이름을 확인하세요.");
  if (!content || content.length > 16000)
    throw new Error("요약 기억은 파일당 1~16000자로 만들어 주세요.");
  return { kind: "memory", bot, content, source };
}

export function isMemoryFile(name: string) {
  return /(?:memory|summary|기억|요약)(?:[._-][^.]*)?\.md$/i.test(name);
}

export function personaFileTimestamp(name: string) {
  return name.match(/^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})_/)?.[1] ?? "";
}

export function personaTemplateFilename(bot: string, date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return `${stamp}_${bot}_template.json`;
}

export function applyPersonaAsset<T extends PersonaKnowledge>(persona: T, asset: PersonaAsset): T {
  if (asset.kind === "template") return { ...persona, template: asset.content };
  const memories = [
    ...(persona.memories ?? []).filter((item) => item.source !== asset.source),
    { source: asset.source, content: asset.content },
  ].sort((a, b) => a.source.localeCompare(b.source));
  if (memories.length > 60 || memories.reduce((sum, item) => sum + item.content.length, 0) > 60000)
    throw new Error(
      "기억은 페르소나당 60개·총 60000자까지입니다. 이전 기억을 합쳐 요약하거나 정리하세요.",
    );
  return { ...persona, memories };
}

export function cleanPersonaKnowledge(value: unknown): PersonaKnowledge {
  if (!value || typeof value !== "object") return {};
  const row = value as Record<string, unknown>;
  const result: PersonaKnowledge = {};
  if (
    typeof row.photo === "string" &&
    row.photo.length <= 200000 &&
    /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(row.photo)
  )
    result.photo = row.photo;
  if (typeof row.showBackground === "boolean") result.showBackground = row.showBackground;
  if (typeof row.showAvatar === "boolean") result.showAvatar = row.showAvatar;
  if (typeof row.voice === "string" && isFemaleVoice(row.voice)) result.voice = row.voice;
  if (typeof row.template === "string" && row.template.length <= PERSONA_TEMPLATE_LIMIT)
    result.template = row.template;
  if (Array.isArray(row.memories)) {
    const memories = row.memories.filter(
      (item): item is PersonaMemory =>
        !!item &&
        typeof item === "object" &&
        typeof item.source === "string" &&
        item.source.length <= 500 &&
        typeof item.content === "string" &&
        item.content.length <= 16000,
    );
    if (
      memories.length <= 60 &&
      memories.reduce((sum, item) => sum + item.content.length, 0) <= 60000
    )
      result.memories = memories;
  }
  return result;
}

export function personaInstructions(persona: { name: string; text: string } & PersonaKnowledge) {
  return [
    `페르소나 이름: ${persona.name}`,
    persona.text,
    persona.template,
    "일반 대화는 자연스러운 한국어를 우선한다. 외국인·외국어 사용 설정이 명시된 경우나 사용자가 번역·외국어를 요청한 경우에는 해당 설정을 따른다. 그 외에는 불필요한 영어 감탄사, 외국어 문장, 한자를 섞지 않고 한국어 표현으로 말한다. 고유명사와 필요한 기술 용어는 허용한다.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function memoryForQuestion(
  memories: PersonaMemory[] = [],
  question: string,
  budget = 12000,
) {
  const words = question.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  const terms = [
    ...new Set(
      words.flatMap((word) => [
        word,
        ...Array.from({ length: Math.max(0, word.length - 1) }, (_, i) => word.slice(i, i + 2)),
      ]),
    ),
  ].slice(0, 100);
  const blocks = memories.flatMap((item, sourceIndex) =>
    item.content
      .split(/\n\s*\n/)
      .filter(Boolean)
      .map((text, index) => ({
        text: `[${item.source}]\n${text}`,
        sourceIndex,
        index,
        score: terms.filter((term) => text.toLowerCase().includes(term)).length,
      })),
  );
  blocks.sort((a, b) => b.score - a.score || b.sourceIndex - a.sourceIndex || a.index - b.index);
  let context = "";
  for (const block of blocks) {
    if (context.length >= budget) break;
    context += `${context ? "\n\n" : ""}${block.text}`.slice(0, budget - context.length);
  }
  return context;
}
