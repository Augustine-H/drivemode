import { useEffect, useRef, useState } from "react";
import { getDropboxClient } from "@/lib/dropbox-client";
import { summarizeConversation } from "@/lib/summarize-conversation";
import { conversationDigest, summaryFilename } from "@/lib/conversation-actions";
import type { Turn } from "@/lib/transcript";
import type { PersonaKnowledge } from "@/lib/persona-memory";
import { knownTurns, turnRecord } from "@/lib/room-context";

const KEY = "voice-grok-summary-receipts";
const SETTING = "voice-grok-summary-enabled";
type Receipt = { digest: string; summary: string };
type Persona = PersonaKnowledge & { id: string; name: string };
export function useVoiceBackup(
  personas: Persona[],
  threads: Record<string, Turn[]>,
  ready: boolean,
  busy: boolean,
  onMemory: (id: string, content: string) => void,
) {
  const [enabled, setEnabled] = useState(true);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const state = useRef({ personas, threads, onMemory, enabled, busy });
  state.current = { personas, threads, onMemory, enabled, busy };
  const receipts = useRef<Record<string, Receipt>>({});
  const running = useRef(false);
  const generation = useRef<Record<string, number>>({});
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    try {
      receipts.current = JSON.parse(localStorage.getItem(KEY) ?? "{}");
      setEnabled(localStorage.getItem(SETTING) !== "off");
    } catch {
      /* optional settings */
    }
  }, []);
  const forget = (id: string) => {
    generation.current[id] = (generation.current[id] ?? 0) + 1;
    delete receipts.current[id];
    try {
      localStorage.setItem(KEY, JSON.stringify(receipts.current));
    } catch {
      setNote("요약 백업 기록을 이 기기에 저장하지 못했습니다.");
    }
  };
  const backup = async (ids?: string[]) => {
    if (!mounted.current || running.current || state.current.busy) return;
    const client = getDropboxClient();
    if (!client.canWrite()) {
      setNote("자동 요약 백업을 위해 Dropbox 쓰기 권한으로 연결하세요.");
      return;
    }
    running.current = true;
    setSaving(true);
    try {
      let changed = 0;
      for (const persona of state.current.personas.filter(
        (item) => !ids || ids.includes(item.id),
      )) {
        const turns = knownTurns(state.current.threads, persona.id).filter((turn) =>
          /^(?:me|gk|relay)-/.test(turn.id),
        );
        if (!turns.some((turn) => turn.speaker === "me")) continue;
        const epoch = generation.current[persona.id] ?? 0;
        const transcript = turns
          .map((turn) => `${turn.at ? new Date(turn.at).toISOString() : ""} ${turnRecord(turn)}`)
          .join("\n");
        const digest = await conversationDigest(transcript);
        if (receipts.current[persona.id]?.digest === digest) continue;
        setNote(`${persona.name} 대화 기억을 요약하는 중입니다.`);
        let summary = "";
        const chunks: string[] = [];
        let block = "";
        for (const line of transcript.split("\n")) {
          if (line.length > 60000) throw new Error("한 메시지가 너무 길어 요약할 수 없습니다.");
          if (block.length + line.length + 1 > 60000) {
            chunks.push(block);
            block = "";
          }
          block += `${line}\n`;
        }
        if (block) chunks.push(block);
        for (const chunk of chunks) {
          if (!mounted.current || (generation.current[persona.id] ?? 0) !== epoch) break;
          const result = await summarizeConversation({
            data: { name: persona.name, previous: summary, transcript: chunk },
          });
          if (!result.ok) throw new Error(result.error);
          summary = result.text;
        }
        if (!mounted.current || (generation.current[persona.id] ?? 0) !== epoch || !summary)
          continue;
        const name = summaryFilename(persona.name);
        const content = `---\nbot: ${JSON.stringify(persona.name)}\nupdated: ${new Date().toISOString()}\nsource: voicegrok\n---\n${summary}\n`;
        await client.uploadMemory(persona.name, name, content);
        if (!mounted.current || (generation.current[persona.id] ?? 0) !== epoch) continue;
        receipts.current[persona.id] = { digest, summary };
        localStorage.setItem(KEY, JSON.stringify(receipts.current));
        state.current.onMemory(persona.id, summary);
        changed++;
      }
      setNote(
        changed
          ? `Dropbox /Grok/voicegrok에 요약 ${changed}개를 백업했습니다.`
          : "대화 변경이 없어 백업하지 않았습니다.",
      );
    } catch (error) {
      setNote(error instanceof Error ? error.message : "요약 백업에 실패했습니다.");
    } finally {
      running.current = false;
      setSaving(false);
    }
  };
  const backupRef = useRef(backup);
  backupRef.current = backup;
  const fingerprint = JSON.stringify(threads);
  useEffect(() => {
    if (!ready || !enabled || busy) return;
    const timer = window.setTimeout(() => void backupRef.current(), 30 * 60_000);
    return () => window.clearTimeout(timer);
  }, [fingerprint, ready, enabled, busy]);
  return {
    enabled,
    saving,
    note,
    forget,
    backup,
    trigger: (ids?: string[]) => {
      if (state.current.enabled) window.setTimeout(() => void backupRef.current(ids), 500);
    },
    setEnabled: (value: boolean) => {
      setEnabled(value);
      try {
        localStorage.setItem(SETTING, value ? "on" : "off");
      } catch {
        setNote("자동 요약 백업 설정을 저장하지 못했습니다.");
      }
    },
    connect: async () => {
      try {
        const url = await getDropboxClient().authorizationUrl(`${window.location.origin}/`, true);
        window.location.assign(url);
      } catch {
        setNote("Dropbox 백업 연결을 시작하지 못했습니다.");
      }
    },
  };
}
