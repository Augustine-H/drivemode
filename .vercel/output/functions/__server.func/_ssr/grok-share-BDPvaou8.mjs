import { t as createServerFn } from "./ssr.mjs";
import { t as createServerRpc } from "./createServerRpc-A6pJPYTF.mjs";
import { n as chatsFromShare, r as shareIdFrom } from "./grok-import-C5YhvvpC.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/grok-share-BDPvaou8.js
var importGrokShare_createServerFn_handler = createServerRpc({
	id: "a660085dcbc6dc5782103ea67733def18b6a512f35216caa3e3f9e0eec1fe4e1",
	name: "importGrokShare",
	filename: "src/lib/grok-share.ts"
}, (opts) => importGrokShare.__executeServer(opts));
var importGrokShare = createServerFn({ method: "POST" }).validator((input) => ({ url: String(input?.url ?? "").trim().slice(0, 300) })).handler(importGrokShare_createServerFn_handler, async ({ data }) => {
	const id = shareIdFrom(data.url);
	if (!id) return {
		ok: false,
		error: "그록 공유 주소가 아닙니다. grok.com/share/… 를 붙여넣으세요."
	};
	try {
		const res = await fetch(`https://grok.com/rest/app-chat/share_links/${id}`, {
			headers: { Accept: "application/json" },
			redirect: "manual",
			signal: AbortSignal.timeout(12e3)
		});
		if (res.status !== 200) return {
			ok: false,
			error: "이 주소의 대화를 열지 못했습니다. 공유가 켜져 있는지 확인하세요."
		};
		const chat = chatsFromShare(await res.json());
		if (!chat || chat.turns.length === 0) return {
			ok: false,
			error: "그 대화에서 읽을 문장을 찾지 못했습니다."
		};
		return {
			ok: true,
			title: chat.title,
			turns: chat.turns
		};
	} catch {
		return {
			ok: false,
			error: "그록 대화에 연결하지 못했습니다."
		};
	}
});
//#endregion
export { importGrokShare_createServerFn_handler };
