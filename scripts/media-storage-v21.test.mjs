import test from "node:test";
import assert from "node:assert/strict";
import {
  DAY_MS,
  newMedia,
  defaultMediaPolicy,
  transitionMedia,
  retentionAction,
  mediaTotals,
  detachMediaReferences,
  validateMediaItem,
} from "../src/lib/media-model.ts";
import {
  makeMemoryArchive,
  parseMemoryArchive,
  encodeMemoryArchive,
  mergeMemoryBackup,
} from "../src/lib/storage-backup.ts";
import { parseMediaManifest, safeExportPath } from "../src/lib/media-export.ts";
import { allowedMediaSource } from "../src/lib/media-source.ts";
import {
  emptyMemoryState,
  buildPersonaMemory,
  forgetMemoryDocument,
  conversationMemoryDeleted,
} from "../src/lib/memory-engine.ts";
import { buildGrokContext } from "../src/lib/grok-context.ts";
import { buildBackup } from "../src/lib/nangdok-backup.ts";
const now = Date.UTC(2026, 9, 5),
  policy = defaultMediaPolicy();
const fixture = (type = "image", origin = "generated") =>
  newMedia(
    {
      id: "media-test",
      type,
      origin,
      refs: [{ conversationId: "ara", messageId: "t1", personaId: "ara" }],
    },
    policy,
    now,
  );
const backup = () =>
  buildBackup({
    personaId: "ara",
    personas: [
      { id: "ara", name: "아라", text: "다정한 말투", password: "private-lock", locked: true },
    ],
    threads: { ara: [{ id: "t1", speaker: "me", text: "나는 커피를 좋아해. 기억해.", at: now }] },
    memoryV2: emptyMemoryState(),
    settings: {
      rate: 1,
      apiKey: "never-export",
      oauthToken: "never-export",
      audio: { enabled: true, apiKey: "never-export" },
    },
  });
test("elapsed-time retention boundaries and all five media defaults", () => {
  for (const type of ["image", "music", "voice", "audio", "video"]) {
    const m = fixture(type),
      days = ["image", "music"].includes(type) ? 30 : 14;
    assert.equal(m.expiresAt, now + days * DAY_MS);
    assert.equal(retentionAction(m, policy, m.expiresAt - 1), null);
    assert.equal(retentionAction({ ...m, ingestState: "complete" }, policy, m.expiresAt), "trash");
  }
});
test("uploads, legacy and Saved never auto-expire under pressure", () => {
  for (const origin of ["uploaded", "imported", "legacy"]) {
    const m = fixture("image", origin);
    assert.equal(m.retentionClass, "saved");
    assert.equal(m.expiresAt, undefined);
    assert.equal(retentionAction(m, policy, now + 1000 * DAY_MS), null);
  }
  assert.equal(
    retentionAction(transitionMedia(fixture(), "save", policy, now), policy, now + 999 * DAY_MS),
    null,
  );
});
test("late expiration gives a fresh seven days in Trash instead of immediate purge", () => {
  const m = { ...fixture(), ingestState: "complete" };
  const late = now + 120 * DAY_MS;
  const trash = transitionMedia(m, "trash", policy, late);
  assert.equal(trash.trashedAt, late);
  assert.equal(trash.purgeAfter, late + 7 * DAY_MS);
  assert.equal(retentionAction(trash, policy, late + 7 * DAY_MS - 1), null);
  assert.equal(retentionAction(trash, policy, late + 7 * DAY_MS), "purge");
});
test("Saved restore retains Saved, Temporary restore restarts retention clock", () => {
  const saved = transitionMedia(fixture(), "save", policy, now);
  assert.equal(
    transitionMedia(transitionMedia(saved, "trash", policy, now), "restore", policy, now + DAY_MS)
      .retentionClass,
    "saved",
  );
  const restored = transitionMedia(
    transitionMedia(fixture(), "trash", policy, now),
    "restore",
    policy,
    now + DAY_MS,
  );
  assert.equal(restored.expiresAt, now + 31 * DAY_MS);
});
test("policy changes do not mutate existing deadlines and no-expiry is supported", () => {
  const m = fixture();
  const modified = { ...policy, days: { ...policy.days, image: 7 } };
  assert.equal(m.expiresAt, now + 30 * DAY_MS);
  assert.equal(
    newMedia({ id: "new", type: "image", origin: "generated" }, modified, now).expiresAt,
    now + 7 * DAY_MS,
  );
  assert.equal(
    newMedia(
      { id: "new", type: "image", origin: "generated" },
      { ...policy, days: { ...policy.days, image: null } },
      now,
    ).expiresAt,
    undefined,
  );
});
test("restored/protected/paused media stays out of automatic cleanup", () => {
  const m = { ...fixture(), ingestState: "complete", expiresAt: now };
  for (const flag of ["protected", "restorePending"])
    assert.equal(retentionAction({ ...m, [flag]: true }, policy, now + DAY_MS), null);
  assert.equal(retentionAction(m, { ...policy, paused: true }, now + DAY_MS), null);
});
test("shared references survive conversation deletion, Saved originals remain protected", () => {
  const shared = {
    ...fixture(),
    refs: [
      { conversationId: "ara", messageId: "t1" },
      { conversationId: "grok", messageId: "t2" },
    ],
  };
  const detached = detachMediaReferences(shared, new Set(["ara\0t1"]), true, policy, now);
  assert.equal(detached.refs.length, 1);
  assert.equal(detached.lifecycle, "active");
  const alone = detachMediaReferences(fixture(), new Set(["ara\0t1"]), true, policy, now);
  assert.equal(alone.lifecycle, "trashed");
  const saved = transitionMedia(fixture(), "save", policy, now);
  assert.equal(
    detachMediaReferences(saved, new Set(["ara\0t1"]), true, policy, now).lifecycle,
    "active",
  );
});
test("Trash is a subset, remote/missing bytes and duplicate physical keys excluded", () => {
  const a = {
    ...fixture(),
    storageAdapter: "idb",
    availability: "local",
    localByteSize: 100,
    ingestState: "complete",
  };
  const trash = { ...a, id: "trash", storageKey: "trash", lifecycle: "trashed", localByteSize: 50 };
  const missing = { ...a, id: "missing", availability: "missing", localByteSize: 1000 };
  const remote = { ...missing, id: "remote", availability: "remote-only" };
  const total = mediaTotals([a, trash, missing, remote, { ...a, id: "duplicate" }]);
  assert.equal(total.total, 150);
  assert.equal(total.trashBytes, 50);
  assert.equal(total.byType.image, 150);
});
test("path traversal and malformed media IDs rejected before archive/file writes", () => {
  for (const path of ["../secret", "/root/file", "a/../../b", "a\\b", "a//b"])
    assert.equal(safeExportPath(path), false);
  assert.equal(safeExportPath("VoiceGrok/Media/Saved/image/m-1.jpg"), true);
  assert.equal(validateMediaItem({ ...fixture(), storageKey: "../escape" }), false);
  assert.throws(() => newMedia({ id: "../../x", type: "image", origin: "generated" }));
});
test("strict media proxy accepts public xAI hosts only without redirects/credentials", () => {
  assert.equal(allowedMediaSource("https://imgen.x.ai/x.png"), true);
  for (const u of [
    "http://data.x.ai/x",
    "https://data.x.ai.evil.com/x",
    "https://user:pass@data.x.ai/x",
    "https://127.0.0.1/x",
    "https://data.x.ai:99/x",
  ])
    assert.equal(allowedMediaSource(u), false);
});
test("memory archive integrity + safe settings + no media bytes + legacy restoration", async () => {
  const b = backup();
  const a = await makeMemoryArchive(b, [], [], "device", "1.23.0");
  const text = JSON.stringify(a);
  assert.ok(!text.includes("never-export"));
  assert.ok(!text.includes("private-lock"));
  assert.equal(a.scope, "memory-index-only");
  const parsed = await parseMemoryArchive(new Blob([text]));
  assert.equal(parsed.backup.threads.ara[0].text, b.threads.ara[0].text);
  assert.equal(
    (await parseMemoryArchive(new Blob([JSON.stringify(b)]))).backup.personas[0].name,
    "아라",
  );
  a.files["conversations.json"] += " ";
  await assert.rejects(() => parseMemoryArchive(new Blob([JSON.stringify(a)])), /해시/);
});
test("AES-GCM authenticates header/content, wrong password stops before activation", async () => {
  const a = await makeMemoryArchive(backup(), [], [], "device", "1.23.0");
  const blob = await encodeMemoryArchive(a, "test-password");
  assert.ok(!(await blob.text()).includes("커피"));
  const restored = await parseMemoryArchive(blob, "test-password");
  assert.equal(restored.backup.threads.ara.length, 1);
  await assert.rejects(() => parseMemoryArchive(blob, "wrong-pass"), /암호/);
  const tampered = JSON.parse(await blob.text());
  tampered.nonce = tampered.salt.slice(0, 16);
  await assert.rejects(
    () => parseMemoryArchive(new Blob([JSON.stringify(tampered)]), "test-password"),
    /변조/,
  );
  const second = JSON.parse(await (await encodeMemoryArchive(a, "test-password")).text());
  assert.notEqual(second.nonce, JSON.parse(await blob.text()).nonce);
});
test("duplicate media IDs and dangling references rejected in Memory archive", async () => {
  const m = fixture("image", "uploaded");
  const b = backup();
  b.threads.ara[0].mediaIds = ["not-present"];
  const a = await makeMemoryArchive(b, [m], [], "device", "1.23.0");
  await assert.rejects(() => parseMemoryArchive(new Blob([JSON.stringify(a)])), /참조/);
  const duplicate = await makeMemoryArchive(backup(), [m, m], [], "device", "1.23.0");
  await assert.rejects(() => parseMemoryArchive(new Blob([JSON.stringify(duplicate)])), /ID/);
});
test("Media manifest cannot reconnect by filename only and blocks unsafe/mismatched metadata", () => {
  const m = { ...fixture(), localByteSize: 10, checksum: "a".repeat(64) };
  const manifest = {
    formatId: "voice-grok-media",
    version: 1,
    createdAt: now,
    files: [
      {
        mediaId: m.id,
        relativePath: "safe/file.jpg",
        byteSize: 10,
        checksum: m.checksum,
        fileRevision: 1,
        state: "verified",
        metadata: m,
      },
    ],
  };
  assert.equal(parseMediaManifest(manifest).files.length, 1);
  assert.throws(() =>
    parseMediaManifest({
      ...manifest,
      files: [{ ...manifest.files[0], relativePath: "../../secret" }],
    }),
  );
  assert.throws(() =>
    parseMediaManifest({
      ...manifest,
      files: [{ ...manifest.files[0], checksum: "b".repeat(64) }],
    }),
  );
});
test("merge never silently overwrites conflicting message/persona records", () => {
  const first = backup(),
    second = backup();
  second.exportedAt = first.exportedAt;
  assert.equal(mergeMemoryBackup(first, second).threads.ara.length, 1);
  second.threads.ara[0].text = "different";
  assert.throws(() => mergeMemoryBackup(first, second), /충돌/);
});
test("deleted memory does not resurrect from source text or summaries", () => {
  const turns = [{ id: "t1", content: "나는 커피를 좋아해. 기억해.", role: "user", at: now }];
  const state = emptyMemoryState();
  state.recentBudget = 0;
  const first = buildPersonaMemory(state, "ara", turns);
  state.longTerm.ara = first.longTerm;
  state.summaries.ara = first.summaries;
  const forgotten = forgetMemoryDocument(state, "ara", "fact:t1");
  const result = buildPersonaMemory(forgotten, "ara", turns);
  assert.equal(result.longTerm.length, 0);
  assert.equal(result.summaries.length, 0);
});

test("restore merge accepts reordered sanitized persona fields while retaining local lock", async () => {
  const current = backup();
  const archive = await makeMemoryArchive(current, [], [], "device", "1.23.0");
  const incoming = (await parseMemoryArchive(new Blob([JSON.stringify(archive)]))).backup;
  incoming.personas[0] = Object.fromEntries(Object.entries(incoming.personas[0]).reverse());
  const merged = mergeMemoryBackup(current, incoming);
  assert.equal(merged.personas[0].password, "private-lock");
  assert.equal(merged.personas[0].locked, true);
});

test("archive rejects malformed and duplicate message rows even with valid hashes", async () => {
  const bad = backup();
  bad.threads.ara.push({ ...bad.threads.ara[0], id: "bad", speaker: "invalid" });
  const a = await makeMemoryArchive(bad, [], [], "device", "1.23.0");
  await assert.rejects(() => parseMemoryArchive(new Blob([JSON.stringify(a)])), /항목/);
  const duplicate = backup();
  duplicate.threads.ara.push({ ...duplicate.threads.ara[0] });
  const b = await makeMemoryArchive(duplicate, [], [], "device", "1.23.0");
  await assert.rejects(() => parseMemoryArchive(new Blob([JSON.stringify(b)])), /항목/);
});

test("Memory archive preserves managed image identity for later questions", async () => {
  const m = fixture("image", "uploaded"),
    b = backup();
  b.threads.ara[0].mediaIds = [m.id];
  b.threads.ara[0].image = `media:${m.id}`;
  const a = await makeMemoryArchive(b, [m], [], "device", "1.23.0");
  const restored = await parseMemoryArchive(new Blob([JSON.stringify(a)]));
  assert.equal(restored.backup.threads.ara[0].image, `media:${m.id}`);
  assert.deepEqual(restored.backup.threads.ara[0].mediaIds, [m.id]);
});
test("edited source regenerates fact; conversation-only deletion retains explicit memory with sourceDeleted", () => {
  const state = emptyMemoryState();
  const turns = [{ id: "t1", content: "나는 커피를 좋아해. 기억해.", role: "user", at: now }];
  state.longTerm.ara = buildPersonaMemory(state, "ara", turns).longTerm;
  const edited = buildPersonaMemory(state, "ara", [
    { ...turns[0], content: "나는 커피를 싫어해. 기억해." },
  ]);
  assert.match(edited.longTerm[0].content, /싫어/);
  assert.equal(
    conversationMemoryDeleted(state, new Set(["t1"]), false).longTerm.ara[0].sourceDeleted,
    true,
  );
  assert.equal(conversationMemoryDeleted(state, new Set(["t1"]), true).longTerm.ara.length, 0);
});
test("current user message occurs once and application token estimate respects reserved cap", () => {
  const q = "현재 질문";
  const context = buildGrokContext({
    message: q,
    history: [
      { role: "user", content: "이전" },
      { role: "user", content: q },
    ],
    persona: "역할".repeat(10000),
    memory: "기억".repeat(10000),
    summary: "요약".repeat(10000),
    budgets: { persona: 8000, memory: 4800, summary: 2400, recent: 12000, message: 4800 },
  });
  assert.equal(context.input.filter((i) => i.content === q).length, 1);
  assert.ok(context.metrics.totalTokens <= context.metrics.applicationInputLimit);
  assert.equal(context.metrics.modelContextLimit, null);
});
