//#region node_modules/.nitro/vite/services/ssr/assets/grok-import-C5YhvvpC.js
function shareIdFrom(input) {
	const text = input.trim();
	const found = text.match(/(?:grok\.com\/share\/|x\.com\/i\/grok\/share\/)([A-Za-z0-9_-]{8,180})/i);
	if (found) return found[1];
	if (/^[A-Za-z0-9_-]{8,180}$/.test(text)) return text;
	return null;
}
function cleanGrokMessage(raw) {
	return raw.replace(/<grok:render[\s\S]*?<\/grok:render>/gi, " ").replace(/<argument[\s\S]*?<\/argument>/gi, " ").replace(/!\[[^\]]*]\([^)]*\)/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_#>`]/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim().slice(0, 1800);
}
function roleOf(value) {
	const token = String(value ?? "").toLowerCase();
	if (!token) return null;
	if (token === "human" || token === "user" || token === "me") return "me";
	if (token.includes("assistant") || token.includes("grok") || token === "ai") return "grok";
	return null;
}
function timeOf(value) {
	if (typeof value === "string") {
		const at = Date.parse(value);
		return Number.isFinite(at) ? at : void 0;
	}
	if (value && typeof value === "object") {
		const date = value.$date?.$numberLong;
		const at = Number(date);
		return Number.isFinite(at) ? at : void 0;
	}
}
function imageOf(value) {
	if (!Array.isArray(value)) return void 0;
	const url = value.find((item) => typeof item === "string" && item.startsWith("https://"));
	return typeof url === "string" ? url : void 0;
}
function turnsFromList(list) {
	const turns = [];
	for (const item of list) {
		if (!item || typeof item !== "object") continue;
		const row = item;
		const inner = row.response && typeof row.response === "object" ? row.response : row;
		if (inner.isControl === true) continue;
		const speaker = roleOf(inner.sender ?? inner.role);
		const text = cleanGrokMessage(String(inner.message ?? inner.content ?? ""));
		if (!speaker || !text) continue;
		turns.push({
			id: `imp-${turns.length}`,
			speaker,
			text,
			image: imageOf(inner.generatedImageUrls ?? inner.generated_image_urls),
			at: timeOf(inner.createTime ?? inner.create_time)
		});
	}
	return turns.slice(-120);
}
function titleOf(value, fallback) {
	if (!value || typeof value !== "object") return fallback;
	const row = value;
	const conversation = row.conversation;
	const nested = conversation && typeof conversation === "object" ? conversation.title : "";
	return String(row.title ?? nested ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || fallback;
}
function chatsFromJson(data) {
	if (Array.isArray(data)) {
		const chats = data.map((item, index) => ({
			title: titleOf(item, `대화 ${index + 1}`),
			turns: turnsFromList(Array.isArray(item) ? item : responseList(item))
		})).filter((chat) => chat.turns.length > 0);
		if (chats.length > 0) return chats.slice(0, 40);
		const flat = turnsFromList(data);
		return flat.length ? [{
			title: "가져온 대화",
			turns: flat
		}] : [];
	}
	if (!data || typeof data !== "object") return [];
	const row = data;
	if (Array.isArray(row.conversations)) return chatsFromJson(row.conversations);
	const turns = turnsFromList(responseList(row));
	return turns.length ? [{
		title: titleOf(row, "가져온 대화"),
		turns
	}] : [];
}
function responseList(value) {
	if (!value || typeof value !== "object") return [];
	const list = value.responses;
	return Array.isArray(list) ? list : [];
}
function chatsFromShare(data) {
	return chatsFromJson(data)[0] ?? null;
}
//#endregion
export { chatsFromShare as n, shareIdFrom as r, chatsFromJson as t };
