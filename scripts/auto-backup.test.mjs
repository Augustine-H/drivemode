import { test } from "node:test";
import assert from "node:assert/strict";
import { AutoBackupQueue } from "../src/lib/auto-backup.ts";

function clock() {
  let next = 0;
  const tasks = new Map();
  return {
    set(callback, delay) {
      assert.equal(delay, 30_000);
      const id = ++next;
      tasks.set(id, callback);
      return id;
    },
    clear(id) {
      tasks.delete(id);
    },
    tick() {
      const pending = [...tasks.values()];
      tasks.clear();
      for (const callback of pending) callback();
    },
    get pending() {
      return tasks.size;
    },
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("30-second debounce saves the latest changed snapshot and skips unchanged data", async () => {
  const timer = clock();
  const writes = [];
  const queue = new AutoBackupQueue(
    async (data) => {
      writes.push(data);
      return true;
    },
    30_000,
    timer,
    "initial",
  );
  queue.update("initial");
  assert.equal(timer.pending, 0);
  queue.update("first");
  queue.update("latest");
  assert.equal(timer.pending, 1);
  timer.tick();
  await settle();
  assert.deepEqual(writes, ["latest"]);
  queue.update("latest");
  assert.equal(timer.pending, 0);
  queue.stop();
});

test("updates during a write are serialized and the newer snapshot is saved last", async () => {
  const timer = clock();
  const writes = [];
  let complete;
  const queue = new AutoBackupQueue(
    async (data) => {
      writes.push(data);
      if (data === "first")
        return new Promise((resolve) => {
          complete = resolve;
        });
      return true;
    },
    30_000,
    timer,
  );
  queue.update("first");
  timer.tick();
  queue.update("latest");
  timer.tick();
  assert.deepEqual(writes, ["first"]);
  complete(true);
  await settle();
  assert.deepEqual(writes, ["first", "latest"]);
  queue.stop();
});

test("turning off and permission failures stop further scheduled writes", async () => {
  for (const fail of [false, true]) {
    const timer = clock();
    const writes = [];
    const queue = new AutoBackupQueue(
      async (data) => {
        writes.push(data);
        return false;
      },
      30_000,
      timer,
    );
    queue.update("first");
    if (fail) {
      timer.tick();
      await settle();
    } else queue.stop();
    queue.update("later");
    timer.tick();
    await settle();
    assert.deepEqual(writes, fail ? ["first"] : []);
  }
});

test("changes reverted before the timer fires need no backup", async () => {
  const timer = clock();
  const writes = [];
  const queue = new AutoBackupQueue(
    async (data) => {
      writes.push(data);
      return true;
    },
    30_000,
    timer,
    "saved",
  );
  queue.update("changed");
  queue.update("saved");
  timer.tick();
  await settle();
  assert.deepEqual(writes, []);
});
