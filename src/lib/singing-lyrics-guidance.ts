import type { SingingLanguage } from "./music-model";

/** Advisory starting point for foreign-language local singing, not a model limit. */
export function singingLyricsGuidance(lyrics: string, duration: number, language: SingingLanguage, provider: "local" | "elevenlabs") {
  const lines = lyrics.split(/\r?\n/u).map(line => line.replace(/\[[^\]]+\]/gu, "").trim()).filter(Boolean).length;
  if (provider !== "local" || language === "ko" || !Number.isFinite(duration) || duration < 10 || duration > 120) return undefined;
  const suggestedLines = Math.max(1, Math.floor(duration / 7.5));
  return { lines, suggestedLines, crowded: lines > suggestedLines,
    message: `가사 ${lines}줄 · ${duration}초는 ${suggestedLines}줄 안팎부터 시험해 보세요. 긴 줄은 더 짧게 나누세요.`,
    advice: language === "ja"
      ? "일본어는 길이가 맞아도 가사 누락·문구 변경이 생길 수 있습니다. 원곡의 가사를 먼저 확인하고 원어민 발음 검수도 별도로 진행하세요."
      : "짧은 곡에 가사가 많으면 일부 구절이 빠질 수 있습니다. 분량 안내는 정확한 가창을 보장하지 않습니다." };
}
