import test from "node:test";
import assert from "node:assert/strict";
import { AudioRing, resample, wavBytes } from "../src/lib/audio-ring.ts";
import { audioIntent, soundDescription } from "../src/lib/audio-tools.ts";
import { chooseMusicMatch } from "../src/lib/music-match.ts";

test("buffers expire by wall clock, trim partial chunks and never cross inputs", () => {
  const mic = new AudioRing(10, 15),
    pc = new AudioRing(10, 15);
  mic.push(new Float32Array(100).fill(0.1), 10000);
  mic.push(new Float32Array(100).fill(0.2), 20000);
  pc.push(new Float32Array(10).fill(0.8), 20000);
  const clip = mic.snapshot("microphone", 20000);
  assert.equal(clip.pcm.length, 150);
  assert.equal(clip.pcm[0], Math.fround(0.1));
  assert.equal(pc.snapshot("system", 20000).pcm.length, 10);
  assert.equal(mic.snapshot("microphone", 27000).pcm.length, 80);
  assert.equal(mic.snapshot("microphone", 35000), null);
  assert.equal(pc.snapshot("system", 35000), null);
});
test("snapshots own memory, bounded storage and explicit disposal", () => {
  const ring = new AudioRing(4, 15);
  const raw = new Float32Array(200).fill(0.5);
  ring.push(raw, 50000);
  raw.fill(1);
  const clip = ring.snapshot("system", 50000);
  assert.equal(clip.pcm.length, 60);
  assert.equal(clip.pcm[0], 0.5);
  clip.pcm.fill(0);
  assert.equal(ring.snapshot("system", 50000).pcm[0], 0.5);
  ring.clear();
  assert.equal(ring.snapshot("system", 50000), null);
});
test("PCM resampling and WAV encoding preserve bounded duration and mono format", () => {
  const pcm = resample(new Float32Array(48000).fill(0.25), 48000, 16000);
  assert.equal(pcm.length, 16000);
  const bytes = wavBytes(pcm, 16000),
    v = new DataView(bytes.buffer);
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint32(40, true), 32000);
  assert.equal(bytes.length, 32044);
});
test("intent distinguishes description, fingerprint, speech, metadata follow-up and cancellation", () => {
  assert.equal(audioIntent("방금 무슨 소리였어?"), "describe_sound");
  assert.equal(audioIntent("PC 지금 나오는 노래 뭐야?"), "identify_music");
  assert.equal(audioIntent("이 노래 제목 뭐야"), "identify_music");
  assert.equal(audioIntent("방금 음성 글자로 변환해줘"), "transcribe_audio");
  assert.equal(audioIntent("최근 소리 기억 있어?"), "listen_recent_audio");
  assert.equal(audioIntent("이 노래 언제 나왔어?"), null);
  assert.equal(audioIntent("이 노래 언제 나온 건지 알려줘"), null);
  assert.equal(audioIntent("지금 무슨 노래야?"), "identify_music");
  assert.equal(audioIntent("음악 음량과 박자 분석해줘"), "describe_sound");
  assert.equal(audioIntent("방금 소리 분석하지 마"), null);
  assert.equal(audioIntent("아라야 오늘 뭐 했어?"), null);
});
test("relative scores remain uncertain, close or low scores are not promoted to facts", () => {
  assert.match(
    soundDescription([
      { label: "A dog is barking.", score: 0.9 },
      { label: "Music is playing.", score: 0.05 },
    ]),
    /개 짖는 소리일 가능성/,
  );
  assert.match(
    soundDescription([
      { label: "A dog is barking.", score: 0.4 },
      { label: "Music is playing.", score: 0.38 },
    ]),
    /확실히 구분하지 못/,
  );
  assert.match(
    soundDescription([{ label: "A dog is barking.", score: 0.2 }]),
    /확실히 구분하지 못/,
  );
});
test("music metadata requires strong unambiguous fingerprint, never an invented title", () => {
  const a = {
    score: 0.96,
    recordings: [
      { title: "Song", artists: [{ name: "Artist" }], releasegroups: [{ title: "Album" }] },
    ],
  };
  assert.deepEqual(chooseMusicMatch([a]), {
    title: "Song",
    artist: "Artist",
    album: "Album",
    score: 0.96,
  });
  assert.equal(chooseMusicMatch([{ ...a, score: 0.7 }]), null);
  assert.equal(
    chooseMusicMatch([
      a,
      { ...a, score: 0.94, recordings: [{ title: "Other", artists: [{ name: "Other" }] }] },
    ]),
    null,
  );
  assert.equal(chooseMusicMatch([{ score: 0.99, recordings: [{ title: "Song" }] }]), null);
  assert.equal(
    chooseMusicMatch([
      {
        ...a,
        recordings: [...a.recordings, { title: "Different", artists: [{ name: "Artist" }] }],
      },
    ]),
    null,
  );
});
