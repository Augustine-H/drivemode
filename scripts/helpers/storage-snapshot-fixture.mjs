import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { writeVerified } from "../../src/lib/media-export.ts";

// Test adapter: real filesystem bytes, isolated in-memory database, no browser permissions.
export function snapshotFixture(root) {
  const stores = new Map();
  const counters = { writes: 0, active: 0, maximumActive: 0 };
  let permission = "granted",
    fail = false;
  let chain = Promise.resolve();
  function diskFolder(path) {
    return {
      fixturePath: resolve(path),
      queryPermission: async () => permission,
      isSameEntry: async (other) => other.fixturePath === resolve(path),
      async getDirectoryHandle(name) {
        const child = join(path, name);
        await mkdir(child, { recursive: true });
        return diskFolder(child);
      },
      async getFileHandle(name) {
        const file = join(path, name);
        await writeFile(file, new Uint8Array(), { flag: "wx" }).catch((e) => {
          if (e.code !== "EEXIST") throw e;
        });
        return {
          getFile: async () => new Blob([await readFile(file)]),
          async createWritable() {
            counters.writes++;
            const staged = file + ".pending";
            return {
              async write(blob) {
                if (fail) throw new Error("fixture disconnected");
                await writeFile(staged, new Uint8Array(await blob.arrayBuffer()));
              },
              close: () => rename(staged, file),
              abort: () =>
                unlink(staged).catch((e) => {
                  if (e.code !== "ENOENT") throw e;
                }),
            };
          },
        };
      },
    };
  }
  let folder = diskFolder(root);
  const deps = {
    get: async (store, key) => stores.get(store)?.get(key),
    put: async (store, key, value) => {
      if (!stores.has(store)) stores.set(store, new Map());
      stores.get(store).set(key, value);
    },
    keys: async (store) => [...(stores.get(store)?.keys() ?? [])],
    journal: async () => [],
    media: async () => [],
    folder: async () => folder,
    lock(work) {
      const task = chain.then(async () => {
        counters.maximumActive = Math.max(counters.maximumActive, ++counters.active);
        try {
          return await work();
        } finally {
          counters.active--;
        }
      });
      chain = task.catch(() => {});
      return task;
    },
    write: writeVerified,
    prune: async (keys) => {
      for (const key of keys) stores.get("snapshots").delete(key);
    },
  };
  return {
    deps,
    counters,
    stores,
    deny: (value) => {
      permission = value ? "denied" : "granted";
    },
    fail: (value) => {
      fail = value;
    },
    changeFolder: (path) => {
      folder = diskFolder(path);
    },
  };
}
