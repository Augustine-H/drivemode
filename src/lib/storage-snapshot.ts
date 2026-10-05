import type { NangdokBackup } from "./nangdok-backup.ts";
import {
  mediaAll,
  mediaGet,
  mediaPut,
  mediaKeys,
  mediaTransaction,
  withMediaLock,
} from "./media-db.ts";
import { listMedia } from "./media-repository.ts";
import { sha256 } from "./media-storage.ts";
import {
  archiveName,
  encodeMemoryArchive,
  makeMemoryArchive,
  type MemoryArchive,
} from "./storage-backup.ts";
import { savedExportFolder, writeVerified } from "./media-export.ts";
import { APP_VERSION } from "./app-meta.ts";

const defaults = {
  get: mediaGet,
  put: mediaPut,
  keys: mediaKeys,
  journal: () => mediaAll("journal"),
  media: listMedia,
  folder: savedExportFolder,
  lock: withMediaLock,
  write: writeVerified,
  prune: (old: string[]) =>
    mediaTransaction<void>(["snapshots"], "readwrite", (tx, done) => {
      for (const k of old) tx.objectStore("snapshots").delete(k);
      done();
    }),
};

/** Injectable storage supports isolated fixtures; the app always uses browser IDB and handles. */
export async function runStorageSnapshot(getBackup: () => NangdokBackup, deps = defaults) {
  await deps.lock(async () => {
    let device = await deps.get<string>("settings", "deviceId");
    if (!device) {
      device = crypto.randomUUID();
      await deps.put("settings", "deviceId", device);
    }
    let archive = await makeMemoryArchive(
      getBackup(),
      await deps.media(),
      await deps.journal(),
      device,
      APP_VERSION,
    );
    const signature = await sha256(
      new Blob([
        JSON.stringify({
          ...archive.files,
          "app.json": JSON.stringify({ ...JSON.parse(archive.files["app.json"]), exportedAt: 0 }),
        }),
      ]),
    );
    const previous = await deps.get<{ at: number; signature?: string; archive: MemoryArchive }>(
      "snapshots",
      "latest",
    );
    if (previous?.signature === signature) archive = previous.archive;
    else {
      await deps.put("snapshots", "latest", { at: Date.now(), signature, archive });
      const day = new Date().toLocaleDateString("sv-SE");
      if (!(await deps.get("snapshots", `daily-${day}`)))
        await deps.put("snapshots", `daily-${day}`, { at: Date.now(), archive });
      const saved = await deps.get<{ signature: string }>("snapshots", "latest");
      if (saved?.signature !== signature) throw new Error("snapshot 다시 읽기 확인 실패");
      const old = (await deps.keys("snapshots"))
        .filter((k): k is string => typeof k === "string" && /^daily-\d{4}-\d{2}-\d{2}$/.test(k))
        .sort()
        .reverse()
        .slice(7);
      if (old.length) await deps.prune(old);
    }
    const auto = await deps.get<boolean>("settings", "memory-auto-folder");
    const encrypted = await deps.get<boolean>("settings", "memory-encrypted");
    if (!auto || encrypted) return;
    const folder = await deps.folder();
    if (!folder) return;
    const last = await deps.get<{ backupId: string; folder: FileSystemDirectoryHandle }>(
      "backups",
      "last-memory-auto",
    );
    if (
      last?.backupId === archive.backupId &&
      last.folder &&
      (await folder.isSameEntry(last.folder))
    )
      return;
    const path = `VoiceGrok/MemoryBackups/${archive.deviceId}/${archiveName(archive.deviceId, archive.backupId, archive.createdAt)}`;
    await deps.put("backups", "memory-pending", { archive, path });
    try {
      const handle = folder as FileSystemDirectoryHandle & {
        queryPermission?: (o: { mode: "readwrite" }) => Promise<PermissionState>;
      };
      if (
        handle.queryPermission &&
        (await handle.queryPermission({ mode: "readwrite" })) !== "granted"
      )
        throw new Error("폴더 쓰기 권한 재연결 필요");
      await deps.write(folder, path, await encodeMemoryArchive(archive));
      await deps.put("backups", "last-memory-auto", { backupId: archive.backupId, folder });
      await deps.put("backups", "last-memory", {
        at: Date.now(),
        backupId: archive.backupId,
        state: "자동 폴더 쓰기/해시 확인 · NAS 미확인",
      });
      await deps.put("backups", "memory-pending", null);
      await deps.put("backups", "automatic-error", null);
    } catch (error) {
      await deps.put(
        "backups",
        "automatic-error",
        error instanceof Error ? error.message : "폴더 쓰기 실패",
      );
    }
  });
}
