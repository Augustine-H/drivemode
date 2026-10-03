import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PERSONAS, migrateDefaultPersonas, takeAraClear } from "../src/lib/default-personas.ts";
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
    ["아라", "서연", "혜정", "나경", "알리나"],
  );
  assert.deepEqual(result.personas[0], { ...ara, voice: "ara" });
  assert.equal(new Set(result.personas.map((item) => item.voice)).size, 5);
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
  assert.equal(DEFAULT_PERSONAS.length, 5);
});

test("Ara conversations are cleared once and a later import is kept", () => {
  const storage = new Map();
  const memory = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  const personas = [{ id: "custom-ara", name: "아라" }];
  const first = takeAraClear(memory, personas, {
    "custom-ara": [{ id: "leftover" }],
    [DEFAULT_PERSONAS[0].id]: [{ id: "also-leftover" }],
    "grokbot-other": [{ id: "keep" }],
  });
  assert.deepEqual(first["custom-ara"], []);
  assert.deepEqual(first[DEFAULT_PERSONAS[0].id], []);
  assert.deepEqual(first["grokbot-other"], [{ id: "keep" }]);
  const imported = takeAraClear(memory, personas, {
    "custom-ara": [{ id: "imported" }],
  });
  assert.deepEqual(imported["custom-ara"], [{ id: "imported" }]);
});
