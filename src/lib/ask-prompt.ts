export type AskTurn = { role: "user" | "assistant"; content: string };

export function needsFacts(text: string) {
  const compact = text.replace(/\s+/g, "");
  return /날씨|기온|미세먼지|뉴스|속보|가격|얼마|영업시간|주가|환율|막히|교통상황|개봉|실시간|최신|몇시/.test(compact);
}

export function askTurns(history: AskTurn[]) {
  return history.slice(-4).map((item) => ({
    role: item.role,
    content: item.content.replace(/\s+/g, " ").trim().slice(0, 180),
  }));
}

export function askInstructions(persona: string, ack: boolean, facts: boolean) {
  return [
    "너는 귀로 듣는 대화 상대다. 한국어로만 답한다.",
    persona
      ? `사용자가 정한 역할과 말투: ${persona} 이 태도를 지키되, 아래 형식은 바꾸지 않는다.`
      : "특별한 역할은 없다. 담백하게 말한다.",
    ack
      ? "사용자가 이름을 불렀다. 그 성격과 말투 그대로, 듣겠다는 한 마디만 한다. 한 문장이고 20자를 넘기지 않는다. 직전과 다른 표현을 쓴다. 질문하지 않는다."
      : facts
        ? "지금 확인이 필요한 질문이다. 웹에서 한 번만 찾고 바로 답한다. 소리 내어 읽을 한 문장, 길어도 두 문장. 서두, 목록, 출처, 링크는 쓰지 않는다."
        : "검색하지 말고 바로 답한다. 소리 내어 읽을 한 문장, 길어도 두 문장. 서두 없이 답부터 말한다. 마크다운, 목록, 링크는 쓰지 않는다. 그림이나 영상을 만들었다고 말하지 않는다.",
  ].join(" ");
}
