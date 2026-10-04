import test from "node:test";
import assert from "node:assert/strict";
import {
  participantCommand,
  roomChanges,
  knownTurns,
  conversationMemory,
  findQuestionMedia,
} from "../src/lib/room-context.ts";
import { imageInput } from "../src/lib/ask-prompt.ts";
import { allowedVideoSource } from "../src/lib/video-source.ts";
import { buildBackup, parseNangdokBackup } from "../src/lib/nangdok-backup.ts";
const personas = [
  { id: "g", name: "그록" },
  { id: "a", name: "아라" },
  { id: "h", name: "혜정" },
];
test("chat membership commands target the guest, protect negation and ordinary conversation", () => {
  assert.deepEqual(participantCommand("그록아 아라 초대해줘", personas), {
    id: "a",
    action: "join",
  });
  assert.deepEqual(participantCommand("아라 나가줘", personas), { id: "a", action: "leave" });
  assert.equal(participantCommand("아라 초대하지마", personas), null);
  assert.equal(participantCommand("아라가 나가면 어떻게 돼?", personas), null);
  assert.equal(participantCommand("아라 영화 대화 보내줘", personas), null);
});
test("host remains and an invitation changes membership without copying threads", () => {
  assert.deepEqual(roomChanges("g", ["g"], ["a"]), {
    members: ["g", "a"],
    joined: ["a"],
    left: [],
  });
  assert.deepEqual(roomChanges("g", ["g", "a"], []), { members: ["g"], joined: [], left: ["a"] });
});
const threads = {
  a: [{ id: "private", speaker: "me", text: "영화 인터스텔라 이야기", at: 1 }],
  g: [
    { id: "host", speaker: "me", text: "그록 개인 대화", at: 2 },
    { id: "shared", speaker: "grok", text: "함께 이야기한 영화", audience: ["g", "a"], at: 3 },
    {
      id: "cat",
      speaker: "grok",
      text: "",
      image: "https://example.com/cat.png",
      mediaDescription: "고양이 사진 보내줘",
      audience: ["g", "a"],
      at: 4,
    },
    {
      id: "dog",
      speaker: "grok",
      text: "",
      image: "https://example.com/dog.png",
      mediaDescription: "강아지 사진 보내줘",
      audience: ["g"],
      at: 5,
    },
  ],
};
test("guest remembers its own film and attended room media after leaving, but no private host history", () => {
  assert.deepEqual(
    knownTurns(threads, "a").map((t) => t.id),
    ["private", "shared", "cat"],
  );
  assert.match(conversationMemory(threads, "a", "아까 영화 설명"), /인터스텔라/);
  assert.match(conversationMemory(threads, "a", "사진"), /고양이/);
  assert.equal(threads.a.length, 1);
});
test("specific image selection overrides the latest dog, latest image and subject selection work", () => {
  assert.equal(findQuestionMedia(threads.g, "이 사진 설명", "cat").id, "cat");
  assert.equal(findQuestionMedia(threads.g, "최근 사진 설명").id, "dog");
  assert.equal(findQuestionMedia(threads.g, "아까 받은 고양이 사진 설명").id, "cat");
  assert.equal(
    findQuestionMedia([{ id: "v", video: "https://example.com/v.mp4" }], "이 영상 설명").id,
    "v",
  );
});
test("video frames are bounded and invalid data never enters multimodal input", () => {
  const frame = "data:image/jpeg;base64,YWJj";
  const result = imageInput("영상 설명", undefined, [frame, frame, frame, frame]);
  assert.equal(result.length, 4);
  assert.equal(result[0].type, "input_image");
  assert.match(result[3].text, /시작·중간·끝/);
  assert.equal(imageInput("설명", undefined, ["data:text/html;base64,YWJj"]), "설명");
});
test("backup preserves membership and shared media audience", () => {
  const backup = buildBackup({
    personaId: "g",
    personas: personas.map((p) => ({ ...p, text: "", password: "1234", locked: false })),
    threads,
    roomMembers: { g: ["g", "a"] },
  });
  const restored = parseNangdokBackup(JSON.parse(JSON.stringify(backup)));
  assert.deepEqual(restored.roomMembers, { g: ["g", "a"] });
  assert.deepEqual(
    knownTurns(restored.threads, "a").map((t) => t.id),
    ["private", "shared", "cat"],
  );
});

test("a guest also remembers an older image explicitly discussed while attending", () => {
  const data = {
    g: [
      threads.g[2],
      {
        id: "quoted",
        speaker: "me",
        text: "이 사진 설명",
        mediaRef: "cat",
        audience: ["g", "h"],
        at: 6,
      },
    ],
  };
  assert.deepEqual(
    knownTurns(data, "h").map((t) => t.id),
    ["cat", "quoted"],
  );
  assert.equal(findQuestionMedia(knownTurns(data, "h"), "고양이 사진 설명").id, "cat");
});

test("video relay only accepts public xAI hosts without credentials", () => {
  assert.equal(allowedVideoSource("https://vidgen.x.ai/bucket/video.mp4"), true);
  for (const url of [
    "https://127.0.0.1/a",
    "https://vidgen.x.ai.evil.com/a",
    "https://user:secret@vidgen.x.ai/a",
    "http://vidgen.x.ai/a",
    "https://vidgen.x.ai:8080/a",
  ])
    assert.equal(allowedVideoSource(url), false);
});

test("long unrelated recent chat does not displace the requested older film memory", () => {
  const data = {
    a: [
      ...threads.a,
      ...Array.from({ length: 20 }, (_, i) => ({
        id: "later-" + i,
        speaker: "me",
        text: "날씨 이야기 " + "긴 대화 ".repeat(600),
        at: 10 + i,
      })),
    ],
  };
  const memory = conversationMemory(data, "a", "아까 영화를 설명해줘");
  assert.match(memory, /인터스텔라/);
  assert.ok(memory.length <= 6501);
});
