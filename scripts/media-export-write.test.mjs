import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeVerified } from "../src/lib/media-export.ts";
import { sha256 } from "../src/lib/media-storage.ts";

// Real Windows/POSIX file IO behind a test handle. This verifies the export algorithm,
// not Chrome's picker permissions, Android's download manager, or NAS transport.
function diskHandle(root, counters) {
  return {
    async getDirectoryHandle(name) {
      const child = join(root, name);
      await mkdir(child, { recursive: true });
      return diskHandle(child, counters);
    },
    async getFileHandle(name) {
      const path = join(root, name);
      await writeFile(path, new Uint8Array(), { flag: "wx" }).catch((error) => {
        if (error.code !== "EEXIST") throw error;
      });
      return {
        async getFile() {
          return new Blob([await readFile(path)]);
        },
        async createWritable() {
          counters.writes++;
          const staged = path + ".pending";
          return {
            async write(blob) {
              await writeFile(staged, new Uint8Array(await blob.arrayBuffer()));
            },
            async close() {
              await rename(staged, path);
            },
            async abort() {
              await unlink(staged).catch((error) => {
                if (error.code !== "ENOENT") throw error;
              });
            },
          };
        },
      };
    },
  };
}
test("export writes and rereads actual disk bytes; identical checksum resumes without rewriting", async () => {
  const root = await mkdtemp(join(tmpdir(), "voice-grok-export-check-"));
  const counters = { writes: 0 },
    dir = diskHandle(root, counters);
  const blob = new Blob(['{"fixture":"export verification","schema":3}']);
  const path = "VoiceGrok/MemoryBackups/device/fixture.vgb";
  await writeVerified(dir, path, blob);
  const bytes = await readFile(join(root, ...path.split("/")));
  assert.equal(bytes.length, blob.size);
  assert.equal(await sha256(new Blob([bytes])), await sha256(blob));
  await writeVerified(dir, path, blob);
  assert.equal(counters.writes, 1);
  await writeVerified(dir, path, new Blob(["changed fixture"]));
  assert.equal(counters.writes, 2);
  assert.equal(await readFile(join(root, ...path.split("/")), "utf8"), "changed fixture");
});
test("permission rejection and failed writer never return verified; abort preserves old fixture", async () => {
  const original = new Blob(["old fixture"]);
  let aborted = false;
  const denied = {
    getFileHandle: async () => ({
      getFile: async () => original,
      createWritable: async () => {
        throw new DOMException("permission denied", "NotAllowedError");
      },
    }),
  };
  await assert.rejects(
    () => writeVerified(denied, "fixture.vgb", new Blob(["new fixture"])),
    /permission denied/,
  );
  const failed = {
    getFileHandle: async () => ({
      getFile: async () => original,
      createWritable: async () => ({
        write: async () => {
          throw new Error("disk full");
        },
        close: async () => assert.fail("close after failed write"),
        abort: async () => {
          aborted = true;
        },
      }),
    }),
  };
  await assert.rejects(
    () => writeVerified(failed, "fixture.vgb", new Blob(["new fixture"])),
    /disk full/,
  );
  assert.equal(aborted, true);
  assert.equal(await original.text(), "old fixture");
});
test("readback checksum mismatch fails even when the file has exactly the expected size", async () => {
  let reads = 0;
  const expected = new Blob(["abcd"]);
  const corrupt = {
    getFileHandle: async () => ({
      getFile: async () => new Blob([++reads === 1 ? "" : "abce"]),
      createWritable: async () => ({
        write: async () => {},
        close: async () => {},
        abort: async () => {},
      }),
    }),
  };
  await assert.rejects(() => writeVerified(corrupt, "fixture.vgb", expected), /검증 실패/);
});
test("unsafe paths are rejected before touching even a test folder", async () => {
  let touched = false;
  const dir = {
    getDirectoryHandle: async () => {
      touched = true;
    },
    getFileHandle: async () => {
      touched = true;
    },
  };
  for (const path of [
    "../outside.vgb",
    "/outside.vgb",
    "VoiceGrok/../outside.vgb",
    "VoiceGrok\\outside.vgb",
  ])
    await assert.rejects(() => writeVerified(dir, path, new Blob(["fixture"])), /안전하지/);
  assert.equal(touched, false);
});
