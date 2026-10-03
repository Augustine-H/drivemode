import { createServerFn } from "@tanstack/react-start";
import { chatsFromShare, shareIdFrom } from "@/lib/grok-import";

export type ShareResult =
  | { ok: true; title: string; turns: { id: string; speaker: "me" | "grok"; text: string; image?: string; at?: number }[] }
  | { ok: false; error: string };

export const importGrokShare = createServerFn({ method: "POST" })
  .validator((input: { url?: string }) => ({ url: String(input?.url ?? "").trim().slice(0, 300) }))
  .handler(async ({ data }): Promise<ShareResult> => {
    const id = shareIdFrom(data.url);
    if (!id) return { ok: false, error: "그록 공유 주소가 아닙니다. grok.com/share/… 를 붙여넣으세요." };
    try {
      const res = await fetch(`https://grok.com/rest/app-chat/share_links/${id}`, {
        headers: { Accept: "application/json" },
        redirect: "manual",
        signal: AbortSignal.timeout(12000),
      });
      if (res.status !== 200) return { ok: false, error: "이 주소의 대화를 열지 못했습니다. 공유가 켜져 있는지 확인하세요." };
      const chat = chatsFromShare(await res.json());
      if (!chat || chat.turns.length === 0) return { ok: false, error: "그 대화에서 읽을 문장을 찾지 못했습니다." };
      return { ok: true, title: chat.title, turns: chat.turns };
    } catch {
      return { ok: false, error: "그록 대화에 연결하지 못했습니다." };
    }
  });
