import type { MemoryState } from "@/lib/memory-engine";
import type { ContextMetrics } from "@/lib/grok-context";
export function MemorySettings({
  state,
  onChange,
  metrics,
}: {
  state: MemoryState;
  onChange: (state: MemoryState) => void;
  metrics: ContextMetrics | null;
}) {
  return (
    <details className="rounded-2xl border border-line p-3">
      <summary className="min-h-11 cursor-pointer py-3 font-medium">대화 기억</summary>
      <div className="space-y-3 pt-2">
        {(
          [
            ["enabled", "기억 기능 사용"],
            ["longTermEnabled", "장기 기억 사용"],
            ["summaryEnabled", "오래된 대화 요약 사용"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex min-h-11 items-center justify-between gap-3">
            {label}
            <input
              type="checkbox"
              className="size-5 accent-primary"
              checked={state[key]}
              onChange={(e) => onChange({ ...state, [key]: e.target.checked })}
            />
          </label>
        ))}
        <label className="flex min-h-11 items-center justify-between gap-3">
          최근 대화 기억량
          <select
            aria-label="최근 대화 기억량"
            value={state.recentBudget}
            onChange={(e) => onChange({ ...state, recentBudget: Number(e.target.value) })}
            className="rounded-lg border border-line bg-surface p-2"
          >
            <option value={3000}>적게 · 3,000</option>
            <option value={6000}>기본 · 6,000</option>
            <option value={12000}>많이 · 12,000</option>
          </select>
        </label>
        <p className="text-xs text-muted">
          기억량은 토큰 추정치입니다. 대화 원문은 삭제하지 않습니다. 요약은 이 기기에서 원문의 핵심
          문장을 발췌하며 추가 API 요금이 없습니다.
        </p>
        <p className="text-xs text-muted">
          요약 {Object.values(state.summaries).reduce((n, d) => n + d.length, 0)}개 · 명시적으로
          기억한 정보 {Object.values(state.longTerm).reduce((n, d) => n + d.length, 0)}개
        </p>
        {metrics && (
          <details className="text-xs text-muted">
            <summary className="min-h-11 cursor-pointer py-3">마지막 질문의 기억 사용량</summary>
            <p>
              최근 {metrics.recentTokens} · 요약 {metrics.summaryTokens} · 기억{" "}
              {metrics.memoryTokens} · 페르소나 {metrics.personaTokens} · 합계 {metrics.totalTokens}{" "}
              토큰 추정
            </p>
            <p>
              검색 기록 {metrics.memoriesRetrieved ?? 0}개 · 응답{" "}
              {metrics.responseTokens ?? "미제공"} 토큰 · 전체 {metrics.fullLength ?? 0}자 · 음성{" "}
              {metrics.voiceLength ?? 0}자
            </p>
          </details>
        )}
      </div>
    </details>
  );
}
