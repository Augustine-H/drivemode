import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { simpleParser } from "mailparser";
import { createHash } from "node:crypto";
import {
  NAVER_ATTACHMENT_LIMIT,
  NAVER_SOURCE_LIMIT,
  naverEditableDraftSchema,
  type NaverDraft,
  type NaverDraftSync,
} from "./naver-mail-contract.ts";
import { mailHtmlText } from "./mail-body.server.ts";
import { searchNaverRows } from "./naver-mail-search.server.ts";
import {
  NaverError,
  type NaverCredentials,
  type NaverTransport,
  type NaverIdentity,
} from "./naver-mail.server.ts";

/** Change only the requested system flag, preserving all other flags. */
export async function updateNaverFlag(
  client: Pick<ImapFlow, "messageFlagsAdd" | "messageFlagsRemove">,
  uid: number,
  action: { operation: "mark"; unread: boolean } | { operation: "flag"; flagged: boolean },
) {
  const flag = action.operation === "flag" ? "\\Flagged" : "\\Seen";
  const add = action.operation === "flag" ? action.flagged : !action.unread;
  const result = await (add
    ? client.messageFlagsAdd(String(uid), [flag], { uid: true })
    : client.messageFlagsRemove(String(uid), [flag], { uid: true }));
  if (!result) throw new NaverError("stale", 409);
}

export function naverImapOptions(credentials: NaverCredentials) {
  return {
    host: "imap.naver.com",
    port: 993,
    secure: true,
    auth: { user: credentials.email, pass: credentials.password },
    logger: false as const,
    disableAutoIdle: true,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    maxLiteralSize: NAVER_SOURCE_LIMIT,
    maxLineLength: 1048576,
    maxResponseSize: NAVER_SOURCE_LIMIT + 1048576,
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" as const },
  };
}
export function naverSmtpOptions(credentials: NaverCredentials) {
  return {
    host: "smtp.naver.com",
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: credentials.email, pass: credentials.password },
    logger: false,
    debug: false,
    pool: false,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    dnsTimeout: 10000,
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" as const },
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}
const idFor = (credentials: NaverCredentials, mailbox: string, validity: string, uid: number) =>
  Buffer.from(
    JSON.stringify({ mailbox, validity, uid, generation: credentials.generation }),
  ).toString("base64url");
async function parseSource(source: Buffer) {
  if (source.length > NAVER_SOURCE_LIMIT) throw new NaverError("size", 413);
  return simpleParser(source, {
    skipHtmlToText: true,
    skipTextToHtml: true,
    skipImageLinks: true,
    maxHtmlLengthToParse: NAVER_SOURCE_LIMIT,
  });
}
const safeName = (name?: string) =>
  (name || "첨부파일").replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, 200);
const fingerprint = (source: Buffer) => createHash("sha256").update(source).digest("hex");
export async function naverAttachmentFromSource(source: Buffer, index: number) {
  const mail = await parseSource(source);
  const file = mail.attachments[index];
  if (!file) throw new NaverError("input", 404);
  if (file.content.length > NAVER_ATTACHMENT_LIMIT) throw new NaverError("size", 413);
  return {
    name: safeName(file.filename),
    size: file.content.length,
    data: file.content.toString("base64"),
  };
}
export async function naverDraftFromSource(
  source: Buffer,
  forward = false,
  includeAttachments = true,
): Promise<NaverDraft> {
  const mail = await parseSource(source);
  if (
    includeAttachments &&
    (mail.attachments.length > 5 ||
      mail.attachments.reduce((sum, file) => sum + file.content.length, 0) > NAVER_ATTACHMENT_LIMIT)
  )
    throw new NaverError("size", 413);
  const draft = {
    to: forward
      ? ""
      : mail.to
        ? (Array.isArray(mail.to) ? mail.to.flatMap((item) => item.value) : mail.to.value)
            .map((item) => item.address || "")
            .join(", ")
        : "",
    ...(!forward && mail.cc
      ? {
          cc: (Array.isArray(mail.cc) ? mail.cc.flatMap((item) => item.value) : mail.cc.value)
            .map((item) => item.address || "")
            .join(", "),
        }
      : {}),
    ...(!forward && mail.bcc
      ? {
          bcc: (Array.isArray(mail.bcc) ? mail.bcc.flatMap((item) => item.value) : mail.bcc.value)
            .map((item) => item.address || "")
            .join(", "),
        }
      : {}),
    subject: forward ? `Fwd: ${mail.subject || "(제목 없음)"}` : mail.subject || "",
    text: `${forward ? `\n\n--- 전달한 메일 ---\n보낸 사람: ${mail.from?.text || ""}\n\n` : ""}${mail.text || mailHtmlText(mail.html || "")}`,
    attachments: includeAttachments
      ? mail.attachments.map((file) => ({
          name: safeName(file.filename),
          mimeType: /^[\w.+-]+\/[\w.+-]+$/.test(file.contentType)
            ? file.contentType
            : "application/octet-stream",
          data: file.content.toString("base64"),
        }))
      : [],
    ...(!forward
      ? {
          inReplyTo: mail.inReplyTo || undefined,
          references: Array.isArray(mail.references)
            ? mail.references.join(" ")
            : mail.references || undefined,
        }
      : {}),
  };
  const parsed = naverEditableDraftSchema.safeParse(draft);
  if (!parsed.success) throw new NaverError("input");
  return parsed.data;
}
async function readSource(client: ImapFlow, uid: number) {
  const meta = await client.fetchOne(String(uid), { size: true }, { uid: true });
  if (!meta) throw new NaverError("stale", 409);
  if (!meta.size || meta.size > NAVER_SOURCE_LIMIT) throw new NaverError("size", 413);
  const row = await client.fetchOne(String(uid), { source: true }, { uid: true });
  if (!row || !row.source) throw new NaverError("stale", 409);
  if (row.source.length > NAVER_SOURCE_LIMIT) throw new NaverError("size", 413);
  return row.source;
}
export function naverMimeOptions(credentials: NaverCredentials, draft: NaverDraft) {
  return {
    from: credentials.email,
    to: draft.to
      .split(/[,;]/)
      .map((part) => part.trim())
      .filter(Boolean),
    subject: draft.subject || "(제목 없음)",
    text: draft.text,
    inReplyTo: draft.inReplyTo,
    references: draft.references,
    cc: draft.cc
      ?.split(/[,;]/)
      .map((part) => part.trim())
      .filter(Boolean),
    bcc: draft.bcc
      ?.split(/[,;]/)
      .map((part) => part.trim())
      .filter(Boolean),
    attachments: draft.attachments.map((file) => ({
      filename: file.name,
      content: Buffer.from(file.data, "base64"),
      contentType: file.mimeType,
    })),
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}
async function draftMailbox(client: ImapFlow) {
  const boxes = await client.list();
  const drafts = boxes.find((box) => box.specialUse === "\\Drafts");
  if (!drafts || drafts.flags.has("\\Noselect")) throw new NaverError("drafts", 409);
  return {
    drafts: drafts.path,
    trash: boxes.find((box) => box.specialUse === "\\Trash" && !box.flags.has("\\Noselect"))?.path,
  };
}
async function checkedDraftSource(
  client: ImapFlow,
  credentials: NaverCredentials,
  sync: NaverDraftSync,
  mailbox: string,
) {
  const identity = (await import("./naver-mail.server.ts")).naverIdentity(
    sync.id,
    credentials.generation,
  );
  if (identity.mailbox !== mailbox || validity(client) !== identity.validity)
    throw new NaverError("draft_conflict", 409);
  let source: Buffer;
  try {
    source = await readSource(client, identity.uid);
  } catch (error) {
    if (error instanceof NaverError && error.code === "stale")
      throw new NaverError("draft_conflict", 409);
    throw error;
  }
  if (fingerprint(source) !== sync.fingerprint) throw new NaverError("draft_conflict", 409);
  return identity.uid;
}
function validity(client: ImapFlow) {
  if (!client.mailbox) throw new NaverError("stale", 409);
  return String(client.mailbox.uidValidity);
}
async function connection<T>(
  credentials: NaverCredentials,
  task: (client: ImapFlow) => Promise<T>,
) {
  const client = new ImapFlow(naverImapOptions(credentials));
  client.on("error", () => {
    /* No protocol or credential logs. */
  });
  const timer = setTimeout(() => client.close(), 75000);
  try {
    await client.connect();
    return await task(client);
  } catch (e) {
    if (e instanceof NaverError) throw e;
    throw new NaverError(
      (e as { authenticationFailed?: boolean })?.authenticationFailed
        ? "authentication"
        : "upstream",
      502,
    );
  } finally {
    clearTimeout(timer);
    client.close();
  }
}
async function locked<T>(
  credentials: NaverCredentials,
  identity: NaverIdentity,
  readOnly: boolean,
  task: (client: ImapFlow) => Promise<T>,
) {
  return connection(credentials, async (client) => {
    const lock = await client.getMailboxLock(identity.mailbox, { readOnly });
    try {
      if (validity(client) !== identity.validity) throw new NaverError("stale", 409);
      const exists = await client.fetchOne(String(identity.uid), { uid: true }, { uid: true });
      if (!exists) throw new NaverError("stale", 409);
      return await task(client);
    } finally {
      lock.release();
    }
  });
}
export async function syncNaverDraftWithClient(
  client: ImapFlow,
  credentials: NaverCredentials,
  draft: NaverDraft,
  previous?: NaverDraftSync,
) {
  const composer = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "windows",
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  const result = await composer.sendMail(naverMimeOptions(credentials, draft));
  const content = result.message as Buffer;
  if (content.length > NAVER_SOURCE_LIMIT) throw new NaverError("size", 413);
  const { drafts, trash } = await draftMailbox(client);
  if (!client.capabilities.has("UIDPLUS")) throw new NaverError("drafts", 409);
  const lock = await client.getMailboxLock(drafts, { readOnly: false });
  try {
    if (previous) await checkedDraftSource(client, credentials, previous, drafts);
    let appended;
    try {
      appended = await client.append(drafts, content, ["\\Draft", "\\Seen"]);
    } catch {
      throw new NaverError("draft_uncertain", 502);
    }
    if (
      !appended ||
      !appended.uid ||
      !appended.uidValidity ||
      String(appended.uidValidity) !== validity(client)
    )
      throw new NaverError("draft_uncertain", 502);
    const source = await readSource(client, appended.uid);
    const sync = {
      id: idFor(credentials, drafts, String(appended.uidValidity), appended.uid),
      fingerprint: fingerprint(source),
    };
    let previousArchived = !previous;
    if (previous && trash && trash !== drafts) {
      try {
        const uid = await checkedDraftSource(client, credentials, previous, drafts);
        previousArchived = !!(await client.messageMove(String(uid), trash, { uid: true }));
      } catch {
        /* New saved draft remains valid; preserve older draft on any conflict/failure. */
      }
    }
    return { sync, previousArchived };
  } finally {
    lock.release();
  }
}
export async function createNaverTransport(): Promise<NaverTransport> {
  return {
    async verify(credentials) {
      await connection(credentials, async (client) => {
        const lock = await client.getMailboxLock("INBOX", { readOnly: true });
        lock.release();
      });
      const smtp = nodemailer.createTransport(naverSmtpOptions(credentials));
      try {
        await smtp.verify();
      } catch {
        throw new NaverError("authentication", 401);
      } finally {
        smtp.close();
      }
    },
    async mailboxes(credentials) {
      return connection(credentials, async (client) =>
        (await client.list())
          .filter((box) => !box.flags.has("\\Noselect"))
          .slice(0, 100)
          .map((box) => ({ path: box.path, name: box.name, specialUse: box.specialUse })),
      );
    },
    async list(credentials, mailbox, q, unread) {
      return connection(credentials, async (client) => {
        const lock = await client.getMailboxLock(mailbox, { readOnly: true });
        try {
          const rows = await searchNaverRows(client, q, unread);
          return rows
            .sort((a, b) => b.uid - a.uid)
            .map((row) => ({
              id: idFor(credentials, mailbox, validity(client), row.uid),
              subject: row.envelope?.subject || "(제목 없음)",
              from: (row.envelope?.from || [])
                .map((person) =>
                  person.name ? `${person.name} <${person.address}>` : person.address,
                )
                .join(", "),
              date: row.envelope?.date ? new Date(row.envelope.date).toISOString() : "",
              unread: !row.flags?.has("\\Seen"),
              flagged: row.flags?.has("\\Flagged") || false,
            }));
        } finally {
          lock.release();
        }
      });
    },
    async message(credentials, identity) {
      return locked(credentials, identity, true, async (client) => {
        const meta = await client.fetchOne(
          String(identity.uid),
          { uid: true, size: true, envelope: true, flags: true },
          { uid: true },
        );
        if (!meta) throw new NaverError("stale", 409);
        if (!meta.size || meta.size > NAVER_SOURCE_LIMIT) throw new NaverError("size", 413);
        const row = await client.fetchOne(String(identity.uid), { source: true }, { uid: true });
        if (!row || !row.source) throw new NaverError("stale", 409);
        if (row.source.length > NAVER_SOURCE_LIMIT) throw new NaverError("size", 413);
        const mail = await simpleParser(row.source, {
          skipHtmlToText: true,
          skipTextToHtml: true,
          skipImageLinks: true,
          maxHtmlLengthToParse: NAVER_SOURCE_LIMIT,
        });
        return {
          id: idFor(credentials, identity.mailbox, identity.validity, identity.uid),
          subject: mail.subject || "(제목 없음)",
          from: mail.from?.text || "",
          date: mail.date?.toISOString() || "",
          unread: !meta.flags?.has("\\Seen"),
          flagged: meta.flags?.has("\\Flagged") || false,
          isDraft: meta.flags?.has("\\Draft") || false,
          text: (mail.text || mailHtmlText(mail.html || "")).slice(0, 100000),
          replyTo: mail.replyTo?.value[0]?.address || mail.from?.value[0]?.address || "",
          messageId: (mail.messageId || "").replace(/[\r\n]/g, ""),
          inReplyTo: (mail.inReplyTo || "").replace(/[\r\n]/g, "").slice(0, 500),
          references: (Array.isArray(mail.references)
            ? mail.references.join(" ")
            : mail.references || ""
          )
            .replace(/[\r\n]/g, "")
            .slice(-1500),
          attachments: mail.attachments.map((file) => ({
            name: file.filename || "첨부파일",
            size: file.size,
          })),
        };
      });
    },
    async attachment(credentials, identity, index) {
      return locked(credentials, identity, true, async (client) => {
        return naverAttachmentFromSource(await readSource(client, identity.uid), index);
      });
    },
    async forwardDraft(credentials, identity, includeAttachments) {
      return locked(credentials, identity, true, async (client) =>
        naverDraftFromSource(await readSource(client, identity.uid), true, includeAttachments),
      );
    },
    async loadDraft(credentials, identity) {
      return locked(credentials, identity, true, async (client) => {
        const { drafts } = await draftMailbox(client);
        if (identity.mailbox !== drafts) throw new NaverError("drafts", 409);
        const source = await readSource(client, identity.uid);
        return {
          draft: await naverDraftFromSource(source),
          sync: {
            id: idFor(credentials, identity.mailbox, identity.validity, identity.uid),
            fingerprint: fingerprint(source),
          },
        };
      });
    },
    async syncDraft(credentials, draft, previous) {
      return connection(credentials, (client) =>
        syncNaverDraftWithClient(client, credentials, draft, previous),
      );
    },
    async archiveDraft(credentials, previous) {
      await connection(credentials, async (client) => {
        const { drafts, trash } = await draftMailbox(client);
        if (
          !trash ||
          trash === drafts ||
          (!client.capabilities.has("MOVE") && !client.capabilities.has("UIDPLUS"))
        )
          throw new NaverError("drafts", 409);
        const lock = await client.getMailboxLock(drafts, { readOnly: false });
        try {
          const uid = await checkedDraftSource(client, credentials, previous, drafts);
          if (!(await client.messageMove(String(uid), trash, { uid: true })))
            throw new NaverError("draft_conflict", 409);
        } finally {
          lock.release();
        }
      });
    },
    async mutate(credentials, identity, action) {
      await locked(credentials, identity, false, async (client) => {
        if (action.operation === "mark" || action.operation === "flag") {
          await updateNaverFlag(client, identity.uid, action);
          return;
        }
        const boxes = await client.list();
        const destination =
          action.operation === "move"
            ? action.mailbox
            : boxes.find((box) => box.specialUse === "\\Trash")?.path;
        if (
          !destination ||
          !boxes.some((box) => box.path === destination && !box.flags.has("\\Noselect"))
        )
          throw new NaverError(action.operation === "trash" ? "trash" : "input");
        if (destination === identity.mailbox) throw new NaverError("input");
        // Do not let the client's MOVE fallback expunge unrelated deleted mail.
        if (!client.capabilities.has("MOVE") && !client.capabilities.has("UIDPLUS"))
          throw new NaverError("move_unsupported", 409);
        if (!(await client.messageMove(String(identity.uid), destination, { uid: true })))
          throw new NaverError("stale", 409);
      });
    },
    async send(credentials, draft) {
      const smtp = nodemailer.createTransport(naverSmtpOptions(credentials));
      try {
        const result = await smtp.sendMail(naverMimeOptions(credentials, draft));
        return {
          messageId: result.messageId,
          accepted: result.accepted.length,
          rejected: result.rejected.length,
        };
      } finally {
        smtp.close();
      }
    },
  };
}
