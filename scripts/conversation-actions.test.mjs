import { test } from "node:test";
import assert from "node:assert/strict";
import { takePersonaWake } from "../src/lib/wake.ts";
import {
  conversationEnded,
  relayCommand,
  deleteConversationCommand,
  summaryFilename,
  conversationDigest,
} from "../src/lib/conversation-actions.ts";
test("all registered names and Korean vocatives switch to the right persona", () => {
  const personas = [
    { id: "ara", name: "아라" },
    { id: "hye", name: "혜정" },
    { id: "grok", name: "그록" },
  ];
  assert.deepEqual(takePersonaWake("혜정이 나 도착했어", personas), {
    id: "hye",
    rest: "나도착했어",
  });
  assert.equal(takePersonaWake("혜정아 안녕", personas).id, "hye");
  assert.equal(takePersonaWake("그록아 안녕", personas).id, "grok");
  assert.equal(takePersonaWake("아라야 안녕", personas).id, "ara");
  assert.equal(takePersonaWake("그냥 아라의 이야기", personas), null);
});
test("end, relay and deletion commands are distinguished", () => {
  for (const text of [
    "대화 끝내자",
    "나 갈게",
    "잘 자",
    "집에 도착했어",
    "대화 업로드해줘",
    "백업해줘",
  ])
    assert.equal(conversationEnded(text), true, text);
  for (const text of ["아직 도착 안 했어", "안 갈게", "가지 마", "끝내지 마", "내일 갈까?"])
    assert.equal(conversationEnded(text), false, text);
  assert.deepEqual(relayCommand("혜정이한테 내가 간다고 전해줘", [{ id: "hye", name: "혜정" }]), {
    id: "hye",
    message: "내가 간다고",
  });
  assert.equal(deleteConversationCommand("대화 전부 삭제해줘"), true);
  assert.equal(deleteConversationCommand("전체 대화 지워줘"), true);
  assert.equal(deleteConversationCommand("이 메시지 수정해줘"), false);
});
test("backup fingerprints are stable and filenames use Seoul time with seconds", async () => {
  assert.equal(await conversationDigest("대화"), await conversationDigest("대화"));
  assert.notEqual(await conversationDigest("대화"), await conversationDigest("새 대화"));
  assert.equal(
    summaryFilename("아라", new Date("2026-10-03T15:00:01Z")),
    "2026-10-04_00-00-01_아라_summary.md",
  );
});
