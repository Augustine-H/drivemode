import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  ClipboardPaste,
  Download,
  Mic,
  Pause,
  Play,
  RotateCcw,
  Share2,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { APP_NAME, APP_VERSION } from "@/lib/app-meta";
import { askGrok } from "@/lib/ask-grok";
import { streamAsk } from "@/lib/ask-stream";
import { chatsFromJson, type ImportedChat } from "@/lib/grok-import";
import { buildBackup, parseNangdokBackup, type NangdokBackup } from "@/lib/nangdok-backup";
import { backupFileName, cloudFolderName, placeInCloud, openCloudFile } from "@/lib/cloud-dest";
import { autoSaveInCloud } from "@/lib/cloud-dest";
import { saveLocalBackup, readLocalBackup } from "@/lib/local-backup";
import { AutoBackupQueue } from "@/lib/auto-backup";
import { importGrokShare } from "@/lib/grok-share";
import { imagineImage, startVideo, videoStatus } from "@/lib/imagine";
import { speakLine } from "@/lib/tts";
import { useDictation } from "@/lib/use-dictation";
import { useReader } from "@/lib/use-reader";
import {
  SAMPLE_TURNS,
  chunkText,
  formatDuration,
  parseTranscript,
  readingSeconds,
  speakerLabel,
  type Turn,
} from "@/lib/transcript";
import { FEMALE_VOICES, MALE_VOICES, isFemaleVoice, isMaleVoice } from "@/lib/voices";
import { useWake } from "@/lib/use-wake";
import { takeWake, wakeForms } from "@/lib/wake";

const STORAGE_KEY = "nangdok-v1";
const AUTO_BACKUP_KEY = "voice-grok-auto-backup";
const AUTO_BACKUP_FILE = "voice-grok-autobackup.json";

type Saved = {
  turns: Turn[];
  rate: number;
  gap: number;
  voiceMe: string;
  voiceGrok: string;
  autoScroll: boolean;
  onlyGrok: boolean;
  autoReply: boolean;
  silence: number;
  wakeOn: boolean;
  persona: string;
  personaId: string;
  personas: PersonaItem[];
  index: number;
  threads?: Record<string, Turn[]>;
  wakeDefaulted?: boolean;
};

type SettingsSnap = {
  rate: number;
  gap: number;
  voiceMe: string;
  voiceGrok: string;
  autoScroll: boolean;
  onlyGrok: boolean;
  autoReply: boolean;
  silence: number;
  wakeOn: boolean;
  persona: string;
  personaId: string;
  personas: PersonaItem[];
};

type PersonaItem = {
  id: string;
  name: string;
  text: string;
  password: string;
  locked: boolean;
};

const STARTER_PERSONAS: PersonaItem[] = [
  { id: "plain", name: "기본", text: "", password: "", locked: true },
  {
    id: "friend",
    name: "친구",
    text: "오래된 친구처럼 편하게 반말로 말한다.",
    password: "",
    locked: true,
  },
  {
    id: "aide",
    name: "비서",
    text: "차분한 비서처럼 필요한 것만 또박또박 말한다.",
    password: "",
    locked: true,
  },
  {
    id: "teacher",
    name: "선생님",
    text: "친절한 선생님처럼 쉽게 풀어서 말한다.",
    password: "",
    locked: true,
  },
];

function turnTime(turn: Turn) {
  if (typeof turn.at === "number") return turn.at;
  const match = /^(?:me|gk)-([0-9a-z]+)$/i.exec(turn.id);
  if (!match) return null;
  const at = Number.parseInt(match[1], 36);
  if (!Number.isFinite(at) || at < Date.UTC(2024, 0, 1) || at > Date.now() + 86_400_000)
    return null;
  return at;
}

function groupTurns(turns: Turn[]) {
  const groups: {
    key: string;
    day: string;
    label: string | null;
    turns: { turn: Turn; index: number }[];
  }[] = [];
  turns.forEach((turn, index) => {
    const at = turnTime(turn);
    const day = at === null ? "none" : dayKey(at);
    const label = at === null ? null : dayLabel(at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.turns.push({ turn, index });
    else groups.push({ key: `${day}-${index}`, day, label, turns: [{ turn, index }] });
  });
  return groups;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function dayKey(at: number) {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function dayLabel(at: number) {
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(date.getFullYear()).slice(2)}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}(${WEEKDAYS[date.getDay()]})`;
}

function formatWhen(at: number) {
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  const hour24 = date.getHours();
  const suffix = hour24 < 12 ? "a.m." : "p.m.";
  const hour12 = hour24 % 12 || 12;
  return `${dayLabel(at)} ${pad(hour12)}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${suffix}`;
}

function isPersona(value: unknown): value is PersonaItem {
  if (!value || typeof value !== "object") return false;
  const item = value as PersonaItem;
  return (
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    typeof item.text === "string" &&
    typeof item.password === "string" &&
    typeof item.locked === "boolean"
  );
}

function isTurn(value: unknown): value is Turn {
  if (!value || typeof value !== "object") return false;
  const t = value as Turn;
  return (
    (t.speaker === "me" || t.speaker === "grok") &&
    typeof t.text === "string" &&
    typeof t.id === "string" &&
    (t.image === undefined || (typeof t.image === "string" && t.image.startsWith("https://"))) &&
    (t.video === undefined || (typeof t.video === "string" && t.video.startsWith("https://"))) &&
    (t.at === undefined || (typeof t.at === "number" && Number.isFinite(t.at)))
  );
}

function loadSaved(): Partial<Saved> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<Saved>;
  } catch {
    return null;
  }
}

function revealInScroller(scroller: HTMLElement | null, id: string, align: "start" | "end") {
  if (!scroller) return;
  const node = document.getElementById(id);
  if (!node) {
    scroller.scrollTop = scroller.scrollHeight;
    return;
  }
  const scrollerRect = scroller.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  const delta =
    align === "end"
      ? nodeRect.bottom - scrollerRect.bottom + 12
      : nodeRect.top - scrollerRect.top - 8;
  if (Math.abs(delta) > 2) scroller.scrollTop += delta;
}

function topicWith(name: string) {
  const last = name.trim().slice(-1);
  const code = last.charCodeAt(0);
  const batchim = code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
  return `${name}${batchim ? "과" : "와"} 나누는 대화`;
}

function Equalizer() {
  return (
    <span className="eq" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

export function ReaderApp() {
  const [threads, setThreads] = useState<Record<string, Turn[]>>({ plain: SAMPLE_TURNS });
  const [rate, setRate] = useState(1);
  const [gap, setGap] = useState(0.45);
  const [voiceMe, setVoiceMe] = useState("leo");
  const [voiceGrok, setVoiceGrok] = useState("ara");
  const [autoScroll, setAutoScroll] = useState(true);
  const [onlyGrok, setOnlyGrok] = useState(true);
  const [autoReply, setAutoReply] = useState(true);
  const [silence, setSilence] = useState(2);
  const [wakeOn, setWakeOn] = useState(false);
  const [persona, setPersona] = useState("");
  const [personaId, setPersonaId] = useState("plain");
  const personaIdRef = useRef(personaId);
  personaIdRef.current = personaId;
  const turns = threads[personaId] ?? [];
  const setTurns = (update: Turn[] | ((current: Turn[]) => Turn[])) => {
    const id = personaIdRef.current;
    setThreads((prev) => {
      const current = prev[id] ?? [];
      const next = typeof update === "function" ? update(current) : update;
      return { ...prev, [id]: next };
    });
  };
  const [personas, setPersonas] = useState<PersonaItem[]>(STARTER_PERSONAS);
  const [newPersona, setNewPersona] = useState<{
    name: string;
    text: string;
    password: string;
  } | null>(null);
  const [eraseStep, setEraseStep] = useState<0 | 1 | 2 | 3>(0);
  const [erasePassword, setErasePassword] = useState("");
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [painting, setPainting] = useState(false);
  const [filming, setFilming] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [sheet, setSheet] = useState<"script" | "save" | "voice" | null>(null);
  const [draft, setDraft] = useState("");
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [exportText, setExportText] = useState<string | null>(null);
  const [pendingBackup, setPendingBackup] = useState<{
    backup: NangdokBackup;
    name: string;
  } | null>(null);
  const [cloudFolder, setCloudFolder] = useState<string | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [autoBackupTarget, setAutoBackupTarget] = useState<"local" | "folder">("local");
  const [autoBackupOn, setAutoBackupOn] = useState(false);
  const [autoBackupReady, setAutoBackupReady] = useState(false);
  const [autoBackupPaused, setAutoBackupPaused] = useState(false);
  const [autoBackupNote, setAutoBackupNote] = useState("");
  const [autoBackupAt, setAutoBackupAt] = useState<string | null>(null);
  const autoBackupQueue = useRef<AutoBackupQueue | null>(null);
  const autoBackupSaved = useRef<string | null>(null);
  const backupSnapshot = useMemo(
    () => JSON.stringify({ personaId, personas, threads }),
    [personaId, personas, threads],
  );
  const [shareUrl, setShareUrl] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  const [imported, setImported] = useState<ImportedChat[] | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollerRef = useRef<HTMLElement>(null);
  const bootIndex = useRef(0);
  const previewAudio = useRef<HTMLAudioElement | null>(null);
  const turnsNow = useRef(turns);
  turnsNow.current = turns;

  const reader = useReader({ turns, rate, gap, voiceMe, voiceGrok, onlyGrok });
  const busyRef = useRef(false);
  const askRef = useRef<(spoken?: string) => void>(() => {});
  const personaNameRef = useRef("");
  const personaRef = useRef("");
  const wakeOnRef = useRef(false);
  const settingsBase = useRef<SettingsSnap | null>(null);
  const dictation = useDictation({
    paused: asking || reader.status === "playing" || reader.preparing,
    silenceMs: Math.round(silence * 1000),
    autoSend: autoReply,
    onText: setComposer,
    onUtterance: (text) => {
      if (wakeOnRef.current) {
        const hit = takeWake(text, personaNameRef.current);
        if (hit !== null) {
          if (!hit.trim()) {
            setComposer("");
            return;
          }
          askRef.current(hit.trim());
          return;
        }
      }
      askRef.current(text);
    },
    onError: setBanner,
  });
  const personaName = (personas.find((item) => item.id === personaId) ?? personas[0])?.name ?? "";
  const wakeCall = wakeForms(personaName);
  personaNameRef.current = personaName;
  personaRef.current = persona;
  wakeOnRef.current = wakeOn;
  const wakeHandler = useRef<(rest: string) => void>(() => {});
  const wake = useWake({
    enabled: wakeOn && hydrated,
    paused:
      dictation.armed ||
      asking ||
      painting ||
      filming ||
      reader.status === "playing" ||
      reader.preparing,
    name: personaName,
    onWake: (rest) => wakeHandler.current(rest),
    onError: setBanner,
  });

  useEffect(() => {
    const saved = loadSaved();
    if (saved) {
      const loaded = readThreads(saved);
      setThreads(loaded ?? {});
      if (typeof saved.rate === "number") setRate(clamp(saved.rate, 0.7, 1.5));
      if (typeof saved.gap === "number") setGap(clamp(saved.gap, 0, 1.5));
      if (typeof saved.voiceMe === "string" && isMaleVoice(saved.voiceMe))
        setVoiceMe(saved.voiceMe);
      if (typeof saved.voiceGrok === "string" && isFemaleVoice(saved.voiceGrok)) {
        setVoiceGrok(saved.voiceGrok);
      }
      if (typeof saved.autoScroll === "boolean") setAutoScroll(saved.autoScroll);
      if (typeof saved.onlyGrok === "boolean") setOnlyGrok(saved.onlyGrok);
      if (typeof saved.autoReply === "boolean") setAutoReply(saved.autoReply);
      if (typeof saved.silence === "number") setSilence(clamp(saved.silence, 1, 5));
      // Microphone sessions require an explicit action each time the app opens.
      if (typeof saved.persona === "string") setPersona(saved.persona.slice(0, 240));
      if (Array.isArray(saved.personas)) {
        const next = saved.personas.filter(isPersona).slice(0, 12);
        if (next.length > 0) {
          setPersonas(next);
          const picked = next.find((item) => item.id === saved.personaId) ?? next[0];
          setPersonaId(picked.id);
          setPersona(picked.text.slice(0, 240));
        }
      }
      if (typeof saved.index === "number") bootIndex.current = saved.index;
    }
    setHydrated(true);
    void cloudFolderName().then((name) => {
      if (name) setCloudFolder(name);
      try {
        const savedAuto = JSON.parse(localStorage.getItem(AUTO_BACKUP_KEY) ?? "null");
        setAutoBackupTarget(
          savedAuto?.target === "local"
            ? "local"
            : savedAuto?.target === "folder" || savedAuto?.enabled
              ? "folder"
              : "local",
        );
        setAutoBackupOn(savedAuto?.enabled === true);
        if (typeof savedAuto?.lastSaved === "string") setAutoBackupAt(savedAuto.lastSaved);
      } catch {
        /* the setting is optional */
      }
      setAutoBackupReady(true);
    });
  }, []);

  useEffect(() => {
    if (!autoBackupReady) return;
    try {
      localStorage.setItem(
        AUTO_BACKUP_KEY,
        JSON.stringify({
          enabled: autoBackupOn,
          lastSaved: autoBackupAt,
          target: autoBackupTarget,
        }),
      );
    } catch {
      /* saving the file still works */
    }
  }, [autoBackupReady, autoBackupOn, autoBackupAt, autoBackupTarget]);

  useEffect(() => {
    if (!hydrated || !autoBackupReady || !autoBackupOn || autoBackupPaused) return;
    let active = true;
    const queue = new AutoBackupQueue(
      async (snapshot) => {
        if (active) setAutoBackupNote("자동 백업 파일을 저장하는 중입니다.");
        const data = JSON.parse(snapshot) as Parameters<typeof buildBackup>[0];
        const backup = buildBackup(data);
        let result: { ok: boolean };
        try {
          if (autoBackupTarget === "local") {
            saveLocalBackup(localStorage, JSON.stringify(backup));
            result = { ok: true };
          } else result = await autoSaveInCloud(JSON.stringify(backup, null, 2), AUTO_BACKUP_FILE);
        } catch {
          result = { ok: false };
        }
        if (!active) return result.ok;
        if (result.ok) {
          autoBackupSaved.current = snapshot;
          setAutoBackupAt(backup.exportedAt);
          setAutoBackupNote(
            autoBackupTarget === "local"
              ? "기기 내부 백업 저장 및 내용 확인 완료"
              : `${AUTO_BACKUP_FILE} 저장 및 내용 확인 완료`,
          );
        } else {
          setAutoBackupPaused(true);
          setAutoBackupNote(
            autoBackupTarget === "local"
              ? "기기 백업이 멈췄습니다. 저장 공간을 확인하고 다시 시도하세요."
              : "자동 백업이 멈췄습니다. 폴더 연결과 쓰기 권한을 확인한 뒤 ‘다시 연결’을 누르세요.",
          );
        }
        return result.ok;
      },
      30_000,
      {
        set: (callback, delay) => window.setTimeout(callback, delay),
        clear: (timer) => window.clearTimeout(timer as number),
      },
      autoBackupSaved.current,
    );
    autoBackupQueue.current = queue;
    return () => {
      active = false;
      queue.stop();
      autoBackupQueue.current = null;
    };
  }, [hydrated, autoBackupReady, autoBackupOn, autoBackupPaused, autoBackupTarget]);

  useEffect(() => {
    autoBackupQueue.current?.update(backupSnapshot);
    if (
      autoBackupOn &&
      autoBackupReady &&
      !autoBackupPaused &&
      backupSnapshot !== autoBackupSaved.current
    ) {
      setAutoBackupNote("변경을 감지했습니다. 마지막 변경 후 30초에 자동 백업합니다.");
    }
  }, [backupSnapshot, hydrated, autoBackupReady, autoBackupOn, autoBackupPaused]);

  useEffect(() => {
    if (!hydrated) return;
    if (bootIndex.current > 0) {
      reader.seek(bootIndex.current, 0);
      bootIndex.current = 0;
    }
    // seek once after storage restore
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const payload: Saved = {
      turns,
      rate,
      gap,
      voiceMe,
      voiceGrok,
      autoScroll,
      onlyGrok,
      autoReply,
      silence,
      wakeOn,
      persona,
      personaId,
      personas,
      threads,
      wakeDefaulted: true,
      index: reader.turnIndex,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [
    hydrated,
    turns,
    rate,
    gap,
    voiceMe,
    voiceGrok,
    autoScroll,
    onlyGrok,
    autoReply,
    silence,
    wakeOn,
    persona,
    personaId,
    personas,
    threads,
    reader.turnIndex,
  ]);

  useEffect(() => {
    if (!autoScroll || reader.status !== "playing") return;
    const id = turns[reader.turnIndex]?.id;
    if (!id) return;
    revealInScroller(scrollerRef.current, `turn-${id}`, "end");
  }, [autoScroll, reader.status, reader.turnIndex, reader.chunkIndex, turns]);

  const latestId = turns[turns.length - 1]?.id ?? "";
  useEffect(() => {
    if (!hydrated || !latestId) return;
    const frame = requestAnimationFrame(() => {
      const list = turnsNow.current;
      const last = list[list.length - 1];
      if (!last) return;
      const before = list[list.length - 2];
      const mine = last.speaker === "grok" && before?.speaker === "me" ? before : last;
      revealInScroller(scrollerRef.current, `turn-${mine.id}`, mine === last ? "end" : "start");
    });
    return () => cancelAnimationFrame(frame);
  }, [hydrated, latestId]);

  const personaSeen = useRef(personaId);
  useEffect(() => {
    if (!hydrated || personaSeen.current === personaId) return;
    personaSeen.current = personaId;
    reader.stop();
    reader.seek(turns.length, 0);
    const last = turns[turns.length - 1];
    const frame = requestAnimationFrame(() => {
      if (last) revealInScroller(scrollerRef.current, `turn-${last.id}`, "end");
      else if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [hydrated, personaId, reader, turns]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
      if (e.key === " ") {
        e.preventDefault();
        reader.prime();
        reader.toggle();
      } else if (e.key === "ArrowRight") reader.next();
      else if (e.key === "ArrowLeft") reader.prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reader]);

  const parsedDraft = useMemo(() => parseTranscript(draft, "preview"), [draft]);
  const duration = formatDuration(readingSeconds(turns, rate));
  const active = turns[reader.turnIndex];
  const activeChunks = active ? chunkText(active.text) : [];
  const activeLine = filming
    ? "영상 만드는 중"
    : painting
      ? "그리는 중"
      : asking
        ? "그록이 대답하는 중"
        : reader.preparing
          ? "목소리 준비 중"
          : dictation.hearing || dictation.note
            ? dictation.note || "듣는 중"
            : wake.standby
              ? `「${wakeCall[0] ?? personaName}」라고 부르면 말하기가 켜집니다`
              : reader.status === "idle" && reader.turnIndex >= turns.length
                ? "끝까지 읽었습니다. 재생하면 처음부터 다시 시작합니다."
                : activeChunks[reader.chunkIndex] ||
                  (reader.status === "playing"
                    ? "다음 말로 넘어가는 중"
                    : "재생하면 그록의 말을 끝까지 읽습니다.");
  const progress =
    turns.length === 0
      ? 0
      : Math.min(100, Math.round((Math.min(reader.turnIndex, turns.length) / turns.length) * 100));

  function applyDraft() {
    const idPrefix = `imp-${Date.now().toString(36)}`;
    const result = parseTranscript(draft, idPrefix);
    if (result.turns.length === 0) {
      setDraftNote("읽을 문장이 없어요.");
      return;
    }
    reader.stop();
    setTurns(result.turns);
    setEditingId(null);
    setSheet(null);
    setDraftNote(null);
    setBanner(
      result.mode === "alternating"
        ? "화자 이름을 못 찾아서, 문단마다 나와 그록을 번갈아 넣었습니다. 다르면 화자 뒤집기를 누르세요."
        : "붙여넣은 대화를 끝까지 자동으로 읽습니다.",
    );
  }

  function applyImported(chat: ImportedChat) {
    if (chat.turns.length === 0) {
      setDraftNote("읽을 문장이 없어요.");
      return;
    }
    const stamp = Date.now().toString(36);
    reader.stop();
    setTurns(chat.turns.map((turn, index) => ({ ...turn, id: `imp-${stamp}-${index}` })));
    setEditingId(null);
    settingsBase.current = null;
    setSheet(null);
    setImported(null);
    setDraftNote(null);
    setBanner(`${chat.title} 대화를 끝까지 읽습니다.`);
  }

  function restoreBackup(backup: NangdokBackup) {
    const picked =
      backup.personas.find((item) => item.id === backup.personaId) ?? backup.personas[0];
    reader.stop();
    setPersonas(backup.personas);
    setThreads(backup.threads);
    setPersonaId(picked.id);
    setPersona(picked.text.slice(0, 240));
    setEditingId(null);
    settingsBase.current = null;
    setSheet(null);
    setImported(null);
    setDraftNote(null);
    const count = Object.values(backup.threads).reduce((sum, list) => sum + list.length, 0);
    setBanner(`보관한 대화 ${count}마디로 바꿨습니다.`);
  }

  async function copyText(text: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      /* the preview frame often blocks the clipboard API */
    }
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.top = "0";
      area.style.left = "0";
      document.body.appendChild(area);
      area.focus();
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }

  function downloadText(name: string, text: string) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function sendBackup(mode: "cloud" | "download" | "retarget") {
    const backup = buildBackup({ personaId, personas, threads });
    const json = JSON.stringify(backup, null, 2);
    const name = backupFileName(backup.exportedAt);
    const framed = window.parent !== window;
    if (mode === "download") {
      if (!framed) {
        downloadText(name, json);
        setExportText(null);
        setDraftNote(`${name} 파일 다운로드를 요청했습니다. 기기의 다운로드 목록을 확인하세요.`);
        return;
      }
      setExportText(json);
      const copied = await copyText(json);
      setDraftNote(
        copied
          ? "미리보기에서는 파일 저장이 막혀 대화를 복사했습니다. 메모나 파일 앱에 붙여 넣으세요."
          : "아래 글을 길게 눌러 전체 선택 후 복사하세요. 미리보기는 파일 저장을 막습니다.",
      );
      return;
    }
    if (cloudBusy) return;
    setCloudBusy(true);
    setDraftNote(null);
    try {
      const placed = await placeInCloud(json, name, mode === "retarget");
      if (placed.ok) {
        setExportText(null);
        if (placed.via === "folder") {
          setCloudFolder(placed.where);
          if (mode === "retarget" && autoBackupOn && autoBackupTarget === "folder") {
            setAutoBackupPaused(true);
            setAutoBackupNote(
              "저장 폴더가 바뀌었습니다. ‘다시 연결’을 눌러 이 폴더에서 자동 백업을 시작하세요.",
            );
          }
        }
        setDraftNote(
          placed.via === "folder"
            ? placed.fresh
              ? `「${placed.where}」폴더에 ${name} 파일을 저장하고 내용을 확인했습니다. 다음부터는 같은 폴더에 바로 넣습니다. 그 폴더가 클라우드나 NAS와 동기화되면 그쪽으로 올라갑니다.`
              : `「${placed.where}」폴더에 ${name} 파일을 저장하고 내용을 확인했습니다.`
            : placed.via === "share"
              ? "공유 창에서 고른 앱으로 보냈습니다. 드라이브나 NAS 앱을 고르면 그쪽으로 올라갑니다."
              : `${placed.where} 파일을 저장하고 내용을 확인했습니다.`,
        );
        return;
      }
      if (placed.reason === "cancel") return;
      if (placed.reason === "failed") {
        setDraftNote(
          "파일 저장 또는 내용 확인에 실패했습니다. 폴더 연결과 쓰기 권한을 확인한 뒤 다시 시도하세요. 휴대폰은 공유 앱에서 저장을 완료하세요.",
        );
        return;
      }
      if (placed.reason === "permission") {
        setDraftNote(
          "폴더 쓰기 권한이 허용되지 않았습니다. 다시 눌러 권한을 허용하거나 다른 폴더를 고르세요.",
        );
        return;
      }
      if (placed.reason === "activation") {
        setDraftNote(
          "브라우저가 폴더 창을 열지 못했습니다. 저장 버튼을 다시 누르세요. 계속되면 게시된 앱을 크롬의 새 탭에서 여세요.",
        );
        return;
      }
      setExportText(json);
      const copied = await copyText(json);
      if (placed.reason === "preview") {
        setDraftNote(
          copied
            ? "미리보기에서는 폴더 창이 막혀 대화를 복사했습니다. 게시한 뒤 크롬에서 누르면 클라우드나 NAS 폴더를 고를 수 있습니다."
            : "아래 글을 길게 눌러 전체 선택 후 복사하세요. 미리보기는 폴더 창을 막습니다.",
        );
        return;
      }
      setDraftNote(
        copied
          ? "이 브라우저는 폴더를 직접 열지 못해 대화를 복사했습니다. 크롬에서 다시 누르면 폴더를 고를 수 있고, 휴대폰은 공유 창이 뜹니다."
          : "이 브라우저는 폴더를 직접 열지 못합니다. 아래 글을 길게 눌러 복사하세요.",
      );
    } catch {
      setDraftNote("파일을 저장하지 못했습니다. 폴더 연결과 쓰기 권한을 확인한 뒤 다시 누르세요.");
    } finally {
      setCloudBusy(false);
    }
  }

  async function enableAutoBackup() {
    if (cloudBusy) return;
    if (autoBackupTarget === "local") {
      try {
        const backup = buildBackup({ personaId, personas, threads });
        saveLocalBackup(localStorage, JSON.stringify(backup));
        autoBackupSaved.current = backupSnapshot;
        setAutoBackupAt(backup.exportedAt);
        setAutoBackupPaused(false);
        setAutoBackupOn(true);
        setAutoBackupNote("기기 내부 백업 저장 및 내용 확인 완료");
      } catch {
        setAutoBackupPaused(true);
        setAutoBackupNote(
          "기기 내부에 저장하지 못했습니다. 저장 공간과 앱 저장 권한을 확인하세요.",
        );
      }
      return;
    }
    if (!("showDirectoryPicker" in window)) {
      setAutoBackupNote(
        "자동 백업은 폴더 저장을 지원하는 컴퓨터 크롬·엣지에서 사용할 수 있습니다. 휴대폰은 위의 저장 버튼으로 공유하세요.",
      );
      return;
    }
    autoBackupQueue.current?.stop();
    setCloudBusy(true);
    try {
      const backup = buildBackup({ personaId, personas, threads });
      const result = await placeInCloud(JSON.stringify(backup, null, 2), AUTO_BACKUP_FILE, false);
      if (!result.ok || result.via !== "folder") {
        if (!result.ok && result.reason === "cancel") return;
        setAutoBackupPaused(true);
        setAutoBackupNote(
          "자동 백업 폴더에 저장하지 못했습니다. 폴더와 쓰기 권한을 확인한 뒤 다시 연결하세요.",
        );
        return;
      }
      autoBackupSaved.current = backupSnapshot;
      setCloudFolder(result.where);
      setAutoBackupAt(backup.exportedAt);
      setAutoBackupPaused(false);
      setAutoBackupOn(true);
      setAutoBackupNote(`${AUTO_BACKUP_FILE} 저장 및 내용 확인 완료`);
    } catch {
      setAutoBackupPaused(true);
      setAutoBackupNote("자동 백업을 시작하지 못했습니다. 폴더 연결과 쓰기 권한을 확인하세요.");
    } finally {
      setCloudBusy(false);
    }
  }

  async function loadBackupFile(file: File) {
    setPendingBackup(null);
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("대화 파일은 10MB 이하로 선택하세요.");
      const text = await file.text();
      const trimmed = text.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        const data: unknown = JSON.parse(trimmed);
        const backup = parseNangdokBackup(data);
        if (backup) {
          setPendingBackup({ backup, name: file.name });
          setDraftNote(null);
          return;
        }
        const chats = chatsFromJson(data);
        if (chats.length === 1) {
          applyImported(chats[0]);
          return;
        }
        if (chats.length > 1) {
          setImported(chats);
          setDraftNote("불러올 대화를 고르세요.");
          return;
        }
        throw new Error("이 파일에서 대화를 찾지 못했습니다.");
      }
      setImported(null);
      setDraft(text);
      setDraftNote(
        `${file.name} 파일을 읽었습니다. 아래 내용을 확인한 뒤 ‘이 대화로 듣기’를 누르세요.`,
      );
    } catch (error) {
      setDraftNote(error instanceof Error ? error.message : "파일을 읽지 못했습니다.");
    }
  }

  async function loadCloudFile() {
    try {
      if (!("showOpenFilePicker" in window)) {
        fileRef.current?.click();
        return;
      }
      const file = await openCloudFile();
      if (file) await loadBackupFile(file);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setDraftNote(
        "클라우드·NAS 파일을 열지 못했습니다. 기기에서 불러오기를 눌러 파일 앱에서 드라이브나 연결된 NAS를 선택하세요.",
      );
    }
  }

  async function loadShare() {
    if (shareBusy) return;
    setShareBusy(true);
    setDraftNote(null);
    setImported(null);
    try {
      const result = await importGrokShare({ data: { url: shareUrl } });
      if (!result.ok) {
        setDraftNote(result.error);
        return;
      }
      applyImported({ title: result.title || "그록 대화", turns: result.turns });
    } catch {
      setDraftNote("그록 대화에 연결하지 못했습니다.");
    } finally {
      setShareBusy(false);
    }
  }

  async function paint(raw: string) {
    const text = raw.trim();
    if (!text || busyRef.current) return;
    const history = turnsNow.current
      .filter((turn) => !turn.id.startsWith("s"))
      .slice(-6)
      .map((turn) => ({ role: turn.speaker === "me" ? "user" : "assistant", content: turn.text }));
    const prompt = imagePrompt(text, history);
    const sentAt = Date.now();
    busyRef.current = true;
    setPainting(true);
    setAsking(true);
    setBanner(null);
    try {
      const result = await imagineImage({ data: { prompt } });
      if (!result.ok) {
        setBanner(result.error);
        return;
      }
      const repliedAt = Date.now();
      const stamp = repliedAt.toString(36);
      const caption =
        prompt.length <= 24
          ? `${prompt} 그림을 만들었어요.`
          : "그림을 만들었어요. 화면에서 볼 수 있어요.";
      const next = [
        ...turnsNow.current,
        { id: `me-${stamp}`, speaker: "me" as const, text, at: sentAt },
        {
          id: `gk-${stamp}`,
          speaker: "grok" as const,
          text: caption,
          image: result.url,
          at: repliedAt,
        },
      ];
      setComposer("");
      setTurns(next);
      reader.playFrom(next, next.length - 1);
    } finally {
      busyRef.current = false;
      setAsking(false);
      setPainting(false);
    }
  }

  async function film(raw: string) {
    const text = raw.trim();
    if (!text || busyRef.current) return;
    const history = turnsNow.current
      .filter((turn) => !turn.id.startsWith("s"))
      .slice(-6)
      .map((turn) => ({ role: turn.speaker === "me" ? "user" : "assistant", content: turn.text }));
    const prompt = videoPrompt(text, history);
    const sentAt = Date.now();
    const seconds = videoSeconds(text);
    let image = "";
    if (/그거|이거|저거|방금|셀카|베이스|기반|그 사진|이 사진|그 그림/.test(text)) {
      for (let i = turnsNow.current.length - 1; i >= 0; i--) {
        const found = turnsNow.current[i]?.image;
        if (found?.startsWith("https://")) {
          image = found;
          break;
        }
      }
    }
    busyRef.current = true;
    setFilming(true);
    setAsking(true);
    setBanner(null);
    try {
      const started = await startVideo({ data: { prompt, seconds, image } });
      if (!started.ok) {
        setBanner(started.error);
        return;
      }
      let url = "";
      for (let i = 0; i < 24; i++) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        const status = await videoStatus({ data: { id: started.id } });
        if (!status.ok) {
          setBanner(status.error);
          return;
        }
        if (!status.pending) {
          url = status.url;
          break;
        }
      }
      if (!url) {
        setBanner("영상을 시간 안에 만들지 못했습니다.");
        return;
      }
      const repliedAt = Date.now();
      const stamp = repliedAt.toString(36);
      const next = [
        ...turnsNow.current,
        { id: `me-${stamp}`, speaker: "me" as const, text, at: sentAt },
        {
          id: `gk-${stamp}`,
          speaker: "grok" as const,
          text: "짧은 영상을 만들었어요.",
          video: url,
          at: repliedAt,
        },
      ];
      setComposer("");
      setTurns(next);
      reader.playFrom(next, next.length - 1);
    } finally {
      busyRef.current = false;
      setAsking(false);
      setFilming(false);
    }
  }

  async function ask(spoken?: string) {
    const text = (spoken ?? composer).trim();
    if (!text || busyRef.current) return;
    if (wantsVideo(text)) {
      await film(text);
      return;
    }
    if (wantsImage(text)) {
      await paint(text);
      return;
    }
    busyRef.current = true;
    setAsking(true);
    setBanner(null);
    setComposer("");
    const sentAt = Date.now();
    const mine = { id: `me-${sentAt.toString(36)}`, speaker: "me" as const, text, at: sentAt };
    const withUser = [...turnsNow.current, mine];
    turnsNow.current = withUser;
    setTurns(withUser);
    try {
      const history = withUser
        .filter((turn) => turn !== mine && !turn.id.startsWith("s"))
        .slice(-4)
        .map((turn) => ({
          role: turn.speaker === "me" ? ("user" as const) : ("assistant" as const),
          content: turn.text,
        }));
      const grokId = `gk-${sentAt.toString(36)}`;
      let played = false;
      const show = (said: string) => {
        const next = [
          ...turnsNow.current.filter((turn) => turn.id !== mine.id && turn.id !== grokId),
          mine,
          { id: grokId, speaker: "grok" as const, text: said, at: sentAt },
        ];
        turnsNow.current = next;
        setTurns(next);
        if (!played) {
          played = true;
          reader.playFrom(next, next.length - 1);
        }
      };
      let result: { ok: true; text: string } | { ok: false; error: string };
      try {
        result = await streamAsk({ message: text, history, persona }, show);
      } catch {
        result = { ok: false, error: "그록에게 연결하지 못했습니다." };
      }
      if (!result.ok && !played) {
        const again = await askGrok({ data: { message: text, history, persona } });
        if (!again.ok) {
          setBanner(again.error);
          return;
        }
        show(again.text);
      }
    } finally {
      busyRef.current = false;
      setAsking(false);
    }
  }
  askRef.current = ask;
  wakeHandler.current = (rest) => {
    const follow = rest.trim();
    setComposer("");
    dictation.arm();
    if (follow) {
      askRef.current(follow);
      return;
    }
    void greet();
  };

  async function greet() {
    if (busyRef.current) return;
    busyRef.current = true;
    setAsking(true);
    const tone = personaRef.current;
    const name = personaNameRef.current || "그록";
    let line = fallbackGreet(tone);
    try {
      const result = await Promise.race([
        askGrok({
          data: {
            message: `${name}를 불렀다. 번호 ${Math.floor(Math.random() * 1000)}.`,
            history: [],
            persona: tone,
            ack: true,
          },
        }),
        new Promise<{ ok: false; error: string }>((resolve) =>
          setTimeout(() => resolve({ ok: false, error: "" }), 2500),
        ),
      ]);
      if (result.ok) {
        const said = result.text.replace(/\s+/g, " ").trim().slice(0, 80);
        if (said) line = said;
      }
    } catch {
      /* keep the local line */
    }
    const at = Date.now();
    const next = [
      ...turnsNow.current,
      { id: `gk-${at.toString(36)}`, speaker: "grok" as const, text: line, at },
    ];
    setTurns(next);
    reader.playFrom(next, next.length - 1);
    busyRef.current = false;
    setAsking(false);
  }

  function captureSettings(): SettingsSnap {
    return {
      rate,
      gap,
      voiceMe,
      voiceGrok,
      autoScroll,
      onlyGrok,
      autoReply,
      silence,
      wakeOn,
      persona,
      personaId,
      personas: personas.map((item) => ({ ...item })),
    };
  }

  function openSettings() {
    if (!settingsBase.current) settingsBase.current = captureSettings();
    setSheet("voice");
  }

  function saveSettings() {
    settingsBase.current = null;
    setSheet(null);
  }

  function cancelSettings() {
    const snap = settingsBase.current;
    settingsBase.current = null;
    setSheet(null);
    if (!snap) return;
    setRate(snap.rate);
    setGap(snap.gap);
    setVoiceMe(snap.voiceMe);
    setVoiceGrok(snap.voiceGrok);
    setAutoScroll(snap.autoScroll);
    setOnlyGrok(snap.onlyGrok);
    setAutoReply(snap.autoReply);
    setSilence(snap.silence);
    setWakeOn(false);
    wake.halt();
    if (!snap.wakeOn) wake.halt();
    const restored = snap.personas.map((item) => ({ ...item }));
    const stay = restored.find((item) => item.id === personaIdRef.current);
    setPersonas(restored);
    if (stay) {
      setPersonaId(stay.id);
      setPersona(stay.text.slice(0, 240));
    } else {
      setPersonaId(snap.personaId);
      setPersona(snap.persona);
    }
  }

  function resetSettings() {
    setRate(1);
    setGap(0.45);
    setVoiceMe("leo");
    setVoiceGrok("ara");
    setAutoScroll(true);
    setOnlyGrok(true);
    setAutoReply(true);
    setSilence(2);
    setWakeOn(false);
    wake.halt();
    const plain = personas.find((item) => item.id === "plain") ?? STARTER_PERSONAS[0];
    setPersonaId(plain.id);
    setPersona(plain.text);
  }

  function updateTurn(id: string, text: string) {
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, text } : t)));
  }

  function removeTurn(id: string) {
    reader.stop();
    setTurns((prev) => prev.filter((t) => t.id !== id));
    if (editingId === id) setEditingId(null);
  }

  function flipSpeakers() {
    setTurns((prev) => prev.map((t) => ({ ...t, speaker: t.speaker === "me" ? "grok" : "me" })));
  }

  function loadSample() {
    reader.stop();
    setTurns(SAMPLE_TURNS);
    setSheet(null);
    setDraftNote(null);
  }

  function selectPersona(id: string) {
    const item = personas.find((entry) => entry.id === id);
    if (!item) return;
    if (item.id !== personaIdRef.current) reader.stop();
    setPersonaId(item.id);
    setPersona(item.text);
    setNewPersona(null);
    setEditingId(null);
  }

  const selectedPersona = personas.find((item) => item.id === personaId) ?? personas[0];

  function updatePersona(patch: { name?: string; text?: string }) {
    if (!selectedPersona) return;
    const next = { ...selectedPersona, ...patch };
    if (!next.name.trim()) next.name = selectedPersona.name;
    setPersonas((prev) => prev.map((item) => (item.id === selectedPersona.id ? next : item)));
    if (patch.text !== undefined) setPersona(patch.text.slice(0, 240));
  }

  function addPersona() {
    if (!newPersona) return;
    const name = newPersona.name.trim().slice(0, 16);
    const text = newPersona.text.trim().slice(0, 240);
    const password = newPersona.password.trim();
    if (!name) {
      setBanner("페르소나 이름을 적어 주세요.");
      return;
    }
    if (password.trim().length < 4) {
      setBanner("삭제용 비밀번호는 네 글자 이상으로 해 주세요.");
      return;
    }
    if (personas.length >= 12) {
      setBanner("페르소나는 12개까지 둘 수 있습니다.");
      return;
    }
    const item: PersonaItem = {
      id: `p-${Date.now().toString(36)}`,
      name,
      text,
      password,
      locked: false,
    };
    setPersonas((prev) => [...prev, item]);
    setPersonaId(item.id);
    setPersona(text);
    setNewPersona(null);
    setBanner(null);
  }

  function deletePersona() {
    if (!selectedPersona || selectedPersona.locked) return;
    setErasePassword("");
    setEraseStep(1);
  }

  function finishDelete() {
    if (!selectedPersona || selectedPersona.locked) return;
    if (erasePassword.trim() !== selectedPersona.password.trim()) {
      setBanner("비밀번호가 맞지 않아 지우지 않았습니다.");
      return;
    }
    const next = personas.filter((item) => item.id !== selectedPersona.id);
    const fallback = next[0];
    if (!fallback) return;
    setPersonas(next);
    setThreads((prev) => {
      const copy = { ...prev };
      delete copy[selectedPersona.id];
      return copy;
    });
    setPersonaId(fallback.id);
    setPersona(fallback.text);
    setEraseStep(0);
    setErasePassword("");
    setBanner(null);
  }

  async function previewVoice(id: string) {
    reader.prime();
    if (reader.status === "playing") reader.toggle();
    previewAudio.current?.pause();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    const sample = "안녕하세요. 이 목소리입니다.";
    if (id === "device") {
      const utterance = new SpeechSynthesisUtterance(sample);
      utterance.lang = "ko-KR";
      window.speechSynthesis.speak(utterance);
      return;
    }
    setPreviewing(id);
    try {
      const result = await speakLine({ data: { text: sample, voiceId: id, speed: rate } });
      if (!result.ok) {
        setBanner(result.error);
        return;
      }
      const binary = atob(result.audio);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
      const audio = new Audio(url);
      previewAudio.current = audio;
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch {
      setBanner("목소리를 재생하지 못했습니다.");
    } finally {
      setPreviewing(null);
    }
  }

  const done = reader.turnIndex >= turns.length && turns.length > 0;

  return (
    <div className="mx-auto flex h-full w-full max-w-lg flex-col bg-bg text-fg">
      <header className="flex shrink-0 flex-col border-b border-line pt-3">
        <div className="flex items-center justify-between gap-3 px-4">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate font-display text-xl leading-none tracking-tight text-fg">
                {APP_NAME}
              </h1>
              <span
                className="shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[11px] tabular-nums leading-none text-muted"
                aria-label={`버전 ${APP_VERSION}`}
              >
                {APP_VERSION}
              </span>
            </div>
            <p className="mt-1 truncate text-sm text-muted">{topicWith(personaName || "기본")}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-label="설정"
              className="inline-flex size-11 items-center justify-center rounded-full border border-line bg-surface text-fg"
              onClick={openSettings}
            >
              <SlidersHorizontal className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="mx-4 mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-line bg-surface px-3 text-sm text-fg"
            onClick={() => {
              setDraftNote(null);
              setExportText(null);
              setSheet("save");
            }}
          >
            <Download className="size-4" aria-hidden="true" />
            대화 저장하기
          </button>
          <button
            type="button"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-line bg-surface px-3 text-sm text-fg"
            onClick={() => {
              setDraft(turnsToText(turns));
              setDraftNote(null);
              setExportText(null);
              setPendingBackup(null);
              setSheet("script");
            }}
          >
            <ClipboardPaste className="size-4" aria-hidden="true" />
            대화 불러오기
          </button>
        </div>
        <div
          className="mt-3 flex gap-2 overflow-x-auto px-4 pb-3"
          role="tablist"
          aria-label="페르소나별 대화"
        >
          {personas.map((item) => {
            const on = item.id === personaId;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={on}
                className={
                  "h-10 shrink-0 rounded-full px-3 text-sm " +
                  (on ? "bg-primary text-ink" : "border border-line text-fg")
                }
                onClick={() => selectPersona(item.id)}
              >
                {item.name}
              </button>
            );
          })}
        </div>
      </header>

      <main ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {banner ? <p className="mb-3 text-sm text-pretty text-muted">{banner}</p> : null}
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-start justify-center gap-4">
            <p className="font-display text-3xl text-balance text-fg">
              {personaName || "그록"}에게 물어보세요
            </p>
            <p className="max-w-sm text-pretty text-muted">
              답을 붙이지 않아도, 그록이 말한 뒤 그 목소리로 바로 읽어 줍니다.
            </p>
            <button
              type="button"
              className="inline-flex h-12 items-center rounded-full bg-primary px-5 text-base font-medium text-ink"
              onClick={() => {
                setDraftNote(null);
                setExportText(null);
                setSheet("script");
              }}
            >
              채팅 불러오기
            </button>
          </div>
        ) : (
          <ol className="flex flex-col gap-3">
            {groupTurns(turns).map((group) => (
              <li key={group.key} className="flex flex-col gap-3">
                {group.label ? (
                  <p className="pt-1 text-center text-xs text-muted">{group.label}</p>
                ) : null}
                <ol className="flex flex-col gap-3">
                  {group.turns.map(({ turn, index }) => {
                    const playing = reader.status !== "idle" && index === reader.turnIndex && !done;
                    const chunks = chunkText(turn.text);
                    const mine = turn.speaker === "me";
                    const whenAt = turnTime(turn);
                    const when = whenAt === null ? "" : formatWhen(whenAt);
                    return (
                      <li
                        id={`turn-${turn.id}`}
                        key={turn.id}
                        className={mine ? "flex justify-end" : "flex justify-start"}
                      >
                        <article
                          className={
                            "w-11/12 rounded-3xl border px-4 py-3 " +
                            (mine
                              ? "border-primary bg-primary text-ink"
                              : "border-line bg-raised text-fg") +
                            (playing ? " ring-2 ring-fg ring-offset-2 ring-offset-bg" : "")
                          }
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <button
                              type="button"
                              className={
                                "inline-flex items-center gap-2 text-sm font-medium " +
                                (mine ? "text-ink" : "text-primary")
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                reader.jump(index);
                              }}
                            >
                              {playing && reader.status === "playing" && !reader.preparing ? (
                                <Equalizer />
                              ) : null}
                              {turn.speaker === "me" ? "나" : personaName || "그록"}
                              <span className={mine ? "text-ink/70" : "text-faint"}>
                                {index + 1}
                              </span>
                            </button>
                            <span className="flex items-center gap-1">
                              <button
                                type="button"
                                aria-label="이 말 수정"
                                className={
                                  "inline-flex size-9 items-center justify-center rounded-full " +
                                  (mine ? "text-ink/80" : "text-muted")
                                }
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingId(editingId === turn.id ? null : turn.id);
                                }}
                              >
                                <span className="text-xs font-medium">수정</span>
                              </button>
                              <button
                                type="button"
                                aria-label="이 말 지우기"
                                className={
                                  "inline-flex size-9 items-center justify-center rounded-full " +
                                  (mine ? "text-ink/80" : "text-muted")
                                }
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeTurn(turn.id);
                                }}
                              >
                                <Trash2 className="size-4" aria-hidden="true" />
                              </button>
                            </span>
                          </div>
                          {editingId === turn.id ? (
                            <textarea
                              value={turn.text}
                              onChange={(e) => updateTurn(turn.id, e.target.value)}
                              className={
                                "min-h-24 w-full resize-y rounded-2xl border px-3 py-2 text-base " +
                                (mine
                                  ? "border-ink/20 bg-fg text-ink"
                                  : "border-line bg-bg text-fg")
                              }
                            />
                          ) : (
                            <button
                              type="button"
                              className="block w-full text-left text-base leading-relaxed text-pretty"
                              onClick={() => reader.jump(index)}
                            >
                              {chunks.length === 0
                                ? "빈 말"
                                : chunks.map((chunk, ci) => {
                                    const hot = playing && ci === reader.chunkIndex;
                                    return (
                                      <span key={ci}>
                                        {ci > 0 ? " " : null}
                                        <span
                                          className={
                                            hot
                                              ? mine
                                                ? "rounded-md bg-ink/15"
                                                : "rounded-md bg-primary/25"
                                              : undefined
                                          }
                                        >
                                          {chunk}
                                        </span>
                                      </span>
                                    );
                                  })}
                            </button>
                          )}
                          {turn.video ? (
                            <video
                              src={turn.video}
                              controls
                              playsInline
                              preload="metadata"
                              className="mt-3 w-full rounded-2xl bg-bg"
                            />
                          ) : turn.image ? (
                            <img
                              src={turn.image}
                              alt={turn.text}
                              className="mt-3 w-full rounded-2xl bg-bg"
                            />
                          ) : null}
                          {when ? (
                            <p
                              className={
                                "mt-2 text-right text-xs tabular-nums " +
                                (mine ? "text-ink/70" : "text-muted")
                              }
                            >
                              {when}
                            </p>
                          ) : null}
                        </article>
                      </li>
                    );
                  })}
                </ol>
              </li>
            ))}
          </ol>
        )}
      </main>

      <form
        className="shrink-0 border-t border-line bg-surface px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        {dictation.blocked ? (
          <label className="mb-2 flex h-11 cursor-pointer items-center justify-center rounded-full border border-line text-sm text-fg">
            음성 파일로 받아쓰기
            <input
              type="file"
              accept="audio/*"
              capture="user"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                reader.prime();
                void dictation.fromFile(file);
              }}
            />
          </label>
        ) : null}
        {dictation.note ? (
          <p className="mb-2 text-sm text-primary" role="status">
            {dictation.note}
          </p>
        ) : wake.standby ? (
          <p className="mb-2 text-sm text-muted" role="status">
            {wakeCall.length > 1
              ? `「${wakeCall[0]}」 또는 「${wakeCall[1]}」를 기다립니다`
              : "페르소나 이름을 정해 주세요."}
          </p>
        ) : null}
        <div className="flex items-end gap-2">
          <textarea
            id="composer"
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            placeholder={dictation.hearing ? "듣고 있습니다" : "그록에게 말하면 답을 바로 읽습니다"}
            rows={2}
            disabled={asking}
            aria-label="그록에게 말하기"
            className="min-h-11 min-w-0 flex-1 resize-none rounded-2xl border border-line bg-bg px-3 py-2 text-base text-fg placeholder:text-faint disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={asking || !composer.trim()}
            className="h-11 shrink-0 rounded-full bg-primary px-4 text-sm font-medium text-ink disabled:opacity-40"
          >
            {asking ? "기다리는 중" : "듣기"}
          </button>
        </div>
      </form>

      <footer className="shrink-0 border-t border-line bg-surface">
        <div className="h-1 bg-raised" aria-hidden="true">
          <div
            className="h-full bg-primary transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="px-4 pt-3 pb-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <p className="line-clamp-2 min-h-11 font-display text-base leading-snug text-fg">
              {activeLine}
            </p>
            <p className="shrink-0 pt-1 text-sm text-muted tabular-nums">
              {turns.length === 0
                ? "0"
                : `${Math.min(reader.turnIndex + (done ? 0 : 1), turns.length)} / ${turns.length}`}
              <span className="mt-0.5 block text-right">{duration}</span>
            </p>
          </div>
          {reader.error ? <p className="mb-2 text-sm text-primary">{reader.error}</p> : null}
          {!reader.supported ? (
            <p className="mb-2 text-sm text-muted">
              이 브라우저에서는 음성 읽기를 지원하지 않아요.
            </p>
          ) : null}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center">
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label={reader.status === "playing" ? "일시정지" : "자동 재생"}
                className="inline-flex size-11 items-center justify-center rounded-full border border-line text-fg disabled:opacity-40"
                onClick={() => {
                  reader.prime();
                  reader.toggle();
                }}
                disabled={!reader.supported || turns.length === 0}
              >
                {reader.status === "playing" ? (
                  <Pause className="size-5" aria-hidden="true" />
                ) : (
                  <Play className="ml-0.5 size-5" aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                aria-label="이전 말"
                className="inline-flex size-11 items-center justify-center rounded-full border border-line text-fg disabled:opacity-40"
                onClick={reader.prev}
                disabled={turns.length === 0}
              >
                <SkipBack className="size-5" aria-hidden="true" />
              </button>
            </div>
            <button
              type="button"
              aria-label={dictation.armed ? "받아쓰기 끄기" : "음성으로 말하기"}
              aria-pressed={dictation.armed}
              onClick={() => {
                reader.prime();
                dictation.toggle();
              }}
              className={`inline-flex size-16 items-center justify-center rounded-full bg-primary text-ink ${
                dictation.armed ? "ring-2 ring-fg ring-offset-2 ring-offset-surface" : ""
              }`}
            >
              <Mic className="size-7" aria-hidden="true" />
            </button>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                aria-label="다음 말"
                className="inline-flex size-11 items-center justify-center rounded-full border border-line text-fg disabled:opacity-40"
                onClick={reader.next}
                disabled={turns.length === 0}
              >
                <SkipForward className="size-5" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="처음으로"
                className="inline-flex size-11 items-center justify-center rounded-full border border-line text-fg disabled:opacity-40"
                onClick={reader.stop}
              >
                <RotateCcw className="size-5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </footer>

      {sheet ? (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-bg/70"
          onClick={cancelSettings}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={
              sheet === "save" ? "대화 저장하기" : sheet === "script" ? "대화 불러오기" : "설정"
            }
            className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-line bg-surface px-4 pt-3 pb-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex gap-2">
                <button
                  type="button"
                  className={
                    "h-10 rounded-full px-3 text-sm " +
                    (sheet === "script" ? "bg-primary text-ink" : "text-muted")
                  }
                  onClick={() => {
                    setDraftNote(null);
                    setExportText(null);
                    setSheet("script");
                  }}
                >
                  불러오기
                </button>
                <button
                  type="button"
                  className={
                    "h-11 rounded-full px-3 text-sm " +
                    (sheet === "save" ? "bg-primary text-ink" : "text-muted")
                  }
                  onClick={() => {
                    setDraftNote(null);
                    setExportText(null);
                    setSheet("save");
                  }}
                >
                  저장하기
                </button>
                <button
                  type="button"
                  className={
                    "h-10 rounded-full px-3 text-sm " +
                    (sheet === "voice" ? "bg-primary text-ink" : "text-muted")
                  }
                  onClick={openSettings}
                >
                  설정
                </button>
              </div>
              <button
                type="button"
                aria-label="닫기"
                className="inline-flex size-10 items-center justify-center rounded-full text-muted"
                onClick={cancelSettings}
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>

            {sheet === "save" ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-3 rounded-2xl border border-line bg-bg p-3">
                  <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-fg">
                    자동 백업
                    <input
                      type="checkbox"
                      checked={autoBackupOn}
                      disabled={cloudBusy || !autoBackupReady}
                      className="size-5 accent-primary"
                      onChange={(event) => {
                        if (event.target.checked) void enableAutoBackup();
                        else {
                          autoBackupQueue.current?.stop();
                          setAutoBackupOn(false);
                          setAutoBackupPaused(false);
                          setAutoBackupNote("자동 백업을 껐습니다.");
                        }
                      }}
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm text-fg">
                    자동 백업 위치
                    <select
                      aria-label="자동 백업 위치"
                      value={autoBackupTarget}
                      className="h-11 rounded-xl border border-line bg-bg px-3 text-fg"
                      disabled={cloudBusy}
                      onChange={(event) => {
                        autoBackupQueue.current?.stop();
                        autoBackupSaved.current = null;
                        setAutoBackupOn(false);
                        setAutoBackupPaused(false);
                        setAutoBackupAt(null);
                        setAutoBackupNote("자동 백업을 켜면 선택한 위치에 첫 백업을 저장합니다.");
                        setAutoBackupTarget(event.target.value as "local" | "folder");
                      }}
                    >
                      <option value="local">기기 내부 (안드로이드 포함)</option>
                      <option value="folder">클라우드·NAS 폴더 (컴퓨터)</option>
                    </select>
                  </label>
                  <p className="text-sm text-muted">
                    앱을 열어 둔 동안 마지막 변경 후 30초에 최신 백업 하나를 갱신합니다.
                    {autoBackupTarget === "local"
                      ? " 기기 내부 백업은 불러오기에서 복원할 수 있습니다. 앱 데이터나 사이트 데이터를 지우면 백업도 삭제됩니다."
                      : ` 선택한 폴더의 ${AUTO_BACKUP_FILE}에 저장합니다.`}
                  </p>
                  <p role="status" className="text-sm text-primary">
                    {autoBackupNote ||
                      (autoBackupOn
                        ? "변경 후 30초에 자동 백업합니다."
                        : "켜면 선택한 위치에 첫 백업을 저장합니다.")}
                  </p>
                  {autoBackupAt ? (
                    <p className="text-sm text-muted">
                      마지막 성공 · {new Date(autoBackupAt).toLocaleString("ko-KR")}
                    </p>
                  ) : null}
                  {autoBackupPaused ? (
                    <button
                      type="button"
                      disabled={cloudBusy}
                      className="h-11 rounded-full border border-line text-sm text-fg disabled:opacity-40"
                      onClick={() => void enableAutoBackup()}
                    >
                      {autoBackupTarget === "local" ? "다시 시도" : "다시 연결"}
                    </button>
                  ) : null}
                </div>
                <div className="flex flex-col gap-3 rounded-2xl border border-line bg-bg px-3 py-3">
                  <p className="text-sm text-pretty text-fg">대화 저장하기</p>
                  <p className="text-sm text-pretty text-muted">
                    모든 페르소나와 대화를 JSON 파일로 저장합니다. 클라우드·NAS는 컴퓨터에 연결된
                    동기화 폴더에 저장하고, 휴대폰에서는 공유 앱을 고릅니다. 저장 파일에는 삭제용
                    비밀번호도 포함됩니다.
                  </p>
                  {cloudFolder ? (
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-sm text-fg">저장 폴더 · {cloudFolder}</p>
                      <button
                        type="button"
                        className="h-10 shrink-0 rounded-full border border-line px-3 text-sm text-fg disabled:opacity-40"
                        disabled={cloudBusy}
                        onClick={() => void sendBackup("retarget")}
                      >
                        다른 폴더
                      </button>
                    </div>
                  ) : null}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-primary px-3 text-sm font-medium text-ink disabled:opacity-40"
                      disabled={cloudBusy}
                      onClick={() => void sendBackup("cloud")}
                    >
                      <Share2 className="size-4" aria-hidden="true" />
                      클라우드·NAS에 저장
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full border border-line px-3 text-sm text-fg"
                      onClick={() => void sendBackup("download")}
                    >
                      <Download className="size-4" aria-hidden="true" />
                      기기에 저장
                    </button>
                  </div>
                  {exportText ? (
                    <div className="flex flex-col gap-2">
                      {draftNote ? (
                        <p className="text-sm text-pretty text-primary">{draftNote}</p>
                      ) : null}
                      <textarea
                        readOnly
                        value={exportText}
                        rows={6}
                        aria-label="보관한 대화"
                        className="w-full resize-y rounded-2xl border border-line bg-surface px-3 py-3 text-sm text-fg"
                        onFocus={(e) => e.currentTarget.select()}
                      />
                      <button
                        type="button"
                        className="h-11 rounded-full border border-line text-sm text-fg"
                        onClick={() =>
                          void copyText(exportText).then((ok) =>
                            setDraftNote(
                              ok
                                ? "대화를 복사했습니다. 메모나 파일 앱에 붙여 넣으세요."
                                : "복사가 막혔습니다. 위 글을 길게 눌러 선택하세요.",
                            ),
                          )
                        }
                      >
                        다시 복사
                      </button>
                    </div>
                  ) : null}
                </div>
                {draftNote && !exportText ? (
                  <p role="status" className="text-sm text-primary">
                    {draftNote}
                  </p>
                ) : null}
              </div>
            ) : sheet === "script" ? (
              <div className="flex flex-col gap-3">
                <h2 className="text-lg font-medium text-fg">대화 불러오기</h2>
                <p className="text-sm text-muted">
                  저장한 파일을 선택하세요. 백업을 불러오면 현재 대화와 페르소나를 바꾸기 전에
                  내용을 확인합니다. 컴퓨터에서는 연결된 동기화·NAS 폴더의 파일을, 휴대폰에서는 파일
                  앱의 드라이브·NAS 위치를 고르세요.
                </p>
                <button
                  type="button"
                  className="h-11 rounded-full border border-line px-4 text-sm text-fg"
                  onClick={() => {
                    try {
                      const json = readLocalBackup(localStorage);
                      if (!json) {
                        setDraftNote("이 기기에 저장된 자동 백업이 없습니다.");
                        return;
                      }
                      void loadBackupFile(
                        new File([json], "기기 내부 자동 백업.json", { type: "application/json" }),
                      );
                    } catch {
                      setDraftNote("기기 내부 백업을 읽지 못했습니다.");
                    }
                  }}
                >
                  기기 내부 자동 백업 불러오기
                </button>
                {pendingBackup ? (
                  <div className="flex flex-col gap-2 rounded-2xl border border-line bg-bg p-3">
                    <p className="text-sm text-fg">
                      {pendingBackup.name} · 페르소나 {pendingBackup.backup.personas.length}개 ·
                      대화{" "}
                      {Object.values(pendingBackup.backup.threads).reduce(
                        (sum, list) => sum + list.length,
                        0,
                      )}
                      마디
                    </p>
                    <p className="text-sm text-muted">
                      현재 대화와 페르소나가 이 파일의 내용으로 바뀝니다.
                    </p>
                    <button
                      type="button"
                      className="h-11 rounded-full bg-primary text-sm text-ink"
                      onClick={() => {
                        restoreBackup(pendingBackup.backup);
                        setPendingBackup(null);
                      }}
                    >
                      이 백업으로 복원
                    </button>
                    <button
                      type="button"
                      className="h-11 rounded-full border border-line text-sm text-fg"
                      onClick={() => setPendingBackup(null)}
                    >
                      취소
                    </button>
                  </div>
                ) : null}
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    className="h-11 rounded-full bg-primary px-4 text-sm font-medium text-ink"
                    onClick={() => void loadCloudFile()}
                  >
                    클라우드·NAS에서 불러오기
                  </button>
                  <button
                    type="button"
                    className="h-11 rounded-full border border-line px-4 text-sm text-fg"
                    onClick={() => fileRef.current?.click()}
                  >
                    기기에서 불러오기
                  </button>
                </div>
                <p className="text-sm text-pretty text-muted">
                  그록닷컴이나 그록봇에서 대화의 공유를 눌러 나온 주소를 붙여넣으세요. 계정에서 받은
                  JSON 파일도 됩니다. 로그인한 전체 기록은 그록이 이 앱에 열어 주지 않습니다.
                </p>
                <div className="flex gap-2">
                  <input
                    value={shareUrl}
                    onChange={(e) => {
                      setShareUrl(e.target.value);
                      setDraftNote(null);
                    }}
                    placeholder="grok.com/share/…"
                    aria-label="그록 공유 주소"
                    className="h-11 min-w-0 flex-1 rounded-full border border-line bg-bg px-4 text-base text-fg placeholder:text-faint"
                  />
                  <button
                    type="button"
                    disabled={shareBusy || !shareUrl.trim()}
                    className="h-11 shrink-0 rounded-full bg-primary px-4 text-sm font-medium text-ink disabled:opacity-40"
                    onClick={() => void loadShare()}
                  >
                    {shareBusy ? "여는 중" : "불러오기"}
                  </button>
                </div>
                {imported && imported.length > 1 ? (
                  <div className="flex max-h-48 flex-col gap-2 overflow-y-auto">
                    {imported.map((chat, index) => (
                      <button
                        key={`${chat.title}-${index}`}
                        type="button"
                        className="rounded-2xl border border-line px-3 py-2 text-left text-sm text-fg"
                        onClick={() => applyImported(chat)}
                      >
                        {chat.title}
                        <span className="mt-0.5 block text-muted">{chat.turns.length}마디</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                <textarea
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setDraftNote(null);
                  }}
                  placeholder={"나: 오늘 뭐 했어?\n그록: 붙여넣은 대화를 읽고 있었어."}
                  rows={8}
                  className="w-full resize-y rounded-2xl border border-line bg-bg px-3 py-3 text-base text-fg placeholder:text-faint"
                />
                <p className="text-sm text-muted tabular-nums">
                  {draft.trim()
                    ? parsedDraft.mode === "empty"
                      ? "인식된 말 없음"
                      : `말 ${parsedDraft.turns.length}개 · ${
                          parsedDraft.mode === "labeled" ? "화자 표시 인식" : "문단을 번갈아 배치"
                        }`
                    : "아직 비어 있음"}
                </p>
                {draftNote && !exportText ? (
                  <p className="text-sm text-primary">{draftNote}</p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="h-11 rounded-full bg-primary px-4 text-sm font-medium text-ink"
                    onClick={applyDraft}
                  >
                    이 대화로 듣기
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".txt,.md,.json,text/plain,application/json"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) void loadBackupFile(file);
                    }}
                  />
                  <button
                    type="button"
                    className="inline-flex h-11 items-center gap-2 rounded-full border border-line px-4 text-sm text-fg"
                    onClick={flipSpeakers}
                  >
                    <ArrowLeftRight className="size-4" aria-hidden="true" />
                    화자 뒤집기
                  </button>
                  <button
                    type="button"
                    className="h-11 rounded-full border border-line px-4 text-sm text-muted"
                    onClick={loadSample}
                  >
                    예시로 바꾸기
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <span className="text-sm text-muted">페르소나</span>
                  <div className="flex flex-wrap gap-2">
                    {personas.map((item) => {
                      const on = item.id === personaId;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          aria-pressed={on}
                          className={
                            "h-10 rounded-full px-3 text-sm " +
                            (on ? "bg-primary text-ink" : "border border-line text-fg")
                          }
                          onClick={() => selectPersona(item.id)}
                        >
                          {item.name}
                        </button>
                      );
                    })}
                  </div>
                  {newPersona ? (
                    <div className="flex flex-col gap-2">
                      <input
                        value={newPersona.name}
                        maxLength={16}
                        onChange={(e) =>
                          setNewPersona({ ...newPersona, name: e.target.value.slice(0, 16) })
                        }
                        placeholder="이름"
                        aria-label="새 페르소나 이름"
                        className="h-12 rounded-2xl border border-line bg-bg px-3 text-base text-fg"
                      />
                      <textarea
                        value={newPersona.text}
                        maxLength={240}
                        rows={3}
                        onChange={(e) =>
                          setNewPersona({ ...newPersona, text: e.target.value.slice(0, 240) })
                        }
                        placeholder="말투. 예: 운전 중이라 짧게, 반말로 말해."
                        aria-label="새 페르소나 내용"
                        className="w-full resize-none rounded-2xl border border-line bg-bg px-3 py-3 text-base text-fg placeholder:text-faint"
                      />
                      <input
                        type="password"
                        value={newPersona.password}
                        maxLength={32}
                        autoComplete="new-password"
                        onChange={(e) =>
                          setNewPersona({ ...newPersona, password: e.target.value.slice(0, 32) })
                        }
                        placeholder="삭제용 비밀번호"
                        aria-label="삭제용 비밀번호"
                        className="h-12 rounded-2xl border border-line bg-bg px-3 text-base text-fg"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="h-11 rounded-full bg-primary px-4 text-sm font-medium text-ink"
                          onClick={addPersona}
                        >
                          추가
                        </button>
                        <button
                          type="button"
                          className="h-11 rounded-full border border-line px-4 text-sm text-fg"
                          onClick={() => setNewPersona(null)}
                        >
                          취소
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <input
                        value={selectedPersona?.name ?? ""}
                        maxLength={16}
                        onChange={(e) => updatePersona({ name: e.target.value.slice(0, 16) })}
                        aria-label="페르소나 이름"
                        className="h-12 rounded-2xl border border-line bg-bg px-3 text-base text-fg"
                      />
                      <textarea
                        value={selectedPersona?.text ?? ""}
                        maxLength={240}
                        rows={3}
                        onChange={(e) => updatePersona({ text: e.target.value.slice(0, 240) })}
                        placeholder="직접 적어도 됩니다. 예: 운전 중이라 짧게, 반말로 말해."
                        aria-label="페르소나 내용"
                        className="w-full resize-none rounded-2xl border border-line bg-bg px-3 py-3 text-base text-fg placeholder:text-faint"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="h-11 rounded-full border border-line px-4 text-sm text-fg"
                          onClick={() => setNewPersona({ name: "", text: "", password: "" })}
                        >
                          새 페르소나
                        </button>
                        <button
                          type="button"
                          className="h-11 rounded-full border border-line px-4 text-sm text-muted disabled:opacity-40"
                          onClick={deletePersona}
                          disabled={!selectedPersona || selectedPersona.locked}
                        >
                          삭제
                        </button>
                      </div>
                      <p className="text-sm text-muted">
                        이름과 내용을 고치면 바로 그 말투로 답합니다. 대화는 페르소나마다 따로
                        보입니다. 새로 만들 때 정한 비밀번호가 있어야 지울 수 있습니다.
                      </p>
                    </div>
                  )}
                </div>
                <VoiceSelect
                  label="내 목소리 · 남자"
                  value={voiceMe}
                  voices={MALE_VOICES}
                  previewing={previewing === voiceMe}
                  onChange={setVoiceMe}
                  onPreview={() => void previewVoice(voiceMe)}
                />
                <VoiceSelect
                  label="그록 목소리 · 여자"
                  value={voiceGrok}
                  voices={FEMALE_VOICES}
                  previewing={previewing === voiceGrok}
                  onChange={setVoiceGrok}
                  onPreview={() => void previewVoice(voiceGrok)}
                />
                <Slider
                  label="속도"
                  value={rate}
                  min={0.7}
                  max={1.5}
                  step={0.05}
                  display={`${rate.toFixed(2)}×`}
                  onChange={setRate}
                />
                <Slider
                  label="말 사이 쉼"
                  value={gap}
                  min={0}
                  max={1.5}
                  step={0.05}
                  display={`${gap.toFixed(2)}초`}
                  onChange={setGap}
                />
                <label className="flex items-center justify-between gap-3 text-sm text-fg">
                  이름을 부르면 말하기
                  <input
                    type="checkbox"
                    checked={wakeOn}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setWakeOn(on);
                      if (on) wake.kick();
                      else wake.halt();
                    }}
                    className="size-5 accent-primary"
                  />
                </label>
                <p className="text-sm text-pretty text-muted">
                  {wakeCall.length > 1
                    ? `「${wakeCall[0]}」 또는 「${wakeCall[1]}」라고 하면 대답하고 말하기가 켜집니다.`
                    : "페르소나 이름을 정하면 그 이름으로 부를 수 있습니다."}
                  {wakeOn && !wake.listening
                    ? " 브라우저가 듣기를 끝내면 자동으로 다시 켜지 않습니다. 다시 듣고 싶으면 스위치를 껐다 켜 주세요."
                    : ""}
                </p>
                <label className="flex items-center justify-between gap-3 text-sm text-fg">
                  그록이 한 말만 읽기
                  <input
                    type="checkbox"
                    checked={onlyGrok}
                    onChange={(e) => setOnlyGrok(e.target.checked)}
                    className="size-5 accent-primary"
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm text-fg">
                  말이 끊기면 자동으로 답하기
                  <input
                    type="checkbox"
                    checked={autoReply}
                    onChange={(e) => setAutoReply(e.target.checked)}
                    className="size-5 accent-primary"
                  />
                </label>
                <Slider
                  label="음성 없이 기다리는 시간"
                  value={silence}
                  min={1}
                  max={5}
                  step={0.5}
                  display={`${silence.toFixed(1)}초`}
                  onChange={setSilence}
                />
                <label className="flex items-center justify-between gap-3 text-sm text-fg">
                  읽는 말로 자동 스크롤
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                    className="size-5 accent-primary"
                  />
                </label>
                <p className="text-sm text-pretty text-muted">
                  마이크를 켜고 말하면 받아 적습니다. 페르소나 이름 뒤에 야나 아를 붙여 부르면 그
                  말투로 받고 말하기가 켜집니다. 셀카나 사진을 보내 달라고 하면 그림을, 영상이라고
                  하면 짧은 영상을 채팅에 넣고 읽어 줍니다. 만들기 전에는 만들었다고 말하지
                  않습니다. 장소, 가격, 소식 같은 정보는 그록이 인터넷에서 찾아 읽어 줍니다. 설정한
                  시간 동안 음성이 없으면 대답하고, 읽는 동안에는 마이크를 잠깐 멈춥니다.
                </p>
                <p className="text-center text-xs text-muted">
                  {APP_NAME} {APP_VERSION}
                </p>
                <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-line bg-surface px-4 py-3">
                  <button
                    type="button"
                    className="h-11 flex-1 rounded-full bg-primary text-sm font-medium text-ink"
                    onClick={saveSettings}
                  >
                    저장
                  </button>
                  <button
                    type="button"
                    className="h-11 flex-1 rounded-full border border-line text-sm text-fg"
                    onClick={cancelSettings}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    className="h-11 flex-1 rounded-full border border-line text-sm text-fg"
                    onClick={resetSettings}
                  >
                    기본값
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
      {eraseStep > 0 && selectedPersona ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 px-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="페르소나 삭제"
            className="w-full max-w-sm rounded-3xl border border-line bg-surface p-4"
          >
            {eraseStep === 1 ? (
              <div className="flex flex-col gap-4">
                <p className="text-base text-pretty text-fg">
                  「{selectedPersona.name}」을 지울까요?
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="h-11 flex-1 rounded-full bg-primary text-sm font-medium text-ink"
                    onClick={() => setEraseStep(2)}
                  >
                    지우기
                  </button>
                  <button
                    type="button"
                    className="h-11 flex-1 rounded-full border border-line text-sm text-fg"
                    onClick={() => setEraseStep(0)}
                  >
                    취소
                  </button>
                </div>
              </div>
            ) : null}
            {eraseStep === 2 ? (
              <div className="flex flex-col gap-4">
                <p className="text-base text-pretty text-fg">
                  한 번 더 확인합니다. 정말 삭제할까요? 되돌릴 수 없습니다.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="h-11 flex-1 rounded-full bg-primary text-sm font-medium text-ink"
                    onClick={() => setEraseStep(3)}
                  >
                    계속
                  </button>
                  <button
                    type="button"
                    className="h-11 flex-1 rounded-full border border-line text-sm text-fg"
                    onClick={() => setEraseStep(0)}
                  >
                    취소
                  </button>
                </div>
              </div>
            ) : null}
            {eraseStep === 3 ? (
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  finishDelete();
                }}
              >
                <p className="text-base text-pretty text-fg">삭제용 비밀번호를 입력하세요.</p>
                <input
                  type="password"
                  value={erasePassword}
                  autoFocus
                  autoComplete="current-password"
                  onChange={(e) => setErasePassword(e.target.value)}
                  aria-label="삭제용 비밀번호"
                  className="h-12 rounded-2xl border border-line bg-bg px-3 text-base text-fg"
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="h-11 flex-1 rounded-full bg-primary text-sm font-medium text-ink"
                  >
                    삭제
                  </button>
                  <button
                    type="button"
                    className="h-11 flex-1 rounded-full border border-line text-sm text-fg"
                    onClick={() => setEraseStep(0)}
                  >
                    취소
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function VoiceSelect({
  label,
  value,
  voices,
  previewing,
  onChange,
  onPreview,
}: {
  label: string;
  value: string;
  voices: readonly { id: string; name: string }[];
  previewing: boolean;
  onChange: (id: string) => void;
  onPreview: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 text-sm text-muted">
      {label}
      <div className="flex items-center gap-2">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 min-w-0 flex-1 rounded-2xl border border-line bg-bg px-3 text-base text-fg"
        >
          {voices.map((voice) => (
            <option key={voice.id} value={voice.id}>
              {voice.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="h-11 shrink-0 rounded-full border border-line px-3 text-sm text-fg disabled:opacity-40"
          onClick={onPreview}
          disabled={previewing}
        >
          {previewing ? "듣는 중" : "목소리 확인"}
        </button>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm text-muted">
      <span className="flex items-center justify-between">
        {label}
        <span className="text-fg tabular-nums">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-11 accent-primary"
      />
    </label>
  );
}

function wantsVideo(text: string) {
  const compact = text.replace(/\s+/g, "");
  if (/안보|안떠|안뜨|어디|이상|깨져|안나/.test(compact)) return false;
  if (
    /(영상|동영상|비디오|클립)/.test(compact) &&
    /(만들|찍어|생성|보여|해봐|해줘|하나)/.test(compact)
  )
    return true;
  return /(영상|동영상|비디오)(로|을|를)?$/.test(compact) && compact.length > 4;
}

function videoSeconds(text: string) {
  const found = text.match(/(\d+)\s*초/);
  const seconds = found ? Number(found[1]) : 5;
  return Math.min(8, Math.max(2, seconds || 5));
}

function videoPrompt(text: string, history: { role: string; content: string }[]) {
  const cleaned = text
    .replace(/\d+\s*초(짜리)?/g, " ")
    .replace(/짧은 영상|동영상|비디오|클립|영상/g, " ")
    .replace(
      /베이스로|기반으로|만들어\s*봐|만들어봐|만들어\s*줘|만들어줘|해\s*봐|해봐|해\s*줘|하나/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (!isVagueSubject(cleaned) && cleaned.length > 1) return cleaned.slice(0, 400);
  for (let i = history.length - 1; i >= 0; i--) {
    const content = history[i].content.replace(/\s+/g, " ").trim();
    if (!content || isAside(content) || wantsVideo(content) || wantsImage(content)) continue;
    return content.slice(0, 400);
  }
  return (cleaned || "짧은 장면이 살짝 움직인다").slice(0, 400);
}

function wantsImage(text: string) {
  const compact = text.replace(/\s+/g, "");
  if (/안보|안떠|안뜨|어디|이상|깨져|안나|없대|없어/.test(compact)) return false;
  if (/그려(줘|줄|봐|라|주|요)/.test(compact)) return true;
  if (
    /(셀카|그림|이미지|사진|일러스트).{0,8}(만들어|그려|생성해|보내|보여|찍어|달라)/.test(compact)
  ) {
    return !/누구|언제|왜|뭐야|맞아/.test(compact);
  }
  if (/(셀카|사진|그림|이미지).{0,4}(줘|봐)$/.test(compact)) return true;
  if (/(이미지|그림|사진|일러스트|셀카)(로|을|를)?$/.test(compact) && compact.length > 4)
    return true;
  return /\b(draw|illustrat\w*|generate)\b.{0,24}\b(image|picture|photo)\b/i.test(text);
}

function imagePrompt(text: string, history: { role: string; content: string }[]) {
  const cleaned = text
    .replace(/^[가-힣]{1,8}[야아]\s+/, " ")
    .replace(
      /그려\s*줘|그려줘|그려\s*줄래|그려\s*주라|그려봐|그려\s*봐|그려라|그림으로|이미지로|이미지\s*생성|만들어\s*줘|만들어줘|보내\s*줘|보내줘|보내\s*봐|보내봐|보여\s*줘|보여줘|보여\s*봐|보여봐|찍어\s*줘|찍어줘|찍어\s*봐|찍어봐|찍어/g,
      " ",
    )
    .replace(/(이미지|그림|일러스트)(로|을|를)?$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!isVagueSubject(cleaned)) return cleaned.slice(0, 400);
  for (let i = history.length - 1; i >= 0; i--) {
    const content = history[i].content.replace(/\s+/g, " ").trim();
    if (!content || isAside(content)) continue;
    if (history[i].role === "user" && wantsImage(content)) continue;
    return content.slice(0, 400);
  }
  return (cleaned || text).slice(0, 400);
}

function isVagueSubject(cleaned: string) {
  const compact = cleaned.replace(/\s+/g, "");
  if (!compact) return true;
  return /^(그거|이거|저거|방금|방금말한(거|것|장면)?|그것|어떤(이미지|그림|사진)?|이미지|그림|사진|하나|장면)$/.test(
    compact,
  );
}

function isAside(content: string) {
  return /이미지를 만들 수 없|글로만 대화|그림을 만들었|이미지를 만들었|화면에서 볼 수|화면에서 바로/.test(
    content,
  );
}

function fallbackGreet(persona: string) {
  const text = persona.replace(/\s+/g, "");
  const formal = /비서|선생님|존댓|차분|공손/.test(text);
  const casual = /반말|친구|편하게|장난/.test(text);
  const pool = formal
    ? ["네, 듣고 있습니다.", "말씀하세요.", "네, 준비됐습니다.", "부르셨나요."]
    : casual
      ? ["응, 왜.", "어, 듣고 있어.", "불러? 말해.", "나 여기 있어."]
      : ["네, 듣고 있어.", "응, 말해.", "여기 있어.", "듣고 있어."];
  return pool[Math.floor(Math.random() * pool.length)];
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function readThreads(saved: Partial<Saved>) {
  const out: Record<string, Turn[]> = {};
  if (saved.threads && typeof saved.threads === "object") {
    for (const [key, value] of Object.entries(saved.threads)) {
      if (Array.isArray(value) && value.every(isTurn)) out[key] = value;
    }
  }
  const home = typeof saved.personaId === "string" && saved.personaId ? saved.personaId : "plain";
  const legacy = Array.isArray(saved.turns) && saved.turns.every(isTurn) ? saved.turns : null;
  if (legacy && legacy.length > 0 && !out[home]) out[home] = legacy;
  if (Object.keys(out).length > 0) return out;
  if (legacy) return { [home]: legacy };
  return null;
}

function turnsToText(turns: Turn[]) {
  return turns.map((t) => `${speakerLabel(t.speaker)}: ${t.text}`).join("\n\n");
}
