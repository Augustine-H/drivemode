import { useEffect, useRef } from "react";
import type { NangdokBackup } from "./nangdok-backup";
import {
  mediaAll,
  mediaGet,
  mediaPut,
  mediaKeys,
  mediaTransaction,
  withMediaLock,
} from "./media-db";
import { listMedia } from "./media-repository";
import { sha256 } from "./media-storage";
import {
  archiveName,
  encodeMemoryArchive,
  makeMemoryArchive,
  type MemoryArchive,
} from "./storage-backup";
import { savedExportFolder, writeVerified } from "./media-export";
import { deviceId } from "./use-media-library";
import { APP_VERSION } from "./app-meta";
export const STORAGE_BACKUP_CHANGED = "voice-grok-storage-backup-changed";
// Mounted with the app, independently of whether its settings dialog is open.
export function useStorageSnapshots(getBackup: () => NangdokBackup, key: string, enabled: boolean) {
  const getter = useRef(getBackup);
  getter.current = getBackup;
  useEffect(() => {
    if (!enabled) return;
    let stopped = false,
      working = false;
    const run = async () => {
      if (stopped || working || document.hidden) return;
      working = true;
      try {
        await withMediaLock(async () => {
          let archive = await makeMemoryArchive(
            getter.current(),
            await listMedia(),
            await mediaAll("journal"),
            await deviceId(),
            APP_VERSION,
          );
          const signature = await sha256(
            new Blob([
              JSON.stringify({
                ...archive.files,
                "app.json": JSON.stringify({
                  ...JSON.parse(archive.files["app.json"]),
                  exportedAt: 0,
                }),
              }),
            ]),
          );
          const previous = await mediaGet<{
            at: number;
            signature?: string;
            archive: MemoryArchive;
          }>("snapshots", "latest");
          if (previous?.signature === signature) archive = previous.archive;
          else {
            await mediaPut("snapshots", "latest", { at: Date.now(), signature, archive });
            const day = new Date().toLocaleDateString("sv-SE");
            if (!(await mediaGet("snapshots", `daily-${day}`)))
              await mediaPut("snapshots", `daily-${day}`, { at: Date.now(), archive });
            const saved = await mediaGet<{ signature: string }>("snapshots", "latest");
            if (saved?.signature !== signature) throw new Error("snapshot 다시 읽기 확인 실패");
            const old = (await mediaKeys("snapshots"))
              .filter(
                (k): k is string => typeof k === "string" && /^daily-\d{4}-\d{2}-\d{2}$/.test(k),
              )
              .sort()
              .reverse()
              .slice(7);
            if (old.length)
              await mediaTransaction<void>(["snapshots"], "readwrite", (tx, done) => {
                for (const k of old) tx.objectStore("snapshots").delete(k);
                done();
              });
          }
          const auto = await mediaGet<boolean>("settings", "memory-auto-folder");
          const encrypted = await mediaGet<boolean>("settings", "memory-encrypted");
          const folder = await savedExportFolder();
          if (!auto || encrypted || !folder) return;
          const last = await mediaGet<{ backupId: string; state: string }>(
            "backups",
            "last-memory",
          );
          if (last?.backupId === archive.backupId && last.state.includes("폴더")) return;
          const path = `VoiceGrok/MemoryBackups/${archive.deviceId}/${archiveName(archive.deviceId, archive.backupId, archive.createdAt)}`;
          await mediaPut("backups", "memory-pending", { archive, path });
          try {
            const handle = folder as FileSystemDirectoryHandle & {
              queryPermission?: (o: { mode: "readwrite" }) => Promise<PermissionState>;
            };
            if (
              handle.queryPermission &&
              (await handle.queryPermission({ mode: "readwrite" })) !== "granted"
            )
              throw new Error("폴더 쓰기 권한 재연결 필요");
            await writeVerified(folder, path, await encodeMemoryArchive(archive));
            await mediaPut("backups", "last-memory", {
              at: Date.now(),
              backupId: archive.backupId,
              state: "자동 폴더 쓰기/해시 확인 · NAS 미확인",
            });
            await mediaPut("backups", "memory-pending", null);
            await mediaPut("backups", "automatic-error", null);
          } catch (error) {
            await mediaPut(
              "backups",
              "automatic-error",
              error instanceof Error ? error.message : "폴더 쓰기 실패",
            );
          }
        });
      } catch (error) {
        await mediaPut(
          "backups",
          "automatic-error",
          error instanceof Error ? error.message : "앱 내부 snapshot 실패",
        ).catch(() => {});
      } finally {
        working = false;
        window.dispatchEvent(new Event(STORAGE_BACKUP_CHANGED));
      }
    };
    const timer = setTimeout(() => void run(), 30000);
    const foreground = () => {
      if (!document.hidden) void run();
    };
    document.addEventListener("visibilitychange", foreground);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", foreground);
    };
  }, [key, enabled]);
}
