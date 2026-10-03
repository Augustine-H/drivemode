import type { Turn } from "./transcript";

export type GrokbotBackup = { bot: string; date: string; source: string; turns: Turn[] };

export function parseGrokbotBackup(value: unknown): GrokbotBackup | null {
  if (!value || typeof value !== "object" || !("bot" in value) || !("messages" in value))
    return null;
  const row = value as Record<string, unknown>;
  if (typeof row.bot !== "string" || !row.bot.trim() || row.bot.length > 16)
    throw new Error("봇 이름을 확인하세요.");
  if (!Array.isArray(row.messages) || row.messages.length === 0 || row.messages.length > 2000)
    throw new Error("봇 백업은 대화 1~2000개를 지원합니다.");
  if (row.channel !== "1:1") throw new Error("현재 봇 백업 가져오기는 1:1 대화만 지원합니다.");
  if (row.timezone !== "Asia/Seoul") throw new Error("봇 백업의 시간대는 Asia/Seoul이어야 합니다.");
  if (typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date))
    throw new Error("백업 날짜를 확인하세요.");
  const day = new Date(`${row.date}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== row.date)
    throw new Error("백업 날짜를 확인하세요.");
  if (row.message_count !== row.messages.length)
    throw new Error("백업의 대화 개수와 실제 내용이 다릅니다.");
  const bot = row.bot.trim();
  const source = `grokbot:${encodeURIComponent(bot)}:${row.date}:`;
  const turns = row.messages.map((item: unknown, index: number): Turn => {
    if (!item || typeof item !== "object") throw new Error("대화 항목을 확인하세요.");
    const message = item as Record<string, unknown>;
    const speaker =
      message.speaker === bot
        ? "grok"
        : message.speaker === "만학님" || message.speaker === "user" || message.speaker === "사용자"
          ? "me"
          : null;
    if (!speaker) throw new Error("알 수 없는 화자가 있습니다. 화자 이름을 확인하세요.");
    if (typeof message.text !== "string" || !message.text.trim() || message.text.length > 100000)
      throw new Error("대화 본문을 확인하세요.");
    if (
      typeof message.time !== "string" ||
      !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(message.time)
    )
      throw new Error("대화 시간을 확인하세요.");
    return {
      id: `${source}${index}`,
      speaker,
      text: message.text,
      at: Date.parse(
        `${row.date}T${message.time.length === 5 ? `${message.time}:00` : message.time}+09:00`,
      ),
    };
  });
  return { bot, date: row.date, source, turns };
}

export function mergeGrokbotBackup(current: Turn[], backup: GrokbotBackup) {
  const kept = current.filter((turn) => !turn.id.startsWith(backup.source));
  if (kept.length + backup.turns.length > 2000)
    throw new Error("페르소나의 대화가 2000개를 넘습니다. 기존 대화를 백업한 뒤 정리하세요.");
  return [...kept, ...backup.turns].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
}

export function grokbotPersonaId(bot: string) {
  return `grokbot-${encodeURIComponent(bot)}`;
}
