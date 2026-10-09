import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  naverActionSchema,
  naverEditableDraftSchema,
  naverBase64Bytes,
  type NaverAction,
  type NaverDraft,
  type NaverMailItem,
  type NaverMailMessage,
  type NaverSavedDraft,
  type NaverDraftSync,
} from "./naver-mail-contract.ts";
import { nasAccess } from "./nas-access.ts";
import { clientOriginAllowed, sessionDevice } from "./public-access.server.ts";
import { GOOGLE_APP_ORIGIN } from "./google-workspace-contract.ts";

export class NaverError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
const errors: Record<string, string> = {
  access: "인증된 NAS 앱에서 네이버 메일을 연결하세요.",
  origin: "안전한 앱 주소에서 다시 요청하세요.",
  input: "입력 내용과 이메일 주소를 확인하세요.",
  disconnected: "설정에서 네이버 메일을 먼저 연결하세요.",
  authentication: "네이버 IMAP 사용 설정과 2단계 인증의 앱 비밀번호를 확인하세요.",
  upstream: "네이버 메일 요청을 완료하지 못했습니다. 연결 설정을 확인하세요.",
  stale: "메일 선택이 만료되었습니다. 목록을 다시 조회하세요.",
  size: "메일 원문은 20MB 이하, 첨부파일은 파일당·합계 10MB 이하, 최대 5개를 지원합니다.",
  draft_conflict:
    "네이버에서 초안이 변경되었거나 이동됐습니다. 임시보관함에서 다시 불러온 뒤 저장하세요.",
  draft_uncertain:
    "초안 저장 결과를 확인하지 못했습니다. 저장됐을 수 있으므로 네이버 임시보관함을 확인한 뒤 다시 요청하세요.",
  drafts: "네이버 임시보관함 또는 안전한 초안 저장 기능을 찾지 못했습니다.",
  draft_complex:
    "참조·숨은참조가 있는 네이버 초안은 웹메일에서 수정하세요. 받는 사람을 누락하지 않도록 불러오지 않았습니다.",
  confirmation: "확인이 만료되었거나 이미 사용되었습니다. 다시 요청하세요.",
  uncertain:
    "발송 결과를 확인하지 못했습니다. 이미 발송됐을 수 있으므로 네이버 메일에서 확인한 뒤 다시 요청하세요.",
  partial:
    "일부 받는 사람만 접수됐습니다. 네이버 메일에서 발송 결과를 확인하고 전체 재전송은 피하세요.",
  trash: "휴지통 메일함을 찾지 못했습니다. 메일함 이동을 사용하세요.",
  move_unsupported:
    "네이버 서버에서 안전한 개별 메일 이동을 지원하지 않습니다. 네이버 메일 화면에서 이동해 주세요.",
  ai: "요청을 해석하지 못했습니다. 네이버 메일 설정의 조회·초안 양식을 사용하세요.",
};
export type NaverCredentials = { email: string; password: string; generation: string };
export interface NaverStore {
  read(): Promise<NaverCredentials | null>;
  write(value: NaverCredentials | null): Promise<void>;
  readDraft?(owner: string): Promise<NaverSavedDraft | null>;
  writeDraft?(owner: string, value: NaverSavedDraft | null): Promise<void>;
}
export class NaverCredentialStore implements NaverStore {
  directory: string;
  constructor(directory: string) {
    this.directory = directory;
  }
  private async key() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, "key");
    try {
      await writeFile(path, randomBytes(32), { flag: "wx", mode: 0o600 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    const key = await readFile(path);
    if (key.length !== 32) throw Error("store");
    return key;
  }
  async read() {
    let bytes: Buffer;
    try {
      bytes = await readFile(join(this.directory, "credentials.enc"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
    const decipher = createDecipheriv("aes-256-gcm", await this.key(), bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from("voicegrok-naver-v1"));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(),
    ) as NaverCredentials | null;
  }
  async write(value: NaverCredentials | null) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", await this.key(), iv);
    cipher.setAAD(Buffer.from("voicegrok-naver-v1"));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]),
      tmp = join(this.directory, `credentials-${randomBytes(8).toString("hex")}.tmp`);
    await writeFile(tmp, Buffer.concat([iv, cipher.getAuthTag(), encrypted]), { mode: 0o600 });
    await rename(tmp, join(this.directory, "credentials.enc"));
    for (const file of await readdir(this.directory))
      if (/^draft-[a-f0-9]{64}\.enc$/.test(file)) await unlink(join(this.directory, file));
  }
  private draftName(owner: string) {
    return `draft-${createHash("sha256").update(owner).digest("hex")}.enc`;
  }
  async readDraft(owner: string): Promise<NaverSavedDraft | null> {
    const name = this.draftName(owner);
    let bytes: Buffer;
    try {
      bytes = await readFile(join(this.directory, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (bytes.length > 14_000_000 || bytes.length < 28) throw Error("draft store");
    const decipher = createDecipheriv("aes-256-gcm", await this.key(), bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(`voicegrok-naver-draft-v1:${name}`));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(),
    );
  }
  async writeDraft(owner: string, value: NaverSavedDraft | null) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const name = this.draftName(owner),
      path = join(this.directory, name);
    if (!value) {
      try {
        await unlink(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      return;
    }
    const files = await readdir(this.directory);
    if (
      !files.includes(name) &&
      files.filter((file) => /^draft-[a-f0-9]{64}\.enc$/.test(file)).length >= 20
    )
      throw new NaverError("input", 429);
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", await this.key(), iv);
    cipher.setAAD(Buffer.from(`voicegrok-naver-draft-v1:${name}`));
    const bytes = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    if (bytes.length > 13_999_972) throw new NaverError("size", 413);
    const tmp = join(this.directory, `draft-${randomBytes(16).toString("hex")}.tmp`);
    await writeFile(tmp, Buffer.concat([iv, cipher.getAuthTag(), bytes]), { mode: 0o600 });
    await rename(tmp, path);
  }
}
export type NaverIdentity = { mailbox: string; validity: string; uid: number; generation: string };
export function naverIdentity(id: string, generation: string): NaverIdentity {
  try {
    const row = JSON.parse(Buffer.from(id, "base64url").toString());
    if (
      typeof row.mailbox !== "string" ||
      !row.mailbox ||
      row.mailbox.length > 300 ||
      !/^\d+$/.test(row.validity) ||
      !Number.isSafeInteger(row.uid) ||
      row.uid < 1 ||
      row.generation !== generation
    )
      throw Error();
    return row;
  } catch {
    throw new NaverError("stale", 409);
  }
}
export interface NaverTransport {
  verify(credentials: NaverCredentials): Promise<void>;
  mailboxes(
    credentials: NaverCredentials,
  ): Promise<{ path: string; name: string; specialUse?: string }[]>;
  list(
    credentials: NaverCredentials,
    mailbox: string,
    q: string,
    unread: boolean,
  ): Promise<NaverMailItem[]>;
  message(credentials: NaverCredentials, identity: NaverIdentity): Promise<NaverMailMessage>;
  attachment(
    credentials: NaverCredentials,
    identity: NaverIdentity,
    index: number,
  ): Promise<{ name: string; data: string; size: number }>;
  forwardDraft(
    credentials: NaverCredentials,
    identity: NaverIdentity,
    includeAttachments: boolean,
  ): Promise<NaverDraft>;
  loadDraft(
    credentials: NaverCredentials,
    identity: NaverIdentity,
  ): Promise<{ draft: NaverDraft; sync: NaverDraftSync }>;
  syncDraft(
    credentials: NaverCredentials,
    draft: NaverDraft,
    previous?: NaverDraftSync,
  ): Promise<{ sync: NaverDraftSync; previousArchived: boolean }>;
  archiveDraft(credentials: NaverCredentials, previous: NaverDraftSync): Promise<void>;
  mutate(
    credentials: NaverCredentials,
    identity: NaverIdentity,
    action: Exclude<NaverAction, { operation: "send" | "syncDraft" }>,
  ): Promise<void>;
  send(
    credentials: NaverCredentials,
    draft: NaverDraft,
  ): Promise<{ messageId: string; accepted: number; rejected: number }>;
}
export class NaverMail {
  store: NaverStore;
  transport: NaverTransport;
  private proposals = new Map<
    string,
    {
      owner: string;
      generation: string;
      action: NaverAction;
      expiresAt: number;
      sync?: NaverDraftSync;
    }
  >();
  private drafts = new Map<
    string,
    { generation: string; draft: NaverDraft; expiresAt: number; sync?: NaverDraftSync }
  >();
  constructor(store: NaverStore, transport: NaverTransport) {
    this.store = store;
    this.transport = transport;
  }
  async credentials() {
    const value = await this.store.read();
    if (!value) throw new NaverError("disconnected", 401);
    return value;
  }
  async status() {
    const value = await this.store.read();
    return { connected: !!value, email: value?.email || null };
  }
  async connect(input: unknown) {
    const result = z
      .object({
        email: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9._-]+@naver\.com$/),
        password: z
          .string()
          .min(8)
          .max(128)
          .regex(/^[^\r\n]+$/),
      })
      .strict()
      .safeParse(input);
    if (!result.success) throw new NaverError("input");
    const credentials = { ...result.data, generation: randomBytes(16).toString("hex") };
    await this.transport.verify(credentials);
    await this.store.write(credentials);
    this.proposals.clear();
    this.drafts.clear();
    return this.status();
  }
  async disconnect() {
    await this.store.write(null);
    this.proposals.clear();
    this.drafts.clear();
    return { connected: false };
  }
  async mailboxes() {
    return { items: await this.transport.mailboxes(await this.credentials()) };
  }
  async messages(mailbox = "INBOX", q = "", unread = false) {
    return { items: await this.transport.list(await this.credentials(), mailbox, q, unread) };
  }
  async message(id: string) {
    const credentials = await this.credentials();
    return this.transport.message(credentials, naverIdentity(id, credentials.generation));
  }
  async attachment(id: string, index: number) {
    if (!Number.isSafeInteger(index) || index < 0 || index > 99) throw new NaverError("input");
    const credentials = await this.credentials();
    return this.transport.attachment(credentials, naverIdentity(id, credentials.generation), index);
  }
  private prune() {
    for (const [id, row] of this.proposals)
      if (row.expiresAt <= Date.now()) this.proposals.delete(id);
    for (const [id, row] of this.drafts) if (row.expiresAt <= Date.now()) this.drafts.delete(id);
  }
  async draft(owner: string) {
    this.prune();
    const credentials = await this.credentials();
    let row = this.drafts.get(owner);
    if (row && row.generation !== credentials.generation) {
      this.drafts.delete(owner);
      row = undefined;
    }
    if (!row && this.store.readDraft) {
      const saved = await this.store.readDraft(owner);
      if (
        saved?.generation === credentials.generation &&
        naverEditableDraftSchema.safeParse(saved.draft).success
      ) {
        row = { ...saved, expiresAt: Date.now() + 3600000 };
        this.drafts.set(owner, row);
      }
    }
    return row?.generation === credentials.generation ? row.draft : null;
  }
  async saveDraft(owner: string, input: unknown, newDraft = false) {
    const parsed = naverEditableDraftSchema.safeParse(input);
    if (!parsed.success) throw new NaverError("input");
    const credentials = await this.credentials();
    await this.draft(owner);
    this.prune();
    if (this.drafts.size >= 100 && !this.drafts.has(owner)) throw new NaverError("input", 429);
    for (const [id, row] of this.proposals) if (row.owner === owner) this.proposals.delete(id);
    const saved = {
      generation: credentials.generation,
      draft: parsed.data,
      expiresAt: Date.now() + 3600000,
      sync: newDraft ? undefined : this.drafts.get(owner)?.sync,
    };
    await this.store.writeDraft?.(owner, saved);
    this.drafts.set(owner, saved);
    return parsed.data;
  }
  async clearDraft(owner: string) {
    await this.credentials();
    await this.store.writeDraft?.(owner, null);
    this.drafts.delete(owner);
    for (const [id, row] of this.proposals) if (row.owner === owner) this.proposals.delete(id);
    return { draft: null };
  }
  async forwardDraft(id: string, includeAttachments = true) {
    const credentials = await this.credentials();
    return this.transport.forwardDraft(
      credentials,
      naverIdentity(id, credentials.generation),
      includeAttachments,
    );
  }
  async loadDraft(owner: string, id: string) {
    const credentials = await this.credentials();
    const loaded = await this.transport.loadDraft(
      credentials,
      naverIdentity(id, credentials.generation),
    );
    const parsed = naverEditableDraftSchema.safeParse(loaded.draft);
    if (!parsed.success) throw new NaverError("input");
    const row = {
      generation: credentials.generation,
      draft: parsed.data,
      sync: loaded.sync,
      expiresAt: Date.now() + 3600000,
    };
    await this.store.writeDraft?.(owner, row);
    this.drafts.set(owner, row);
    for (const [id, proposal] of this.proposals)
      if (proposal.owner === owner) this.proposals.delete(id);
    return row.draft;
  }
  async replyDraft(id: string) {
    const original = await this.message(id);
    return {
      to: original.replyTo,
      subject: /^re:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`,
      text: "",
      attachments: [],
      ...(original.messageId
        ? {
            inReplyTo: original.messageId,
            references: [original.references, original.messageId]
              .filter(Boolean)
              .join(" ")
              .slice(-2000),
          }
        : {}),
    };
  }
  async propose(owner: string, input: unknown) {
    const parsed = naverActionSchema.safeParse(input);
    if (!parsed.success) throw new NaverError("input");
    const action = parsed.data,
      credentials = await this.credentials();
    if (
      action.operation === "syncDraft" &&
      !action.draft.to &&
      !action.draft.cc &&
      !action.draft.bcc &&
      !action.draft.subject &&
      !action.draft.text &&
      !action.draft.attachments.length
    )
      throw new NaverError("input");
    this.prune();
    if (this.proposals.size >= 20) throw new NaverError("confirmation", 429);
    await this.draft(owner);
    const sync = this.drafts.get(owner)?.sync;
    let title = "네이버 메일 발송",
      details = "";
    if (action.operation === "send" || action.operation === "syncDraft") {
      details = `보내는 사람: ${credentials.email}\n받는 사람: ${action.draft.to || "없음"}\n참조(CC): ${action.draft.cc || "없음"}\n숨은참조(BCC): ${action.draft.bcc || "없음"}\n제목: ${action.draft.subject || "(제목 없음)"}\n첨부: ${action.draft.attachments.map((a) => `${a.name} (${naverBase64Bytes(a.data)} bytes)`).join(", ") || "없음"}\n\n${action.draft.text}`;
      if (action.operation === "syncDraft") {
        title = "네이버 임시보관함에 초안 저장";
        details += `\n\n발송하지 않습니다.${sync ? " 새 저장이 성공한 뒤 이전 초안은 휴지통으로 옮깁니다." : " 네이버 임시보관함에 새 초안을 만듭니다."}`;
      }
    } else {
      const mail = await this.message(action.id);
      title =
        action.operation === "mark"
          ? "네이버 메일 읽음 상태 변경"
          : action.operation === "flag"
            ? "네이버 메일 중요 표시 변경"
            : action.operation === "trash"
              ? "네이버 메일 휴지통 이동"
              : "네이버 메일함 이동";
      details = `${mail.from}\n${mail.subject}\n${action.operation === "mark" ? (action.unread ? "안읽음으로 변경" : "읽음으로 변경") : action.operation === "flag" ? (action.flagged ? "중요 표시 설정 (읽음 상태는 바꾸지 않음)" : "중요 표시 해제 (읽음 상태는 바꾸지 않음)") : action.operation === "move" ? `이동할 메일함: ${action.mailbox}` : "휴지통으로 이동 (영구 삭제하지 않음)"}`;
    }
    // A new preview supersedes this session's old previews.
    for (const [id, row] of this.proposals) if (row.owner === owner) this.proposals.delete(id);
    const id = randomBytes(24).toString("base64url"),
      expiresAt = Date.now() + 600000;
    this.proposals.set(id, { owner, generation: credentials.generation, action, expiresAt, sync });
    return { id, title, details, expiresAt, provider: "naver" as const };
  }
  async execute(owner: string, id: string) {
    this.prune();
    const row = this.proposals.get(id),
      credentials = await this.credentials();
    if (!row || row.owner !== owner || row.generation !== credentials.generation)
      throw new NaverError("confirmation", 409);
    this.proposals.delete(id);
    if (row.action.operation === "syncDraft") {
      let result;
      try {
        result = await this.transport.syncDraft(credentials, row.action.draft, row.sync);
      } catch (error) {
        if (
          error instanceof NaverError &&
          ["draft_conflict", "drafts", "size"].includes(error.code)
        )
          throw error;
        throw new NaverError("draft_uncertain", 502);
      }
      const saved = {
        generation: credentials.generation,
        draft: row.action.draft,
        sync: result.sync,
        expiresAt: Date.now() + 3600000,
      };
      try {
        await this.store.writeDraft?.(owner, saved);
      } catch {
        throw new NaverError("draft_uncertain", 502);
      }
      this.drafts.set(owner, saved);
      return {
        text: `네이버 임시보관함에 초안을 저장했습니다.${row.sync && !result.previousArchived ? " 이전 초안은 휴지통으로 이동하지 못해 그대로 남아 있습니다." : ""}`,
        draft: saved.draft,
      };
    }
    if (row.action.operation === "send") {
      let result;
      try {
        result = await this.transport.send(credentials, row.action.draft);
      } catch {
        throw new NaverError("uncertain", 502);
      }
      if (result.rejected) throw new NaverError("partial", 502);
      if (!result.accepted) throw new NaverError("uncertain", 502);
      let cleanup = "";
      if (row.sync) {
        try {
          await this.transport.archiveDraft(credentials, row.sync);
        } catch {
          cleanup = " 네이버 임시보관함의 초안은 남아 있습니다. 발송 결과를 확인하고 정리하세요.";
        }
      }
      this.drafts.delete(owner);
      try {
        await this.store.writeDraft?.(owner, null);
      } catch {
        cleanup += " 앱 초안 정리에 실패했습니다. 다시 발송하지 마세요.";
      }
      return {
        text: "네이버 발송 서버가 메일을 접수했습니다." + cleanup,
        messageId: result.messageId,
      };
    }
    await this.transport.mutate(
      credentials,
      naverIdentity(row.action.id, credentials.generation),
      row.action,
    );
    return { text: "네이버 메일 변경을 완료했습니다." };
  }
}
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
let service: NaverMail | undefined,
  queue: Promise<unknown> = Promise.resolve();
export async function naverMail(request: Request) {
  const access = nasAccess(request.headers),
    origin = request.headers.get("origin"),
    trusted =
      !!origin &&
      (origin === access.origin || origin === GOOGLE_APP_ORIGIN || clientOriginAllowed(origin));
  const cors = (response: Response) => {
    if (trusted) {
      response.headers.set("access-control-allow-origin", origin!);
      response.headers.set("access-control-allow-credentials", "true");
      response.headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
      response.headers.set("access-control-allow-headers", "Content-Type");
      response.headers.set("vary", "Origin");
    }
    return response;
  };
  if (!access.allowed) return cors(json({ error: errors.access }, 403));
  if ((origin || request.method === "POST") && !trusted) return json({ error: errors.origin }, 403);
  if (request.headers.get("x-forwarded-proto") !== "https")
    return cors(json({ error: errors.origin }, 403));
  if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
  const owner =
    sessionDevice(request.headers, "access") ||
    `tailscale:${request.headers.get("tailscale-user-login")}`;
  const run = async () => {
    try {
      service ??= new NaverMail(
        new NaverCredentialStore(process.env.NAVER_MAIL_DATA_DIR || "/run/google/naver"),
        await (await import("./naver-mail-transport.server.ts")).createNaverTransport(),
      );
      const url = new URL(request.url),
        action = url.searchParams.get("action") || "status";
      if (request.method === "GET") {
        if (action === "status") return json(await service.status());
        if (action === "mailboxes") return json(await service.mailboxes());
        if (action === "messages")
          return json(
            await service.messages(
              (url.searchParams.get("mailbox") || "INBOX").slice(0, 300),
              (url.searchParams.get("q") || "").slice(0, 500),
              url.searchParams.get("unread") === "true",
            ),
          );
        if (action === "message")
          return json(await service.message((url.searchParams.get("id") || "").slice(0, 1500)));
        if (action === "attachment") {
          const index = url.searchParams.get("index");
          if (index === null || !/^\d{1,2}$/.test(index)) throw new NaverError("input");
          return json(
            await service.attachment(
              (url.searchParams.get("id") || "").slice(0, 1500),
              Number(index),
            ),
          );
        }
        if (action === "draft") return json({ draft: await service.draft(owner) });
      }
      if (request.method === "POST") {
        let length = 0;
        const chunks: Uint8Array[] = [];
        const reader = request.body?.getReader();
        if (!reader) throw new NaverError("input");
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          length += part.value.length;
          if (length > 14_000_000) {
            await reader.cancel();
            throw new NaverError("size", 413);
          }
          chunks.push(part.value);
        }
        let data;
        try {
          data = JSON.parse(Buffer.concat(chunks).toString());
        } catch {
          throw new NaverError("input");
        }
        if (action === "connect") return json(await service.connect(data));
        if (action === "disconnect") return json(await service.disconnect());
        if (action === "draft") return json({ draft: await service.saveDraft(owner, data) });
        if (action === "clearDraft") return json(await service.clearDraft(owner));
        if (action === "loadDraft")
          return json({ draft: await service.loadDraft(owner, String(data.id || "")) });
        if (action === "forward")
          return json({
            draft: await service.saveDraft(
              owner,
              await service.forwardDraft(String(data.id || ""), data.includeAttachments !== false),
              true,
            ),
          });
        if (action === "reply")
          return json({
            draft: await service.saveDraft(
              owner,
              await service.replyDraft(String(data.id || "")),
              true,
            ),
          });
        if (action === "propose") return json({ proposal: await service.propose(owner, data) });
        if (action === "execute") return json(await service.execute(owner, String(data.id || "")));
        if (action === "chat")
          return json(
            await (await import("./naver-mail-chat.server.ts")).naverChat(service, owner, data),
          );
      }
      return json({ error: "지원하지 않는 네이버 요청입니다." }, 405);
    } catch (error) {
      const known = error instanceof NaverError;
      return json(
        {
          error: errors[known ? error.code : "upstream"] || errors.upstream,
          errorCode: known ? error.code : "upstream",
        },
        known ? error.status : 502,
      );
    }
  };
  const result = queue.then(run, run);
  queue = result.then(
    () => {},
    () => {},
  );
  return cors(await result);
}
