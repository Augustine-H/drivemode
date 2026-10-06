import assert from "node:assert/strict";
import test from "node:test";
import { isMusicRecord, musicRequest } from "./music-model.ts";

const request = { requestId: "generation", prompt: "piano", duration: 30, seed: 42, bitrate: 320 };
test("paid generation backups require explicit consent and generation task", () => {
  const valid = { source: "https://nas.example.ts.net:8443", request: { ...request, generationProvider: "elevenlabs", paidGenerationConsent: true } };
  assert.equal(isMusicRecord(valid), true);
  assert.equal(isMusicRecord({ ...valid, request: { ...valid.request, paidGenerationConsent: false } }), false);
  assert.equal(isMusicRecord({ ...valid, request: { ...valid.request, generationProvider: "local" } }), false);
  assert.equal(isMusicRecord({ ...valid, request: { ...valid.request, kind: "recognition", transcribe: true } }), false);
  assert.equal(isMusicRecord({ ...valid, request: { ...valid.request, duration: 1 } }), false);
});
test("chat music stays local without paid flags", () => {
  const request = musicRequest("피아노 음악 30초 만들어줘", "local-chat");
  assert.equal(request.generationProvider, undefined);
  assert.equal(request.paidGenerationConsent, undefined);
});
