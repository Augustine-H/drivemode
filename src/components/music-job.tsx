import { useEffect, useRef, useState } from "react";
import {
  connection,
  submitMusic,
  getMusic,
  cancelMusic,
  musicBlob,
  MUSIC_CONNECTION_CHANGED,
  authorizeMusicRequest,
  musicRequestAuthorized,
} from "@/lib/music-client";
import { musicStateLabel, musicTerminal, type MusicJob, type MusicRecord } from "@/lib/music-model";
import { getMedia, ingestMedia, readMediaBlob, retryMedia } from "@/lib/media-repository";
import { ManagedMedia } from "./managed-media";
import { LyricsEditor } from "./lyrics-editor";

export function MusicJobCard({
  music,
  room,
  messageId,
  onUpdate,
  onPlay,
}: {
  music: MusicRecord;
  room: string;
  messageId: string;
  onUpdate: (music: MusicRecord, mediaIds?: string[]) => void | Promise<void>;
  onPlay: () => void;
}) {
  const [job, setJob] = useState<MusicJob>(),
    [error, setError] = useState(""),
    [localId, setLocalId] = useState(""),
    [notice, setNotice] = useState(""),
    [retry, setRetry] = useState(0),
    [busy, setBusy] = useState(false);
  const update = useRef(onUpdate);
  update.current = onUpdate;
  const record = useRef(music);
  record.current = music;
  const effectiveState = job?.state ?? music.state;
  const recognition = job?.recognition ?? job?.workerResult?.recognition;
  const progress = job?.progress ?? job?.workerResult?.progress;
  const selectedJob = useRef<MusicJob | undefined>(undefined);
  selectedJob.current = job;
  useEffect(() => {
    let stopped = false;
    if (music.jobId) {
      const id = `music-${music.jobId}-mp3`;
      void readMediaBlob(id)
        .then((blob) => {
          if (blob && !stopped) setLocalId(id);
        })
        .catch(() => {});
    }
    return () => {
      stopped = true;
    };
  }, [music.jobId]);
  useEffect(() => {
    let stopped = false;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setError("");
    async function tick() {
      try {
        const c = await connection();
        if (c.url !== record.current.source)
          throw new Error("이 작업의 NAS와 현재 연결 주소가 다릅니다. 원래 NAS에 연결하세요.");
        if (!record.current.jobId && !musicRequestAuthorized(record.current.request.requestId))
          throw new Error(
            "접수 결과가 아직 저장되지 않았습니다. ‘상태·음원 다시 확인’을 누르면 같은 요청 번호로 접수를 확인합니다.",
          );
        const latest = record.current.jobId
          ? await getMusic(record.current.jobId, abort.signal)
          : await submitMusic(record.current.request, abort.signal);
        if (stopped) return;
        setJob(latest);
        setError("");
        if (latest.id !== record.current.jobId || latest.state !== record.current.state) {
          record.current = { ...record.current, jobId: latest.id, state: latest.state };
          update.current(record.current);
        }
        if (!musicTerminal(latest.state)) timer = setTimeout(() => void tick(), 3000);
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : "음악 작업 조회 오류");
      }
    }
    void tick();
    const reconnect = () => setRetry((n) => n + 1);
    window.addEventListener(MUSIC_CONNECTION_CHANGED, reconnect);
    return () => {
      stopped = true;
      abort.abort();
      clearTimeout(timer);
      window.removeEventListener(MUSIC_CONNECTION_CHANGED, reconnect);
    };
  }, [music.request.requestId, retry]);
  useEffect(() => {
    if (!job?.artifacts.mp3 || !musicTerminal(job.state)) return;
    let stopped = false;
    const abort = new AbortController();
    const completed = job;
    void (async () => {
      const id = `music-${completed.id}-mp3`;
      let item = await getMedia(id);
      // Never resurrect an item that the user trashed/deleted in the library.
      if (item && item.lifecycle !== "active") {
        setNotice(
          "MP3의 로컬 사본은 라이브러리에서 삭제·휴지통 처리되었습니다. NAS 원본은 유지됩니다.",
        );
        return;
      }
      if (!item || item.ingestState !== "complete" || !(await readMediaBlob(id))) {
        const blob = await musicBlob(completed.id, "mp3", completed.artifacts.mp3!, abort.signal);
        if (stopped) return;
        item = item
          ? await retryMedia(id, blob)
          : await ingestMedia({
              id,
              type: "music",
              origin: "generated",
              blob,
              filename: `${completed.id}.mp3`,
              description: completed.request.prompt,
              provider: completed.request.kind === "song" ? "ace_step_local" : "stable_audio_local",
              model: completed.request.kind === "song" ? "ACE-Step/acestep-v15-xl-turbo-diffusers" : "stabilityai/stable-audio-3-small-music",
              personaId: room,
              refs: [{ conversationId: room, messageId, personaId: room }],
            });
      }
      if (stopped) return;
      if (item.ingestState !== "complete") throw new Error(item.error ?? "MP3 로컬 저장 실패");
      setLocalId(id);
      update.current(record.current, [id]);
    })().catch((e) => {
      if (!stopped)
        setNotice(e instanceof Error ? e.message : "음원 저장 오류. NAS 원본은 유지됩니다.");
    });
    return () => {
      stopped = true;
      abort.abort();
    };
  }, [job, retry, room, messageId]);
  async function work(action: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await action();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "음악 작업 오류");
    } finally {
      setBusy(false);
    }
  }
  async function download(kind: "wav" | "mp3") {
    const latest = selectedJob.current;
    const artifact = latest?.artifacts[kind];
    if (!latest || !artifact) return;
    const blob = await musicBlob(latest.id, kind, artifact);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${latest.id}.${kind}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setNotice("무결성 확인 후 다운로드를 요청했습니다. 기기의 다운로드 목록에서 확인하세요.");
  }
  return (
    <section
      aria-label="음악 생성 작업"
      className="mt-3 space-y-3 rounded-2xl border border-line bg-bg p-4 text-fg"
    >
      <div role="status" aria-live="polite">
        <p className="font-medium">{musicStateLabel(effectiveState, music.request.kind)}</p>
        <p className="mt-1 text-xs text-muted">
          {music.request.duration}초 · {music.request.kind === "recognition" ? "노래 인식" : music.request.kind === "song" ? "한국어 보컬 · MP3 320 kbps" : "연주곡 · MP3 320 kbps"}
        </p>
      </div>
      {effectiveState === "QUEUED" ? (
        <p className="text-sm text-muted">
          Worker가 준비되면 시작합니다. PC 전원·연결 상태는 설정에서 확인하세요.
        </p>
      ) : null}
      {progress ? <div className="space-y-2" role="status">
        <progress aria-label="가사 받아쓰기 진행률" className="w-full" max={progress.totalChunks} value={progress.completedChunks}/>
        <p className="text-sm text-muted">{progress.completedChunks} / {progress.totalChunks}구간 · {Math.round(progress.processedSeconds)} / {Math.round(progress.totalSeconds)}초 처리</p>
      </div> : null}
      {error ? (
        <p role="alert" className="break-words text-sm text-muted">
          {error}
        </p>
      ) : null}
      {job?.error || job?.workerResult?.error ? (
        <p role="alert" className="break-words text-sm text-muted">
          {job.error?.message ?? job.workerResult?.error?.message ?? "생성이 실패했습니다."}
        </p>
      ) : null}
      {localId ? (
        <div onPlayCapture={onPlay}>
          <ManagedMedia id={localId} type="music" />
        </div>
      ) : null}
      {recognition ? (
        <div className="space-y-2 rounded-xl border border-line p-3 text-sm" aria-label="노래 인식 결과">
          {music.request.identify ? <p>{recognition.titleMatch
            ? `${recognition.titleMatch.title} · ${recognition.titleMatch.artist}`
            : recognition.identificationError ? `곡 검색 오류: ${recognition.identificationError}` : "일치하는 제목·가수를 찾지 못했습니다."}</p> : null}
          {music.request.transcribe ? <div><p className="mb-2 font-medium">AI 인식 원문 · {recognition.transcriptionProvider ?? music.request.transcriptionProvider ?? "qwen"}</p><p className="whitespace-pre-wrap break-words">{recognition.transcription || "받아쓴 가사가 없습니다."}</p></div> : null}
          {recognition.paidCall ? <p className="text-muted">유료 요청: {recognition.paidCall.elapsedSeconds}초 · 예상 ${recognition.paidCall.estimatedUsd.toFixed(6)} · 실제 청구액 미확인</p> : null}
          {recognition.warnings.map((warning, i) => <p key={i} className="text-muted">{warning}</p>)}
          {recognition.segments && recognition.segments.length > 1 ? <details>
            <summary className="min-h-11 cursor-pointer">구간별 인식 원문 확인</summary>
            {recognition.segments.map((segment, i) => <p key={i} className="mb-3 whitespace-pre-wrap">{segment.startSeconds}–{segment.endSeconds}초: {segment.text || "인식된 가사 없음"}</p>)}
          </details> : null}
        </div>
      ) : null}
      {music.request.kind === "recognition" && music.request.transcribe &&
        (music.editedLyrics || ["COMPLETED", "CANCELLED"].includes(effectiveState ?? "")) ?
        <LyricsEditor music={{ ...music, state: effectiveState }} original={recognition?.transcription} onUpdate={next => {
          record.current = next;
          return update.current(next);
        }} /> : null}
      <div className="flex flex-wrap gap-2 text-sm">
        {!musicTerminal(effectiveState) ? (
          <button
            type="button"
            disabled={busy || !job || effectiveState === "CANCEL_REQUESTED"}
            className="min-h-11 rounded-xl border border-line px-3 disabled:opacity-50"
            onClick={() =>
              void work(async () => {
                if (!job) return;
                const next = await cancelMusic(job.id);
                setJob(next);
                update.current({ ...record.current, state: next.state });
              })
            }
          >
            {music.request.kind === "recognition" ? "인식 취소" : "생성 취소"}
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          className="min-h-11 rounded-xl border border-line px-3"
          onClick={() => {
            authorizeMusicRequest(music.request.requestId);
            setRetry((n) => n + 1);
          }}
        >
          상태·음원 다시 확인
        </button>
        {(["wav", "mp3"] as const)
          .filter((kind) => job?.artifacts[kind])
          .map((kind) => (
            <button
              type="button"
              key={kind}
              disabled={busy}
              className="min-h-11 rounded-xl border border-line px-3"
              onClick={() => void work(() => download(kind))}
            >
              {kind === "wav" ? "WAV 원본 다운로드" : "MP3 다운로드"}
            </button>
          ))}
        {job?.artifacts.wav ? (
          <button
            type="button"
            disabled={busy}
            className="min-h-11 rounded-xl border border-line px-3"
            onClick={() =>
              void work(async () => {
                if (!job?.artifacts.wav) return;
                const id = `music-${job.id}-wav`;
                const existing = await getMedia(id);
                if (existing) {
                  setNotice(
                    "WAV 항목이 이미 있습니다. 라이브러리에서 보관·복원 상태를 확인하세요.",
                  );
                  return;
                }
                const blob = await musicBlob(job.id, "wav", job.artifacts.wav);
                const item = await ingestMedia({
                  id,
                  type: "music",
                  origin: "generated",
                  blob,
                  filename: `${job.id}.wav`,
                  description: job.request.prompt,
                  provider: job.request.kind === "song" ? "ace_step_local" : "stable_audio_local",
                  model: job.request.kind === "song" ? "ACE-Step/acestep-v15-xl-turbo-diffusers" : "stabilityai/stable-audio-3-small-music",
                  personaId: room,
                  refs: [{ conversationId: room, messageId, personaId: room }],
                });
                if (item.ingestState !== "complete") throw new Error(item.error);
                setNotice(
                  "WAV 원본을 앱 라이브러리에 저장했습니다. 보존 설정은 라이브러리에서 변경할 수 있습니다.",
                );
              })
            }
          >
            WAV 앱에 저장
          </button>
        ) : null}
      </div>
      {notice ? (
        <p role="status" className="break-words text-xs text-muted">
          {notice}
        </p>
      ) : null}
      {job?.id ? <p className="break-all text-xs text-muted">작업 {job.id}</p> : null}
    </section>
  );
}
