export const recognitionLanguages = [
  ["ko", "한국어"], ["auto", "자동 감지"], ["en", "영어"], ["ja", "일본어"],
  ["zh", "중국어"], ["yue", "광둥어"], ["es", "스페인어"], ["fr", "프랑스어"],
  ["de", "독일어"], ["it", "이탈리아어"], ["pt", "포르투갈어"], ["ar", "아랍어"],
  ["ru", "러시아어"], ["th", "태국어"], ["vi", "베트남어"], ["tr", "튀르키예어"],
  ["hi", "힌디어"], ["ms", "말레이어"], ["id", "인도네시아어"], ["nl", "네덜란드어"],
  ["sv", "스웨덴어"], ["da", "덴마크어"], ["fi", "핀란드어"], ["pl", "폴란드어"],
  ["cs", "체코어"], ["fil", "필리핀어"], ["fa", "페르시아어"], ["el", "그리스어"],
  ["hu", "헝가리어"], ["mk", "마케도니아어"], ["ro", "루마니아어"],
] as const;
export type TranscriptionLanguage = (typeof recognitionLanguages)[number][0];
export const isTranscriptionLanguage = (value: unknown): value is TranscriptionLanguage =>
  recognitionLanguages.some(([code]) => code === value);
