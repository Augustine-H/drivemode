import { t as createServerFn } from "./ssr.mjs";
import { t as createServerRpc } from "./createServerRpc-A6pJPYTF.mjs";
import { n as askTurns, r as needsFacts, t as askInstructions } from "./ask-prompt-WPE00JC-.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/ask-grok-Dyj7Ezgy.js
function spoken(text) {
	return text.replace(/```[\s\S]*?```/g, " ").replace(/!\[[^\]]*]\([^)]*\)/g, " ").replace(/\[[^\]]*]\([^)]*\)/g, " ").replace(/[#>*_`[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 700);
}
function answerText(body) {
	if (!body || typeof body !== "object") return "";
	const data = body;
	if (typeof data.output_text === "string") return data.output_text;
	if (typeof data.output === "string") return data.output;
	if (!Array.isArray(data.output)) return "";
	const parts = [];
	for (const item of data.output) {
		if (!item || typeof item !== "object") continue;
		const message = item;
		if (message.type !== "message" || !Array.isArray(message.content)) continue;
		for (const part of message.content) if (part && typeof part === "object" && typeof part.text === "string") parts.push(part.text);
	}
	return parts.join(" ");
}
var askGrok_createServerFn_handler = createServerRpc({
	id: "c934df3e526f3570e1a7f17300945b14fae992187bb6e4db2e6e1e69bcb3fd24",
	name: "askGrok",
	filename: "src/lib/ask-grok.ts"
}, (opts) => askGrok.__executeServer(opts));
var askGrok = createServerFn({ method: "POST" }).validator((input) => {
	const message = String(input?.message ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
	const history = Array.isArray(input?.history) ? input.history.map((item) => ({
		role: item?.role === "assistant" ? "assistant" : "user",
		content: String(item?.content ?? "")
	})) : [];
	const persona = String(input?.persona ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
	return {
		message,
		history: askTurns(history.filter((item) => item.content.trim())),
		persona,
		ack: input?.ack === true
	};
}).handler(askGrok_createServerFn_handler, async ({ data }) => {
	if (!data.message) return {
		ok: false,
		error: "물어볼 말이 없습니다."
	};
	const apiKey = process.env.XAI_API_KEY;
	if (!apiKey) return {
		ok: false,
		error: "그록에게 물어볼 수 없습니다."
	};
	const facts = !data.ack && needsFacts(data.message);
	try {
		const res = await fetch("https://api.x.ai/v1/responses", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json"
			},
			signal: AbortSignal.timeout(2e4),
			body: JSON.stringify({
				model: "grok-4.5",
				max_output_tokens: data.ack ? 40 : facts ? 140 : 90,
				...facts ? {
					max_tool_calls: 1,
					tools: [{ type: "web_search" }]
				} : {},
				input: [
					{
						role: "system",
						content: askInstructions(data.persona, data.ack, facts)
					},
					...data.ack ? [] : data.history.map((item) => ({
						role: item.role,
						content: item.content
					})),
					{
						role: "user",
						content: data.message
					}
				]
			})
		});
		if (!res.ok) return {
			ok: false,
			error: "그록이 대답하지 못했습니다."
		};
		const text = spoken(answerText(await res.json()));
		if (!text) return {
			ok: false,
			error: "그록이 빈 답을 보냈습니다."
		};
		return {
			ok: true,
			text
		};
	} catch {
		return {
			ok: false,
			error: "그록에게 연결하지 못했습니다."
		};
	}
});
//#endregion
export { askGrok_createServerFn_handler };
