import { useEffect, useState } from "react";
import {
  connection,
  saveConnection,
  forgetConnection,
  musicHealth,
  listMusic,
  type MusicConnection,
} from "@/lib/music-client";
import { musicStateLabel, type MusicRecord } from "@/lib/music-model";
import { SongTools } from "./song-tools";

export function MusicSettings({ onRecover, personaVoice, personaName }: { onRecover: (music: MusicRecord) => void; personaVoice?: string; personaName?: string }) {
  const [url, setUrl] = useState(""),
    [token, setToken] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<Awaited<ReturnType<typeof listMusic>>>([]);
  useEffect(() => {
    void connection()
      .then((c) => setUrl(c.url))
      .catch(() => {});
  }, []);
  async function work(action: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await action();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "음악 연결 오류");
    } finally {
      setBusy(false);
    }
  }
  async function connect(value: MusicConnection) {
    await saveConnection(value);
    setUrl(value.url);
    setToken("");
    setNotice("이 기기에 연결을 저장했습니다. 생성 요청은 NAS로 직접 전송됩니다.");
  }
  return (
    <details className="rounded-2xl border border-line p-4">
      <summary className="cursor-pointer font-medium text-fg">음악 생성 · NAS 연결</summary>
      <div className="mt-4 space-y-4 text-sm">
        <p className="text-muted">
          “잔잔한 피아노 음악 30초 만들어줘”라고 말하거나 채팅에 입력하세요. 1~120초 연주곡을
          생성합니다. 서버 연결 설정을 사용하면 인증된 HTTPS를 통해 연결됩니다. 기존 Tailscale 전용 연결 설정도 유지됩니다.
        </p>
        <label className="block space-y-2">
          NAS 음악 HTTPS 주소
          <input
            aria-label="NAS 음악 HTTPS 주소"
            className="min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-fg"
            type="url"
            placeholder="https://nas-name.tailnet.ts.net:8443"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
        <label className="block space-y-2">
          클라이언트 연결 키
          <input
            aria-label="음악 클라이언트 연결 키"
            className="min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-fg"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !token}
            className="min-h-11 rounded-xl bg-primary px-4 text-ink disabled:opacity-50"
            onClick={() => void work(() => connect({ url, token }))}
          >
            연결 확인·저장
          </button>
          <label className="flex min-h-11 cursor-pointer items-center rounded-xl border border-line px-4">
            연결 파일 불러오기
            <input
              aria-label="음악 연결 파일"
              type="file"
              accept=".json,application/json"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file)
                  void work(async () => {
                    if (file.size > 4096) throw new Error("연결 파일이 너무 큽니다.");
                    const data = JSON.parse(await file.text());
                    if (
                      data.type !== "voice-grok-music-connection" ||
                      data.schema !== 1 ||
                      typeof data.url !== "string" ||
                      typeof data.token !== "string"
                    )
                      throw new Error("음악 연결 파일 형식이 아닙니다.");
                    await connect(data);
                  });
              }}
            />
          </label>
          <button
            type="button"
            disabled={busy}
            className="min-h-11 rounded-xl border border-line px-4"
            onClick={() =>
              void work(async () => {
                const h = await musicHealth();
                setNotice(
                  h.workerState === "READY"
                    ? "NAS 연결 정상 · Windows Worker 준비됨"
                    : `NAS 연결 정상 · Worker ${h.workerState === "UNKNOWN" ? "연결 미확인" : "작업 중"}. PC가 꺼져 있다고 단정할 수 없습니다.`,
                );
              })
            }
          >
            상태 확인
          </button>
          <button
            type="button"
            disabled={busy}
            className="min-h-11 rounded-xl border border-line px-4"
            onClick={() =>
              void work(async () => {
                await forgetConnection();
                setToken("");
                setJobs([]);
                setNotice("이 기기의 연결 정보를 지웠습니다. NAS 작업과 음원은 유지됩니다.");
              })
            }
          >
            연결 해제
          </button>
        </div>
        <p className="text-xs text-muted">
          연결 키는 이 브라우저의 별도 저장소에 암호화해 저장하며 기억·미디어 백업에 포함하지
          않습니다. 앱을 사용하는 기기의 다른 사용자와 공유하지 마세요. 연결 저장은 이 설정에서 즉시
          적용됩니다.
        </p>
        <button
          type="button"
          disabled={busy}
          className="min-h-11 rounded-xl border border-line px-4"
          onClick={() =>
            void work(async () => {
              setJobs(await listMusic());
              setNotice("이 NAS의 최근 작업 목록을 불러왔습니다.");
            })
          }
        >
          NAS 음원·작업 목록
        </button>
        {jobs.length ? (
          <ul className="space-y-2">
            {jobs.map((job) => (
              <li key={job.id} className="rounded-xl border border-line p-3">
                <p className="break-words text-fg">{job.request.prompt}</p>
                <p className="mt-1 text-xs text-muted">
                  {job.request.duration}초 · {musicStateLabel(job.state, job.request.kind)}
                </p>
                <button
                  type="button"
                  className="mt-2 min-h-11 rounded-xl border border-line px-3"
                  onClick={() =>
                    void work(async () => {
                      const c = await connection();
                      onRecover({
                        source: c.url,
                        request: job.request,
                        jobId: job.id,
                        state: job.state,
                      });
                      setNotice("채팅에 기존 작업을 연결했습니다. 새 음악을 만들지 않습니다.");
                    })
                  }
                >
                  채팅에서 열기
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {notice ? (
          <p role="status" className="break-words text-muted">
            {notice}
          </p>
        ) : null}
        <SongTools onRecover={onRecover} personaVoice={personaVoice} personaName={personaName} />
        {busy ? (
          <p role="status" className="text-muted">
            연결 확인 중…
          </p>
        ) : null}
      </div>
    </details>
  );
}
