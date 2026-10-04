export function conversationEnded(text: string) {
  const compact = text.replace(/\s+/g, "");
  if (/안(끝|가|도착)|끝내지마|가지마|아직.*도착/.test(compact)) return false;
  return /대화(끝|종료|마치)|그만(얘기|대화)|잘자|잘가|안녕히|다음에(봐|보자)|이따(봐|보자)|나(는)?이만|(?:나|내가)(?:는)?(?:갈게|간다|가볼게|가야겠)|오늘은여기까지|도착했|도착이야|업로드해|백업해|저장해줘/.test(
    compact,
  );
}
export function deleteConversationCommand(text: string) {
  return /(?:대화|메시지|채팅).*(?:전부|전체|모두|다).*(?:삭제|지워)|(?:전부|전체|모두).*(?:대화|메시지|채팅).*(?:삭제|지워)/.test(
    text,
  );
}
export function relayCommand(text: string, personas: { id: string; name: string }[]) {
  for (const persona of personas) {
    const escaped = persona.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(
      new RegExp(
        `${escaped}(?:이)?(?:한테|에게)(?:는)?\\s*(.*?)\\s*(?:전해\\s*줘|전달해\\s*줘|알려\\s*줘|알려주라고|보내\\s*줘)[.!?]*$`,
      ),
    );
    if (match) return { id: persona.id, message: match[1] };
  }
  return null;
}
export function summaryFilename(name: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .format(date)
    .replace(" ", "_")
    .replace(/:/g, "-");
  return `${parts}_${Array.from(name, (char) => (char.charCodeAt(0) < 32 || char === "/" || char === "\\" ? "_" : char)).join("")}_summary.md`;
}
export async function conversationDigest(value: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
