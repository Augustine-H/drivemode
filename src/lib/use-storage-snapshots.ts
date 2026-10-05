import { useEffect, useRef } from "react";
import type { NangdokBackup } from "./nangdok-backup";
import { mediaPut, MEMORY_BACKUP_SETTINGS_CHANGED } from "./media-db";
import { runStorageSnapshot } from "./storage-snapshot";
import { StorageSnapshotScheduler } from "./storage-snapshot-scheduler";
export const STORAGE_BACKUP_CHANGED = "voice-grok-storage-backup-changed";
// Mounted independently of settings; serialize changes across all renders.
export function useStorageSnapshots(getBackup: () => NangdokBackup, key: string, enabled: boolean) {
  const getter = useRef(getBackup);
  const currentKey = useRef(key);
  const queue = useRef<StorageSnapshotScheduler | null>(null);
  getter.current = getBackup;
  currentKey.current = key;
  useEffect(() => {
    if (!enabled) return;
    const scheduler = new StorageSnapshotScheduler(
      async () => {
        try {
          await runStorageSnapshot(() => getter.current());
        } catch (error) {
          await mediaPut(
            "backups",
            "automatic-error",
            error instanceof Error ? error.message : "앱 내부 snapshot 실패",
          ).catch(() => {});
        } finally {
          window.dispatchEvent(new Event(STORAGE_BACKUP_CHANGED));
        }
      },
      () => !document.hidden,
      {
        now: Date.now,
        set: (callback, delay) => setTimeout(callback, delay),
        clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
      },
    );
    queue.current = scheduler;
    scheduler.update(currentKey.current);
    const foreground = () => scheduler.resume();
    const settings = () => scheduler.request();
    document.addEventListener("visibilitychange", foreground);
    window.addEventListener(MEMORY_BACKUP_SETTINGS_CHANGED, settings);
    return () => {
      scheduler.stop();
      queue.current = null;
      document.removeEventListener("visibilitychange", foreground);
      window.removeEventListener(MEMORY_BACKUP_SETTINGS_CHANGED, settings);
    };
  }, [enabled]);
  useEffect(() => {
    queue.current?.update(key);
  }, [key]);
}
