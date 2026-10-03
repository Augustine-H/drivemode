import { t as createServerFn } from "./ssr.mjs";
import { t as createServerRpc } from "./createServerRpc-A6pJPYTF.mjs";
import { t as API_VOICES } from "./voices-ITPt4BIX.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/tts-DSa0BV3U.js
function clampSpeed(value) {
	const n = Number(value);
	if (!Number.isFinite(n)) return 1;
	return Math.min(1.5, Math.max(.7, Math.round(n * 100) / 100));
}
var speakLine_createServerFn_handler = createServerRpc({
	id: "4038b0731bad3df9ecd1584ffa5c7d2f8b0b0553062e8aaf612c5a0d4f449a57",
	name: "speakLine",
	filename: "src/lib/tts.ts"
}, (opts) => speakLine.__executeServer(opts));
var speakLine = createServerFn({ method: "POST" }).validator((input) => {
	return {
		text: String(input?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 500),
		voiceId: API_VOICES.has(String(input?.voiceId)) ? String(input.voiceId) : "ara",
		speed: clampSpeed(input?.speed)
	};
}).handler(speakLine_createServerFn_handler, async ({ data }) => {
	if (!data.text) return {
		ok: false,
		error: "읽을 문장이 없습니다."
	};
	const apiKey = process.env.XAI_API_KEY;
	if (!apiKey) return {
		ok: false,
		error: "음성 기능을 쓸 수 없습니다."
	};
	try {
		const res = await fetch("https://api.x.ai/v1/tts", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				text: data.text,
				voice_id: data.voiceId,
				language: "ko",
				speed: data.speed
			})
		});
		if (!res.ok) return {
			ok: false,
			error: "음성을 만들지 못했습니다."
		};
		const bytes = new Uint8Array(await res.arrayBuffer());
		if (bytes.byteLength < 64 || bytes.byteLength > 15e5) return {
			ok: false,
			error: "음성이 비어 있거나 너무 깁니다."
		};
		let binary = "";
		const step = 8192;
		for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, i + step));
		return {
			ok: true,
			audio: btoa(binary)
		};
	} catch {
		return {
			ok: false,
			error: "음성 서버에 연결하지 못했습니다."
		};
	}
});
//#endregion
export { speakLine_createServerFn_handler };
