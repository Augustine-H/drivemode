import { useEffect, useState } from "react";
import { Image, Music, FileAudio, Video, Download, Trash2, Archive, HardDrive } from "lucide-react";
import type { NangdokBackup } from "@/lib/nangdok-backup";
import {
  defaultMediaPolicy,
  MEDIA_TYPES,
  mediaTotals,
  type MediaItem,
  type MediaPolicy,
  type MediaType,
} from "@/lib/media-model";
import {
  changeMedia,
  getMediaPolicy,
  ingestMedia,
  importMediaIndex,
  listMedia,
  purgeMedia,
  retryMedia,
  saveMediaPolicy,
} from "@/lib/media-repository";
import { mediaAll, mediaGet, mediaPut, mediaKeys } from "@/lib/media-db";
import {
  archiveName,
  encodeMemoryArchive,
  makeMemoryArchive,
  mergeMemoryBackup,
  parseMemoryArchive,
  type MemoryArchive,
} from "@/lib/storage-backup";
import {
  downloadBlob,
  exportMedia,
  mediaRestorePreview,
  parseMediaManifest,
  reconnectMedia,
  savedExportFolder,
  selectExportFolder,
  writeVerified,
  type MediaManifest,
} from "@/lib/media-export";
import { deviceId } from "@/lib/use-media-library";
import { ManagedMedia } from "./managed-media";
import { APP_VERSION } from "@/lib/app-meta";
import { STORAGE_BACKUP_CHANGED } from "@/lib/use-storage-snapshots";
const names: Record<MediaType, string> = {
  image: "이미지",
  music: "음악",
  voice: "음성",
  audio: "오디오",
  video: "영상",
};
const icon = { image: Image, music: Music, voice: FileAudio, audio: FileAudio, video: Video };
const button = "min-h-11 rounded-full border border-line px-3 text-sm text-fg disabled:opacity-40";
const input = "min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-base text-fg";
const bytes = (n: number) => `${(n / 1048576).toFixed(2)} MiB (${n.toLocaleString()} bytes)`;
export function StorageSettings({
  items,
  error,
  refresh,
  getBackup,
  onRestore,
  onNavigate,
  personas,
  personaId,
}: {
  items: MediaItem[];
  error: string;
  refresh: () => Promise<void>;
  getBackup: () => NangdokBackup;
  onRestore: (backup: NangdokBackup) => void | Promise<void>;
  onNavigate: (room: string) => void;
  personas: { id: string; name: string }[];
  personaId: string;
}) {
  const [tab, setTab] = useState("library"),
    [type, setType] = useState("all"),
    [scope, setScope] = useState("active"),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(0),
    [sort, setSort] = useState("newest"),
    [policy, setPolicy] = useState<MediaPolicy>(defaultMediaPolicy),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [estimate, setEstimate] = useState<StorageEstimate>({}),
    [persistent, setPersistent] = useState<boolean | null>(null),
    [password, setPassword] = useState(""),
    [encrypted, setEncrypted] = useState(false),
    [pending, setPending] = useState<Awaited<ReturnType<typeof parseMemoryArchive>> | null>(null),
    [preview, setPreview] = useState<Awaited<ReturnType<typeof mediaRestorePreview>> | null>(null),
    [replace, setReplace] = useState(false),
    [folder, setFolder] = useState<FileSystemDirectoryHandle>(),
    [manifest, setManifest] = useState<MediaManifest>(),
    [purge, setPurge] = useState<MediaItem[]>([]),
    [policyPreview, setPolicyPreview] = useState<MediaItem[]>([]),
    [importType, setImportType] = useState<MediaType>("image"),
    [internalAt, setInternalAt] = useState<number>(),
    [backupAt, setBackupAt] = useState<string>("미설정"),
    [exportNotice, setExportNotice] = useState("미설정"),
    [autoFolder, setAutoFolder] = useState(false),
    [snapshotKeys, setSnapshotKeys] = useState<string[]>([]),
    [selectedSnapshot, setSelectedSnapshot] = useState("latest");
  useEffect(() => {
    void getMediaPolicy()
      .then(setPolicy)
      .catch(() => {});
    void savedExportFolder()
      .then((d) => setFolder(d))
      .catch(() => {});
    void navigator.storage
      ?.estimate()
      .then(setEstimate)
      .catch(() => {});
    void navigator.storage
      ?.persisted?.()
      .then(setPersistent)
      .catch(() => {});
    void mediaGet<boolean>("settings", "memory-auto-folder")
      .then((v) => setAutoFolder(v === true))
      .catch(() => {});
    void mediaGet<boolean>("settings", "memory-encrypted")
      .then((v) => setEncrypted(v === true))
      .catch(() => {});
    void mediaGet<{ at: number }>("snapshots", "latest")
      .then((s) => setInternalAt(s?.at))
      .catch(() => {});
    void mediaGet<{ at: number; state: string }>("backups", "last-memory")
      .then((s) => {
        if (s) setBackupAt(`${new Date(s.at).toLocaleString()} · ${s.state}`);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    const update = () => {
      void mediaKeys("snapshots")
        .then((keys) =>
          setSnapshotKeys(
            keys
              .filter((k): k is string => typeof k === "string")
              .sort()
              .reverse(),
          ),
        )
        .catch(() => {});
      void mediaGet<{ at: number }>("snapshots", "latest")
        .then((s) => setInternalAt(s?.at))
        .catch(() => {});
      void mediaGet<{ at: number; state: string }>("backups", "last-memory")
        .then((s) => {
          if (s) setBackupAt(`${new Date(s.at).toLocaleString()} · ${s.state}`);
        })
        .catch(() => {});
      void mediaGet<string>("backups", "automatic-error")
        .then((e) => {
          if (e) setNotice(`자동 백업: ${e}. 폴더를 다시 선택하거나 수동 내보내기하세요.`);
        })
        .catch(() => {});
    };
    update();
    window.addEventListener(STORAGE_BACKUP_CHANGED, update);
    return () => window.removeEventListener(STORAGE_BACKUP_CHANGED, update);
  }, []);
  const allowed = new Set(personas.map((p) => p.id));
  const visible = items.filter((i) => !i.personaId || allowed.has(i.personaId));
  const total = mediaTotals(items);
  const filtered = visible
    .filter(
      (i) =>
        i.lifecycle !== "deleted" &&
        (type === "all" || i.type === type) &&
        (scope === "trash"
          ? i.lifecycle === "trashed"
          : i.lifecycle === "active" && (scope === "active" || i.retentionClass === scope)) &&
        `${i.filename} ${i.description ?? ""}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "size" ? b.localByteSize - a.localByteSize : b.createdAt - a.createdAt,
    );
  const usage =
    estimate.quota && estimate.quota > 0 && estimate.usage !== undefined
      ? (estimate.usage / estimate.quota) * 100
      : undefined;
  async function work(task: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await task();
      await refresh();
      setPolicy(await getMediaPolicy());
      setEstimate((await navigator.storage?.estimate()) ?? {});
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "저장 작업 실패");
    } finally {
      setBusy(false);
    }
  }
  async function memoryExport(toFolder: boolean) {
    if (encrypted && password.length < 8)
      throw new Error("암호를 8글자 이상 입력하세요. 암호 없이 plaintext로 전환하지 않습니다.");
    const archive = await makeMemoryArchive(
      getBackup(),
      await listMedia(),
      await mediaAll("journal"),
      await deviceId(),
      APP_VERSION,
    );
    const blob = await encodeMemoryArchive(archive, encrypted ? password : undefined);
    const name = archiveName(archive.deviceId, archive.backupId, archive.createdAt);
    if (toFolder && folder)
      await writeVerified(folder, `VoiceGrok/MemoryBackups/${archive.deviceId}/${name}`, blob);
    else downloadBlob(blob, name);
    const state = toFolder ? "폴더 쓰기/해시 확인" : "다운로드 요청 · 저장 미확인";
    await mediaPut("backups", "last-memory", { at: Date.now(), state, backupId: archive.backupId });
    setBackupAt(state);
    setPassword("");
    setNotice(`${name}: ${state}. NAS 전송 상태는 확인할 수 없습니다.`);
  }
  async function stage(blob: Blob) {
    const data = await parseMemoryArchive(blob, password || undefined);
    await mediaPut("staging", "restore", data);
    setPassword("");
    setPreview(await mediaRestorePreview(data.media));
    setPending(data);
    setNotice(
      "해시·형식 검증 완료. 실제 미디어 bytes는 포함되지 않습니다. 적용 전 미리보기를 확인하세요.",
    );
  }
  async function apply() {
    if (!pending) return;
    const current = getBackup();
    const target = replace ? pending.backup : mergeMemoryBackup(current, pending.backup);
    if (preview?.conflicts.length)
      throw new Error("미디어 ID 충돌을 해결하기 전 적용할 수 없습니다.");
    if (
      replace &&
      !window.confirm(
        "현재 대화·페르소나·기억을 이 백업으로 교체합니다. 현재 상태를 복구 snapshot에 남깁니다. 미디어 원본과 외부 사본은 지우지 않습니다. 교체할까요?",
      )
    )
      return;
    const recovery = await makeMemoryArchive(
      current,
      await listMedia(),
      await mediaAll("journal"),
      await deviceId(),
      APP_VERSION,
    );
    await mediaPut("snapshots", "before-restore", { at: Date.now(), archive: recovery });
    await importMediaIndex(pending.media);
    await onRestore(target);
    setPending(null);
    setPreview(null);
    setNotice(
      "복원 적용. 자동 정리는 보류됐습니다. 누락 원본은 Media manifest와 파일로 재연결하세요.",
    );
  }
  return (
    <details className="rounded-2xl border border-line p-3">
      <summary className="min-h-11 cursor-pointer py-3 font-medium">
        미디어 · 저장공간 · 백업
      </summary>
      <div className="space-y-4 pt-2">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="저장 관리">
          {[
            ["library", "라이브러리"],
            ["space", "저장공간"],
            ["backup", "백업·복원"],
          ].map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={button + (tab === id ? " bg-primary text-ink" : "")}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-primary">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="break-words text-sm text-primary">
            {notice}
          </p>
        ) : null}
        {tab === "library" ? (
          <>
            <input
              className={input}
              aria-label="미디어 검색"
              placeholder="설명·파일명 검색"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
            <div className="flex flex-wrap gap-2">
              <select
                aria-label="미디어 유형"
                className={button + " bg-surface"}
                value={type}
                onChange={(e) => {
                  setType(e.target.value);
                  setPage(0);
                }}
              >
                <option value="all">모든 유형</option>
                {MEDIA_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {names[t]}
                  </option>
                ))}
              </select>
              <select
                aria-label="보존 상태"
                className={button + " bg-surface"}
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value);
                  setPage(0);
                }}
              >
                {[
                  ["active", "전체"],
                  ["saved", "보관"],
                  ["temporary", "임시"],
                  ["trash", "휴지통"],
                ].map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <select
                aria-label="미디어 정렬"
                className={button + " bg-surface"}
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="newest">최신순</option>
                <option value="size">큰 파일순</option>
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="가져올 미디어 종류"
                value={importType}
                onChange={(e) => setImportType(e.target.value as MediaType)}
                className={button + " bg-surface"}
              >
                {MEDIA_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {names[t]}
                  </option>
                ))}
              </select>
              <label className={button + " flex cursor-pointer items-center"}>
                파일 가져오기
                <input
                  type="file"
                  accept={
                    importType === "image"
                      ? "image/*"
                      : importType === "video"
                        ? "video/*"
                        : "audio/*"
                  }
                  className="hidden"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file)
                      void work(async () => {
                        const item = await ingestMedia({
                          type: importType,
                          origin: "uploaded",
                          filename: file.name,
                          blob: file,
                          personaId,
                        });
                        if (item.ingestState !== "complete") throw new Error(item.error);
                        setNotice(
                          "원본 파일을 보관했습니다. 음악 생성 연결은 음악 생성 설정에서 확인하세요.",
                        );
                      });
                  }}
                />
              </label>
            </div>
            {!filtered.length ? (
              <p className="py-4 text-sm text-muted">이 조건의 미디어가 없습니다.</p>
            ) : (
              filtered.slice(page * 10, page * 10 + 10).map((item) => {
                const Icon = icon[item.type];
                const remaining = item.expiresAt
                  ? Math.max(0, Math.ceil((item.expiresAt - Date.now()) / 86400000))
                  : null;
                return (
                  <article key={item.id} className="space-y-2 rounded-2xl border border-line p-3">
                    <div className="flex items-start gap-2">
                      <Icon className="mt-1 size-5 shrink-0" />
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium">
                          {item.description || item.filename}
                        </p>
                        <p className="text-xs text-muted">
                          {new Date(item.createdAt).toLocaleString()} · {bytes(item.localByteSize)}
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-muted">
                      {item.lifecycle === "trashed"
                        ? "휴지통"
                        : item.retentionClass === "saved"
                          ? "보관 · 자동 만료 없음"
                          : `임시 · ${remaining === null ? "자동 만료 없음" : remaining + "일 남음"}`}{" "}
                      ·{" "}
                      {item.availability === "local"
                        ? "로컬 원본"
                        : item.availability === "remote-only"
                          ? "링크만 있음"
                          : "파일 없음"}{" "}
                      · 백업{" "}
                      {item.backupState === "verified"
                        ? "폴더 검증"
                        : item.backupState === "exported-unverified"
                          ? "내보내기 미확인"
                          : "없음"}
                      {item.protected ? " · 보존 보호" : ""}
                    </p>
                    {item.lifecycle === "active" && item.availability === "local" ? (
                      <details>
                        <summary className="min-h-11 cursor-pointer py-3 text-sm">미리보기</summary>
                        <ManagedMedia id={item.id} type={item.type} />
                      </details>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      {item.lifecycle === "trashed" ? (
                        <>
                          <button
                            disabled={busy}
                            className={button}
                            onClick={() =>
                              void work(async () => {
                                await changeMedia(item.id, item.revision, "restore");
                              })
                            }
                          >
                            복원
                          </button>
                          <button
                            disabled={busy}
                            className={button}
                            onClick={() => setPurge([item])}
                          >
                            즉시 삭제
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            disabled={busy}
                            className={button}
                            onClick={() =>
                              void work(async () => {
                                await changeMedia(
                                  item.id,
                                  item.revision,
                                  item.retentionClass === "saved" ? "unsave" : "save",
                                );
                              })
                            }
                          >
                            <Archive className="mr-1 inline size-4" />
                            {item.retentionClass === "saved" ? "보관 해제" : "보관"}
                          </button>
                          <button
                            disabled={busy || item.availability !== "local"}
                            className={button}
                            onClick={() =>
                              void work(async () => {
                                const m = await exportMedia([item]);
                                if (m.files[0]?.state === "failed")
                                  throw new Error(m.files[0].error ?? "원본 내보내기 실패");
                                setExportNotice(m.files[0]?.state ?? "failed");
                                setNotice(
                                  "다운로드 요청. 실제 저장 여부는 다운로드 목록에서 확인하세요. 보관 상태는 바꾸지 않았습니다.",
                                );
                              })
                            }
                          >
                            <Download className="mr-1 inline size-4" />
                            기기에 저장
                          </button>
                          <button
                            disabled={busy}
                            className={button}
                            onClick={() =>
                              void work(async () => {
                                await changeMedia(item.id, item.revision, "trash");
                              })
                            }
                          >
                            <Trash2 className="mr-1 inline size-4" />
                            휴지통
                          </button>
                          {item.availability !== "local" && item.remoteUrl ? (
                            <button
                              disabled={busy}
                              className={button}
                              onClick={() =>
                                void work(async () => {
                                  const next = await retryMedia(item.id);
                                  if (next.ingestState !== "complete") throw new Error(next.error);
                                })
                              }
                            >
                              원본 저장 재시도
                            </button>
                          ) : null}
                        </>
                      )}
                      {item.refs.find((r) => !r.conversationId.startsWith("mail:")) ? (
                        <button
                          className={button}
                          onClick={() =>
                            onNavigate(
                              item.refs.find((r) => !r.conversationId.startsWith("mail:"))!
                                .conversationId,
                            )
                          }
                        >
                          대화로 이동
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })
            )}
            <div className="flex justify-between gap-2">
              <button className={button} disabled={!page} onClick={() => setPage(page - 1)}>
                이전
              </button>
              <p className="self-center text-xs text-muted">
                {page + 1} / {Math.max(1, Math.ceil(filtered.length / 10))}
              </p>
              <button
                className={button}
                disabled={(page + 1) * 10 >= filtered.length}
                onClick={() => setPage(page + 1)}
              >
                다음
              </button>
            </div>
            {scope === "trash" ? (
              <button
                className={button}
                disabled={!filtered.length || busy}
                onClick={() => setPurge(filtered)}
              >
                현재 필터의 휴지통 비우기
              </button>
            ) : null}
          </>
        ) : null}
        {tab === "space" ? (
          <>
            <h3 className="flex items-center gap-2 font-medium">
              <HardDrive className="size-5" />앱 원본 {bytes(total.total)}
            </h3>
            <p className="text-xs text-muted">
              휴지통 {bytes(total.trashBytes)}는 위 총량에 포함됩니다. missing/remote-only{" "}
              {total.missing}개는 제외 · 미검증 {total.unverified}개.
            </p>
            {MEDIA_TYPES.map((t) => (
              <p key={t} className="flex justify-between text-sm">
                <span>{names[t]}</span>
                <span>{bytes(total.byType[t])}</span>
              </p>
            ))}
            <p className="text-xs text-muted">
              Memory 논리 데이터 크기 추정 {bytes(new Blob([JSON.stringify(getBackup())]).size)} ·
              DB 실제 디스크 크기와 다릅니다.
            </p>
            <p className="text-sm">
              브라우저 origin 추정:{" "}
              {estimate.usage !== undefined ? bytes(estimate.usage) : "미지원"} /{" "}
              {estimate.quota ? bytes(estimate.quota) : "한도 확인 불가"}
              {usage !== undefined ? ` · ${usage.toFixed(1)}%` : ""}
            </p>
            <p className="text-xs text-muted">
              기기 전체의 남은 용량이 아닙니다. 썸네일 생성/cache 추가 없음. 기존 메일·PWA·모델
              cache는 origin 추정 사용량에 포함될 수 있습니다.
            </p>
            {usage !== undefined && usage >= 70 ? (
              <p role="alert" className="text-sm text-primary">
                {usage >= 90
                  ? "90% 이상: 큰 파일 저장 전 백업과 정리를 먼저 확인하세요."
                  : usage >= 80
                    ? "80% 이상: 오래된 임시 파일 정리를 검토하세요."
                    : "70% 이상: 백업을 준비하세요."}{" "}
                보관 파일은 용량 때문에 자동 삭제하지 않습니다.
              </p>
            ) : null}
            <button
              className={button}
              disabled={busy}
              onClick={() =>
                void work(async () => {
                  if (!navigator.storage?.persist) throw new Error("영구 저장 요청 미지원");
                  const granted = await navigator.storage.persist();
                  setPersistent(granted);
                  setNotice(
                    granted
                      ? "자동 축출 보호 승인. 사이트 데이터 삭제와 기기 분실은 막지 못합니다."
                      : "승인되지 않았습니다. 독립 파일 백업을 유지하세요.",
                  );
                })
              }
            >
              자동 축출 보호 요청 ·{" "}
              {persistent === null ? "확인 불가" : persistent ? "승인" : "미승인"}
            </button>
            <p className="text-xs text-muted">
              보관{" "}
              {items.filter((i) => i.lifecycle === "active" && i.retentionClass === "saved").length}{" "}
              · 임시{" "}
              {
                items.filter((i) => i.lifecycle === "active" && i.retentionClass === "temporary")
                  .length
              }{" "}
              · 휴지통 {items.filter((i) => i.lifecycle === "trashed").length}
            </p>
            <details>
              <summary className="min-h-11 cursor-pointer py-3 font-medium">
                새 파일 보존기간
              </summary>
              <div className="space-y-2">
                {MEDIA_TYPES.map((t) => (
                  <label key={t} className="flex min-h-11 items-center justify-between gap-2">
                    {names[t]}
                    <select
                      className={button + " bg-surface"}
                      value={policy.days[t] ?? "none"}
                      onChange={(e) =>
                        void work(async () => {
                          await saveMediaPolicy({
                            ...policy,
                            days: {
                              ...policy.days,
                              [t]: e.target.value === "none" ? null : Number(e.target.value),
                            },
                          });
                        })
                      }
                    >
                      {[7, 14, 30, 90].map((n) => (
                        <option key={n} value={n}>
                          {n}일
                        </option>
                      ))}
                      <option value="none">자동 삭제 안 함</option>
                    </select>
                  </label>
                ))}
                <p className="text-xs text-muted">
                  이후 새 파일에 적용합니다. 업로드·legacy·보관은 자동 만료 제외. 휴지통은 발견한
                  시점부터 7일입니다.
                </p>
                <label className="flex min-h-11 items-center justify-between">
                  휴지통 7일 뒤 자동 영구삭제
                  <input
                    type="checkbox"
                    checked={policy.autoPurge}
                    onChange={(e) =>
                      void work(async () => {
                        await saveMediaPolicy({ ...policy, autoPurge: e.target.checked });
                      })
                    }
                  />
                </label>
                <p className="text-xs text-muted">
                  앱 실행 중·다시 열 때만 처리. 기기/NAS로 내보낸 사본은 삭제하지 않습니다.
                </p>
                <button
                  className={button}
                  onClick={() =>
                    setPolicyPreview(
                      items.filter(
                        (i) =>
                          i.lifecycle === "active" &&
                          i.retentionClass === "temporary" &&
                          !i.protected,
                      ),
                    )
                  }
                >
                  기존 임시 항목에 적용 미리보기
                </button>
                {policyPreview.length ? (
                  <div className="space-y-2 text-sm">
                    <p>
                      {policyPreview.length}개 · 적용 시점부터 새 기간. 즉시 만료 0개. 보관·legacy
                      제외.
                    </p>
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() =>
                        void work(async () => {
                          for (const i of policyPreview)
                            await changeMedia(i.id, i.revision, "unsave");
                          setPolicyPreview([]);
                          setNotice("선택한 기존 임시 파일의 기간을 재설정했습니다.");
                        })
                      }
                    >
                      이 항목에 적용
                    </button>
                  </div>
                ) : null}
              </div>
            </details>
            {policy.paused ? (
              <div className="space-y-2">
                <p className="text-sm text-primary">자동 정리 보류: {policy.pauseReason}</p>
                <button
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    void work(async () => {
                      const waiting = items.filter(
                        (i) => i.restorePending && i.lifecycle !== "deleted",
                      );
                      for (const i of waiting)
                        await changeMedia(
                          i.id,
                          i.revision,
                          i.lifecycle === "trashed" ? "restore" : "save",
                        );
                      await saveMediaPolicy({
                        ...policy,
                        paused: false,
                        pauseReason: undefined,
                        lastMaintenance: Date.now(),
                      });
                      setNotice("복원된 항목을 보관하고 자동 정리를 재개했습니다.");
                    })
                  }
                >
                  복원 항목 모두 보관 후 재개
                </button>
              </div>
            ) : null}
          </>
        ) : null}
        {tab === "backup" ? (
          <>
            <p className="text-xs text-muted">
              앱 내부 snapshot: {internalAt ? new Date(internalAt).toLocaleString() : "아직 없음"}.
              같은 origin이므로 독립 백업이 아닙니다. 변경 후 30초·하루 첫 변경 snapshot을 최근 일별
              7개를 보관합니다.
            </p>
            <p className="text-xs text-muted">
              Memory 내보내기: {backupAt} · Media 내보내기: {exportNotice} · NAS/오프사이트: 미설정,
              외부 동기화 상태 확인 불가
            </p>
            <label className="flex min-h-11 items-center justify-between">
              Memory 백업 암호화
              <input
                type="checkbox"
                checked={encrypted}
                onChange={(e) => {
                  const value = e.target.checked;
                  setEncrypted(value);
                  if (value) setAutoFolder(false);
                  void work(async () => {
                    await mediaPut("settings", "memory-encrypted", value);
                    if (value) await mediaPut("settings", "memory-auto-folder", false);
                  });
                }}
              />
            </label>
            <input
              type="password"
              autoComplete="new-password"
              className={input}
              placeholder="백업 암호 (내보내기 8글자 이상)"
              aria-label="백업 암호"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="text-xs text-muted">
              암호는 저장하지 않습니다. 분실 시 복원 불가. Memory .vgb는 해시를 포함한 JSON
              archive이며 실제 사진·영상·메일 음성은 별도 내보냅니다. Media 파일은 암호화하지
              않습니다.
            </p>
            <p className="text-xs text-muted">
              대화·페르소나·기억과 미디어 참조를 복원합니다. 보이스메일 음성은 Media로 내보낼 수
              있으며, 메일함의 읽음·예약 답장 상태는 다른 기기로 복원하지 않습니다.
            </p>
            <div className="flex flex-wrap gap-2">
              <select
                className={button + " bg-surface"}
                aria-label="내부 snapshot 선택"
                value={selectedSnapshot}
                onChange={(e) => setSelectedSnapshot(e.target.value)}
              >
                <option value="latest">가장 최근 내부 snapshot</option>
                {snapshotKeys
                  .filter((k) => k !== "latest")
                  .map((k) => (
                    <option key={k} value={k}>
                      {k === "before-restore" ? "복원 직전" : k.replace("daily-", "")}
                    </option>
                  ))}
              </select>
              <button
                className={button}
                disabled={busy || !snapshotKeys.length}
                onClick={() =>
                  void work(async () => {
                    const s = await mediaGet<{ archive: MemoryArchive }>(
                      "snapshots",
                      selectedSnapshot,
                    );
                    if (!s) throw new Error("선택한 snapshot이 없습니다.");
                    await stage(new Blob([JSON.stringify(s.archive)]));
                  })
                }
              >
                내부 snapshot 검증·불러오기
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                disabled={busy}
                className={button}
                onClick={() => void work(() => memoryExport(false))}
              >
                Memory 기기로 내보내기
              </button>
              <button
                disabled={busy}
                className={button}
                onClick={() =>
                  void work(async () => {
                    setFolder(await selectExportFolder());
                    setNotice("선택한 폴더의 쓰기·읽기 검증 완료. NAS 서버 전송은 미확인입니다.");
                  })
                }
              >
                내보내기 폴더 선택
              </button>
              {folder ? (
                <button
                  disabled={busy}
                  className={button}
                  onClick={() => void work(() => memoryExport(true))}
                >
                  Memory 폴더에 저장
                </button>
              ) : null}
              <label className={button + " flex cursor-pointer items-center"}>
                백업 검증·복원
                <input
                  className="hidden"
                  type="file"
                  accept=".vgb,.json"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void work(() => stage(file));
                  }}
                />
              </label>
              <button
                disabled={busy}
                className={button}
                onClick={() =>
                  void work(async () => {
                    const snapshot = await mediaGet<{ archive: MemoryArchive }>(
                      "snapshots",
                      "before-restore",
                    );
                    if (!snapshot) throw new Error("복원 전 snapshot이 없습니다.");
                    await stage(new Blob([JSON.stringify(snapshot.archive)]));
                  })
                }
              >
                교체 전 snapshot 불러오기
              </button>
            </div>
            <label className="flex min-h-11 items-center justify-between gap-3">
              앱 실행 중 변경 후 폴더에 Memory 자동 백업
              <input
                type="checkbox"
                checked={autoFolder}
                disabled={!folder || encrypted || busy}
                onChange={(e) => {
                  const value = e.target.checked;
                  setAutoFolder(value);
                  void work(() => mediaPut("settings", "memory-auto-folder", value));
                }}
              />
            </label>
            <p className="text-xs text-muted">
              폴더 쓰기 검증·권한이 필요합니다. 암호화 선택 시 자동 백업은 꺼지며 암호를 입력해 수동
              내보내기하세요. 자동 백업은 암호화하지 않습니다. 앱 종료 후 실행·NAS 전송은 보장하지
              않습니다. 실패한 작업은 다음 실행 때 재시도합니다.
            </p>
            {pending ? (
              <div className="space-y-2 rounded-xl border border-line p-3">
                <p className="text-sm">
                  대화 {Object.values(pending.backup.threads).reduce((n, l) => n + l.length, 0)}개 ·
                  페르소나 {pending.backup.personas.length}개 · 기억{" "}
                  {Object.values(pending.backup.memoryV2?.longTerm ?? {}).reduce(
                    (n, l) => n + l.length,
                    0,
                  )}
                  개 · 미디어 {preview?.total ?? 0}개 · 누락 원본 {preview?.missing ?? 0} · 충돌{" "}
                  {preview?.conflicts.length ?? 0} · 만료 {preview?.expired ?? 0} · 휴지통{" "}
                  {preview?.trashed ?? 0}. 실제 바이너리 포함 없음.
                </p>
                <label className="flex min-h-11 items-center justify-between">
                  현재 데이터 교체 (기본은 병합)
                  <input
                    type="checkbox"
                    checked={replace}
                    onChange={(e) => setReplace(e.target.checked)}
                  />
                </label>
                <button className={button} disabled={busy} onClick={() => void work(apply)}>
                  미리보기 내용 적용
                </button>
                <button
                  className={button}
                  onClick={() => {
                    setPending(null);
                    setPreview(null);
                  }}
                >
                  취소
                </button>
              </div>
            ) : null}
            <details>
              <summary className="min-h-11 cursor-pointer py-3 font-medium">
                미디어 내보내기·재연결
              </summary>
              <div className="space-y-3">
                <p className="text-xs text-muted">
                  폰에서는 라이브러리의 기기에 저장으로 파일별 내보내기를 사용하세요. 폴더를
                  지원하면 파일을 순서대로 쓰고 확인한 뒤 manifest를 만듭니다. 재실행 시 같은
                  checksum 파일은 건너뜁니다.
                </p>
                <button
                  className={button}
                  disabled={busy || !folder}
                  onClick={() =>
                    void work(async () => {
                      const m = await exportMedia(
                        visible.filter((i) => i.lifecycle === "active"),
                        folder,
                      );
                      const failed = m.files.filter((f) => f.state === "failed");
                      setExportNotice(
                        `${m.files.length - failed.length}개 폴더 확인 · ${failed.length}개 실패`,
                      );
                      setNotice(
                        failed.length
                          ? `일부 실패: ${failed.map((f) => f.mediaId + ": " + f.error).join(" / ")}`
                          : "파일과 manifest 폴더 검증 완료. NAS 서버는 미확인입니다.",
                      );
                    })
                  }
                >
                  전체 미디어 폴더 내보내기
                </button>
                <label className={button + " flex cursor-pointer items-center"}>
                  Media manifest 선택
                  <input
                    className="hidden"
                    type="file"
                    accept=".json"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f)
                        void work(async () => {
                          if (f.size > 10 * 1024 * 1024) throw new Error("manifest는 10MiB 이하");
                          setManifest(parseMediaManifest(JSON.parse(await f.text())));
                          setNotice("manifest 검증 완료. 대응 원본 파일을 선택하세요.");
                        });
                    }}
                  />
                </label>
                <label className={button + " flex cursor-pointer items-center"}>
                  원본 파일 재연결
                  <input
                    className="hidden"
                    type="file"
                    multiple
                    disabled={busy || !manifest}
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      e.target.value = "";
                      if (manifest)
                        void work(async () => {
                          const result = await reconnectMedia(manifest, files);
                          setNotice(
                            `재연결 ${result.filter((r) => r.ok).length}개 · 실패 ${result.filter((r) => !r.ok).length}개: ${result
                              .filter((r) => !r.ok)
                              .map((r) => r.id + " " + r.reason)
                              .join(" / ")}`,
                          );
                        });
                    }}
                  />
                </label>
              </div>
            </details>
            <details>
              <summary className="min-h-11 cursor-pointer py-3 font-medium">
                Synology Drive 설정 안내
              </summary>
              <ol className="list-decimal space-y-2 pl-5 text-sm text-muted">
                <li>
                  Memory와 Media를 다운로드 폴더 같은 앱 밖 위치로 내보내고 파일을 확인하세요.
                </li>
                <li>
                  Drive 설치 버전에서 파일 백업 작업 지원 여부를 확인하고 내보낸 기기 폴더를
                  선택하세요. 브라우저 내부 저장은 Drive가 직접 읽지 못합니다.
                </li>
                <li>
                  NAS 대상은 VoiceGrok/MemoryBackups/기기ID, Media/Saved/유형, Manifests로
                  구분하세요.
                </li>
                <li>
                  업로드 방향·삭제 전파·크기 제한·네트워크·배터리 조건을 확인하세요. 로컬 정리가 NAS
                  유일 사본을 지우지 않게 설정하세요.
                </li>
                <li>
                  NAS 파일을 다시 가져와 해시 검증·복원을 확인하세요. NAS 자동 백업·정리와 앱 종료
                  후 실행은 이 웹앱에서 보장하지 않습니다.
                </li>
              </ol>
            </details>
          </>
        ) : null}
        {purge.length ? (
          <div
            role="alertdialog"
            aria-label="미디어 영구삭제 확인"
            className="space-y-3 rounded-2xl border border-primary p-3"
          >
            <p>
              {purge.length}개 · {bytes(purge.reduce((n, i) => n + i.localByteSize, 0))}를 앱 관리
              원본에서 영구삭제합니다. 복구할 수 없습니다. 대화·기억, 기기 다운로드·NAS·과거 백업은
              유지됩니다.
            </p>
            <button
              className={button}
              disabled={busy}
              onClick={() =>
                void work(async () => {
                  let failed = 0;
                  for (const i of purge) if (!(await purgeMedia(i.id, i.revision))) failed++;
                  setPurge([]);
                  setNotice(
                    failed
                      ? `${failed}개 삭제 미완료. 재시도 필요.`
                      : "앱 관리 원본 삭제 확인. 외부 사본은 삭제하지 않았습니다.",
                  );
                })
              }
            >
              확인 · 원본 영구삭제
            </button>
            <button className={button} onClick={() => setPurge([])}>
              취소
            </button>
          </div>
        ) : null}
      </div>
    </details>
  );
}
