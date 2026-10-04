import type { useAudioAwareness } from "@/lib/use-audio-awareness";
export function AudioAwarenessSettings({ audio }: { audio: ReturnType<typeof useAudioAwareness> }) {
  const { settings } = audio;
  return (
    <details className="rounded-2xl border border-line p-3">
      <summary className="min-h-11 cursor-pointer py-3 font-medium">
        소리 인식 · Audio Awareness
      </summary>
      <div className="space-y-3 pt-2">
        <label className="flex min-h-11 items-center justify-between gap-3">
          소리 인식 사용
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => audio.configure({ ...settings, enabled: e.target.checked })}
            className="size-5 accent-primary"
          />
        </label>
        {(
          [
            ["microphone", "마이크 주변 소리 인식"],
            ["system", "PC 시스템 소리 인식"],
          ] as const
        ).map(([source, label]) => (
          <div key={source}>
            <label className="flex min-h-11 items-center justify-between gap-3">
              {label}
              <input
                type="checkbox"
                disabled={!settings.enabled}
                checked={audio.connected[source]}
                onChange={(e) => {
                  if (e.target.checked) void audio.connect(source);
                  else {
                    audio.disconnect(source);
                    audio.cancel();
                  }
                }}
                className="size-5 accent-primary"
              />
            </label>
            <p className="text-xs text-muted">
              {audio.connected[source]
                ? `연결됨 · 최근 ${audio.seconds[source].toFixed(0)}초`
                : "연결 안 됨"}
            </p>
          </div>
        ))}
        {(
          [
            ["music", "음악 인식"],
            ["environment", "환경음 인식"],
            ["remember", "최근 소리 기억"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex min-h-11 items-center justify-between gap-3">
            {label}
            <input
              type="checkbox"
              disabled={!settings.enabled}
              checked={settings[key]}
              onChange={(e) => audio.configure({ ...settings, [key]: e.target.checked })}
              className="size-5 accent-primary"
            />
          </label>
        ))}
        <p className="text-sm text-muted">
          소리 입력 연결·종료는 즉시 적용됩니다. 취소해도 종료한 입력은 자동으로 다시 연결하지
          않습니다. 입력은 다시 앱을 열 때 연결하세요. PC에서는 공유 창의 소리 공유를 켜세요. 영상은
          저장하지 않습니다.
        </p>
        <p className="text-sm text-muted">
          “방금 무슨 소리였어?”, “지금 나오는 노래 뭐야?”, “방금 음성 글자로 변환해줘”라고
          질문하세요. 음악 자동 감시는 하지 않습니다. 첫 환경음 분석은 약 160MB 모델을 받으며, 음악
          식별은 AcoustID 연결이 필요합니다.
        </p>
        <p className="text-xs text-muted">
          오디오는 최근 15초만 기기에 보관합니다. 환경음은 로컬 분석, 음악은 지문만 전송, 글자 변환
          요청은 최근 음성을 xAI로 전송합니다. 앱의 음성 재생 중 수집은 잠시 제외됩니다.
        </p>
        <p role="status" className="break-words text-sm">
          {audio.status}
        </p>
        {audio.busy && (
          <button
            type="button"
            onClick={audio.cancel}
            className="min-h-11 rounded-xl border border-line px-4"
          >
            소리 분석 멈춤
          </button>
        )}
      </div>
    </details>
  );
}
