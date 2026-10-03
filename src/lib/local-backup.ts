export const LOCAL_BACKUP_KEY = "voice-grok-local-backup";

export function saveLocalBackup(storage: Pick<Storage, "setItem" | "getItem">, json: string) {
  storage.setItem(LOCAL_BACKUP_KEY, json);
  if (storage.getItem(LOCAL_BACKUP_KEY) !== json) throw new Error("기기 백업 확인 실패");
}

export function readLocalBackup(storage: Pick<Storage, "getItem">) {
  return storage.getItem(LOCAL_BACKUP_KEY);
}
