import { useEffect, useRef, useState } from "react";
import { matchVoice, similarity, SPEAKER_MODEL, type VoiceIdentity } from "@/lib/speaker-identity";
import { speakerEmbedding, releaseSpeakerModel } from "@/lib/speaker-client";
export function VoiceIdentitySettings({
  identity,
  onChange,
  onStart,
  error,
}: {
  identity: VoiceIdentity | null;
  onChange: (v: VoiceIdentity | null) => void;
  onStart: () => void;
  error: string;
}) {
  const [samples, setSamples] = useState<number[][]>([]);
  const [phase, setPhase] = useState<"idle" | "recording" | "processing">("idle");
  const [note, setNote] = useState("");
  const [removing, setRemoving] = useState(false);
  const capture = useRef<{
    rec: MediaRecorder;
    stream: MediaStream;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const epoch = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const cancel = () => {
      epoch.current++;
      const c = capture.current;
      capture.current = null;
      if (c) {
        clearTimeout(c.timer);
        if (c.rec.state !== "inactive") c.rec.stop();
        c.stream.getTracks().forEach((t) => t.stop());
      }
      releaseSpeakerModel();
      if (mounted.current) {
        setPhase("idle");
        setNote("목소리 등록이 중단되었습니다.");
      }
    };
    const hidden = () => {
      if (document.hidden) cancel();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      mounted.current = false;
      cancel();
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  async function record(testOnly = false) {
    onStart();
    const id = ++epoch.current;
    setPhase("recording");
    setNote("모델은 첫 사용 때 다운로드됩니다. 8초 동안 아래 문장을 또렷하게 읽어 주세요.");
    let stream: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined")
        throw new Error("이 브라우저에서는 목소리를 등록할 수 없습니다.");
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (!mounted.current || id !== epoch.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      const recorded = new Promise<Blob>((resolve, reject) => {
        rec.ondataavailable = (e) => {
          if (e.data.size) chunks.push(e.data);
        };
        rec.onerror = () => reject(new Error("녹음하지 못했습니다."));
        rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType }));
      });
      const timer = setTimeout(() => {
        if (rec.state !== "inactive") rec.stop();
      }, 8000);
      capture.current = { rec, stream, timer };
      rec.start();
      const audio = await recorded;
      clearTimeout(timer);
      stream.getTracks().forEach((t) => t.stop());
      capture.current = null;
      if (!mounted.current || id !== epoch.current) return;
      setPhase("processing");
      setNote("기기 안에서 목소리를 분석하는 중입니다.");
      const embedding = await speakerEmbedding(audio, (n) => {
        if (mounted.current && id === epoch.current) setNote(n);
      });
      if (!mounted.current || id !== epoch.current) return;
      if (testOnly && identity) {
        const result = matchVoice(identity.samples, embedding, identity.threshold);
        setNote(
          `일치도 ${Math.round(result.score * 100)}점 · 기준 ${Math.round(identity.threshold * 100)}점 · ${result.accepted ? "질문 허용" : "질문 거절"}. 거절되면 기준을 조금 낮추거나 실제 사용 환경에서 다시 등록하세요.`,
        );
        return;
      }
      if (samples.some((s) => similarity(s, embedding) < 0.75))
        throw new Error("앞서 등록한 목소리와 다릅니다. 주변 안내음을 끄고 다시 읽어 주세요.");
      const next = [...samples, embedding];
      if (next.length === 3) {
        onChange({
          version: 1,
          model: SPEAKER_MODEL,
          enabled: identity?.enabled ?? false,
          threshold: identity?.threshold ?? 0.8,
          samples: next,
          registeredAt: new Date().toISOString(),
        });
        setSamples([]);
        setNote("목소리 등록 완료. 아래 선택 항목을 켜면 적용됩니다.");
      } else {
        setSamples(next);
        setNote(`${next.length}/3회 등록했습니다. 다음 문장을 읽어 주세요.`);
      }
    } catch (e) {
      if (mounted.current && id === epoch.current)
        setNote(e instanceof Error ? e.message : "목소리 등록에 실패했습니다.");
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
      if (mounted.current && id === epoch.current) setPhase("idle");
    }
  }
  return (
    <details className="space-y-3 rounded-2xl border border-line p-3">
      <summary className="min-h-11 cursor-pointer py-3 font-medium">
        내 목소리만 받기 · 실험 기능
      </summary>
      <p className="text-sm text-muted">
        조용한 곳에서 내 목소리를 3회 등록합니다. 비교 모델 약 102MB와 실행 파일을 첫 사용 때
        다운로드하고 기기 안에서 실행합니다. 원본 녹음은 저장·업로드하지 않고, 목소리 특징만 이
        기기에 보관합니다. 설정은 즉시 저장되며 대화 백업에 포함되지 않습니다.
      </p>
      <p className="text-sm">
        {identity ? "목소리 등록됨" : "등록된 목소리 없음"} · 등록 진행 {samples.length}/3
      </p>
      <p className="rounded-xl bg-bg p-3 text-sm">
        {
          [
            "오늘은 내 목소리를 등록합니다. 아라야, 내 말을 듣고 편안하게 이야기해 줘.",
            "차 안에서도 내 목소리만 알아듣도록 확인합니다. 오늘 하루는 즐거웠어요.",
            "지금 말하는 사람은 나입니다. 다른 안내 소리와 구분해서 내 질문에 대답해 주세요.",
          ][samples.length]
        }
      </p>
      <button
        type="button"
        className="min-h-11 rounded-full border border-line px-4 text-sm"
        disabled={phase !== "idle"}
        onClick={() => void record()}
      >
        {phase === "recording"
          ? "8초 녹음 중"
          : phase === "processing"
            ? "목소리 분석 중"
            : identity && samples.length === 0
              ? "목소리 다시 등록"
              : "목소리 등록 시작"}
      </button>
      {identity ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="min-h-11 rounded-full border border-line px-4 text-sm"
            disabled={phase !== "idle"}
            onClick={() => void record(true)}
          >
            등록 목소리 확인
          </button>
          <button
            type="button"
            className="min-h-11 rounded-full border border-line px-4 text-sm"
            disabled={phase !== "idle"}
            onClick={() => onChange({ ...identity, threshold: 0.8 })}
          >
            일치 기준 80점 적용
          </button>
        </div>
      ) : null}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          disabled={!identity || phase !== "idle"}
          checked={identity?.enabled === true}
          onChange={(e) => {
            onStart();
            if (identity) onChange({ ...identity, enabled: e.target.checked });
          }}
        />
        등록한 내 목소리만 질문으로 받기
      </label>
      {identity ? (
        <label className="block text-sm">
          일치 기준 {Math.round(identity.threshold * 100)}점
          <input
            aria-label="목소리 일치 기준"
            className="mt-2 w-full"
            type="range"
            min="0.75"
            max="0.95"
            step="0.01"
            value={identity.threshold}
            disabled={phase !== "idle"}
            onChange={(e) => {
              onStart();
              onChange({ ...identity, threshold: Number(e.target.value) });
            }}
          />
        </label>
      ) : null}
      <p className="text-xs text-muted">
        수치는 유사도 기준이며 정확도 확률이 아닙니다. 높이면 다른 목소리를 더 엄격하게 거르지만 내
        목소리도 거절될 수 있습니다. 이름 호출 설정을 켜면 마이크를 길게 눌러 말할 수 있습니다.
        확인을 통과한 음성만 기존 받아쓰기 API로 전송하므로 받아쓰기·답변 API 비용은 발생할 수
        있습니다. 소음·겹친 목소리·녹음 재생을 완벽히 구별하는 보안 기능은 아닙니다.
      </p>
      {note || error ? (
        <p role="status" className="text-sm text-muted">
          {error || note}
        </p>
      ) : null}
      {identity || error ? (
        <button
          type="button"
          disabled={phase !== "idle"}
          className="min-h-11 rounded-full border border-line px-4 text-sm"
          onClick={() => setRemoving(true)}
        >
          등록 목소리 삭제
        </button>
      ) : null}
      {removing ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <p>등록한 목소리를 삭제하고 이 기능을 끌까요?</p>
          <button
            className="min-h-11 px-3"
            onClick={() => {
              onStart();
              onChange(null);
              setSamples([]);
              setRemoving(false);
            }}
          >
            삭제 확인
          </button>
          <button className="min-h-11 px-3" onClick={() => setRemoving(false)}>
            취소
          </button>
        </div>
      ) : null}
    </details>
  );
}
