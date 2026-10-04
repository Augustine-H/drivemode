import { test } from "node:test";
import assert from "node:assert/strict";
import { mailReplyChannel, mailReplyDue } from "../src/lib/mail-reply-policy.ts";
test("mail confirmation is scheduled once between one and ten minutes", () => {
  assert.equal(mailReplyDue(1000, 0), 61000);
  assert.equal(mailReplyDue(1000, 1), 601000);
  assert.equal(mailReplyDue(1000, 0.5), 331000);
});
test("voice is a 50 percent choice only below 40 percent with a fresh reported quota", () => {
  const now = 4000000;
  const settings = { enabled: true, usagePercent: 39, reportedAt: now };
  assert.equal(mailReplyChannel(settings, now, 0.49), "voice");
  assert.equal(mailReplyChannel(settings, now, 0.5), "chat");
  for (const usagePercent of [40, 100, null, NaN, -1]) assert.equal(mailReplyChannel({ ...settings, usagePercent }, now, 0), "chat");
  assert.equal(mailReplyChannel({ ...settings, reportedAt: 0 }, now, 0), "chat");
  assert.equal(mailReplyChannel({ ...settings, reportedAt: now + 1 }, now, 0), "chat");
});
