export type Speaker = "me" | "grok";

export type Turn = {
  id: string;
  speaker: Speaker;
  text: string;
  speechParts?: string[];
  voiceText?: string;
  streaming?: boolean;
  image?: string;
  video?: string;
  at?: number;
  personaName?: string;
  personaId?: string;
  voice?: string;
  textOnly?: boolean;
  event?: "join" | "leave" | "relay";
  audience?: string[];
  mediaDescription?: string;
  mediaRef?: string;
  mediaIds?: string[];
  responseStatus?: "complete" | "partial" | "cancelled";
  relay?: {
    fromId: string;
    fromName: string;
    toId: string;
    toName: string;
    request: string;
    payload: string;
  };
};

export type ParseMode = "labeled" | "alternating" | "empty";

export type ParseResult = {
  turns: Turn[];
  mode: ParseMode;
};

const TOKEN = "나|저|사용자|user|you|me|human|그록|grok|assistant|ai";

const PREFIX = new RegExp(
  `^\\s*(?:[-*>]\\s*)?(?:\\*\\*)?(?:\\[|【)?(${TOKEN})(?:\\*\\*)?(?:\\]|】)?\\s*[:：]\\s*(.*)$`,
  "i",
);

const HEADER = new RegExp(
  `^\\s*(?:[-*>]\\s*)?(?:\\*\\*)?(?:\\[|【)?(${TOKEN})(?:\\*\\*)?(?:\\]|】)?\\s*[:：]?\\s*$`,
  "i",
);

export const SAMPLE_TURNS: Turn[] = [
  {
    id: "s1",
    speaker: "me",
    text: "그록이랑 나눈 대화를 운전하면서 듣고 싶어.",
  },
  {
    id: "s2",
    speaker: "grok",
    text: "채팅을 복사해서 붙여넣으면, 처음부터 끝까지 자동으로 읽어 줄게. 네 말과 내 말은 목소리를 나눠서 읽는다.",
  },
  {
    id: "s3",
    speaker: "me",
    text: "긴 답변은 어떻게 해?",
  },
  {
    id: "s4",
    speaker: "grok",
    text: "문장마다 끊어서 읽는다. 중간에 멈추거나, 이전·다음으로 건너뛰거나, 속도를 올려도 바로 따라온다.",
  },
  {
    id: "s5",
    speaker: "me",
    text: "충주 가는 길에 틀어 두면 좋겠다.",
  },
  {
    id: "s6",
    speaker: "grok",
    text: "재생만 켜 두고, 화면은 보지 마. 손은 핸들에. 듣고 싶은 자리만 톡 하면 그 문장부터 다시 이어 읽는다.",
  },
];

export function speakerLabel(speaker: Speaker): string {
  return speaker === "me" ? "나" : "그록";
}

export function toSpeaker(token: string): Speaker {
  const t = token.toLowerCase();
  if (t === "그록" || t === "grok" || t === "assistant" || t === "ai") return "grok";
  return "me";
}

function joinLines(lines: string[]): string {
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseTranscript(raw: string, idPrefix = "t"): ParseResult {
  const text = raw.replace(/^\uFEFF/, "").trim();
  if (!text) return { turns: [], mode: "empty" };

  type Draft = { speaker: Speaker; lines: string[] };
  const drafts: Draft[] = [];
  let current: Draft | null = null;
  let sawLabel = false;
  let fence = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("```")) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    if (!trimmed || trimmed === "---") {
      if (current && current.lines.length > 0 && current.lines[current.lines.length - 1] !== "") {
        current.lines.push("");
      }
      continue;
    }

    const prefixed = trimmed.match(PREFIX);
    if (prefixed) {
      sawLabel = true;
      current = { speaker: toSpeaker(prefixed[1]), lines: [] };
      drafts.push(current);
      if (prefixed[2]?.trim()) current.lines.push(prefixed[2].trim());
      continue;
    }

    const header = trimmed.match(HEADER);
    if (header) {
      sawLabel = true;
      current = { speaker: toSpeaker(header[1]), lines: [] };
      drafts.push(current);
      continue;
    }

    if (!current) {
      current = { speaker: "me", lines: [] };
      drafts.push(current);
    }
    current.lines.push(trimmed);
  }

  if (!sawLabel) {
    const paras = text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p && !p.startsWith("```"));
    if (paras.length === 0) return { turns: [], mode: "empty" };
    return {
      mode: "alternating",
      turns: paras.map((para, i) => ({
        id: `${idPrefix}-${i}`,
        speaker: i % 2 === 0 ? "me" : "grok",
        text: para.replace(/\n+/g, "\n").trim(),
      })),
    };
  }

  const turns = drafts
    .map((d, i) => ({
      id: `${idPrefix}-${i}`,
      speaker: d.speaker,
      text: joinLines(d.lines),
    }))
    .filter((t) => t.text.length > 0);

  if (turns.length === 0) return { turns: [], mode: "empty" };
  return { turns, mode: "labeled" };
}

function pushWrapped(out: string[], sentence: string, max: number) {
  const clean = sentence.trim();
  if (!clean) return;
  if (clean.length <= max) {
    out.push(clean);
    return;
  }
  const parts = clean.split(/(?<=[,，、;；])\s+|\s+/);
  let buf = "";
  const flush = () => {
    if (buf.trim()) out.push(buf.trim());
    buf = "";
  };
  for (const part of parts) {
    if (!part) continue;
    if (part.length > max) {
      flush();
      for (let i = 0; i < part.length; i += max) {
        out.push(part.slice(i, i + max));
      }
      continue;
    }
    const next = buf ? `${buf} ${part}` : part;
    if (next.length > max && buf) {
      flush();
      buf = part;
    } else {
      buf = next;
    }
  }
  flush();
}

/** Sentence-sized pieces so a long reply is not one huge request. */
export function chunkText(text: string, max = 220): string[] {
  const blocks = text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  for (const block of blocks) {
    const sentences = block.split(/(?<=[.!?。！？…])\s+/);
    for (const sentence of sentences) pushWrapped(chunks, sentence, max);
  }
  return chunks;
}

export function readingSeconds(turns: Turn[], rate: number): number {
  const chars = turns.reduce((n, t) => n + t.text.replace(/\s/g, "").length, 0);
  const perMinute = 340 * Math.max(0.5, rate);
  return Math.round((chars / perMinute) * 60);
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `약 ${Math.max(1, seconds)}초`;
  const minutes = Math.round(seconds / 60);
  return `약 ${minutes}분`;
}
