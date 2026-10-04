import { wantsVideo, wantsImage, videoSeconds, videoPrompt, imagePrompt } from "@/lib/media-intent";
import {
  participantCommand,
  roomChanges,
  conversationMemory,
  knownTurns,
  findQuestionMedia,
  turnRecord,
  rememberRoomEvents,
} from "@/lib/room-context";
import { MusicListener } from "@/components/music-listener";
import { musicCommand } from "@/lib/music-analysis";
import { relayDelivery, storeRelay, relayMemoryKey } from "@/lib/persona-relay";
import { videoFrames } from "@/lib/video-frames";
import { useMailReplies } from "@/lib/use-mail-replies";
import { MailNotifications } from "@/components/mail-notifications";
import {
  DEFAULT_ANNOUNCEMENTS,
  ANNOUNCEMENT_DEFAULTS_VERSION,
  migrateAnnouncementLines,
  isAnnouncement,
  startsWithPersonaName,
} from "@/lib/voice-input-filter";
import {
  parsePersonaTemplate,
  parsePersonaMarkdown,
  applyPersonaAsset,
  cleanPersonaKnowledge,
  findPersonaByName,
  personaInstructions,
  memoryForQuestion,
  personaTemplateFilename,
  type PersonaKnowledge,
  type PersonaAsset,
} from "@/lib/persona-memory";
import { getDropboxClient } from "@/lib/dropbox-client";
import { profileImage, personaColor } from "@/lib/persona-profile";
import { DEFAULT_PERSONAS, migrateDefaultPersonas } from "@/lib/default-personas";
import { useEffect, useMemo, useRef, useState } from "react";
import { useVoiceBackup } from "@/components/use-voice-backup";
import { VoiceIdentitySettings } from "@/components/voice-identity";
import { useVoiceIdentity } from "@/lib/use-voice-identity";
import { speakerEmbedding } from "@/lib/speaker-client";
import { matchVoice } from "@/lib/speaker-identity";
import { AppSecuritySettings } from "@/components/app-security";
import { VoiceMailBox } from "@/components/voice-mail";
import { deleteVoiceMails } from "@/lib/voice-mail";
import {
  conversationEnded,
  deleteConversationCommand,
  relayCommand,
} from "@/lib/conversation-actions";
import { takePersonaWake } from "@/lib/wake";
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
import { useDropboxImport } from "@/components/dropbox-import";
import { APP_NAME, APP_VERSION } from "@/lib/app-meta";
import { askGrok } from "@/lib/ask-grok";
import { speechParts } from "@/lib/stream-speech";
import { streamAsk } from "@/lib/ask-stream";
import { chatsFromJson, type ImportedChat } from "@/lib/grok-import";
import { buildBackup, parseNangdokBackup, type NangdokBackup } from "@/lib/nangdok-backup";
import { backupFileName, cloudFolderName, placeInCloud, openCloudFile } from "@/lib/cloud-dest";
import { autoSaveInCloud } from "@/lib/cloud-dest";
import { LOCAL_BACKUP_KEY, saveLocalBackup, readLocalBackup } from "@/lib/local-backup";
import {
  parseGrokbotBackup,
  mergeGrokbotBackup,
  grokbotPersonaId,
  type GrokbotBackup,
} from "@/lib/grokbot-backup";
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
import { wakeForms } from "@/lib/wake";

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
  voiceOnly?: boolean;
  requireVoiceName?: boolean;
  filterAnnouncements?: boolean;
  announcementLines?: string[];
  announcementDefaultsVersion?: number;
  autoReply: boolean;
  silence: number;
  wakeOn: boolean;
  wakeIdleSeconds: number;
  persona: string;
  personaId: string;
  personas: PersonaItem[];
  index: number;
  threads?: Record<string, Turn[]>;
  wakeDefaulted?: boolean;
  groupMembers?: string[];
  roomMembers?: Record<string, string[]>;
};

type SettingsSnap = {
  wakeIdleSeconds: number;
  rate: number;
  gap: number;
  voiceMe: string;
  voiceGrok: string;
  autoScroll: boolean;
  onlyGrok: boolean;
  voiceOnly: boolean;
  requireVoiceName: boolean;
  filterAnnouncements: boolean;
  announcementLines: string[];
  autoReply: boolean;
  silence: number;
  wakeOn: boolean;
  persona: string;
  personaId: string;
  personas: PersonaItem[];
};

type PersonaItem = PersonaKnowledge & {
  id: string;
  name: string;
  text: string;
  password: string;
  locked: boolean;
};

const STARTER_PERSONAS: PersonaItem[] = DEFAULT_PERSONAS;

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
  const [voiceOnly, setVoiceOnly] = useState(true);
  const [requireVoiceName, setRequireVoiceName] = useState(false);
  const [filterAnnouncements, setFilterAnnouncements] = useState(true);
  const [announcementLines, setAnnouncementLines] = useState<string[]>(DEFAULT_ANNOUNCEMENTS);
  const [autoReply, setAutoReply] = useState(true);
  const [silence, setSilence] = useState(2);
  const [wakeOn, setWakeOn] = useState(false);
  const [wakeSession, setWakeSession] = useState(false);
  const wakeSessionRef = useRef(false);
  const [wakeIdleSeconds, setWakeIdleSeconds] = useState(10);
  const [persona, setPersona] = useState("");
  const [personaId, setPersonaId] = useState(STARTER_PERSONAS[0].id);
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
  const [legacyGroupMembers, setGroupMembers] = useState<string[]>([]);
  const [roomMembers, setRoomMembers] = useState<Record<string, string[]>>({});
  const groupMembers = useMemo(
    () =>
      roomMembers[personaId] ?? (personaId.startsWith("group:") ? legacyGroupMembers : [personaId]),
    [roomMembers, personaId, legacyGroupMembers],
  );
  const roomHost = personaId.startsWith("group:") ? groupMembers[0] : personaId;
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [groupSetup, setGroupSetup] = useState(false);
  const [groupDraft, setGroupDraft] = useState<string[]>([]);
  const [deleteAllStage, setDeleteAllStage] = useState<0 | 1 | 2>(0);
  const [mailboxOpen, setMailboxOpen] = useState(false);
  const [deletingChats, setDeletingChats] = useState(false);
  const [deleteChat, setDeleteChat] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    const selected = personas.find((item) => item.id === personaId);
    if (selected?.voice && isFemaleVoice(selected.voice)) setVoiceGrok(selected.voice);
  }, [personaId, personas]);
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
  const [pendingPersonaAsset, setPendingPersonaAsset] = useState<PersonaAsset | null>(null);
  const [pendingBotBackup, setPendingBotBackup] = useState<GrokbotBackup | null>(null);
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
    () => JSON.stringify({ personaId, personas, threads, roomMembers }),
    [personaId, personas, threads, roomMembers],
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
  const jobEpoch = useRef(0);
  const answerAbort = useRef<AbortController | null>(null);
  const [musicRequest, setMusicRequest] = useState(0);
  const musicStop = useRef<() => void>(() => {});
  const musicRoom = useRef("");
  const musicBusy = useRef(false);
  function stopActivity() {
    musicStop.current();
    jobEpoch.current++;
    answerAbort.current?.abort();
    answerAbort.current = null;
    reader.stop();
    dictation.stop();
    setThreads((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([key, list]) => [
          key,
          list.map((turn) =>
            turn.streaming
              ? { ...turn, streaming: false, speechParts: speechParts(turn.text, true) }
              : turn,
          ),
        ]),
      ),
    );
    busyRef.current = false;
    setAsking(false);
    setPainting(false);
    setFilming(false);
    setBanner("멈췄습니다. 이미 서버에 전달된 생성 요청의 비용은 발생할 수 있습니다.");
  }
  const askRef = useRef<(spoken?: string) => void>(() => {});
  const personaNameRef = useRef("");
  const personaRef = useRef("");
  const wakeOnRef = useRef(false);
  const settingsBase = useRef<SettingsSnap | null>(null);
  useMailReplies({
    enabled: hydrated,
    busy: asking || deletingChats || deleteAllStage !== 0,
    personas,
    threads,
    onError: setBanner,
    onChat: (mail, text) => {
      const at = Date.now();
      setThreads((previous) => {
        const history = previous[mail.personaId] ?? [];
        const answerId = "mail-answer-" + mail.id;
        if (history.some((turn) => turn.id === answerId)) return previous;
        const next: Turn[] = [
          ...history,
          { id: "mail-user-" + mail.id, speaker: "me", text: mail.text, at: mail.createdAt },
          {
            id: answerId,
            textOnly: true,
            speaker: "grok",
            text,
            at,
            personaId: mail.personaId,
            personaName: mail.personaName,
            voice: personas.find((p) => p.id === mail.personaId)?.voice,
          },
        ];
        if (personaIdRef.current === mail.personaId) turnsNow.current = next;
        return { ...previous, [mail.personaId]: next };
      });
      setBanner(mail.personaName + "에게서 챗 답장이 왔습니다.");
    },
  });
  const voiceIdentity = useVoiceIdentity();
  const dictation = useDictation({
    verifyAudio:
      voiceIdentity.blocked || voiceIdentity.identity?.enabled
        ? async (audio) => {
            if (voiceIdentity.blocked)
              throw new Error("등록한 목소리를 확인할 수 없습니다. 설정에서 다시 등록하세요.");
            const identity = voiceIdentity.identity!;
            return matchVoice(identity.samples, await speakerEmbedding(audio), identity.threshold)
              .accepted;
          }
        : undefined,
    paused: asking || reader.status === "playing" || reader.preparing,
    keepListening: wakeOn,
    forceRecord: wakeOn,
    idleMs: wakeOn && wakeSession ? wakeIdleSeconds * 1000 : undefined,
    silenceMs: Math.round(silence * 1000),
    autoSend: wakeOn || autoReply,
    acceptText:
      requireVoiceName || wakeOn || filterAnnouncements
        ? (text) => {
            if (
              filterAnnouncements &&
              isAnnouncement(takePersonaWake(text, personas)?.rest || text, announcementLines)
            )
              return "안내 문장을 무시했습니다.";
            if (
              (wakeOn ? !wakeSessionRef.current : requireVoiceName) &&
              !(wakeOn
                ? takePersonaWake(text, personas)
                : startsWithPersonaName(
                    text,
                    personas.map((p) => p.name),
                  ))
            )
              return "페르소나 이름을 부른 뒤 질문해 주세요.";
            if (wakeOn && takePersonaWake(text, personas)) {
              wakeSessionRef.current = true;
              setWakeSession(true);
            }
            return null;
          }
        : undefined,
    onText: setComposer,
    onUtterance: (text) => askRef.current(text),
    onError: setBanner,
  });
  useEffect(() => {
    if (!hydrated) return;
    wakeSessionRef.current = false;
    setWakeSession(false);
    if (wakeOn) dictation.arm();
    else dictation.stop();
    // Start standby only when the option changes, never after an idle stop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wakeOn, hydrated]);
  useEffect(() => {
    if (!dictation.armed) {
      wakeSessionRef.current = false;
      setWakeSession(false);
    }
  }, [dictation.armed]);
  const voiceInputNote =
    wakeOn && dictation.hearing
      ? wakeSession
        ? "계속 듣는 중 · 이름 없이 질문하세요"
        : "페르소나 이름을 기다리는 중"
      : dictation.note;
  const personaName = personaId.startsWith("group:")
    ? "함께 대화"
    : ((personas.find((item) => item.id === personaId) ?? personas[0])?.name ?? "");
  const wakeCall = wakeForms(personaName);
  personaNameRef.current = personaName;
  personaRef.current = persona;
  wakeOnRef.current = wakeOn;
  const wakeHandler = useRef<(rest: string, id: string) => void>(() => {});
  const wake = useWake({
    enabled: false,
    paused:
      mailboxOpen ||
      deletingChats ||
      deleteAllStage !== 0 ||
      dictation.armed ||
      asking ||
      painting ||
      filming ||
      reader.status === "playing" ||
      reader.preparing,
    names: personas,
    acceptText: (text) =>
      (!requireVoiceName ||
        startsWithPersonaName(
          text,
          personas.map((p) => p.name),
        )) &&
      (!filterAnnouncements ||
        !isAnnouncement(takePersonaWake(text, personas)?.rest || text, announcementLines)),
    onWake: (rest, id) => wakeHandler.current(rest, id),
    onError: setBanner,
  });
  const voiceBackup = useVoiceBackup(
    personas,
    threads,
    hydrated,
    asking || painting || filming || deletingChats,
    (id, content) => {
      const update = (items: PersonaItem[]) =>
        items.map((item) =>
          item.id === id
            ? applyPersonaAsset(item, {
                kind: "memory",
                bot: item.name,
                source: "voicegrok/memory.md",
                content,
              })
            : item,
        );
      try {
        const next = update(personas);
        if (settingsBase.current)
          settingsBase.current.personas = update(settingsBase.current.personas);
        setPersonas(next);
      } catch {
        setBanner(
          "Dropbox에는 요약을 저장했지만 앱 기억이 한도에 도달했습니다. 기존 기억을 정리한 뒤 파일을 다시 불러오세요.",
        );
      }
    },
  );

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
      if (typeof saved.voiceOnly === "boolean") setVoiceOnly(saved.voiceOnly);
      setRequireVoiceName(saved.requireVoiceName === true);
      setFilterAnnouncements(saved.filterAnnouncements !== false);
      if (Array.isArray(saved.announcementLines))
        setAnnouncementLines(
          migrateAnnouncementLines(
            saved.announcementLines
              .filter((line): line is string => typeof line === "string")
              .slice(0, 100),
            saved.announcementDefaultsVersion,
          ),
        );
      if (typeof saved.autoReply === "boolean") setAutoReply(saved.autoReply);
      if (typeof saved.silence === "number") setSilence(clamp(saved.silence, 1, 5));
      setWakeOn(saved.wakeOn === true);
      setWakeIdleSeconds(clamp(saved.wakeIdleSeconds ?? 10, 1, 15));
      // Persist the preference; recording still requires a long press.
      if (typeof saved.persona === "string") setPersona(saved.persona.slice(0, 240));
      if (Array.isArray(saved.personas)) {
        const next = saved.personas
          .filter(isPersona)
          .slice(0, 12)
          .map((item) => ({
            ...item,
            photo: undefined,
            showBackground: undefined,
            showAvatar: undefined,
            template: undefined,
            memories: undefined,
            ...cleanPersonaKnowledge(item),
          }));
        if (next.length > 0) {
          const migrated = migrateDefaultPersonas(next, loaded ?? {}, saved.personaId);
          setPersonas(migrated.personas);
          setThreads(rememberRoomEvents(migrated.threads, migrated.personas));
          const picked = migrated.personas.find((item) => item.id === migrated.personaId)!;
          setPersonaId(picked.id);
          setPersona(picked.text.slice(0, 240));
          if (saved.roomMembers && typeof saved.roomMembers === "object") {
            const valid = new Set(migrated.personas.map((p) => p.id));
            setRoomMembers(
              Object.fromEntries(
                Object.entries(saved.roomMembers)
                  .filter(([host, ids]) => valid.has(host) && Array.isArray(ids))
                  .map(([host, ids]) => [
                    host,
                    roomChanges(
                      host,
                      [],
                      ids.filter((id) => valid.has(id)),
                    ).members,
                  ]),
              ),
            );
          }
          if (
            typeof saved.personaId === "string" &&
            saved.personaId.startsWith("group:") &&
            Array.isArray(saved.groupMembers)
          ) {
            const members = [...new Set(saved.groupMembers)]
              .filter((id) => migrated.personas.some((item) => item.id === id))
              .slice(0, 6);
            if (members.length >= 2) {
              setGroupMembers(members);
              setPersonaId(saved.personaId);
              setPersona("");
            }
          }
          if (picked.name.trim().normalize("NFC") === "아라") bootIndex.current = 0;
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
      voiceOnly,
      requireVoiceName,
      filterAnnouncements,
      announcementLines,
      announcementDefaultsVersion: ANNOUNCEMENT_DEFAULTS_VERSION,
      autoReply,
      silence,
      wakeOn,
      wakeIdleSeconds,
      persona,
      personaId,
      personas,
      threads,
      wakeDefaulted: true,
      groupMembers,
      roomMembers,
      index: reader.turnIndex,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [
    hydrated,
    groupMembers,
    roomMembers,
    turns,
    rate,
    gap,
    voiceMe,
    voiceGrok,
    autoScroll,
    onlyGrok,
    voiceOnly,
    requireVoiceName,
    filterAnnouncements,
    announcementLines,
    autoReply,
    silence,
    wakeOn,
    wakeIdleSeconds,
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
        if (reader.status === "playing") reader.pause();
        else {
          let index = turns.length - 1;
          while (index >= 0 && turns[index].speaker !== "grok") index--;
          if (index >= 0) reader.playOne(index);
        }
      } else if (e.key === "ArrowRight") reader.next();
      else if (e.key === "ArrowLeft") reader.prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reader, turns]);

  const parsedDraft = useMemo(() => parseTranscript(draft, "preview"), [draft]);
  const duration = formatDuration(readingSeconds(turns, rate));
  const active = turns[reader.turnIndex];
  const activeChunks = active ? (active.speechParts ?? chunkText(active.text)) : [];
  const activeLine = filming
    ? "영상 만드는 중"
    : painting
      ? "그리는 중"
      : asking
        ? "그록이 대답하는 중"
        : reader.preparing
          ? "목소리 준비 중"
          : dictation.hearing || voiceInputNote
            ? voiceInputNote || "듣는 중"
            : wake.standby
              ? `「${wakeCall[0] ?? personaName}」라고 부르면 말하기가 켜집니다`
              : reader.status === "idle" && reader.turnIndex >= turns.length
                ? "재생하면 마지막 페르소나 답변을 다시 듣습니다."
                : (voiceOnly && active?.speaker === "grok" && !active.textOnly
                    ? `${active.personaName || personaName || "그록"}의 음성 메시지`
                    : activeChunks[reader.chunkIndex]) ||
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
    backup = {
      ...backup,
      ...migrateDefaultPersonas(backup.personas, backup.threads, backup.personaId),
    };
    const picked =
      backup.personas.find((item) => item.id === backup.personaId) ?? backup.personas[0];
    reader.stop();
    setPersonas(backup.personas);
    setThreads(rememberRoomEvents(backup.threads, backup.personas));
    setRoomMembers(backup.roomMembers ?? {});
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
    const backup = buildBackup({ personaId, personas, threads, roomMembers });
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
        const backup = buildBackup({ personaId, personas, threads, roomMembers });
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
      const backup = buildBackup({ personaId, personas, threads, roomMembers });
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
    setPendingBotBackup(null);
    setPendingPersonaAsset(null);
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("대화 파일은 10MB 이하로 선택하세요.");
      const text = await file.text();
      const trimmed = text.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        const data: unknown = JSON.parse(trimmed);
        const asset = parsePersonaTemplate(data, file.name);
        if (asset) {
          setPendingPersonaAsset({ ...asset, source: `${asset.bot}/${file.name}` });
          setDraftNote(null);
          return;
        }
        const botBackup = parseGrokbotBackup(data);
        if (botBackup) {
          setPendingBotBackup(botBackup);
          setDraftNote(null);
          return;
        }
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
      if (file.name.toLowerCase().endsWith(".md")) {
        const asset = parsePersonaMarkdown(text, file.name, selectedPersona.name);
        setPendingPersonaAsset({ ...asset, source: `${asset.bot}/${file.name}` });
        setDraftNote(null);
        return;
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

  function importBotBackup() {
    if (!pendingBotBackup) return;
    try {
      const backup = pendingBotBackup;
      const id = findPersonaByName(personas, backup.bot)?.id ?? grokbotPersonaId(backup.bot);
      const existing = personas.find((item) => item.id === id);
      if (!existing && personas.length >= 12) throw new Error("페르소나는 최대 12개입니다.");
      const next = mergeGrokbotBackup(threads[id] ?? [], backup);
      if (!existing)
        setPersonas((previous) => [
          ...previous,
          { id, name: backup.bot, text: "", password: "", locked: false },
        ]);
      setThreads((previous) => ({ ...previous, [id]: next }));
      reader.stop();
      setPersonaId(id);
      setPersona(existing?.text ?? "");
      setEditingId(null);
      settingsBase.current = null;
      setPendingBotBackup(null);
      setSheet(null);
      setBanner(`${backup.bot} · ${backup.date} 대화 ${backup.turns.length}개를 가져왔습니다.`);
    } catch (error) {
      setDraftNote(error instanceof Error ? error.message : "봇 대화를 가져오지 못했습니다.");
    }
  }

  function syncBotBackups(backups: GrokbotBackup[], assets: PersonaAsset[] = []) {
    let nextPersonas = personas;
    let nextThreads = threads;
    const errors: string[] = [];
    let changed = 0;
    for (const asset of assets) {
      try {
        const existing = findPersonaByName(nextPersonas, asset.bot);
        if (!existing && nextPersonas.length >= 12) throw new Error("페르소나는 최대 12개입니다.");
        const current = existing ?? {
          id: grokbotPersonaId(asset.bot),
          name: asset.bot,
          text: "",
          password: "",
          locked: false,
        };
        const applied = applyPersonaAsset(current, asset);
        if (JSON.stringify(current) !== JSON.stringify(applied)) {
          nextPersonas = existing
            ? nextPersonas.map((item) => (item.id === current.id ? applied : item))
            : [...nextPersonas, applied];
          if (settingsBase.current) {
            const prior = settingsBase.current.personas.find((item) => item.id === current.id);
            if (prior)
              settingsBase.current.personas = settingsBase.current.personas.map((item) =>
                item.id === current.id ? applyPersonaAsset(item, asset) : item,
              );
            else settingsBase.current.personas.push({ ...applied });
          }
          changed++;
        }
      } catch (error) {
        errors.push(
          `${asset.bot}: ${error instanceof Error ? error.message : "기억·템플릿 반영 실패"}`,
        );
      }
    }
    for (const backup of backups) {
      try {
        const id = findPersonaByName(nextPersonas, backup.bot)?.id ?? grokbotPersonaId(backup.bot);
        const missing = !nextPersonas.some((item) => item.id === id);
        if (missing) {
          if (nextPersonas.length >= 12) throw new Error("페르소나는 최대 12개입니다.");
        }
        if (personaId === id && (reader.status === "playing" || editingId || asking)) {
          throw new Error("읽기·수정·답변 중인 대화입니다. 끝난 뒤 다음 확인 때 가져옵니다.");
        }
        const current = nextThreads[id] ?? [];
        const merged = mergeGrokbotBackup(current, backup);
        if (missing) {
          const item = { id, name: backup.bot, text: "", password: "", locked: false };
          nextPersonas = [...nextPersonas, item];
          if (
            settingsBase.current &&
            !settingsBase.current.personas.some((entry) => entry.id === id)
          ) {
            settingsBase.current.personas.push({ ...item });
          }
        }
        if (JSON.stringify(current) !== JSON.stringify(merged)) {
          nextThreads = { ...nextThreads, [id]: merged };
          changed++;
        }
      } catch (error) {
        errors.push(
          `${backup.bot} · ${backup.date}: ${error instanceof Error ? error.message : "반영 실패"}`,
        );
      }
    }
    if (nextPersonas !== personas) setPersonas(nextPersonas);
    if (nextThreads !== threads) setThreads(nextThreads);
    return { changed, errors };
  }
  const dropboxPanel = useDropboxImport(syncBotBackups, hydrated);

  async function loadCloudFile() {
    const openDeviceFile = () => fileRef.current?.click();
    try {
      if (window.parent !== window || !("showOpenFilePicker" in window)) {
        openDeviceFile();
        return;
      }
      const file = await openCloudFile();
      if (file) await loadBackupFile(file);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (
        error instanceof DOMException &&
        (error.name === "SecurityError" || error.name === "NotAllowedError")
      ) {
        openDeviceFile();
        return;
      }
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
    const room = personaIdRef.current;
    const base = threads[room] ?? [];
    const audience = [...groupMembers];
    const history = turnsNow.current
      .filter((turn) => !turn.id.startsWith("s"))
      .slice(-6)
      .map((turn) => ({ role: turn.speaker === "me" ? "user" : "assistant", content: turn.text }));
    const prompt =
      imagePrompt(text, history) +
      "\n요청 문장, 프롬프트, 자막, 말풍선, 워터마크를 이미지에 쓰지 않는다.";
    const sentAt = Date.now();
    const job = ++jobEpoch.current;
    busyRef.current = true;
    setPainting(true);
    setAsking(true);
    setBanner(null);
    try {
      const result = await imagineImage({ data: { prompt } });
      if (job !== jobEpoch.current) return;
      if (!result.ok) {
        setBanner(result.error);
        return;
      }
      const repliedAt = Date.now();
      const stamp = repliedAt.toString(36);
      const caption = "";
      const next = [
        ...base,
        { id: `me-${stamp}`, speaker: "me" as const, text, at: sentAt, audience },
        {
          id: `gk-${stamp}`,
          speaker: "grok" as const,
          text: caption,
          image: result.url,
          mediaDescription: text,
          audience,
          personaId: roomHost,
          personaName: personas.find((p) => p.id === roomHost)?.name,
          at: repliedAt,
        },
      ];
      setComposer("");
      setThreads((prev) => ({ ...prev, [room]: next }));
      if (personaIdRef.current === room) turnsNow.current = next;
    } finally {
      if (job === jobEpoch.current) {
        busyRef.current = false;
        setAsking(false);
        setPainting(false);
      }
    }
  }

  async function film(raw: string) {
    const text = raw.trim();
    if (!text || busyRef.current) return;
    const room = personaIdRef.current;
    const base = threads[room] ?? [];
    const audience = [...groupMembers];
    const history = turnsNow.current
      .filter((turn) => !turn.id.startsWith("s"))
      .slice(-6)
      .map((turn) => ({ role: turn.speaker === "me" ? "user" : "assistant", content: turn.text }));
    const prompt =
      videoPrompt(text, history) + "\n요청 문구를 자막·말풍선·워터마크로 표시하지 않는다.";
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
    const job = ++jobEpoch.current;
    busyRef.current = true;
    setFilming(true);
    setAsking(true);
    setBanner(null);
    try {
      const started = await startVideo({ data: { prompt, seconds, image } });
      if (job !== jobEpoch.current) return;
      if (!started.ok) {
        setBanner(started.error);
        return;
      }
      let url = "";
      for (let i = 0; i < 24; i++) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        if (job !== jobEpoch.current) return;
        const status = await videoStatus({ data: { id: started.id } });
        if (job !== jobEpoch.current) return;
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
        ...base,
        { id: `me-${stamp}`, speaker: "me" as const, text, at: sentAt, audience },
        {
          id: `gk-${stamp}`,
          speaker: "grok" as const,
          text: "",
          video: url,
          mediaDescription: text,
          audience,
          personaId: roomHost,
          personaName: personas.find((p) => p.id === roomHost)?.name,
          at: repliedAt,
        },
      ];
      setComposer("");
      setThreads((prev) => ({ ...prev, [room]: next }));
      if (personaIdRef.current === room) turnsNow.current = next;
    } finally {
      if (job === jobEpoch.current) {
        busyRef.current = false;
        setAsking(false);
        setFilming(false);
      }
    }
  }

  async function ask(spoken?: string, target?: string, fromMail = false) {
    if (deleteAllStage || deletingChats) return;
    let text = (spoken ?? composer).trim();
    if (!text || busyRef.current) return;
    const relay = fromMail ? null : relayCommand(text, personas);
    const membership = fromMail || relay ? null : participantCommand(text, personas);
    if (membership) {
      if (membership.id === roomHost) {
        setBanner("이 방의 기본 페르소나는 초대하거나 내보낼 수 없습니다.");
        setComposer("");
        return;
      }
      await changeParticipants(
        membership.action === "join"
          ? [...groupMembers, membership.id]
          : groupMembers.filter((id) => id !== membership.id),
      );
      return;
    }
    const wakeHit = fromMail ? null : takePersonaWake(text, personas);
    const hit = relay && wakeHit?.id === relay.id ? null : wakeHit;
    if (hit && !target && !(groupMembers.length >= 2 && groupMembers.includes(hit.id))) {
      target = hit.id;
      selectPersona(target);
      text = hit.rest.trim();
      if (!text) {
        void greet(target);
        return;
      }
    }
    const id = target ?? personaIdRef.current;
    const audience = roomMembers[id] ?? (id.startsWith("group:") ? legacyGroupMembers : [id]);
    const active = personas.find((item) => item.id === id);
    if (!fromMail && deleteChat) {
      if (
        /^(응|네|예|그래|확인|삭제해|모두삭제|전체삭제|정말모두삭제)[.!]*$/.test(
          text.replace(/\s+/g, ""),
        )
      ) {
        confirmDeleteChat();
        return;
      }
      if (/취소|아니|삭제하지마/.test(text)) {
        setDeleteChat(null);
        setBanner("삭제를 취소했습니다.");
        return;
      }
      setBanner("전체 대화를 삭제하려면 삭제 확인을 누르거나 '모두 삭제'라고 말하세요.");
      return;
    }
    if (!fromMail && !relay && deleteConversationCommand(text)) {
      if (active) setDeleteChat({ id, name: active.name });
      setComposer("");
      return;
    }
    if (relay) {
      await sendRelay(text, relay, hit?.id ?? active?.id ?? roomHost, id);
      return;
    }
    if (
      !target &&
      groupMembers.length >= 2 &&
      (selectedMediaId || (!wantsImage(text) && !wantsVideo(text)))
    ) {
      await askGroup(text, id, hit?.id);
      return;
    }
    if (!fromMail && musicCommand(text)) {
      setComposer("");
      setSheet("voice");
      setMusicRequest((value) => value + 1);
      return;
    }
    const finishBackup = conversationEnded(text);
    if (!fromMail && !selectedMediaId && wantsVideo(text)) {
      await film(text);
      return;
    }
    if (!fromMail && !selectedMediaId && wantsImage(text)) {
      await paint(text);
      return;
    }
    const job = ++jobEpoch.current;
    busyRef.current = true;
    setAsking(true);
    setBanner(null);
    setComposer("");
    const abort = new AbortController();
    answerAbort.current = abort;
    const sentAt = Date.now();
    const mine: Turn = {
      id: `me-${sentAt.toString(36)}`,
      speaker: "me" as const,
      text,
      at: sentAt,
      audience: [...audience],
      mediaRef: findQuestionMedia(
        [...knownTurns(threads, id), ...(threads[id] ?? [])],
        text,
        selectedMediaId,
      )?.id,
    };
    const withUser = [...(threads[id] ?? []), mine];
    const commit = (next: Turn[]) => {
      setThreads((prev) => ({ ...prev, [id]: next }));
      if (personaIdRef.current === id) turnsNow.current = next;
    };
    commit(withUser);
    try {
      const history = withUser
        .filter((turn) => turn !== mine && !turn.event && !turn.id.startsWith("s"))
        .slice(-4)
        .map((turn) => ({
          role: turn.speaker === "me" ? ("user" as const) : ("assistant" as const),
          content: `${turn.relay ? "[" + turn.relay.fromName + "가 " + turn.relay.toName + "에게 전달한 메시지] " : ""}${turn.text}${turn.image ? " [사진을 보낸 기록]" : ""}${turn.video ? " [영상을 보낸 기록]" : ""}`,
        }));
      const activePersona = personas.find((item) => item.id === id);
      const role = activePersona ? personaInstructions(activePersona) : persona;
      const memory = [
        memoryForQuestion(activePersona?.memories, text, 4000),
        conversationMemory(threads, id, text),
      ]
        .filter(Boolean)
        .join("\n");
      const media = findQuestionMedia(
        [...knownTurns(threads, id), ...withUser],
        text,
        selectedMediaId,
      );
      const image = media?.image;
      const frames = media?.video ? await videoFrames(media.video) : undefined;
      if (job !== jobEpoch.current) return;
      setSelectedMediaId(null);
      const mediaMemory = media
        ? `지금 질문하는 ${media.image ? "사진" : "영상"}: ${media.mediaDescription || "선택한 미디어"}. 보낸 기록이 있다. 보낸 적 없다고 부정하지 않는다.`
        : "";
      const grokId = `gk-${sentAt.toString(36)}`;
      let latestReply: Turn[] = [];
      let speechStarted = false;
      const show = (said: string, done = false) => {
        if (job !== jobEpoch.current) return;
        const next = [
          ...withUser.filter((turn) => turn.id !== mine.id && turn.id !== grokId),
          mine,
          {
            id: grokId,
            speaker: "grok" as const,
            text: said,
            speechParts: speechParts(said, done),
            streaming: !done,
            at: sentAt,
            personaId: id,
            personaName: activePersona?.name,
            voice: activePersona?.voice,
            audience: [...audience],
          },
        ];
        commit(next);
        latestReply = next;
        if (!speechStarted && next.at(-1)?.speechParts?.length && personaIdRef.current === id) {
          speechStarted = true;
          reader.playFrom(next, next.length - 1);
        }
      };
      let result: { ok: true; text: string } | { ok: false; error: string };
      try {
        result = await streamAsk(
          {
            message: text,
            history,
            persona: role,
            memory: [memory, mediaMemory].filter(Boolean).join("\n"),
            image,
            frames,
          },
          (said) => show(said),
          abort.signal,
        );
      } catch {
        result = { ok: false, error: "그록에게 연결하지 못했습니다." };
      }
      if (job !== jobEpoch.current) return;
      if (!result.ok && speechStarted) {
        reader.stop();
        show(latestReply.at(-1)?.text ?? "", true);
        setBanner(`${result.error} 답변이 중간에 끊겼습니다.`);
        return;
      }
      if (!result.ok) {
        const again = await askGrok({
          data: {
            message: text,
            history,
            persona: role,
            memory: [memory, mediaMemory].filter(Boolean).join("\n"),
            image,
            frames,
          },
        });
        if (job !== jobEpoch.current) return;
        if (!again.ok) {
          setBanner(again.error);
          return;
        }
        show(again.text, true);
      } else {
        show(result.text, true);
      }
    } catch (error) {
      if (job === jobEpoch.current)
        setBanner(error instanceof Error ? error.message : "선택한 미디어를 읽지 못했습니다.");
    } finally {
      if (job === jobEpoch.current) {
        busyRef.current = false;
        setAsking(false);
        if (finishBackup) voiceBackup.trigger([id]);
      }
    }
  }
  askRef.current = ask;
  wakeHandler.current = (rest, id) => {
    if (filterAnnouncements && isAnnouncement(rest, announcementLines)) {
      setBanner("안내 문장을 무시했습니다.");
      return;
    }
    selectPersona(id);
    const follow = rest.trim();
    setComposer("");
    if (follow) {
      void ask(follow, id);
      return;
    }
    void greet(id);
  };

  async function greet(target = personaIdRef.current) {
    if (busyRef.current) return;
    const job = ++jobEpoch.current;
    busyRef.current = true;
    setAsking(true);
    const item = personas.find((persona) => persona.id === target);
    const tone = item?.text ?? personaRef.current;
    const name = item?.name || "그록";
    let line = fallbackGreet(tone);
    try {
      const result = await Promise.race([
        askGrok({
          data: {
            message: `${name}를 불렀다. 번호 ${Math.floor(Math.random() * 1000)}.`,
            history: [],
            persona: personaInstructions(item ?? { name, text: tone }),
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
    if (job !== jobEpoch.current) return;
    const at = Date.now();
    const next = [
      ...(threads[target] ?? []),
      {
        id: `gk-${at.toString(36)}`,
        speaker: "grok" as const,
        text: line,
        at,
        personaId: target,
        personaName: name,
        voice: item?.voice,
      },
    ];
    setThreads((prev) => ({ ...prev, [target]: next }));
    if (personaIdRef.current === target) reader.playFrom(next, next.length - 1);
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
      voiceOnly,
      requireVoiceName,
      filterAnnouncements,
      announcementLines,
      autoReply,
      silence,
      wakeOn,
      wakeIdleSeconds,
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
    setVoiceOnly(snap.voiceOnly);
    setRequireVoiceName(snap.requireVoiceName);
    setFilterAnnouncements(snap.filterAnnouncements);
    setAnnouncementLines(snap.announcementLines);
    setAutoReply(snap.autoReply);
    setSilence(snap.silence);
    setWakeOn(snap.wakeOn);
    setWakeIdleSeconds(snap.wakeIdleSeconds);
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
    setVoiceOnly(true);
    setRequireVoiceName(false);
    setFilterAnnouncements(true);
    setAnnouncementLines(DEFAULT_ANNOUNCEMENTS);
    setAutoReply(true);
    setSilence(2);
    setWakeOn(false);
    setWakeIdleSeconds(10);
    wake.halt();
    const plain = personas.find((item) => item.name === "아라") ?? STARTER_PERSONAS[0];
    setPersonaId(plain.id);
    setPersona(plain.text);
  }

  function updateTurn(id: string, text: string) {
    setTurns((prev) =>
      prev.map((t) => (t.id === id ? { ...t, text, streaming: false, speechParts: undefined } : t)),
    );
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
    personaIdRef.current = item.id;
    turnsNow.current = threads[item.id] ?? [];
    setPersonaId(item.id);
    setPersona(item.text);
    setNewPersona(null);
    setEditingId(null);
    setSelectedMediaId(null);
  }

  async function confirmDeleteChat() {
    if (!deleteChat || busyRef.current || voiceBackup.saving) return;
    const id = deleteChat.id;
    reader.stop();
    dictation.stop();
    busyRef.current = true;
    setDeletingChats(true);
    try {
      await deleteVoiceMails(id);
    } catch {
      setBanner(
        "음성 메일 삭제에 실패했습니다. 대화를 삭제하지 않았습니다. 저장소를 확인하고 다시 시도하세요.",
      );
      busyRef.current = false;
      setDeletingChats(false);
      return;
    }
    voiceBackup.forget(id);
    setThreads((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([key, list]) => [
          key,
          key === id || key === relayMemoryKey(id)
            ? []
            : list.filter((turn) => turn.personaId !== id),
        ]),
      ),
    );
    if (personaIdRef.current === id) turnsNow.current = [];
    try {
      for (const key of [STORAGE_KEY, LOCAL_BACKUP_KEY]) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const saved = JSON.parse(raw);
        if (saved.threads)
          saved.threads = Object.fromEntries(
            Object.entries(saved.threads).map(([thread, list]) => [
              thread,
              thread === id || thread === relayMemoryKey(id)
                ? []
                : (list as Turn[]).filter((turn) => turn.personaId !== id),
            ]),
          );
        if (saved.personaId === id) saved.turns = [];
        if (Array.isArray(saved.personas))
          saved.personas = saved.personas.map((item: PersonaItem) =>
            item.id === id
              ? {
                  ...item,
                  memories: item.memories?.filter(
                    (memory) => memory.source !== "voicegrok/memory.md",
                  ),
                }
              : item,
          );
        localStorage.setItem(key, JSON.stringify(saved));
      }
    } catch {
      setBanner("대화는 삭제했지만 내부 백업 갱신에 실패했습니다.");
    }
    setPersonas((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              memories: item.memories?.filter((memory) => memory.source !== "voicegrok/memory.md"),
            }
          : item,
      ),
    );
    setDeleteChat(null);
    setEditingId(null);
    setComposer("");
    setBanner(
      `${deleteChat.name}의 전체 대화와 보이스 메일을 삭제했습니다. Dropbox에 이미 저장된 파일은 유지됩니다.`,
    );
    busyRef.current = false;
    setDeletingChats(false);
  }

  async function askGroup(text: string, room: string, addressed?: string) {
    const members = groupMembers
      .map((id) => personas.find((item) => item.id === id))
      .filter((p): p is PersonaItem => Boolean(p));
    if (members.length < 2) return;
    const job = ++jobEpoch.current;
    busyRef.current = true;
    setAsking(true);
    const abort = new AbortController();
    answerAbort.current = abort;
    setComposer("");
    reader.stop();
    const at = Date.now();
    const mine: Turn = {
      id: `me-${at.toString(36)}`,
      speaker: "me",
      text,
      at,
      audience: [...groupMembers],
      mediaRef: findQuestionMedia(threads[room] ?? [], text, selectedMediaId)?.id,
    };
    const current = [...(threads[room] ?? []), mine];
    setThreads((prev) => ({ ...prev, [room]: current }));
    try {
      const shared = current
        .filter((turn) => !turn.event)
        .slice(-12)
        .map(turnRecord)
        .join("\n");
      const media = findQuestionMedia(
        [...knownTurns(threads, addressed ?? room), ...current],
        text,
        selectedMediaId,
      );
      mine.mediaRef = media?.id;
      const frames = media?.video ? await videoFrames(media.video) : undefined;
      if (job !== jobEpoch.current) return;
      setSelectedMediaId(null);
      const speakers = members.filter((member) => !addressed || member.id === addressed);
      const answers: Turn[] = speakers.map((member) => ({
        id: `gk-${at.toString(36)}-${member.id}`,
        speaker: "grok",
        text: "",
        speechParts: [],
        streaming: true,
        at,
        personaId: member.id,
        personaName: member.name,
        voice: member.voice,
        audience: [...groupMembers],
      }));
      let started = false;
      const publish = () => {
        if (job !== jobEpoch.current) return;
        const next = [...current, ...answers.map((answer) => ({ ...answer }))];
        setThreads((prev) => ({ ...prev, [room]: next }));
        if (personaIdRef.current === room) {
          turnsNow.current = next;
          if (!started && answers[0]?.speechParts?.length) {
            started = true;
            reader.playFrom(next, current.length);
          }
        }
      };
      publish();
      const replies = await Promise.all(
        speakers.map(async (member, index) => {
          const update = (text: string, done = false) => {
            answers[index] = {
              ...answers[index],
              text,
              speechParts: speechParts(text, done),
              streaming: !done,
            };
            publish();
          };
          const result = await streamAsk(
            {
              message: text,
              history: [],
              persona: `${personaInstructions(member)}\n함께 대화하는 사람: ${members.map((item) => item.name).join(", ")}. 반드시 ${member.name} 한 사람의 입장에서만 답한다.`,
              memory:
                `${memoryForQuestion(member.memories, text, 3000)}\n본인이 나눈 과거 대화:\n${conversationMemory(threads, member.id, text)}\n현재 방 대화:\n${shared}`.slice(
                  0,
                  12000,
                ),
              image: media?.image,
              frames,
            },
            (said) => update(said),
            abort.signal,
          ).catch(() => ({ ok: false as const, error: "그록에게 연결하지 못했습니다." }));
          if (job === jobEpoch.current) update(result.ok ? result.text : answers[index].text, true);
          return { member, result };
        }),
      );
      if (job !== jobEpoch.current) return;
      const errors = replies
        .filter((reply) => !reply.result.ok)
        .map((reply) => `${reply.member.name}: ${reply.result.ok ? "" : reply.result.error}`);
      if (errors.length) setBanner(errors.join(" · "));
      if (!started && personaIdRef.current === room && answers.some((answer) => answer.text))
        reader.playFrom([...current, ...answers], current.length);
    } catch (error) {
      if (job === jobEpoch.current)
        setBanner(error instanceof Error ? error.message : "답변을 받지 못했습니다.");
    } finally {
      if (job === jobEpoch.current) {
        busyRef.current = false;
        setAsking(false);
        if (conversationEnded(text)) voiceBackup.trigger(members.map((item) => item.id));
      }
    }
  }

  async function sendRelay(
    raw: string,
    command: { id: string; message: string },
    senderId: string,
    room: string,
  ) {
    const from = personas.find((p) => p.id === senderId);
    const to = personas.find((p) => p.id === command.id);
    if (!from || !to) return;
    if (from.id === to.id) {
      setBanner("다른 페르소나를 전달 대상으로 골라 주세요.");
      return;
    }
    const media =
      findQuestionMedia(threads[room] ?? [], command.message, selectedMediaId) ??
      findQuestionMedia(knownTurns(threads, from.id), command.message, selectedMediaId);
    if (/사진|이미지|그림|셀카|영상|동영상/.test(command.message) && !media) {
      setBanner("전달할 사진·영상이 없습니다. 미디어를 먼저 선택해 주세요.");
      return;
    }
    if (!command.message.trim() && !media) {
      setBanner("전달할 내용을 적거나 사진·영상을 선택해 주세요.");
      return;
    }
    const job = ++jobEpoch.current;
    const abort = new AbortController();
    answerAbort.current = abort;
    busyRef.current = true;
    setAsking(true);
    reader.stop();
    setComposer("");
    setBanner(null);
    const audience = roomMembers[room] ?? (room.startsWith("group:") ? legacyGroupMembers : [room]);
    const at = Date.now();
    const mine: Turn = {
      id: `me-${at.toString(36)}`,
      speaker: "me",
      text: raw,
      at,
      audience,
      mediaRef: media?.id,
    };
    setThreads((prev) => ({ ...prev, [room]: [...(prev[room] ?? []), mine] }));
    try {
      const result = await streamAsk(
        {
          message: `사용자가 ${to.name}에게 내용을 전해 달라고 요청했다. 실제로 전달될 말만 네 성격·말투로 작성해라. 수신인 ${to.name}에게 직접 말하는 형식이다. '전달했어' 같은 완료 보고는 쓰지 않는다. 이름, 날짜, 숫자, 부정 표현과 핵심 의미를 바꾸거나 사실을 덧붙이지 않는다. 기록을 참고해야 하는 요청이면 관련 기록을 먼저 참고한다. 요청: ${command.message || "선택한 미디어를 전달해줘"}${media ? "\n함께 전달하는 미디어: " + (media.mediaDescription || (media.video ? "선택한 영상" : "선택한 사진")) + ". 화면을 직접 분석한 것처럼 묘사하지 말고 함께 보낸다고 짧게 말한다." : ""}`,
          history: [],
          persona: personaInstructions(from),
          memory: [
            conversationMemory(threads, from.id, command.message),
            "현재 방의 최근 대화:\n" +
              (threads[room] ?? [])
                .filter((t) => !t.event)
                .slice(-8)
                .map(turnRecord)
                .join("\n"),
          ]
            .join("\n")
            .slice(0, 12000),
        },
        () => {},
        abort.signal,
      );
      if (job !== jobEpoch.current) return;
      if (!result.ok) {
        setBanner("전달하지 못했습니다. " + result.error);
        return;
      }
      const { incoming, receipt } = relayDelivery({
        from,
        to,
        request: raw,
        payload: result.text,
        media,
        at: Date.now(),
        sourceAudience: audience,
        targetAudience: roomMembers[to.id] ?? [to.id],
      });
      setThreads((prev) => storeRelay(prev, room, { incoming, receipt }));
      setSelectedMediaId(null);
      setBanner(receipt.text);
    } catch (error) {
      if (job === jobEpoch.current)
        setBanner(
          "전달하지 못했습니다. " +
            (error instanceof Error ? error.message : "연결을 확인해 주세요."),
        );
    } finally {
      if (job === jobEpoch.current) {
        busyRef.current = false;
        setAsking(false);
      }
    }
  }

  async function changeParticipants(requested: string[]) {
    if (busyRef.current) return;
    if (new Set([roomHost, ...requested]).size > 6) {
      setBanner("함께 대화할 페르소나를 1~6명 선택하세요.");
      return;
    }
    const room = personaIdRef.current;
    const changes = roomChanges(roomHost, groupMembers, requested);
    if (!changes.joined.length && !changes.left.length) {
      setBanner("참여자 변경이 없습니다.");
      setGroupSetup(false);
      return;
    }
    const job = ++jobEpoch.current;
    const abort = new AbortController();
    answerAbort.current = abort;
    busyRef.current = true;
    setAsking(true);
    reader.stop();
    setComposer("");
    setGroupSetup(false);
    const transitions = [
      ...changes.left.map((id) => ({ id, action: "leave" as const })),
      ...changes.joined.map((id) => ({ id, action: "join" as const })),
    ];
    // Commit membership and notices immediately; optional greetings cannot block a join/leave.
    setRoomMembers((prev) => ({ ...prev, [room]: changes.members }));
    const at = Date.now();
    const notices: Turn[] = transitions.map(({ id, action }, i) => ({
      id: `event-${at.toString(36)}-${i}`,
      speaker: "grok",
      event: action,
      textOnly: true,
      personaId: id,
      personaName: personas.find((p) => p.id === id)?.name,
      audience: [...new Set([...groupMembers, ...changes.members])],
      text: `${personas.find((p) => p.id === id)?.name || "페르소나"} 님이 ${personas.find((p) => p.id === roomHost)?.name || "기본 페르소나"} 방${action === "join" ? "에 초대되어 들어왔습니다" : "에서 나갔습니다"}.`,
      at,
    }));
    const current = [...(threads[room] ?? []), ...notices];
    setThreads((prev) => ({ ...prev, [room]: current }));
    turnsNow.current = current;
    try {
      const lines = await Promise.all(
        transitions.map(async ({ id, action }, i) => {
          const person = personas.find((p) => p.id === id);
          if (!person || Math.random() >= 0.5) return null;
          const result = await streamAsk(
            {
              message:
                action === "join"
                  ? "다른 페르소나의 대화방에 방금 초대받았다. 네 성격에 맞게 짧게 인사하거나 왜 불렀는지 물어봐."
                  : "이 대화방에서 이제 나간다. 네 성격에 맞게 짧게 작별 인사를 해줘.",
              history: [],
              persona: personaInstructions(person),
            },
            () => {},
            abort.signal,
          ).catch(() => ({ ok: false as const, error: "" }));
          if (!result.ok) return null;
          return {
            id: `greeting-${at.toString(36)}-${i}`,
            speaker: "grok" as const,
            text: result.text,
            at,
            personaId: id,
            personaName: person.name,
            voice: person.voice,
            audience: [...new Set([...groupMembers, ...changes.members])],
          };
        }),
      );
      if (job !== jobEpoch.current) return;
      const ordered = transitions.flatMap(({ action }, i) =>
        lines[i]
          ? action === "leave"
            ? [lines[i]!, notices[i]]
            : [notices[i], lines[i]!]
          : [notices[i]],
      );
      const next = [...current.slice(0, -notices.length), ...ordered];
      setThreads((prev) => ({ ...prev, [room]: next }));
      if (personaIdRef.current === room) {
        turnsNow.current = next;
        if (lines.some(Boolean)) reader.playFrom(next, next.length - ordered.length);
      }
    } finally {
      if (job === jobEpoch.current) {
        busyRef.current = false;
        setAsking(false);
      }
    }
  }

  async function confirmDeleteAll() {
    if (
      deleteAllStage !== 2 ||
      busyRef.current ||
      asking ||
      painting ||
      filming ||
      voiceBackup.saving
    )
      return;
    reader.stop();
    dictation.stop();
    busyRef.current = true;
    setDeletingChats(true);
    try {
      await deleteVoiceMails();
    } catch {
      setBanner(
        "보이스 메일 삭제에 실패했습니다. 대화를 삭제하지 않았습니다. 저장소를 확인하고 다시 시도하세요.",
      );
      busyRef.current = false;
      setDeletingChats(false);
      return;
    }
    for (const item of personas) voiceBackup.forget(item.id);
    const clean = personas.map((item) => ({
      ...item,
      memories: item.memories?.filter((memory) => memory.source !== "voicegrok/memory.md"),
    }));
    setThreads({});
    setRoomMembers({});
    setPersonas(clean);
    turnsNow.current = [];
    if (settingsBase.current) settingsBase.current.personas = clean;
    setComposer("");
    setDeleteChat(null);
    setDeleteAllStage(0);
    setEditingId(null);
    setDraft("");
    setExportText(null);
    try {
      for (const key of [STORAGE_KEY, LOCAL_BACKUP_KEY]) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const saved = JSON.parse(raw);
        saved.threads = {};
        saved.turns = [];
        saved.personas = clean;
        localStorage.setItem(key, JSON.stringify(saved));
      }
      localStorage.removeItem("voice-grok-summary-receipts");
      setBanner(
        "이 기기의 모든 페르소나·단체 대화와 보이스 메일을 삭제했습니다. Dropbox 파일과 외부 기억은 유지됩니다.",
      );
    } catch {
      setBanner("화면의 대화는 삭제했지만 기기 백업 갱신에 실패했습니다. 저장소를 확인하세요.");
    }
    busyRef.current = false;
    setDeletingChats(false);
  }

  function playLatest() {
    reader.prime();
    if (reader.status === "playing") {
      reader.pause();
      return;
    }
    let index = turns.length - 1;
    while (
      index >= 0 &&
      (turns[index].speaker !== "grok" || turns[index].event || !turns[index].text)
    )
      index--;
    if (index >= 0) reader.playOne(index);
  }
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileNote, setProfileNote] = useState("");
  async function setProfile(file: Blob) {
    const id = personaId;
    try {
      const photo = await profileImage(file);
      setPersonas((items) =>
        items.map((item) => (item.id === id ? { ...item, photo, showAvatar: true } : item)),
      );
      setProfileNote("프로필 사진을 적용했습니다.");
    } catch (error) {
      setProfileNote(error instanceof Error ? error.message : "사진을 읽지 못했습니다.");
    }
  }
  async function profileCloud(upload: boolean) {
    const item = personas.find((item) => item.id === personaId);
    if (!item) return;
    setProfileBusy(true);
    setProfileNote("");
    try {
      const client = getDropboxClient();
      let done = 0;
      const failures: string[] = [];
      for (const persona of personas) {
        if (upload && !persona.photo) continue;
        try {
          if (upload) {
            const blob = await (await fetch(persona.photo!)).blob();
            await client.uploadProfile(persona.name, blob);
          } else {
            const photo = await profileImage(await client.downloadProfile(persona.name));
            setPersonas((items) =>
              items.map((p) => (p.id === persona.id ? { ...p, photo, showAvatar: true } : p)),
            );
          }
          done++;
        } catch {
          failures.push(persona.name);
        }
      }
      setProfileNote(
        `전체 페르소나 사진 ${upload ? "백업" : "불러오기"}: ${done}개 완료${failures.length ? " · 실패: " + failures.join(", ") : ""}`,
      );
    } catch (error) {
      setProfileNote(error instanceof Error ? error.message : "Dropbox 사진 처리에 실패했습니다.");
    } finally {
      setProfileBusy(false);
    }
  }
  const selectedPersona = personas.find((item) => item.id === personaId) ?? personas[0];

  function updatePersona(
    patch: Partial<Pick<PersonaItem, "name" | "text" | "photo" | "showBackground" | "showAvatar">>,
  ) {
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

  async function finishDelete() {
    if (!selectedPersona || selectedPersona.locked || busyRef.current) return;
    if (erasePassword.trim() !== selectedPersona.password.trim()) {
      setBanner("비밀번호가 맞지 않아 지우지 않았습니다.");
      return;
    }
    const next = personas.filter((item) => item.id !== selectedPersona.id);
    const fallback = next[0];
    if (!fallback) return;
    busyRef.current = true;
    setDeletingChats(true);
    try {
      await deleteVoiceMails(selectedPersona.id);
    } catch {
      setBanner("보이스 메일 삭제에 실패해 페르소나를 삭제하지 않았습니다.");
      busyRef.current = false;
      setDeletingChats(false);
      return;
    }
    setPersonas(next);
    setThreads((prev) => {
      const copy = { ...prev };
      delete copy[selectedPersona.id];
      delete copy[relayMemoryKey(selectedPersona.id)];
      return copy;
    });
    setPersonaId(fallback.id);
    setPersona(fallback.text);
    setEraseStep(0);
    setErasePassword("");
    setBanner(null);
    busyRef.current = false;
    setDeletingChats(false);
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
            <p className="mt-1 truncate text-sm text-muted">
              {groupMembers.length >= 2
                ? `${groupMembers
                    .map((id) => personas.find((item) => item.id === id)?.name)
                    .filter(Boolean)
                    .join(" · ")} 함께 대화`
                : topicWith(personaName || "그록")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <MailNotifications
              onOpen={(id) => {
                reader.stop();
                dictation.stop();
                selectPersona(id);
                setMailboxOpen(true);
              }}
            />
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
                style={
                  on ? { backgroundColor: personaColor(item.name), color: "#161310" } : undefined
                }
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

      <main
        ref={scrollerRef}
        className="min-h-0 flex-1 overflow-y-auto bg-cover bg-center px-4 py-4"
        style={
          selectedPersona?.photo && selectedPersona.showBackground !== false
            ? {
                backgroundImage: `linear-gradient(#151310b8,#151310b8),url("${selectedPersona.photo}")`,
              }
            : undefined
        }
      >
        {voiceBackup.note ? (
          <p role="status" className="mb-3 text-sm text-muted">
            {voiceBackup.note}
          </p>
        ) : null}
        {banner ? (
          <p role="status" className="mb-3 text-sm text-pretty text-muted">
            {banner}
          </p>
        ) : null}
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-start justify-center gap-4">
            <p className="font-display text-3xl text-balance text-fg">
              {personaName || "그록"}에게 물어보세요
            </p>
            <p className="max-w-sm text-pretty text-muted">
              답을 붙이지 않아도, 그록이 말한 뒤 그 목소리로 바로 읽어 줍니다.
            </p>
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
                    if (turn.event)
                      return (
                        <li key={turn.id} id={`turn-${turn.id}`}>
                          <p role="status" className="py-2 text-center text-sm text-muted">
                            {turn.text}
                          </p>
                        </li>
                      );
                    const playing = reader.status !== "idle" && index === reader.turnIndex && !done;
                    const chunks = chunkText(turn.text);
                    const mine = turn.speaker === "me";
                    const owner =
                      personas.find(
                        (p) => p.id === turn.personaId || p.name === turn.personaName,
                      ) ?? selectedPersona;
                    const color = personaColor(owner?.name ?? personaName);
                    const whenAt = turnTime(turn);
                    const when = whenAt === null ? "" : formatWhen(whenAt);
                    return (
                      <li
                        id={`turn-${turn.id}`}
                        key={turn.id}
                        className={mine ? "flex justify-end" : "flex justify-start"}
                      >
                        <article
                          style={
                            mine
                              ? {
                                  backgroundColor: personaColor(personaName),
                                  borderColor: personaColor(personaName),
                                  color: "#161310",
                                }
                              : {
                                  backgroundColor: `color-mix(in srgb, ${color} 20%, #171512)`,
                                  borderColor: `${color}80`,
                                }
                          }
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
                              style={!mine ? { color } : undefined}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (voiceOnly && !mine && !turn.textOnly) reader.playOne(index);
                                else reader.jump(index);
                              }}
                            >
                              {playing && reader.status === "playing" && !reader.preparing ? (
                                <Equalizer />
                              ) : null}
                              {!mine && owner?.photo && owner.showAvatar !== false ? (
                                <img
                                  src={owner.photo}
                                  alt=""
                                  className="size-8 rounded-full object-cover"
                                />
                              ) : null}
                              {turn.speaker === "me"
                                ? "나"
                                : turn.personaName || personaName || "그록"}
                              <span className={mine ? "text-ink/70" : "text-faint"}>
                                {index + 1}
                              </span>
                            </button>
                            <span className="flex items-center gap-1">
                              <button
                                type="button"
                                aria-label="이 말 수정"
                                hidden={voiceOnly && !mine && !turn.textOnly}
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
                          {!turn.text && (turn.image || turn.video) ? null : voiceOnly &&
                            !mine &&
                            !turn.textOnly ? (
                            <div className="space-y-2">
                              <button
                                type="button"
                                aria-label={`${turn.personaName || personaName || "그록"} 음성 메시지 ${index + 1} ${playing && reader.status === "playing" ? "일시정지" : "재생"}`}
                                disabled={!reader.supported || !turn.text.trim()}
                                className="flex min-h-12 w-full items-center gap-3 rounded-full border border-line bg-surface px-4 text-left text-sm"
                                onClick={() => {
                                  reader.prime();
                                  if (playing && reader.status === "playing") reader.pause();
                                  else reader.playOne(index);
                                }}
                              >
                                {playing && reader.status === "playing" ? (
                                  <Pause className="size-5 shrink-0" aria-hidden="true" />
                                ) : (
                                  <Play className="size-5 shrink-0" aria-hidden="true" />
                                )}
                                <span className="flex-1">
                                  {playing && reader.preparing
                                    ? "음성 준비 중"
                                    : playing && reader.status === "playing"
                                      ? "음성 재생 중"
                                      : playing && reader.status === "paused"
                                        ? "음성 메시지 이어 듣기"
                                        : "음성 메시지 재생"}
                                </span>
                                <span className="shrink-0 text-xs text-muted">
                                  {formatDuration(readingSeconds([turn], rate))}
                                </span>
                              </button>
                              {playing && reader.error ? (
                                <p role="status" className="text-xs text-muted">
                                  {reader.error} 재생 버튼으로 다시 시도하세요.
                                </p>
                              ) : null}
                            </div>
                          ) : editingId === turn.id ? (
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
                              alt={
                                voiceOnly && !mine && !turn.textOnly
                                  ? "페르소나가 보낸 이미지"
                                  : turn.text
                              }
                              className="mt-3 w-full rounded-2xl bg-bg"
                            />
                          ) : null}
                          {turn.image || turn.video ? (
                            <button
                              type="button"
                              aria-pressed={selectedMediaId === turn.id}
                              className="mt-2 min-h-11 rounded-full border border-line px-3 text-sm text-fg"
                              onClick={() => {
                                setSelectedMediaId(turn.id);
                                setComposer(`이 ${turn.video ? "영상" : "사진"} 설명해줘`);
                              }}
                            >
                              {selectedMediaId === turn.id
                                ? "질문할 미디어로 선택됨"
                                : `이 ${turn.video ? "영상" : "사진"}에 대해 질문`}
                            </button>
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
        {selectedMediaId ? (
          <div className="mb-2 flex items-center justify-between gap-2 text-sm text-fg">
            <span>
              선택한 {turns.find((t) => t.id === selectedMediaId)?.video ? "영상" : "사진"}에
              질문합니다.
            </span>
            <button
              type="button"
              className="min-h-11 rounded-full border border-line px-3"
              onClick={() => setSelectedMediaId(null)}
            >
              선택 해제
            </button>
          </div>
        ) : null}
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
        {voiceInputNote ? (
          <p className="mb-2 text-sm text-primary" role="status">
            {voiceInputNote}
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
            type={
              asking || painting || filming || reader.status === "playing" || reader.preparing
                ? "button"
                : "submit"
            }
            onClick={() => {
              if (asking || painting || filming || reader.status === "playing" || reader.preparing)
                stopActivity();
            }}
            disabled={
              !asking &&
              !painting &&
              !filming &&
              reader.status !== "playing" &&
              !reader.preparing &&
              !composer.trim()
            }
            className="h-11 shrink-0 rounded-full bg-primary px-4 text-sm font-medium text-ink disabled:opacity-40"
          >
            {asking || painting || filming || reader.status === "playing" || reader.preparing
              ? "멈춤"
              : "듣기"}
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
                aria-label={reader.status === "playing" ? "일시정지" : "마지막 페르소나 답변 재생"}
                className="inline-flex size-11 items-center justify-center rounded-full border border-line text-fg disabled:opacity-40"
                onClick={() => {
                  reader.prime();
                  playLatest();
                }}
                disabled={!reader.supported || !turns.some((turn) => turn.speaker === "grok")}
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
              aria-label={
                dictation.armed
                  ? "받아쓰기 끄기"
                  : wakeOn
                    ? "이름 호출 대기 시작"
                    : "음성으로 말하기"
              }
              aria-pressed={dictation.armed}
              onClick={() => {
                reader.prime();
                if (dictation.armed && wakeOn) dictation.stop();
                else {
                  wakeSessionRef.current = false;
                  setWakeSession(false);
                  dictation.toggle();
                }
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
                {dropboxPanel}
                <section className="flex flex-col gap-3 rounded-2xl border border-line bg-bg p-3">
                  <h3 className="text-base font-medium text-fg">Dropbox 대화 종료 요약 백업</h3>
                  <label className="flex min-h-11 items-center justify-between text-sm text-fg">
                    자동 요약 백업
                    <input
                      type="checkbox"
                      checked={voiceBackup.enabled}
                      onChange={(event) => voiceBackup.setEnabled(event.target.checked)}
                    />
                  </label>
                  <p className="text-sm text-muted">
                    종료·작별·도착·백업 요청을 말하거나 마지막 대화 후 30분이 지나면
                    /Grok/voicegrok/페르소나 이름에 요약 MD를 저장합니다. 변경이 없으면 저장하지
                    않습니다. 앱이 열려 있어야 실행됩니다.
                  </p>
                  <p className="text-sm text-muted">
                    Dropbox 콘솔 Permissions에서 files.content.write를 켜고 Submit한 뒤 아래
                    버튼으로 다시 연결하세요.
                  </p>
                  <button
                    type="button"
                    className="min-h-11 rounded-full border border-line text-sm text-fg"
                    onClick={() => void voiceBackup.connect()}
                  >
                    Dropbox 백업 쓰기 권한 연결
                  </button>
                  {voiceBackup.note ? (
                    <p role="status" className="text-sm text-muted">
                      {voiceBackup.note}
                    </p>
                  ) : null}
                </section>
                <details className="rounded-2xl border border-line bg-bg p-3 text-sm text-muted">
                  <summary className="min-h-11 text-fg">요약 기억·성격 템플릿 파일 형식</summary>
                  <p className="mb-2">
                    요약 MD는 봇 폴더의 memories 안에, 템플릿 JSON은 templates 안에 저장하세요.
                    파일명은 2026-10-03_23-00-00_아라_summary.md와
                    2026-10-03_23-00-00_아라_template.json처럼 날짜·시·분·초를 넣습니다. bot은
                    페르소나 이름과 맞춥니다.
                  </p>
                  <pre className="overflow-auto whitespace-pre-wrap break-words">
                    {
                      "---\nbot: 아라\n---\n# 대화 요약\n- 사용자의 취향과 중요한 약속\n- 둘이 나눈 주요 이야기\n- 기록 날짜와 변경된 사실"
                    }
                  </pre>
                  <p className="mt-3">
                    JSON은 name(이름), description(설명), profile(프로필), rules(룰), skills(스킬),
                    routines(루틴)을 지원합니다. 이름은 profile 안에 넣어도 됩니다. system_prompt가
                    있으면 함께 적용합니다. 템플릿은 60,000자까지 지원합니다. 스킬과 루틴은 답변
                    지침이며 자동 실행 예약은 아닙니다.
                  </p>
                  <a
                    className="mt-2 flex min-h-11 items-center text-primary underline"
                    href="/examples/persona-template.json"
                    download={personaTemplateFilename("아라")}
                  >
                    페르소나 JSON 예시 받기
                  </a>
                </details>
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
                {pendingPersonaAsset ? (
                  <div className="flex flex-col gap-2 rounded-2xl border border-line bg-bg p-3">
                    <p className="text-sm text-fg">
                      {pendingPersonaAsset.bot} ·{" "}
                      {pendingPersonaAsset.kind === "memory" ? "요약 기억" : "성격 템플릿"} ·{" "}
                      {pendingPersonaAsset.content.length}자
                    </p>
                    <p className="text-sm text-muted">
                      같은 이름의 페르소나에 적용합니다. 없으면 생성합니다. 기억과 설정은 답변을
                      생성할 때 참고합니다.
                    </p>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-sm text-muted">
                      {pendingPersonaAsset.content}
                    </pre>
                    <button
                      type="button"
                      className="h-11 rounded-full bg-primary text-sm text-ink"
                      onClick={() => {
                        const result = syncBotBackups([], [pendingPersonaAsset]);
                        if (result.errors.length) {
                          setDraftNote(result.errors.join(" · "));
                          return;
                        }
                        setBanner(
                          `${pendingPersonaAsset.bot}에 ${pendingPersonaAsset.kind === "memory" ? "요약 기억" : "템플릿"}을 적용했습니다.`,
                        );
                        setPendingPersonaAsset(null);
                      }}
                    >
                      같은 이름의 페르소나에 적용
                    </button>
                    <button
                      type="button"
                      className="h-11 rounded-full border border-line text-sm text-fg"
                      onClick={() => setPendingPersonaAsset(null)}
                    >
                      취소
                    </button>
                  </div>
                ) : null}
                {pendingBotBackup ? (
                  <div className="flex flex-col gap-2 rounded-2xl border border-line bg-bg p-3">
                    <p className="text-sm text-fg">
                      {pendingBotBackup.bot} · {pendingBotBackup.date} · 대화{" "}
                      {pendingBotBackup.turns.length}개
                    </p>
                    <p className="text-sm text-muted">
                      봇 전용 페르소나로 가져옵니다. 같은 날짜의 봇 백업은 갱신하고, 다른 날짜와
                      앱에서 나눈 대화는 유지합니다.
                    </p>
                    <button
                      type="button"
                      className="h-11 rounded-full bg-primary text-sm text-ink"
                      onClick={importBotBackup}
                    >
                      이 봇의 페르소나로 가져오기
                    </button>
                    <button
                      type="button"
                      className="h-11 rounded-full border border-line text-sm text-fg"
                      onClick={() => setPendingBotBackup(null)}
                    >
                      취소
                    </button>
                  </div>
                ) : null}
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
                  <details className="rounded-2xl border border-line p-3">
                    <summary className="min-h-11 cursor-pointer py-3 font-medium">
                      대화 관리
                    </summary>
                    <div className="space-y-3 pt-2">
                      <div className="grid grid-cols-2 gap-2">
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
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={asking || painting || filming || deletingChats}
                          onClick={() => {
                            reader.stop();
                            dictation.stop();
                            setSheet(null);
                            setMailboxOpen(true);
                          }}
                          className="min-h-11 rounded-full border border-line px-3 text-sm text-fg"
                        >
                          보이스 메일
                        </button>
                        <button
                          type="button"
                          disabled={asking}
                          onClick={() => {
                            setGroupDraft([...groupMembers]);
                            setSheet(null);
                            setGroupSetup(true);
                          }}
                          className="min-h-11 rounded-full border border-line px-3 text-sm text-fg"
                        >
                          참여자 초대·나가기
                        </button>
                        <button
                          type="button"
                          disabled={asking || voiceBackup.saving}
                          onClick={() =>
                            void voiceBackup.backup(
                              personaId.startsWith("group:") ? groupMembers : [personaId],
                            )
                          }
                          className="min-h-11 rounded-full border border-line px-3 text-sm text-fg"
                        >
                          대화 종료·기억 백업
                        </button>
                        {!personaId.startsWith("group:") ? (
                          <button
                            type="button"
                            disabled={asking}
                            onClick={() => {
                              setSheet(null);
                              setDeleteChat({ id: personaId, name: personaName });
                            }}
                            className="min-h-11 rounded-full border border-line px-3 text-sm text-muted"
                          >
                            전체 대화 삭제
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </details>
                  <details className="rounded-2xl border border-line p-3">
                    <summary className="min-h-11 cursor-pointer py-3 font-medium">
                      프로필 사진 · {selectedPersona?.name}
                    </summary>
                    <div className="space-y-3 pt-2">
                      {selectedPersona?.photo ? (
                        <img
                          src={selectedPersona.photo}
                          alt="선택된 프로필 사진"
                          className="size-20 rounded-full object-cover"
                        />
                      ) : null}
                      <label className="block text-sm">
                        사진 선택
                        <input
                          aria-label="프로필 사진 선택"
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          disabled={profileBusy}
                          className="mt-2 block w-full"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file) void setProfile(file);
                          }}
                        />
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedPersona?.showBackground !== false}
                          onChange={(e) => updatePersona({ showBackground: e.target.checked })}
                        />
                        프로필 사진을 대화 배경으로 표시
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedPersona?.showAvatar !== false}
                          onChange={(e) => updatePersona({ showAvatar: e.target.checked })}
                        />
                        말풍선 이름 옆에 프로필 사진 표시
                      </label>
                      <p className="text-xs text-muted">
                        그록봇 프로필 사진을 저장한 뒤 선택하세요. Dropbox 위치:
                        /Grok/voicegrok/profiles/{selectedPersona?.name}/profile.png. 같은 이름의
                        페르소나에 적용됩니다. 백업에는 Dropbox 쓰기 권한이 필요합니다.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {[true, false].map((upload) => (
                          <button
                            key={String(upload)}
                            className="min-h-11 rounded-full border border-line px-3 text-sm"
                            disabled={profileBusy}
                            onClick={() => void profileCloud(upload)}
                          >
                            {upload ? "전체 사진 Dropbox 백업" : "전체 사진 Dropbox 불러오기"}
                          </button>
                        ))}
                        <button
                          className="min-h-11 rounded-full border border-line px-3 text-sm"
                          disabled={profileBusy}
                          onClick={() => updatePersona({ photo: undefined })}
                        >
                          사진 제거
                        </button>
                      </div>
                      {profileNote ? (
                        <p role="status" className="text-sm text-muted">
                          {profileNote}
                        </p>
                      ) : null}
                    </div>
                  </details>
                  <details className="rounded-2xl border border-line p-3">
                    <summary className="min-h-11 cursor-pointer py-3 font-medium">페르소나</summary>
                    <div className="space-y-3 pt-2">
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
                              setNewPersona({
                                ...newPersona,
                                password: e.target.value.slice(0, 32),
                              })
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
                          <div className="flex flex-col gap-2 rounded-2xl border border-line bg-bg p-3">
                            <p className="text-sm text-fg">{selectedPersona?.name}의 기억·템플릿</p>
                            <p className="text-sm text-muted">
                              요약 기억 {selectedPersona?.memories?.length ?? 0}개 · 템플릿{" "}
                              {selectedPersona?.template
                                ? `${selectedPersona.template.length}자`
                                : "없음"}
                            </p>
                            <p className="text-sm text-muted">
                              불러오기에서 MD 요약이나 페르소나 JSON을 선택하세요. Dropbox 자동
                              연결도 같은 이름에 적용합니다. 답변 요청에는 선택된 기억 일부와 성격
                              템플릿이 전달됩니다.
                            </p>
                            {selectedPersona?.template ? (
                              <details className="text-sm text-muted">
                                <summary>성격 템플릿 보기</summary>
                                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words">
                                  {selectedPersona.template}
                                </pre>
                              </details>
                            ) : null}
                            {(selectedPersona?.memories ?? []).map((memory) => (
                              <details key={memory.source} className="text-sm text-muted">
                                <summary>{memory.source}</summary>
                                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words">
                                  {memory.content}
                                </pre>
                              </details>
                            ))}
                          </div>
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
                  </details>
                </div>
                <details className="rounded-2xl border border-line p-3">
                  <summary className="min-h-11 cursor-pointer py-3 font-medium">
                    목소리 · 재생
                  </summary>
                  <div className="space-y-3 pt-2">
                    {" "}
                    <VoiceSelect
                      label="내 목소리 · 남자"
                      value={voiceMe}
                      voices={MALE_VOICES}
                      previewing={previewing === voiceMe}
                      onChange={setVoiceMe}
                      onPreview={() => void previewVoice(voiceMe)}
                    />
                    <VoiceSelect
                      label={`${selectedPersona?.name ?? "그록"} 목소리 · 여자`}
                      value={voiceGrok}
                      voices={FEMALE_VOICES}
                      previewing={previewing === voiceGrok}
                      onChange={(voice) => {
                        setVoiceGrok(voice);
                        setPersonas((prev) =>
                          prev.map((item) => (item.id === personaId ? { ...item, voice } : item)),
                        );
                      }}
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
                  </div>
                </details>
                <details className="rounded-2xl border border-line p-3">
                  <summary className="min-h-11 cursor-pointer py-3 font-medium">
                    마이크 · 이름 호출 · 안내 필터
                  </summary>
                  <div className="space-y-3 pt-2">
                    {" "}
                    <label className="flex items-center justify-between gap-3 text-sm text-fg">
                      이름을 부르면 말하기
                      <input
                        type="checkbox"
                        checked={wakeOn}
                        disabled={voiceIdentity.blocked}
                        onChange={(e) => {
                          const on = e.target.checked;
                          setWakeOn(on);
                          dictation.stop();
                          wake.halt();
                        }}
                        className="size-5 accent-primary"
                      />
                    </label>
                    <p className="text-sm text-pretty text-muted">
                      켜면 페르소나 이름을 기다립니다. “아라야”라고 부르면 호출되고, 그 뒤에는 이름
                      없이 계속 질문할 수 있습니다. 답변 재생 중에는 질문을 받지 않습니다. 마지막 말
                      이후 {wakeIdleSeconds}초 동안 조용하면 마이크를 끕니다. 다시 시작하려면 마이크
                      버튼을 누르세요. 브라우저가 듣기를 종료해도 자동 재시작하지 않습니다. 호출
                      대기와 질문 인식에 녹음·받아쓰기 API를 사용하므로 API 사용료가 발생할 수
                      있습니다.
                    </p>
                    <Slider
                      label="이름 호출 무음 종료 대기"
                      value={wakeIdleSeconds}
                      min={1}
                      max={15}
                      step={1}
                      display={`${wakeIdleSeconds}초`}
                      onChange={setWakeIdleSeconds}
                    />
                    <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-fg">
                      이름을 부른 뒤에만 질문 받기
                      <input
                        type="checkbox"
                        checked={requireVoiceName}
                        disabled={wakeOn}
                        onChange={(e) => setRequireVoiceName(e.target.checked)}
                        className="size-5 accent-primary"
                      />
                    </label>
                    <p className="text-sm text-muted">
                      이름 호출 모드가 꺼져 있을 때 음성 질문마다 “아라야 오늘 날씨 알려줘”처럼
                      이름을 먼저 말하세요. 직접 입력한 채팅에는 적용하지 않습니다.
                    </p>
                    <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-fg">
                      내비 안내 문장 걸러내기
                      <input
                        type="checkbox"
                        checked={filterAnnouncements}
                        onChange={(e) => setFilterAnnouncements(e.target.checked)}
                        className="size-5 accent-primary"
                      />
                    </label>
                    <label className="grid gap-2 text-sm text-fg">
                      걸러낼 안내 문장 (한 줄에 하나)
                      <textarea
                        value={announcementLines.join("\n")}
                        onChange={(e) =>
                          setAnnouncementLines(e.target.value.split("\n").slice(0, 100))
                        }
                        rows={7}
                        maxLength={20000}
                        className="w-full rounded-xl border border-line bg-surface p-3 text-sm"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setAnnouncementLines([...DEFAULT_ANNOUNCEMENTS])}
                      className="min-h-11 rounded-xl border border-line px-3 text-sm"
                    >
                      기본 안내 문장 복원
                    </button>
                    <p className="text-sm text-muted">
                      기본 안내 문장 {DEFAULT_ANNOUNCEMENTS.length}개가 들어 있습니다.
                      띄어쓰기·문장부호 차이와 나누어 인식된 안내도 걸러냅니다. 등록 문장과 다른
                      안내는 추가해 주세요. 음성 인식 후 질문 전송을 막는 기능입니다.
                    </p>
                  </div>
                </details>
                <details className="rounded-2xl border border-line p-3">
                  <summary className="min-h-11 cursor-pointer py-3 font-medium">
                    답변 · 대화 표시
                  </summary>
                  <div className="space-y-3 pt-2">
                    {" "}
                    <label className="flex min-h-11 items-center justify-between gap-3 text-sm text-fg">
                      페르소나 답변은 글자 없이 음성 메시지로 표시
                      <input
                        type="checkbox"
                        checked={voiceOnly}
                        onChange={(event) => setVoiceOnly(event.target.checked)}
                        className="size-5 accent-primary"
                      />
                    </label>
                    <p className="text-sm text-muted">
                      켜면 답변 글자는 채팅창과 재생 표시줄에 나오지 않습니다. 음성 버튼으로 해당
                      메시지만 듣고 일시정지·다시 재생할 수 있습니다. 답변 원문은 대화 기억과 백업을
                      위해 내부에 보관합니다. 음성 생성에는 API가 사용되며, API 음성을 사용할 수
                      없으면 기기 기본 음성으로 읽습니다.
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
                      마이크를 켜고 말하면 받아 적습니다. 페르소나 이름 뒤에 야나 아를 붙여 부르면
                      그 말투로 받고 말하기가 켜집니다. 셀카나 사진을 보내 달라고 하면 그림을,
                      영상이라고 하면 짧은 영상을 채팅에 넣고 읽어 줍니다. 만들기 전에는 만들었다고
                      말하지 않습니다. 장소, 가격, 소식 같은 정보는 그록이 인터넷에서 찾아 읽어
                      줍니다. 설정한 시간 동안 음성이 없으면 대답하고, 읽는 동안에는 마이크를 잠깐
                      멈춥니다.
                    </p>
                    <p className="text-center text-xs text-muted">
                      {APP_NAME} {APP_VERSION}
                    </p>
                  </div>
                </details>{" "}
                <MusicListener
                  request={musicRequest}
                  blocked={asking || painting || filming || deletingChats}
                  stopRef={musicStop}
                  onPrepare={() => {
                    setMusicRequest(0);
                    musicBusy.current = true;
                    musicRoom.current = personaIdRef.current;
                    reader.stop();
                    dictation.stop();
                    busyRef.current = true;
                    setAsking(true);
                  }}
                  onFinished={() => {
                    if (musicBusy.current) {
                      musicBusy.current = false;
                      busyRef.current = false;
                      setAsking(false);
                    }
                  }}
                  onResult={(text) => {
                    const room = musicRoom.current;
                    const at = Date.now();
                    setThreads((prev) => ({
                      ...prev,
                      [room]: [
                        ...(prev[room] ?? []),
                        {
                          id: `music-${at}`,
                          speaker: "grok",
                          text,
                          textOnly: true,
                          at,
                          audience: roomMembers[room] ?? [room],
                        },
                      ],
                    }));
                    setBanner(text);
                  }}
                />
                <VoiceIdentitySettings
                  identity={voiceIdentity.identity}
                  error={voiceIdentity.error}
                  onChange={voiceIdentity.save}
                  onStart={() => {
                    reader.stop();
                    dictation.stop();
                  }}
                />
                <AppSecuritySettings />
                <details className="rounded-2xl border border-line p-3">
                  <summary className="min-h-11 cursor-pointer py-3 font-medium">
                    모든 대화 · 보이스 메일 삭제
                  </summary>
                  <div className="space-y-3 pt-2">
                    <p className="text-sm text-muted">
                      이 기기의 모든 페르소나와 단체 대화, 보이스 메일, 기기 내부 대화 백업을
                      삭제합니다. 두 번 확인한 뒤 실행하며 되돌릴 수 없습니다. 템플릿·외부
                      기억·Dropbox 파일은 유지합니다.
                    </p>
                    <button
                      type="button"
                      disabled={
                        asking || painting || filming || voiceBackup.saving || deletingChats
                      }
                      className="min-h-11 w-full rounded-full border border-line text-fg"
                      onClick={() => {
                        reader.stop();
                        dictation.stop();
                        setDeleteAllStage(1);
                      }}
                    >
                      보이스 그록의 모든 대화 전체 삭제
                    </button>
                  </div>
                </details>
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
      {mailboxOpen ? (
        <VoiceMailBox
          personas={personas}
          initialId={personaId}
          threads={threads}
          onClose={() => setMailboxOpen(false)}
          onReply={(text, id) => {
            setMailboxOpen(false);
            selectPersona(id);
            void ask(`보이스 메일로 남긴 메시지에 답해줘: ${text}`, id, true);
          }}
        />
      ) : null}
      {groupSetup ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="함께 대화할 페르소나"
        >
          <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 text-fg">
            <h2 className="text-lg">함께 대화할 페르소나</h2>
            <p className="mt-2 text-sm text-muted">
              체크하면 참여하고 해제하면 나갑니다. 1~6명이 대화할 수 있으며 기존 대화가 이어집니다.
              초대받은 사람의 기존 대화는 이 방에 가져오지 않습니다. 각자 자기 설정과 대화 기억으로
              답합니다. 기본 페르소나는 나갈 수 없습니다.
            </p>
            <div className="my-3 grid grid-cols-2 gap-1">
              {personas.map((item) => (
                <label key={item.id} className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={groupDraft.includes(item.id)}
                    disabled={item.id === roomHost}
                    onChange={(event) =>
                      setGroupDraft((prev) =>
                        event.target.checked
                          ? [...prev, item.id]
                          : prev.filter((id) => id !== item.id),
                      )
                    }
                  />
                  {item.name}
                  {item.id === roomHost ? " (기본)" : ""}
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                className="min-h-11 flex-1 rounded-full border border-line"
                onClick={() => setGroupSetup(false)}
              >
                취소
              </button>
              <button
                className="min-h-11 flex-1 rounded-full bg-primary text-ink"
                onClick={() => void changeParticipants(groupDraft)}
              >
                참여자 변경 적용
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {deleteAllStage ? (
        <div
          key={deleteAllStage}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4"
          role="alertdialog"
          aria-modal="true"
          aria-label={`모든 대화 삭제 ${deleteAllStage}차 확인`}
        >
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-line bg-surface p-5 text-fg">
            <h2 className="text-lg">
              {deleteAllStage === 1
                ? "모든 페르소나의 대화를 삭제할까요? (1/2)"
                : "최종 경고: 모든 대화를 정말 삭제할까요? (2/2)"}
            </h2>
            <p className="text-sm text-muted">
              모든 페르소나·단체 대화, 보이스 메일과 이 기기의 대화 백업, 앱이 만든 요약 기억이
              삭제됩니다. 되돌릴 수 없습니다. Dropbox 파일·외부 기억·템플릿은 유지합니다.
            </p>
            <div className="flex gap-2">
              <button
                autoFocus
                className="min-h-11 flex-1 rounded-full border border-line"
                onClick={() => setDeleteAllStage(0)}
              >
                취소
              </button>
              <button
                className="min-h-11 flex-1 rounded-full bg-primary text-ink"
                disabled={deletingChats}
                onClick={() =>
                  deleteAllStage === 1 ? setDeleteAllStage(2) : void confirmDeleteAll()
                }
              >
                {deleteAllStage === 1 ? "다음 경고 확인" : "모든 대화 영구 삭제"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {deleteChat ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="전체 대화 삭제 확인"
        >
          <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 text-fg">
            <h2 className="text-lg">{deleteChat.name}의 대화를 정말 모두 삭제할까요?</h2>
            <p className="my-3 text-sm text-muted">
              이 기기의 전체 대화와 보이스 메일, 앱에서 만든 요약 기억을 삭제합니다. 성격 템플릿과
              외부에서 불러온 기억, Dropbox 파일은 유지합니다. 삭제 후 되돌릴 수 없습니다.
            </p>
            <p className="mb-3 text-sm text-muted">
              음성 확인은 마이크를 누르고 “모두 삭제” 또는 “취소”라고 말하세요.
            </p>
            <div className="mb-3 flex gap-2">
              <button
                className="min-h-11 flex-1 rounded-full border border-line"
                onClick={() => dictation.toggle()}
              >
                음성으로 확인
              </button>
              <button
                className="min-h-11 flex-1 rounded-full border border-line"
                onClick={() => {
                  setDeleteChat(null);
                  dictation.stop();
                }}
              >
                취소
              </button>
            </div>
            <button
              disabled={deletingChats}
              className="min-h-11 w-full rounded-full bg-primary text-ink"
              onClick={confirmDeleteChat}
            >
              정말 모두 삭제
            </button>
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
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    try {
      setLocked(localStorage.getItem("voice-grok-slider-lock:" + label) === "1");
    } catch {
      /* Keep sliders usable when browser storage is unavailable. */
    }
  }, [label]);
  return (
    <div className="flex flex-col gap-2 text-sm text-muted">
      <span className="flex items-center justify-between">
        <span>
          {label}{" "}
          <button
            type="button"
            aria-label={label + " 잠금"}
            aria-pressed={locked}
            className="min-h-11 rounded-full border border-line px-3 text-xs"
            onClick={() => {
              const next = !locked;
              setLocked(next);
              try {
                localStorage.setItem("voice-grok-slider-lock:" + label, next ? "1" : "0");
              } catch {
                /* The current lock still applies without persistence. */
              }
            }}
          >
            {locked ? "잠금 해제" : "잠금"}
          </button>
        </span>
        <span className="text-fg tabular-nums">{display}</span>
      </span>
      <input
        aria-label={label}
        disabled={locked}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-11 accent-primary"
      />
    </div>
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
