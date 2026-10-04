import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { audioLevel, estimateTempo } from "@/lib/music-analysis";
import { recognizeMusic } from "@/lib/recognize-music";

type Props = {
  request: number;
  blocked: boolean;
  stopRef: MutableRefObject<() => void>;
  onPrepare: () => void;
  onFinished: () => void;
  onResult: (text: string) => void;
};
export function MusicListener({
  request,
  blocked,
  stopRef,
  onPrepare,
  onFinished,
  onResult,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [identify, setIdentify] = useState(true);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(-90);
  const [result, setResult] = useState("");
  const cleanup = useRef<(() => void) | null>(null);
  const epoch = useRef(0);
  const startRef = useRef<() => void>(() => {});
  const section = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (request > 0) {
      if (section.current) section.current.open = true;
      startRef.current();
    }
  }, [request]);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;
  useEffect(
    () => () => {
      epoch.current++;
      cleanup.current?.();
      finishedRef.current();
      stopRef.current = () => {};
    },
    [stopRef],
  );

  async function start() {
    if (busy) return;
    const job = ++epoch.current;
    onPrepare();
    setBusy(true);
    setResult("");
    setSeconds(0);
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let recorder: MediaRecorder | undefined;
    let finish: (() => void) | undefined;
    const dispose = () => {
      if (timer) clearInterval(timer);
      if (timeout) clearTimeout(timeout);
      if (recorder?.state === "recording") recorder.stop();
      stream?.getTracks().forEach((track) => track.stop());
      if (context && context.state !== "closed") void context.close();
      finish?.();
    };
    cleanup.current = dispose;
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error("이 환경에서는 마이크를 사용할 수 없습니다.");
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      if (job !== epoch.current) {
        dispose();
        return;
      }
      context = new AudioContext();
      await context.resume();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const levels: number[] = [];
      const dbs: number[] = [];
      const times: number[] = [];
      const chunks: Blob[] = [];
      if (identify) {
        if (typeof MediaRecorder === "undefined")
          throw new Error(
            "이 브라우저는 곡 찾기 녹음을 지원하지 않습니다. 곡 찾기를 끄면 분석할 수 있습니다.",
          );
        recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (event) => {
          if (event.data.size) chunks.push(event.data);
        };
        recorder.start();
      }
      const started = performance.now();
      timer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        const current = audioLevel(samples);
        levels.push(current.rms);
        dbs.push(current.db);
        times.push(performance.now());
        setLevel(current.db);
        setSeconds(Math.min(12, Math.floor((performance.now() - started) / 1000)));
      }, 50);
      await new Promise<void>((resolve) => {
        finish = resolve;
        timeout = setTimeout(() => {
          if (recorder) {
            recorder.onstop = () => resolve();
            recorder.stop();
          } else resolve();
        }, 12000);
      });
      const mime = recorder?.mimeType ?? "audio/webm";
      dispose();
      if (job !== epoch.current) return;
      const average = dbs.reduce((sum, db) => sum + db, 0) / Math.max(1, dbs.length);
      const interval =
        times.length > 1 ? (times.at(-1)! - times[0]) / (times.length - 1) / 1000 : 0.05;
      const bpm = estimateTempo(levels, interval);
      let text = `주변 소리 평균 음량 ${average.toFixed(1)} dBFS. ${bpm ? `추정 박자 약 ${bpm} BPM.` : "박자를 안정적으로 추정하지 못했습니다."}`;
      if (identify) {
        setResult("녹음 완료 · 곡을 확인하는 중입니다.");
        const blob = new Blob(chunks, { type: mime });
        const audio = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        if (job !== epoch.current) return;
        const song = await recognizeMusic({ data: { audio, mime } }).catch(() => ({
          ok: false as const,
          error: "곡 찾기 서비스에 연결하지 못했습니다.",
        }));
        if (job !== epoch.current) return;
        text = song.ok
          ? `지금 나오는 곡: ${song.artist} — ${song.title}. ${text}`
          : `${song.error}\n${text}`;
      }
      setResult(text);
      onResult(text);
    } catch (error) {
      if (job === epoch.current)
        setResult(error instanceof Error ? error.message : "음악을 듣지 못했습니다.");
    } finally {
      dispose();
      if (job === epoch.current) {
        cleanup.current = null;
        setBusy(false);
        finishedRef.current();
      }
    }
  }
  startRef.current = () => {
    void start();
  };
  function stop() {
    epoch.current++;
    cleanup.current?.();
    cleanup.current = null;
    setBusy(false);
    setResult("음악 듣기를 취소했습니다.");
    finishedRef.current();
  }
  stopRef.current = stop;
  return (
    <details className="rounded-2xl border border-line p-3" ref={section}>
      <summary className="min-h-11 cursor-pointer py-3 font-medium">
        지금 나오는 곡 · 음량·박자 분석
      </summary>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-muted">
          12초 동안 주변 음악을 듣습니다. “지금 나오는 곡 알려줘”라고 채팅해도 시작합니다.
        </p>
        <label className="flex min-h-11 items-center justify-between">
          곡 이름도 찾기
          <input
            type="checkbox"
            checked={identify}
            disabled={busy}
            onChange={(e) => setIdentify(e.target.checked)}
          />
        </label>
        <p className="text-muted">
          곡 찾기를 켜면 녹음이 AudD에 전송됩니다. 연결 키는 서버에서 설정합니다. 끄면 음량·박자만
          기기에서 분석하며 녹음을 저장하지 않습니다.
        </p>
        <button
          type="button"
          className="min-h-11 rounded-full bg-primary px-4 text-ink"
          disabled={!busy && blocked}
          onClick={busy ? stop : () => void start()}
        >
          {busy ? "음악 듣기 중지" : "12초 음악 듣기"}
        </button>
        {busy ? (
          <p role="status">
            {seconds} / 12초 · 입력 음량 {level.toFixed(1)} dBFS
          </p>
        ) : null}
        {result ? (
          <p role="status" className="whitespace-pre-line text-fg">
            {result}
          </p>
        ) : null}
        <p className="text-muted">
          dBFS는 마이크 입력 기준이며 실제 소음계의 dB SPL과 다릅니다. BPM은 주변 소음이나 반·두 배
          박자의 영향을 받는 추정치입니다. 다른 앱의 소리를 직접 읽지 않고 마이크로 들리는 소리를
          분석합니다.
        </p>
        <a
          className="min-h-11 py-3 text-primary underline"
          href="https://www.shazam.com/"
          target="_blank"
          rel="noreferrer"
        >
          Shazam 열기
        </a>
      </div>
    </details>
  );
}
