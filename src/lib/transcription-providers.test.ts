import { test } from "node:test";
import assert from "node:assert/strict";
import { estimatedTranscriptionCost, isTranscriptionProvider } from "./transcription-providers.ts";
import { isMusicRecord } from "./music-model.ts";

test("paid transcription requires an explicit provider, consent and transcription task", () => {
  const request = { requestId: "paid-test", prompt: "Lyrics", duration: 30, seed: 1042, bitrate: 320, kind: "recognition", transcribe: true };
  const source = "https://nas.example.ts.net";
  assert(isMusicRecord({ source, request }));
  assert(!isMusicRecord({ source, request: { ...request, transcriptionProvider: "openai" } }));
  assert(isMusicRecord({ source, request: { ...request, transcriptionProvider: "openai", paidAudioConsent: true } }));
  assert(!isMusicRecord({ source, request: { ...request, transcriptionProvider: "qwen", paidAudioConsent: true } }));
  assert(!isMusicRecord({ source, request: { ...request, transcriptionProvider: "openai", paidAudioConsent: true, transcribe: false } }));
  assert(!isTranscriptionProvider("other"));
});
test("cost estimates require server pricing and cap the supported length", () => {
  const pricing = { checkedAt: "2026-10-06", providers: { openai: { model: "gpt-transcribe", estimatedUsdPerHour: .27 } }, actualBillKnown: false };
  assert.equal(estimatedTranscriptionCost("qwen", 30), 0);
  assert.equal(estimatedTranscriptionCost("openai", 30), undefined);
  assert.equal(estimatedTranscriptionCost("openai", 600, pricing), .045);
  assert.equal(estimatedTranscriptionCost("openai", 900, pricing), .045);
});
