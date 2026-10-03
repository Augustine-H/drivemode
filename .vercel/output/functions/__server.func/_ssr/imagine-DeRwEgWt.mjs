import { t as createServerFn } from "./ssr.mjs";
import { t as createServerRpc } from "./createServerRpc-A6pJPYTF.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/imagine-DeRwEgWt.js
var MODELS = ["grok-imagine-image", "grok-imagine-image-2.0"];
function imageUrl(body) {
	if (!body || typeof body !== "object") return "";
	const data = body.data;
	const first = Array.isArray(data) ? data[0] : null;
	if (!first || typeof first !== "object") return "";
	const row = first;
	const url = row.file_output?.public_url ?? row.url;
	return typeof url === "string" && url.startsWith("https://") ? url : "";
}
async function requestImage(apiKey, model, prompt) {
	const res = await fetch("https://api.x.ai/v1/images/generations", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json"
		},
		body: JSON.stringify({
			model,
			prompt,
			n: 1,
			response_format: "url"
		})
	});
	if (res.ok) return {
		url: imageUrl(await res.json()),
		retry: false
	};
	return {
		url: "",
		retry: res.status === 400 || res.status === 404
	};
}
var imagineImage_createServerFn_handler = createServerRpc({
	id: "ea854149880a9d0894c243b6afdc9a7d55aa2bed090a410b7f1a24ce75803f14",
	name: "imagineImage",
	filename: "src/lib/imagine.ts"
}, (opts) => imagineImage.__executeServer(opts));
var imagineImage = createServerFn({ method: "POST" }).validator((input) => {
	return { prompt: String(input?.prompt ?? "").replace(/\s+/g, " ").trim().slice(0, 400) };
}).handler(imagineImage_createServerFn_handler, async ({ data }) => {
	if (!data.prompt) return {
		ok: false,
		error: "그릴 내용을 말해 주세요."
	};
	const apiKey = process.env.XAI_API_KEY;
	if (!apiKey) return {
		ok: false,
		error: "그림을 만들 수 없습니다."
	};
	try {
		for (const model of MODELS) {
			const result = await requestImage(apiKey, model, data.prompt);
			if (result.url) return {
				ok: true,
				url: result.url
			};
			if (!result.retry) break;
		}
		return {
			ok: false,
			error: "그림을 만들지 못했습니다."
		};
	} catch {
		return {
			ok: false,
			error: "그림 서버에 연결하지 못했습니다."
		};
	}
});
var VIDEO_MODELS = ["grok-imagine-video-1.5", "grok-imagine-video"];
function videoUrl(body) {
	if (!body || typeof body !== "object") return "";
	const data = body;
	const url = data.video?.url ?? data.url;
	return typeof url === "string" && url.startsWith("https://") ? url : "";
}
var startVideo_createServerFn_handler = createServerRpc({
	id: "0581cb62078eb00c1a447ab32302eba5d2b25f31a8d14b7f2a14e236584d517e",
	name: "startVideo",
	filename: "src/lib/imagine.ts"
}, (opts) => startVideo.__executeServer(opts));
var startVideo = createServerFn({ method: "POST" }).validator((input) => {
	return {
		prompt: String(input?.prompt ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
		seconds: Math.min(8, Math.max(2, Math.round(Number(input?.seconds) || 5))),
		image: typeof input?.image === "string" && input.image.startsWith("https://") ? input.image : ""
	};
}).handler(startVideo_createServerFn_handler, async ({ data }) => {
	if (!data.prompt) return {
		ok: false,
		error: "어떤 영상인지 말해 주세요."
	};
	const apiKey = process.env.XAI_API_KEY;
	if (!apiKey) return {
		ok: false,
		error: "영상을 만들 수 없습니다."
	};
	try {
		for (const model of VIDEO_MODELS) {
			const body = {
				model,
				prompt: data.prompt,
				duration: data.seconds
			};
			if (data.image) body.image = { url: data.image };
			const res = await fetch("https://api.x.ai/v1/videos/generations", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json"
				},
				body: JSON.stringify(body)
			});
			if (!res.ok) {
				if (res.status === 400 || res.status === 404) continue;
				return {
					ok: false,
					error: "영상을 시작하지 못했습니다."
				};
			}
			const payload = await res.json();
			if (typeof payload.request_id === "string" && payload.request_id) return {
				ok: true,
				id: payload.request_id
			};
		}
		return {
			ok: false,
			error: "영상을 시작하지 못했습니다."
		};
	} catch {
		return {
			ok: false,
			error: "영상 서버에 연결하지 못했습니다."
		};
	}
});
var videoStatus_createServerFn_handler = createServerRpc({
	id: "3fb8646c4a0304b951eb449ea0459e0f4f04e562633185a38e74d5d840c9a263",
	name: "videoStatus",
	filename: "src/lib/imagine.ts"
}, (opts) => videoStatus.__executeServer(opts));
var videoStatus = createServerFn({ method: "POST" }).validator((input) => {
	return { id: String(input?.id ?? "").trim().slice(0, 80) };
}).handler(videoStatus_createServerFn_handler, async ({ data }) => {
	if (!/^[A-Za-z0-9_-]+$/.test(data.id)) return {
		ok: false,
		error: "영상 요청을 찾지 못했습니다."
	};
	const apiKey = process.env.XAI_API_KEY;
	if (!apiKey) return {
		ok: false,
		error: "영상을 만들 수 없습니다."
	};
	try {
		const res = await fetch(`https://api.x.ai/v1/videos/${data.id}`, { headers: { Authorization: `Bearer ${apiKey}` } });
		if (res.status === 202) return {
			ok: true,
			pending: true
		};
		if (!res.ok) return {
			ok: false,
			error: "영상을 확인하지 못했습니다."
		};
		const body = await res.json();
		if (body.status === "pending") return {
			ok: true,
			pending: true
		};
		if (body.status === "failed" || body.status === "expired") return {
			ok: false,
			error: "영상을 만들지 못했습니다."
		};
		const url = videoUrl(body);
		if (body.status === "done" && url) return {
			ok: true,
			pending: false,
			url
		};
		if (body.status === "done") return {
			ok: false,
			error: "영상 주소를 받지 못했습니다."
		};
		return {
			ok: true,
			pending: true
		};
	} catch {
		return {
			ok: false,
			error: "영상 서버에 연결하지 못했습니다."
		};
	}
});
//#endregion
export { imagineImage_createServerFn_handler, startVideo_createServerFn_handler, videoStatus_createServerFn_handler };
