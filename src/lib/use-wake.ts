import { useEffect, useRef, useState } from "react";
import { takeWake } from "@/lib/wake";
import { mergeUtterance, sessionTranscript } from "@/lib/speech-text";

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

type Options = {
  enabled: boolean;
  paused: boolean;
  name: string;
  onWake: (rest: string) => void;
  onError: (message: string) => void;
};

function recognitionCtor() {
  if (typeof window === "undefined") return null;
  const w = window as Window & { webkitSpeechRecognition?: new () => Rec; SpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useWake({ enabled, paused, name, onWake, onError }: Options) {
  const [listening, setListening] = useState(false);
  const [standby, setStandby] = useState(false);
  const [note, setNote] = useState("");
  const wanted = useRef(false);
  const tail = useRef("");
  const pausedRef = useRef(paused);
  const nameRef = useRef(name);
  const recRef = useRef<Rec | null>(null);
  const callbacks = useRef({ onWake, onError });
  const retryTimer = useRef(0);
  const openedAt = useRef(0);
  pausedRef.current = paused;
  nameRef.current = name;
  callbacks.current = { onWake, onError };

  const clearRetry = () => {
    window.clearTimeout(retryTimer.current);
    retryTimer.current = 0;
  };

  const close = () => {
    clearRetry();
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

  const open = () => {
    if (recRef.current || pausedRef.current || !wanted.current) return;
    const key = nameRef.current.replace(/\s+/g, "").trim();
    if (!key) {
      setNote("페르소나 이름을 먼저 정해 주세요.");
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setNote("이 브라우저는 이름 부르기를 지원하지 않아요.");
      return;
    }
    const rec = new Ctor();
    rec.lang = "ko-KR";
    rec.continuous = true;
    rec.interimResults = true;
    let fired = false;
    let heard = "";
    rec.onresult = (event) => {
      if (fired) return;
      heard = sessionTranscript(event);
      const rest = takeWake(mergeUtterance(tail.current, heard), nameRef.current);
      if (rest === null) return;
      fired = true;
      tail.current = "";
      close();
      setListening(false);
      callbacks.current.onWake(rest);
    };
    rec.onerror = (event) => {
      const code = event.error ?? "";
      if (code === "no-speech" || code === "aborted") return;
      if (code === "network" || code === "audio-capture") {
        close();
        if (wanted.current && !pausedRef.current) scheduleOpen(false);
        return;
      }
      close();
      setListening(false);
      const message =
        code === "not-allowed" || code === "service-not-allowed"
          ? "이름 부르기를 쓰려면 마이크 권한을 허용해 주세요."
          : "이름 부르기에 연결하지 못했습니다.";
      setNote(message);
      callbacks.current.onError(message);
      wanted.current = false;
    };
    rec.onend = () => {
      const said = heard;
      if (said) tail.current = mergeUtterance(tail.current, said).slice(-24);
      if (recRef.current !== rec) return;
      recRef.current = null;
      if (!wanted.current || pausedRef.current || fired) {
        setListening(false);
        return;
      }
      scheduleOpen(Boolean(said));
    };
    try {
      rec.start();
    } catch {
      setNote("이름 부르기를 시작하지 못했습니다.");
      return;
    }
    recRef.current = rec;
    openedAt.current = Date.now();
    setListening(true);
    setNote("");
  };

  const scheduleOpen = (heardSomething: boolean) => {
    clearRetry();
    const lived = openedAt.current ? Date.now() - openedAt.current : 0;
    const wait = heardSomething || lived > 20000 ? 800 : 12000;
    retryTimer.current = window.setTimeout(() => {
      retryTimer.current = 0;
      if (!wanted.current || pausedRef.current || recRef.current) return;
      open();
    }, wait);
  };

  const kick = () => {
    wanted.current = true;
    open();
  };

  const halt = () => {
    wanted.current = false;
    tail.current = "";
    close();
    setListening(false);
    setNote("");
  };

  useEffect(() => {
    if (!enabled || paused) {
      setStandby(false);
      close();
      setListening(false);
      return;
    }
    setStandby(true);
    wanted.current = true;
    if (!recRef.current && !retryTimer.current) open();
    // resume after speaking mode or playback ends
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, paused]);

  useEffect(() => () => close(), []);

  return { listening, standby, note, kick, halt };
}
