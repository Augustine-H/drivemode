import test from "node:test";
import assert from "node:assert/strict";
import { singingLyricsGuidance } from "./singing-lyrics-guidance.ts";

test("foreign local lyrics guidance counts sung lines without editing supplied text", () => {
  const lyrics = "[Verse]\r\nMorning light\r\n\r\n[Chorus] Stay with me";
  const guidance = singingLyricsGuidance(lyrics, 30, "en", "local");
  assert.equal(guidance?.lines, 2);
  assert.equal(guidance?.suggestedLines, 4);
  assert.equal(guidance?.crowded, false);
  assert.equal(lyrics, "[Verse]\r\nMorning light\r\n\r\n[Chorus] Stay with me");
  assert.equal(singingLyricsGuidance(Array(16).fill("line").join("\n"), 60, "en", "local")?.crowded, true);
  assert.equal(singingLyricsGuidance("朝の光", 30, "ja", "local")?.suggestedLines, 4);
});

test("guidance does not turn untested providers or invalid lengths into recommendations", () => {
  for (const duration of [NaN, Infinity, 0, 121]) assert.equal(singingLyricsGuidance("line", duration, "en", "local"), undefined);
  assert.equal(singingLyricsGuidance("line", 60, "en", "elevenlabs"), undefined);
  assert.equal(singingLyricsGuidance("가사", 60, "ko", "local"), undefined);
});
