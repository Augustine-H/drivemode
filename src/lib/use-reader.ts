import { useCallback, useEffect, useRef, useState } from "react";
import { speakLine } from "@/lib/tts";
import { chunkText, type Speaker, type Turn } from "@/lib/transcript";
import { API_VOICES } from "@/lib/voices";
import { GoogleTtsProvider, selectedTts } from "@/lib/google-tts-client";
import { speechForTurn } from './reader-parts';

export type PlayStatus = "idle" | "playing" | "paused";

type Options = {
  turns: Turn[];
  rate: number;
  gap: number;
  voiceMe: string;
  voiceGrok: string;
  onlyGrok: boolean;
};

type Piece = { t: number; c: number; text: string; speaker: Speaker; voice?: string };

const audioCache = new Map<string, string>();
const audioInflight = new Map<string, Promise<string>>();
const RUN_BUDGET = 36;

function pieceAt(turns: Turn[], t: number, c: number, onlyGrok: boolean): Piece | null {
  let ti = t;
  let ci = c;
  while (ti < turns.length) {
    if (turns[ti]?.event || (onlyGrok && turns[ti]?.speaker !== "grok")) {
      ti += 1;
      ci = 0;
      continue;
    }
    const chunks = speechForTurn(turns[ti]);
    if (ci < chunks.length) {
      return { t: ti, c: ci, text: chunks[ci], speaker: turns[ti].speaker, voice: turns[ti].voice };
    }
    if (turns[ti]?.streaming) return null;
    ti += 1;
    ci = 0;
  }
  return null;
}

function cacheKey(text: string, voiceId: string, speed: number) {
  return `${voiceId}|${speed.toFixed(2)}|${text}`;
}

function bytesToUrl(b64: string) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
}

export function useReader({ turns, rate, gap, voiceMe, voiceGrok, onlyGrok }: Options) {
  const [status, setStatus] = useState<PlayStatus>("idle");
  const [turnIndex, setTurnIndex] = useState(0);
  const [chunkIndex, setChunkIndex] = useState(0);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  const turnsRef = useRef(turns);
  const rateRef = useRef(rate);
  const gapRef = useRef(gap);
  const voiceMeRef = useRef(voiceMe);
  const voiceGrokRef = useRef(voiceGrok);
  const onlyGrokRef = useRef(onlyGrok);
  const statusRef = useRef<PlayStatus>("idle");
  const turnRef = useRef(0);
  const chunkRef = useRef(0);
  const genRef = useRef(0);
  const mountedRef = useRef(true);
  const singleTurnRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const sleepResolveRef = useRef<((alive: boolean) => void) | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const budgetRef = useRef(RUN_BUDGET);
  const googleRef = useRef<GoogleTtsProvider | null>(null);
  const googleAbortRef = useRef<AbortController | null>(null);
  const playbackIdRef = useRef('');
  const settleRef = useRef<((result: "ended" | "stopped" | "error" | "blocked") => void) | null>(
    null,
  );

  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);
  onlyGrokRef.current = onlyGrok;

  const setStatusBoth = (next: PlayStatus) => {
    statusRef.current = next;
    setStatus(next);
  };

  const setPos = (t: number, c: number) => {
    turnRef.current = t;
    chunkRef.current = c;
    setTurnIndex(t);
    setChunkIndex(c);
  };

  const clearTimer = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    sleepResolveRef.current?.(false);
    sleepResolveRef.current = null;
  };

  const sleep = (ms: number, gen: number) =>
    new Promise<boolean>((resolve) => {
      sleepResolveRef.current = (alive) => {
        sleepResolveRef.current = null;
        resolve(alive && gen === genRef.current);
      };
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        sleepResolveRef.current?.(true);
      }, ms);
    });

  const settle = (result: "ended" | "stopped" | "error" | "blocked") => {
    const fn = settleRef.current;
    settleRef.current = null;
    fn?.(result);
  };

  const haltAudio = () => {
    googleAbortRef.current?.abort();
    googleAbortRef.current = null;
    googleRef.current?.stop();
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
    }
    const source = sourceRef.current;
    sourceRef.current = null;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
    }
    settle("stopped");
  };

  const cancelDevice = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  };

  const voiceFor = (speaker: Speaker) =>
    speaker === "me" ? voiceMeRef.current || "leo" : voiceGrokRef.current || "ara";

  const fetchAudio = useCallback(async (text: string, voiceId: string, speed: number) => {
    const key = cacheKey(text, voiceId, speed);
    const cached = audioCache.get(key);
    if (cached) return cached;
    const pending = audioInflight.get(key);
    if (pending) return pending;
    if (budgetRef.current <= 0) throw new Error("cap");
    budgetRef.current -= 1;
    const job = (async () => {
      try {
        const result = await speakLine({ data: { text, voiceId, speed } });
        if (!result.ok) throw new Error(result.error);
        const url = bytesToUrl(result.audio);
        audioCache.set(key, url);
        return url;
      } finally {
        audioInflight.delete(key);
      }
    })();
    audioInflight.set(key, job);
    return job;
  }, []);

  const prefetch = useCallback(
    (t: number, c: number) => {
      const next = pieceAt(turnsRef.current, t, c, onlyGrokRef.current);
      if (!next) return;
      if (selectedTts() === 'google') return;
      if (singleTurnRef.current !== null && next.t !== singleTurnRef.current) return;
      const voiceId =
        next.voice && API_VOICES.has(next.voice) ? next.voice : voiceFor(next.speaker);
      if (!API_VOICES.has(voiceId)) return;
      void fetchAudio(next.text, voiceId, rateRef.current).catch(() => {});
    },
    [fetchAudio],
  );

  useEffect(() => {
    if (statusRef.current === "playing") prefetch(turnRef.current, chunkRef.current + 1);
  }, [turns, prefetch]);

  const prime = useCallback(() => {
    if (typeof window === "undefined") return;
    const Ctx = window.AudioContext;
    if (!Ctx) return;
    if (!ctxRef.current) ctxRef.current = new Ctx();
    void ctxRef.current.resume();
  }, []);

  const playUrl = (url: string) => {
    const ctx = ctxRef.current;
    if (ctx && ctx.state === "running") {
      return new Promise<"ended" | "stopped" | "error" | "blocked">((resolve) => {
        settleRef.current = resolve;
        void (async () => {
          try {
            const res = await fetch(url);
            const raw = await res.arrayBuffer();
            if (settleRef.current !== resolve) return;
            const buffer = await ctx.decodeAudioData(raw);
            if (settleRef.current !== resolve) return;
            const node = ctx.createBufferSource();
            sourceRef.current = node;
            node.buffer = buffer;
            node.connect(ctx.destination);
            node.onended = () => {
              if (sourceRef.current === node) sourceRef.current = null;
              settle("ended");
            };
            node.start();
          } catch {
            if (settleRef.current === resolve) settle("error");
          }
        })();
      });
    }
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    return new Promise<"ended" | "stopped" | "error" | "blocked">((resolve) => {
      settleRef.current = resolve;
      audio.onended = () => settle("ended");
      audio.onerror = () => settle("error");
      audio.src = url;
      const pending = audio.play();
      if (pending) pending.catch(() => settle("blocked"));
    });
  };

  const speakDevice = (text: string, speaker: Speaker, gen: number) =>
    new Promise<"ended" | "stopped" | "error">((resolve) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        resolve("error");
        return;
      }
      const synth = window.speechSynthesis;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "ko-KR";
      u.rate = rateRef.current;
      const ko = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith("ko"));
      const voice = speaker === "grok" && ko.length > 1 ? ko[1] : ko[0];
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      } else {
        u.pitch = speaker === "grok" ? 0.94 : 1.04;
      }
      u.onend = () => resolve(gen === genRef.current ? "ended" : "stopped");
      u.onerror = (ev) => {
        if (ev.error === "interrupted" || ev.error === "canceled") {
          resolve("stopped");
          return;
        }
        resolve("error");
      };
      synth.cancel();
      window.setTimeout(() => {
        if (gen !== genRef.current) {
          resolve("stopped");
          return;
        }
        synth.speak(u);
      }, 40);
    });

  const speakFrom = useCallback(
    (turn: number, chunk: number, single = false) => {
      if (typeof window === "undefined" || !mountedRef.current) return;
      singleTurnRef.current = single ? turn : null;
      clearTimer();
      haltAudio();
      cancelDevice();
      const gen = ++genRef.current;
      playbackIdRef.current = crypto.randomUUID();
      budgetRef.current = RUN_BUDGET;
      setError(null);
      setStatusBoth("playing");
      setPreparing(true);

      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      audio.src =
        "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==";
      void audio
        .play()
        .then(() => {
          if (audio.src.startsWith("data:")) audio.pause();
        })
        .catch(() => {});

      void (async () => {
        let t = turn;
        let c = chunk;
        let useGap = false;

        while (gen === genRef.current) {
          if (useGap && gapRef.current > 0) {
            setPreparing(false);
            const alive = await sleep(gapRef.current * 1000, gen);
            if (!alive) return;
          }
          useGap = false;
          const piece = pieceAt(turnsRef.current, t, c, onlyGrokRef.current);
          const waiting = turnsRef.current.findIndex((turn, index) => index >= t && turn.streaming);
          if (!piece && waiting >= 0) {
            if (waiting !== t) {
              t = waiting;
              c = 0;
            }
            setPreparing(true);
            if (!(await sleep(80, gen))) return;
            continue;
          }
          if (!piece || (singleTurnRef.current !== null && piece.t !== singleTurnRef.current)) {
            setPos(turnsRef.current.length, 0);
            setPreparing(false);
            setStatusBoth("idle");
            return;
          }
          t = piece.t;
          c = piece.c;
          setPos(t, c);
          setStatusBoth("playing");
          const voiceId =
            piece.voice && API_VOICES.has(piece.voice) ? piece.voice : voiceFor(piece.speaker);
          prefetch(t, c + 1);

          let played = false;
          if (selectedTts() === 'google' && voiceId !== 'device') {
            setPreparing(true);
            try {
              prime();
              const context = ctxRef.current;
              if (!context) throw new Error('이 기기에서 스트리밍 음성을 재생할 수 없습니다.');
              await context.resume();
              if (gen !== genRef.current) return;
              const abort = new AbortController(); googleAbortRef.current = abort;
              const provider = googleRef.current ?? new GoogleTtsProvider(); googleRef.current = provider;
              await provider.stream(piece.text, `${playbackIdRef.current}:${turnsRef.current[t].id}:${c}`, context, abort.signal, () => setPreparing(false), rateRef.current);
              if (gen !== genRef.current) return;
              googleAbortRef.current = null;
              played = true;
            } catch (err) {
              if (gen !== genRef.current) return;
              setPreparing(false);
              setError(err instanceof Error ? err.message : 'Google 음성을 재생하지 못했습니다.');
              setStatusBoth('paused');
              return;
            }
          }
          if (!played && API_VOICES.has(voiceId)) {
            setPreparing(true);
            try {
              const url = await fetchAudio(piece.text, voiceId, rateRef.current);
              if (gen !== genRef.current) return;
              setPreparing(false);
              const result = await playUrl(url);
              if (gen !== genRef.current) return;
              if (result === "blocked") {
                setError("재생 버튼을 한 번 더 눌러 주세요.");
                setStatusBoth("paused");
                return;
              }
              if (result === "stopped") return;
              if (result === "error") {
                setError("이 문장을 재생하지 못했습니다.");
                setStatusBoth("paused");
                return;
              }
              played = true;
            } catch (err) {
              if (gen !== genRef.current) return;
              const message = err instanceof Error ? err.message : "";
              if (message === "cap") {
                setPreparing(false);
                setError("이번 재생은 여기까지입니다. 재생을 다시 누르면 이어서 읽습니다.");
                setStatusBoth("paused");
                return;
              }
            }
          }

          if (!played) {
            setPreparing(false);
            const device = await speakDevice(piece.text, piece.speaker, gen);
            if (gen !== genRef.current) return;
            if (device === "stopped") return;
            if (device === "error") {
              setError("이 기기에서 음성을 재생하지 못했습니다.");
              setStatusBoth("paused");
              return;
            }
          }

          const follow = pieceAt(turnsRef.current, t, c + 1, onlyGrokRef.current);
          if (!follow && turnsRef.current[t]?.streaming) {
            c += 1;
            continue;
          }
          if (singleTurnRef.current !== null && (!follow || follow.t !== singleTurnRef.current)) {
            setPos(t, 0);
            setPreparing(false);
            setStatusBoth("idle");
            return;
          }
          const nextWaiting = turnsRef.current.findIndex(
            (turn, index) => index > t && turn.streaming,
          );
          if (!follow && nextWaiting >= 0) {
            t = nextWaiting;
            c = 0;
            continue;
          }
          if (!follow) {
            setPos(turnsRef.current.length, 0);
            setPreparing(false);
            setStatusBoth("idle");
            return;
          }
          t = follow.t;
          c = follow.c;
          useGap = follow.c === 0;
        }
      })();
    },
    [fetchAudio, prefetch],
  );

  const stopAll = useCallback(() => {
    clearTimer();
    genRef.current += 1;
    haltAudio();
    cancelDevice();
    setPreparing(false);
  }, []);
  useEffect(() => {
    const changed = () => { stopAll(); setStatusBoth('idle'); };
    window.addEventListener('tts-provider-change', changed);
    window.addEventListener('pagehide', changed);
    return () => { window.removeEventListener('tts-provider-change', changed); window.removeEventListener('pagehide', changed); };
  }, [stopAll]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopAll();
    };
  }, [stopAll]);

  useEffect(() => {
    const prev = rateRef.current;
    rateRef.current = rate;
    if (prev !== rate && statusRef.current === "playing") {
      speakFrom(turnRef.current, chunkRef.current, singleTurnRef.current !== null);
    }
  }, [rate, speakFrom]);

  useEffect(() => {
    gapRef.current = gap;
  }, [gap]);

  useEffect(() => {
    const changed = voiceMeRef.current !== voiceMe || voiceGrokRef.current !== voiceGrok;
    voiceMeRef.current = voiceMe;
    voiceGrokRef.current = voiceGrok;
    if (changed && statusRef.current === "playing") {
      speakFrom(turnRef.current, chunkRef.current, singleTurnRef.current !== null);
    }
  }, [voiceMe, voiceGrok, speakFrom]);

  useEffect(() => {
    if (turnRef.current > turns.length) {
      stopAll();
      setPos(turns.length, 0);
      setStatusBoth("idle");
    }
  }, [turns.length, stopAll]);

  useEffect(() => {
    const hasSpeech = typeof window !== "undefined" && "speechSynthesis" in window;
    const hasAudio = typeof window !== "undefined" && typeof Audio !== "undefined";
    setSupported(hasSpeech || hasAudio);
    if (!hasSpeech) return;
    const synth = window.speechSynthesis;
    const keep = window.setInterval(() => {
      if (synth.speaking && !synth.paused && statusRef.current === "playing") {
        synth.pause();
        synth.resume();
      }
    }, 10000);
    return () => {
      window.clearInterval(keep);
      clearTimer();
      genRef.current += 1;
      haltAudio();
      synth.cancel();
    };
  }, []);

  const pause = useCallback(() => {
    if (statusRef.current !== "playing") return;
    stopAll();
    setStatusBoth("paused");
  }, [stopAll]);

  const play = useCallback(() => {
    if (statusRef.current === "playing") return;
    const list = turnsRef.current;
    if (list.length === 0) return;
    let t = turnRef.current;
    let c = chunkRef.current;
    if (t >= list.length) {
      t = 0;
      c = 0;
    }
    speakFrom(t, c, statusRef.current === "paused" && singleTurnRef.current === t);
  }, [speakFrom]);

  const toggle = useCallback(() => {
    if (statusRef.current === "playing") pause();
    else play();
  }, [pause, play]);

  const stop = useCallback(() => {
    stopAll();
    setPos(0, 0);
    setStatusBoth("idle");
  }, [stopAll]);

  const seek = useCallback(
    (t: number, c = 0) => {
      const list = turnsRef.current;
      const clamped = Math.max(0, Math.min(t, list.length));
      stopAll();
      setPos(clamped, c);
      setStatusBoth("idle");
    },
    [stopAll],
  );

  const next = useCallback(() => {
    const list = turnsRef.current;
    const wasPlaying = statusRef.current === "playing";
    const t = turnRef.current + 1;
    if (t >= list.length) {
      stopAll();
      setPos(list.length, 0);
      setStatusBoth("idle");
      return;
    }
    if (wasPlaying) speakFrom(t, 0);
    else {
      stopAll();
      setPos(t, 0);
      setStatusBoth(statusRef.current === "paused" ? "paused" : "idle");
    }
  }, [speakFrom, stopAll]);

  const prev = useCallback(() => {
    const wasPlaying = statusRef.current === "playing";
    const t = chunkRef.current > 0 ? turnRef.current : Math.max(0, turnRef.current - 1);
    if (wasPlaying) speakFrom(t, 0);
    else {
      stopAll();
      setPos(t, 0);
      setStatusBoth(statusRef.current === "paused" ? "paused" : "idle");
    }
  }, [speakFrom, stopAll]);

  const jump = useCallback(
    (t: number) => {
      speakFrom(t, 0);
    },
    [speakFrom],
  );

  const playFrom = useCallback(
    (next: Turn[], index: number) => {
      turnsRef.current = next;
      speakFrom(index, 0);
    },
    [speakFrom],
  );
  const playOne = useCallback(
    (t: number) => {
      const resume = statusRef.current === "paused" && turnRef.current === t;
      speakFrom(t, resume ? chunkRef.current : 0, true);
    },
    [speakFrom],
  );

  return {
    status,
    turnIndex,
    chunkIndex,
    preparing,
    supported,
    error,
    play,
    pause,
    toggle,
    stop,
    next,
    prev,
    jump,
    playOne,
    seek,
    playFrom,
    prime,
  };
}
