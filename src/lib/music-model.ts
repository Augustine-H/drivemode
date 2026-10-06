import { audioIntent } from "./audio-tools.ts";
import { isTranscriptionLanguage, type TranscriptionLanguage } from "./recognition-languages.ts";

export type MusicRequest = {
  requestId: string;
  prompt: string;
  duration: number;
  seed: number;
  bitrate: 320;
  kind?: "song" | "recognition";
  lyrics?: string;
  audioBase64?: string;
  identify?: boolean;
  transcribe?: boolean;
  transcriptionLanguage?: TranscriptionLanguage;
  fingerprintConsent?: boolean;
  fullFile?: boolean;
};
export type MusicRecord = { source: string; request: MusicRequest; jobId?: string; state?: string };
export type MusicArtifact = { bytes: number; sha256: string; filename: string };
export type MusicJob = {
  id: string;
  state: string;
  request: MusicRequest;
  artifacts: Partial<Record<"wav" | "mp3", MusicArtifact>>;
  error?: { type?: string; message?: string } | null;
  recognition?: RecognitionResult;
  progress?: RecognitionProgress;
  workerResult?: { error?: { message?: string } | null; recognition?: RecognitionResult; progress?: RecognitionProgress };
};
export type RecognitionProgress = { completedChunks: number; totalChunks: number; processedSeconds: number; totalSeconds: number };
export type RecognitionResult = {
  transcription?: string;
  transcriptionLanguage?: TranscriptionLanguage;
  titleMatch?: { title: string; artist: string } | null;
  identificationError?: string;
  warnings: string[];
  segments?: { startSeconds: number; endSeconds: number; text: string }[];
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
    r.duration <= (r.kind === "recognition" && r.fullFile === true && r.transcribe === true ? 600 : 120) &&
    Number.isInteger(r.seed) &&
    r.seed >= 0 &&
    r.seed <= 2147483647 &&
    r.bitrate === 320 &&
    (r.kind === undefined || r.kind === "song" || r.kind === "recognition") &&
    (r.kind !== "song" || (typeof r.lyrics === "string" && r.lyrics.trim().length > 0 && r.lyrics.length <= 8000 && r.duration >= 10)) &&
    (r.kind !== "recognition" || ((r.identify === true || r.transcribe === true) && r.duration <= (r.fullFile === true && r.transcribe === true ? 600 : 30) && (!r.identify || r.fingerprintConsent === true))) &&
    (r.fullFile === undefined || (typeof r.fullFile === "boolean" && r.kind === "recognition" && (!r.fullFile || r.transcribe === true))) &&
    (r.transcriptionLanguage === undefined || (r.kind === "recognition" && r.transcribe === true && isTranscriptionLanguage(r.transcriptionLanguage))) &&
    (v.jobId === undefined || /^[a-f0-9-]{36}$/.test(v.jobId)) &&
    (v.state === undefined ||
      [
        "QUEUED",
        "DISPATCHED",
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
      /(?:만들어|만들자|생성해|생성하|작곡해|작곡하|불러줘|불러봐)/.test(t) &&
      !/(?:만들수|만드는법|만드는방법|만들었|생성기능|생성방법)/.test(t)) ||
    /\b(?:create|generate|compose)\b.{0,60}\b(?:music|song|track)\b/i.test(text)
  );
}
export function wantsSongRecognition(text: string) {
  const t = text.replace(/\s+/g, "");
  if (/하지마|하지말|취소|중지/.test(t)) return false;
  return audioIntent(text) === "identify_music" ||
    /가사.*(?:받아써|받아쓰기|인식|글자로)/.test(t);
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
  if (vocal || /노래\s*불러/.test(text)) {
    const lyrics = text.match(/(?:가사|노랫말)\s*[:：]\s*([\s\S]+)$/)?.[1]?.trim();
    if (!lyrics) throw new Error("노래에 넣을 가사를 ‘가사:’ 뒤에 입력하거나 설정의 ‘보컬 노래 만들기’를 사용하세요.");
    return songRequest(text.slice(0, text.indexOf(lyrics)), lyrics, duration, requestId);
  }
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
export function songRequest(prompt: string, lyrics: string, duration: number, requestId: string): MusicRequest {
  if (!prompt.trim() || prompt.length > 2000 || !lyrics.trim() || lyrics.length > 8000)
    throw new Error("곡 설명은 2,000자, 가사는 8,000자 이내로 입력하세요.");
  if (!Number.isInteger(duration) || duration < 10 || duration > 120)
    throw new Error("보컬 노래는 10~120초로 만들 수 있습니다.");
  return { requestId, prompt: prompt.trim(), lyrics: lyrics.trim(), kind: "song", duration,
    seed: crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff, bitrate: 320 };
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
export const musicStateLabel = (state?: string, kind?: MusicRequest['kind']): string =>
  kind === "recognition" && state === "CANCELLED" ? "노래 인식 취소됨" :
  kind === "recognition" && state === "CANCEL_REQUESTED" ? "인식 취소 처리 중" :
  kind === "recognition" && state === "FAILED" ? "노래 인식 실패" :
  kind === "recognition" && state === "INTERRUPTED" ? "노래 인식 중단됨" :
  kind === "recognition" && state === "COMPLETED" ? "노래 인식 완료" :
  kind === "recognition" && state === "GENERATING" ? "노래 인식 중" :
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
