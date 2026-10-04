const STORES = [
  "index",
  "blobs",
  "journal",
  "settings",
  "snapshots",
  "staging",
  "backups",
] as const;
export type MediaStore = (typeof STORES)[number];
let opening: Promise<IDBDatabase> | undefined;
export function mediaDatabase() {
  if (!opening)
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("voice-grok-media-v21", 1);
      let expired = false;
      const timer = setTimeout(() => {
        expired = true;
        reject(new Error("미디어 저장소가 응답하지 않습니다."));
      }, 5000);
      req.onupgradeneeded = () =>
        STORES.forEach((s) => {
          if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
        });
      req.onsuccess = () => {
        clearTimeout(timer);
        if (expired) {
          req.result.close();
          return;
        }
        req.result.onversionchange = () => {
          req.result.close();
          opening = undefined;
        };
        resolve(req.result);
      };
      req.onerror = () => {
        clearTimeout(timer);
        reject(req.error);
      };
      req.onblocked = () => {
        clearTimeout(timer);
        expired = true;
        reject(new Error("다른 창의 미디어 작업을 닫고 다시 시도하세요."));
      };
    }).catch((e) => {
      opening = undefined;
      throw e;
    });
  return opening;
}
export async function mediaTransaction<T>(
  stores: MediaStore[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction, done: (result: T) => void) => void,
): Promise<T> {
  const db = await mediaDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result: T;
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () =>
      reject(tx.error ?? new Error("미디어 저장 작업이 실패했습니다."));
    try {
      work(tx, (r) => {
        result = r;
      });
    } catch (e) {
      tx.abort();
      reject(e);
    }
  });
}
export function mediaGet<T>(store: MediaStore, key: IDBValidKey) {
  return mediaTransaction<T | undefined>([store], "readonly", (tx, done) => {
    const r = tx.objectStore(store).get(key);
    r.onsuccess = () => done(r.result);
  });
}
export function mediaPut<T>(store: MediaStore, key: IDBValidKey, value: T) {
  return mediaTransaction<void>([store], "readwrite", (tx, done) => {
    tx.objectStore(store).put(value, key);
    done();
  });
}
export function mediaAll<T>(store: MediaStore) {
  return mediaTransaction<T[]>([store], "readonly", (tx, done) => {
    const r = tx.objectStore(store).getAll();
    r.onsuccess = () => done(r.result);
  });
}
export function mediaKeys(store: MediaStore) {
  return mediaTransaction<IDBValidKey[]>([store], "readonly", (tx, done) => {
    const r = tx.objectStore(store).getAllKeys();
    r.onsuccess = () => done(r.result);
  });
}
export async function withMediaLock<T>(work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks)
    return navigator.locks.request("voice-grok-media-writer", work);
  // Atomic IDB lease serializes browsers without Web Locks. A heartbeat covers long writes.
  const token = crypto.randomUUID();
  const acquired = await mediaTransaction<boolean>(["settings"], "readwrite", (tx, done) => {
    const s = tx.objectStore("settings"),
      r = s.get("lease");
    r.onsuccess = () => {
      if (r.result?.until > Date.now()) {
        done(false);
        return;
      }
      s.put({ token, until: Date.now() + 60000 }, "lease");
      done(true);
    };
  });
  if (!acquired) throw new Error("다른 창에서 파일을 처리 중입니다. 잠시 후 다시 시도하세요.");
  const timer = setInterval(() => {
    void mediaTransaction<void>(["settings"], "readwrite", (tx, done) => {
      const s = tx.objectStore("settings"),
        r = s.get("lease");
      r.onsuccess = () => {
        if (r.result?.token === token) s.put({ token, until: Date.now() + 60000 }, "lease");
        done();
      };
    }).catch(() => {});
  }, 10000);
  try {
    return await work();
  } finally {
    clearInterval(timer);
    await mediaTransaction<void>(["settings"], "readwrite", (tx, done) => {
      const s = tx.objectStore("settings"),
        r = s.get("lease");
      r.onsuccess = () => {
        if (r.result?.token === token) s.delete("lease");
        done();
      };
    });
  }
}
