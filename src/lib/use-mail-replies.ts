import { useEffect, useRef } from "react";
import { askGrok } from "@/lib/ask-grok";
import { transcribeSpeech } from "@/lib/stt";
import { speakLine } from "@/lib/tts";
import {
  personaInstructions,
  memoryForQuestion,
  type PersonaKnowledge,
} from "@/lib/persona-memory";
import { loadMailAutoSettings, mailReplyChannel } from "@/lib/mail-reply-policy";
import {
  listVoiceMails,
  claimMailReply,
  updateMailReply,
  updateVoiceMailText,
  completeVoiceReply,
  mailSpeechChunks,
  MAIL_BYTES,
  MAIL_CHANGED_EVENT,
  type VoiceMail,
} from "@/lib/voice-mail";
import type { Turn } from "@/lib/transcript";

type Persona = { id: string; name: string; text: string; voice?: string } & PersonaKnowledge;
type Options = {
  enabled: boolean;
  busy: boolean;
  personas: Persona[];
  threads: Record<string, Turn[]>;
  onChat: (mail: VoiceMail, text: string) => void;
  onError: (error: string) => void;
};

function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("음성 메일을 읽지 못했습니다."));
    reader.readAsDataURL(blob);
  });
}

export function useMailReplies(options: Options) {
  const current = useRef(options);
  current.current = options;
  useEffect(() => {
    if (!options.enabled) return;
    let alive = true;
    let running = false;
    let claimId = "";
    const stillPending = async (id: string) =>
      alive &&
      !document.hidden &&
      loadMailAutoSettings().enabled &&
      (await listVoiceMails()).some(
        (mail) =>
          mail.id === id && mail.reply?.status === "processing" && mail.reply.claimId === claimId,
      );
    const process = async () => {
      if (
        !alive ||
        running ||
        document.hidden ||
        current.current.busy ||
        !loadMailAutoSettings().enabled
      )
        return;
      running = true;
      try {
        const all = await listVoiceMails();
        const pending = all
          .filter(
            (mail) =>
              mail.direction === "sent" &&
              mail.reply &&
              mail.reply.dueAt <= Date.now() &&
              (mail.reply.status === "pending" ||
                (mail.reply.status === "processing" && (mail.reply.leaseUntil ?? 0) <= Date.now())),
          )
          .sort((a, b) => a.createdAt - b.createdAt)[0];
        if (!pending) return;
        const persona = current.current.personas.find((item) => item.id === pending.personaId);
        claimId = crypto.randomUUID();
        if (!persona || !(await claimMailReply(pending.id, Date.now(), claimId))) return;
        let reply = {
          ...pending.reply!,
          status: "processing" as const,
          leaseUntil: Date.now() + 180000,
          claimId,
        };
        try {
          let text = pending.text;
          if (!text) {
            const result = await transcribeSpeech({
              data: { audio: await base64(pending.audio[0]), mime: pending.audio[0].type },
            });
            if (!result.ok) throw new Error(result.error);
            text = result.text.trim();
            if (!text) throw new Error("음성에서 질문을 찾지 못했습니다.");
            if (!(await stillPending(pending.id))) return;
            await updateVoiceMailText(pending.id, text);
          }
          if (!reply.text) {
            const result = await askGrok({
              data: {
                message: `보이스 메일로 남긴 메시지에 짧게 답해줘: ${text}`,
                persona: personaInstructions(persona),
                memory: memoryForQuestion(persona.memories, text),
                history: (current.current.threads[persona.id] ?? []).slice(-4).map((turn) => ({
                  role: turn.speaker === "me" ? ("user" as const) : ("assistant" as const),
                  content: turn.text,
                })),
              },
            });
            if (!result.ok) throw new Error(result.error);
            reply = {
              ...reply,
              text: result.text,
              channel: mailReplyChannel(loadMailAutoSettings(), Date.now()),
            };
            if (
              !(await stillPending(pending.id)) ||
              !(await updateMailReply(pending.id, reply, "processing", claimId))
            )
              return;
          }
          const answer = reply.text!;
          if (!(await stillPending(pending.id))) return;
          if (reply.channel === "voice") {
            try {
              const parts: Blob[] = [];
              for (const chunk of mailSpeechChunks(answer)) {
                if (!(await stillPending(pending.id))) return;
                const audio = await speakLine({
                  data: { text: chunk, voiceId: persona.voice ?? "ara", speed: 1 },
                });
                if (!audio.ok) throw new Error(audio.error);
                parts.push(
                  new Blob([Uint8Array.from(atob(audio.audio), (c) => c.charCodeAt(0))], {
                    type: "audio/mpeg",
                  }),
                );
                if (parts.reduce((sum, blob) => sum + blob.size, 0) > MAIL_BYTES)
                  throw new Error("답장 음성이 너무 큽니다.");
              }
              if (!(await stillPending(pending.id))) return;
              const delivered = await completeVoiceReply(
                pending.id,
                {
                  id: `reply-${pending.id}`,
                  replyTo: pending.id,
                  personaId: persona.id,
                  personaName: persona.name,
                  direction: "received",
                  text: answer,
                  audio: parts,
                  heard: false,
                  createdAt: Date.now(),
                },
                claimId,
              );
              if (delivered) return;
              throw new Error("메일함이 가득 찼습니다.");
            } catch {
              if (!(await stillPending(pending.id))) return;
              current.current.onError("음성 메일을 보관하지 못해 챗으로 답장합니다.");
            }
          }
          if (!(await stillPending(pending.id))) return;
          const saved = await updateMailReply(
            pending.id,
            {
              ...reply,
              status: "done",
              channel: "chat",
              leaseUntil: undefined,
            },
            "processing",
            claimId,
          );
          if (saved && alive) current.current.onChat({ ...pending, text }, answer);
        } catch (error) {
          if (!alive) return;
          if (await stillPending(pending.id)) {
            const message = error instanceof Error ? error.message : "답장에 실패했습니다.";
            await updateMailReply(
              pending.id,
              { ...reply, status: "failed", error: message },
              "processing",
              claimId,
            );
            current.current.onError(message);
          }
        } finally {
          const latest = (await listVoiceMails()).find((mail) => mail.id === pending.id);
          if (latest?.reply?.status === "processing" && latest.reply.claimId === claimId) {
            await updateMailReply(
              pending.id,
              { ...latest.reply, status: "pending", leaseUntil: undefined, claimId: undefined },
              "processing",
              claimId,
            );
          }
        }
      } catch (error) {
        if (alive)
          current.current.onError(
            error instanceof Error ? error.message : "메일함을 확인하지 못했습니다.",
          );
      } finally {
        running = false;
      }
    };
    void process();
    const timer = window.setInterval(() => void process(), 1000);
    const resume = () => void process();
    window.addEventListener(MAIL_CHANGED_EVENT, resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener(MAIL_CHANGED_EVENT, resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [options.enabled]);
}
