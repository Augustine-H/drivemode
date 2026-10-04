import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ANNOUNCEMENTS,
  isAnnouncement,
  startsWithPersonaName,
} from "../src/lib/voice-input-filter.ts";

test("all defaults and separately recognized clauses are filtered", () => {
  assert.equal(DEFAULT_ANNOUNCEMENTS.length, 24);
  for (const line of DEFAULT_ANNOUNCEMENTS) {
    assert.ok(isAnnouncement(line, DEFAULT_ANNOUNCEMENTS));
    assert.ok(isAnnouncement(line.replace(/[ .]/g, ""), DEFAULT_ANNOUNCEMENTS));
    for (const clause of line.split(".").filter((s) => s.trim()))
      assert.ok(isAnnouncement(clause, DEFAULT_ANNOUNCEMENTS));
  }
});
test("editable filters and questions quoting an announcement", () => {
  assert.ok(isAnnouncement("300 미터 앞 우회전!", ["300미터 앞 우회전"]));
  assert.ok(!isAnnouncement("고온이 감지되었습니다 이게 무슨 뜻이야", DEFAULT_ANNOUNCEMENTS));
  assert.ok(!isAnnouncement("오늘 날씨", DEFAULT_ANNOUNCEMENTS));
  assert.ok(!isAnnouncement("", [""]));
});
test("name must start the question", () => {
  assert.ok(startsWithPersonaName("아라야 오늘 날씨", ["아라"]));
  assert.ok(startsWithPersonaName("혜정이 알려줘", ["혜정"]));
  assert.ok(!startsWithPersonaName("오늘 아라야", ["아라"]));
  assert.ok(!startsWithPersonaName("아라비아", ["아라"]));
});
