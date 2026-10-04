import test from "node:test";
import assert from "node:assert/strict";
import { relayCommand } from "../src/lib/conversation-actions.ts";
import {
  relayDelivery,
  storeRelay,
  relayMemoryKey,
  rememberRelays,
} from "../src/lib/persona-relay.ts";
import { rememberRoomEvents, knownTurns, conversationMemory } from "../src/lib/room-context.ts";
import { buildBackup, parseNangdokBackup } from "../src/lib/nangdok-backup.ts";
const personas = [
  { id: "ara", name: "아라", voice: "ara" },
  { id: "hye", name: "혜정", voice: "luna" },
  { id: "grok", name: "그록" },
];
test("relay accepts telling and sending text/photos while retaining negative statements", () => {
  for (const ending of ["전해줘", "알려줘", "알려 줘", "전달해줘", "보내줘", "알려주라고"]) {
    assert.deepEqual(relayCommand(`아라야 혜정이한테 오늘은 안 간다고 ${ending}`, personas), {
      id: "hye",
      message: "오늘은 안 간다고",
    });
  }
  assert.deepEqual(relayCommand("혜정에게 이 고양이 사진 보내줘", personas), {
    id: "hye",
    message: "이 고양이 사진",
  });
  assert.equal(relayCommand("혜정한테 이 사진 전달하지 마", personas), null);
});
test("old join/leave notices are remembered by both host and guest after leaving", () => {
  const old = {
    grok: [
      { id: "event-old-1", speaker: "grok", text: "아라 님이 들어왔습니다.", event: "join", at: 1 },
      { id: "event-old-2", speaker: "grok", text: "아라 님이 나갔습니다.", event: "leave", at: 2 },
    ],
    ara: [],
  };
  const migrated = rememberRoomEvents(old, personas);
  assert.equal(migrated.ara.length, 0);
  assert.equal(knownTurns(migrated, "ara").length, 2);
  assert.match(conversationMemory(migrated, "ara", "어느 방에 초대됐어?"), /그록 방에 초대되어/);
  assert.match(
    conversationMemory(migrated, "ara", "어느 방에서 나왔어?"),
    /그록 방에서 나갔습니다/,
  );
  assert.equal(knownTurns(migrated, "hye").length, 0);
  assert.deepEqual(rememberRoomEvents(migrated, personas), migrated);
});
test("delivery preserves the styled sender message, voice and exact selected image URL", () => {
  const media = {
    id: "cat",
    speaker: "grok",
    text: "",
    image: "https://example.com/cat.png",
    mediaDescription: "고양이 사진",
  };
  const { incoming, receipt } = relayDelivery({
    from: personas[0],
    to: personas[1],
    request: "혜정에게 이 사진 전해줘",
    payload: "혜정아, 오빠가 이 고양이 사진 보래!",
    media,
    at: 10,
    sourceAudience: ["ara"],
    targetAudience: ["hye"],
  });
  assert.equal(incoming.text, "혜정아, 오빠가 이 고양이 사진 보래!");
  assert.equal(incoming.image, media.image);
  assert.equal(incoming.personaId, "ara");
  assert.equal(incoming.voice, "ara");
  assert.match(receipt.text, /아라 → 혜정: 사진 전달 완료/);
  assert.equal(receipt.event, "relay");
  const original = { ara: [], hye: [] };
  const threads = storeRelay(original, "ara", { incoming, receipt });
  assert.deepEqual(threads.hye, []);
  assert.equal(threads.ara.length, 1);
  assert.equal(threads[relayMemoryKey("hye")][0].image, media.image);
  assert.deepEqual(original, { ara: [], hye: [] });
  assert.equal(knownTurns(threads, "hye")[0].image, media.image);
  assert.match(conversationMemory(threads, "hye", "아라가 뭘 전달했어?"), /고양이 사진/);
  assert.match(conversationMemory(threads, "ara", "혜정에게 전달했어?"), /전달 완료/);
});

test("legacy received bubbles become private relay memory without losing text/media or other chats", () => {
  const media = {
    id: "video",
    speaker: "grok",
    text: "",
    video: "https://example.com/sea.mp4",
    mediaDescription: "바다 영상",
  };
  const delivery = relayDelivery({
    from: personas[0],
    to: personas[1],
    request: "영상 전달",
    payload: "바다 영상 봐!",
    media,
    at: 2,
    sourceAudience: ["ara"],
    targetAudience: ["hye", "grok"],
  });
  const normal = { id: "normal", speaker: "me", text: "혜정과 기존 대화", at: 1 };
  const migrated = rememberRelays({ ara: [delivery.receipt], hye: [normal, delivery.incoming] });
  assert.deepEqual(migrated.hye, [normal]);
  assert.deepEqual(rememberRelays(migrated), migrated);
  assert.equal(knownTurns(migrated, "hye").find((t) => t.relay)?.video, media.video);
  assert.equal(knownTurns(migrated, "grok").length, 0);
  const restored = parseNangdokBackup(
    buildBackup({
      personaId: "hye",
      personas: personas.map((p) => ({ ...p, text: "", password: "", locked: false })),
      threads: migrated,
    }),
  );
  assert.match(conversationMemory(restored.threads, "hye", "전달한 영상"), /바다 영상/);
  assert.deepEqual(restored.threads.hye, [normal]);
});

test("sending to the source room's host only appends receipt to visible room", () => {
  const delivery = relayDelivery({
    from: personas[0],
    to: personas[1],
    request: "알려줘",
    payload: "오늘 안 간대",
    at: 3,
    sourceAudience: ["ara", "hye"],
    targetAudience: ["hye"],
  });
  const threads = storeRelay({ hye: [] }, "hye", delivery);
  assert.deepEqual(threads.hye, [delivery.receipt]);
  assert.equal(
    knownTurns(threads, "hye").some((t) => t.text === "오늘 안 간대"),
    true,
  );
});
test("membership facts survive long chat and backup restoration", () => {
  const event = {
    id: "event-new",
    speaker: "grok",
    event: "leave",
    text: "아라 님이 그록 방에서 나갔습니다.",
    personaId: "ara",
    personaName: "아라",
    audience: ["ara", "grok"],
    at: 1,
  };
  const threads = {
    grok: [
      event,
      ...Array.from({ length: 30 }, (_, i) => ({
        id: "me-" + i,
        speaker: "me",
        text: "관계없는 대화".repeat(1000),
        at: 10 + i,
        audience: ["grok"],
      })),
    ],
  };
  const backup = buildBackup({
    personaId: "grok",
    personas: personas.map((p) => ({ ...p, text: "", password: "", locked: false })),
    threads,
  });
  const restored = parseNangdokBackup(JSON.parse(JSON.stringify(backup)));
  assert.match(
    conversationMemory(restored.threads, "ara", "대화가 끝난 방 기억나?"),
    /그록 방에서 나갔습니다/,
  );
});
