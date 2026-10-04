import { estimateTokens, fitText, selectRecent } from "./context-budget.ts";
import { sentences } from "./sentences.ts";
import type { PersonaMemory } from "./persona-memory";
export type MemoryDocument = {
  id: string;
  content: string;
  importance: number;
  createdAt: number;
  lastUsedAt?: number;
  source?: string;
  sourceIds?: string[];
  sourceRevision?: string;
  provenance?: "user-explicit" | "imported" | "local-excerpt";
  category?: string;
  updatedAt?: number;
  revision?: number;
  sourceDeleted?: boolean;
  manual?: boolean;
  relatedMediaIds?: string[];
};
export type MemoryState = {
  schemaVersion: 2;
  enabled: boolean;
  longTermEnabled: boolean;
  summaryEnabled: boolean;
  recentBudget: number;
  summaries: Record<string, MemoryDocument[]>;
  longTerm: Record<string, MemoryDocument[]>;
  suppressedSources?: Record<string, string[]>;
};
export const emptyMemoryState = (): MemoryState => ({
  schemaVersion: 2,
  enabled: true,
  longTermEnabled: true,
  summaryEnabled: true,
  recentBudget: 6000,
  summaries: {},
  longTerm: {},
  suppressedSources: {},
});
export function eraseConversationMemory(state: MemoryState, id?: string): MemoryState {
  return {
    ...state,
    longTerm: id ? { ...state.longTerm, [id]: [] } : {},
    summaries: id ? { ...state.summaries, [id]: [] } : {},
    suppressedSources: id ? { ...state.suppressedSources, [id]: [] } : {},
  };
}
export function cleanMemoryState(raw: unknown): MemoryState {
  const state = emptyMemoryState();
  if (!raw || typeof raw !== "object") return state;
  const r = raw as Record<string, unknown>;
  if (r.suppressedSources && typeof r.suppressedSources === "object")
    state.suppressedSources = Object.fromEntries(
      Object.entries(r.suppressedSources)
        .filter(([, v]) => Array.isArray(v))
        .map(([k, v]) => [k, (v as unknown[]).filter((x): x is string => typeof x === "string")]),
    );
  for (const key of ["enabled", "longTermEnabled", "summaryEnabled"] as const)
    if (typeof r[key] === "boolean") state[key] = r[key] as boolean;
  if (typeof r.recentBudget === "number" && Number.isFinite(r.recentBudget))
    state.recentBudget = Math.max(1000, Math.min(12000, r.recentBudget));
  for (const key of ["summaries", "longTerm"] as const)
    if (r[key] && typeof r[key] === "object")
      for (const [id, docs] of Object.entries(r[key] as Record<string, unknown>)) {
        if (!Array.isArray(docs)) continue;
        state[key][id] = docs
          .filter(
            (d) =>
              d &&
              typeof d.id === "string" &&
              typeof d.content === "string" &&
              d.content.length <= 64000,
          )
          .map((d) => ({
            id: d.id,
            content: d.content,
            importance: Math.max(1, Math.min(5, Number(d.importance) || 3)),
            createdAt: Number.isFinite(d.createdAt) ? d.createdAt : 0,
            lastUsedAt: Number.isFinite(d.lastUsedAt) ? d.lastUsedAt : undefined,
            source: typeof d.source === "string" ? d.source : undefined,
            sourceIds: Array.isArray(d.sourceIds)
              ? d.sourceIds.filter((x: unknown) => typeof x === "string")
              : undefined,
            sourceRevision: typeof d.sourceRevision === "string" ? d.sourceRevision : undefined,
            provenance: ["user-explicit", "imported", "local-excerpt"].includes(d.provenance)
              ? d.provenance
              : undefined,
            category: typeof d.category === "string" ? d.category : undefined,
            updatedAt: Number.isFinite(d.updatedAt) ? d.updatedAt : undefined,
            revision: Number.isFinite(d.revision) ? d.revision : undefined,
            sourceDeleted: typeof d.sourceDeleted === "boolean" ? d.sourceDeleted : undefined,
            manual: typeof d.manual === "boolean" ? d.manual : undefined,
            relatedMediaIds: Array.isArray(d.relatedMediaIds)
              ? d.relatedMediaIds.filter((x: unknown) => typeof x === "string")
              : undefined,
          }));
      }
  return state;
}
export function memoryTerms(text: string) {
  return [
    ...new Set(
      (text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).flatMap((w) => [
        w,
        ...(w.length > 2
          ? Array.from({ length: Math.min(w.length - 1, 40) }, (_, i) => w.slice(i, i + 2))
          : []),
      ]),
    ),
  ].slice(0, 300);
}
// Index fragments only; stored source files and conversation turns remain unchanged.
export function memoryChunks(text: string, budget = 800) {
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences(text, true)) {
    if (estimateTokens(sentence) > budget) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      let part = "";
      let cost = 0;
      for (const char of sentence) {
        const next = char.codePointAt(0)! < 128 ? 0.25 : 2;
        if (cost + next > budget) {
          chunks.push(part);
          part = "";
          cost = 0;
        }
        part += char;
        cost += next;
      }
      if (part) chunks.push(part);
    } else {
      if (estimateTokens(current + sentence) > budget) {
        chunks.push(current);
        current = "";
      }
      current += (current ? " " : "") + sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
export class MemoryIndex {
  private docs: MemoryDocument[];
  private postings = new Map<string, Set<number>>();
  constructor(docs: MemoryDocument[]) {
    this.docs = docs;
    docs.forEach((d, i) =>
      memoryTerms(d.content).forEach((term) => {
        const set = this.postings.get(term) ?? new Set();
        set.add(i);
        this.postings.set(term, set);
      }),
    );
  }
  search(question: string, recent: string, budget = 2400, now = Date.now()) {
    const q = memoryTerms(question),
      r = memoryTerms(recent);
    const candidates = new Set<number>();
    q.forEach((term) => this.postings.get(term)?.forEach((i) => candidates.add(i)));
    // Use recent context to resolve follow-up questions, without filling explicit topic
    // questions with every unrelated record sharing a generic recent word.
    if (!candidates.size)
      r.forEach((term) => this.postings.get(term)?.forEach((i) => candidates.add(i)));
    // Important durable facts remain available when a question has no lexical overlap.
    if (!candidates.size)
      this.docs.forEach((d, i) => {
        if (d.importance >= 4) candidates.add(i);
      });
    const ranked = [...candidates]
      .map((i) => {
        const d = this.docs[i],
          text = d.content.toLowerCase();
        const relevance =
          q.filter((t) => text.includes(t)).length * 3 +
          r.filter((t) => text.includes(t)).length * 0.5;
        const age = Math.max(0, now - (d.lastUsedAt ?? d.createdAt));
        return { doc: d, score: relevance + d.importance * 2 + 2 / (1 + age / 86400000) };
      })
      .sort((a, b) => b.score - a.score);
    let content = "",
      used = 0;
    const ids: string[] = [];
    for (const { doc } of ranked) {
      const block = `[${doc.source ?? doc.id}]\n${doc.content}`;
      const cost = estimateTokens(block) + 8;
      if (used + cost > budget) continue;
      content += (content ? "\n\n" : "") + block;
      used += cost;
      ids.push(doc.id);
    }
    return { content, ids, tokens: used };
  }
}
export function importedDocuments(memories: PersonaMemory[] = []) {
  return memories.flatMap((m, i) =>
    m.content
      .split(/\n\s*\n/)
      .filter(Boolean)
      .flatMap((text) => memoryChunks(text))
      .map((content, j) => ({
        id: `import:${m.source}:${j}`,
        source: m.source,
        content,
        importance: m.importance ?? (/선호|좋아|약속|프로젝트|결정|기억/.test(content) ? 4 : 2),
        createdAt: m.createdAt ?? i,
        lastUsedAt: m.lastUsedAt,
      })),
  );
}
export function summarizeExcluded(
  turns: { id: string; content: string; at?: number; role?: string }[],
) {
  const summaries: MemoryDocument[] = [];
  for (let i = 0; i < turns.length; i += 40) {
    const batch = turns.slice(i, i + 40);
    const excerpts = batch
      .flatMap((t) =>
        sentences(t.content.replace(/^(사용자|페르소나):\s*/, ""), true).map((text) => ({
          text: `${t.role === "user" ? "사용자" : "대화 상대"}: ${text.trim()}`,
          priority:
            /기억|결정|수정|구현|설정|백업|프로젝트|작업|좋아|싫어|선호|약속|다음|완료|진행|취소|날짜/.test(
              text,
            )
              ? 4
              : 1,
        })),
      )
      .map((excerpt, index) => ({ ...excerpt, index }))
      .sort((a, b) => b.priority - a.priority || a.index - b.index);
    let content = "";
    for (const e of excerpts) {
      if (estimateTokens(content + e.text) > 600) continue;
      content += (content ? "\n" : "") + e.text;
    }
    if (content)
      summaries.push({
        id: `summary:${batch[0].id}`,
        content: `발췌 요약 (원문에서 선택한 기록, 추론 없음):\n${content}`,
        importance: 3,
        createdAt: batch.at(-1)?.at ?? 0,
        sourceIds: batch.map((t) => t.id),
        sourceRevision: sourceRevision(batch.map((t) => `${t.id}:${t.content}`).join("\n")),
        provenance: "local-excerpt",
        revision: 1,
      });
  }
  return summaries;
}
function sourceRevision(text: string) {
  let hash = 2166136261;
  for (const c of text) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}
export function buildPersonaMemory(
  state: MemoryState,
  id: string,
  turns: { id: string; content: string; at?: number; role?: string }[],
) {
  const blocked = new Set(state.suppressedSources?.[id] ?? []);
  const complete = turns.filter((t) => !/^s\d+$/.test(t.id) && !blocked.has(t.id));
  const excluded = selectRecent(complete, state.recentBudget).excluded;
  const summaries = state.summaryEnabled
    ? summarizeExcluded(excluded)
    : (state.summaries[id] ?? []);
  const remembered = new Map((state.longTerm[id] ?? []).map((d) => [d.id, d]));
  for (const turn of complete) {
    const old = remembered.get(`fact:${turn.id}`);
    if (
      old &&
      !old.manual &&
      turn.role === "user" &&
      !/기억해\s*(?:줘|둬|[.!]|$)|잊지\s*마|나는[^?\n]*(?:좋아|싫어|선호)/.test(turn.content)
    )
      remembered.delete(old.id);
  }
  for (const turn of complete)
    if (
      turn.role === "user" &&
      /기억해\s*(?:줘|둬|[.!]|$)|잊지\s*마|나는[^?\n]*(?:좋아|싫어|선호)/.test(turn.content) &&
      !remembered.get(`fact:${turn.id}`)?.manual &&
      remembered.get(`fact:${turn.id}`)?.sourceRevision !== sourceRevision(turn.content)
    )
      remembered.set(`fact:${turn.id}`, {
        id: `fact:${turn.id}`,
        content: fitText(`사용자가 명시적으로 기억 요청: ${turn.content}`, 1000),
        importance: 5,
        createdAt: turn.at ?? 0,
        sourceIds: [turn.id],
        sourceRevision: sourceRevision(turn.content),
        provenance: "user-explicit",
        revision: (remembered.get(`fact:${turn.id}`)?.revision ?? 0) + 1,
        updatedAt: Date.now(),
      });
  return { summaries, longTerm: [...remembered.values()] };
}
export function forgetMemoryDocument(state: MemoryState, personaId: string, id: string) {
  const doc = state.longTerm[personaId]?.find((d) => d.id === id);
  if (!doc) return state;
  return {
    ...state,
    longTerm: {
      ...state.longTerm,
      [personaId]: state.longTerm[personaId].filter((d) => d.id !== id),
    },
    summaries: {
      ...state.summaries,
      [personaId]: (state.summaries[personaId] ?? []).filter(
        (d) => !d.sourceIds?.some((s) => doc.sourceIds?.includes(s)),
      ),
    },
    suppressedSources: {
      ...state.suppressedSources,
      [personaId]: [
        ...new Set([...(state.suppressedSources?.[personaId] ?? []), ...(doc.sourceIds ?? [])]),
      ],
    },
  };
}
export function conversationMemoryDeleted(
  state: MemoryState,
  removed: Set<string>,
  eraseFacts: boolean,
) {
  return {
    ...state,
    summaries: Object.fromEntries(
      Object.entries(state.summaries).map(([p, docs]) => [
        p,
        docs.filter((d) => !d.sourceIds?.some((id) => removed.has(id))),
      ]),
    ),
    longTerm: Object.fromEntries(
      Object.entries(state.longTerm).map(([p, docs]) => [
        p,
        docs.flatMap((d) =>
          d.sourceIds?.some((id) => removed.has(id))
            ? eraseFacts
              ? []
              : [{ ...d, sourceDeleted: true }]
            : [d],
        ),
      ]),
    ),
  };
}
