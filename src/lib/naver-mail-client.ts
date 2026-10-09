import { networkConfigured, networkFetch, networkBase } from "./network.ts";
import { GOOGLE_APP_ORIGIN, GOOGLE_BACKEND_ORIGIN } from "./google-workspace-contract.ts";
import { confirmWorkspace } from "./google-workspace-client.ts";
import {
  naverIntent,
  NAVER_SELECTION,
  MAIL_PROVIDER,
  NAVER_DRAFT_EVENT,
  type NaverMailItem,
} from "./naver-mail-contract.ts";

export async function naverRequest(
  action: string,
  params: Record<string, string> = {},
  body?: unknown,
  signal?: AbortSignal,
) {
  const base =
    !networkConfigured() && window.location.origin === GOOGLE_APP_ORIGIN
      ? GOOGLE_BACKEND_ORIGIN
      : "";
  let credentialTarget = "";
  if (action === "connect") {
    const target = new URL(
      networkConfigured()
        ? (await networkBase()) || window.location.origin
        : base || window.location.origin,
    );
    if (
      target.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
    )
      throw Error("네이버 연결 정보는 HTTPS 서버에서만 입력할 수 있습니다.");
    credentialTarget = target.origin;
  }
  const path = `/api/naver-mail?${new URLSearchParams({ action, ...params })}`,
    init: RequestInit = {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(90000)])
        : AbortSignal.timeout(90000),
    };
  try {
    const response = await (credentialTarget
      ? fetch(credentialTarget + path, init)
      : networkConfigured()
        ? networkFetch(path, init)
        : fetch(base + path, init));
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "네이버 요청을 완료하지 못했습니다.");
    return data;
  } catch (e) {
    if (e instanceof TypeError)
      throw Error("메일 서버에 연결하지 못했습니다. 서버 연결 상태를 확인하세요.");
    throw e;
  }
}
export async function downloadNaverAttachment(id: string, index: number, signal?: AbortSignal) {
  const file = await naverRequest("attachment", { id, index: String(index) }, undefined, signal);
  if (signal?.aborted) return;
  const bytes = Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function selectNaverContext(items: Pick<NaverMailItem, "id" | "subject" | "from">[]) {
  try {
    sessionStorage.setItem(
      NAVER_SELECTION,
      JSON.stringify({
        savedAt: Date.now(),
        items: items
          .slice(0, 20)
          .map((item) => ({
            id: item.id,
            subject: item.subject.slice(0, 500),
            from: item.from.slice(0, 500),
          })),
      }),
    );
    sessionStorage.setItem(MAIL_PROVIDER, "naver");
  } catch {
    /* Per-tab selection is optional. */
  }
}
export async function naverConversation(
  message: string,
  signal?: AbortSignal,
): Promise<string | null> {
  let context: Pick<NaverMailItem, "id" | "subject" | "from">[] = [],
    selected = false;
  try {
    selected = sessionStorage.getItem(MAIL_PROVIDER) === "naver";
    const saved = JSON.parse(sessionStorage.getItem(NAVER_SELECTION) || "null");
    if (saved && Date.now() - saved.savedAt < 3600000 && Array.isArray(saved.items))
      context = saved.items;
  } catch {
    /* No selection. */
  }
  if (!naverIntent(message, selected)) return null;
  try {
    const data = await naverRequest("chat", {}, { message, context }, signal);
    if (data.context) selectNaverContext(data.context);
    if (data.draft) {
      sessionStorage.setItem(MAIL_PROVIDER, "naver");
      window.dispatchEvent(new CustomEvent(NAVER_DRAFT_EVENT, { detail: data.draft }));
    }
    if (data.proposal) {
      if (!(await confirmWorkspace(data.proposal, signal)))
        return "네이버 메일 작업을 취소했습니다.";
      const result = await naverRequest("execute", {}, { id: data.proposal.id }, signal);
      window.dispatchEvent(new Event(`${NAVER_DRAFT_EVENT}-refresh`));
      return result.text;
    }
    return data.text || "네이버 메일 응답을 확인하세요.";
  } catch (e) {
    return e instanceof Error ? e.message : "네이버 메일 요청을 완료하지 못했습니다.";
  }
}
