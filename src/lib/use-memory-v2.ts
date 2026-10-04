import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { knownTurns, turnRecord } from "./room-context";
import type { Turn } from "./transcript";
import type { PersonaKnowledge } from "./persona-memory";
import {
  buildPersonaMemory,
  cleanMemoryState,
  emptyMemoryState,
  importedDocuments,
  MemoryIndex,
  memoryChunks,
  type MemoryState,
} from "./memory-engine";
export function useMemoryV2(
  threads: Record<string, Turn[]>,
  personas: (PersonaKnowledge & { id: string })[],
  hydrated: boolean,
) {
  const [state, setState] = useState<MemoryState>(emptyMemoryState);
  const cache = useRef<Record<string, Turn[]>>({});
  const stableThreads = useMemo(() => {
    const next = Object.fromEntries(
      Object.entries(threads).map(([id, list]) => [id, list.filter((t) => !t.streaming)]),
    );
    const old = cache.current;
    if (
      Object.keys(next).length === Object.keys(old).length &&
      Object.entries(next).every(
        ([id, list]) => list.length === old[id]?.length && list.every((t, i) => t === old[id][i]),
      )
    )
      return old;
    cache.current = next;
    return next;
  }, [threads]);
  const documents = useMemo(
    () =>
      Object.fromEntries(
        personas.map((p) => [
          p.id,
          knownTurns(stableThreads, p.id)
            .filter((t) => !t.streaming && !/^s\d+$/.test(t.id))
            .map((t) => ({
              id: t.id,
              content: turnRecord(t),
              at: t.at,
              role: t.speaker === "me" ? "user" : "assistant",
            })),
        ]),
      ),
    [stableThreads, personas],
  );
  useEffect(() => {
    if (!hydrated) return;
    setState((previous) => {
      const next = {
        ...previous,
        summaries: { ...previous.summaries },
        longTerm: { ...previous.longTerm },
      };
      for (const persona of personas) {
        try {
          const generated = buildPersonaMemory(previous, persona.id, documents[persona.id] ?? []);
          next.summaries[persona.id] = generated.summaries;
          next.longTerm[persona.id] = generated.longTerm;
        } catch {
          /* Retain original turns and the last successful memory state. */
        }
      }
      return JSON.stringify(next) === JSON.stringify(previous) ? previous : next;
    });
  }, [documents, hydrated, personas, state.enabled, state.summaryEnabled, state.recentBudget]);
  const indexes = useMemo(
    () =>
      Object.fromEntries(
        personas.map((p) => [
          p.id,
          {
            memory: new MemoryIndex([
              ...importedDocuments(p.memories),
              ...(state.longTerm[p.id] ?? []),
              ...(documents[p.id] ?? []).flatMap((d) =>
                memoryChunks(d.content).map((content, i) => ({
                  ...d,
                  id: `history:${d.id}:${i}`,
                  content,
                  source: d.id,
                  importance: 2,
                  createdAt: d.at ?? 0,
                })),
              ),
            ]),
            summary: new MemoryIndex(state.summaries[p.id] ?? []),
          },
        ]),
      ),
    [personas, documents, state.longTerm, state.summaries],
  );
  function context(id: string, question: string) {
    try {
      if (!state.enabled || !indexes[id])
        return { memory: "", summary: "", recentBudget: state.enabled ? state.recentBudget : 0 };
      const recent = (documents[id] ?? [])
        .slice(-3)
        .map((d) => d.content)
        .join("\n");
      const found = state.longTermEnabled
        ? indexes[id].memory.search(question, recent, 2400)
        : { content: "", ids: [] as string[] };
      const summary = state.summaryEnabled
        ? indexes[id].summary.search(question, recent, 1200).content
        : "";
      if (found.ids.length)
        setState((previous) => {
          const list = previous.longTerm[id] ?? [];
          const now = Date.now();
          if (!list.some((d) => found.ids.includes(d.id))) return previous;
          return {
            ...previous,
            longTerm: {
              ...previous.longTerm,
              [id]: list.map((d) => (found.ids.includes(d.id) ? { ...d, lastUsedAt: now } : d)),
            },
          };
        });
      return {
        memory: found.content,
        summary,
        recentBudget: state.recentBudget,
        memoriesRetrieved: found.ids.length,
      };
    } catch {
      return { memory: "", summary: "", recentBudget: state.recentBudget, memoriesRetrieved: 0 };
    }
  }
  const restore = useCallback((raw: unknown) => setState(cleanMemoryState(raw)), []);
  return { state, setState, context, restore };
}
