import { GOOGLE_APP_ORIGIN, GOOGLE_BACKEND_ORIGIN } from "./google-workspace-contract.ts";
import {
  naverMailIntent,
  NAVER_MAIL_NOTICE,
  type NaverMailReply,
  type NaverMailRef,
} from "./naver-mail-contract.ts";

let selection: NaverMailRef[] = [];
let selectedAt = 0;
export function clearNaverMailSelection() {
  selection = [];
  selectedAt = 0;
}
export function isNaverMailRequest(message: string) {
  if (Date.now() - selectedAt > 15 * 60_000) clearNaverMailSelection();
  return naverMailIntent(message, selection.length > 0);
}
// Only in-memory references. No storage, account passwords or MCP tokens here.
export async function naverMailConversation(
  message: string,
  persona: string,
  signal?: AbortSignal,
): Promise<NaverMailReply> {
  const base =
    typeof window !== "undefined" && window.location.origin === GOOGLE_APP_ORIGIN
      ? GOOGLE_BACKEND_ORIGIN
      : "";
  try {
    const response = await fetch(`${base}/api/naver-mail`, {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, persona, selection }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(90_000)])
        : AbortSignal.timeout(90_000),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        typeof data.error === "string" ? data.error : "네이버 메일 요청을 완료하지 못했습니다.",
      );
    if (
      typeof data.text !== "string" ||
      typeof data.voiceText !== "string" ||
      !Array.isArray(data.items)
    )
      throw new Error("네이버 메일 응답을 확인하지 못했습니다.");
    selection = data.items
      .slice(0, 20)
      .map((row: NaverMailRef) => ({
        folder: row.folder,
        uid: row.uid,
        uidvalidity: row.uidvalidity,
        from: row.from,
        subject: row.subject,
        date: row.date,
      }));
    selectedAt = Date.now();
    return data as NaverMailReply;
  } catch (error) {
    if (signal?.aborted) throw error;
    const text = error instanceof Error ? error.message : "네이버 메일 서버에 연결하지 못했습니다.";
    return { text, voiceText: text, items: [], notice: NAVER_MAIL_NOTICE };
  }
}
