import { useLayoutEffect, useState } from "react";
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { APP_NAME, APP_VERSION } from "@/lib/app-meta";
import appCss from "../styles.css?url";

const BOOT_JS = `(function(){
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
  return (
    <div
      id="nangdok-boot"
      role="status"
      aria-live="polite"
      suppressHydrationWarning
      style={{
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
        fontFamily: '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif',
      }}
    >
      <style>{`@keyframes nangdok-boot{0%{width:6%}35%{width:38%}70%{width:71%}100%{width:92%}}`}</style>
      <p style={{ margin: 0, fontSize: 32, fontWeight: 700, letterSpacing: "-0.04em" }}>{APP_NAME}</p>
      <p style={{ margin: "-6px 0 0", color: "#a89f90", fontSize: 13 }}>{APP_VERSION}</p>
      <p data-boot-label suppressHydrationWarning style={{ margin: 0, color: "#a89f90", fontSize: 15 }}>
        화면을 여는 중
      </p>
      <div style={{ height: 4, overflow: "hidden", borderRadius: 999, background: "#2c2822" }}>
        <div
          style={{
            height: "100%",
            width: "6%",
            borderRadius: 999,
            background: "#e6a15a",
            animation: "nangdok-boot 7s ease-out forwards",
          }}
        />
      </div>
      <script dangerouslySetInnerHTML={{ __html: BOOT_JS }} />
    </div>
  );
}

function Shell() {
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    setReady(true);
  }, []);
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {ready ? null : <BootScreen />}
        <PreviewHostBridge />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      {
        name: "description",
        content: "보이스 그록. 그록과 목소리로 대화하고, 답을 바로 읽어 줍니다.",
      },
      { name: "theme-color", content: "#141210" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
    ],
  }),
  component: Shell,
});
