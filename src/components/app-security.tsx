import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { checkLock, makeLock, LOCK_KEY, type LockConfig } from "@/lib/app-lock";

const SecurityContext = createContext({
  enabled: false,
  privacy: true,
  configure: async (_password: string, _disable: boolean) => {},
  setPrivacy: (_value: boolean) => {},
  lock: () => {},
});
export function AppSecurity({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<LockConfig | null>(null);
  const [locked, setLocked] = useState(true);
  const [privacy, setPrivate] = useState(true);
  const [password, setPassword] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const curtain = useRef<HTMLDivElement>(null);
  const delayUntil = useRef(0);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOCK_KEY);
      if (raw) {
        try {
          setConfig(JSON.parse(raw));
        } catch {
          setConfig({ salt: "", hash: "" });
        }
      }
      setLocked(!!raw);
      setPrivate(localStorage.getItem("voice-grok-privacy") !== "false");
      setReady(true);
    } catch {
      setNote("기기 저장소를 열 수 없습니다. 브라우저의 저장소 접근을 허용하세요.");
    }
  }, []);
  useEffect(() => {
    const hide = () => {
      if (privacy && curtain.current) curtain.current.hidden = false;
      if (config) {
        setLocked(true);
        setPassword("");
      }
    };
    const show = () => {
      if (!document.hidden && curtain.current) curtain.current.hidden = true;
    };
    const change = () => (document.hidden ? hide() : show());
    window.addEventListener("blur", hide);
    window.addEventListener("focus", show);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    document.addEventListener("visibilitychange", change);
    return () => {
      window.removeEventListener("blur", hide);
      window.removeEventListener("focus", show);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
      document.removeEventListener("visibilitychange", change);
    };
  }, [config, privacy]);
  async function unlock() {
    if (!config || busy) return;
    if (Date.now() < delayUntil.current) {
      setNote("잠시 후 다시 입력하세요.");
      return;
    }
    setBusy(true);
    try {
      if (await checkLock(password, config)) {
        setLocked(false);
        setNote("");
      } else {
        delayUntil.current = Date.now() + 3000;
        setNote("비밀번호가 맞지 않습니다. 3초 후 다시 입력하세요.");
      }
    } catch {
      setNote("이 브라우저에서는 잠금을 해제하지 못했습니다.");
    } finally {
      setPassword("");
      setBusy(false);
    }
  }
  return (
    <SecurityContext.Provider
      value={{
        enabled: !!config,
        privacy,
        configure: async (value, disable) => {
          if (config && !(await checkLock(value, config)))
            throw new Error("현재 비밀번호가 맞지 않습니다.");
          const next = disable ? null : await makeLock(value);
          if (next) localStorage.setItem(LOCK_KEY, JSON.stringify(next));
          else localStorage.removeItem(LOCK_KEY);
          setConfig(next);
          setLocked(false);
        },
        setPrivacy: (value) => {
          localStorage.setItem("voice-grok-privacy", String(value));
          setPrivate(value);
        },
        lock: () => setLocked(true),
      }}
    >
      <div ref={curtain} hidden className="privacy-curtain" aria-label="화면 내용 가림" />
      {!ready || locked ? (
        <main className="flex min-h-dvh items-center justify-center bg-bg p-6 text-fg">
          <form
            className="w-full max-w-sm space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void unlock();
            }}
          >
            <h1 className="text-2xl">보이스 그록 {ready ? "잠금" : "준비 중"}</h1>
            {ready && config ? (
              <>
                <p className="text-sm text-muted">대화를 보려면 비밀번호를 입력하세요.</p>
                <input
                  autoFocus
                  type="password"
                  autoComplete="current-password"
                  aria-label="앱 잠금 비밀번호"
                  className="min-h-12 w-full rounded-xl border border-line bg-surface px-4"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  disabled={busy}
                  className="min-h-12 w-full rounded-full bg-primary text-ink"
                >
                  잠금 해제
                </button>
              </>
            ) : null}
            {note ? (
              <p role="alert" className="text-sm text-muted">
                {note}
              </p>
            ) : null}
          </form>
        </main>
      ) : (
        children
      )}
    </SecurityContext.Provider>
  );
}
export function AppSecuritySettings() {
  const security = useContext(SecurityContext);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function configure(disable: boolean) {
    if (!disable && password !== confirm) {
      setNote("비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    setBusy(true);
    try {
      await security.configure(password, disable);
      setPassword("");
      setConfirm("");
      setNote(disable ? "앱 잠금을 해제했습니다." : "앱 잠금을 켰습니다.");
    } catch (error) {
      setNote(error instanceof Error ? error.message : "설정 저장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded-2xl border border-line p-4">
      <h3>화면 보호·앱 잠금</h3>
      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          checked={security.privacy}
          onChange={(event) => {
            try {
              security.setPrivacy(event.target.checked);
            } catch {
              setNote("화면 보호 설정을 저장하지 못했습니다.");
            }
          }}
        />
        앱을 벗어나면 화면 검정색으로 가리기
      </label>
      <p className="text-sm text-muted">
        안드로이드 최근 앱 미리보기는 촬영 시점에 따라 가림이 적용되지 않을 수 있습니다. 완전한
        차단에는 안드로이드 네이티브 앱이 필요합니다.
      </p>
      <p className="text-sm">앱 잠금: {security.enabled ? "켜짐" : "꺼짐"}</p>
      <p className="text-sm text-muted">
        잠금을 켜면 다시 열거나 앱을 벗어난 후 돌아올 때 비밀번호로 확인합니다. 이 기기에서만
        적용되며 저장된 대화 자체를 암호화하지는 않습니다. 비밀번호를 잊으면 앱에서 복구할 수
        없습니다.
      </p>
      <input
        type="password"
        autoComplete={security.enabled ? "current-password" : "new-password"}
        aria-label={security.enabled ? "현재 앱 비밀번호" : "새 앱 비밀번호"}
        placeholder={security.enabled ? "현재 비밀번호" : "새 비밀번호 (6글자 이상)"}
        className="min-h-11 w-full rounded-xl border border-line bg-bg px-3"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      {!security.enabled ? (
        <input
          type="password"
          autoComplete="new-password"
          aria-label="새 앱 비밀번호 확인"
          placeholder="비밀번호 확인"
          className="min-h-11 w-full rounded-xl border border-line bg-bg px-3"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
      ) : null}
      <button
        type="button"
        disabled={busy}
        className="min-h-11 w-full rounded-full border border-line"
        onClick={() => void configure(security.enabled)}
      >
        {security.enabled ? "비밀번호 확인 후 잠금 끄기" : "비밀번호로 앱 잠금 켜기"}
      </button>
      {security.enabled ? (
        <button
          type="button"
          className="min-h-11 w-full rounded-full border border-line"
          onClick={security.lock}
        >
          지금 잠그기
        </button>
      ) : null}
      <p className="text-xs text-muted">
        패턴·지문은 현재 웹앱에서 제공하지 않습니다. 위 설정은 즉시 저장됩니다.
      </p>
      {note ? (
        <p role="status" className="text-sm text-muted">
          {note}
        </p>
      ) : null}
    </section>
  );
}
