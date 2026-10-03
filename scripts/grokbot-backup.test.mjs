import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseGrokbotBackup,
  mergeGrokbotBackup,
  grokbotPersonaId,
} from "../src/lib/grokbot-backup.ts";

function fixture() {
  return {
    bot: "아라",
    date: "2026-10-03",
    timezone: "Asia/Seoul",
    channel: "1:1",
    message_count: 2,
    messages: [
      { time: "14:07", speaker: "아라", text: "안녕하세요." },
      { time: "14:08", speaker: "만학님", text: "반갑습니다." },
    ],
  };
}

test("daily bot backup preserves speaker, full text and Seoul timestamps", () => {
  const data = fixture();
  data.messages[0].text = "긴 문장 ".repeat(600);
  const backup = parseGrokbotBackup(data);
  assert.equal(backup.turns[0].speaker, "grok");
  assert.equal(backup.turns[1].speaker, "me");
  assert.equal(backup.turns[0].text, data.messages[0].text);
  assert.equal(new Date(backup.turns[0].at).toISOString(), "2026-10-03T05:07:00.000Z");
  assert.notEqual(grokbotPersonaId("아라"), grokbotPersonaId("서연"));
});

test("repeat import replaces only that bot/day and retains app conversations", () => {
  const first = parseGrokbotBackup(fixture());
  const app = { id: "local-message", speaker: "me", text: "앱 대화", at: Date.now() };
  const yesterday = parseGrokbotBackup({ ...fixture(), date: "2026-10-02" });
  let current = mergeGrokbotBackup([app, ...yesterday.turns], first);
  current = mergeGrokbotBackup(current, first);
  assert.equal(current.length, 5);
  const update = fixture();
  update.messages[0].text = "수정된 내용";
  current = mergeGrokbotBackup(current, parseGrokbotBackup(update));
  assert.equal(current.find((t) => t.id === first.turns[0].id).text, "수정된 내용");
  assert.ok(current.includes(app));
});

test("invalid or incomplete exports cannot silently replace data", () => {
  assert.equal(parseGrokbotBackup({ responses: [] }), null);
  for (const patch of [
    { message_count: 3 },
    { date: "2026-02-30" },
    { timezone: "UTC" },
    { channel: "단톡" },
  ]) {
    assert.throws(() => parseGrokbotBackup({ ...fixture(), ...patch }));
  }
  const bad = fixture();
  bad.messages[0].time = "25:07";
  assert.throws(() => parseGrokbotBackup(bad));
  bad.messages[0].time = "14:07";
  bad.messages[0].speaker = "알 수 없는 봇";
  bad.messages[1].speaker = "다른 사람";
  assert.throws(() => parseGrokbotBackup(bad));
  const named = fixture();
  named.messages[1].speaker = "만학";
  assert.equal(parseGrokbotBackup(named).turns[1].speaker, "me");
  const backup = parseGrokbotBackup(fixture());
  assert.throws(() =>
    mergeGrokbotBackup(
      Array.from({ length: 2000 }, (_, i) => ({ id: `local-${i}`, speaker: "me", text: "보관" })),
      backup,
    ),
  );
});
