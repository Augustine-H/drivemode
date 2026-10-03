import test from "node:test";
import assert from "node:assert/strict";
import { makeLock, checkLock } from "../src/lib/app-lock.ts";

test("app passwords are salted and reject wrong passwords and damaged records", async () => {
  const a = await makeLock("test-only-1234");
  const b = await makeLock("test-only-1234");
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
  assert.equal(JSON.stringify(a).includes("test-only"), false);
  assert.equal(await checkLock("test-only-1234", a), true);
  assert.equal(await checkLock("wrong-1234", a), false);
  assert.equal(await checkLock("test-only-1234", { salt: "", hash: "" }), false);
  await assert.rejects(makeLock("12345"));
});
