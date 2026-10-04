import { test } from "node:test";
import assert from "node:assert/strict";
import {
  prepareVoicePcm,
  similarity,
  matchVoice,
  parseVoiceIdentity,
  SPEAKER_MODEL,
} from "../src/lib/speaker-identity.ts";
const a = Array(512).fill(0);
a[0] = 1;
const b = Array(512).fill(0);
b[1] = 1;
test("speaker match requires agreement from two enrollment samples", () => {
  assert.equal(matchVoice([a, a, b], a, 0.86).accepted, true);
  assert.equal(matchVoice([a, b, b], a, 0.86).accepted, false);
  assert.equal(matchVoice([a, a, a], b, 0.86).accepted, false);
  assert.equal(similarity(a, a), 1);
});
test("damaged or incompatible voice registrations reject instead of allowing speech", () => {
  const v = {
    version: 1,
    model: SPEAKER_MODEL,
    enabled: true,
    threshold: 0.86,
    samples: [a, a, a],
    registeredAt: new Date().toISOString(),
  };
  assert.equal(parseVoiceIdentity(JSON.stringify(v)).enabled, true);
  for (const change of [
    { samples: [a] },
    { threshold: 0 },
    { model: "other" },
    { samples: [a, a, Array(512).fill(0)] },
    { enabled: "true" },
  ])
    assert.equal(parseVoiceIdentity(JSON.stringify({ ...v, ...change })), null);
  assert.throws(() => matchVoice([a], a, 0.86));
  assert.throws(() => similarity([NaN], [1]));
});

test("soft short speech is trimmed and normalized, silence remains rejected", () => {
  const pcm = new Float32Array(32000);
  for (let i = 8000; i < 24000; i++) pcm[i] = Math.sin(i * 0.2) * 0.008;
  const result = prepareVoicePcm(pcm);
  assert.ok(result.length < pcm.length);
  assert.ok(Math.max(...result) > 0.03);
  assert.throws(() => prepareVoicePcm(new Float32Array(32000)));
  assert.throws(() => prepareVoicePcm(new Float32Array([NaN])));
});
