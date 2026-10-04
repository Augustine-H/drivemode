import type { MemoryState } from "@/lib/memory-engine";
import type { ContextMetrics } from "@/lib/grok-context";
import { useState } from "react";
import { forgetMemoryDocument } from "@/lib/memory-engine";
export function MemorySettings({
  state,
  onChange,
  metrics,
  personaId,
}: {
  state: MemoryState;
  onChange: (state: MemoryState) => void;
  metrics: ContextMetrics | null;
  personaId?: string;
}) {
  const [edit, setEdit] = useState<string | null>(null),
    [text, setText] = useState(""),
    [page, setPage] = useState(0);
  const docs = state.longTerm[personaId ?? ""] ?? [];
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
        {personaId ? (
          <details>
            <summary className="min-h-11 cursor-pointer py-3">
              현재 페르소나 장기 기억 · {docs.length}개
            </summary>
            <div className="space-y-3">
              {!docs.length ? (
                <p className="text-xs text-muted">명시적으로 기억한 정보가 없습니다.</p>
              ) : (
                docs.slice(page * 10, page * 10 + 10).map((d) => (
                  <article key={d.id} className="space-y-2 rounded-xl border border-line p-3">
                    <p className="break-words text-sm">{d.content}</p>
                    <p className="text-xs text-muted">
                      {d.provenance === "user-explicit" ? "사용자 기억 요청" : "저장한 기록"} ·
                      중요도 {d.importance}
                      {d.sourceDeleted ? " · 출처 대화 삭제됨" : ""}
                    </p>
                    {edit === d.id ? (
                      <>
                        <textarea
                          aria-label="기억 내용 수정"
                          rows={4}
                          className="w-full rounded-xl border border-line bg-bg p-2"
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                        />
                        <button
                          className="min-h-11 rounded-full border border-line px-3 text-sm"
                          disabled={!text.trim() || text.length > 64000}
                          onClick={() => {
                            onChange({
                              ...state,
                              longTerm: {
                                ...state.longTerm,
                                [personaId]: docs.map((x) =>
                                  x.id === d.id
                                    ? {
                                        ...x,
                                        content: text.trim(),
                                        manual: true,
                                        updatedAt: Date.now(),
                                        revision: (x.revision ?? 1) + 1,
                                      }
                                    : x,
                                ),
                              },
                              suppressedSources: {
                                ...state.suppressedSources,
                                [personaId]: [
                                  ...new Set([
                                    ...(state.suppressedSources?.[personaId] ?? []),
                                    ...(d.sourceIds ?? []),
                                  ]),
                                ],
                              },
                              summaries: {
                                ...state.summaries,
                                [personaId]: (state.summaries[personaId] ?? []).filter(
                                  (s) => !s.sourceIds?.some((id) => d.sourceIds?.includes(id)),
                                ),
                              },
                            });
                            setEdit(null);
                          }}
                        >
                          기억 수정 저장
                        </button>
                      </>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="min-h-11 rounded-full border border-line px-3 text-sm"
                        onClick={() => {
                          setEdit(d.id);
                          setText(d.content);
                        }}
                      >
                        수정
                      </button>
                      <button
                        className="min-h-11 rounded-full border border-line px-3 text-sm"
                        onClick={() => onChange(forgetMemoryDocument(state, personaId, d.id))}
                      >
                        기억 삭제
                      </button>
                      <select
                        aria-label="기억 중요도"
                        value={d.importance}
                        className="min-h-11 rounded-xl border border-line bg-surface px-2"
                        onChange={(e) =>
                          onChange({
                            ...state,
                            longTerm: {
                              ...state.longTerm,
                              [personaId]: docs.map((x) =>
                                x.id === d.id ? { ...x, importance: Number(e.target.value) } : x,
                              ),
                            },
                          })
                        }
                      >
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            중요도 {n}
                          </option>
                        ))}
                      </select>
                    </div>
                  </article>
                ))
              )}
              <div className="flex gap-2">
                <button
                  disabled={!page}
                  className="min-h-11 px-3"
                  onClick={() => setPage(page - 1)}
                >
                  이전
                </button>
                <button
                  disabled={(page + 1) * 10 >= docs.length}
                  className="min-h-11 px-3"
                  onClick={() => setPage(page + 1)}
                >
                  다음
                </button>
              </div>
              <p className="text-xs text-muted">
                삭제한 기억의 원문을 다시 자동 추출하지 않습니다. 가져온 MD 기억은 페르소나 파일
                관리에서 별도로 관리합니다.
              </p>
            </div>
          </details>
        ) : null}
      </div>
    </details>
  );
}
