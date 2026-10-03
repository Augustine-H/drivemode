import { i as __toESM } from "../_runtime.mjs";
import { b as require_jsx_runtime, q as require_react } from "../_libs/@tanstack/react-router+[...].mjs";
import { n as TSS_SERVER_FUNCTION, r as getServerFnById, t as createServerFn } from "./ssr.mjs";
import { n as askTurns } from "./ask-prompt-WPE00JC-.mjs";
import { t as chatsFromJson } from "./grok-import-C5YhvvpC.mjs";
import { a as SkipForward, c as RotateCcw, d as Mic, f as FileUp, h as ArrowLeftRight, i as SlidersHorizontal, l as Play, m as ClipboardPaste, o as SkipBack, p as Download, r as Trash2, s as Share2, t as X, u as Pause } from "../_libs/lucide-react.mjs";
import { n as APP_NAME, r as APP_VERSION } from "./router-BWszR-TE.mjs";
import { a as isMaleVoice, i as isFemaleVoice, n as FEMALE_VOICES, r as MALE_VOICES, t as API_VOICES } from "./voices-ITPt4BIX.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-CClVPEPC.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var createSsrRpc = (functionId) => {
	const url = "/_serverFn/" + functionId;
	const serverFnMeta = { id: functionId };
	const fn = async (...args) => {
		return (await getServerFnById(functionId, { origin: "server" }))(...args);
	};
	return Object.assign(fn, {
		url,
		serverFnMeta,
		[TSS_SERVER_FUNCTION]: true
	});
};
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
}).handler(createSsrRpc("c934df3e526f3570e1a7f17300945b14fae992187bb6e4db2e6e1e69bcb3fd24"));
async function streamAsk(input, onText) {
	const res = await fetch("/api/ask", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "text/event-stream"
		},
		body: JSON.stringify(input)
	});
	if (!res.ok || !res.body) return {
		ok: false,
		error: "그록이 대답하지 못했습니다."
	};
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buf = "";
	let text = "";
	while (true) {
		const step = await reader.read();
		if (step.done) break;
		buf += decoder.decode(step.value, { stream: true });
		const chunks = buf.split("\n\n");
		buf = chunks.pop() ?? "";
		for (const chunk of chunks) {
			const line = chunk.split("\n").map((row) => row.trim()).find((row) => row.startsWith("data:"));
			if (!line) continue;
			let event;
			try {
				event = JSON.parse(line.slice(5).trim());
			} catch {
				continue;
			}
			if (typeof event.error === "string" && event.error) return {
				ok: false,
				error: event.error
			};
			if (typeof event.text === "string" && event.text.trim()) {
				text = event.text.trim();
				onText(text);
			}
		}
	}
	if (!text) return {
		ok: false,
		error: "그록이 빈 답을 보냈습니다."
	};
	return {
		ok: true,
		text
	};
}
function isTurn$1(value) {
	if (!value || typeof value !== "object") return false;
	const turn = value;
	return (turn.speaker === "me" || turn.speaker === "grok") && typeof turn.text === "string" && typeof turn.id === "string" && (turn.image === void 0 || typeof turn.image === "string" && turn.image.startsWith("https://")) && (turn.video === void 0 || typeof turn.video === "string" && turn.video.startsWith("https://")) && (turn.at === void 0 || typeof turn.at === "number" && Number.isFinite(turn.at));
}
function isPersona$1(value) {
	if (!value || typeof value !== "object") return false;
	const item = value;
	return typeof item.id === "string" && item.id.length > 0 && typeof item.name === "string" && item.name.trim().length > 0 && typeof item.text === "string" && typeof item.password === "string" && typeof item.locked === "boolean";
}
function buildBackup(input) {
	return {
		app: "nangdok",
		version: 1,
		exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
		personaId: input.personaId,
		personas: input.personas.map((item) => ({ ...item })),
		threads: Object.fromEntries(Object.entries(input.threads).map(([key, turns]) => [key, turns.map((turn) => ({ ...turn }))]))
	};
}
function parseNangdokBackup(value) {
	if (!value || typeof value !== "object") return null;
	const row = value;
	if (row.app !== "nangdok" || row.version !== 1 || !Array.isArray(row.personas)) return null;
	const personas = row.personas.filter(isPersona$1).slice(0, 12).map((item) => ({
		...item,
		name: item.name.trim().slice(0, 16),
		text: item.text.slice(0, 240),
		password: item.password.slice(0, 32)
	}));
	if (personas.length === 0) return null;
	const threads = {};
	if (row.threads && typeof row.threads === "object") for (const [key, list] of Object.entries(row.threads)) {
		if (!Array.isArray(list)) continue;
		threads[key] = list.filter(isTurn$1).slice(-2e3);
	}
	const personaId = personas.some((item) => item.id === row.personaId) ? String(row.personaId) : personas[0].id;
	return {
		app: "nangdok",
		version: 1,
		exportedAt: typeof row.exportedAt === "string" ? row.exportedAt : (/* @__PURE__ */ new Date()).toISOString(),
		personaId,
		personas,
		threads
	};
}
/** Puts a backup file in a folder the person picked, or hands it to the phone share sheet. */
var DB_NAME = "voice-grok-dest";
var STORE = "handles";
var KEY = "dir";
function backupFileName(exportedAt) {
	return `voice-grok-${exportedAt.slice(0, 16).replace(/[:T]/g, "-") || "backup"}.json`;
}
function pickerWindow() {
	return window;
}
function openDb() {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1);
		request.onupgradeneeded = () => {
			request.result.createObjectStore(STORE);
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}
async function readHandle() {
	if (typeof indexedDB === "undefined") return null;
	try {
		const db = await openDb();
		const handle = await new Promise((resolve, reject) => {
			const request = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
			request.onsuccess = () => resolve(request.result ?? null);
			request.onerror = () => reject(request.error);
		});
		db.close();
		return handle;
	} catch {
		return null;
	}
}
async function writeHandle(handle) {
	const db = await openDb();
	await new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, "readwrite");
		tx.objectStore(STORE).put(handle, KEY);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
	db.close();
}
async function clearHandle() {
	if (typeof indexedDB === "undefined") return;
	try {
		const db = await openDb();
		await new Promise((resolve, reject) => {
			const tx = db.transaction(STORE, "readwrite");
			tx.objectStore(STORE).delete(KEY);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
		db.close();
	} catch {}
}
async function cloudFolderName() {
	return (await readHandle())?.name ?? null;
}
async function allowed(dir) {
	const descriptor = { mode: "readwrite" };
	try {
		if (dir.queryPermission) {
			if (await dir.queryPermission(descriptor) === "granted") return true;
		}
		if (dir.requestPermission) return await dir.requestPermission(descriptor) === "granted";
		return true;
	} catch {
		return false;
	}
}
async function writeNamed(dir, name, json) {
	const stream = await (await dir.getFileHandle(name, { create: true })).createWritable();
	try {
		await stream.write(json);
		await stream.close();
	} catch (error) {
		await stream.abort().catch(() => void 0);
		throw error;
	}
}
function cancelled(error) {
	return error instanceof DOMException && error.name === "AbortError";
}
async function shareFile(json, name) {
	if (!navigator.share) return "no";
	for (const type of ["text/plain", "application/json"]) {
		const file = new File([json], name, { type });
		if (navigator.canShare && !navigator.canShare({ files: [file] })) continue;
		try {
			await navigator.share({
				files: [file],
				title: name
			});
			return "shared";
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError") return "cancel";
		}
	}
	return "no";
}
async function pickFolder(name, json) {
	const pick = pickerWindow().showDirectoryPicker;
	if (!pick) return null;
	try {
		const dir = await pick({
			mode: "readwrite",
			id: "voice-grok"
		});
		try {
			await writeNamed(dir, name, json);
		} catch {
			return {
				ok: false,
				reason: "failed"
			};
		}
		try {
			await writeHandle(dir);
		} catch {}
		return {
			ok: true,
			where: dir.name,
			via: "folder",
			fresh: true
		};
	} catch (error) {
		if (cancelled(error)) return {
			ok: false,
			reason: "cancel"
		};
		if (error instanceof DOMException && error.name === "SecurityError") return {
			ok: false,
			reason: "preview"
		};
		return {
			ok: false,
			reason: "blocked"
		};
	}
}
async function pickFile(name, json) {
	const pick = pickerWindow().showSaveFilePicker;
	if (!pick) return null;
	try {
		const file = await pick({
			suggestedName: name,
			id: "voice-grok-file",
			types: [{
				description: "대화 파일",
				accept: { "application/json": [".json"] }
			}]
		});
		const stream = await file.createWritable();
		try {
			await stream.write(json);
			await stream.close();
		} catch (error) {
			await stream.abort().catch(() => void 0);
			throw error;
		}
		return {
			ok: true,
			where: file.name,
			via: "file",
			fresh: true
		};
	} catch (error) {
		if (cancelled(error)) return {
			ok: false,
			reason: "cancel"
		};
		if (error instanceof DOMException && error.name === "SecurityError") return {
			ok: false,
			reason: "preview"
		};
		return null;
	}
}
async function placeInCloud(json, name, retarget) {
	if (window.parent !== window) return {
		ok: false,
		reason: "preview"
	};
	if (!retarget) {
		const saved = await readHandle();
		if (saved && await allowed(saved)) try {
			await writeNamed(saved, name, json);
			return {
				ok: true,
				where: saved.name,
				via: "folder",
				fresh: false
			};
		} catch {
			await clearHandle();
		}
	}
	if (!Boolean(pickerWindow().showDirectoryPicker)) {
		const shared = await shareFile(json, name);
		if (shared === "shared") return {
			ok: true,
			where: "",
			via: "share",
			fresh: false
		};
		if (shared === "cancel") return {
			ok: false,
			reason: "cancel"
		};
	}
	const folder = await pickFolder(name, json);
	if (folder) return folder;
	const shared = await shareFile(json, name);
	if (shared === "shared") return {
		ok: true,
		where: "",
		via: "share",
		fresh: false
	};
	if (shared === "cancel") return {
		ok: false,
		reason: "cancel"
	};
	const file = await pickFile(name, json);
	if (file) return file;
	return {
		ok: false,
		reason: "blocked"
	};
}
var importGrokShare = createServerFn({ method: "POST" }).validator((input) => ({ url: String(input?.url ?? "").trim().slice(0, 300) })).handler(createSsrRpc("a660085dcbc6dc5782103ea67733def18b6a512f35216caa3e3f9e0eec1fe4e1"));
var imagineImage = createServerFn({ method: "POST" }).validator((input) => {
	return { prompt: String(input?.prompt ?? "").replace(/\s+/g, " ").trim().slice(0, 400) };
}).handler(createSsrRpc("ea854149880a9d0894c243b6afdc9a7d55aa2bed090a410b7f1a24ce75803f14"));
var startVideo = createServerFn({ method: "POST" }).validator((input) => {
	return {
		prompt: String(input?.prompt ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
		seconds: Math.min(8, Math.max(2, Math.round(Number(input?.seconds) || 5))),
		image: typeof input?.image === "string" && input.image.startsWith("https://") ? input.image : ""
	};
}).handler(createSsrRpc("0581cb62078eb00c1a447ab32302eba5d2b25f31a8d14b7f2a14e236584d517e"));
var videoStatus = createServerFn({ method: "POST" }).validator((input) => {
	return { id: String(input?.id ?? "").trim().slice(0, 80) };
}).handler(createSsrRpc("3fb8646c4a0304b951eb449ea0459e0f4f04e562633185a38e74d5d840c9a263"));
function clampSpeed(value) {
	const n = Number(value);
	if (!Number.isFinite(n)) return 1;
	return Math.min(1.5, Math.max(.7, Math.round(n * 100) / 100));
}
var speakLine = createServerFn({ method: "POST" }).validator((input) => {
	return {
		text: String(input?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 500),
		voiceId: API_VOICES.has(String(input?.voiceId)) ? String(input.voiceId) : "ara",
		speed: clampSpeed(input?.speed)
	};
}).handler(createSsrRpc("4038b0731bad3df9ecd1584ffa5c7d2f8b0b0553062e8aaf612c5a0d4f449a57"));
var transcribeSpeech = createServerFn({ method: "POST" }).validator((input) => {
	return {
		audio: String(input?.audio ?? "").replace(/^data:[^,]+,/, ""),
		mime: String(input?.mime ?? "audio/wav").split(";")[0].trim().slice(0, 40) || "audio/wav"
	};
}).handler(createSsrRpc("8cb4ddb8dedb81f4d06f02c0f7989521e25acb9e8584679d071ee07b0aa3d4f7"));
function mergeUtterance(previous, incoming) {
	const prev = previous.replace(/\s+/g, " ").trim();
	const next = incoming.replace(/\s+/g, " ").trim();
	if (!prev) return next;
	if (!next) return prev;
	if (next.startsWith(prev)) return next;
	if (prev.startsWith(next)) return prev;
	const limit = Math.min(prev.length, next.length);
	for (let size = limit; size >= 2; size -= 1) if (prev.slice(-size) === next.slice(0, size)) return `${prev}${next.slice(size)}`;
	return `${prev} ${next}`;
}
function collapseStutter(text) {
	let out = text.replace(/\s+/g, " ").trim();
	let prev = "";
	while (out !== prev) {
		prev = out;
		out = out.replace(/([가-힣]{2,8})\1+/g, "$1");
	}
	return out;
}
function sessionTranscript(event) {
	let finals = "";
	let interim = "";
	for (let i = 0; i < event.results.length; i += 1) {
		const row = event.results[i];
		const piece = (row?.[0]?.transcript ?? "").replace(/\s+/g, " ").trim();
		if (!piece) continue;
		if (row?.isFinal) {
			finals = mergeUtterance(finals, piece);
			interim = "";
		} else interim = piece;
	}
	return collapseStutter(mergeUtterance(finals, interim));
}
function recognitionCtor$1() {
	if (typeof window === "undefined") return null;
	const w = window;
	return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
function micMessage(err) {
	const name = err instanceof DOMException ? err.name : "";
	if (name === "NotAllowedError" || name === "PermissionDeniedError") return "마이크 권한을 허용해 주세요. 주소창의 자물쇠에서 마이크를 켜 주세요.";
	if (name === "NotFoundError" || name === "OverconstrainedError") return "마이크를 찾지 못했습니다.";
	if (name === "NotReadableError") return "마이크를 다른 앱이 쓰고 있습니다.";
	if (name === "SecurityError") return "이 화면에서는 마이크가 막혀 있습니다.";
	return "마이크를 켜지 못했습니다.";
}
function pickMime() {
	const types = [
		"audio/webm;codecs=opus",
		"audio/webm",
		"audio/mp4",
		"audio/ogg;codecs=opus"
	];
	if (typeof MediaRecorder === "undefined") return "";
	return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}
function rmsOf(analyser, buf) {
	analyser.getByteTimeDomainData(buf);
	let sum = 0;
	for (let i = 0; i < buf.length; i += 1) {
		const v = (buf[i] - 128) / 128;
		sum += v * v;
	}
	return Math.sqrt(sum / buf.length);
}
function encodeWav(buffer) {
	const src = buffer.getChannelData(0);
	const rate = 16e3;
	const step = buffer.sampleRate / rate;
	const length = Math.max(1, Math.floor(src.length / step));
	const header = 44;
	const out = /* @__PURE__ */ new ArrayBuffer(header + length * 2);
	const view = new DataView(out);
	const write = (offset, text) => {
		for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
	};
	write(0, "RIFF");
	view.setUint32(4, 36 + length * 2, true);
	write(8, "WAVE");
	write(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, rate, true);
	view.setUint32(28, rate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	write(36, "data");
	view.setUint32(40, length * 2, true);
	for (let i = 0; i < length; i += 1) {
		const sample = Math.max(-1, Math.min(1, src[Math.floor(i * step)] ?? 0));
		view.setInt16(header + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
	}
	return out;
}
function bytesToBase64(bytes) {
	let binary = "";
	const size = 8192;
	for (let i = 0; i < bytes.length; i += size) binary += String.fromCharCode(...bytes.subarray(i, i + size));
	return btoa(binary);
}
async function blobToWavBase64(blob) {
	const ctx = new AudioContext();
	try {
		const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
		return {
			audio: bytesToBase64(new Uint8Array(encodeWav(audio))),
			mime: "audio/wav"
		};
	} finally {
		ctx.close();
	}
}
function stopRecorder(item) {
	return new Promise((resolve) => {
		item.recorder.onstop = () => {
			resolve(new Blob(item.chunks, { type: item.recorder.mimeType || "audio/webm" }));
		};
		if (item.recorder.state === "inactive") {
			resolve(new Blob(item.chunks, { type: item.recorder.mimeType || "audio/webm" }));
			return;
		}
		item.recorder.stop();
	});
}
function useDictation({ paused, silenceMs, autoSend, onText, onUtterance, onError }) {
	const [armed, setArmed] = (0, import_react.useState)(false);
	const [hearing, setHearing] = (0, import_react.useState)(false);
	const [note, setNote] = (0, import_react.useState)("");
	const [blocked, setBlocked] = (0, import_react.useState)(false);
	const wanted = (0, import_react.useRef)(false);
	const pausedRef = (0, import_react.useRef)(paused);
	const busy = (0, import_react.useRef)(false);
	const starting = (0, import_react.useRef)(false);
	const session = (0, import_react.useRef)(0);
	const live = (0, import_react.useRef)(null);
	const recRef = (0, import_react.useRef)(null);
	const speechText = (0, import_react.useRef)("");
	const bufferRef = (0, import_react.useRef)("");
	const sendTimer = (0, import_react.useRef)(0);
	const genRef = (0, import_react.useRef)(0);
	const modeRef = (0, import_react.useRef)("speech");
	const callbacks = (0, import_react.useRef)({
		silenceMs,
		autoSend,
		onText,
		onUtterance,
		onError
	});
	pausedRef.current = paused;
	callbacks.current = {
		silenceMs,
		autoSend,
		onText,
		onUtterance,
		onError
	};
	const clearSend = () => {
		window.clearTimeout(sendTimer.current);
		sendTimer.current = 0;
	};
	const scheduleSend = () => {
		clearSend();
		if (!callbacks.current.autoSend) return;
		sendTimer.current = window.setTimeout(() => {
			sendTimer.current = 0;
			const said = bufferRef.current.trim();
			if (!said || !wanted.current) return;
			genRef.current += 1;
			bufferRef.current = "";
			speechText.current = "";
			closeSpeech();
			setHearing(false);
			setNote(said);
			callbacks.current.onUtterance(said);
		}, callbacks.current.silenceMs);
	};
	const disarm = (message = "") => {
		wanted.current = false;
		clearSend();
		genRef.current += 1;
		bufferRef.current = "";
		speechText.current = "";
		setArmed(false);
		setHearing(false);
		setNote(message);
		setBlocked(Boolean(message));
		if (message) callbacks.current.onError(message);
	};
	const closeSpeech = () => {
		const rec = recRef.current;
		recRef.current = null;
		if (!rec) return;
		rec.onresult = null;
		rec.onerror = null;
		rec.onend = null;
		try {
			rec.abort();
		} catch {}
	};
	const startSpeech = () => {
		closeSpeech();
		const Ctor = recognitionCtor$1();
		if (!Ctor) return false;
		const rec = new Ctor();
		rec.lang = "ko-KR";
		rec.continuous = true;
		rec.interimResults = true;
		const carried = bufferRef.current;
		const gen = ++genRef.current;
		rec.onresult = (event) => {
			if (gen !== genRef.current) return;
			const incoming = sessionTranscript(event);
			if (!incoming) return;
			const text = collapseStutter(mergeUtterance(carried, incoming));
			if (!text || text === bufferRef.current) {
				if (text && !sendTimer.current) scheduleSend();
				return;
			}
			bufferRef.current = text;
			speechText.current = text;
			callbacks.current.onText(text);
			setNote(text);
			scheduleSend();
		};
		rec.onerror = (event) => {
			const code = event.error ?? "";
			if (code === "no-speech" || code === "aborted") return;
			closeSpeech();
			if (typeof navigator !== "undefined" && navigator.mediaDevices && modeRef.current !== "record") {
				modeRef.current = "record";
				setNote("마이크 권한을 요청합니다");
				begin();
				return;
			}
			disarm(code === "not-allowed" || code === "service-not-allowed" ? "미리보기에서 마이크가 막혔습니다. 아래 음성 파일로 받아쓸 수 있습니다." : "음성 받아쓰기에 연결하지 못했습니다.");
		};
		rec.onend = () => {
			if (recRef.current !== rec) return;
			recRef.current = null;
			if (gen !== genRef.current) return;
			if (!wanted.current || pausedRef.current || modeRef.current !== "speech") return;
			window.setTimeout(() => {
				if (!wanted.current || pausedRef.current || recRef.current || gen !== genRef.current) return;
				startSpeech();
			}, 200);
		};
		try {
			rec.start();
		} catch {
			return false;
		}
		recRef.current = rec;
		modeRef.current = "speech";
		setHearing(true);
		setNote(callbacks.current.autoSend ? "듣는 중. 말이 끊기면 그록이 답합니다." : "듣는 중. 끝나면 마이크를 다시 누르세요.");
		return true;
	};
	const release = (item) => {
		window.clearInterval(item.timer);
		item.stream.getTracks().forEach((track) => track.stop());
		item.ctx.close().catch(() => {});
		if (live.current === item) live.current = null;
	};
	const finish = async (item, commit, send) => {
		if (item.done) return;
		item.done = true;
		window.clearInterval(item.timer);
		const blob = await stopRecorder(item);
		release(item);
		if (!commit || !item.heard || blob.size < 400) {
			setHearing(false);
			if (commit && wanted.current) setNote("목소리가 들리지 않았습니다. 마이크를 가까이 해 주세요.");
			if (!wanted.current) setNote("");
			return;
		}
		busy.current = true;
		setHearing(false);
		setNote("받아쓰는 중");
		try {
			let audio = "";
			let mime = "audio/wav";
			try {
				const wav = await blobToWavBase64(blob);
				audio = wav.audio;
				mime = wav.mime;
			} catch {
				audio = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
				mime = (blob.type || "audio/webm").split(";")[0];
			}
			const result = await transcribeSpeech({ data: {
				audio,
				mime
			} });
			if (!result.ok) {
				setNote(result.error);
				callbacks.current.onError(result.error);
				return;
			}
			callbacks.current.onText(result.text);
			setNote(result.text);
			if (send) callbacks.current.onUtterance(result.text);
		} finally {
			busy.current = false;
			setHearing(false);
		}
	};
	const begin = async () => {
		if (starting.current || live.current) return;
		const id = session.current;
		starting.current = true;
		if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
			starting.current = false;
			disarm("이 브라우저는 마이크 받아쓰기를 지원하지 않아요.");
			return;
		}
		let stream;
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: {
				echoCancellation: true,
				noiseSuppression: true
			} });
		} catch (err) {
			starting.current = false;
			if (session.current !== id) return;
			disarm(micMessage(err));
			return;
		}
		if (!wanted.current || pausedRef.current || session.current !== id) {
			starting.current = false;
			stream.getTracks().forEach((track) => track.stop());
			setHearing(false);
			return;
		}
		const mime = pickMime();
		let recorder;
		try {
			recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
		} catch {
			starting.current = false;
			stream.getTracks().forEach((track) => track.stop());
			disarm("이 브라우저에서는 녹음을 시작하지 못했습니다.");
			return;
		}
		const ctx = new AudioContext();
		ctx.resume();
		const source = ctx.createMediaStreamSource(stream);
		const analyser = ctx.createAnalyser();
		analyser.fftSize = 1024;
		source.connect(analyser);
		const buf = new Uint8Array(analyser.fftSize);
		const item = {
			id,
			stream,
			ctx,
			recorder,
			chunks: [],
			heard: false,
			quietSince: 0,
			started: Date.now(),
			timer: 0,
			done: false
		};
		recorder.ondataavailable = (event) => {
			if (event.data.size) item.chunks.push(event.data);
		};
		live.current = item;
		starting.current = false;
		recorder.start();
		setHearing(true);
		setNote(callbacks.current.autoSend ? "듣는 중. 말이 끊기면 그록이 답합니다." : "듣는 중. 끝나면 마이크를 다시 누르세요.");
		item.timer = window.setInterval(() => {
			if (item.done) return;
			const level = rmsOf(analyser, buf);
			const now = Date.now();
			const tooLong = now - item.started > 15e3;
			if (level > .02) {
				item.heard = true;
				item.quietSince = now;
				if (!tooLong) return;
			}
			if (!item.heard) return;
			const quietFor = now - (item.quietSince || now);
			if (tooLong || callbacks.current.autoSend && quietFor >= callbacks.current.silenceMs) {
				if (!callbacks.current.autoSend) {
					wanted.current = false;
					setArmed(false);
				}
				finish(item, true, callbacks.current.autoSend);
			}
		}, 100);
	};
	const arm = () => {
		if (wanted.current) return;
		session.current += 1;
		wanted.current = true;
		setBlocked(false);
		setArmed(true);
		modeRef.current = recognitionCtor$1() ? "speech" : "record";
		setNote("말하기를 켭니다");
	};
	const stop = () => {
		session.current += 1;
		const item = live.current;
		wanted.current = false;
		clearSend();
		genRef.current += 1;
		bufferRef.current = "";
		closeSpeech();
		setArmed(false);
		setHearing(false);
		setNote("");
		speechText.current = "";
		if (item) finish(item, false, false);
	};
	const fromFile = async (file) => {
		busy.current = true;
		setBlocked(false);
		setNote("받아쓰는 중");
		try {
			let audio = "";
			let mime = "audio/wav";
			try {
				const wav = await blobToWavBase64(file);
				audio = wav.audio;
				mime = wav.mime;
			} catch {
				audio = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
				mime = (file.type || "audio/webm").split(";")[0];
			}
			const result = await transcribeSpeech({ data: {
				audio,
				mime
			} });
			if (!result.ok) {
				setNote(result.error);
				setBlocked(true);
				callbacks.current.onError(result.error);
				return;
			}
			callbacks.current.onText(result.text);
			setNote(result.text);
			if (callbacks.current.autoSend) callbacks.current.onUtterance(result.text);
		} finally {
			busy.current = false;
		}
	};
	const toggle = () => {
		const item = live.current;
		if (wanted.current && (recRef.current || item || busy.current || bufferRef.current.trim())) {
			const said = (speechText.current || bufferRef.current).trim();
			const send = Boolean(said) || Boolean(item?.heard);
			session.current += 1;
			wanted.current = false;
			clearSend();
			genRef.current += 1;
			bufferRef.current = "";
			closeSpeech();
			setArmed(false);
			setHearing(false);
			speechText.current = "";
			if (said) {
				callbacks.current.onText(said);
				setNote(said);
				if (callbacks.current.autoSend) callbacks.current.onUtterance(said);
			} else if (item) {
				finish(item, send, send && callbacks.current.autoSend);
				setNote(send ? "받아쓰는 중" : "");
			} else setNote("");
			return;
		}
		if (pausedRef.current) {
			setNote("그록이 말하는 동안에는 마이크가 기다립니다.");
			setArmed(true);
			wanted.current = true;
			modeRef.current = recognitionCtor$1() ? "speech" : "record";
			return;
		}
		session.current += 1;
		wanted.current = true;
		clearSend();
		bufferRef.current = "";
		speechText.current = "";
		setBlocked(false);
		setArmed(true);
		setHearing(true);
		setNote("마이크를 켜는 중");
		if (recognitionCtor$1() && startSpeech()) return;
		if (!navigator.mediaDevices?.getUserMedia) {
			disarm("이 브라우저에서는 마이크를 쓸 수 없습니다. 음성 파일을 올려 주세요.");
			return;
		}
		modeRef.current = "record";
		begin();
	};
	(0, import_react.useEffect)(() => {
		if (!wanted.current) return;
		if (paused) {
			const item = live.current;
			closeSpeech();
			if (item && !item.done) finish(item, false, false);
			setHearing(false);
			return;
		}
		if (modeRef.current === "speech" && recognitionCtor$1()) {
			if (!recRef.current && !busy.current) startSpeech();
			return;
		}
		if (!live.current && !busy.current) begin();
	}, [paused]);
	(0, import_react.useEffect)(() => () => {
		session.current += 1;
		closeSpeech();
		const item = live.current;
		if (!item) return;
		item.done = true;
		release(item);
	}, []);
	return {
		armed,
		hearing,
		note,
		blocked,
		toggle,
		stop,
		fromFile,
		arm
	};
}
var TOKEN = "나|저|사용자|user|you|me|human|그록|grok|assistant|ai";
var PREFIX = new RegExp(`^\\s*(?:[-*>]\\s*)?(?:\\*\\*)?(?:\\[|【)?(${TOKEN})(?:\\*\\*)?(?:\\]|】)?\\s*[:：]\\s*(.*)$`, "i");
var HEADER = new RegExp(`^\\s*(?:[-*>]\\s*)?(?:\\*\\*)?(?:\\[|【)?(${TOKEN})(?:\\*\\*)?(?:\\]|】)?\\s*[:：]?\\s*$`, "i");
var SAMPLE_TURNS = [
	{
		id: "s1",
		speaker: "me",
		text: "그록이랑 나눈 대화를 운전하면서 듣고 싶어."
	},
	{
		id: "s2",
		speaker: "grok",
		text: "채팅을 복사해서 붙여넣으면, 처음부터 끝까지 자동으로 읽어 줄게. 네 말과 내 말은 목소리를 나눠서 읽는다."
	},
	{
		id: "s3",
		speaker: "me",
		text: "긴 답변은 어떻게 해?"
	},
	{
		id: "s4",
		speaker: "grok",
		text: "문장마다 끊어서 읽는다. 중간에 멈추거나, 이전·다음으로 건너뛰거나, 속도를 올려도 바로 따라온다."
	},
	{
		id: "s5",
		speaker: "me",
		text: "충주 가는 길에 틀어 두면 좋겠다."
	},
	{
		id: "s6",
		speaker: "grok",
		text: "재생만 켜 두고, 화면은 보지 마. 손은 핸들에. 듣고 싶은 자리만 톡 하면 그 문장부터 다시 이어 읽는다."
	}
];
function speakerLabel(speaker) {
	return speaker === "me" ? "나" : "그록";
}
function toSpeaker(token) {
	const t = token.toLowerCase();
	if (t === "그록" || t === "grok" || t === "assistant" || t === "ai") return "grok";
	return "me";
}
function joinLines(lines) {
	return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
function parseTranscript(raw, idPrefix = "t") {
	const text = raw.replace(/^\uFEFF/, "").trim();
	if (!text) return {
		turns: [],
		mode: "empty"
	};
	const drafts = [];
	let current = null;
	let sawLabel = false;
	let fence = false;
	for (const rawLine of text.split(/\r?\n/)) {
		const trimmed = rawLine.trim();
		if (trimmed.startsWith("```")) {
			fence = !fence;
			continue;
		}
		if (fence) continue;
		if (!trimmed || trimmed === "---") {
			if (current && current.lines.length > 0 && current.lines[current.lines.length - 1] !== "") current.lines.push("");
			continue;
		}
		const prefixed = trimmed.match(PREFIX);
		if (prefixed) {
			sawLabel = true;
			current = {
				speaker: toSpeaker(prefixed[1]),
				lines: []
			};
			drafts.push(current);
			if (prefixed[2]?.trim()) current.lines.push(prefixed[2].trim());
			continue;
		}
		const header = trimmed.match(HEADER);
		if (header) {
			sawLabel = true;
			current = {
				speaker: toSpeaker(header[1]),
				lines: []
			};
			drafts.push(current);
			continue;
		}
		if (!current) {
			current = {
				speaker: "me",
				lines: []
			};
			drafts.push(current);
		}
		current.lines.push(trimmed);
	}
	if (!sawLabel) {
		const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p && !p.startsWith("```"));
		if (paras.length === 0) return {
			turns: [],
			mode: "empty"
		};
		return {
			mode: "alternating",
			turns: paras.map((para, i) => ({
				id: `${idPrefix}-${i}`,
				speaker: i % 2 === 0 ? "me" : "grok",
				text: para.replace(/\n+/g, "\n").trim()
			}))
		};
	}
	const turns = drafts.map((d, i) => ({
		id: `${idPrefix}-${i}`,
		speaker: d.speaker,
		text: joinLines(d.lines)
	})).filter((t) => t.text.length > 0);
	if (turns.length === 0) return {
		turns: [],
		mode: "empty"
	};
	return {
		turns,
		mode: "labeled"
	};
}
function pushWrapped(out, sentence, max) {
	const clean = sentence.trim();
	if (!clean) return;
	if (clean.length <= max) {
		out.push(clean);
		return;
	}
	const parts = clean.split(/(?<=[,，、;；])\s+|\s+/);
	let buf = "";
	const flush = () => {
		if (buf.trim()) out.push(buf.trim());
		buf = "";
	};
	for (const part of parts) {
		if (!part) continue;
		if (part.length > max) {
			flush();
			for (let i = 0; i < part.length; i += max) out.push(part.slice(i, i + max));
			continue;
		}
		const next = buf ? `${buf} ${part}` : part;
		if (next.length > max && buf) {
			flush();
			buf = part;
		} else buf = next;
	}
	flush();
}
/** Sentence-sized pieces so a long reply is not one huge request. */
function chunkText(text, max = 220) {
	const blocks = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
	const chunks = [];
	for (const block of blocks) {
		const sentences = block.split(/(?<=[.!?。！？…])\s+/);
		for (const sentence of sentences) pushWrapped(chunks, sentence, max);
	}
	return chunks;
}
function readingSeconds(turns, rate) {
	const chars = turns.reduce((n, t) => n + t.text.replace(/\s/g, "").length, 0);
	const perMinute = 340 * Math.max(.5, rate);
	return Math.round(chars / perMinute * 60);
}
function formatDuration(seconds) {
	if (seconds < 60) return `약 ${Math.max(1, seconds)}초`;
	return `약 ${Math.round(seconds / 60)}분`;
}
var audioCache = /* @__PURE__ */ new Map();
var audioInflight = /* @__PURE__ */ new Map();
var RUN_BUDGET = 36;
function pieceAt(turns, t, c, onlyGrok) {
	let ti = t;
	let ci = c;
	while (ti < turns.length) {
		if (onlyGrok && turns[ti]?.speaker !== "grok") {
			ti += 1;
			ci = 0;
			continue;
		}
		const chunks = chunkText(turns[ti]?.text ?? "");
		if (ci < chunks.length) return {
			t: ti,
			c: ci,
			text: chunks[ci],
			speaker: turns[ti].speaker
		};
		ti += 1;
		ci = 0;
	}
	return null;
}
function cacheKey(text, voiceId, speed) {
	return `${voiceId}|${speed.toFixed(2)}|${text}`;
}
function bytesToUrl(b64) {
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
}
function useReader({ turns, rate, gap, voiceMe, voiceGrok, onlyGrok }) {
	const [status, setStatus] = (0, import_react.useState)("idle");
	const [turnIndex, setTurnIndex] = (0, import_react.useState)(0);
	const [chunkIndex, setChunkIndex] = (0, import_react.useState)(0);
	const [preparing, setPreparing] = (0, import_react.useState)(false);
	const [error, setError] = (0, import_react.useState)(null);
	const [supported, setSupported] = (0, import_react.useState)(true);
	const turnsRef = (0, import_react.useRef)(turns);
	const rateRef = (0, import_react.useRef)(rate);
	const gapRef = (0, import_react.useRef)(gap);
	const voiceMeRef = (0, import_react.useRef)(voiceMe);
	const voiceGrokRef = (0, import_react.useRef)(voiceGrok);
	const onlyGrokRef = (0, import_react.useRef)(onlyGrok);
	const statusRef = (0, import_react.useRef)("idle");
	const turnRef = (0, import_react.useRef)(0);
	const chunkRef = (0, import_react.useRef)(0);
	const genRef = (0, import_react.useRef)(0);
	const timerRef = (0, import_react.useRef)(null);
	const sleepResolveRef = (0, import_react.useRef)(null);
	const audioRef = (0, import_react.useRef)(null);
	const ctxRef = (0, import_react.useRef)(null);
	const sourceRef = (0, import_react.useRef)(null);
	const budgetRef = (0, import_react.useRef)(RUN_BUDGET);
	const settleRef = (0, import_react.useRef)(null);
	(0, import_react.useEffect)(() => {
		turnsRef.current = turns;
	}, [turns]);
	onlyGrokRef.current = onlyGrok;
	const setStatusBoth = (next) => {
		statusRef.current = next;
		setStatus(next);
	};
	const setPos = (t, c) => {
		turnRef.current = t;
		chunkRef.current = c;
		setTurnIndex(t);
		setChunkIndex(c);
	};
	const clearTimer = () => {
		if (timerRef.current != null) {
			window.clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		sleepResolveRef.current?.(false);
		sleepResolveRef.current = null;
	};
	const sleep = (ms, gen) => new Promise((resolve) => {
		sleepResolveRef.current = (alive) => {
			sleepResolveRef.current = null;
			resolve(alive && gen === genRef.current);
		};
		timerRef.current = window.setTimeout(() => {
			timerRef.current = null;
			sleepResolveRef.current?.(true);
		}, ms);
	});
	const settle = (result) => {
		const fn = settleRef.current;
		settleRef.current = null;
		fn?.(result);
	};
	const haltAudio = () => {
		const audio = audioRef.current;
		if (audio) {
			audio.onended = null;
			audio.onerror = null;
			audio.pause();
		}
		const source = sourceRef.current;
		sourceRef.current = null;
		if (source) {
			source.onended = null;
			try {
				source.stop();
			} catch {}
		}
		settle("stopped");
	};
	const cancelDevice = () => {
		if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
	};
	const voiceFor = (speaker) => speaker === "me" ? voiceMeRef.current || "leo" : voiceGrokRef.current || "ara";
	const fetchAudio = (0, import_react.useCallback)(async (text, voiceId, speed) => {
		const key = cacheKey(text, voiceId, speed);
		const cached = audioCache.get(key);
		if (cached) return cached;
		const pending = audioInflight.get(key);
		if (pending) return pending;
		if (budgetRef.current <= 0) throw new Error("cap");
		budgetRef.current -= 1;
		const job = (async () => {
			try {
				const result = await speakLine({ data: {
					text,
					voiceId,
					speed
				} });
				if (!result.ok) throw new Error(result.error);
				const url = bytesToUrl(result.audio);
				audioCache.set(key, url);
				return url;
			} finally {
				audioInflight.delete(key);
			}
		})();
		audioInflight.set(key, job);
		return job;
	}, []);
	const prefetch = (0, import_react.useCallback)((t, c) => {
		const next = pieceAt(turnsRef.current, t, c, onlyGrokRef.current);
		if (!next) return;
		const voiceId = voiceFor(next.speaker);
		if (!API_VOICES.has(voiceId)) return;
		fetchAudio(next.text, voiceId, rateRef.current).catch(() => {});
	}, [fetchAudio]);
	const prime = (0, import_react.useCallback)(() => {
		if (typeof window === "undefined") return;
		const Ctx = window.AudioContext;
		if (!Ctx) return;
		if (!ctxRef.current) ctxRef.current = new Ctx();
		ctxRef.current.resume();
	}, []);
	const playUrl = (url) => {
		const ctx = ctxRef.current;
		if (ctx && ctx.state === "running") return new Promise((resolve) => {
			settleRef.current = resolve;
			(async () => {
				try {
					const raw = await (await fetch(url)).arrayBuffer();
					if (settleRef.current !== resolve) return;
					const buffer = await ctx.decodeAudioData(raw);
					if (settleRef.current !== resolve) return;
					const node = ctx.createBufferSource();
					sourceRef.current = node;
					node.buffer = buffer;
					node.connect(ctx.destination);
					node.onended = () => {
						if (sourceRef.current === node) sourceRef.current = null;
						settle("ended");
					};
					node.start();
				} catch {
					if (settleRef.current === resolve) settle("error");
				}
			})();
		});
		const audio = audioRef.current ?? new Audio();
		audioRef.current = audio;
		return new Promise((resolve) => {
			settleRef.current = resolve;
			audio.onended = () => settle("ended");
			audio.onerror = () => settle("error");
			audio.src = url;
			const pending = audio.play();
			if (pending) pending.catch(() => settle("blocked"));
		});
	};
	const speakDevice = (text, speaker, gen) => new Promise((resolve) => {
		if (typeof window === "undefined" || !("speechSynthesis" in window)) {
			resolve("error");
			return;
		}
		const synth = window.speechSynthesis;
		const u = new SpeechSynthesisUtterance(text);
		u.lang = "ko-KR";
		u.rate = rateRef.current;
		const ko = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith("ko"));
		const voice = speaker === "grok" && ko.length > 1 ? ko[1] : ko[0];
		if (voice) {
			u.voice = voice;
			u.lang = voice.lang;
		} else u.pitch = speaker === "grok" ? .94 : 1.04;
		u.onend = () => resolve(gen === genRef.current ? "ended" : "stopped");
		u.onerror = (ev) => {
			if (ev.error === "interrupted" || ev.error === "canceled") {
				resolve("stopped");
				return;
			}
			resolve("error");
		};
		synth.cancel();
		window.setTimeout(() => {
			if (gen !== genRef.current) {
				resolve("stopped");
				return;
			}
			synth.speak(u);
		}, 40);
	});
	const speakFrom = (0, import_react.useCallback)((turn, chunk) => {
		if (typeof window === "undefined") return;
		clearTimer();
		haltAudio();
		cancelDevice();
		const gen = ++genRef.current;
		budgetRef.current = RUN_BUDGET;
		setError(null);
		setStatusBoth("playing");
		setPreparing(true);
		const audio = audioRef.current ?? new Audio();
		audioRef.current = audio;
		audio.src = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==";
		audio.play().then(() => {
			if (audio.src.startsWith("data:")) audio.pause();
		}).catch(() => {});
		(async () => {
			let t = turn;
			let c = chunk;
			let useGap = false;
			while (gen === genRef.current) {
				if (useGap && gapRef.current > 0) {
					setPreparing(false);
					if (!await sleep(gapRef.current * 1e3, gen)) return;
				}
				useGap = false;
				const piece = pieceAt(turnsRef.current, t, c, onlyGrokRef.current);
				if (!piece) {
					setPos(turnsRef.current.length, 0);
					setPreparing(false);
					setStatusBoth("idle");
					return;
				}
				t = piece.t;
				c = piece.c;
				setPos(t, c);
				setStatusBoth("playing");
				const voiceId = voiceFor(piece.speaker);
				prefetch(t, c + 1);
				let played = false;
				if (API_VOICES.has(voiceId)) {
					setPreparing(true);
					try {
						const url = await fetchAudio(piece.text, voiceId, rateRef.current);
						if (gen !== genRef.current) return;
						setPreparing(false);
						const result = await playUrl(url);
						if (gen !== genRef.current) return;
						if (result === "blocked") {
							setError("재생 버튼을 한 번 더 눌러 주세요.");
							setStatusBoth("paused");
							return;
						}
						if (result === "stopped") return;
						if (result === "error") {
							setError("이 문장을 재생하지 못했습니다.");
							setStatusBoth("paused");
							return;
						}
						played = true;
					} catch (err) {
						if (gen !== genRef.current) return;
						if ((err instanceof Error ? err.message : "") === "cap") {
							setPreparing(false);
							setError("이번 재생은 여기까지입니다. 재생을 다시 누르면 이어서 읽습니다.");
							setStatusBoth("paused");
							return;
						}
					}
				}
				if (!played) {
					setPreparing(false);
					const device = await speakDevice(piece.text, piece.speaker, gen);
					if (gen !== genRef.current) return;
					if (device === "stopped") return;
					if (device === "error") {
						setError("이 기기에서 음성을 재생하지 못했습니다.");
						setStatusBoth("paused");
						return;
					}
				}
				const follow = pieceAt(turnsRef.current, t, c + 1, onlyGrokRef.current);
				if (!follow) {
					setPos(turnsRef.current.length, 0);
					setPreparing(false);
					setStatusBoth("idle");
					return;
				}
				t = follow.t;
				c = follow.c;
				useGap = follow.c === 0;
			}
		})();
	}, [fetchAudio, prefetch]);
	const stopAll = (0, import_react.useCallback)(() => {
		clearTimer();
		genRef.current += 1;
		haltAudio();
		cancelDevice();
		setPreparing(false);
	}, []);
	(0, import_react.useEffect)(() => {
		const prev = rateRef.current;
		rateRef.current = rate;
		if (prev !== rate && statusRef.current === "playing") speakFrom(turnRef.current, chunkRef.current);
	}, [rate, speakFrom]);
	(0, import_react.useEffect)(() => {
		gapRef.current = gap;
	}, [gap]);
	(0, import_react.useEffect)(() => {
		const changed = voiceMeRef.current !== voiceMe || voiceGrokRef.current !== voiceGrok;
		voiceMeRef.current = voiceMe;
		voiceGrokRef.current = voiceGrok;
		if (changed && statusRef.current === "playing") speakFrom(turnRef.current, chunkRef.current);
	}, [
		voiceMe,
		voiceGrok,
		speakFrom
	]);
	(0, import_react.useEffect)(() => {
		if (turnRef.current > turns.length) {
			stopAll();
			setPos(turns.length, 0);
			setStatusBoth("idle");
		}
	}, [turns.length, stopAll]);
	(0, import_react.useEffect)(() => {
		const hasSpeech = typeof window !== "undefined" && "speechSynthesis" in window;
		setSupported(hasSpeech || typeof window !== "undefined" && typeof Audio !== "undefined");
		if (!hasSpeech) return;
		const synth = window.speechSynthesis;
		const keep = window.setInterval(() => {
			if (synth.speaking && !synth.paused && statusRef.current === "playing") {
				synth.pause();
				synth.resume();
			}
		}, 1e4);
		return () => {
			window.clearInterval(keep);
			clearTimer();
			genRef.current += 1;
			haltAudio();
			synth.cancel();
		};
	}, []);
	const pause = (0, import_react.useCallback)(() => {
		if (statusRef.current !== "playing") return;
		stopAll();
		setStatusBoth("paused");
	}, [stopAll]);
	const play = (0, import_react.useCallback)(() => {
		if (statusRef.current === "playing") return;
		const list = turnsRef.current;
		if (list.length === 0) return;
		let t = turnRef.current;
		let c = chunkRef.current;
		if (t >= list.length) {
			t = 0;
			c = 0;
		}
		speakFrom(t, c);
	}, [speakFrom]);
	const toggle = (0, import_react.useCallback)(() => {
		if (statusRef.current === "playing") pause();
		else play();
	}, [pause, play]);
	const stop = (0, import_react.useCallback)(() => {
		stopAll();
		setPos(0, 0);
		setStatusBoth("idle");
	}, [stopAll]);
	const seek = (0, import_react.useCallback)((t, c = 0) => {
		const list = turnsRef.current;
		const clamped = Math.max(0, Math.min(t, list.length));
		stopAll();
		setPos(clamped, c);
		setStatusBoth("idle");
	}, [stopAll]);
	return {
		status,
		turnIndex,
		chunkIndex,
		preparing,
		supported,
		error,
		play,
		pause,
		toggle,
		stop,
		next: (0, import_react.useCallback)(() => {
			const list = turnsRef.current;
			const wasPlaying = statusRef.current === "playing";
			const t = turnRef.current + 1;
			if (t >= list.length) {
				stopAll();
				setPos(list.length, 0);
				setStatusBoth("idle");
				return;
			}
			if (wasPlaying) speakFrom(t, 0);
			else {
				stopAll();
				setPos(t, 0);
				setStatusBoth(statusRef.current === "paused" ? "paused" : "idle");
			}
		}, [speakFrom, stopAll]),
		prev: (0, import_react.useCallback)(() => {
			const wasPlaying = statusRef.current === "playing";
			const t = chunkRef.current > 0 ? turnRef.current : Math.max(0, turnRef.current - 1);
			if (wasPlaying) speakFrom(t, 0);
			else {
				stopAll();
				setPos(t, 0);
				setStatusBoth(statusRef.current === "paused" ? "paused" : "idle");
			}
		}, [speakFrom, stopAll]),
		jump: (0, import_react.useCallback)((t) => {
			speakFrom(t, 0);
		}, [speakFrom]),
		seek,
		playFrom: (0, import_react.useCallback)((next, index) => {
			turnsRef.current = next;
			speakFrom(index, 0);
		}, [speakFrom]),
		prime
	};
}
function wakeForms(name) {
	const key = name.replace(/\s+/g, "").trim();
	if (!key) return [];
	return [`${key}야`, `${key}아`];
}
function takeWake(text, name) {
	const compact = text.replace(/[\s.,!?~…"'“”]/g, "");
	if (!compact) return null;
	for (const form of wakeForms(name)) {
		const at = compact.indexOf(form);
		if (at < 0 || at > 4) continue;
		return compact.slice(at + form.length);
	}
	return null;
}
function recognitionCtor() {
	if (typeof window === "undefined") return null;
	const w = window;
	return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
function useWake({ enabled, paused, name, onWake, onError }) {
	const [listening, setListening] = (0, import_react.useState)(false);
	const [standby, setStandby] = (0, import_react.useState)(false);
	const [note, setNote] = (0, import_react.useState)("");
	const wanted = (0, import_react.useRef)(false);
	const tail = (0, import_react.useRef)("");
	const pausedRef = (0, import_react.useRef)(paused);
	const nameRef = (0, import_react.useRef)(name);
	const recRef = (0, import_react.useRef)(null);
	const callbacks = (0, import_react.useRef)({
		onWake,
		onError
	});
	const retryTimer = (0, import_react.useRef)(0);
	const openedAt = (0, import_react.useRef)(0);
	pausedRef.current = paused;
	nameRef.current = name;
	callbacks.current = {
		onWake,
		onError
	};
	const clearRetry = () => {
		window.clearTimeout(retryTimer.current);
		retryTimer.current = 0;
	};
	const close = () => {
		clearRetry();
		const rec = recRef.current;
		recRef.current = null;
		if (!rec) return;
		rec.onresult = null;
		rec.onerror = null;
		rec.onend = null;
		try {
			rec.abort();
		} catch {}
	};
	const open = () => {
		if (recRef.current || pausedRef.current || !wanted.current) return;
		if (!nameRef.current.replace(/\s+/g, "").trim()) {
			setNote("페르소나 이름을 먼저 정해 주세요.");
			return;
		}
		const Ctor = recognitionCtor();
		if (!Ctor) {
			setNote("이 브라우저는 이름 부르기를 지원하지 않아요.");
			return;
		}
		const rec = new Ctor();
		rec.lang = "ko-KR";
		rec.continuous = true;
		rec.interimResults = true;
		let fired = false;
		let heard = "";
		rec.onresult = (event) => {
			if (fired) return;
			heard = sessionTranscript(event);
			const rest = takeWake(mergeUtterance(tail.current, heard), nameRef.current);
			if (rest === null) return;
			fired = true;
			tail.current = "";
			close();
			setListening(false);
			callbacks.current.onWake(rest);
		};
		rec.onerror = (event) => {
			const code = event.error ?? "";
			if (code === "no-speech" || code === "aborted") return;
			if (code === "network" || code === "audio-capture") {
				close();
				if (wanted.current && !pausedRef.current) scheduleOpen(false);
				return;
			}
			close();
			setListening(false);
			const message = code === "not-allowed" || code === "service-not-allowed" ? "이름 부르기를 쓰려면 마이크 권한을 허용해 주세요." : "이름 부르기에 연결하지 못했습니다.";
			setNote(message);
			callbacks.current.onError(message);
			wanted.current = false;
		};
		rec.onend = () => {
			const said = heard;
			if (said) tail.current = mergeUtterance(tail.current, said).slice(-24);
			if (recRef.current !== rec) return;
			recRef.current = null;
			if (!wanted.current || pausedRef.current || fired) {
				setListening(false);
				return;
			}
			scheduleOpen(Boolean(said));
		};
		try {
			rec.start();
		} catch {
			setNote("이름 부르기를 시작하지 못했습니다.");
			return;
		}
		recRef.current = rec;
		openedAt.current = Date.now();
		setListening(true);
		setNote("");
	};
	const scheduleOpen = (heardSomething) => {
		clearRetry();
		const lived = openedAt.current ? Date.now() - openedAt.current : 0;
		const wait = heardSomething || lived > 2e4 ? 800 : 12e3;
		retryTimer.current = window.setTimeout(() => {
			retryTimer.current = 0;
			if (!wanted.current || pausedRef.current || recRef.current) return;
			open();
		}, wait);
	};
	const kick = () => {
		wanted.current = true;
		open();
	};
	const halt = () => {
		wanted.current = false;
		tail.current = "";
		close();
		setListening(false);
		setNote("");
	};
	(0, import_react.useEffect)(() => {
		if (!enabled || paused) {
			setStandby(false);
			close();
			setListening(false);
			return;
		}
		setStandby(true);
		wanted.current = true;
		if (!recRef.current && !retryTimer.current) open();
	}, [enabled, paused]);
	(0, import_react.useEffect)(() => () => close(), []);
	return {
		listening,
		standby,
		note,
		kick,
		halt
	};
}
var STORAGE_KEY = "nangdok-v1";
var STARTER_PERSONAS = [
	{
		id: "plain",
		name: "기본",
		text: "",
		password: "",
		locked: true
	},
	{
		id: "friend",
		name: "친구",
		text: "오래된 친구처럼 편하게 반말로 말한다.",
		password: "",
		locked: true
	},
	{
		id: "aide",
		name: "비서",
		text: "차분한 비서처럼 필요한 것만 또박또박 말한다.",
		password: "",
		locked: true
	},
	{
		id: "teacher",
		name: "선생님",
		text: "친절한 선생님처럼 쉽게 풀어서 말한다.",
		password: "",
		locked: true
	}
];
function turnTime(turn) {
	if (typeof turn.at === "number") return turn.at;
	const match = /^(?:me|gk)-([0-9a-z]+)$/i.exec(turn.id);
	if (!match) return null;
	const at = Number.parseInt(match[1], 36);
	if (!Number.isFinite(at) || at < Date.UTC(2024, 0, 1) || at > Date.now() + 864e5) return null;
	return at;
}
function groupTurns(turns) {
	const groups = [];
	turns.forEach((turn, index) => {
		const at = turnTime(turn);
		const day = at === null ? "none" : dayKey(at);
		const label = at === null ? null : dayLabel(at);
		const last = groups[groups.length - 1];
		if (last && last.day === day) last.turns.push({
			turn,
			index
		});
		else groups.push({
			key: `${day}-${index}`,
			day,
			label,
			turns: [{
				turn,
				index
			}]
		});
	});
	return groups;
}
var WEEKDAYS = [
	"일",
	"월",
	"화",
	"수",
	"목",
	"금",
	"토"
];
function dayKey(at) {
	const date = new Date(at);
	return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}
function dayLabel(at) {
	const date = new Date(at);
	const pad = (n) => String(n).padStart(2, "0");
	return `${String(date.getFullYear()).slice(2)}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}(${WEEKDAYS[date.getDay()]})`;
}
function formatWhen(at) {
	const date = new Date(at);
	const pad = (n) => String(n).padStart(2, "0");
	const hour24 = date.getHours();
	const suffix = hour24 < 12 ? "a.m." : "p.m.";
	const hour12 = hour24 % 12 || 12;
	return `${dayLabel(at)} ${pad(hour12)}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${suffix}`;
}
function isPersona(value) {
	if (!value || typeof value !== "object") return false;
	const item = value;
	return typeof item.id === "string" && typeof item.name === "string" && typeof item.text === "string" && typeof item.password === "string" && typeof item.locked === "boolean";
}
function isTurn(value) {
	if (!value || typeof value !== "object") return false;
	const t = value;
	return (t.speaker === "me" || t.speaker === "grok") && typeof t.text === "string" && typeof t.id === "string" && (t.image === void 0 || typeof t.image === "string" && t.image.startsWith("https://")) && (t.video === void 0 || typeof t.video === "string" && t.video.startsWith("https://")) && (t.at === void 0 || typeof t.at === "number" && Number.isFinite(t.at));
}
function loadSaved() {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		return JSON.parse(raw);
	} catch {
		return null;
	}
}
function revealInScroller(scroller, id, align) {
	if (!scroller) return;
	const node = document.getElementById(id);
	if (!node) {
		scroller.scrollTop = scroller.scrollHeight;
		return;
	}
	const scrollerRect = scroller.getBoundingClientRect();
	const nodeRect = node.getBoundingClientRect();
	const delta = align === "end" ? nodeRect.bottom - scrollerRect.bottom + 12 : nodeRect.top - scrollerRect.top - 8;
	if (Math.abs(delta) > 2) scroller.scrollTop += delta;
}
function topicWith(name) {
	const code = name.trim().slice(-1).charCodeAt(0);
	return `${name}${code >= 44032 && code <= 55203 && (code - 44032) % 28 !== 0 ? "과" : "와"} 나누는 대화`;
}
function Equalizer() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
		className: "eq",
		"aria-hidden": "true",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {})
		]
	});
}
function ReaderApp() {
	const [threads, setThreads] = (0, import_react.useState)({ plain: SAMPLE_TURNS });
	const [rate, setRate] = (0, import_react.useState)(1);
	const [gap, setGap] = (0, import_react.useState)(.45);
	const [voiceMe, setVoiceMe] = (0, import_react.useState)("leo");
	const [voiceGrok, setVoiceGrok] = (0, import_react.useState)("ara");
	const [autoScroll, setAutoScroll] = (0, import_react.useState)(true);
	const [onlyGrok, setOnlyGrok] = (0, import_react.useState)(true);
	const [autoReply, setAutoReply] = (0, import_react.useState)(true);
	const [silence, setSilence] = (0, import_react.useState)(2);
	const [wakeOn, setWakeOn] = (0, import_react.useState)(true);
	const [persona, setPersona] = (0, import_react.useState)("");
	const [personaId, setPersonaId] = (0, import_react.useState)("plain");
	const personaIdRef = (0, import_react.useRef)(personaId);
	personaIdRef.current = personaId;
	const turns = threads[personaId] ?? [];
	const setTurns = (update) => {
		const id = personaIdRef.current;
		setThreads((prev) => {
			const current = prev[id] ?? [];
			const next = typeof update === "function" ? update(current) : update;
			return {
				...prev,
				[id]: next
			};
		});
	};
	const [personas, setPersonas] = (0, import_react.useState)(STARTER_PERSONAS);
	const [newPersona, setNewPersona] = (0, import_react.useState)(null);
	const [eraseStep, setEraseStep] = (0, import_react.useState)(0);
	const [erasePassword, setErasePassword] = (0, import_react.useState)("");
	const [previewing, setPreviewing] = (0, import_react.useState)(null);
	const [asking, setAsking] = (0, import_react.useState)(false);
	const [painting, setPainting] = (0, import_react.useState)(false);
	const [filming, setFilming] = (0, import_react.useState)(false);
	const [hydrated, setHydrated] = (0, import_react.useState)(false);
	const [micReady, setMicReady] = (0, import_react.useState)(false);
	const [sheet, setSheet] = (0, import_react.useState)(null);
	const [draft, setDraft] = (0, import_react.useState)("");
	const [draftNote, setDraftNote] = (0, import_react.useState)(null);
	const [exportText, setExportText] = (0, import_react.useState)(null);
	const [cloudFolder, setCloudFolder] = (0, import_react.useState)(null);
	const [cloudBusy, setCloudBusy] = (0, import_react.useState)(false);
	const [shareUrl, setShareUrl] = (0, import_react.useState)("");
	const [shareBusy, setShareBusy] = (0, import_react.useState)(false);
	const [imported, setImported] = (0, import_react.useState)(null);
	const [banner, setBanner] = (0, import_react.useState)(null);
	const [editingId, setEditingId] = (0, import_react.useState)(null);
	const [composer, setComposer] = (0, import_react.useState)("");
	const fileRef = (0, import_react.useRef)(null);
	const scrollerRef = (0, import_react.useRef)(null);
	const bootIndex = (0, import_react.useRef)(0);
	const previewAudio = (0, import_react.useRef)(null);
	const turnsNow = (0, import_react.useRef)(turns);
	turnsNow.current = turns;
	const reader = useReader({
		turns,
		rate,
		gap,
		voiceMe,
		voiceGrok,
		onlyGrok
	});
	const busyRef = (0, import_react.useRef)(false);
	const askRef = (0, import_react.useRef)(() => {});
	const personaNameRef = (0, import_react.useRef)("");
	const personaRef = (0, import_react.useRef)("");
	const wakeOnRef = (0, import_react.useRef)(false);
	const settingsBase = (0, import_react.useRef)(null);
	const dictation = useDictation({
		paused: asking || reader.status === "playing" || reader.preparing,
		silenceMs: Math.round(silence * 1e3),
		autoSend: autoReply,
		onText: setComposer,
		onUtterance: (text) => {
			if (wakeOnRef.current) {
				const hit = takeWake(text, personaNameRef.current);
				if (hit !== null) {
					if (!hit.trim()) {
						setComposer("");
						return;
					}
					askRef.current(hit.trim());
					return;
				}
			}
			askRef.current(text);
		},
		onError: setBanner
	});
	const personaName = (personas.find((item) => item.id === personaId) ?? personas[0])?.name ?? "";
	const wakeCall = wakeForms(personaName);
	personaNameRef.current = personaName;
	personaRef.current = persona;
	wakeOnRef.current = wakeOn;
	const wakeHandler = (0, import_react.useRef)(() => {});
	const wake = useWake({
		enabled: wakeOn && hydrated && micReady,
		paused: dictation.armed || asking || painting || filming || reader.status === "playing" || reader.preparing,
		name: personaName,
		onWake: (rest) => wakeHandler.current(rest),
		onError: setBanner
	});
	(0, import_react.useEffect)(() => {
		let cancel = false;
		const ready = () => {
			if (!cancel) setMicReady(true);
		};
		const timer = window.setTimeout(ready, 2500);
		const askMic = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
		if (!askMic) {
			window.clearTimeout(timer);
			ready();
			return;
		}
		askMic({ audio: true }).then((stream) => {
			stream.getTracks().forEach((track) => track.stop());
			window.clearTimeout(timer);
			ready();
		}).catch(() => {
			window.clearTimeout(timer);
			ready();
		});
		return () => {
			cancel = true;
			window.clearTimeout(timer);
		};
	}, []);
	(0, import_react.useEffect)(() => {
		const saved = loadSaved();
		if (saved) {
			const loaded = readThreads(saved);
			setThreads(loaded ?? {});
			if (typeof saved.rate === "number") setRate(clamp(saved.rate, .7, 1.5));
			if (typeof saved.gap === "number") setGap(clamp(saved.gap, 0, 1.5));
			if (typeof saved.voiceMe === "string" && isMaleVoice(saved.voiceMe)) setVoiceMe(saved.voiceMe);
			if (typeof saved.voiceGrok === "string" && isFemaleVoice(saved.voiceGrok)) setVoiceGrok(saved.voiceGrok);
			if (typeof saved.autoScroll === "boolean") setAutoScroll(saved.autoScroll);
			if (typeof saved.onlyGrok === "boolean") setOnlyGrok(saved.onlyGrok);
			if (typeof saved.autoReply === "boolean") setAutoReply(saved.autoReply);
			if (typeof saved.silence === "number") setSilence(clamp(saved.silence, 1, 5));
			if (saved.wakeDefaulted === true && typeof saved.wakeOn === "boolean") setWakeOn(saved.wakeOn);
			else setWakeOn(true);
			if (typeof saved.persona === "string") setPersona(saved.persona.slice(0, 240));
			if (Array.isArray(saved.personas)) {
				const next = saved.personas.filter(isPersona).slice(0, 12);
				if (next.length > 0) {
					setPersonas(next);
					const picked = next.find((item) => item.id === saved.personaId) ?? next[0];
					setPersonaId(picked.id);
					setPersona(picked.text.slice(0, 240));
				}
			}
			if (typeof saved.index === "number") bootIndex.current = saved.index;
		}
		setHydrated(true);
		cloudFolderName().then((name) => {
			if (name) setCloudFolder(name);
		});
	}, []);
	(0, import_react.useEffect)(() => {
		if (!hydrated) return;
		if (bootIndex.current > 0) {
			reader.seek(bootIndex.current, 0);
			bootIndex.current = 0;
		}
	}, [hydrated]);
	(0, import_react.useEffect)(() => {
		if (!hydrated) return;
		const payload = {
			turns,
			rate,
			gap,
			voiceMe,
			voiceGrok,
			autoScroll,
			onlyGrok,
			autoReply,
			silence,
			wakeOn,
			persona,
			personaId,
			personas,
			threads,
			wakeDefaulted: true,
			index: reader.turnIndex
		};
		localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
	}, [
		hydrated,
		turns,
		rate,
		gap,
		voiceMe,
		voiceGrok,
		autoScroll,
		onlyGrok,
		autoReply,
		silence,
		wakeOn,
		persona,
		personaId,
		personas,
		threads,
		reader.turnIndex
	]);
	(0, import_react.useEffect)(() => {
		if (!autoScroll || reader.status !== "playing") return;
		const id = turns[reader.turnIndex]?.id;
		if (!id) return;
		revealInScroller(scrollerRef.current, `turn-${id}`, "end");
	}, [
		autoScroll,
		reader.status,
		reader.turnIndex,
		reader.chunkIndex,
		turns
	]);
	const latestId = turns[turns.length - 1]?.id ?? "";
	(0, import_react.useEffect)(() => {
		if (!hydrated || !latestId) return;
		const frame = requestAnimationFrame(() => {
			const list = turnsNow.current;
			const last = list[list.length - 1];
			if (!last) return;
			const before = list[list.length - 2];
			const mine = last.speaker === "grok" && before?.speaker === "me" ? before : last;
			revealInScroller(scrollerRef.current, `turn-${mine.id}`, mine === last ? "end" : "start");
		});
		return () => cancelAnimationFrame(frame);
	}, [hydrated, latestId]);
	const personaSeen = (0, import_react.useRef)(personaId);
	(0, import_react.useEffect)(() => {
		if (!hydrated || personaSeen.current === personaId) return;
		personaSeen.current = personaId;
		reader.stop();
		reader.seek(turns.length, 0);
		const last = turns[turns.length - 1];
		const frame = requestAnimationFrame(() => {
			if (last) revealInScroller(scrollerRef.current, `turn-${last.id}`, "end");
			else if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
		});
		return () => cancelAnimationFrame(frame);
	}, [
		hydrated,
		personaId,
		reader,
		turns
	]);
	(0, import_react.useEffect)(() => {
		const onKey = (e) => {
			const tag = e.target?.tagName;
			if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
			if (e.key === " ") {
				e.preventDefault();
				reader.prime();
				reader.toggle();
			} else if (e.key === "ArrowRight") reader.next();
			else if (e.key === "ArrowLeft") reader.prev();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [reader]);
	const parsedDraft = (0, import_react.useMemo)(() => parseTranscript(draft, "preview"), [draft]);
	const duration = formatDuration(readingSeconds(turns, rate));
	const active = turns[reader.turnIndex];
	const activeChunks = active ? chunkText(active.text) : [];
	const activeLine = filming ? "영상 만드는 중" : painting ? "그리는 중" : asking ? "그록이 대답하는 중" : reader.preparing ? "목소리 준비 중" : dictation.hearing || dictation.note ? dictation.note || "듣는 중" : wake.standby ? `「${wakeCall[0] ?? personaName}」라고 부르면 말하기가 켜집니다` : reader.status === "idle" && reader.turnIndex >= turns.length ? "끝까지 읽었습니다. 재생하면 처음부터 다시 시작합니다." : activeChunks[reader.chunkIndex] || (reader.status === "playing" ? "다음 말로 넘어가는 중" : "재생하면 그록의 말을 끝까지 읽습니다.");
	const progress = turns.length === 0 ? 0 : Math.min(100, Math.round(Math.min(reader.turnIndex, turns.length) / turns.length * 100));
	function applyDraft() {
		const idPrefix = `imp-${Date.now().toString(36)}`;
		const result = parseTranscript(draft, idPrefix);
		if (result.turns.length === 0) {
			setDraftNote("읽을 문장이 없어요.");
			return;
		}
		reader.stop();
		setTurns(result.turns);
		setEditingId(null);
		setSheet(null);
		setDraftNote(null);
		setBanner(result.mode === "alternating" ? "화자 이름을 못 찾아서, 문단마다 나와 그록을 번갈아 넣었습니다. 다르면 화자 뒤집기를 누르세요." : "붙여넣은 대화를 끝까지 자동으로 읽습니다.");
	}
	function useImported(chat) {
		if (chat.turns.length === 0) {
			setDraftNote("읽을 문장이 없어요.");
			return;
		}
		const stamp = Date.now().toString(36);
		reader.stop();
		setTurns(chat.turns.map((turn, index) => ({
			...turn,
			id: `imp-${stamp}-${index}`
		})));
		setEditingId(null);
		settingsBase.current = null;
		setSheet(null);
		setImported(null);
		setDraftNote(null);
		setBanner(`${chat.title} 대화를 끝까지 읽습니다.`);
	}
	function restoreBackup(backup) {
		const picked = backup.personas.find((item) => item.id === backup.personaId) ?? backup.personas[0];
		reader.stop();
		setPersonas(backup.personas);
		setThreads(backup.threads);
		setPersonaId(picked.id);
		setPersona(picked.text.slice(0, 240));
		setEditingId(null);
		settingsBase.current = null;
		setSheet(null);
		setImported(null);
		setDraftNote(null);
		const count = Object.values(backup.threads).reduce((sum, list) => sum + list.length, 0);
		setBanner(`보관한 대화 ${count}마디로 바꿨습니다.`);
	}
	async function copyText(text) {
		try {
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(text);
				return true;
			}
		} catch {}
		try {
			const area = document.createElement("textarea");
			area.value = text;
			area.setAttribute("readonly", "");
			area.style.position = "fixed";
			area.style.top = "0";
			area.style.left = "0";
			document.body.appendChild(area);
			area.focus();
			area.select();
			const ok = document.execCommand("copy");
			area.remove();
			return ok;
		} catch {
			return false;
		}
	}
	function downloadText(name, text) {
		const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
		const link = document.createElement("a");
		link.href = url;
		link.download = name;
		document.body.appendChild(link);
		link.click();
		link.remove();
		window.setTimeout(() => URL.revokeObjectURL(url), 6e4);
	}
	async function sendBackup(mode) {
		const backup = buildBackup({
			personaId,
			personas,
			threads
		});
		const json = JSON.stringify(backup, null, 2);
		const name = backupFileName(backup.exportedAt);
		const framed = window.parent !== window;
		if (mode === "download") {
			setExportText(json);
			if (!framed) downloadText(name, json);
			const copied = await copyText(json);
			if (framed) {
				setDraftNote(copied ? "미리보기에서는 파일 저장이 막혀 대화를 복사했습니다. 메모나 파일 앱에 붙여 넣으세요." : "아래 글을 길게 눌러 전체 선택 후 복사하세요. 미리보기는 파일 저장을 막습니다.");
				return;
			}
			setDraftNote(copied ? "대화 파일을 받았고, 내용도 복사했습니다." : "대화 파일을 받았습니다. 안 보이면 아래 글을 복사하세요.");
			return;
		}
		if (cloudBusy) return;
		setCloudBusy(true);
		setDraftNote(null);
		try {
			const placed = await placeInCloud(json, name, mode === "retarget");
			if (placed.ok) {
				setExportText(null);
				if (placed.via === "folder") setCloudFolder(placed.where);
				setDraftNote(placed.via === "folder" ? placed.fresh ? `「${placed.where}」폴더에 넣었습니다. 다음부터는 같은 폴더에 바로 넣습니다. 그 폴더가 클라우드나 NAS와 동기화되면 그쪽으로 올라갑니다.` : `「${placed.where}」폴더에 넣었습니다.` : placed.via === "share" ? "공유 창에서 고른 앱으로 보냈습니다. 드라이브나 NAS 앱을 고르면 그쪽으로 올라갑니다." : "고른 위치에 저장했습니다. 클라우드나 NAS 폴더를 고르면 그 안으로 들어갑니다.");
				return;
			}
			if (placed.reason === "cancel") return;
			if (placed.reason === "failed") {
				setDraftNote("고른 폴더에 넣지 못했습니다. 다른 폴더를 다시 고르세요.");
				return;
			}
			setExportText(json);
			const copied = await copyText(json);
			if (placed.reason === "preview") {
				setDraftNote(copied ? "미리보기에서는 폴더 창이 막혀 대화를 복사했습니다. 게시한 뒤 크롬에서 누르면 클라우드나 NAS 폴더를 고를 수 있습니다." : "아래 글을 길게 눌러 전체 선택 후 복사하세요. 미리보기는 폴더 창을 막습니다.");
				return;
			}
			setDraftNote(copied ? "이 브라우저는 폴더를 직접 열지 못해 대화를 복사했습니다. 크롬에서 다시 누르면 폴더를 고를 수 있고, 휴대폰은 공유 창이 뜹니다." : "이 브라우저는 폴더를 직접 열지 못합니다. 아래 글을 길게 눌러 복사하세요.");
		} finally {
			setCloudBusy(false);
		}
	}
	async function loadShare() {
		if (shareBusy) return;
		setShareBusy(true);
		setDraftNote(null);
		setImported(null);
		try {
			const result = await importGrokShare({ data: { url: shareUrl } });
			if (!result.ok) {
				setDraftNote(result.error);
				return;
			}
			useImported({
				title: result.title || "그록 대화",
				turns: result.turns
			});
		} catch {
			setDraftNote("그록 대화에 연결하지 못했습니다.");
		} finally {
			setShareBusy(false);
		}
	}
	async function paint(raw) {
		const text = raw.trim();
		if (!text || busyRef.current) return;
		const prompt = imagePrompt(text, turnsNow.current.filter((turn) => !turn.id.startsWith("s")).slice(-6).map((turn) => ({
			role: turn.speaker === "me" ? "user" : "assistant",
			content: turn.text
		})));
		const sentAt = Date.now();
		busyRef.current = true;
		setPainting(true);
		setAsking(true);
		setBanner(null);
		try {
			const result = await imagineImage({ data: { prompt } });
			if (!result.ok) {
				setBanner(result.error);
				return;
			}
			const repliedAt = Date.now();
			const stamp = repliedAt.toString(36);
			const caption = prompt.length <= 24 ? `${prompt} 그림을 만들었어요.` : "그림을 만들었어요. 화면에서 볼 수 있어요.";
			const next = [
				...turnsNow.current,
				{
					id: `me-${stamp}`,
					speaker: "me",
					text,
					at: sentAt
				},
				{
					id: `gk-${stamp}`,
					speaker: "grok",
					text: caption,
					image: result.url,
					at: repliedAt
				}
			];
			setComposer("");
			setTurns(next);
			reader.playFrom(next, next.length - 1);
		} finally {
			busyRef.current = false;
			setAsking(false);
			setPainting(false);
		}
	}
	async function film(raw) {
		const text = raw.trim();
		if (!text || busyRef.current) return;
		const prompt = videoPrompt(text, turnsNow.current.filter((turn) => !turn.id.startsWith("s")).slice(-6).map((turn) => ({
			role: turn.speaker === "me" ? "user" : "assistant",
			content: turn.text
		})));
		const sentAt = Date.now();
		const seconds = videoSeconds(text);
		let image = "";
		if (/그거|이거|저거|방금|셀카|베이스|기반|그 사진|이 사진|그 그림/.test(text)) for (let i = turnsNow.current.length - 1; i >= 0; i--) {
			const found = turnsNow.current[i]?.image;
			if (found?.startsWith("https://")) {
				image = found;
				break;
			}
		}
		busyRef.current = true;
		setFilming(true);
		setAsking(true);
		setBanner(null);
		try {
			const started = await startVideo({ data: {
				prompt,
				seconds,
				image
			} });
			if (!started.ok) {
				setBanner(started.error);
				return;
			}
			let url = "";
			for (let i = 0; i < 24; i++) {
				await new Promise((resolve) => setTimeout(resolve, 4e3));
				const status = await videoStatus({ data: { id: started.id } });
				if (!status.ok) {
					setBanner(status.error);
					return;
				}
				if (!status.pending) {
					url = status.url;
					break;
				}
			}
			if (!url) {
				setBanner("영상을 시간 안에 만들지 못했습니다.");
				return;
			}
			const repliedAt = Date.now();
			const stamp = repliedAt.toString(36);
			const next = [
				...turnsNow.current,
				{
					id: `me-${stamp}`,
					speaker: "me",
					text,
					at: sentAt
				},
				{
					id: `gk-${stamp}`,
					speaker: "grok",
					text: "짧은 영상을 만들었어요.",
					video: url,
					at: repliedAt
				}
			];
			setComposer("");
			setTurns(next);
			reader.playFrom(next, next.length - 1);
		} finally {
			busyRef.current = false;
			setAsking(false);
			setFilming(false);
		}
	}
	async function ask(spoken) {
		const text = (spoken ?? composer).trim();
		if (!text || busyRef.current) return;
		if (wantsVideo(text)) {
			await film(text);
			return;
		}
		if (wantsImage(text)) {
			await paint(text);
			return;
		}
		busyRef.current = true;
		setAsking(true);
		setBanner(null);
		setComposer("");
		const sentAt = Date.now();
		const mine = {
			id: `me-${sentAt.toString(36)}`,
			speaker: "me",
			text,
			at: sentAt
		};
		const withUser = [...turnsNow.current, mine];
		turnsNow.current = withUser;
		setTurns(withUser);
		try {
			const history = withUser.filter((turn) => turn !== mine && !turn.id.startsWith("s")).slice(-4).map((turn) => ({
				role: turn.speaker === "me" ? "user" : "assistant",
				content: turn.text
			}));
			const grokId = `gk-${sentAt.toString(36)}`;
			let played = false;
			const show = (said) => {
				const next = [
					...turnsNow.current.filter((turn) => turn.id !== mine.id && turn.id !== grokId),
					mine,
					{
						id: grokId,
						speaker: "grok",
						text: said,
						at: sentAt
					}
				];
				turnsNow.current = next;
				setTurns(next);
				if (!played) {
					played = true;
					reader.playFrom(next, next.length - 1);
				}
			};
			let result;
			try {
				result = await streamAsk({
					message: text,
					history,
					persona
				}, show);
			} catch {
				result = {
					ok: false,
					error: "그록에게 연결하지 못했습니다."
				};
			}
			if (!result.ok && !played) {
				const again = await askGrok({ data: {
					message: text,
					history,
					persona
				} });
				if (!again.ok) {
					setBanner(again.error);
					return;
				}
				show(again.text);
			}
		} finally {
			busyRef.current = false;
			setAsking(false);
		}
	}
	askRef.current = ask;
	wakeHandler.current = (rest) => {
		const follow = rest.trim();
		setComposer("");
		dictation.arm();
		if (follow) {
			askRef.current(follow);
			return;
		}
		greet();
	};
	async function greet() {
		if (busyRef.current) return;
		busyRef.current = true;
		setAsking(true);
		const tone = personaRef.current;
		const name = personaNameRef.current || "그록";
		let line = fallbackGreet(tone);
		try {
			const result = await Promise.race([askGrok({ data: {
				message: `${name}를 불렀다. 번호 ${Math.floor(Math.random() * 1e3)}.`,
				history: [],
				persona: tone,
				ack: true
			} }), new Promise((resolve) => setTimeout(() => resolve({
				ok: false,
				error: ""
			}), 2500))]);
			if (result.ok) {
				const said = result.text.replace(/\s+/g, " ").trim().slice(0, 80);
				if (said) line = said;
			}
		} catch {}
		const at = Date.now();
		const next = [...turnsNow.current, {
			id: `gk-${at.toString(36)}`,
			speaker: "grok",
			text: line,
			at
		}];
		setTurns(next);
		reader.playFrom(next, next.length - 1);
		busyRef.current = false;
		setAsking(false);
	}
	function captureSettings() {
		return {
			rate,
			gap,
			voiceMe,
			voiceGrok,
			autoScroll,
			onlyGrok,
			autoReply,
			silence,
			wakeOn,
			persona,
			personaId,
			personas: personas.map((item) => ({ ...item }))
		};
	}
	function openSettings() {
		if (!settingsBase.current) settingsBase.current = captureSettings();
		setSheet("voice");
	}
	function saveSettings() {
		settingsBase.current = null;
		setSheet(null);
	}
	function cancelSettings() {
		const snap = settingsBase.current;
		settingsBase.current = null;
		setSheet(null);
		if (!snap) return;
		setRate(snap.rate);
		setGap(snap.gap);
		setVoiceMe(snap.voiceMe);
		setVoiceGrok(snap.voiceGrok);
		setAutoScroll(snap.autoScroll);
		setOnlyGrok(snap.onlyGrok);
		setAutoReply(snap.autoReply);
		setSilence(snap.silence);
		setWakeOn(snap.wakeOn);
		if (!snap.wakeOn) wake.halt();
		const restored = snap.personas.map((item) => ({ ...item }));
		const stay = restored.find((item) => item.id === personaIdRef.current);
		setPersonas(restored);
		if (stay) {
			setPersonaId(stay.id);
			setPersona(stay.text.slice(0, 240));
		} else {
			setPersonaId(snap.personaId);
			setPersona(snap.persona);
		}
	}
	function resetSettings() {
		setRate(1);
		setGap(.45);
		setVoiceMe("leo");
		setVoiceGrok("ara");
		setAutoScroll(true);
		setOnlyGrok(true);
		setAutoReply(true);
		setSilence(2);
		setWakeOn(true);
		wake.kick();
		const plain = personas.find((item) => item.id === "plain") ?? STARTER_PERSONAS[0];
		setPersonaId(plain.id);
		setPersona(plain.text);
	}
	function updateTurn(id, text) {
		setTurns((prev) => prev.map((t) => t.id === id ? {
			...t,
			text
		} : t));
	}
	function removeTurn(id) {
		reader.stop();
		setTurns((prev) => prev.filter((t) => t.id !== id));
		if (editingId === id) setEditingId(null);
	}
	function flipSpeakers() {
		setTurns((prev) => prev.map((t) => ({
			...t,
			speaker: t.speaker === "me" ? "grok" : "me"
		})));
	}
	function loadSample() {
		reader.stop();
		setTurns(SAMPLE_TURNS);
		setSheet(null);
		setDraftNote(null);
	}
	function selectPersona(id) {
		const item = personas.find((entry) => entry.id === id);
		if (!item) return;
		if (item.id !== personaIdRef.current) reader.stop();
		setPersonaId(item.id);
		setPersona(item.text);
		setNewPersona(null);
		setEditingId(null);
	}
	const selectedPersona = personas.find((item) => item.id === personaId) ?? personas[0];
	function updatePersona(patch) {
		if (!selectedPersona) return;
		const next = {
			...selectedPersona,
			...patch
		};
		if (!next.name.trim()) next.name = selectedPersona.name;
		setPersonas((prev) => prev.map((item) => item.id === selectedPersona.id ? next : item));
		if (patch.text !== void 0) setPersona(patch.text.slice(0, 240));
	}
	function addPersona() {
		if (!newPersona) return;
		const name = newPersona.name.trim().slice(0, 16);
		const text = newPersona.text.trim().slice(0, 240);
		const password = newPersona.password.trim();
		if (!name) {
			setBanner("페르소나 이름을 적어 주세요.");
			return;
		}
		if (password.trim().length < 4) {
			setBanner("삭제용 비밀번호는 네 글자 이상으로 해 주세요.");
			return;
		}
		if (personas.length >= 12) {
			setBanner("페르소나는 12개까지 둘 수 있습니다.");
			return;
		}
		const item = {
			id: `p-${Date.now().toString(36)}`,
			name,
			text,
			password,
			locked: false
		};
		setPersonas((prev) => [...prev, item]);
		setPersonaId(item.id);
		setPersona(text);
		setNewPersona(null);
		setBanner(null);
	}
	function deletePersona() {
		if (!selectedPersona || selectedPersona.locked) return;
		setErasePassword("");
		setEraseStep(1);
	}
	function finishDelete() {
		if (!selectedPersona || selectedPersona.locked) return;
		if (erasePassword.trim() !== selectedPersona.password.trim()) {
			setBanner("비밀번호가 맞지 않아 지우지 않았습니다.");
			return;
		}
		const next = personas.filter((item) => item.id !== selectedPersona.id);
		const fallback = next[0];
		if (!fallback) return;
		setPersonas(next);
		setThreads((prev) => {
			const copy = { ...prev };
			delete copy[selectedPersona.id];
			return copy;
		});
		setPersonaId(fallback.id);
		setPersona(fallback.text);
		setEraseStep(0);
		setErasePassword("");
		setBanner(null);
	}
	async function previewVoice(id) {
		reader.prime();
		if (reader.status === "playing") reader.toggle();
		previewAudio.current?.pause();
		if ("speechSynthesis" in window) window.speechSynthesis.cancel();
		const sample = "안녕하세요. 이 목소리입니다.";
		if (id === "device") {
			const utterance = new SpeechSynthesisUtterance(sample);
			utterance.lang = "ko-KR";
			window.speechSynthesis.speak(utterance);
			return;
		}
		setPreviewing(id);
		try {
			const result = await speakLine({ data: {
				text: sample,
				voiceId: id,
				speed: rate
			} });
			if (!result.ok) {
				setBanner(result.error);
				return;
			}
			const binary = atob(result.audio);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
			const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
			const audio = new Audio(url);
			previewAudio.current = audio;
			audio.onended = () => URL.revokeObjectURL(url);
			await audio.play();
		} catch {
			setBanner("목소리를 재생하지 못했습니다.");
		} finally {
			setPreviewing(null);
		}
	}
	const done = reader.turnIndex >= turns.length && turns.length > 0;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "mx-auto flex h-full w-full max-w-lg flex-col bg-bg text-fg",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
				className: "flex shrink-0 flex-col border-b border-line pt-3",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex items-center justify-between gap-3 px-4",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "min-w-0",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex min-w-0 items-center gap-2",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
								className: "truncate font-display text-xl leading-none tracking-tight text-fg",
								children: APP_NAME
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[11px] tabular-nums leading-none text-muted",
								"aria-label": `버전 ${APP_VERSION}`,
								children: APP_VERSION
							})]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-1 truncate text-sm text-muted",
							children: topicWith(personaName || "기본")
						})]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex shrink-0 items-center gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "inline-flex h-11 items-center gap-2 rounded-full border border-line bg-surface px-3 text-sm text-fg",
							onClick: () => {
								setDraft(turnsToText(turns));
								setSheet("script");
							},
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ClipboardPaste, {
								className: "size-4",
								"aria-hidden": "true"
							}), "불러오기"]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							"aria-label": "설정",
							className: "inline-flex size-11 items-center justify-center rounded-full border border-line bg-surface text-fg",
							onClick: openSettings,
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SlidersHorizontal, {
								className: "size-4",
								"aria-hidden": "true"
							})
						})]
					})]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "mt-3 flex gap-2 overflow-x-auto px-4 pb-3",
					role: "tablist",
					"aria-label": "페르소나별 대화",
					children: personas.map((item) => {
						const on = item.id === personaId;
						return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							role: "tab",
							"aria-selected": on,
							className: "h-10 shrink-0 rounded-full px-3 text-sm " + (on ? "bg-primary text-ink" : "border border-line text-fg"),
							onClick: () => selectPersona(item.id),
							children: item.name
						}, item.id);
					})
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
				ref: scrollerRef,
				className: "min-h-0 flex-1 overflow-y-auto px-4 py-4",
				children: [banner ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mb-3 text-sm text-pretty text-muted",
					children: banner
				}) : null, turns.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex h-full flex-col items-start justify-center gap-4",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "font-display text-3xl text-balance text-fg",
							children: [personaName || "그록", "에게 물어보세요"]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "max-w-sm text-pretty text-muted",
							children: "답을 붙이지 않아도, 그록이 말한 뒤 그 목소리로 바로 읽어 줍니다."
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: "inline-flex h-12 items-center rounded-full bg-primary px-5 text-base font-medium text-ink",
							onClick: () => setSheet("script"),
							children: "채팅 불러오기"
						})
					]
				}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", {
					className: "flex flex-col gap-3",
					children: groupTurns(turns).map((group) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "flex flex-col gap-3",
						children: [group.label ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "pt-1 text-center text-xs text-muted",
							children: group.label
						}) : null, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", {
							className: "flex flex-col gap-3",
							children: group.turns.map(({ turn, index }) => {
								const playing = reader.status !== "idle" && index === reader.turnIndex && !done;
								const chunks = chunkText(turn.text);
								const mine = turn.speaker === "me";
								const whenAt = turnTime(turn);
								const when = whenAt === null ? "" : formatWhen(whenAt);
								return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
									id: `turn-${turn.id}`,
									className: mine ? "flex justify-end" : "flex justify-start",
									children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
										className: "w-11/12 rounded-3xl border px-4 py-3 " + (mine ? "border-primary bg-primary text-ink" : "border-line bg-raised text-fg") + (playing ? " ring-2 ring-fg ring-offset-2 ring-offset-bg" : ""),
										children: [
											/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
												className: "mb-2 flex items-center justify-between gap-2",
												children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
													type: "button",
													className: "inline-flex items-center gap-2 text-sm font-medium " + (mine ? "text-ink" : "text-primary"),
													onClick: (e) => {
														e.stopPropagation();
														reader.jump(index);
													},
													children: [
														playing && reader.status === "playing" && !reader.preparing ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Equalizer, {}) : null,
														turn.speaker === "me" ? "나" : personaName || "그록",
														/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
															className: mine ? "text-ink/70" : "text-faint",
															children: index + 1
														})
													]
												}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
													className: "flex items-center gap-1",
													children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
														type: "button",
														"aria-label": "이 말 수정",
														className: "inline-flex size-9 items-center justify-center rounded-full " + (mine ? "text-ink/80" : "text-muted"),
														onClick: (e) => {
															e.stopPropagation();
															setEditingId(editingId === turn.id ? null : turn.id);
														},
														children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
															className: "text-xs font-medium",
															children: "수정"
														})
													}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
														type: "button",
														"aria-label": "이 말 지우기",
														className: "inline-flex size-9 items-center justify-center rounded-full " + (mine ? "text-ink/80" : "text-muted"),
														onClick: (e) => {
															e.stopPropagation();
															removeTurn(turn.id);
														},
														children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Trash2, {
															className: "size-4",
															"aria-hidden": "true"
														})
													})]
												})]
											}),
											editingId === turn.id ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
												value: turn.text,
												onChange: (e) => updateTurn(turn.id, e.target.value),
												className: "min-h-24 w-full resize-y rounded-2xl border px-3 py-2 text-base " + (mine ? "border-ink/20 bg-fg text-ink" : "border-line bg-bg text-fg")
											}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
												type: "button",
												className: "block w-full text-left text-base leading-relaxed text-pretty",
												onClick: () => reader.jump(index),
												children: chunks.length === 0 ? "빈 말" : chunks.map((chunk, ci) => {
													const hot = playing && ci === reader.chunkIndex;
													return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [ci > 0 ? " " : null, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
														className: hot ? mine ? "rounded-md bg-ink/15" : "rounded-md bg-primary/25" : void 0,
														children: chunk
													})] }, ci);
												})
											}),
											turn.video ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("video", {
												src: turn.video,
												controls: true,
												playsInline: true,
												preload: "metadata",
												className: "mt-3 w-full rounded-2xl bg-bg"
											}) : turn.image ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
												src: turn.image,
												alt: turn.text,
												className: "mt-3 w-full rounded-2xl bg-bg"
											}) : null,
											when ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
												className: "mt-2 text-right text-xs tabular-nums " + (mine ? "text-ink/70" : "text-muted"),
												children: when
											}) : null
										]
									})
								}, turn.id);
							})
						})]
					}, group.key))
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				className: "shrink-0 border-t border-line bg-surface px-4 py-3",
				onSubmit: (e) => {
					e.preventDefault();
					ask();
				},
				children: [
					dictation.blocked ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
						className: "mb-2 flex h-11 cursor-pointer items-center justify-center rounded-full border border-line text-sm text-fg",
						children: ["음성 파일로 받아쓰기", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							type: "file",
							accept: "audio/*",
							capture: "user",
							className: "sr-only",
							onChange: (e) => {
								const file = e.target.files?.[0];
								e.target.value = "";
								if (!file) return;
								reader.prime();
								dictation.fromFile(file);
							}
						})]
					}) : null,
					dictation.note ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mb-2 text-sm text-primary",
						role: "status",
						children: dictation.note
					}) : wake.standby ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mb-2 text-sm text-muted",
						role: "status",
						children: wakeCall.length > 1 ? `「${wakeCall[0]}」 또는 「${wakeCall[1]}」를 기다립니다` : "페르소나 이름을 정해 주세요."
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-end gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
							id: "composer",
							value: composer,
							onChange: (e) => setComposer(e.target.value),
							placeholder: dictation.hearing ? "듣고 있습니다" : "그록에게 말하면 답을 바로 읽습니다",
							rows: 2,
							disabled: asking,
							"aria-label": "그록에게 말하기",
							className: "min-h-11 min-w-0 flex-1 resize-none rounded-2xl border border-line bg-bg px-3 py-2 text-base text-fg placeholder:text-faint disabled:opacity-60"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "submit",
							disabled: asking || !composer.trim(),
							className: "h-11 shrink-0 rounded-full bg-primary px-4 text-sm font-medium text-ink disabled:opacity-40",
							children: asking ? "기다리는 중" : "듣기"
						})]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("footer", {
				className: "shrink-0 border-t border-line bg-surface",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "h-1 bg-raised",
					"aria-hidden": "true",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "h-full bg-primary transition-[width] duration-300",
						style: { width: `${progress}%` }
					})
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "px-4 pt-3 pb-4",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "mb-3 flex items-start justify-between gap-3",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "line-clamp-2 min-h-11 font-display text-base leading-snug text-fg",
								children: activeLine
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "shrink-0 pt-1 text-sm text-muted tabular-nums",
								children: [turns.length === 0 ? "0" : `${Math.min(reader.turnIndex + (done ? 0 : 1), turns.length)} / ${turns.length}`, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "mt-0.5 block text-right",
									children: duration
								})]
							})]
						}),
						reader.error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mb-2 text-sm text-primary",
							children: reader.error
						}) : null,
						!reader.supported ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mb-2 text-sm text-muted",
							children: "이 브라우저에서는 음성 읽기를 지원하지 않아요."
						}) : null,
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "grid grid-cols-[1fr_auto_1fr] items-center",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "flex items-center gap-3",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "button",
										"aria-label": reader.status === "playing" ? "일시정지" : "자동 재생",
										className: "inline-flex size-11 items-center justify-center rounded-full border border-line text-fg disabled:opacity-40",
										onClick: () => {
											reader.prime();
											reader.toggle();
										},
										disabled: !reader.supported || turns.length === 0,
										children: reader.status === "playing" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Pause, {
											className: "size-5",
											"aria-hidden": "true"
										}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Play, {
											className: "ml-0.5 size-5",
											"aria-hidden": "true"
										})
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "button",
										"aria-label": "이전 말",
										className: "inline-flex size-11 items-center justify-center rounded-full border border-line text-fg disabled:opacity-40",
										onClick: reader.prev,
										disabled: turns.length === 0,
										children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SkipBack, {
											className: "size-5",
											"aria-hidden": "true"
										})
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									type: "button",
									"aria-label": dictation.armed ? "받아쓰기 끄기" : "음성으로 말하기",
									"aria-pressed": dictation.armed,
									onClick: () => {
										reader.prime();
										dictation.toggle();
									},
									className: `inline-flex size-16 items-center justify-center rounded-full bg-primary text-ink ${dictation.armed ? "ring-2 ring-fg ring-offset-2 ring-offset-surface" : ""}`,
									children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Mic, {
										className: "size-7",
										"aria-hidden": "true"
									})
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "flex items-center justify-end gap-3",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "button",
										"aria-label": "다음 말",
										className: "inline-flex size-11 items-center justify-center rounded-full border border-line text-fg disabled:opacity-40",
										onClick: reader.next,
										disabled: turns.length === 0,
										children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SkipForward, {
											className: "size-5",
											"aria-hidden": "true"
										})
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "button",
										"aria-label": "처음으로",
										className: "inline-flex size-11 items-center justify-center rounded-full border border-line text-fg disabled:opacity-40",
										onClick: reader.stop,
										children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RotateCcw, {
											className: "size-5",
											"aria-hidden": "true"
										})
									})]
								})
							]
						})
					]
				})]
			}),
			sheet ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "fixed inset-0 z-40 flex items-end bg-bg/70",
				onClick: cancelSettings,
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					role: "dialog",
					"aria-modal": "true",
					"aria-label": sheet === "script" ? "대화 가져오기" : "설정",
					className: "max-h-[85dvh] w-full overflow-y-auto rounded-t-3xl border border-line bg-surface px-4 pt-3 pb-6",
					onClick: (e) => e.stopPropagation(),
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mb-3 flex items-center justify-between",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex gap-2",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: "h-10 rounded-full px-3 text-sm " + (sheet === "script" ? "bg-primary text-ink" : "text-muted"),
								onClick: () => setSheet("script"),
								children: "대화"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: "h-10 rounded-full px-3 text-sm " + (sheet === "voice" ? "bg-primary text-ink" : "text-muted"),
								onClick: openSettings,
								children: "설정"
							})]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							"aria-label": "닫기",
							className: "inline-flex size-10 items-center justify-center rounded-full text-muted",
							onClick: cancelSettings,
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(X, {
								className: "size-5",
								"aria-hidden": "true"
							})
						})]
					}), sheet === "script" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex flex-col gap-3",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex flex-col gap-3 rounded-2xl border border-line bg-bg px-3 py-3",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
										className: "text-sm text-pretty text-fg",
										children: "대화를 파일로 보관"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
										className: "text-sm text-pretty text-muted",
										children: "창을 닫아도 이 브라우저에는 남습니다. 클라우드·NAS는 받지 않고, 고른 폴더에 파일을 넣습니다. 드라이브나 NAS와 동기화되는 폴더를 한 번 고르면 다음부터는 그 폴더에 바로 들어갑니다. 휴대폰은 공유 창에서 앱을 고르세요. 미리보기에서는 폴더 창이 막혀 복사만 됩니다. 다시 넣으면 지금 대화가 바뀌고, 삭제용 비밀번호도 파일에 들어 있습니다."
									}),
									cloudFolder ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "flex items-center justify-between gap-2",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
											className: "min-w-0 truncate text-sm text-fg",
											children: ["올리는 곳 · ", cloudFolder]
										}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
											type: "button",
											className: "h-10 shrink-0 rounded-full border border-line px-3 text-sm text-fg disabled:opacity-40",
											disabled: cloudBusy,
											onClick: () => void sendBackup("retarget"),
											children: "다른 폴더"
										})]
									}) : null,
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "flex gap-2",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
											type: "button",
											className: "inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-primary px-3 text-sm font-medium text-ink disabled:opacity-40",
											disabled: cloudBusy,
											onClick: () => void sendBackup("cloud"),
											children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Share2, {
												className: "size-4",
												"aria-hidden": "true"
											}), "클라우드·NAS"]
										}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
											type: "button",
											className: "inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full border border-line px-3 text-sm text-fg",
											onClick: () => void sendBackup("download"),
											children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Download, {
												className: "size-4",
												"aria-hidden": "true"
											}), "기기에 저장"]
										})]
									}),
									exportText ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "flex flex-col gap-2",
										children: [
											draftNote ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
												className: "text-sm text-pretty text-primary",
												children: draftNote
											}) : null,
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
												readOnly: true,
												value: exportText,
												rows: 6,
												"aria-label": "보관한 대화",
												className: "w-full resize-y rounded-2xl border border-line bg-surface px-3 py-3 text-sm text-fg",
												onFocus: (e) => e.currentTarget.select()
											}),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
												type: "button",
												className: "h-11 rounded-full border border-line text-sm text-fg",
												onClick: () => void copyText(exportText).then((ok) => setDraftNote(ok ? "대화를 복사했습니다. 메모나 파일 앱에 붙여 넣으세요." : "복사가 막혔습니다. 위 글을 길게 눌러 선택하세요.")),
												children: "다시 복사"
											})
										]
									}) : null
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-sm text-pretty text-muted",
								children: "그록닷컴이나 그록봇에서 대화의 공유를 눌러 나온 주소를 붙여넣으세요. 계정에서 받은 JSON 파일도 됩니다. 로그인한 전체 기록은 그록이 이 앱에 열어 주지 않습니다."
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex gap-2",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									value: shareUrl,
									onChange: (e) => {
										setShareUrl(e.target.value);
										setDraftNote(null);
									},
									placeholder: "grok.com/share/…",
									"aria-label": "그록 공유 주소",
									className: "h-11 min-w-0 flex-1 rounded-full border border-line bg-bg px-4 text-base text-fg placeholder:text-faint"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: shareBusy || !shareUrl.trim(),
									className: "h-11 shrink-0 rounded-full bg-primary px-4 text-sm font-medium text-ink disabled:opacity-40",
									onClick: () => void loadShare(),
									children: shareBusy ? "여는 중" : "불러오기"
								})]
							}),
							imported && imported.length > 1 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "flex max-h-48 flex-col gap-2 overflow-y-auto",
								children: imported.map((chat, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "rounded-2xl border border-line px-3 py-2 text-left text-sm text-fg",
									onClick: () => useImported(chat),
									children: [chat.title, /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
										className: "mt-0.5 block text-muted",
										children: [chat.turns.length, "마디"]
									})]
								}, `${chat.title}-${index}`))
							}) : null,
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
								value: draft,
								onChange: (e) => {
									setDraft(e.target.value);
									setDraftNote(null);
								},
								placeholder: "나: 오늘 뭐 했어?\n그록: 붙여넣은 대화를 읽고 있었어.",
								rows: 8,
								className: "w-full resize-y rounded-2xl border border-line bg-bg px-3 py-3 text-base text-fg placeholder:text-faint"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-sm text-muted tabular-nums",
								children: draft.trim() ? parsedDraft.mode === "empty" ? "인식된 말 없음" : `말 ${parsedDraft.turns.length}개 · ${parsedDraft.mode === "labeled" ? "화자 표시 인식" : "문단을 번갈아 배치"}` : "아직 비어 있음"
							}),
							draftNote && !exportText ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-sm text-primary",
								children: draftNote
							}) : null,
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex flex-wrap gap-2",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "button",
										className: "h-11 rounded-full bg-primary px-4 text-sm font-medium text-ink",
										onClick: applyDraft,
										children: "이 대화로 듣기"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
										type: "button",
										className: "inline-flex h-11 items-center gap-2 rounded-full border border-line px-4 text-sm text-fg",
										onClick: () => fileRef.current?.click(),
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(FileUp, {
											className: "size-4",
											"aria-hidden": "true"
										}), "파일"]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
										ref: fileRef,
										type: "file",
										accept: ".txt,.md,.json,text/plain,application/json",
										className: "hidden",
										onChange: async (e) => {
											const file = e.target.files?.[0];
											e.target.value = "";
											if (!file) return;
											const text = await file.text();
											const trimmed = text.trim();
											if (trimmed.startsWith("{") || trimmed.startsWith("[")) try {
												const data = JSON.parse(trimmed);
												const backup = parseNangdokBackup(data);
												if (backup) {
													restoreBackup(backup);
													return;
												}
												const chats = chatsFromJson(data);
												if (chats.length === 1) {
													useImported(chats[0]);
													return;
												}
												if (chats.length > 1) {
													setImported(chats);
													setDraftNote("읽을 대화를 고르세요.");
													return;
												}
											} catch {
												setDraftNote("이 JSON에서 그록 대화를 찾지 못했습니다.");
												return;
											}
											setImported(null);
											setDraft(text);
											setDraftNote(null);
										}
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
										type: "button",
										className: "inline-flex h-11 items-center gap-2 rounded-full border border-line px-4 text-sm text-fg",
										onClick: flipSpeakers,
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArrowLeftRight, {
											className: "size-4",
											"aria-hidden": "true"
										}), "화자 뒤집기"]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "button",
										className: "h-11 rounded-full border border-line px-4 text-sm text-muted",
										onClick: loadSample,
										children: "예시로 바꾸기"
									})
								]
							})
						]
					}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex flex-col gap-4",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex flex-col gap-2",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "text-sm text-muted",
										children: "페르소나"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "flex flex-wrap gap-2",
										children: personas.map((item) => {
											const on = item.id === personaId;
											return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
												type: "button",
												"aria-pressed": on,
												className: "h-10 rounded-full px-3 text-sm " + (on ? "bg-primary text-ink" : "border border-line text-fg"),
												onClick: () => selectPersona(item.id),
												children: item.name
											}, item.id);
										})
									}),
									newPersona ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "flex flex-col gap-2",
										children: [
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
												value: newPersona.name,
												maxLength: 16,
												onChange: (e) => setNewPersona({
													...newPersona,
													name: e.target.value.slice(0, 16)
												}),
												placeholder: "이름",
												"aria-label": "새 페르소나 이름",
												className: "h-12 rounded-2xl border border-line bg-bg px-3 text-base text-fg"
											}),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
												value: newPersona.text,
												maxLength: 240,
												rows: 3,
												onChange: (e) => setNewPersona({
													...newPersona,
													text: e.target.value.slice(0, 240)
												}),
												placeholder: "말투. 예: 운전 중이라 짧게, 반말로 말해.",
												"aria-label": "새 페르소나 내용",
												className: "w-full resize-none rounded-2xl border border-line bg-bg px-3 py-3 text-base text-fg placeholder:text-faint"
											}),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
												type: "password",
												value: newPersona.password,
												maxLength: 32,
												autoComplete: "new-password",
												onChange: (e) => setNewPersona({
													...newPersona,
													password: e.target.value.slice(0, 32)
												}),
												placeholder: "삭제용 비밀번호",
												"aria-label": "삭제용 비밀번호",
												className: "h-12 rounded-2xl border border-line bg-bg px-3 text-base text-fg"
											}),
											/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
												className: "flex gap-2",
												children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
													type: "button",
													className: "h-11 rounded-full bg-primary px-4 text-sm font-medium text-ink",
													onClick: addPersona,
													children: "추가"
												}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
													type: "button",
													className: "h-11 rounded-full border border-line px-4 text-sm text-fg",
													onClick: () => setNewPersona(null),
													children: "취소"
												})]
											})
										]
									}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "flex flex-col gap-2",
										children: [
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
												value: selectedPersona?.name ?? "",
												maxLength: 16,
												onChange: (e) => updatePersona({ name: e.target.value.slice(0, 16) }),
												"aria-label": "페르소나 이름",
												className: "h-12 rounded-2xl border border-line bg-bg px-3 text-base text-fg"
											}),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
												value: selectedPersona?.text ?? "",
												maxLength: 240,
												rows: 3,
												onChange: (e) => updatePersona({ text: e.target.value.slice(0, 240) }),
												placeholder: "직접 적어도 됩니다. 예: 운전 중이라 짧게, 반말로 말해.",
												"aria-label": "페르소나 내용",
												className: "w-full resize-none rounded-2xl border border-line bg-bg px-3 py-3 text-base text-fg placeholder:text-faint"
											}),
											/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
												className: "flex gap-2",
												children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
													type: "button",
													className: "h-11 rounded-full border border-line px-4 text-sm text-fg",
													onClick: () => setNewPersona({
														name: "",
														text: "",
														password: ""
													}),
													children: "새 페르소나"
												}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
													type: "button",
													className: "h-11 rounded-full border border-line px-4 text-sm text-muted disabled:opacity-40",
													onClick: deletePersona,
													disabled: !selectedPersona || selectedPersona.locked,
													children: "삭제"
												})]
											}),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
												className: "text-sm text-muted",
												children: "이름과 내용을 고치면 바로 그 말투로 답합니다. 대화는 페르소나마다 따로 보입니다. 새로 만들 때 정한 비밀번호가 있어야 지울 수 있습니다."
											})
										]
									})
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(VoiceSelect, {
								label: "내 목소리 · 남자",
								value: voiceMe,
								voices: MALE_VOICES,
								previewing: previewing === voiceMe,
								onChange: setVoiceMe,
								onPreview: () => void previewVoice(voiceMe)
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(VoiceSelect, {
								label: "그록 목소리 · 여자",
								value: voiceGrok,
								voices: FEMALE_VOICES,
								previewing: previewing === voiceGrok,
								onChange: setVoiceGrok,
								onPreview: () => void previewVoice(voiceGrok)
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Slider, {
								label: "속도",
								value: rate,
								min: .7,
								max: 1.5,
								step: .05,
								display: `${rate.toFixed(2)}×`,
								onChange: setRate
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Slider, {
								label: "말 사이 쉼",
								value: gap,
								min: 0,
								max: 1.5,
								step: .05,
								display: `${gap.toFixed(2)}초`,
								onChange: setGap
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								className: "flex items-center justify-between gap-3 text-sm text-fg",
								children: ["이름을 부르면 말하기", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: wakeOn,
									onChange: (e) => {
										const on = e.target.checked;
										setWakeOn(on);
										if (on) wake.kick();
										else wake.halt();
									},
									className: "size-5 accent-primary"
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "text-sm text-pretty text-muted",
								children: [wakeCall.length > 1 ? `「${wakeCall[0]}」 또는 「${wakeCall[1]}」라고 하면 대답하고 말하기가 켜집니다.` : "페르소나 이름을 정하면 그 이름으로 부를 수 있습니다.", wakeOn && !wake.listening ? " 마이크가 아직 꺼져 있으면 스위치를 다시 켜 주세요." : ""]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								className: "flex items-center justify-between gap-3 text-sm text-fg",
								children: ["그록이 한 말만 읽기", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: onlyGrok,
									onChange: (e) => setOnlyGrok(e.target.checked),
									className: "size-5 accent-primary"
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								className: "flex items-center justify-between gap-3 text-sm text-fg",
								children: ["말이 끊기면 자동으로 답하기", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: autoReply,
									onChange: (e) => setAutoReply(e.target.checked),
									className: "size-5 accent-primary"
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Slider, {
								label: "음성 없이 기다리는 시간",
								value: silence,
								min: 1,
								max: 5,
								step: .5,
								display: `${silence.toFixed(1)}초`,
								onChange: setSilence
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								className: "flex items-center justify-between gap-3 text-sm text-fg",
								children: ["읽는 말로 자동 스크롤", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: autoScroll,
									onChange: (e) => setAutoScroll(e.target.checked),
									className: "size-5 accent-primary"
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-sm text-pretty text-muted",
								children: "마이크를 켜고 말하면 받아 적습니다. 페르소나 이름 뒤에 야나 아를 붙여 부르면 그 말투로 받고 말하기가 켜집니다. 셀카나 사진을 보내 달라고 하면 그림을, 영상이라고 하면 짧은 영상을 채팅에 넣고 읽어 줍니다. 만들기 전에는 만들었다고 말하지 않습니다. 장소, 가격, 소식 같은 정보는 그록이 인터넷에서 찾아 읽어 줍니다. 설정한 시간 동안 음성이 없으면 대답하고, 읽는 동안에는 마이크를 잠깐 멈춥니다."
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "text-center text-xs text-muted",
								children: [
									APP_NAME,
									" ",
									APP_VERSION
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "sticky bottom-0 -mx-4 flex gap-2 border-t border-line bg-surface px-4 py-3",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "button",
										className: "h-11 flex-1 rounded-full bg-primary text-sm font-medium text-ink",
										onClick: saveSettings,
										children: "저장"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "button",
										className: "h-11 flex-1 rounded-full border border-line text-sm text-fg",
										onClick: cancelSettings,
										children: "취소"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "button",
										className: "h-11 flex-1 rounded-full border border-line text-sm text-fg",
										onClick: resetSettings,
										children: "기본값"
									})
								]
							})
						]
					})]
				})
			}) : null,
			eraseStep > 0 && selectedPersona ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "fixed inset-0 z-50 flex items-center justify-center bg-bg/80 px-6",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					role: "dialog",
					"aria-modal": "true",
					"aria-label": "페르소나 삭제",
					className: "w-full max-w-sm rounded-3xl border border-line bg-surface p-4",
					children: [
						eraseStep === 1 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex flex-col gap-4",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "text-base text-pretty text-fg",
								children: [
									"「",
									selectedPersona.name,
									"」을 지울까요?"
								]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex gap-2",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									type: "button",
									className: "h-11 flex-1 rounded-full bg-primary text-sm font-medium text-ink",
									onClick: () => setEraseStep(2),
									children: "지우기"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									type: "button",
									className: "h-11 flex-1 rounded-full border border-line text-sm text-fg",
									onClick: () => setEraseStep(0),
									children: "취소"
								})]
							})]
						}) : null,
						eraseStep === 2 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex flex-col gap-4",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-base text-pretty text-fg",
								children: "한 번 더 확인합니다. 정말 삭제할까요? 되돌릴 수 없습니다."
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex gap-2",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									type: "button",
									className: "h-11 flex-1 rounded-full bg-primary text-sm font-medium text-ink",
									onClick: () => setEraseStep(3),
									children: "계속"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									type: "button",
									className: "h-11 flex-1 rounded-full border border-line text-sm text-fg",
									onClick: () => setEraseStep(0),
									children: "취소"
								})]
							})]
						}) : null,
						eraseStep === 3 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
							className: "flex flex-col gap-4",
							onSubmit: (e) => {
								e.preventDefault();
								finishDelete();
							},
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "text-base text-pretty text-fg",
									children: "삭제용 비밀번호를 입력하세요."
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									type: "password",
									value: erasePassword,
									autoFocus: true,
									autoComplete: "current-password",
									onChange: (e) => setErasePassword(e.target.value),
									"aria-label": "삭제용 비밀번호",
									className: "h-12 rounded-2xl border border-line bg-bg px-3 text-base text-fg"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "flex gap-2",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "submit",
										className: "h-11 flex-1 rounded-full bg-primary text-sm font-medium text-ink",
										children: "삭제"
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "button",
										className: "h-11 flex-1 rounded-full border border-line text-sm text-fg",
										onClick: () => setEraseStep(0),
										children: "취소"
									})]
								})
							]
						}) : null
					]
				})
			}) : null
		]
	});
}
function VoiceSelect({ label, value, voices, previewing, onChange, onPreview }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex flex-col gap-2 text-sm text-muted",
		children: [label, /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "flex items-center gap-2",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
				value,
				onChange: (e) => onChange(e.target.value),
				className: "h-11 min-w-0 flex-1 rounded-2xl border border-line bg-bg px-3 text-base text-fg",
				children: voices.map((voice) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
					value: voice.id,
					children: voice.name
				}, voice.id))
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: "h-11 shrink-0 rounded-full border border-line px-3 text-sm text-fg disabled:opacity-40",
				onClick: onPreview,
				disabled: previewing,
				children: previewing ? "듣는 중" : "목소리 확인"
			})]
		})]
	});
}
function Slider({ label, value, min, max, step, display, onChange }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
		className: "flex flex-col gap-2 text-sm text-muted",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
			className: "flex items-center justify-between",
			children: [label, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "text-fg tabular-nums",
				children: display
			})]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
			type: "range",
			min,
			max,
			step,
			value,
			onChange: (e) => onChange(Number(e.target.value)),
			className: "h-11 accent-primary"
		})]
	});
}
function wantsVideo(text) {
	const compact = text.replace(/\s+/g, "");
	if (/안보|안떠|안뜨|어디|이상|깨져|안나/.test(compact)) return false;
	if (/(영상|동영상|비디오|클립)/.test(compact) && /(만들|찍어|생성|보여|해봐|해줘|하나)/.test(compact)) return true;
	return /(영상|동영상|비디오)(로|을|를)?$/.test(compact) && compact.length > 4;
}
function videoSeconds(text) {
	const found = text.match(/(\d+)\s*초/);
	const seconds = found ? Number(found[1]) : 5;
	return Math.min(8, Math.max(2, seconds || 5));
}
function videoPrompt(text, history) {
	const cleaned = text.replace(/\d+\s*초(짜리)?/g, " ").replace(/짧은 영상|동영상|비디오|클립|영상/g, " ").replace(/베이스로|기반으로|만들어\s*봐|만들어봐|만들어\s*줘|만들어줘|해\s*봐|해봐|해\s*줘|하나/g, " ").replace(/\s+/g, " ").trim();
	if (!isVagueSubject(cleaned) && cleaned.length > 1) return cleaned.slice(0, 400);
	for (let i = history.length - 1; i >= 0; i--) {
		const content = history[i].content.replace(/\s+/g, " ").trim();
		if (!content || isAside(content) || wantsVideo(content) || wantsImage(content)) continue;
		return content.slice(0, 400);
	}
	return (cleaned || "짧은 장면이 살짝 움직인다").slice(0, 400);
}
function wantsImage(text) {
	const compact = text.replace(/\s+/g, "");
	if (/안보|안떠|안뜨|어디|이상|깨져|안나|없대|없어/.test(compact)) return false;
	if (/그려(줘|줄|봐|라|주|요)/.test(compact)) return true;
	if (/(셀카|그림|이미지|사진|일러스트).{0,8}(만들어|그려|생성해|보내|보여|찍어|달라)/.test(compact)) return !/누구|언제|왜|뭐야|맞아/.test(compact);
	if (/(셀카|사진|그림|이미지).{0,4}(줘|봐)$/.test(compact)) return true;
	if (/(이미지|그림|사진|일러스트|셀카)(로|을|를)?$/.test(compact) && compact.length > 4) return true;
	return /\b(draw|illustrat\w*|generate)\b.{0,24}\b(image|picture|photo)\b/i.test(text);
}
function imagePrompt(text, history) {
	const cleaned = text.replace(/^[가-힣]{1,8}[야아]\s+/, " ").replace(/그려\s*줘|그려줘|그려\s*줄래|그려\s*주라|그려봐|그려\s*봐|그려라|그림으로|이미지로|이미지\s*생성|만들어\s*줘|만들어줘|보내\s*줘|보내줘|보내\s*봐|보내봐|보여\s*줘|보여줘|보여\s*봐|보여봐|찍어\s*줘|찍어줘|찍어\s*봐|찍어봐|찍어/g, " ").replace(/(이미지|그림|일러스트)(로|을|를)?$/g, " ").replace(/\s+/g, " ").trim();
	if (!isVagueSubject(cleaned)) return cleaned.slice(0, 400);
	for (let i = history.length - 1; i >= 0; i--) {
		const content = history[i].content.replace(/\s+/g, " ").trim();
		if (!content || isAside(content)) continue;
		if (history[i].role === "user" && wantsImage(content)) continue;
		return content.slice(0, 400);
	}
	return (cleaned || text).slice(0, 400);
}
function isVagueSubject(cleaned) {
	const compact = cleaned.replace(/\s+/g, "");
	if (!compact) return true;
	return /^(그거|이거|저거|방금|방금말한(거|것|장면)?|그것|어떤(이미지|그림|사진)?|이미지|그림|사진|하나|장면)$/.test(compact);
}
function isAside(content) {
	return /이미지를 만들 수 없|글로만 대화|그림을 만들었|이미지를 만들었|화면에서 볼 수|화면에서 바로/.test(content);
}
function fallbackGreet(persona) {
	const text = persona.replace(/\s+/g, "");
	const formal = /비서|선생님|존댓|차분|공손/.test(text);
	const casual = /반말|친구|편하게|장난/.test(text);
	const pool = formal ? [
		"네, 듣고 있습니다.",
		"말씀하세요.",
		"네, 준비됐습니다.",
		"부르셨나요."
	] : casual ? [
		"응, 왜.",
		"어, 듣고 있어.",
		"불러? 말해.",
		"나 여기 있어."
	] : [
		"네, 듣고 있어.",
		"응, 말해.",
		"여기 있어.",
		"듣고 있어."
	];
	return pool[Math.floor(Math.random() * pool.length)];
}
function clamp(n, min, max) {
	return Math.min(max, Math.max(min, n));
}
function readThreads(saved) {
	const out = {};
	if (saved.threads && typeof saved.threads === "object") {
		for (const [key, value] of Object.entries(saved.threads)) if (Array.isArray(value) && value.every(isTurn)) out[key] = value;
	}
	const home = typeof saved.personaId === "string" && saved.personaId ? saved.personaId : "plain";
	const legacy = Array.isArray(saved.turns) && saved.turns.every(isTurn) ? saved.turns : null;
	if (legacy && legacy.length > 0 && !out[home]) out[home] = legacy;
	if (Object.keys(out).length > 0) return out;
	if (legacy) return { [home]: legacy };
	return null;
}
function turnsToText(turns) {
	return turns.map((t) => `${speakerLabel(t.speaker)}: ${t.text}`).join("\n\n");
}
function Home() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ReaderApp, {});
}
//#endregion
export { Home as component };
