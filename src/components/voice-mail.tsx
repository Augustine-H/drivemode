import { useEffect, useRef, useState } from "react";
import { X, Mic, Square, Inbox } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  addVoiceMail,
  listVoiceMails,
  markVoiceMailHeard,
  removeVoiceMail,
  updateVoiceMailText,
  MAIL_BYTES,
  mailSpeechChunks,
  type VoiceMail,
} from "@/lib/voice-mail";
import { transcribeSpeech } from "@/lib/stt";
import { speakLine } from "@/lib/tts";
import { type Turn } from "@/lib/transcript";

type Persona = { id: string; name: string; voice?: string };
function errorText(error: unknown) {
  return error instanceof Error ? error.message : "보이스 메일을 처리하지 못했습니다.";
}
function audioBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("음성 파일을 읽지 못했습니다."));
    reader.readAsDataURL(blob);
  });
}
function MailAudio({ parts, heard }: { parts: Blob[]; heard?: () => void }) {
  const [index, setIndex] = useState(0);
  const [url, setUrl] = useState("");
  const audio = useRef<HTMLAudioElement>(null);
  const continuing = useRef(false);
  const part = parts[index];
  useEffect(() => {
    const url = URL.createObjectURL(part);
    const player = audio.current;
    setUrl(url);
    return () => {
      player?.pause();
      URL.revokeObjectURL(url);
    };
  }, [part]);
  useEffect(() => {
    if (url && continuing.current) {
      continuing.current = false;
      void audio.current?.play().catch(() => {});
    }
  }, [url]);
  return (
    <div className="space-y-2">
      <audio
        ref={audio}
        controls
        preload="none"
        src={url || undefined}
        className="w-full"
        onPlay={(event) => {
          event.currentTarget
            .closest('[role="dialog"]')
            ?.querySelectorAll("audio")
            .forEach((player) => {
              if (player !== event.currentTarget) player.pause();
            });
          heard?.();
        }}
        onEnded={() => {
          if (index + 1 < parts.length) {
            continuing.current = true;
            setIndex(index + 1);
          }
        }}
      />
      {parts.length > 1 ? (
        <div className="flex items-center justify-between text-xs text-muted">
          <button disabled={!index} className="min-h-11 px-2" onClick={() => setIndex(index - 1)}>
            이전 구간
          </button>
          <span>
            음성 {index + 1}/{parts.length}
          </span>
          <button
            disabled={index + 1 === parts.length}
            className="min-h-11 px-2"
            onClick={() => setIndex(index + 1)}
          >
            다음 구간
          </button>
        </div>
      ) : null}
    </div>
  );
}
export function VoiceMailBox({
  personas,
  initialId,
  threads,
  onClose,
  onReply,
}: {
  personas: Persona[];
  initialId: string;
  threads: Record<string, Turn[]>;
  onClose: () => void;
  onReply: (text: string, personaId: string) => void;
}) {
  const [personaId, setPersonaId] = useState(
    personas.some((item) => item.id === initialId) ? initialId : personas[0].id,
  );
  const [mails, setMails] = useState<VoiceMail[]>([]);
  const [draft, setDraft] = useState<Blob | null>(null);
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [remove, setRemove] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const mounted = useRef(true);
  const epoch = useRef(0);
  const saving = useRef(false);
  const persona = personas.find((item) => item.id === personaId)!;
  const latest = [...(threads[personaId] ?? [])].reverse().find((turn) => turn.speaker === "grok");
  async function refresh() {
    const list = await listVoiceMails();
    if (mounted.current) setMails(list);
  }
  useEffect(() => {
    mounted.current = true;
    void refresh().catch((error) => setNote(errorText(error)));
    const hide = () => {
      if (!document.hidden) return;
      if (recorder.current?.state === "recording") recorder.current.stop();
      window.clearInterval(timer.current);
      stream.current?.getTracks().forEach((track) => track.stop());
      setRecording(false);
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", hide);
      // This counter invalidates pending async work; it is not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      epoch.current++;
      window.clearInterval(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  function stop() {
    if (recorder.current?.state === "recording") recorder.current.stop();
    window.clearInterval(timer.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    setRecording(false);
  }
  async function start() {
    if (saving.current || recording) return;
    saving.current = true;
    setBusy(true);
    setNote("");
    const token = ++epoch.current;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined")
        throw new Error("이 브라우저는 녹음을 지원하지 않습니다. 음성 파일을 선택하세요.");
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || token !== epoch.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((value) =>
        MediaRecorder.isTypeSupported(value),
      );
      const rec = new MediaRecorder(media, {
        ...(mime ? { mimeType: mime } : {}),
        audioBitsPerSecond: 64000,
      });
      recorder.current = rec;
      const parts: Blob[] = [];
      let bytes = 0;
      const started = Date.now();
      rec.ondataavailable = (event) => {
        if (event.data.size) {
          parts.push(event.data);
          bytes += event.data.size;
          if (bytes > MAIL_BYTES && rec.state === "recording") stop();
        }
      };
      rec.onstop = () => {
        window.clearInterval(timer.current);
        media.getTracks().forEach((track) => track.stop());
        if (!mounted.current || token !== epoch.current) return;
        setRecording(false);
        const blob = new Blob(parts, { type: rec.mimeType || mime || "audio/webm" });
        if (!blob.size || blob.size > MAIL_BYTES) {
          setNote("녹음이 비어 있거나 1MB를 넘었습니다. 짧게 다시 녹음하세요.");
          return;
        }
        setDraft(blob);
        setNote("녹음 완료. 내용을 확인하고 메일을 남기세요.");
      };
      rec.onerror = () => {
        stop();
        if (mounted.current)
          setNote("녹음에 실패했습니다. 음성 파일을 선택하거나 다시 시도하세요.");
      };
      setDraft(null);
      setText("");
      setElapsed(0);
      rec.start(1000);
      setRecording(true);
      timer.current = window.setInterval(() => {
        const seconds = Math.floor((Date.now() - started) / 1000);
        setElapsed(seconds);
        if (seconds >= 60) stop();
      }, 1000);
    } catch (error) {
      stream.current?.getTracks().forEach((track) => track.stop());
      if (mounted.current) setNote(errorText(error));
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function job(work: () => Promise<void>) {
    if (saving.current || recording) return;
    saving.current = true;
    setBusy(true);
    setNote("");
    try {
      await work();
    } catch (error) {
      if (mounted.current) setNote(errorText(error));
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function updateText(id: string, content: string) {
    await updateVoiceMailText(id, content);
    if (mounted.current)
      setMails((previous) =>
        previous.map((item) => (item.id === id ? { ...item, text: content.trim() } : item)),
      );
  }
  async function saveReceived() {
    if (!latest) return;
    if (latest.text.length > 3200)
      throw new Error(
        "이 답변은 너무 깁니다. 페르소나에게 3천 글자 이내로 짧게 다시 답해 달라고 하세요.",
      );
    const token = epoch.current;
    const audio: Blob[] = [];
    for (const chunk of mailSpeechChunks(latest.text)) {
      if (!mounted.current || token !== epoch.current) return;
      const result = await speakLine({
        data: { text: chunk, voiceId: latest.voice ?? persona.voice ?? "ara", speed: 1 },
      });
      if (!result.ok) throw new Error(result.error);
      const bytes = Uint8Array.from(atob(result.audio), (c) => c.charCodeAt(0));
      audio.push(new Blob([bytes], { type: "audio/mpeg" }));
      if (audio.reduce((sum, part) => sum + part.size, 0) > MAIL_BYTES)
        throw new Error("생성된 음성이 1MB를 넘었습니다. 더 짧은 답변으로 다시 시도하세요.");
    }
    if (!mounted.current || token !== epoch.current) return;
    await addVoiceMail({
      id: crypto.randomUUID(),
      personaId,
      personaName: persona.name,
      direction: "received",
      createdAt: Date.now(),
      text: latest.text,
      audio,
      heard: false,
    });
    await refresh();
    if (mounted.current) setNote(`${persona.name}의 음성 답변을 메일함에 보관했습니다.`);
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-3">
          <Dialog.Content
            aria-describedby="voice-mail-description"
            className="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-surface text-fg"
          >
            <header className="flex items-center justify-between border-b border-line px-4 py-3">
              <Dialog.Title className="flex items-center gap-2 text-lg">
                <Inbox aria-hidden="true" className="size-5" />
                보이스 메일
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  aria-label="보이스 메일 닫기"
                  className="flex size-11 items-center justify-center"
                >
                  <X className="size-5" />
                </button>
              </Dialog.Close>
            </header>
            <div className="space-y-4 overflow-y-auto p-4">
              <p id="voice-mail-description" className="text-sm text-muted">
                페르소나에게 음성을 남기거나 답변을 음성 메일로 보관하세요. 메일은 이 기기에만
                저장되며 JSON·Dropbox 대화 백업에는 포함되지 않습니다.
              </p>
              <label className="block space-y-2 text-sm">
                <span>페르소나</span>
                <select
                  aria-label="보이스 메일 페르소나"
                  disabled={busy || recording}
                  className="min-h-11 w-full rounded-xl border border-line bg-bg px-3"
                  value={personaId}
                  onChange={(event) => setPersonaId(event.target.value)}
                >
                  {personas.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <section className="space-y-3 rounded-2xl border border-line p-4">
                <h3>{persona.name}에게 음성 메시지 남기기</h3>
                <div className="flex flex-wrap gap-2">
                  <button
                    disabled={busy}
                    onClick={() => (recording ? stop() : void start())}
                    className="flex min-h-11 items-center gap-2 rounded-full border border-line px-4"
                  >
                    {recording ? <Square className="size-4" /> : <Mic className="size-4" />}
                    {recording ? `녹음 마치기 ${elapsed}/60초` : "녹음 시작"}
                  </button>
                  <label className="flex min-h-11 cursor-pointer items-center rounded-full border border-line px-4">
                    음성 파일 선택
                    <input
                      type="file"
                      accept="audio/*"
                      aria-label="보이스 메일 음성 파일"
                      className="sr-only"
                      disabled={busy || recording}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (!file) return;
                        if (
                          !file.type.startsWith("audio/") ||
                          !file.size ||
                          file.size > MAIL_BYTES
                        ) {
                          setNote("1MB 이하의 음성 파일을 선택하세요.");
                          return;
                        }
                        setDraft(file);
                        setText("");
                        setNote("파일을 확인하고 메일을 남기세요.");
                      }}
                    />
                  </label>
                </div>
                <p className="text-xs text-muted">
                  최대 60초 녹음 · 파일은 1MB 이하. 닫거나 앱이 잠기면 저장하지 않은 녹음은
                  사라집니다.
                </p>
                {draft ? <MailAudio parts={[draft]} /> : null}
                <textarea
                  aria-label="보이스 메일 내용"
                  placeholder="함께 남길 내용 또는 받아쓴 내용을 입력하세요."
                  value={text}
                  maxLength={5000}
                  disabled={busy || recording}
                  onChange={(event) => setText(event.target.value)}
                  className="min-h-24 w-full rounded-xl border border-line bg-bg p-3"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    disabled={!draft || busy || recording}
                    className="min-h-11 rounded-full border border-line px-4"
                    onClick={() =>
                      void job(async () => {
                        const result = await transcribeSpeech({
                          data: { audio: await audioBase64(draft!), mime: draft!.type },
                        });
                        if (!mounted.current) return;
                        if (!result.ok) throw new Error(result.error);
                        setText(result.text);
                        setNote("받아쓰기 완료. 내용을 확인해 주세요.");
                      })
                    }
                  >
                    받아쓰기 (API)
                  </button>
                  <button
                    disabled={!draft || busy || recording}
                    className="min-h-11 rounded-full bg-primary px-4 text-ink"
                    onClick={() =>
                      void job(async () => {
                        await addVoiceMail({
                          id: crypto.randomUUID(),
                          personaId,
                          personaName: persona.name,
                          direction: "sent",
                          createdAt: Date.now(),
                          text: text.trim(),
                          audio: [draft!],
                          heard: false,
                        });
                        await refresh();
                        if (mounted.current) {
                          setDraft(null);
                          setText("");
                          setNote(`${persona.name}에게 보이스 메일을 남겼습니다.`);
                        }
                      })
                    }
                  >
                    메일 남기기
                  </button>
                </div>
              </section>
              <section className="space-y-3 rounded-2xl border border-line p-4">
                <h3>{persona.name}의 답변 보관하기</h3>
                {latest ? (
                  <>
                    <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-sm text-muted">
                      {latest.text}
                    </p>
                    <p className="text-xs text-muted">
                      누르면 음성 합성 API를 {mailSpeechChunks(latest.text).length}번 호출합니다.
                      보관한 뒤 듣기는 API를 사용하지 않습니다.
                    </p>
                    <button
                      disabled={busy || recording}
                      className="min-h-11 w-full rounded-full border border-line"
                      onClick={() => void job(saveReceived)}
                    >
                      최근 답변을 음성 메일로 보관 (API)
                    </button>
                  </>
                ) : (
                  <p className="text-sm text-muted">
                    이 페르소나의 답변이 아직 없습니다. 먼저 대화를 나눠 주세요.
                  </p>
                )}
              </section>
              <p role="status" className="text-sm text-muted">
                {busy ? "보이스 메일 처리 중…" : note}
              </p>
              <section className="space-y-3">
                <h3>메일함 · {mails.filter((mail) => mail.personaId === personaId).length}개</h3>
                {mails
                  .filter((mail) => mail.personaId === personaId)
                  .map((mail) => (
                    <article key={mail.id} className="space-y-3 rounded-2xl border border-line p-4">
                      <div className="flex flex-wrap justify-between gap-2 text-sm">
                        <span>
                          {mail.direction === "sent"
                            ? `나 → ${mail.personaName}`
                            : `${mail.personaName} → 나`}{" "}
                          · {mail.heard ? "들은 메일" : "아직 안 들음"}
                        </span>
                        <time className="text-xs text-muted">
                          {new Date(mail.createdAt).toLocaleString("ko-KR")}
                        </time>
                      </div>
                      <MailAudio
                        parts={mail.audio}
                        heard={() => {
                          if (!mail.heard)
                            void markVoiceMailHeard(mail.id)
                              .then(() => {
                                if (mounted.current)
                                  setMails((previous) =>
                                    previous.map((item) =>
                                      item.id === mail.id ? { ...item, heard: true } : item,
                                    ),
                                  );
                              })
                              .catch((error) => setNote(errorText(error)));
                        }}
                      />
                      {mail.text ? (
                        <p className="whitespace-pre-wrap text-sm">{mail.text}</p>
                      ) : (
                        <p className="text-xs text-muted">
                          내용을 받아쓰거나 입력해야 페르소나에게 답변을 요청할 수 있습니다.
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {mail.direction === "sent" ? (
                          <>
                            <button
                              disabled={busy || recording}
                              className="min-h-11 rounded-full border border-line px-3 text-sm"
                              onClick={() => {
                                setEditing(mail.id);
                                setEditText(mail.text);
                              }}
                            >
                              내용 입력·수정
                            </button>
                            <button
                              disabled={busy || recording}
                              className="min-h-11 rounded-full border border-line px-3 text-sm"
                              onClick={() =>
                                void job(async () => {
                                  const result = await transcribeSpeech({
                                    data: {
                                      audio: await audioBase64(mail.audio[0]),
                                      mime: mail.audio[0].type,
                                    },
                                  });
                                  if (!mounted.current) return;
                                  if (!result.ok) throw new Error(result.error);
                                  await updateText(mail.id, result.text);
                                  setNote("저장된 메일 받아쓰기 완료. 내용을 확인해 주세요.");
                                })
                              }
                            >
                              이 메일 받아쓰기 (API)
                            </button>
                          </>
                        ) : null}
                        {mail.direction === "sent" ? (
                          <button
                            disabled={busy || recording || !mail.text}
                            className="min-h-11 rounded-full border border-line px-3 text-sm"
                            onClick={() => {
                              onReply(mail.text, mail.personaId);
                            }}
                          >
                            대화로 가져와 답하기 (API)
                          </button>
                        ) : null}
                        <button
                          disabled={busy || recording}
                          className="min-h-11 rounded-full border border-line px-3 text-sm"
                          onClick={() => setRemove(mail.id)}
                        >
                          메일 삭제
                        </button>
                      </div>
                      {editing === mail.id ? (
                        <div className="space-y-2">
                          <textarea
                            aria-label="저장된 보이스 메일 내용"
                            maxLength={5000}
                            value={editText}
                            onChange={(event) => setEditText(event.target.value)}
                            className="min-h-24 w-full rounded-xl border border-line bg-bg p-3"
                          />
                          <div className="flex gap-2">
                            <button
                              disabled={busy}
                              className="min-h-11 rounded-full border border-line px-3"
                              onClick={() => setEditing(null)}
                            >
                              수정 취소
                            </button>
                            <button
                              disabled={busy}
                              className="min-h-11 rounded-full border border-line px-3"
                              onClick={() =>
                                void job(async () => {
                                  await updateText(mail.id, editText);
                                  setEditing(null);
                                  setNote("메일 내용을 저장했습니다.");
                                })
                              }
                            >
                              메일 내용 저장
                            </button>
                          </div>
                        </div>
                      ) : null}
                      {remove === mail.id ? (
                        <div className="space-y-2" role="alert">
                          <p className="text-sm">이 음성 메일을 삭제할까요? 되돌릴 수 없습니다.</p>
                          <div className="flex gap-2">
                            <button
                              disabled={busy}
                              className="min-h-11 rounded-full border border-line px-3"
                              onClick={() => setRemove(null)}
                            >
                              취소
                            </button>
                            <button
                              disabled={busy}
                              className="min-h-11 rounded-full border border-line px-3"
                              onClick={() =>
                                void job(async () => {
                                  await removeVoiceMail(mail.id);
                                  await refresh();
                                  setRemove(null);
                                  setNote("메일을 삭제했습니다.");
                                })
                              }
                            >
                              메일 영구 삭제
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </article>
                  ))}
                {!mails.some((mail) => mail.personaId === personaId) ? (
                  <p className="text-sm text-muted">보관된 보이스 메일이 없습니다.</p>
                ) : null}
              </section>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
