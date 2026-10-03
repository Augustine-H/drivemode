import test from "node:test";
import assert from "node:assert/strict";
import { validateMail, mailSpeechChunks, MAIL_BYTES } from "../src/lib/voice-mail.ts";

const mail = (audio) => ({
  id: "test",
  personaId: "ara",
  personaName: "아라",
  direction: "sent",
  createdAt: 0,
  text: "테스트",
  audio,
  heard: false,
});
test("voice mail validates audio and the combined size before storage", () => {
  assert.doesNotThrow(() => validateMail(mail([new Blob(["voice"], { type: "audio/webm" })])));
  assert.throws(() => validateMail(mail([])));
  assert.throws(() => validateMail(mail([new Blob(["not-audio"], { type: "text/html" })])));
  assert.throws(() => validateMail(mail([new Blob([], { type: "audio/webm" })])));
  const large = new Blob([new Uint8Array(MAIL_BYTES / 2 + 1)], { type: "audio/mpeg" });
  assert.throws(() => validateMail(mail([large, large])));
  assert.throws(() => validateMail({ ...mail([large]), text: "가".repeat(5001) }));
});
test("long received replies are spoken completely in capped Unicode-safe API chunks", () => {
  const text = "가".repeat(399) + "🙂" + " 나".repeat(600);
  const chunks = mailSpeechChunks(text);
  assert.equal(chunks.join(""), text);
  assert.ok(chunks.every((part) => part.length <= 400));
  assert.ok(chunks.every((part) => !/[\uD800-\uDBFF]$/.test(part)));
  assert.deepEqual(mailSpeechChunks(" \n "), []);
});
