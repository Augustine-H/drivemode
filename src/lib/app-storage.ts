// Original legacy data stays intact until a complete IndexedDB transaction succeeds.
const LEGACY_KEY = "nangdok-v1";
const STORES = [
  "conversations",
  "summaries",
  "personaMemories",
  "personaDefinitions",
  "settings",
  "metadata",
] as const;
type Snapshot = Record<string, unknown>;
let opening: Promise<IDBDatabase> | undefined;
let queue = Promise.resolve();
let last: Snapshot | undefined;
function database() {
  if (!opening)
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("voice-grok-memory-v2", 1);
      const timer = setTimeout(() => reject(new Error("기억 저장소를 열지 못했습니다.")), 5000);
      request.onupgradeneeded = () =>
        STORES.forEach((name) => {
          if (!request.result.objectStoreNames.contains(name))
            request.result.createObjectStore(name);
        });
      request.onsuccess = () => {
        clearTimeout(timer);
        request.result.onversionchange = () => {
          request.result.close();
          opening = undefined;
          last = undefined;
        };
        resolve(request.result);
      };
      request.onerror = () => {
        clearTimeout(timer);
        reject(request.error);
      };
      request.onblocked = () => {
        clearTimeout(timer);
        reject(new Error("다른 창에서 저장소를 사용 중입니다."));
      };
    }).catch((error) => {
      opening = undefined;
      throw error;
    });
  return opening;
}
function requestValue<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function persist(snapshot: Snapshot) {
  const db = await database();
  const tx = db.transaction([...STORES], "readwrite");
  const finished = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("저장 실패"));
  });
  const { threads, personas, memoryV2, turns: _turns, ...settings } = snapshot;
  const memory = (memoryV2 ?? {}) as Record<string, unknown>;
  const rooms =
    threads ??
    (Array.isArray(_turns) && typeof settings.personaId === "string"
      ? { [settings.personaId]: _turns }
      : {});
  const home = typeof settings.personaId === "string" ? settings.personaId : "plain";
  const completeRooms = { ...(rooms as Record<string, unknown>) };
  if (Array.isArray(_turns) && !Object.hasOwn(completeRooms, home)) completeRooms[home] = _turns;
  if (!last || last.threads !== threads)
    tx.objectStore("conversations").put(completeRooms, "rooms");
  if (!last || last.personas !== personas)
    tx.objectStore("personaDefinitions").put(
      Array.isArray(personas)
        ? personas.map(({ memories: _memories, ...definition }) => definition)
        : [],
      "all",
    );
  if (!last || last.memoryV2 !== memoryV2 || last.personas !== personas) {
    tx.objectStore("summaries").put(memory.summaries ?? {}, "all");
    tx.objectStore("personaMemories").put(
      {
        longTerm: memory.longTerm ?? {},
        imported: Array.isArray(personas)
          ? Object.fromEntries(personas.map((p) => [p.id, p.memories]))
          : {},
      },
      "all",
    );
    const { summaries: _summaries, longTerm: _longTerm, ...preferences } = memory;
    tx.objectStore("metadata").put(
      { schemaVersion: 2, memory: preferences, migratedAt: Date.now() },
      "schema",
    );
  }
  tx.objectStore("settings").put(settings, "all");
  await finished;
  last = snapshot;
  try {
    localStorage.removeItem("voice-grok-memory-fallback");
  } catch {
    /* Legacy storage may be unavailable. IndexedDB is already saved. */
  }
}
export async function readAppState<T extends Snapshot>(legacy: T | null): Promise<T | null> {
  try {
    let fallback = false;
    try {
      fallback = localStorage.getItem("voice-grok-memory-fallback") === "1";
    } catch {
      /* IndexedDB can work while legacy storage is blocked. */
    }
    if (fallback && legacy) {
      await persist(legacy);
      return legacy;
    }
    const db = await database();
    const tx = db.transaction([...STORES], "readonly");
    const [rooms, personas, settings, meta, summaries, longTerm] = await Promise.all([
      requestValue(tx.objectStore("conversations").get("rooms")),
      requestValue(tx.objectStore("personaDefinitions").get("all")),
      requestValue(tx.objectStore("settings").get("all")),
      requestValue(tx.objectStore("metadata").get("schema")),
      requestValue(tx.objectStore("summaries").get("all")),
      requestValue(tx.objectStore("personaMemories").get("all")),
    ]);
    if (meta?.schemaVersion === 2 && settings && personas)
      return {
        ...settings,
        threads: rooms,
        personas: personas.map((p: Record<string, unknown>) => ({
          ...p,
          memories: longTerm?.imported?.[String(p.id)],
        })),
        memoryV2: {
          ...meta.memory,
          schemaVersion: 2,
          summaries,
          longTerm: longTerm?.longTerm ?? longTerm,
        },
      } as T;
    if (legacy) await persist(legacy);
  } catch {
    /* Private mode, quota and blocked upgrades retain legacy recovery. */
  }
  return legacy;
}
export function writeAppState(snapshot: Snapshot): Promise<boolean> {
  let saved = false;
  queue = queue
    .catch(() => {})
    .then(async () => {
      try {
        await persist(snapshot);
        saved = true;
      } catch {
        try {
          localStorage.setItem(LEGACY_KEY, JSON.stringify(snapshot));
          localStorage.setItem("voice-grok-memory-fallback", "1");
          saved = true;
        } catch {
          /* Keep live state; caller reports durable save failure. */
        }
      }
    });
  return queue.then(() => saved);
}
