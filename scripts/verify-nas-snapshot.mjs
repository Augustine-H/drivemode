import assert from "node:assert/strict";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { runStorageSnapshot } from "../src/lib/storage-snapshot.ts";
import { StorageSnapshotScheduler } from "../src/lib/storage-snapshot-scheduler.ts";
import { buildBackup } from "../src/lib/nangdok-backup.ts";
import { parseMemoryArchive } from "../src/lib/storage-backup.ts";
import { sha256 } from "../src/lib/media-storage.ts";
import { snapshotFixture } from "./helpers/storage-snapshot-fixture.mjs";

// Opt-in only: never part of npm test; never uses private conversations.
if (!process.argv[2]) throw new Error("Provide an explicitly authorized test folder");
const root = join(
  resolve(process.argv[2]),
  `snapshot-check-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
);
await mkdir(root, { recursive: false });
const f = snapshotFixture(root);
await f.deps.put("settings", "memory-auto-folder", true);
let text = "자동 백업 처음 내용",
  failure;
const backup = () =>
  buildBackup({
    personaId: "nas-qa",
    personas: [{ id: "nas-qa", name: "NAS 테스트", text: "합성 테스트" }],
    threads: { "nas-qa": [{ id: "nas-turn", speaker: "me", text, at: 1791160000000 }] },
  });
let finish;
const done = new Promise((r) => {
  finish = r;
});
let calls = 0;
const changedAt = Date.now();
const queue = new StorageSnapshotScheduler(
  async () => {
    try {
      await runStorageSnapshot(backup, f.deps);
      if (++calls === 1) {
        assert.ok(Date.now() - changedAt >= 30000);
        assert.equal(f.counters.writes, 1);
        console.log(
          JSON.stringify({
            phase: "30-second-actual-write",
            elapsedMs: Date.now() - changedAt,
            writes: f.counters.writes,
          }),
        );
        queue.update(text); // No change: must not schedule another write.
        queue.request(); // A retry/foreground pass must still deduplicate bytes and archive.
      } else {
        assert.equal(f.counters.writes, 1);
        console.log(JSON.stringify({ phase: "unchanged-recheck", writes: f.counters.writes }));
        finish();
      }
    } catch (e) {
      failure = e;
      finish();
    }
  },
  () => true,
  { now: Date.now, set: setTimeout, clear: clearTimeout },
);
queue.update(text);
await done;
queue.stop();
if (failure) throw failure;
const snapshot = await f.deps.get("snapshots", "latest");
const directory = join(root, "VoiceGrok", "MemoryBackups", snapshot.archive.deviceId);
const files = await readdir(directory);
assert.equal(files.length, 1);
const file = join(directory, files[0]);
const blob = new Blob([await readFile(file)]);
assert.equal((await parseMemoryArchive(blob)).backup.threads["nas-qa"][0].text, text);
text = "자동 백업 변경 내용";
f.deny(true);
await runStorageSnapshot(backup, f.deps);
assert.ok(await f.deps.get("backups", "memory-pending"));
assert.ok(await f.deps.get("backups", "automatic-error"));
assert.equal(f.counters.writes, 1);
f.deny(false);
await runStorageSnapshot(backup, f.deps);
assert.equal(f.counters.writes, 2);
assert.equal(await f.deps.get("backups", "memory-pending"), null);
const second = (await readdir(directory)).find((name) => name !== files[0]);
assert.ok(second);
assert.equal(
  (await parseMemoryArchive(new Blob([await readFile(join(directory, second))]))).backup.threads[
    "nas-qa"
  ][0].text,
  text,
);
console.log(
  JSON.stringify(
    {
      ok: true,
      root,
      initialFile: file,
      byteSize: blob.size,
      sha256: await sha256(blob),
      writes: f.counters.writes,
      realFilesystem: true,
      database: "isolated in-memory fixture",
      browserPicker: "not exercised",
      deniedPermission: "injected",
      retained: true,
    },
    null,
    2,
  ),
);
