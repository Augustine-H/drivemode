export const audioToolNames = [
  "listen_recent_audio",
  "identify_music",
  "describe_sound",
  "transcribe_audio",
] as const;
export type AudioToolName = (typeof audioToolNames)[number];
export function audioIntent(text: string): AudioToolName | null {
  const t = text.replace(/\s+/g, "");
  if (/하지마|하지말|취소|중지|말고/.test(t)) return null;
  if (
    /(소리|음성|말|오디오).*(받아써|받아쓰기|글자로|변환|뭐라고|무슨말)/.test(t) ||
    /방금.*뭐라고(했|말)/.test(t)
  )
    return "transcribe_audio";
  if (/언제나왔|언제나온|발매|가수.*누구|아티스트.*누구/.test(t)) return null;
  if (
    /(지금|방금|나오는|들리는|흐르는|듣고있는|재생|이).*(노래|음악|곡).*(뭐|알려|찾|식별|인식|제목)/.test(
      t,
    ) ||
    /(노래|음악|곡).*(찾아줘|식별해|인식해)/.test(t) ||
    /(지금|방금|이).*(무슨|어떤).*(노래|곡|음악)/.test(t)
  )
    return "identify_music";
  if (
    /(방금|지금|주변|들린|들리는|PC|컴퓨터|시스템).*(소리|소음|음량|박자|오디오).*(뭐|어떤|알려|설명|분석|들어)/i.test(
      t,
    ) ||
    /무슨소리(야|였|지|인지)/.test(t) ||
    /(소리|음악|노래|곡).*(음량|박자|템포).*(분석|알려)/.test(t)
  )
    return "describe_sound";
  if (/최근(소리|오디오).*(기억|확인|있어)/.test(t)) return "listen_recent_audio";
  return null;
}
export const audioToolSchemas = audioToolNames.map((name) => ({
  type: "function",
  name,
  description: {
    listen_recent_audio: "Check available local recent audio buffers without uploading audio.",
    identify_music:
      "Identify the currently playing song using music fingerprints, never guess titles.",
    describe_sound: "Classify recent environmental sounds locally, not speech transcription.",
    transcribe_audio: "Transcribe recent spoken words only when explicitly requested.",
  }[name],
  parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
}));
export type SoundScore = { label: string; score: number };
export const soundLabels: Record<string, string> = {
  "A siren is sounding.": "사이렌",
  "A car horn is honking.": "경적",
  "A dog is barking.": "개 짖는 소리",
  "A door slams shut.": "문 닫는 소리",
  "A crash or collision is heard.": "충돌음",
  "Glass is breaking.": "유리 깨지는 소리",
  "Birds are chirping.": "새소리",
  "An alarm is ringing.": "알람",
  "Music is playing.": "음악",
  "A person is speaking.": "사람의 말소리",
  "An engine is running.": "엔진",
  "Wind or background noise is heard.": "바람·배경 소음",
  "Water is flowing.": "물소리",
  "There is silence.": "정적",
};
export function soundDescription(scores: SoundScore[]) {
  const sorted = [...scores]
    .filter((s) => Number.isFinite(s.score))
    .sort((a, b) => b.score - a.score);
  const best = sorted[0],
    next = sorted[1];
  if (!best || best.score < 0.35 || (next && best.score - next.score < 0.12))
    return `소리를 확실히 구분하지 못했다. 후보: ${sorted
      .slice(0, 2)
      .map((s) => soundLabels[s.label] ?? s.label)
      .join(", ")}. 상대 점수는 확률이 아니다.`;
  return `${soundLabels[best.label] ?? best.label}일 가능성이 있다. 로컬 모델 추정이며 확정이 아니다. 음악이면 곡명은 지문 인식 없이는 알 수 없다.`;
}
