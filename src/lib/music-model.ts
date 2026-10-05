export type MusicRequest = {
  requestId: string;
  prompt: string;
  duration: number;
  seed: number;
  bitrate: 320;
};
export type MusicRecord = { source: string; request: MusicRequest; jobId?: string; state?: string };
export type MusicArtifact = { bytes: number; sha256: string; filename: string };
export type MusicJob = {
  id: string;
  state: string;
  request: MusicRequest;
  artifacts: Partial<Record<"wav" | "mp3", MusicArtifact>>;
  error?: { type?: string; message?: string } | null;
  workerResult?: { error?: { message?: string } | null };
};
export const musicTerminal = (state?: string) =>
  ["COMPLETED", "CANCELLED", "FAILED", "INTERRUPTED"].includes(state ?? "");
export function isMusicRecord(value: unknown): value is MusicRecord {
  if (!value || typeof value !== "object") return false;
  const v = value as MusicRecord;
  try {
    if (musicUrl(v.source) !== v.source) return false;
  } catch {
    return false;
  }
  const r = v.request;
  return (
    !!r &&
    typeof r.requestId === "string" &&
    /^[A-Za-z0-9_.:-]{1,100}$/.test(r.requestId) &&
    typeof r.prompt === "string" &&
    r.prompt.trim().length > 0 &&
    r.prompt.length <= 2000 &&
    Number.isInteger(r.duration) &&
    r.duration >= 1 &&
    r.duration <= 120 &&
    Number.isInteger(r.seed) &&
    r.seed >= 0 &&
    r.seed <= 2147483647 &&
    r.bitrate === 320 &&
    (v.jobId === undefined || /^[a-f0-9-]{36}$/.test(v.jobId)) &&
    (v.state === undefined ||
      [
        "QUEUED",
        "LOADING",
        "GENERATING",
        "VERIFYING_WAV",
        "ENCODING",
        "UPLOADING",
        "CANCEL_REQUESTED",
        "COMPLETED",
        "CANCELLED",
        "FAILED",
        "INTERRUPTED",
      ].includes(v.state))
  );
}
export function wantsMusic(text: string) {
  const t = text.replace(/\s+/g, "");
  return (
    (/(?:음악|노래|곡|배경음|BGM|bgm)/.test(t) &&
      /(?:만들어|만들자|생성해|생성하|작곡해|작곡하)/.test(t) &&
      !/(?:만들수|만드는법|만드는방법|만들었|생성기능|생성방법)/.test(t)) ||
    /\b(?:create|generate|compose)\b.{0,60}\b(?:music|song|track)\b/i.test(text)
  );
}
export function musicRequest(text: string, requestId: string): MusicRequest {
  const time = text.match(/(\d+(?:\.\d+)?)\s*(초|분|seconds?|minutes?)/i);
  const duration = time ? Number(time[1]) * (/분|minutes?/i.test(time[2]) ? 60 : 1) : 30;
  if (!Number.isInteger(duration) || duration < 1 || duration > 120)
    throw new Error("음악 길이는 1초부터 120초까지 지정해 주세요.");
  const hints = [
    [/재즈/, "jazz"],
    [/피아노/, "piano"],
    [/신스웨이브/, "synthwave"],
    [/로파이|로파이힙합/, "lo-fi"],
    [/잔잔|편안|휴식/, "gentle, relaxing"],
    [/신나|활기/, "energetic"],
    [/비오는|빗소리|비\s*오는/, "rainy atmosphere"],
    [/밤|야경/, "night atmosphere"],
    [/영화|웅장/, "cinematic"],
    [/기타/, "guitar"],
    [/전자|일렉트로닉/, "electronic"],
  ] as const;
  const matched = hints.filter(([pattern]) => pattern.test(text)).map(([, phrase]) => phrase);
  const vocal = /가사|보컬|노랫말/.test(text) && !/보컬\s*없|가사\s*없/.test(text);
  if (vocal) throw new Error("현재는 연주곡 생성만 지원합니다. 보컬·가사 없이 요청해 주세요.");
  const prompt = `Instrumental music, no vocals. ${matched.join(", ")}${matched.length ? ". " : ""}${text.trim()}`;
  if (prompt.length > 2000) throw new Error("음악 설명을 1,800자 이내로 줄여 주세요.");
  return {
    requestId,
    prompt,
    duration,
    seed: crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff,
    bitrate: 320,
  };
}
export function musicUrl(raw: string) {
  const u = new URL(raw.trim());
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/" ||
    !u.hostname.endsWith(".ts.net")
  )
    throw new Error("Tailscale NAS의 HTTPS 주소를 입력해 주세요. 주소에 키를 넣지 마세요.");
  return u.origin;
}
export const musicStateLabel = (state?: string): string =>
  (
    ({
      QUEUED: "생성 대기",
      LOADING: "모델 준비 중",
      GENERATING: "음악 생성 중",
      VERIFYING_WAV: "WAV 검증 중",
      ENCODING: "MP3 변환 중",
      UPLOADING: "NAS에 보관 중",
      CANCEL_REQUESTED: "취소 처리 중",
      COMPLETED: "음악 완성 · NAS 보관 완료",
      CANCELLED: "생성 취소됨",
      FAILED: "생성 실패",
      INTERRUPTED: "작업 중단됨",
    }) as Record<string, string>
  )[state ?? ""] ?? "요청 확인 중";
