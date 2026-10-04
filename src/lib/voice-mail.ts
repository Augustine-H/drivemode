export type VoiceMail = {
  id: string;
  personaId: string;
  personaName: string;
  direction: "sent" | "received";
  createdAt: number;
  text: string;
  audio: Blob[];
  mediaIds?: string[];
  mediaError?: string;
  heard: boolean;
  reply?: {
    dueAt: number;
    status: "pending" | "processing" | "failed" | "done";
    leaseUntil?: number;
    claimId?: string;
    text?: string;
    channel?: "chat" | "voice";
    error?: string;
  };
  replyTo?: string;
};
export const MAIL_CHANGED_EVENT = "voice-grok-mail-changed";
function notifyMailChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(MAIL_CHANGED_EVENT));
}

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
      if (mode === "readwrite") notifyMailChange();
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
export async function listVoiceMails() {
  const mails = await transaction<VoiceMail[]>("readonly", (store, done) => {
    const request = store.getAll();
    request.onsuccess = () =>
      done((request.result as VoiceMail[]).sort((a, b) => b.createdAt - a.createdAt));
  });
  const { readMediaBlob, getMedia } = await import("./media-repository");
  return Promise.all(
    mails.map(async (mail) => {
      if (!mail.mediaIds?.length) return mail;
      const parts = await Promise.all(
        mail.mediaIds.map(async (id) => {
          const item = await getMedia(id);
          return item?.lifecycle === "active"
            ? readMediaBlob(id).catch(() => undefined)
            : undefined;
        }),
      );
      return {
        ...mail,
        audio: parts.filter((part): part is Blob => !!part),
        mediaError: parts.some((p) => !p)
          ? "음성 원본이 없습니다. 라이브러리에서 복원하세요."
          : undefined,
      };
    }),
  );
}
async function managedMail(mail: VoiceMail, legacy = false) {
  if (mail.mediaIds?.length) return { ...mail, audio: [] };
  const { getMedia, ingestMedia } = await import("./media-repository");
  const ids: string[] = [];
  for (let i = 0; i < mail.audio.length; i++) {
    const id = `mail-${mail.id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 70)}-${i}`;
    let item = await getMedia(id);
    if (!item)
      item = await ingestMedia({
        id,
        type: "voice",
        origin: legacy ? "legacy" : mail.direction === "received" ? "generated" : "uploaded",
        blob: mail.audio[i],
        personaId: mail.personaId,
        createdAt: mail.createdAt,
        description: `${mail.personaName} 보이스 메일 ${i + 1}`,
        refs: [
          {
            conversationId: `mail:${mail.personaId}`,
            messageId: mail.id,
            personaId: mail.personaId,
          },
        ],
      });
    if (
      item.ingestState !== "complete" ||
      item.availability !== "local" ||
      item.lifecycle !== "active"
    )
      return {
        ...mail,
        mediaIds: undefined,
        mediaError: item.error ?? "음성 파일 저장이 확인되지 않았습니다.",
      };
    ids.push(id);
  }
  return { ...mail, audio: [], mediaIds: ids };
}
export async function migrateVoiceMailMedia() {
  for (const mail of await listVoiceMails()) {
    if (mail.mediaIds?.length) continue;
    const managed = await managedMail(mail, true);
    if (!managed.mediaIds?.length) continue;
    const { mediaPut } = await import("./media-db");
    await mediaPut("staging", `legacy-mail-${mail.id}`, mail);
    await transaction<void>("readwrite", (store, done) => {
      const req = store.get(mail.id);
      req.onsuccess = () => {
        if (req.result && !req.result.mediaIds?.length)
          store.put({ ...req.result, audio: [], mediaIds: managed.mediaIds });
        done();
      };
    });
  }
}
export async function addVoiceMail(mail: VoiceMail) {
  validateMail(mail);
  mail = await managedMail(mail);
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
export async function removeVoiceMail(id: string) {
  const mail = await transaction<VoiceMail | undefined>("readonly", (store, done) => {
    const r = store.get(id);
    r.onsuccess = () => done(r.result);
  });
  if (mail) {
    const { detachConversationMedia } = await import("./media-repository");
    await detachConversationMedia(new Set([`mail:${mail.personaId}\0${id}`]));
  }
  return transaction<void>("readwrite", (store, done) => {
    store.delete(id);
    done();
  });
}
export async function deleteVoiceMails(personaId?: string, trashTemporary = false) {
  const mails = await transaction<VoiceMail[]>("readonly", (store, done) => {
    const r = store.getAll();
    r.onsuccess = () =>
      done(r.result.filter((m: VoiceMail) => !personaId || m.personaId === personaId));
  });
  const { detachConversationMedia } = await import("./media-repository");
  await detachConversationMedia(
    new Set(mails.map((m) => `mail:${m.personaId}\0${m.id}`)),
    trashTemporary,
  );
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

export async function updateMailReply(
  id: string,
  reply: VoiceMail["reply"],
  expectedStatus?: string,
  expectedClaim?: string,
) {
  return transaction<boolean>("readwrite", (store, done) => {
    const request = store.get(id);
    request.onsuccess = () => {
      if (
        !request.result ||
        (expectedStatus && request.result.reply?.status !== expectedStatus) ||
        (expectedClaim && request.result.reply?.claimId !== expectedClaim)
      ) {
        done(false);
        return;
      }
      store.put({ ...request.result, reply });
      done(true);
    };
  });
}

export function claimMailReply(id: string, now: number, claimId: string) {
  return transaction<boolean>("readwrite", (store, done) => {
    const request = store.get(id);
    request.onsuccess = () => {
      const mail = request.result as VoiceMail | undefined;
      const reply = mail?.reply;
      if (
        !mail ||
        !reply ||
        reply.dueAt > now ||
        reply.status === "done" ||
        reply.status === "failed" ||
        (reply.status === "processing" && (reply.leaseUntil ?? 0) > now)
      ) {
        done(false);
        return;
      }
      store.put({
        ...mail,
        reply: { ...reply, status: "processing", leaseUntil: now + 180000, claimId },
      });
      done(true);
    };
  });
}

export async function completeVoiceReply(sourceId: string, response: VoiceMail, claimId: string) {
  validateMail(response);
  response = await managedMail(response);
  return transaction<boolean>("readwrite", (store, done) => {
    const source = store.get(sourceId);
    source.onsuccess = () => {
      if (
        !source.result?.reply ||
        source.result.reply.status !== "processing" ||
        source.result.reply.claimId !== claimId
      ) {
        done(false);
        return;
      }
      const count = store.count();
      count.onsuccess = () => {
        if (count.result >= MAIL_COUNT) {
          done(false);
          return;
        }
        store.put(response);
        store.put({
          ...source.result,
          reply: { ...source.result.reply, status: "done", channel: "voice" },
        });
        done(true);
      };
    };
  });
}
