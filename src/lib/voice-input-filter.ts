export const DEFAULT_ANNOUNCEMENTS = [
  "4G 모듈 업그레이드를 실패했습니다.",
  "4G 모듈 업그레이드를 성공했습니다.",
  "4G 모듈 업그레이드 중입니다.",
  "에이다스 보정을 시작합니다. 시속 40km 이상을 유지하세요.",
  "에이다스 보정을 실패하였습니다. 에이다스 휴대폰 설정에서 카메라 위치를 교정하세요.",
  "에이다스 보정이 완료되었습니다.",
  "카메라에 인사할 준비 하세요.",
  "장시간 운전중입니다. 휴식을 권장합니다.",
  "감시모드를 시작합니다.",
  "고온으로 인한 기기 손상 방지를 위해 블랙박스를 종료합니다.",
  "주차 시 배터리 부족으로 인해 블랙박스를 종료합니다.",
  "영상 녹화를 중지합니다.",
  "내장 스토리지를 포맷하세요.",
  "외부 전원이 없습니다. 블랙박스가 곧 종료됩니다.",
  "이 작업을 수행할 수 없습니다.",
  "비정상 파일이 감지되었습니다. 내장메모리를 포맷하세요.",
  "PC에 연결하여 녹화를 일시 중지합니다.",
  "내장메모리가 손상되어 블랙박스가 종료됩니다.",
  "내장메모리 오류가 발생했습니다. 블랙박스를 확인해 주세요.",
  "내장메모리에 파일이 너무 많습니다. 포맷해 주세요.",
  "내장메모리가 손상되어 읽기 및 쓰기 속도가 비정상입니다.",
  "업데이트가 완료되었습니다.",
  "안녕하세요 저는 max입니다. 앱을 이용해 기기와 연결하세요.",
  "고온이 감지되었습니다. 화면을 끄고 녹화를 계속합니다.",
];

export function normalizeVoiceText(text: string) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\s]/gu, "");
}

// Whole announcements (including separately recognized clauses) only. A question
// quoting an announcement must remain a question.
export function isAnnouncement(text: string, lines: string[]) {
  let remaining = normalizeVoiceText(text);
  if (!remaining) return false;
  const patterns = [...new Set(lines.flatMap((line) => [line, ...line.split(/[.!?。\n]/)]))]
    .map(normalizeVoiceText)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  while (remaining) {
    const match = patterns.find((pattern) => remaining.startsWith(pattern));
    if (!match) return false;
    remaining = remaining.slice(match.length);
  }
  return true;
}

export function startsWithPersonaName(text: string, names: string[]) {
  const words = text.normalize("NFKC").trim();
  return names.some((name) => {
    const key = name.replace(/\s/g, "");
    if (normalizeVoiceText(words) === normalizeVoiceText(key)) return true;
    return [key + "야", key + "아", key + "이"].some((form) => words.startsWith(form));
  });
}
