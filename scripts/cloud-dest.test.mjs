import { test } from "node:test";
import assert from "node:assert/strict";

let sequence = 0;
async function setup(options = {}) {
  const writes = [];
  const dir = {
    name: "NAS",
    requestPermission: async () => options.permission ?? "granted",
    queryPermission: async () => options.permission ?? "granted",
    async getFileHandle(name) {
      if (options.writeError) throw new Error("Disconnected");
      let contents = "";
      return {
        async getFile() {
          return new File([options.corrupt ? "" : contents], name);
        },
        async createWritable() {
          return {
            async write(json) {
              contents = json;
              writes.push({ name, json });
            },
            async close() {},
            async abort() {},
          };
        },
      };
    },
  };
  const win = {
    parent: null,
    async showDirectoryPicker() {
      assert.equal(this, win, "Picker must retain its Window receiver");
      if (options.pickerError) throw options.pickerError;
      return dir;
    },
  };
  win.parent = options.framed ? {} : win;
  globalThis.window = win;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
  // Saving remains successful even when remembering the folder is unavailable.
  delete globalThis.indexedDB;
  const mod = await import(`../src/lib/cloud-dest.ts?test=${sequence++}`);
  return { mod, writes, dir, win };
}

test("folder picker works with its Window receiver, then saves to the remembered folder", async () => {
  const { mod, writes, win } = await setup();
  assert.equal((await mod.placeInCloud("first", "one.json", false)).ok, true);
  win.showDirectoryPicker = () => {
    throw new Error("Must reuse folder");
  };
  assert.deepEqual(await mod.placeInCloud("second", "two.json", false), {
    ok: true,
    where: "NAS",
    via: "folder",
    fresh: false,
  });
  assert.deepEqual(writes, [
    { name: "one.json", json: "first" },
    { name: "two.json", json: "second" },
  ]);
});

test("first click opens picker without waiting on IndexedDB", async () => {
  const { mod, win } = await setup();
  globalThis.indexedDB = {
    open() {
      throw new Error("Must not read DB during click");
    },
  };
  let opened = false;
  win.showDirectoryPicker = function () {
    assert.equal(this, win);
    opened = true;
    return Promise.reject(new DOMException("", "AbortError"));
  };
  const result = mod.placeInCloud("{}", "one.json", false);
  assert.equal(opened, true);
  assert.deepEqual(await result, { ok: false, reason: "cancel" });
});

test("restored folder requests permission synchronously and other-folder replaces it", async () => {
  const { mod, dir, writes } = await setup();
  const restored = { ...dir, name: "Drive" };
  globalThis.indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = {
          close() {},
          transaction() {
            return {
              objectStore() {
                return {
                  get() {
                    const get = {};
                    queueMicrotask(() => {
                      get.result = restored;
                      get.onsuccess();
                    });
                    return get;
                  },
                };
              },
            };
          },
        };
        request.onsuccess();
      });
      return request;
    },
  };
  assert.equal(await mod.cloudFolderName(), "Drive");
  let requested = false;
  restored.requestPermission = async () => {
    requested = true;
    return "granted";
  };
  const result = mod.placeInCloud("restored", "restored.json", false);
  assert.equal(requested, true);
  assert.equal((await result).where, "Drive");
  delete globalThis.indexedDB;
  assert.equal((await mod.placeInCloud("new", "new.json", true)).where, "NAS");
  assert.equal(await mod.cloudFolderName(), "NAS");
  assert.equal(writes.length, 2);
});

test("permission denial and disconnected NAS report failure without reopening picker", async () => {
  for (const [options, reason] of [
    [{ permission: "denied" }, "permission"],
    [{ writeError: true }, "failed"],
  ]) {
    const { mod, dir, win } = await setup(options);
    // Seed a working destination, then simulate a later failure.
    const original = dir.getFileHandle;
    dir.getFileHandle = async () => ({
      getFile: async () => new File(["{}"], "seed.json"),
      createWritable: async () => ({ write: async () => {}, close: async () => {} }),
    });
    await mod.placeInCloud("{}", "seed.json", false);
    dir.getFileHandle = original;
    win.showDirectoryPicker = () => {
      throw new Error("Must not consume another click");
    };
    assert.deepEqual(await mod.placeInCloud("{}", "next.json", false), { ok: false, reason });
  }
});

test("SecurityError is distinct from preview and cancellation", async () => {
  for (const [options, reason] of [
    [{ framed: true }, "preview"],
    [{ pickerError: new DOMException("", "SecurityError") }, "activation"],
    [{ pickerError: new DOMException("", "AbortError") }, "cancel"],
  ]) {
    const { mod } = await setup(options);
    assert.deepEqual(await mod.placeInCloud("{}", "one.json", false), { ok: false, reason });
  }
});

test("backup names distinguish saves within the same minute", async () => {
  const { mod } = await setup();
  assert.notEqual(
    mod.backupFileName("2026-10-03T01:01:01.001Z"),
    mod.backupFileName("2026-10-03T01:01:02.001Z"),
  );
});

test("phone shares JSON contents without downloading a file", async () => {
  const { mod, win } = await setup();
  delete win.showDirectoryPicker;
  navigator.canShare = () => true;
  navigator.share = async ({ files }) => {
    assert.equal(await files[0].text(), '{"backup":true}');
  };
  assert.deepEqual(await mod.placeInCloud('{"backup":true}', "backup.json", false), {
    ok: true,
    where: "",
    via: "share",
    fresh: false,
  });
});

test("does not report success when the destination file contents were not saved", async () => {
  const { mod } = await setup({ corrupt: true });
  assert.deepEqual(await mod.placeInCloud('{"backup":true}', "backup.json", false), {
    ok: false,
    reason: "failed",
  });
});

test("cloud import opens a file in the remembered folder with its Window receiver", async () => {
  const { mod, win, dir } = await setup();
  await mod.placeInCloud("{}", "backup.json", false);
  win.showOpenFilePicker = async function (options) {
    assert.equal(this, win);
    assert.equal(options.startIn, dir);
    return [{ getFile: async () => new File(['{"restored":true}'], "backup.json") }];
  };
  assert.equal(await (await mod.openCloudFile()).text(), '{"restored":true}');
});

test("automatic backups only write with existing permission and never prompt or share", async () => {
  const { mod, dir, win, writes } = await setup();
  assert.deepEqual(await mod.autoSaveInCloud("{}", "auto.json"), { ok: false, reason: "blocked" });
  await mod.placeInCloud("{}", "initial.json", false);
  win.showDirectoryPicker = () => {
    throw new Error("Automatic backups must not prompt");
  };
  dir.requestPermission = () => {
    throw new Error("Automatic backups must not request permission");
  };
  navigator.share = () => {
    throw new Error("Automatic backups must not share");
  };
  assert.equal((await mod.autoSaveInCloud('{"changed":true}', "auto.json")).ok, true);
  dir.queryPermission = async () => "prompt";
  assert.deepEqual(await mod.autoSaveInCloud("{}", "auto.json"), {
    ok: false,
    reason: "permission",
  });
  assert.equal(writes.length, 2);
});
