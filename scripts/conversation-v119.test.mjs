import test from "node:test";
import assert from "node:assert/strict";
import { speechParts } from "../src/lib/stream-speech.ts";
import { audioLevel, estimateTempo, musicCommand } from "../src/lib/music-analysis.ts";
import { findQuestionMedia } from "../src/lib/room-context.ts";
import { wantsImage, wantsVideo } from "../src/lib/media-intent.ts";
import { relayCommand } from "../src/lib/conversation-actions.ts";
import { relayDelivery } from "../src/lib/persona-relay.ts";
import { personaInstructions } from "../src/lib/persona-memory.ts";

test("stream publishes the first sentence before completion, retains indices and flushes final tail", () => {
  assert.deepEqual(speechParts("첫 문장"), []);
  assert.deepEqual(speechParts("첫 문장. 뒤 문장"), ["첫 문장."]);
  assert.deepEqual(speechParts("첫 문장. 뒤 문장! 마지막"), ["첫 문장.", "뒤 문장!"]);
  assert.deepEqual(speechParts("첫 문장. 뒤 문장! 마지막", true), [
    "첫 문장.",
    "뒤 문장!",
    "마지막",
  ]);
  assert.deepEqual(speechParts("속도는 1.2배야. 끝", true), ["속도는 1.2배야.", "끝"]);
});
test("chat references locate older subjects, ordered media, video and followup without generation", () => {
  const turns = [
    {
      id: "cat",
      speaker: "grok",
      text: "",
      image: "https://example.com/cat",
      mediaDescription: "흰 고양이",
    },
    {
      id: "dog",
      speaker: "grok",
      text: "",
      image: "https://example.com/dog",
      mediaDescription: "검은 강아지",
    },
    {
      id: "sea",
      speaker: "grok",
      text: "",
      video: "https://example.com/sea",
      mediaDescription: "바다 풍경",
    },
    {
      id: "city",
      speaker: "grok",
      text: "",
      video: "https://example.com/city",
      mediaDescription: "도시 풍경",
    },
  ];
  assert.equal(
    findQuestionMedia([...turns, ...turns], "아까 고양이 사진은 무슨 색이야?")?.id,
    "cat",
  );
  assert.equal(findQuestionMedia(turns, "두 번째 영상 설명해줘")?.id, "city");
  assert.equal(findQuestionMedia(turns, "바다 영상 내용 말해줘")?.id, "sea");
  assert.equal(
    findQuestionMedia(
      [...turns, { id: "q", speaker: "me", text: "고양이 설명", mediaRef: "cat" }],
      "그건 몇 마리야?",
    )?.id,
    "cat",
  );
  assert.equal(findQuestionMedia(turns, "오늘 점심 뭐 먹을까"), undefined);
  for (const question of [
    "이 영상 내용 말해줘",
    "아까 고양이 사진은 무슨 색이야?",
    "사진 보여줬잖아 설명해줘",
  ]) {
    assert.equal(wantsImage(question), false);
    assert.equal(wantsVideo(question), false);
  }
});
test("original selected video is relayed, caption and receiving persona retained", () => {
  const from = { id: "a", name: "아라" },
    to = { id: "h", name: "혜정" };
  const command = relayCommand("혜정한테 바다 영상 보내줘", [from, to]);
  assert.equal(command.id, "h");
  const media = {
    id: "v",
    speaker: "grok",
    text: "",
    video: "https://example.com/v.mp4",
    mediaDescription: "바다",
  };
  const delivered = relayDelivery({
    from,
    to,
    media,
    request: "전달",
    payload: "혜정아, 오빠가 이 바다 영상 보래!",
    at: 123,
    sourceAudience: ["a"],
    targetAudience: ["h"],
  });
  assert.equal(delivered.incoming.video, media.video);
  assert.match(delivered.receipt.text, /영상 전달 완료/);
});
test("volume handles silence and tempo rejects silence but recognizes regular pulses", () => {
  assert.equal(audioLevel(new Float32Array(200)).db, -90);
  assert.ok(Math.abs(audioLevel(new Float32Array(200).fill(0.5)).db + 6.0206) < 0.001);
  assert.equal(estimateTempo(Array(240).fill(0.1)), null);
  assert.equal(
    estimateTempo(Array.from({ length: 240 }, (_, i) => (i % 10 === 0 ? 0.5 : 0.1))),
    120,
  );
  assert.equal(musicCommand("지금 나오는 곡 알려줘"), true);
  assert.equal(musicCommand("지금 나오는 곡 찾지 말고 대화해"), false);
});
test("personality instructions prioritize Korean while allowing explicit language settings", () => {
  const instruction = personaInstructions({ name: "아라", text: "밝게 말해" });
  assert.match(instruction, /한국어를 우선/);
  assert.match(instruction, /외국인·외국어/);
  assert.match(instruction, /불필요한 영어/);
});
