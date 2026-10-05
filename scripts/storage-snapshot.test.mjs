import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStorageSnapshot } from "../src/lib/storage-snapshot.ts";
import { StorageSnapshotScheduler } from "../src/lib/storage-snapshot-scheduler.ts";
import { buildBackup } from "../src/lib/nangdok-backup.ts";
import { parseMemoryArchive } from "../src/lib/storage-backup.ts";
import { snapshotFixture } from "./helpers/storage-snapshot-fixture.mjs";

export const backupFixture = (text = "백업 테스트") =>
  buildBackup({
    personaId: "qa-persona",
    personas: [{ id: "qa-persona", name: "테스트", text: "테스트 페르소나" }],
    threads: { "qa-persona": [{ id: "qa-turn", speaker: "me", text, at: 1791160000000 }] },
  });
const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), "voice-grok-snapshot-"));
  const fixture = snapshotFixture(root);
  await fixture.deps.put("settings", "memory-auto-folder", true);
  return { root, ...fixture };
};
const settle = () => new Promise((r) => setImmediate(r));
function fakeClock() {
  let now = 0,
    next = 0;
  const tasks = new Map();
  return {
    now: () => now,
    set: (callback, delay) => {
      const id = ++next;
      tasks.set(id, { callback, at: now + delay });
      return id;
    },
    clear: (id) => tasks.delete(id),
    advance(ms) {
      now += ms;
      for (const [id, task] of [...tasks])
        if (task.at <= now) {
          tasks.delete(id);
          task.callback();
        }
    },
  };
}
test("snapshot actual bytes restore; unchanged content creates no extra archive or write", async () => {
  const f = await setup();
  await runStorageSnapshot(() => backupFixture(), f.deps);
  const first = await f.deps.get("snapshots", "latest");
  const status = await f.deps.get("backups", "last-memory");
  assert.equal(status.backupId, first.archive.backupId);
  const dir = join(f.root, "VoiceGrok", "MemoryBackups", first.archive.deviceId);
  const files = await readdir(dir);
  assert.equal(files.length, 1);
  const parsed = await parseMemoryArchive(new Blob([await readFile(join(dir, files[0]))]));
  assert.equal(parsed.backup.threads["qa-persona"][0].text, "백업 테스트");
  await runStorageSnapshot(() => backupFixture(), f.deps);
  assert.equal(f.counters.writes, 1);
  assert.equal((await f.deps.get("snapshots", "latest")).archive.backupId, first.archive.backupId);
  await runStorageSnapshot(() => backupFixture("변경된 대화"), f.deps);
  assert.equal(f.counters.writes, 2);
  assert.equal((await readdir(dir)).length, 2);
});
test("folder change exports unchanged content to the new destination", async () => {
  const f = await setup();
  await runStorageSnapshot(() => backupFixture(), f.deps);
  const id = (await f.deps.get("snapshots", "latest")).archive.backupId;
  f.changeFolder(join(f.root, "second"));
  await runStorageSnapshot(() => backupFixture(), f.deps);
  assert.equal(f.counters.writes, 2);
  assert.equal((await f.deps.get("backups", "last-memory-auto")).backupId, id);
});
test("permission/write failures retain pending work without claiming success and retry after reconnect", async () => {
  for (const mode of ["deny", "fail"]) {
    const f = await setup();
    f[mode](true);
    await runStorageSnapshot(() => backupFixture(), f.deps);
    assert.ok(await f.deps.get("backups", "automatic-error"));
    assert.ok(await f.deps.get("backups", "memory-pending"));
    assert.equal(await f.deps.get("backups", "last-memory-auto"), undefined);
    f[mode](false);
    await runStorageSnapshot(() => backupFixture(), f.deps);
    assert.equal(await f.deps.get("backups", "memory-pending"), null);
    assert.equal(await f.deps.get("backups", "automatic-error"), null);
    assert.ok(await f.deps.get("backups", "last-memory-auto"));
  }
});
test("automatic backup off or encryption selected prevents plaintext folder writes", async () => {
  const f = await setup();
  await f.deps.put("settings", "memory-auto-folder", false);
  await runStorageSnapshot(() => backupFixture(), f.deps);
  assert.equal(f.counters.writes, 0);
  await f.deps.put("settings", "memory-auto-folder", true);
  await f.deps.put("settings", "memory-encrypted", true);
  await runStorageSnapshot(() => backupFixture(), f.deps);
  assert.equal(f.counters.writes, 0);
  await f.deps.put("settings", "memory-encrypted", false);
  await runStorageSnapshot(() => backupFixture(), f.deps);
  assert.equal(f.counters.writes, 1);
});
test("scheduler debounces changes for 30 seconds and returning early cannot bypass wait", async () => {
  const clock = fakeClock(),
    writes = [];
  let text = "first";
  const queue = new StorageSnapshotScheduler(
    async () => {
      writes.push(text);
    },
    () => true,
    clock,
  );
  queue.update(text);
  clock.advance(20000);
  queue.resume();
  await settle();
  assert.deepEqual(writes, []);
  text = "latest";
  queue.update(text);
  clock.advance(29999);
  await settle();
  assert.deepEqual(writes, []);
  clock.advance(1);
  await settle();
  assert.deepEqual(writes, ["latest"]);
  queue.update(text);
  clock.advance(60000);
  await settle();
  assert.equal(writes.length, 1);
  queue.request();
  clock.advance(30000);
  await settle();
  assert.equal(writes.length, 2);
  queue.stop();
});
test("slow writes are serialized and a newer due change is never lost", async () => {
  const clock = fakeClock(),
    writes = [];
  let text = "first",
    release;
  const queue = new StorageSnapshotScheduler(
    async () => {
      const captured = text;
      writes.push(captured);
      if (captured === "first")
        await new Promise((r) => {
          release = r;
        });
    },
    () => true,
    clock,
  );
  queue.update(text);
  clock.advance(30000);
  text = "latest";
  queue.update(text);
  clock.advance(30000);
  assert.deepEqual(writes, ["first"]);
  release();
  await settle();
  clock.advance(0);
  await settle();
  assert.deepEqual(writes, ["first", "latest"]);
  queue.stop();
});
test("hidden app defers writes, resume processes due changes, unmount cancels", async () => {
  const clock = fakeClock(),
    writes = [];
  let visible = false;
  const queue = new StorageSnapshotScheduler(
    async () => {
      writes.push("saved");
    },
    () => visible,
    clock,
  );
  queue.update("first");
  clock.advance(30000);
  await settle();
  assert.equal(writes.length, 0);
  visible = true;
  queue.resume();
  clock.advance(0);
  await settle();
  assert.equal(writes.length, 1);
  queue.update("next");
  queue.stop();
  clock.advance(30000);
  await settle();
  assert.equal(writes.length, 1);
});
