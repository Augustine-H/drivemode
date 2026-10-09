import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NaverMail,
  NaverCredentialStore,
  NaverError,
  naverIdentity,
  naverMail,
} from "../src/lib/naver-mail.server.ts";
import { naverDraftSchema, naverIntent, naverBase64Bytes } from "../src/lib/naver-mail-contract.ts";
import { naverAttachmentFromSource } from "../src/lib/naver-mail-transport.server.ts";
import { naverChat } from "../src/lib/naver-mail-chat.server.ts";
import { publicPathAllowed } from "../src/lib/public-boundary.server.ts";

const draft = {
  to: "recipient@example.com",
  subject: "검토 요청",
  text: "안녕하세요. 문서 검토 부탁드립니다.",
  attachments: [],
};
test("attachment preview counts decoded bytes including both Base64 padding cases", async () => {
  for (const length of [0, 1, 2, 3, 154, 155, 156, 3145728])
    assert.equal(naverBase64Bytes(Buffer.alloc(length).toString("base64")), length);
  const f = fixture();
  const proposal = await f.client.propose("owner", { operation: "send", draft: { ...draft, attachments: [{ name: "test.txt", mimeType: "text/plain", data: Buffer.alloc(154).toString("base64") }] } });
  assert.match(proposal.details, /154 bytes/);
  assert.equal(f.sends, 0);
});
test("download validates selection and attachment index before opening transport", async () => {
  const f = fixture();
  let calls = 0;
  f.adapter.attachment = async () => { calls++; return { name: "test.txt", size: 1, data: "YQ==" }; };
  for (const index of [-1, 1.5, NaN, 100]) await assert.rejects(f.client.attachment(f.id, index));
  await assert.rejects(f.client.attachment("invalid", 0));
  assert.equal(calls, 0);
  assert.equal((await f.client.attachment(f.id, 0)).data, "YQ==");
  assert.equal(f.mutations, 0);
});
test("MIME download preserves binary bytes, rejects missing parts and bounds sizes", async () => {
  const bytes = Buffer.from([0, 255, 128, 10, 13, 65]);
  const source = Buffer.from(`MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=test\r\n\r\n--test\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="test.bin"\r\nContent-Transfer-Encoding: base64\r\n\r\n${bytes.toString("base64")}\r\n--test--\r\n`);
  const file = await naverAttachmentFromSource(source, 0);
  assert.deepEqual(Buffer.from(file.data, "base64"), bytes);
  assert.equal(file.size, bytes.length);
  await assert.rejects(naverAttachmentFromSource(source, 1));
  await assert.rejects(naverAttachmentFromSource(Buffer.alloc(20000001), 0), e => e.code === "size");
  const large = Buffer.from(source.toString().replace(bytes.toString("base64"), Buffer.alloc(10000001).toString("base64")));
  await assert.rejects(naverAttachmentFromSource(large, 0), e => e.code === "size");
});
test("importance confirmations are owner-bound and single-use", async () => {
  const f = fixture(), actions = [];
  f.adapter.mutate = async (_c, _id, action) => actions.push(action);
  for (const flagged of [true, false]) {
    const p = await f.client.propose("owner", { operation: "flag", id: f.id, flagged });
    assert.match(p.details, flagged ? /중요 표시 설정/ : /중요 표시 해제/);
    assert.match(p.details, /읽음 상태는 바꾸지 않음/);
    await assert.rejects(f.client.execute("other", p.id), e => e.code === "confirmation");
    await f.client.execute("owner", p.id);
    await assert.rejects(f.client.execute("owner", p.id), e => e.code === "confirmation");
  }
  assert.deepEqual(actions.map(a => a.flagged), [true, false]);
  assert.equal(f.mail.unread, true);
  await assert.rejects(f.client.propose("owner", { operation: "flag", id: f.id }));
  await assert.rejects(f.client.propose("owner", { operation: "flag", id: "forged", flagged: true }));
});

test("importance changes only Flagged with a UID, preserving all other flags", async () => {
  const { updateNaverFlag } = await import("../src/lib/naver-mail-transport.server.ts");
  const flags = new Set(["\\Seen", "\\Draft", "custom"]), calls = [];
  const client = {
    messageFlagsAdd: async (uid, changed, options) => {
      calls.push(["add", uid, changed, options]);
      changed.forEach(f => flags.add(f)); return true;
    },
    messageFlagsRemove: async (uid, changed, options) => {
      calls.push(["remove", uid, changed, options]);
      changed.forEach(f => flags.delete(f)); return true;
    },
  };
  await updateNaverFlag(client, 7, { operation: "flag", flagged: true });
  assert.equal(flags.has("\\Flagged"), true);
  await updateNaverFlag(client, 7, { operation: "flag", flagged: false });
  assert.deepEqual([...flags], ["\\Seen", "\\Draft", "custom"]);
  assert.deepEqual(calls, [["add", "7", ["\\Flagged"], { uid: true }], ["remove", "7", ["\\Flagged"], { uid: true }]]);
  client.messageFlagsAdd = async () => false;
  await assert.rejects(updateNaverFlag(client, 7, { operation: "flag", flagged: true }), e => e.code === "stale");
});

test("voice importance clarifies ambiguous state and cannot mutate without confirmation", async () => {
  const f = fixture();
  const response = plan => async () => Response.json({output: [{type: "function_call", name: "naver_request", arguments: JSON.stringify(plan)}]});
  const oldKey = process.env.XAI_API_KEY;
  process.env.XAI_API_KEY = "test-only-key";
  try {
    assert.equal(naverIntent("이거 중요 표시해줘", true), true);
    for (const flagged of [true, false]) {
      const result = await naverChat(f.client, "owner", {message: "이 메일 중요 표시 변경해줘", context: [f.mail]}, response({operation: "flag", flagged}));
      assert.match(result.proposal.details, flagged ? /설정/ : /해제/);
    }
    const missing = await naverChat(f.client, "owner", {message: "중요 표시 변경", context: [f.mail]}, response({operation: "flag"}));
    assert.match(missing.text, /설정할지 해제할지/);
    const forged = await naverChat(f.client, "owner", {message: "중요 표시", context: []}, response({operation: "flag", id: f.id, flagged: true}));
    assert.match(forged.text, /먼저 조회/);
    assert.equal(f.mutations, 0);
  } finally {
    if (oldKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = oldKey;
  }
});

function fixture() {
  let saved = { email: "test@naver.com", password: "test-only-password", generation: "account-a" },
    sendCount = 0,
    mutations = 0;
  const id = Buffer.from(
    JSON.stringify({ mailbox: "INBOX", validity: "3", uid: 7, generation: "account-a" }),
  ).toString("base64url");
  const mail = {
    id,
    subject: "회의 안내",
    from: "보낸 사람 <sender@example.com>",
    date: "",
    unread: true,
    text: "내일 오후 세 시에 회의합니다.",
    replyTo: "sender@example.com",
    messageId: "<original@example.com>",
    references: "",
    attachments: [],
  };
  const adapter = {
    verify: async () => {},
    mailboxes: async () => [{ path: "INBOX", name: "받은메일함" }],
    list: async () => [mail],
    message: async () => ({ ...mail }),
    mutate: async () => {
      mutations++;
    },
    send: async () => {
      sendCount++;
      return { messageId: "<sent@example.com>", accepted: 1, rejected: 0 };
    },
  };
  const store = {
    read: async () => saved,
    write: async (value) => {
      saved = value;
    },
  };
  return {
    client: new NaverMail(store, adapter),
    adapter,
    store,
    id,
    mail,
    get sends() {
      return sendCount;
    },
    get mutations() {
      return mutations;
    },
  };
}
test("credentials are authenticated before replacement; status never includes password", async () => {
  const f = fixture();
  f.adapter.verify = async () => {
    throw new NaverError("authentication");
  };
  await assert.rejects(f.client.connect({ email: "new@naver.com", password: "invalid-password" }));
  assert.equal((await f.client.status()).email, "test@naver.com");
  assert.ok(!JSON.stringify(await f.client.status()).includes("password"));
  await assert.rejects(f.client.connect({ email: "name@gmail.com", password: "invalid-password" }));
});
test("encrypt credentials at rest, reject tampering, and disconnect", async () => {
  const directory = await mkdtemp(join(tmpdir(), "voicegrok-naver-test-"));
  try {
    const store = new NaverCredentialStore(directory),
      credentials = { email: "test@naver.com", password: "test-only-password", generation: "test" };
    await store.write(credentials);
    assert.deepEqual(await store.read(), credentials);
    const bytes = await readFile(join(directory, "credentials.enc"));
    assert.ok(!bytes.includes(Buffer.from(credentials.password)));
    bytes[bytes.length - 1] ^= 1;
    await writeFile(join(directory, "credentials.enc"), bytes);
    await assert.rejects(store.read());
    await store.write(null);
    assert.equal(await store.read(), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("preview never sends; confirmation is owner-bound and one-use", async () => {
  const f = fixture(),
    proposal = await f.client.propose("device-a", { operation: "send", draft });
  assert.equal(f.sends, 0);
  assert.match(proposal.details, /recipient@example.com/);
  assert.match(proposal.details, /검토 요청/);
  assert.equal(proposal.provider, "naver");
  await assert.rejects(f.client.execute("device-b", proposal.id));
  assert.equal(f.sends, 0);
  await f.client.execute("device-a", proposal.id);
  assert.equal(f.sends, 1);
  await assert.rejects(f.client.execute("device-a", proposal.id));
});
test("draft edits, replacement previews, expiry and account changes invalidate approval", async () => {
  const f = fixture();
  const old = await f.client.propose("owner", { operation: "send", draft });
  await f.client.saveDraft("owner", { ...draft, text: "수정했습니다." });
  await assert.rejects(f.client.execute("owner", old.id));
  const one = await f.client.propose("owner", { operation: "send", draft }),
    two = await f.client.propose("owner", { operation: "send", draft });
  await assert.rejects(f.client.execute("owner", one.id));
  const clock = Date.now;
  Date.now = () => clock() + 600001;
  try {
    await assert.rejects(f.client.execute("owner", two.id));
  } finally {
    Date.now = clock;
  }
  const switched = await f.client.propose("owner", { operation: "send", draft });
  await f.store.write({ email: "other@naver.com", password: "test-only", generation: "account-b" });
  await assert.rejects(f.client.execute("owner", switched.id));
  assert.equal(f.sends, 0);
});
test("ambiguous SMTP failure consumes the proposal and never retries", async () => {
  const f = fixture();
  let attempts = 0;
  f.adapter.send = async () => {
    attempts++;
    throw Error("socket gone after DATA");
  };
  const p = await f.client.propose("owner", { operation: "send", draft });
  await assert.rejects(f.client.execute("owner", p.id), (e) => e.code === "uncertain");
  await assert.rejects(f.client.execute("owner", p.id));
  assert.equal(attempts, 1);
});
test("invalid recipients, header injection, path attachments and oversized attachments are rejected", () => {
  for (const to of [
    "",
    ",",
    "recipient@example.com,",
    "name@example.com\r\nBcc: secret@example.com",
  ])
    assert.equal(naverDraftSchema.safeParse({ ...draft, to }).success, false);
  assert.equal(
    naverDraftSchema.safeParse({ ...draft, subject: "subject\r\nBcc: bad" }).success,
    false,
  );
  assert.equal(
    naverDraftSchema.safeParse({
      ...draft,
      attachments: [{ name: "x", mimeType: "text/plain", data: "dGVzdA==", path: "/etc/passwd" }],
    }).success,
    false,
  );
  assert.equal(
    naverDraftSchema.safeParse({
      ...draft,
      attachments: [{ name: "x", mimeType: "text/plain", data: "YQ==".repeat(10) }],
    }).success,
    false,
  );
});
test("read and reply draft do not mutate mail; stale account identities fail", async () => {
  const f = fixture();
  await f.client.message(f.id);
  const reply = await f.client.replyDraft(f.id);
  assert.equal(reply.to, "sender@example.com");
  assert.equal(reply.inReplyTo, "<original@example.com>");
  assert.equal(f.mutations, 0);
  assert.throws(() => naverIdentity(f.id, "other-generation"));
  assert.throws(() => naverIdentity("not-an-id", "account-a"));
  const proposal = await f.client.propose("owner", { operation: "trash", id: f.id });
  assert.equal(f.mutations, 0);
  await f.client.execute("owner", proposal.id);
  assert.equal(f.mutations, 1);
});
test("Naver routes explicit and selected follow-ups while excluding Gmail, calendar and voice mail", () => {
  assert.equal(naverIntent("네이버 메일 읽어줘"), true);
  assert.equal(naverIntent("원문 읽어줘", true), true);
  assert.equal(naverIntent("초안 짧게 수정해줘", true), true);
  assert.equal(naverIntent("Gmail 메일 읽어줘", true), false);
  assert.equal(naverIntent("구글 일정 알려줘", true), false);
  assert.equal(naverIntent("보이스 메일 읽어줘", true), false);
  assert.equal(naverIntent("원문 읽어줘", false), false);
});
test("selected original reading works without AI interpretation and preserves unread state", async () => {
  const f = fixture();
  const result = await naverChat(
    f.client,
    "owner",
    { message: "원문 읽어줘", context: [f.mail] },
    async () => {
      throw Error("AI must not be called");
    },
  );
  assert.match(result.text, /내일 오후 세 시/);
  assert.equal(f.mutations, 0);
});
test("AI can revise a draft but cannot execute a send or invent a selected message identity", async () => {
  const f = fixture();
  await f.client.saveDraft("owner", draft);
  const response = (plan) => async () =>
    Response.json({
      output: [{ type: "function_call", name: "naver_request", arguments: JSON.stringify(plan) }],
    });
  const oldKey = process.env.XAI_API_KEY;
  process.env.XAI_API_KEY = "test-only-key";
  try {
    const revised = await naverChat(
      f.client,
      "owner",
      { message: "초안 더 짧게 바꿔줘" },
      response({ operation: "draft", text: "검토 부탁드립니다." }),
    );
    assert.equal(revised.draft.to, draft.to);
    assert.equal(revised.draft.text, "검토 부탁드립니다.");
    const send = await naverChat(
      f.client,
      "owner",
      { message: "메일 발송해줘" },
      response({ operation: "send" }),
    );
    assert.ok(send.proposal);
    assert.equal(f.sends, 0);
    const forged = await naverChat(
      f.client,
      "owner",
      { message: "네이버 메일 삭제해줘", context: [] },
      response({ operation: "trash", id: f.id }),
    );
    assert.match(forged.text, /먼저 조회/);
    assert.equal(f.mutations, 0);
  } finally {
    if (oldKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = oldKey;
  }
});
test("unauthenticated API is rejected before credentials or protocols are opened", async () => {
  const response = await naverMail(new Request("https://example.com/api/naver-mail?action=status"));
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /인증된 NAS/);
  assert.equal(publicPathAllowed("/api/naver-mail"), true);
  assert.equal(publicPathAllowed("/api/naver-mail-secret"), false);
});
