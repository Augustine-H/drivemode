import { t as createServerFn } from "./ssr.mjs";
import { t as createServerRpc } from "./createServerRpc-A6pJPYTF.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/stt-DUuVU95v.js
var MAX_AUDIO = 15e5;
function extFor(mime) {
	if (mime.includes("wav")) return "wav";
	if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "mp4";
	if (mime.includes("ogg") || mime.includes("opus")) return "ogg";
	if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
	return "webm";
}
var transcribeSpeech_createServerFn_handler = createServerRpc({
	id: "8cb4ddb8dedb81f4d06f02c0f7989521e25acb9e8584679d071ee07b0aa3d4f7",
	name: "transcribeSpeech",
	filename: "src/lib/stt.ts"
}, (opts) => transcribeSpeech.__executeServer(opts));
var transcribeSpeech = createServerFn({ method: "POST" }).validator((input) => {
	return {
		audio: String(input?.audio ?? "").replace(/^data:[^,]+,/, ""),
		mime: String(input?.mime ?? "audio/wav").split(";")[0].trim().slice(0, 40) || "audio/wav"
	};
}).handler(transcribeSpeech_createServerFn_handler, async ({ data }) => {
	if (!data.audio) return {
		ok: false,
		error: "녹음이 비어 있습니다."
	};
	if (data.audio.length > MAX_AUDIO) return {
		ok: false,
		error: "녹음이 너무 깁니다. 짧게 말해 주세요."
	};
	const apiKey = process.env.XAI_API_KEY;
	if (!apiKey) return {
		ok: false,
		error: "받아쓰기를 쓸 수 없습니다."
	};
	try {
		const bytes = Buffer.from(data.audio, "base64");
		if (bytes.length < 800) return {
			ok: false,
			error: "녹음이 너무 짧습니다."
		};
		const form = new FormData();
		form.append("model", "grok-voice-transcribe-2.0");
		form.append("language", "ko");
		form.append("format", "true");
		form.append("file", new Blob([bytes], { type: data.mime }), `speech.${extFor(data.mime)}`);
		const res = await fetch("https://api.x.ai/v1/stt", {
			method: "POST",
			headers: { Authorization: `Bearer ${apiKey}` },
			body: form
		});
		if (!res.ok) return {
			ok: false,
			error: "받아쓰기에 실패했습니다."
		};
		const body = await res.json();
		const text = String(body.text ?? "").replace(/\s+/g, " ").trim();
		if (!text) return {
			ok: false,
			error: "말을 알아듣지 못했습니다."
		};
		return {
			ok: true,
			text
		};
	} catch {
		return {
			ok: false,
			error: "받아쓰기에 연결하지 못했습니다."
		};
	}
});
//#endregion
export { transcribeSpeech_createServerFn_handler };
