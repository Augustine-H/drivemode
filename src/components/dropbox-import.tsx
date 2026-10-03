import type { PersonaAsset } from "@/lib/persona-memory";
import { useCallback, useEffect, useRef, useState } from "react";
import { DROPBOX_ROOT, getDropboxClient } from "@/lib/dropbox-client";
import type { GrokbotBackup } from "@/lib/grokbot-backup";

const SETTINGS = "voice-grok-dropbox-settings";
export function useDropboxImport(
  onImport: (
    backups: GrokbotBackup[],
    assets: PersonaAsset[],
  ) => { changed: number; errors: string[] },
  enabled: boolean,
) {
  const [connected, setConnected] = useState(false);
  const [ready, setReady] = useState(false);
  const [automatic, setAutomatic] = useState(false);
  const [root, setRoot] = useState(DROPBOX_ROOT);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [lastCheck, setLastCheck] = useState<string | null>(null);
  const state = useRef({ root, onImport });
  state.current = { root, onImport };
  const running = useRef(false);
  const epoch = useRef(0);

  const sync = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    const currentEpoch = epoch.current;
    setBusy(true);
    setNote("Dropbox에서 봇 백업을 확인하는 중입니다.");
    try {
      const result = await getDropboxClient().backups(state.current.root);
      if (currentEpoch !== epoch.current) return;
      const applied = state.current.onImport(result.backups, result.assets);
      const failures = [...result.errors, ...applied.errors];
      setErrors(failures);
      setLastCheck(new Date().toISOString());
      setNote(
        failures.length
          ? `확인 완료 · 반영 ${applied.changed}개 · 실패 ${failures.length}개`
          : result.backups.length + result.assets.length
            ? `확인 완료 · 새로 반영한 백업 ${applied.changed}개`
            : "폴더에 대화 JSON·성격 템플릿·요약 MD가 아직 없습니다.",
      );
    } catch (error) {
      if (currentEpoch !== epoch.current) return;
      setNote(error instanceof Error ? error.message : "Dropbox 확인에 실패했습니다.");
    } finally {
      running.current = false;
      if (currentEpoch === epoch.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const saved = JSON.parse(localStorage.getItem(SETTINGS) ?? "null");
        if (saved) {
          if (typeof saved.root === "string") setRoot(saved.root);
          setAutomatic(saved.automatic === true);
          if (typeof saved.lastCheck === "string") setLastCheck(saved.lastCheck);
        }
        const client = getDropboxClient();
        const query = new URLSearchParams(window.location.search);
        if (query.has("state") && (query.has("code") || query.has("error"))) {
          try {
            const finished = await client.finishAuthorization(window.location.href);
            if (active && finished) {
              setAutomatic(true);
              setNote("Dropbox 연결 완료. 봇 백업을 자동으로 확인합니다.");
            }
          } finally {
            const url = new URL(window.location.href);
            for (const key of ["code", "state", "error", "error_description"])
              url.searchParams.delete(key);
            window.history.replaceState(null, "", url.pathname + url.search + url.hash);
          }
        }
        if (active) setConnected(client.connected());
      } catch (error) {
        if (active)
          setNote(error instanceof Error ? error.message : "Dropbox 설정을 읽지 못했습니다.");
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
      epoch.current++;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(SETTINGS, JSON.stringify({ root, automatic, lastCheck }));
    } catch {
      setNote("Dropbox 자동 확인 설정을 이 기기에 저장하지 못했습니다.");
    }
  }, [root, automatic, lastCheck, ready]);

  useEffect(() => {
    if (!enabled || !ready || !connected || !automatic) return;
    const check = () => {
      if (document.visibilityState === "visible") void sync();
    };
    check();
  }, [enabled, ready, connected, automatic, root, sync]);

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-bg p-3">
      <h3 className="text-base font-medium text-fg">Dropbox 봇 대화 자동 불러오기</h3>
      <p className="text-sm text-muted">
        봇별 폴더의 대화 JSON, 성격 템플릿 JSON, 요약 MD를 같은 이름의 페르소나로 가져옵니다. 같은
        날짜는 갱신하고 다른 날짜와 앱 대화는 유지합니다. 현재 1:1 대화를 지원하며 단톡은 별도 형식
        확인이 필요합니다.
      </p>
      <label className="flex flex-col gap-2 text-sm text-fg">
        백업 폴더
        <input
          aria-label="Dropbox 백업 폴더"
          value={root}
          disabled={busy || automatic}
          onChange={(event) => {
            epoch.current++;
            setRoot(event.target.value);
          }}
          className="h-11 rounded-xl border border-line bg-surface px-3 text-fg"
        />
      </label>
      <p className="text-sm text-muted">
        봇 폴더 안에서 저장 위치를 구분하세요. 템플릿은 template 또는 templates, 요약 기억은
        memories에 넣습니다. 시간은 백업한 시각이며 템플릿은 가장 최근 파일을 적용합니다.
      </p>
      <pre className="overflow-auto whitespace-pre-wrap break-words text-sm text-muted">
        {`${root}/아라/\n  templates/2026-10-03_23-00-00_아라_template.json\n  memories/2026-10-03_23-00-00_아라_summary.md`}
      </pre>
      {connected ? (
        <>
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-fg">
            자동 확인
            <input
              type="checkbox"
              className="size-5 accent-primary"
              checked={automatic}
              onChange={(event) => {
                setAutomatic(event.target.checked);
                if (!event.target.checked) {
                  epoch.current++;
                  setBusy(false);
                  setNote("자동 확인을 껐습니다.");
                }
              }}
            />
          </label>
          <p className="text-sm text-muted">
            앱을 열 때 확인합니다. 열린 동안에는 지금 가져오기를 눌러 갱신하세요.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void sync()}
              className="h-11 flex-1 rounded-full bg-primary px-3 text-sm text-ink disabled:opacity-40"
            >
              {busy ? "확인 중" : "지금 가져오기"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                epoch.current++;
                setConnected(false);
                setAutomatic(false);
                setErrors([]);
                setNote("이 기기의 Dropbox 연결을 해제했습니다.");
                void getDropboxClient().disconnect();
              }}
              className="h-11 rounded-full border border-line px-3 text-sm text-fg disabled:opacity-40"
            >
              연결 해제
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted">
            연결하면 읽기 권한을 승인하고 연결 정보를 이 기기에 보관합니다. 공개된 앱에서
            연결하세요.
          </p>
          <button
            type="button"
            disabled={!ready || busy}
            className="h-11 rounded-full bg-primary text-sm text-ink disabled:opacity-40"
            onClick={() => {
              setBusy(true);
              void (async () => {
                try {
                  if (window.top !== window.self)
                    throw new Error("미리보기 밖에서 앱을 열고 연결하세요.");
                  const redirect = `${window.location.origin}/`;
                  const url = await getDropboxClient().authorizationUrl(redirect);
                  window.location.assign(url);
                } catch (error) {
                  setNote(
                    error instanceof Error ? error.message : "Dropbox 연결을 시작하지 못했습니다.",
                  );
                  setBusy(false);
                }
              })();
            }}
          >
            Dropbox 연결
          </button>
        </>
      )}
      {note ? (
        <p role="status" className="text-sm text-primary">
          {note}
        </p>
      ) : null}
      {lastCheck ? (
        <p className="text-sm text-muted">
          마지막 확인 · {new Date(lastCheck).toLocaleString("ko-KR")}
        </p>
      ) : null}
      {errors.length ? (
        <ul className="flex flex-col gap-1 text-sm text-muted">
          {errors.slice(0, 6).map((error, index) => (
            <li key={index}>{error}</li>
          ))}
          {errors.length > 6 ? <li>외 {errors.length - 6}개 실패</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
