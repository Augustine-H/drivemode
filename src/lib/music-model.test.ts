import assert from "node:assert/strict";
import test from "node:test";
import { musicRequest, wantsMusic, musicUrl, isMusicRecord, songRequest } from "./music-model.ts";
import { buildBackup } from "./nangdok-backup.ts";
import { makeMemoryArchive, parseMemoryArchive } from "./storage-backup.ts";
import { newMedia } from "./media-model.ts";
test("song language survives restoration and explicit chat requests without changing legacy Korean records", () => {
  const source = "https://nas.example.ts.net";
  for (const language of ["ko", "en", "ja"] as const) {
    const request = songRequest("pop", "original lyrics", 30, "language-test", language);
    assert.equal(request.singingLanguage, language);
    assert(isMusicRecord({ source, request }));
  }
  const legacy = songRequest("pop", "가사", 30, "legacy");
  delete legacy.singingLanguage;
  assert(isMusicRecord({ source, request: legacy }));
  assert(!isMusicRecord({ source, request: { ...legacy, singingLanguage: "xx" } }));
  assert(!isMusicRecord({ source, request: { ...musicRequest("음악 만들어줘", "wrong-mode"), singingLanguage: "en" } }));
  assert.equal(musicRequest("영어 보컬 노래 30초 만들어줘 가사: Morning light", "chat-en").singingLanguage, "en");
  assert.equal(musicRequest("일본어 보컬 노래 30초 만들어줘 가사: 朝の光", "chat-ja").singingLanguage, "ja");
});
test("paid persona songs restore with consent and reject ACE reference or missing consent", () => {
  const source = "https://nas.example.ts.net";
  const request = { ...songRequest("pop", "직접 쓴 가사", 30, "paid-persona"),
    generationProvider: "elevenlabs" as const, paidGenerationConsent: true, singingVoice: "ara",
    singingMethod: "persona_seed_vc" as const };
  assert(isMusicRecord({ source, request }));
  assert(!isMusicRecord({ source, request: { ...request, paidGenerationConsent: false } }));
  assert(!isMusicRecord({ source, request: { ...request, singingMethod: "ace_reference_experiment" } }));
});
test("full-file recognition records restore without expanding generation or title-only limits", () => {
  const source = "https://nas.example.ts.net";
  const request = { requestId: "full-test", prompt: "가사", duration: 600, seed: 1042, bitrate: 320, kind: "recognition", transcribe: true, fullFile: true };
  assert(isMusicRecord({ source, request }));
  for (const changes of [{ duration: 601 }, { fullFile: false }, { fullFile: "true" }, { transcribe: false, identify: true, fingerprintConsent: true }, { kind: "song", lyrics: "시험 가사" }])
    assert(!isMusicRecord({ source, request: { ...request, ...changes } }));
});
test("recognition language survives restoration while unknown languages and wrong modes are rejected", () => {
  const source = "https://nas.example.ts.net";
  const request = { requestId: "recognition-test", prompt: "노래 인식", duration: 30,
    seed: 1042, bitrate: 320, kind: "recognition", transcribe: true };
  assert(isMusicRecord({ source, request }));
  for (const transcriptionLanguage of ["auto", "en", "ja", "fil"])
    assert(isMusicRecord({ source, request: { ...request, transcriptionLanguage } }));
  assert(!isMusicRecord({ source, request: { ...request, transcriptionLanguage: "xx" } }));
  assert(!isMusicRecord({ source, request: { ...request, transcriptionLanguage: "en", transcribe: false, identify: true, fingerprintConsent: true } }));
  assert(!isMusicRecord({ source, request: { ...musicRequest("음악 만들어줘", "x"), transcriptionLanguage: "en" } }));
});
test("music generation routes explicit requests without intercepting recognition or help", () => {
  for (const text of [
    "잔잔한 피아노 음악 30초 만들어줘",
    "신스웨이브 노래 생성해줘",
    "generate a music track",
  ])
    assert(wantsMusic(text));
  for (const text of [
    "지금 음악 제목 알려줘",
    "음악 만드는 방법 알려줘",
    "음악 생성 기능 있니?",
    "사진 만들어줘",
  ])
    assert(!wantsMusic(text));
});
test("music length and vocal restrictions are explicit rather than silently clamped", () => {
  assert.equal(musicRequest("음악 만들어줘", "x").duration, 30);
  assert.equal(musicRequest("음악 2분 만들어줘", "x").duration, 120);
  assert.equal(musicRequest("음악 0.5분 만들어줘", "x").duration, 30);
  assert.throws(() => musicRequest("음악 121초 만들어줘", "x"));
  assert.throws(() => musicRequest("음악 0초 만들어줘", "x"));
  assert.throws(() => musicRequest("가사 넣은 노래 만들어줘", "x"));
});
test("private NAS URLs and restored job records reject unsafe or malformed inputs", () => {
  const source = "https://nas.example.ts.net:8443";
  const request = musicRequest("피아노 음악 만들어줘", "chat-test");
  assert(isMusicRecord({ source, request, state: "QUEUED" }));
  assert(isMusicRecord({ source, request, state: "DISPATCHED" }));
  assert(!isMusicRecord({ source, request: { ...request, duration: 121 } }));
  assert(!isMusicRecord({ source, request, jobId: "../../secrets" }));
  for (const value of [
    "http://nas.example.ts.net",
    "https://evil.test",
    source + "/?key=secret",
    "https://user:pass@nas.example.ts.net",
  ])
    assert.throws(() => musicUrl(value));
});
test("vocal requests preserve supplied lyrics and never substitute speech", () => {
  assert(wantsMusic("노래 불러줘"));
  assert.throws(() => musicRequest("노래 불러줘", "x"), /가사/);
  const song = musicRequest("피아노 노래 30초 불러줘. 가사: [Verse]\n오늘도 빛나는 작은 꿈", "x");
  assert.equal(song.kind, "song");
  assert.equal(song.lyrics, "[Verse]\n오늘도 빛나는 작은 꿈");
  assert(!song.prompt.includes("Instrumental"));
  assert.throws(() => songRequest("pop", "가사", 5, "x"));
  assert(isMusicRecord({ source: "https://nas.example.ts.net", request: song }));
});
test("memory archive preserves music job references without carrying connection credentials", async () => {
  const music = {
    source: "https://nas.example.ts.net:8443",
    request: musicRequest("피아노 음악 30초 만들어줘", "chat-restore-test"),
    jobId: "bada76e9-5c9b-4c70-ae82-85d1f615e830",
    state: "COMPLETED",
  };
  const backup = buildBackup({
    personaId: "ara",
    personas: [{ id: "ara", name: "아라", text: "한국어", password: "", locked: false }],
    threads: {
      ara: [{ id: "music-turn", speaker: "grok", text: "음악 완성", music,
        mediaIds: [`music-${music.jobId}-mp3`] }],
    },
    settings: { musicToken: "private-test-credential", rate: 1 },
  });
  const media = newMedia({ id: `music-${music.jobId}-mp3`, type: "music", origin: "generated" });
  const archive = await makeMemoryArchive(backup, [media], [], "test-device", "1.25.0");
  const serialized = JSON.stringify(archive);
  assert(!serialized.includes("private-test-credential"));
  const restored = await parseMemoryArchive(new Blob([serialized]));
  assert.deepEqual(restored.backup.threads.ara[0].music, music);
  assert.deepEqual(restored.backup.threads.ara[0].mediaIds, [`music-${music.jobId}-mp3`]);
});

test("edited lyrics preserve original and correction through backup and memory archive", async () => {
  const music = {
    source: "https://nas.example.ts.net:8443",
    request: { requestId: "lyrics-edit", prompt: "노래 인식", kind: "recognition" as const, duration: 30, seed: 1042, bitrate: 320 as const, transcribe: true },
    jobId: "bada76e9-5c9b-4c70-ae82-85d1f615e830", state: "COMPLETED",
    editedLyrics: { original: "작은 꿈이 빛나요", text: "작은 꿈이 빛나요\n함께 걸어요", updatedAt: "2026-10-06T06:00:00.000Z", partial: false },
  };
  assert(isMusicRecord(music));
  const backup = buildBackup({ personaId: "ara", personas: [{ id: "ara", name: "아라", text: "한국어", password: "", locked: false }],
    threads: { ara: [{ id: "edited-turn", speaker: "grok", text: "노래 인식 완료", music }] } });
  const archive = await makeMemoryArchive(backup, [], [], "test-device", "1.28.0");
  const restored = await parseMemoryArchive(new Blob([JSON.stringify(archive)]));
  assert.deepEqual(restored.backup.threads.ara[0].music?.editedLyrics, music.editedLyrics);
  assert.equal(restored.backup.threads.ara[0].music?.request.kind, "recognition");
  assert(!("editedLyrics" in music.request));
});

test("edited lyric restore rejects invalid metadata and non-transcription jobs", () => {
  const request = { requestId: "lyrics-validation", prompt: "노래 인식", kind: "recognition" as const, duration: 30, seed: 1042, bitrate: 320 as const, transcribe: true };
  const editedLyrics = { original: "AI 원문", text: "사용자 수정본", updatedAt: "2026-10-06T06:00:00.000Z", partial: true };
  const music = { source: "https://nas.example.ts.net:8443", request, editedLyrics };
  assert(isMusicRecord(music));
  assert(isMusicRecord({ ...music, editedLyrics: { ...editedLyrics, text: "" } }));
  for (const change of [{ original: "x".repeat(60001) }, { text: "x".repeat(60001) }, { text: 3 }, { updatedAt: "invalid" }, { partial: "true" }])
    assert(!isMusicRecord({ ...music, editedLyrics: { ...editedLyrics, ...change } }));
  assert(!isMusicRecord({ ...music, request: musicRequest("피아노 음악 만들어줘", "other") }));
});
