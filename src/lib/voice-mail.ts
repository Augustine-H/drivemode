export type VoiceMail = {
  id: string;
  personaId: string;
  personaName: string;
  direction: "sent" | "received";
  createdAt: number;
  text: string;
  audio: Blob[];
  heard: boolean;
};
export const MAIL_BYTES = 1_000_000;
export const MAIL_COUNT = 40;
const DB = "voice-grok-voice-mail";
const STORE = "messages";
export function mailSpeechChunks(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  const result: string[] = [];
  for (let start = 0; start < clean.length;) {
    let end = Math.min(start + 400, clean.length);
    if (end < clean.length && /[\uD800-\uDBFF]/.test(clean[end - 1])) end--;
    result.push(clean.slice(start, end));
    start = end;
  }
  return result;
}

export function validateMail(mail: VoiceMail) {
  if (
    !mail.id ||
    !mail.personaId ||
    !mail.personaName ||
    !["sent", "received"].includes(mail.direction)
  )
    throw new Error("보이스 메일 정보가 올바르지 않습니다.");
  if (
    !mail.audio.length ||
    mail.audio.length > 10 ||
    mail.audio.some(
      (part) => !(part instanceof Blob) || part.size === 0 || !part.type.startsWith("audio/"),
    )
  )
    throw new Error("유효한 음성 파일이 필요합니다.");
  if (mail.audio.reduce((sum, part) => sum + part.size, 0) > MAIL_BYTES)
    throw new Error("음성 메일은 1MB 이하로 남겨 주세요.");
  if (mail.text.length > 5000) throw new Error("메일 내용은 5천 글자 이하로 입력하세요.");
}
function openMailDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("음성 메일 저장소를 열 수 없습니다."));
    request.onblocked = () => reject(new Error("다른 창의 음성 메일을 닫고 다시 시도하세요."));
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore, result: (value: T) => void) => void,
): Promise<T> {
  const db = await openMailDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let result: T;
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(new Error("음성 메일 저장에 실패했습니다. 저장 공간을 확인하세요."));
    };
    try {
      work(tx.objectStore(STORE), (value) => {
        result = value;
      });
    } catch (error) {
      tx.abort();
      reject(error);
    }
  });
}
export function listVoiceMails() {
  return transaction<VoiceMail[]>("readonly", (store, done) => {
    const request = store.getAll();
    request.onsuccess = () =>
      done((request.result as VoiceMail[]).sort((a, b) => b.createdAt - a.createdAt));
  });
}
export async function addVoiceMail(mail: VoiceMail) {
  validateMail(mail);
  const added = await transaction<boolean>("readwrite", (store, done) => {
    const count = store.count();
    count.onsuccess = () => {
      if (count.result >= MAIL_COUNT) {
        done(false);
        return;
      }
      store.add(mail);
      done(true);
    };
  });
  if (!added) throw new Error("보이스 메일함이 가득 찼습니다. 기존 메일을 삭제하세요. (최대 40개)");
}
export function markVoiceMailHeard(id: string) {
  return transaction<void>("readwrite", (store, done) => {
    const request = store.get(id);
    request.onsuccess = () => {
      if (request.result) store.put({ ...request.result, heard: true });
      done();
    };
  });
}
export async function updateVoiceMailText(id: string, text: string) {
  if (text.length > 5000) throw new Error("메일 내용은 5천 글자 이하로 입력하세요.");
  const updated = await transaction<boolean>("readwrite", (store, done) => {
    const request = store.get(id);
    request.onsuccess = () => {
      if (!request.result) {
        done(false);
        return;
      }
      store.put({ ...request.result, text: text.trim() });
      done(true);
    };
  });
  if (!updated) throw new Error("이미 삭제된 메일입니다.");
}
export function removeVoiceMail(id: string) {
  return transaction<void>("readwrite", (store, done) => {
    store.delete(id);
    done();
  });
}
export function deleteVoiceMails(personaId?: string) {
  return transaction<void>("readwrite", (store, done) => {
    if (!personaId) {
      store.clear();
      done();
      return;
    }
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        done();
        return;
      }
      if (cursor.value.personaId === personaId) cursor.delete();
      cursor.continue();
    };
  });
}
