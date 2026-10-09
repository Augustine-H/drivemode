import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import nodemailer from "nodemailer";
import { simpleParser } from "mailparser";
import { naverDraftSchema, naverEditableDraftSchema } from "../src/lib/naver-mail-contract.ts";
import {
  naverDraftFromSource,
  naverMimeOptions,
  syncNaverDraftWithClient,
} from "../src/lib/naver-mail-transport.server.ts";
import { NaverMail } from "../src/lib/naver-mail.server.ts";
import { naverChat } from "../src/lib/naver-mail-chat.server.ts";
const account = { email: "test@naver.com", password: "fixture-only", generation: "g" };
const draft = {
  to: "to@example.com",
  cc: "cc@example.com",
  bcc: "hidden@example.com",
  subject: "recipients test",
  text: "test only",
  attachments: [],
};
test("To/CC/BCC addresses share a total limit; header injection and invalid addresses fail", () => {
  assert.equal(naverDraftSchema.safeParse(draft).success, true);
  assert.equal(naverDraftSchema.safeParse({ ...draft, to: "", cc: "" }).success, true);
  assert.equal(naverDraftSchema.safeParse({ ...draft, to: "", cc: "", bcc: "" }).success, false);
  for (const field of ["to", "cc", "bcc"]) {
    assert.equal(
      naverDraftSchema.safeParse({ ...draft, [field]: "valid@example.com\r\nBcc: bad@example.com" })
        .success,
      false,
    );
    assert.equal(naverEditableDraftSchema.safeParse({ ...draft, [field]: "bad" }).success, false);
  }
  const ten = Array.from({ length: 10 }, (_, i) => `test${i}@example.com`).join(",");
  assert.equal(naverDraftSchema.safeParse({ ...draft, to: ten, cc: "", bcc: "" }).success, true);
  assert.equal(naverEditableDraftSchema.safeParse({ ...draft, to: ten }).success, false);
});
test("draft IMAP MIME retains CC/BCC across save and import, forwarding excludes inherited recipients", async () => {
  let source;
  const client = {
    capabilities: new Set(["UIDPLUS"]),
    mailbox: { uidValidity: 1n },
    list: async () => [{ path: "Drafts", specialUse: "\\Drafts", flags: new Set() }],
    getMailboxLock: async () => ({ release() {} }),
    append: async (_path, bytes) => {
      source = bytes;
      return { uid: 1, uidValidity: 1n };
    },
    fetchOne: async (_uid, query) => (query.size ? { size: source.length } : { source }),
  };
  await syncNaverDraftWithClient(client, account, draft);
  const imported = await naverDraftFromSource(source);
  for (const field of ["to", "cc", "bcc"]) assert.equal(imported[field], draft[field]);
  const forward = await naverDraftFromSource(source, true);
  assert.equal(forward.to, "");
  assert.equal(forward.cc, undefined);
  assert.equal(forward.bcc, undefined);
});
test("actual SMTP transport delivers BCC in envelope while removing it from received headers", async () => {
  const recipients = [],
    sockets = new Set();
  let source = "";
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = "",
      data = false;
    socket.write("220 localhost fixture\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      while (buffer.includes("\r\n")) {
        const end = buffer.indexOf("\r\n"),
          line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data) {
          if (line === ".") {
            data = false;
            socket.write("250 accepted\r\n");
          } else source += line + "\r\n";
          continue;
        }
        if (/^EHLO/.test(line)) socket.write("250 localhost\r\n");
        else if (/^RCPT TO:/.test(line)) {
          recipients.push(line.match(/<([^>]+)>/)[1]);
          socket.write("250 recipient\r\n");
        } else if (line === "DATA") {
          data = true;
          socket.write("354 send data\r\n");
        } else if (line === "QUIT") {
          socket.end("221 bye\r\n");
        } else socket.write("250 ok\r\n");
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const smtp = nodemailer.createTransport({
    host: "127.0.0.1",
    port: server.address().port,
    secure: false,
    ignoreTLS: true,
    logger: false,
    connectionTimeout: 2000,
    socketTimeout: 2000,
  });
  try {
    const result = await smtp.sendMail(naverMimeOptions(account, draft));
    assert.deepEqual(new Set(recipients), new Set([draft.to, draft.cc, draft.bcc]));
    assert.equal(result.accepted.length, 3);
    const message = await simpleParser(Buffer.from(source));
    assert.equal(message.to.value[0].address, draft.to);
    assert.equal(message.cc.value[0].address, draft.cc);
    assert.equal(message.bcc, undefined);
    assert.equal(/^Bcc:/im.test(source.split("\r\n\r\n")[0]), false);
    assert.equal(source.includes(draft.bcc), false);
  } finally {
    smtp.close();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});
test("confirmation shows all recipient groups and editing invalidates the previous proposal", async () => {
  const client = new NaverMail({ read: async () => account, write: async () => {} }, {});
  await client.saveDraft("a", draft);
  const preview = await client.propose("a", { operation: "send", draft });
  for (const recipient of [draft.to, draft.cc, draft.bcc])
    assert.ok(preview.details.includes(recipient));
  assert.match(preview.details, /참조\(CC\)/);
  assert.match(preview.details, /숨은참조\(BCC\)/);
  await client.saveDraft("a", { ...draft, bcc: "changed@example.com" });
  await assert.rejects(client.execute("a", preview.id));
});
test("voice draft revisions preserve CC/BCC unless explicitly edited", async () => {
  const client = new NaverMail({ read: async () => account, write: async () => {} }, {});
  await client.saveDraft("a", draft);
  const old = process.env.XAI_API_KEY;
  process.env.XAI_API_KEY = "fixture";
  try {
    const plan = { operation: "draft", text: "updated", cc: "" };
    const result = await naverChat(
      client,
      "a",
      { message: "참조 지우고 초안 수정해줘" },
      async () =>
        Response.json({
          output: [
            { type: "function_call", name: "naver_request", arguments: JSON.stringify(plan) },
          ],
        }),
    );
    assert.equal(result.draft.cc, "");
    assert.equal(result.draft.bcc, draft.bcc);
    assert.equal(result.draft.to, draft.to);
  } finally {
    if (old === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = old;
  }
});
