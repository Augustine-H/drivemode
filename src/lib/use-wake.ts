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
  const w = window as Window & {
    webkitSpeechRecognition?: new () => Rec;
    SpeechRecognition?: new () => Rec;
  };
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
  pausedRef.current = paused;
  nameRef.current = name;
  callbacks.current = { onWake, onError };

  const close = () => {
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
      setStandby(false);
      callbacks.current.onWake(rest);
    };
    rec.onerror = (event) => {
      const code = event.error ?? "";
      if (code === "no-speech" || code === "aborted") return;
      if (code === "network" || code === "audio-capture") {
        close();
        wanted.current = false;
        setListening(false);
        setStandby(false);
        setNote("이름 듣기가 멈췄습니다. 설정에서 다시 켜세요.");
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
      wanted.current = false;
      setListening(false);
      setStandby(false);
      setNote("이름 듣기가 끝났습니다. 설정에서 다시 켜세요.");
    };
    try {
      rec.start();
    } catch {
      wanted.current = false;
      setStandby(false);
      setNote("이름 부르기를 시작하지 못했습니다.");
      return;
    }
    recRef.current = rec;
    setListening(true);
    setNote("");
  };

  const kick = () => {
    wanted.current = true;
    setStandby(true);
    open();
  };

  const halt = () => {
    wanted.current = false;
    tail.current = "";
    close();
    setListening(false);
    setStandby(false);
    setNote("");
  };

  useEffect(() => {
    if (!enabled || paused) {
      wanted.current = false;
      setStandby(false);
      close();
      setListening(false);
      return;
    }
    setStandby(wanted.current);
    if (wanted.current && !recRef.current) open();
    // A stopped session stays stopped until the user explicitly starts it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, paused]);

  useEffect(() => () => close(), []);

  return { listening, standby, note, kick, halt };
}
