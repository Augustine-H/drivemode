import { useEffect, useRef, useState } from "react";
import { transcribeSpeech } from "@/lib/stt";
import { collapseStutter, mergeUtterance, sessionTranscript } from "@/lib/speech-text";
import { SpeechOnsetDetector } from "@/lib/speech-onset";

type Options = {
  paused: boolean;
  forceRecord?: boolean;
  keepListening?: boolean;
  idleMs?: number;
  acceptText?: (text: string) => string | null;
  verifyAudio?: (audio: Blob) => Promise<boolean>;
  silenceMs: number;
  autoSend: boolean;
  onText: (text: string) => void;
  onUtterance: (text: string) => void;
  onError: (message: string) => void;
  onSpeechStart?: () => void;
};

type Rec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<{ 0?: { transcript?: string } }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
};

function recognitionCtor() {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    webkitSpeechRecognition?: new () => Rec;
    SpeechRecognition?: new () => Rec;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

type Live = {
  id: number;
  stream: MediaStream;
  ctx: AudioContext;
  recorder: MediaRecorder;
  chunks: Blob[];
  heard: boolean;
  onset: SpeechOnsetDetector;
  quietSince: number;
  started: number;
  timer: number;
  done: boolean;
};

function micMessage(err: unknown) {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "마이크 권한을 허용해 주세요. 주소창의 자물쇠에서 마이크를 켜 주세요.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "마이크를 찾지 못했습니다.";
  if (name === "NotReadableError") return "마이크를 다른 앱이 쓰고 있습니다.";
  if (name === "SecurityError") return "이 화면에서는 마이크가 막혀 있습니다.";
  return "마이크를 켜지 못했습니다.";
}

function pickMime() {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  if (typeof MediaRecorder === "undefined") return "";
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function rmsOf(analyser: AnalyserNode, buf: Uint8Array) {
  analyser.getByteTimeDomainData(buf as Uint8Array<ArrayBuffer>);
  let sum = 0;
  for (let i = 0; i < buf.length; i += 1) {
    const v = (buf[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / buf.length);
}

function encodeWav(buffer: AudioBuffer) {
  const src = buffer.getChannelData(0);
  const rate = 16000;
  const step = buffer.sampleRate / rate;
  const length = Math.max(1, Math.floor(src.length / step));
  const header = 44;
  const out = new ArrayBuffer(header + length * 2);
  const view = new DataView(out);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i += 1) {
    const sample = Math.max(-1, Math.min(1, src[Math.floor(i * step)] ?? 0));
    view.setInt16(header + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const size = 0x2000;
  for (let i = 0; i < bytes.length; i += size) {
    binary += String.fromCharCode(...bytes.subarray(i, i + size));
  }
  return btoa(binary);
}

async function blobToWavBase64(blob: Blob) {
  const ctx = new AudioContext();
  try {
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    return { audio: bytesToBase64(new Uint8Array(encodeWav(audio))), mime: "audio/wav" };
  } finally {
    void ctx.close();
  }
}

function stopRecorder(item: Live) {
  return new Promise<Blob>((resolve) => {
    item.recorder.onstop = () => {
      resolve(new Blob(item.chunks, { type: item.recorder.mimeType || "audio/webm" }));
    };
    if (item.recorder.state === "inactive") {
      resolve(new Blob(item.chunks, { type: item.recorder.mimeType || "audio/webm" }));
      return;
    }
    item.recorder.stop();
  });
}

export function useDictation({
  paused,
  forceRecord,
  keepListening,
  idleMs,
  acceptText,
  verifyAudio,
  silenceMs,
  autoSend,
  onText,
  onUtterance,
  onError,
  onSpeechStart,
}: Options) {
  const [armed, setArmed] = useState(false);
  const [hearing, setHearing] = useState(false);
  const [note, setNote] = useState("");
  const [blocked, setBlocked] = useState(false);
  const wanted = useRef(false);
  const pausedRef = useRef(paused);
  const busy = useRef(false);
  const starting = useRef(false);
  const session = useRef(0);
  const live = useRef<Live | null>(null);
  const recRef = useRef<Rec | null>(null);
  const speechText = useRef("");
  const bufferRef = useRef("");
  const sendTimer = useRef(0);
  const speechIdleAt = useRef(Date.now());
  const speechCursor = useRef(0);
  const speechRows = useRef(0);
  const genRef = useRef(0);
  const modeRef = useRef<"speech" | "record">("speech");
  const callbacks = useRef({
    silenceMs,
    autoSend,
    onText,
    onUtterance,
    onError,
    onSpeechStart,
    verifyAudio,
    forceRecord,
    keepListening,
    idleMs,
    acceptText,
  });
  pausedRef.current = paused;
  callbacks.current = {
    silenceMs,
    autoSend,
    onText,
    onUtterance,
    onError,
    onSpeechStart,
    verifyAudio,
    forceRecord,
    keepListening,
    idleMs,
    acceptText,
  };

  const deliverText = (text: string, send = false) => {
    const reason = callbacks.current.acceptText?.(text);
    if (reason) {
      setNote(reason);
      return;
    }
    if (send) callbacks.current.onUtterance(text);
    else callbacks.current.onText(text);
  };

  const clearSend = () => {
    window.clearTimeout(sendTimer.current);
    sendTimer.current = 0;
  };

  const scheduleSend = () => {
    clearSend();
    if (!callbacks.current.autoSend) return;
    sendTimer.current = window.setTimeout(() => {
      sendTimer.current = 0;
      const said = bufferRef.current.trim();
      if (!said || !wanted.current) return;
      if (!callbacks.current.keepListening) {
        genRef.current += 1;
        wanted.current = false;
        setArmed(false);
        closeSpeech();
        setHearing(false);
      } else speechCursor.current = speechRows.current;
      bufferRef.current = "";
      speechText.current = "";
      setNote(said);
      deliverText(said, true);
    }, callbacks.current.silenceMs);
  };

  const disarm = (message = "") => {
    wanted.current = false;
    clearSend();
    genRef.current += 1;
    bufferRef.current = "";
    speechText.current = "";
    setArmed(false);
    setHearing(false);
    setNote(message);
    setBlocked(Boolean(message));
    if (message) callbacks.current.onError(message);
  };

  const closeSpeech = () => {
    const rec = recRef.current;
    recRef.current = null;
    if (!rec) return;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    try {
      rec.abort();
    } catch {
      /* already stopped */
    }
  };

  const startSpeech = () => {
    if (callbacks.current.verifyAudio || callbacks.current.forceRecord) return false;
    closeSpeech();
    const Ctor = recognitionCtor();
    if (!Ctor) return false;
    const rec = new Ctor();
    rec.lang = "ko-KR";
    rec.continuous = true;
    rec.interimResults = true;
    const carried = bufferRef.current;
    speechCursor.current = 0;
    speechRows.current = 0;
    speechIdleAt.current = Date.now();
    const gen = ++genRef.current;
    rec.onresult = (event) => {
      if (gen !== genRef.current) return;
      speechRows.current = event.results.length;
      if (pausedRef.current && callbacks.current.keepListening) {
        speechCursor.current = event.results.length;
        return;
      }
      const rows = Array.from(event.results).slice(
        callbacks.current.keepListening ? speechCursor.current : 0,
      );
      const incoming = sessionTranscript({ results: rows });
      if (!incoming) return;
      const text = collapseStutter(mergeUtterance(carried, incoming));
      if (!text || text === bufferRef.current) {
        if (text && !sendTimer.current) scheduleSend();
        return;
      }
      speechIdleAt.current = Date.now();
      bufferRef.current = text;
      speechText.current = text;
      if (!callbacks.current.acceptText) callbacks.current.onText(text);
      // Keep interim speech out of the composer: an incomplete announcement
      // could otherwise be sent manually before the final filter can reject it.
      setNote(text);
      scheduleSend();
    };
    rec.onerror = (event) => {
      const code = event.error ?? "";
      if (code === "no-speech" || code === "aborted") return;
      closeSpeech();
      if (
        typeof navigator !== "undefined" &&
        navigator.mediaDevices &&
        modeRef.current !== "record"
      ) {
        modeRef.current = "record";
        setNote("마이크 권한을 요청합니다");
        void begin();
        return;
      }
      disarm(
        code === "not-allowed" || code === "service-not-allowed"
          ? "미리보기에서 마이크가 막혔습니다. 아래 음성 파일로 받아쓸 수 있습니다."
          : "음성 받아쓰기에 연결하지 못했습니다.",
      );
    };
    rec.onend = () => {
      if (recRef.current !== rec) return;
      recRef.current = null;
      if (gen !== genRef.current) return;
      if (!wanted.current || pausedRef.current || modeRef.current !== "speech") return;
      wanted.current = false;
      setArmed(false);
      setHearing(false);
      const said = bufferRef.current.trim();
      clearSend();
      bufferRef.current = "";
      speechText.current = "";
      setNote(said || "음성 입력이 끝났습니다. 다시 말하려면 마이크를 누르세요.");
      if (said && !callbacks.current.autoSend) deliverText(said);
      if (said && callbacks.current.autoSend) deliverText(said, true);
    };
    try {
      rec.start();
    } catch {
      return false;
    }
    recRef.current = rec;
    modeRef.current = "speech";
    setHearing(true);
    setNote(
      callbacks.current.autoSend
        ? "듣는 중. 말이 끊기면 그록이 답합니다."
        : "듣는 중. 끝나면 마이크를 다시 누르세요.",
    );
    return true;
  };

  const release = (item: Live) => {
    window.clearInterval(item.timer);
    item.stream.getTracks().forEach((track) => track.stop());
    void item.ctx.close().catch(() => {});
    if (live.current === item) live.current = null;
  };

  const finish = async (item: Live, commit: boolean, send: boolean) => {
    if (item.done) return;
    const keep = Boolean(callbacks.current.keepListening && commit && wanted.current);
    if (!keep) {
      wanted.current = false;
      setArmed(false);
      window.clearInterval(item.timer);
    }
    item.done = true;
    const blob = await stopRecorder(item);
    if (!keep) release(item);
    if (!commit || !item.heard || blob.size < 400) {
      if (keep) restartCapture(item);
      setHearing(false);
      if (commit && wanted.current)
        setNote("목소리가 들리지 않았습니다. 마이크를 가까이 해 주세요.");
      if (!wanted.current) setNote("");
      return;
    }
    busy.current = true;
    setHearing(false);
    setNote("받아쓰는 중");
    try {
      if (callbacks.current.verifyAudio) {
        setNote("내 목소리인지 확인하는 중");
        const accepted = await callbacks.current.verifyAudio(blob);
        if (session.current !== item.id) return;
        if (!accepted) {
          setNote("등록된 목소리와 달라 무시했습니다. 다시 말하려면 마이크를 누르세요.");
          return;
        }
      }
      let audio = "";
      let mime = "audio/wav";
      try {
        const wav = await blobToWavBase64(blob);
        audio = wav.audio;
        mime = wav.mime;
      } catch {
        audio = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
        mime = (blob.type || "audio/webm").split(";")[0];
      }
      if (session.current !== item.id) return;
      const result = await transcribeSpeech({ data: { audio, mime } });
      if (!result.ok) {
        setNote(result.error);
        callbacks.current.onError(result.error);
        return;
      }
      if (session.current !== item.id) return;
      setNote(result.text);
      deliverText(result.text);
      if (send) deliverText(result.text, true);
    } catch (error) {
      if (session.current === item.id) {
        const message =
          error instanceof Error
            ? error.message
            : "목소리를 확인하지 못했습니다. 음성을 보내지 않았습니다.";
        setNote(message);
        callbacks.current.onError(message);
      }
    } finally {
      busy.current = false;
      if (keep && session.current === item.id && wanted.current) restartCapture(item);
      else setHearing(false);
    }
  };

  const restartCapture = (item: Live) => {
    if (!wanted.current || live.current !== item) return;
    item.chunks = [];
    item.heard = false;
    item.onset = new SpeechOnsetDetector();
    item.started = Date.now();
    item.done = false;
    item.recorder = new MediaRecorder(item.stream);
    item.recorder.ondataavailable = (event) => {
      if (event.data.size) item.chunks.push(event.data);
    };
    item.recorder.start();
    if (pausedRef.current) item.recorder.pause();
    setHearing(!pausedRef.current);
  };

  const begin = async () => {
    if (starting.current || live.current) return;
    const id = session.current;
    starting.current = true;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      starting.current = false;
      disarm("이 브라우저는 마이크 받아쓰기를 지원하지 않아요.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      starting.current = false;
      if (session.current !== id) return;
      disarm(micMessage(err));
      return;
    }
    if (!wanted.current || pausedRef.current || session.current !== id) {
      starting.current = false;
      stream.getTracks().forEach((track) => track.stop());
      setHearing(false);
      return;
    }
    const mime = pickMime();
    let recorder: MediaRecorder;
    try {
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch {
      starting.current = false;
      stream.getTracks().forEach((track) => track.stop());
      disarm("이 브라우저에서는 녹음을 시작하지 못했습니다.");
      return;
    }
    const ctx = new AudioContext();
    void ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const item: Live = {
      id,
      stream,
      ctx,
      recorder,
      chunks: [],
      heard: false,
      onset: new SpeechOnsetDetector(),
      quietSince: Date.now(),
      started: Date.now(),
      timer: 0,
      done: false,
    };
    recorder.ondataavailable = (event) => {
      if (event.data.size) item.chunks.push(event.data);
    };
    live.current = item;
    starting.current = false;
    recorder.start();
    setHearing(true);
    setNote(
      callbacks.current.autoSend
        ? "듣는 중. 말이 끊기면 그록이 답합니다."
        : "듣는 중. 끝나면 마이크를 다시 누르세요.",
    );
    item.timer = window.setInterval(() => {
      if (item.done) return;
      if (
        callbacks.current.keepListening &&
        callbacks.current.idleMs &&
        Date.now() - item.quietSince >= callbacks.current.idleMs
      ) {
        void finish(item, false, false);
        return;
      }
      if (pausedRef.current || busy.current) return;
      const level = rmsOf(analyser, buf);
      const now = Date.now();
      if (item.onset.update(level,now)) callbacks.current.onSpeechStart?.();
      const tooLong = now - item.started > 29000;
      if (level > (callbacks.current.verifyAudio || callbacks.current.forceRecord ? 0.008 : 0.02)) {
        item.heard = true;
        item.quietSince = now;
        if (!tooLong) return;
      }
      if (
        callbacks.current.keepListening &&
        callbacks.current.idleMs &&
        now - item.quietSince >= callbacks.current.idleMs
      ) {
        void finish(item, false, false);
        return;
      }
      if (!item.heard) {
        if (tooLong && callbacks.current.keepListening) {
          item.recorder.ondataavailable = null;
          item.recorder.stop();
          restartCapture(item);
          return;
        }
        if (
          !callbacks.current.keepListening &&
          callbacks.current.idleMs &&
          now - item.started >= callbacks.current.idleMs
        )
          void finish(item, false, false);
        return;
      }
      const quietFor = now - (item.quietSince || now);
      if (
        tooLong ||
        ((callbacks.current.autoSend || callbacks.current.idleMs) &&
          quietFor >=
            (callbacks.current.keepListening
              ? callbacks.current.silenceMs
              : (callbacks.current.idleMs ?? callbacks.current.silenceMs)))
      ) {
        if (!callbacks.current.autoSend) {
          wanted.current = false;
          setArmed(false);
        }
        void finish(item, true, callbacks.current.autoSend);
      }
    }, 100);
  };

  const arm = () => {
    if (wanted.current) return;
    session.current += 1;
    wanted.current = true;
    setBlocked(false);
    setArmed(true);
    modeRef.current =
      !callbacks.current.verifyAudio && !callbacks.current.forceRecord && recognitionCtor()
        ? "speech"
        : "record";
    setNote("말하기를 켭니다");
    if (!pausedRef.current) {
      if (modeRef.current === "speech" && startSpeech()) return;
      modeRef.current = "record";
      void begin();
    }
  };

  const stop = () => {
    session.current += 1;
    const item = live.current;
    wanted.current = false;
    clearSend();
    genRef.current += 1;
    bufferRef.current = "";
    closeSpeech();
    setArmed(false);
    setHearing(false);
    setNote("");
    speechText.current = "";
    if (item?.done) release(item);
    else if (item) void finish(item, false, false);
  };

  const fromFile = async (file: File) => {
    const id = ++session.current;
    busy.current = true;
    setBlocked(false);
    setNote("받아쓰는 중");
    try {
      if (callbacks.current.verifyAudio) {
        setNote("내 목소리인지 확인하는 중");
        const accepted = await callbacks.current.verifyAudio(file);
        if (session.current !== id) return;
        if (!accepted) {
          setNote("등록된 목소리와 달라 무시했습니다.");
          return;
        }
      }
      let audio = "";
      let mime = "audio/wav";
      try {
        const wav = await blobToWavBase64(file);
        audio = wav.audio;
        mime = wav.mime;
      } catch {
        audio = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
        mime = (file.type || "audio/webm").split(";")[0];
      }
      if (session.current !== id) return;
      const result = await transcribeSpeech({ data: { audio, mime } });
      if (!result.ok) {
        setNote(result.error);
        setBlocked(true);
        callbacks.current.onError(result.error);
        return;
      }
      if (session.current !== id) return;
      setNote(result.text);
      deliverText(result.text);
      if (callbacks.current.autoSend) deliverText(result.text, true);
    } catch (error) {
      if (session.current === id) {
        const message = error instanceof Error ? error.message : "목소리를 확인하지 못했습니다.";
        setNote(message);
        callbacks.current.onError(message);
      }
    } finally {
      busy.current = false;
    }
  };

  const toggle = () => {
    const item = live.current;
    if (wanted.current && (recRef.current || item || busy.current || bufferRef.current.trim())) {
      const said = (speechText.current || bufferRef.current).trim();
      const send = Boolean(said) || Boolean(item?.heard);
      session.current += 1;
      wanted.current = false;
      clearSend();
      genRef.current += 1;
      bufferRef.current = "";
      closeSpeech();
      setArmed(false);
      setHearing(false);
      speechText.current = "";
      if (said) {
        setNote(said);
        deliverText(said);
        if (callbacks.current.autoSend) deliverText(said, true);
      } else if (item) {
        item.id = session.current;
        void finish(item, send, send && callbacks.current.autoSend);
        setNote(send ? "받아쓰는 중" : "");
      } else setNote("");
      return;
    }
    if (pausedRef.current) {
      setNote("그록이 말하는 동안에는 마이크가 기다립니다.");
      setArmed(true);
      wanted.current = true;
      modeRef.current = !callbacks.current.verifyAudio && recognitionCtor() ? "speech" : "record";
      return;
    }
    session.current += 1;
    wanted.current = true;
    clearSend();
    bufferRef.current = "";
    speechText.current = "";
    setBlocked(false);
    setArmed(true);
    setHearing(true);
    setNote("마이크를 켜는 중");
    if (!callbacks.current.verifyAudio && recognitionCtor() && startSpeech()) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      disarm("이 브라우저에서는 마이크를 쓸 수 없습니다. 음성 파일을 올려 주세요.");
      return;
    }
    modeRef.current = "record";
    void begin();
  };

  useEffect(() => {
    if (!wanted.current) return;
    if (callbacks.current.keepListening) {
      speechCursor.current = speechRows.current;
      bufferRef.current = "";
      speechText.current = "";
      clearSend();
      const item = live.current;
      if (item && !item.done) {
        item.heard = false;
        item.started = Date.now();
        if (paused && item.recorder.state === "recording") item.recorder.pause();
        if (!paused && item.recorder.state === "paused") item.recorder.resume();
      }
      setHearing(!paused);
      if (!paused && !recRef.current && !live.current && !busy.current) {
        if (modeRef.current === "speech" && startSpeech()) return;
        modeRef.current = "record";
        void begin();
      }
      return;
    }
    if (paused) {
      const item = live.current;
      wanted.current = false;
      setArmed(false);
      closeSpeech();
      if (item && !item.done) void finish(item, false, false);
      setHearing(false);
      return;
    }
    if (modeRef.current === "speech" && recognitionCtor()) {
      if (!recRef.current && !busy.current) startSpeech();
      return;
    }
    if (!live.current && !busy.current) void begin();
    // resume after Grok finishes speaking
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (
        !wanted.current ||
        !callbacks.current.keepListening ||
        !callbacks.current.idleMs ||
        !recRef.current
      )
        return;
      if (Date.now() - speechIdleAt.current >= callbacks.current.idleMs) stop();
    }, 100);
    return () => window.clearInterval(timer);
    // The timer reads current callbacks and session refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      session.current += 1;
      closeSpeech();
      const item = live.current;
      if (!item) return;
      item.done = true;
      release(item);
    },
    [],
  );

  return { armed, hearing, note, blocked, toggle, stop, fromFile, arm };
}
