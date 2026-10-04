import test from "node:test";
import assert from "node:assert/strict";
import { wantsImage, wantsVideo } from "../src/lib/media-intent.ts";
import { imageInput } from "../src/lib/ask-prompt.ts";
test("description and prior-media questions never generate another image or video", () => {
  for (const text of [
    "보내준 사진 설명해줘",
    "이 사진 묘사해줘",
    "사진 보여줬잖아 설명해봐",
    "그 영상 내용을 알려줘",
    "사진 보낸 적 없어?",
  ]) {
    assert.equal(wantsImage(text), false);
    assert.equal(wantsVideo(text), false);
  }
  assert.equal(wantsImage("바닷가 사진 보내줘"), true);
  assert.equal(wantsVideo("바닷가 영상 보내줘"), true);
});
test("vision includes a public image but rejects credentials and local URLs", () => {
  assert.deepEqual(imageInput("설명해줘", "https://example.com/photo.png"), [
    { type: "input_image", image_url: "https://example.com/photo.png" },
    { type: "input_text", text: "설명해줘" },
  ]);
  for (const url of [
    "http://example.com/a",
    "https://user:password@example.com/a",
    "https://127.0.0.1/a",
  ])
    assert.equal(imageInput("설명", url), "설명");
});
