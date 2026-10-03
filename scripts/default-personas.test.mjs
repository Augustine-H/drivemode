import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PERSONAS,
  migrateDefaultPersonas,
} from "../src/lib/default-personas.ts";
test("defaults replace old personas and drop their conversations", () => {
  const ara = {
    id: "custom-ara",
    name: "아라",
    text: "말투",
    password: "",
    locked: false,
    template: "기존 설정",
    memories: [{ source: "memory.md", content: "기억" }],
  };
  const old = { id: "plain", name: "기본", text: "", password: "", locked: true };
  const result = migrateDefaultPersonas(
    [old, ara],
    { plain: [{ id: "old" }], "custom-ara": [{ id: "current" }] },
    "plain",
  );
  assert.deepEqual(
    result.personas.map((item) => item.name),
    ["아라", "서연", "혜정", "나경", "알리나", "그록"],
  );
  assert.deepEqual(result.personas[0], { ...ara, voice: "ara" });
  assert.equal(new Set(result.personas.map((item) => item.voice)).size, 6);
  const changed = { ...result.personas[0], voice: "iris" };
  assert.equal(migrateDefaultPersonas([changed], {}, changed.id).personas[0].voice, "iris");
  assert.equal(result.personaId, ara.id);
  assert.deepEqual(
    result.threads[ara.id].map((turn) => turn.id),
    ["current"],
  );
  assert.equal(result.threads.plain, undefined);
  assert.deepEqual(
    migrateDefaultPersonas(result.personas, result.threads, result.personaId),
    result,
  );
  assert.equal(DEFAULT_PERSONAS.length, 6);
});
