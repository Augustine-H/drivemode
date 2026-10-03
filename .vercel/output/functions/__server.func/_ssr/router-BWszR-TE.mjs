import { i as __toESM } from "../_runtime.mjs";
import { _ as createFileRoute, b as require_jsx_runtime, d as Scripts, f as HeadContent, g as lazyRouteComponent, h as Outlet, m as createRouter, q as require_react, v as createRootRoute, y as useRouter } from "../_libs/@tanstack/react-router+[...].mjs";
import { n as askTurns, r as needsFacts, t as askInstructions } from "./ask-prompt-WPE00JC-.mjs";
import { n as TriangleAlert } from "../_libs/lucide-react.mjs";
import { a as union, i as string, n as number, r as object, t as literal } from "../_libs/zod.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/router-BWszR-TE.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var __defProp = Object.defineProperty;
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
var FALLBACK_MESSAGE = "An unexpected error occurred. Try reloading the page.";
function errorMessage(error) {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === "string" && error) return error;
	return FALLBACK_MESSAGE;
}
function AppErrorComponent({ error }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "text-red-500",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TriangleAlert, {
					className: "size-10",
					strokeWidth: 2
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "text-lg font-semibold",
				children: "Something went wrong"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "max-w-md text-sm break-words text-zinc-500 dark:text-zinc-400",
				children: errorMessage(error)
			})
		]
	});
}
/**
* App-wide client provider mounted once near the root (in `src/routes/__root.tsx`):
*
*   <AuthProvider><Outlet /></AuthProvider>
*
* Better Auth's React client (`@/lib/auth/client`) needs NO context provider —
* its `useSession()` works standalone — so this is a passthrough today. It's
* kept as the single, stable mount point for any future client-side providers
* (e.g. a toast or theme provider) without churning the root shell.
*/
function AuthProvider({ children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children });
}
var CONNECTOR_TOKEN_READY_EVENT = "grok:connector-token-ready";
function isGrokEmbedderOrigin(origin) {
	try {
		const url = new URL(origin);
		if (url.protocol !== "https:" && url.protocol !== "http:") return false;
		const host = url.hostname.toLowerCase();
		if (host === "grok.com" || host.endsWith(".grok.com")) return true;
		if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return true;
		return false;
	} catch {
		return false;
	}
}
function isSandboxPreviewGuestHost(hostname) {
	const host = hostname.toLowerCase();
	return host === "grok-sandbox.com" || host.endsWith(".grok-sandbox.com");
}
function isRemintPreviewPair(guestHost, parentHost) {
	const guest = guestHost.toLowerCase();
	const parent = parentHost.toLowerCase();
	const i = guest.indexOf(".preview.");
	if (i <= 0) return false;
	const label = guest.slice(0, i);
	const rest = guest.slice(i + 9);
	if (label.includes(".") || !rest.includes(".")) return false;
	return parent === rest || parent === `grok.${rest}`;
}
function resolveParentEmbedderOrigin(parentIsSelf, referrer, ancestorOrigin, guestHostname = "") {
	if (parentIsSelf) return null;
	for (const candidate of [referrer, ancestorOrigin ?? ""].filter(Boolean)) try {
		const url = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
		if (url.protocol !== "https:" && url.protocol !== "http:") continue;
		if (isGrokEmbedderOrigin(url.origin)) return url.origin;
		if (isSandboxPreviewGuestHost(guestHostname) || isRemintPreviewPair(guestHostname, url.hostname)) return url.origin;
	} catch {}
	return null;
}
/**
* Guest side of the grok-web ↔ sandbox preview postMessage bridge.
*
* Activates only when this page is framed by an allowlisted Grok embedder.
* Top-level runs (download/export, local `npm run dev`, deployed sites) noop.
*/
var PREVIEW_BRIDGE_CHANNEL = "grok-preview-bridge";
var EnvelopeSchema = object({
	channel: literal(PREVIEW_BRIDGE_CHANNEL),
	version: number().int().positive(),
	type: string().min(1)
});
var HelloSchema = EnvelopeSchema.extend({ type: literal("hello") });
var NavigateSchema = EnvelopeSchema.extend({
	type: literal("navigate"),
	path: string().min(1)
});
var HistorySchema = EnvelopeSchema.extend({
	type: literal("history"),
	delta: union([literal(-1), literal(1)])
});
var ConnectorTokenReadySchema = EnvelopeSchema.extend({ type: literal("connector-token-ready") });
function isSafeBridgePath(path) {
	if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return false;
	try {
		return new URL(path, "https://preview.invalid").origin === "https://preview.invalid";
	} catch {
		return false;
	}
}
/**
* Origin of the Grok embedder framing this page, or null when the page runs
* top-level (download/export, local `npm run dev`, deployed sites) or under a
* non-Grok parent. Client-only; null during SSR.
*/
function resolveCurrentEmbedderOrigin() {
	if (typeof window === "undefined") return null;
	const ancestorOrigin = typeof location.ancestorOrigins !== "undefined" && location.ancestorOrigins.length > 0 ? location.ancestorOrigins[0] : null;
	return resolveParentEmbedderOrigin(window.parent === window, document.referrer, ancestorOrigin, window.location.hostname);
}
/**
* Install host↔guest messaging. Returns a dispose function.
* Noops (returns a no-op dispose) when not embedded under a Grok parent.
*/
function installPreviewHostBridge(options = {}) {
	const parentOrigin = resolveCurrentEmbedderOrigin();
	if (parentOrigin === null) return () => {};
	const ROOT_STATE_KEY = "__grokPreviewBridgeRoot";
	const originalPushState = window.history.pushState.bind(window.history);
	const originalReplaceState = window.history.replaceState.bind(window.history);
	const isAtHistoryRoot = () => {
		const state = window.history.state;
		return Boolean(state && typeof state === "object" && state[ROOT_STATE_KEY] === true);
	};
	try {
		const current = window.history.state;
		if (!(current !== null && typeof current === "object" && Object.prototype.hasOwnProperty.call(current, ROOT_STATE_KEY))) {
			const isRoot = window.history.length <= 1;
			originalReplaceState(current && typeof current === "object" ? {
				...current,
				[ROOT_STATE_KEY]: isRoot
			} : { [ROOT_STATE_KEY]: isRoot }, "", window.location.href);
		}
	} catch {}
	const post = (message) => {
		window.parent.postMessage(message, parentOrigin);
	};
	const reportLocation = () => {
		post({
			channel: PREVIEW_BRIDGE_CHANNEL,
			version: 1,
			type: "location",
			path: window.location.pathname || "/",
			search: window.location.search,
			hash: window.location.hash
		});
	};
	const reportRoutes = () => {
		const paths = options.getRoutePaths?.() ?? [];
		post({
			channel: PREVIEW_BRIDGE_CHANNEL,
			version: 1,
			type: "routes",
			paths
		});
	};
	const defaultNavigate = (path) => {
		if (!isSafeBridgePath(path)) return;
		try {
			const url = new URL(path, window.location.origin);
			if (url.origin !== window.location.origin) return;
			const next = `${url.pathname}${url.search}${url.hash}`;
			window.history.pushState(window.history.state, "", next);
			window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
		} catch {}
	};
	const navigate = (path) => {
		if (!isSafeBridgePath(path)) return;
		if (options.navigate) {
			options.navigate(path);
			return;
		}
		defaultNavigate(path);
	};
	const announce = () => {
		reportLocation();
		reportRoutes();
		post({
			channel: PREVIEW_BRIDGE_CHANNEL,
			version: 1,
			type: "ready"
		});
	};
	const onHello = (data) => {
		if (!HelloSchema.safeParse(data).success) return;
		announce();
	};
	const onNavigate = (data) => {
		const parsed = NavigateSchema.safeParse(data);
		if (!parsed.success) return;
		navigate(parsed.data.path);
		queueMicrotask(reportLocation);
	};
	const onHistory = (data) => {
		const parsed = HistorySchema.safeParse(data);
		if (!parsed.success) return;
		if (parsed.data.delta === -1 && isAtHistoryRoot()) return;
		window.history.go(parsed.data.delta);
	};
	const onConnectorTokenReady = (data) => {
		if (!ConnectorTokenReadySchema.safeParse(data).success) return;
		window.dispatchEvent(new Event(CONNECTOR_TOKEN_READY_EVENT));
	};
	const hostMessageHandlers = /* @__PURE__ */ new Map([
		["hello", onHello],
		["navigate", onNavigate],
		["history", onHistory],
		["connector-token-ready", onConnectorTokenReady]
	]);
	const onMessage = (event) => {
		if (event.source !== window.parent) return;
		if (event.origin !== parentOrigin) return;
		const envelope = EnvelopeSchema.safeParse(event.data);
		if (!envelope.success || envelope.data.version !== 1) return;
		hostMessageHandlers.get(envelope.data.type)?.(event.data);
	};
	const onPopState = () => {
		reportLocation();
	};
	const onHashChange = () => {
		reportLocation();
	};
	window.history.pushState = (data, unused, url) => {
		const next = data && typeof data === "object" ? {
			...data,
			[ROOT_STATE_KEY]: false
		} : data;
		originalPushState(next, unused, url);
		reportLocation();
	};
	window.history.replaceState = (data, unused, url) => {
		const next = isAtHistoryRoot() ? {
			...data && typeof data === "object" ? data : {},
			[ROOT_STATE_KEY]: true
		} : data;
		originalReplaceState(next, unused, url);
		reportLocation();
	};
	window.addEventListener("message", onMessage);
	window.addEventListener("popstate", onPopState);
	window.addEventListener("hashchange", onHashChange);
	announce();
	return () => {
		window.removeEventListener("message", onMessage);
		window.removeEventListener("popstate", onPopState);
		window.removeEventListener("hashchange", onHashChange);
		window.history.pushState = originalPushState;
		window.history.replaceState = originalReplaceState;
	};
}
/** Collect static path patterns from a TanStack route tree (best-effort). */
function collectRoutePathsFromTree(routeTree) {
	const paths = /* @__PURE__ */ new Set();
	const walk = (node) => {
		if (!node || typeof node !== "object") return;
		const record = node;
		const full = typeof record.fullPath === "string" ? record.fullPath : typeof record.path === "string" ? record.path : null;
		if (full !== null && full !== "") paths.add(full.startsWith("/") ? full : `/${full}`);
		else if (full === "") paths.add("/");
		const children = record.children;
		if (Array.isArray(children)) for (const child of children) walk(child);
		else if (children && typeof children === "object") for (const child of Object.values(children)) walk(child);
	};
	walk(routeTree);
	return [...paths];
}
/**
* Mount once in `__root.tsx` so the Grok preview chrome can drive navigation
* (and later receive registered routes). Noops when the app is not embedded.
*/
function PreviewHostBridge() {
	const router = useRouter();
	(0, import_react.useEffect)(() => {
		return installPreviewHostBridge({
			navigate: (path) => {
				router.history.push(path);
			},
			getRoutePaths: () => collectRoutePathsFromTree(router.routeTree)
		});
	}, [router]);
	return null;
}
/** Name people see. Storage and backup files still use the old `nangdok` id. */
var APP_NAME = "보이스 그록";
/**
* The version shown in the app. Bump this when a change people can notice ships.
* major: conversations or backup files stop loading the old way
* minor: something new you can use
* patch: a fix
*/
var APP_VERSION = "1.1.0";
var styles_default = "/assets/styles-CkUn9htA.css";
var BOOT_JS = `(function(){
  if (window.__nangdokBoot) return;
  var lines = ["화면을 여는 중", "글을 그리는 중", "대화를 불러오는 중", "거의 다 됐어요"];
  var step = 0;
  window.__nangdokBoot = setInterval(function () {
    var el = document.querySelector("[data-boot-label]");
    if (!el) { clearInterval(window.__nangdokBoot); return; }
    step = Math.min(lines.length - 1, step + 1);
    el.textContent = lines[step];
    if (step === lines.length - 1) clearInterval(window.__nangdokBoot);
  }, 800);
})();`;
function BootScreen() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		id: "nangdok-boot",
		role: "status",
		"aria-live": "polite",
		suppressHydrationWarning: true,
		style: {
			position: "fixed",
			inset: 0,
			zIndex: 80,
			display: "flex",
			flexDirection: "column",
			justifyContent: "flex-end",
			gap: 14,
			padding: "28px 24px 36px",
			background: "#141210",
			color: "#f4efe6",
			fontFamily: "\"Apple SD Gothic Neo\", \"Malgun Gothic\", \"Noto Sans KR\", sans-serif"
		},
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("style", { children: `@keyframes nangdok-boot{0%{width:6%}35%{width:38%}70%{width:71%}100%{width:92%}}` }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				style: {
					margin: 0,
					fontSize: 32,
					fontWeight: 700,
					letterSpacing: "-0.04em"
				},
				children: APP_NAME
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				style: {
					margin: "-6px 0 0",
					color: "#a89f90",
					fontSize: 13
				},
				children: APP_VERSION
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				"data-boot-label": true,
				suppressHydrationWarning: true,
				style: {
					margin: 0,
					color: "#a89f90",
					fontSize: 15
				},
				children: "화면을 여는 중"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				style: {
					height: 4,
					overflow: "hidden",
					borderRadius: 999,
					background: "#2c2822"
				},
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: {
					height: "100%",
					width: "6%",
					borderRadius: 999,
					background: "#e6a15a",
					animation: "nangdok-boot 7s ease-out forwards"
				} })
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("script", { dangerouslySetInnerHTML: { __html: BOOT_JS } })
		]
	});
}
function Shell() {
	const [ready, setReady] = (0, import_react.useState)(false);
	(0, import_react.useLayoutEffect)(() => {
		setReady(true);
	}, []);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("html", {
		lang: "ko",
		suppressHydrationWarning: true,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("head", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HeadContent, {}) }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("body", { children: [
			ready ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(BootScreen, {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PreviewHostBridge, {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(AuthProvider, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Outlet, {}) }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Scripts, {})
		] })]
	});
}
var Route$2 = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1"
			},
			{ title: APP_NAME },
			{
				name: "description",
				content: "보이스 그록. 그록과 목소리로 대화하고, 답을 바로 읽어 줍니다."
			},
			{
				name: "theme-color",
				content: "#141210"
			}
		],
		links: [
			{
				rel: "icon",
				type: "image/svg+xml",
				href: "/favicon.svg"
			},
			{
				rel: "stylesheet",
				href: styles_default
			},
			{
				rel: "manifest",
				href: "/__grok/manifest.webmanifest"
			},
			{
				rel: "apple-touch-icon",
				href: "/__grok/icon-180.png"
			}
		]
	}),
	component: Shell
});
var $$splitComponentImporter = () => import("./routes-CClVPEPC.mjs");
var Route$1 = createFileRoute("/")({ component: lazyRouteComponent($$splitComponentImporter, "component") });
function spoken(text) {
	return text.replace(/```[\s\S]*?```/g, " ").replace(/!\[[^\]]*]\([^)]*\)/g, " ").replace(/\[[^\]]*]\([^)]*\)/g, " ").replace(/[#>*_`[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 700);
}
function canSpeak(text) {
	return /[.!?。！？…]$/.test(text) || text.length >= 28 && /[,，、]$/.test(text);
}
function deltaOf(event) {
	if (!event || typeof event !== "object") return "";
	const row = event;
	if (row.type === "response.output_text.delta" && typeof row.delta === "string") return row.delta;
	const content = row.choices?.[0]?.delta?.content;
	return typeof content === "string" ? content : "";
}
async function streamAnswer(message, history, persona) {
	const apiKey = process.env.XAI_API_KEY;
	if (!apiKey) return Response.json({ error: "그록에게 물어볼 수 없습니다." }, { status: 503 });
	const facts = needsFacts(message);
	const upstream = await fetch("https://api.x.ai/v1/responses", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json"
		},
		signal: AbortSignal.timeout(2e4),
		body: JSON.stringify({
			model: "grok-4.5",
			stream: true,
			max_output_tokens: facts ? 140 : 90,
			...facts ? {
				max_tool_calls: 1,
				tools: [{ type: "web_search" }]
			} : {},
			input: [
				{
					role: "system",
					content: askInstructions(persona, false, facts)
				},
				...history.map((item) => ({
					role: item.role,
					content: item.content
				})),
				{
					role: "user",
					content: message
				}
			]
		})
	});
	if (!upstream.ok || !upstream.body) return Response.json({ error: "그록이 대답하지 못했습니다." }, { status: 502 });
	const encoder = new TextEncoder();
	const stream = new ReadableStream({ async start(controller) {
		const send = (payload) => {
			controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
		};
		const reader = upstream.body.getReader();
		const decoder = new TextDecoder();
		let buf = "";
		let raw = "";
		let sent = "";
		try {
			while (true) {
				const step = await reader.read();
				if (step.done) break;
				buf += decoder.decode(step.value, { stream: true });
				const lines = buf.split("\n");
				buf = lines.pop() ?? "";
				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed.startsWith("data:")) continue;
					const payload = trimmed.slice(5).trim();
					if (!payload || payload === "[DONE]") continue;
					try {
						raw += deltaOf(JSON.parse(payload));
					} catch {
						continue;
					}
					const text = spoken(raw);
					if (text && text !== sent && canSpeak(text)) {
						sent = text;
						send({ text });
					}
				}
			}
			send({
				text: spoken(raw),
				done: true
			});
		} catch {
			send({ error: "그록에게 연결하지 못했습니다." });
		} finally {
			controller.close();
		}
	} });
	return new Response(stream, { headers: {
		"content-type": "text/event-stream; charset=utf-8",
		"cache-control": "no-cache, no-transform"
	} });
}
var Route = createFileRoute("/api/ask")({ server: { handlers: { POST: async ({ request }) => {
	let body;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "물어볼 말이 없습니다." }, { status: 400 });
	}
	const message = String(body.message ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
	if (!message) return Response.json({ error: "물어볼 말이 없습니다." }, { status: 400 });
	const history = askTurns((Array.isArray(body.history) ? body.history : []).map((item) => {
		const row = item;
		return {
			role: row?.role === "assistant" ? "assistant" : "user",
			content: String(row?.content ?? "")
		};
	})).filter((item) => item.content);
	const persona = String(body.persona ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
	try {
		return await streamAnswer(message, history, persona);
	} catch {
		return Response.json({ error: "그록에게 연결하지 못했습니다." }, { status: 502 });
	}
} } } });
var rootRouteChildren = {
	IndexRoute: Route$1.update({
		id: "/",
		path: "/",
		getParentRoute: () => Route$2
	}),
	ApiAskRoute: Route.update({
		id: "/api/ask",
		path: "/api/ask",
		getParentRoute: () => Route$2
	})
};
var routeTree = Route$2._addFileChildren(rootRouteChildren)._addFileTypes();
var router_exports = /* @__PURE__ */ __exportAll({ getRouter: () => getRouter });
function getRouter() {
	return createRouter({
		routeTree,
		defaultErrorComponent: AppErrorComponent
	});
}
//#endregion
export { APP_NAME as n, APP_VERSION as r, router_exports as t };
