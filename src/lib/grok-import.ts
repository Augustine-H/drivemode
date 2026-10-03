import type { Turn } from "@/lib/transcript";

export type ImportedChat = { title: string; turns: Turn[] };

export function shareIdFrom(input: string) {
  const text = input.trim();
  const found = text.match(/(?:grok\.com\/share\/|x\.com\/i\/grok\/share\/)([A-Za-z0-9_-]{8,180})/i);
  if (found) return found[1];
  if (/^[A-Za-z0-9_-]{8,180}$/.test(text)) return text;
  return null;
}

export function cleanGrokMessage(raw: string) {
  return raw
    .replace(/<grok:render[\s\S]*?<\/grok:render>/gi, " ")
    .replace(/<argument[\s\S]*?<\/argument>/gi, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_#>`]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, 1800);
}

function roleOf(value: unknown): Turn["speaker"] | null {
  const token = String(value ?? "").toLowerCase();
  if (!token) return null;
  if (token === "human" || token === "user" || token === "me") return "me";
  if (token.includes("assistant") || token.includes("grok") || token === "ai") return "grok";
  return null;
}

function timeOf(value: unknown) {
  if (typeof value === "string") {
    const at = Date.parse(value);
    return Number.isFinite(at) ? at : undefined;
  }
  if (value && typeof value === "object") {
    const date = (value as { $date?: { $numberLong?: string } }).$date?.$numberLong;
    const at = Number(date);
    return Number.isFinite(at) ? at : undefined;
  }
  return undefined;
}

function imageOf(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const url = value.find((item) => typeof item === "string" && item.startsWith("https://"));
  return typeof url === "string" ? url : undefined;
}

function turnsFromList(list: unknown[]) {
  const turns: Turn[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const inner =
      row.response && typeof row.response === "object" ? (row.response as Record<string, unknown>) : row;
    if (inner.isControl === true) continue;
    const speaker = roleOf(inner.sender ?? inner.role);
    const text = cleanGrokMessage(String(inner.message ?? inner.content ?? ""));
    if (!speaker || !text) continue;
    turns.push({
      id: `imp-${turns.length}`,
      speaker,
      text,
      image: imageOf(inner.generatedImageUrls ?? inner.generated_image_urls),
      at: timeOf(inner.createTime ?? inner.create_time),
    });
  }
  return turns.slice(-120);
}

function titleOf(value: unknown, fallback: string) {
  if (!value || typeof value !== "object") return fallback;
  const row = value as Record<string, unknown>;
  const conversation = row.conversation;
  const nested = conversation && typeof conversation === "object" ? (conversation as Record<string, unknown>).title : "";
  const title = String(row.title ?? nested ?? "").replace(/\s+/g, " ").trim();
  return title.slice(0, 80) || fallback;
}

export function chatsFromJson(data: unknown): ImportedChat[] {
  if (Array.isArray(data)) {
    const chats = data
      .map((item, index) => ({
        title: titleOf(item, `대화 ${index + 1}`),
        turns: turnsFromList(Array.isArray(item) ? item : responseList(item)),
      }))
      .filter((chat) => chat.turns.length > 0);
    if (chats.length > 0) return chats.slice(0, 40);
    const flat = turnsFromList(data);
    return flat.length ? [{ title: "가져온 대화", turns: flat }] : [];
  }
  if (!data || typeof data !== "object") return [];
  const row = data as Record<string, unknown>;
  if (Array.isArray(row.conversations)) return chatsFromJson(row.conversations);
  const turns = turnsFromList(responseList(row));
  return turns.length ? [{ title: titleOf(row, "가져온 대화"), turns }] : [];
}

function responseList(value: unknown) {
  if (!value || typeof value !== "object") return [];
  const list = (value as { responses?: unknown }).responses;
  return Array.isArray(list) ? list : [];
}

export function chatsFromShare(data: unknown): ImportedChat | null {
  const chats = chatsFromJson(data);
  return chats[0] ?? null;
}
