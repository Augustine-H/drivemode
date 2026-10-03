import { test } from "node:test";
import assert from "node:assert/strict";
import { saveLocalBackup, readLocalBackup } from "../src/lib/local-backup.ts";

test("local backup survives storage reuse and replaces only the backup", () => {
  const values = new Map([["conversation", "current"]]);
  const storage = { setItem: (k, v) => values.set(k, v), getItem: (k) => values.get(k) ?? null };
  assert.equal(readLocalBackup(storage), null);
  saveLocalBackup(storage, "first");
  saveLocalBackup(storage, "latest");
  assert.equal(readLocalBackup(storage), "latest");
  assert.equal(values.get("conversation"), "current");
});

test("storage failure or failed verification cannot report success", () => {
  assert.throws(() =>
    saveLocalBackup(
      {
        setItem() {
          throw new Error("quota");
        },
        getItem() {
          return null;
        },
      },
      "backup",
    ),
  );
  assert.throws(() =>
    saveLocalBackup(
      {
        setItem() {},
        getItem() {
          return "old";
        },
      },
      "backup",
    ),
  );
});
