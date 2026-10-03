export const VOICE_OPTIONS = [
  { id: "leo", name: "레오", gender: "male" },
  { id: "rex", name: "렉스", gender: "male" },
  { id: "sal", name: "살", gender: "male" },
  { id: "gork", name: "고크", gender: "male" },
  { id: "altair", name: "알타이르", gender: "male" },
  { id: "atlas", name: "아틀라스", gender: "male" },
  { id: "castor", name: "카스토르", gender: "male" },
  { id: "cosmo", name: "코스모", gender: "male" },
  { id: "helios", name: "헬리오스", gender: "male" },
  { id: "helix", name: "헬릭스", gender: "male" },
  { id: "kepler", name: "케플러", gender: "male" },
  { id: "lumen", name: "루멘", gender: "male" },
  { id: "lux", name: "럭스", gender: "male" },
  { id: "naksh", name: "낙슈", gender: "male" },
  { id: "orion", name: "오리온", gender: "male" },
  { id: "perseus", name: "페르세우스", gender: "male" },
  { id: "rigel", name: "리겔", gender: "male" },
  { id: "sirius", name: "시리우스", gender: "male" },
  { id: "zagan", name: "자간", gender: "male" },
  { id: "zenith", name: "제니스", gender: "male" },
  { id: "ara", name: "아라", gender: "female" },
  { id: "eve", name: "이브", gender: "female" },
  { id: "luna", name: "루나", gender: "female" },
  { id: "aurora", name: "오로라", gender: "female" },
  { id: "carina", name: "카리나", gender: "female" },
  { id: "celeste", name: "셀레스트", gender: "female" },
  { id: "iris", name: "아이리스", gender: "female" },
  { id: "liora", name: "리오라", gender: "female" },
  { id: "ursa", name: "우르사", gender: "female" },
  { id: "device", name: "휴대폰 음성", gender: "device" },
] as const;

export type VoiceId = (typeof VOICE_OPTIONS)[number]["id"];

const IDS = new Set<string>(VOICE_OPTIONS.map((v) => v.id));

export function isKnownVoice(id: string): id is VoiceId {
  return IDS.has(id);
}

export const MALE_VOICES = VOICE_OPTIONS.filter((v) => v.gender === "male" || v.gender === "device");
export const FEMALE_VOICES = VOICE_OPTIONS.filter((v) => v.gender === "female");

export function isMaleVoice(id: string) {
  return MALE_VOICES.some((v) => v.id === id);
}

export function isFemaleVoice(id: string) {
  return FEMALE_VOICES.some((v) => v.id === id);
}

export const API_VOICES = new Set<string>(
  VOICE_OPTIONS.filter((v) => v.id !== "device").map((v) => v.id),
);
