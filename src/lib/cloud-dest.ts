/** Puts a backup file in a folder the person picked, or hands it to the phone share sheet. */

const DB_NAME = "voice-grok-dest";
const STORE = "handles";
const KEY = "dir";
let savedDir: DestDir | null = null;
let handleLoaded = false;

type DestDir = FileSystemDirectoryHandle & {
  queryPermission?: (descriptor: { mode: "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: "readwrite" }) => Promise<PermissionState>;
};

type PickerWindow = Window & {
  showDirectoryPicker?: (options?: {
    mode?: "readwrite";
    id?: string;
  }) => Promise<FileSystemDirectoryHandle>;
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    id?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    startIn?: FileSystemDirectoryHandle;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle[]>;
};

export type CloudPlace =
  | { ok: true; where: string; via: "folder" | "share" | "file"; fresh: boolean }
  | {
      ok: false;
      reason: "cancel" | "preview" | "blocked" | "failed" | "permission" | "activation";
    };

export function backupFileName(exportedAt: string): string {
  const stamp = exportedAt.replace(/[:T.]/g, "-");
  return `voice-grok-${stamp || "backup"}.json`;
}

function pickerWindow(): PickerWindow {
  return window as PickerWindow;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readHandle(): Promise<DestDir | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await openDb();
    const handle = await new Promise<DestDir | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve((request.result as DestDir | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return handle;
  } catch {
    return null;
  }
}

async function writeHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function cloudFolderName(): Promise<string | null> {
  if (!handleLoaded) {
    const handle = await readHandle();
    if (!handleLoaded) savedDir = handle;
    handleLoaded = true;
  }
  return savedDir?.name ?? null;
}

async function allowed(dir: DestDir): Promise<boolean> {
  const descriptor = { mode: "readwrite" as const };
  try {
    // Request immediately in the click handler, before any IndexedDB or query awaits.
    if (dir.requestPermission) return (await dir.requestPermission(descriptor)) === "granted";
    if (dir.queryPermission) return (await dir.queryPermission(descriptor)) === "granted";
    return true;
  } catch {
    return false;
  }
}

async function writeNamed(
  dir: FileSystemDirectoryHandle,
  name: string,
  json: string,
): Promise<void> {
  const file = await dir.getFileHandle(name, { create: true });
  const stream = await file.createWritable();
  try {
    await stream.write(json);
    await stream.close();
    if ((await (await file.getFile()).text()) !== json)
      throw new Error("Backup verification failed");
  } catch (error) {
    await stream.abort().catch(() => undefined);
    throw error;
  }
}

function cancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function shareFile(
  json: string,
  name: string,
): Promise<"shared" | "cancel" | "no" | "failed"> {
  if (!navigator.share) return "no";
  for (const type of ["application/json", "text/plain"]) {
    const file = new File([json], name, { type });
    if (navigator.canShare && !navigator.canShare({ files: [file] })) continue;
    try {
      await navigator.share({ files: [file], title: name });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancel";
      return "failed";
    }
  }
  return "no";
}

async function pickFolder(name: string, json: string): Promise<CloudPlace | null> {
  const pick = pickerWindow().showDirectoryPicker;
  if (!pick) return null;
  try {
    const dir = await pick.call(window, { mode: "readwrite", id: "voice-grok" });
    try {
      await writeNamed(dir, name, json);
    } catch {
      return { ok: false, reason: "failed" };
    }
    savedDir = dir;
    handleLoaded = true;
    try {
      void writeHandle(dir).catch(() => undefined);
    } catch {
      /* the file is already in the folder */
    }
    return { ok: true, where: dir.name, via: "folder", fresh: true };
  } catch (error) {
    if (cancelled(error)) return { ok: false, reason: "cancel" };
    if (error instanceof DOMException && error.name === "SecurityError")
      return { ok: false, reason: "activation" };
    if (error instanceof DOMException && error.name === "NotAllowedError")
      return { ok: false, reason: "permission" };
    return { ok: false, reason: "blocked" };
  }
}

async function pickFile(name: string, json: string): Promise<CloudPlace | null> {
  const pick = pickerWindow().showSaveFilePicker;
  if (!pick) return null;
  try {
    const file = await pick.call(window, {
      suggestedName: name,
      id: "voice-grok-file",
      types: [{ description: "대화 파일", accept: { "application/json": [".json"] } }],
    });
    const stream = await file.createWritable();
    try {
      await stream.write(json);
      await stream.close();
      if ((await (await file.getFile()).text()) !== json)
        throw new Error("Backup verification failed");
    } catch (error) {
      await stream.abort().catch(() => undefined);
      throw error;
    }
    return { ok: true, where: file.name, via: "file", fresh: true };
  } catch (error) {
    if (cancelled(error)) return { ok: false, reason: "cancel" };
    if (error instanceof DOMException && error.name === "SecurityError")
      return { ok: false, reason: "activation" };
    if (error instanceof DOMException && error.name === "NotAllowedError")
      return { ok: false, reason: "permission" };
    return { ok: false, reason: "failed" };
  }
}

/** Opens a document provider on phones, or the remembered sync/NAS folder on desktop. */
export async function openCloudFile(): Promise<File | null> {
  const picker = pickerWindow().showOpenFilePicker;
  if (!picker) return null;
  const [handle] = await picker.call(window, {
    multiple: false,
    ...(savedDir ? { startIn: savedDir } : {}),
    types: [
      {
        description: "대화 파일",
        accept: { "application/json": [".json"], "text/plain": [".txt", ".md"] },
      },
    ],
  });
  return handle ? handle.getFile() : null;
}

export async function placeInCloud(
  json: string,
  name: string,
  retarget: boolean,
): Promise<CloudPlace> {
  if (window.parent !== window) return { ok: false, reason: "preview" };

  if (!retarget) {
    const saved = savedDir;
    if (saved) {
      if (!(await allowed(saved))) return { ok: false, reason: "permission" };
      try {
        await writeNamed(saved, name, json);
        return { ok: true, where: saved.name, via: "folder", fresh: false };
      } catch {
        return { ok: false, reason: "failed" };
      }
    }
  }

  const canPickFolder = Boolean(pickerWindow().showDirectoryPicker);
  if (!canPickFolder) {
    const shared = await shareFile(json, name);
    if (shared === "shared") return { ok: true, where: "", via: "share", fresh: false };
    if (shared === "cancel") return { ok: false, reason: "cancel" };
    if (shared === "failed") return { ok: false, reason: "failed" };
  }

  const folder = await pickFolder(name, json);
  if (folder) return folder;

  const file = await pickFile(name, json);
  if (file) return file;

  return { ok: false, reason: "blocked" };
}
