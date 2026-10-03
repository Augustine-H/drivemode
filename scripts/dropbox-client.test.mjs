import { test } from "node:test";
import assert from "node:assert/strict";
import { DropboxClient, DROPBOX_APP_KEY } from "../src/lib/dropbox-client.ts";

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}
const fixture = {
  bot: "아라",
  date: "2026-10-03",
  timezone: "Asia/Seoul",
  channel: "1:1",
  message_count: 1,
  messages: [{ time: "14:07", speaker: "아라", text: "연결 테스트" }],
};
const entry = {
  ".tag": "file",
  name: "2026-10-03_아라.json",
  path_lower: "/grok/grokbot/아라/2026-10-03_아라.json",
  size: 300,
};
function json(value) {
  return new Response(JSON.stringify(value), { status: 200 });
}
async function setup(request) {
  const local = storage();
  const session = storage();
  const calls = [];
  const client = new DropboxClient(local, session, async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/oauth2/token") && options.body.get("grant_type") === "authorization_code")
      return json({ access_token: "test-access", refresh_token: "test-refresh", expires_in: 3600 });
    return request(url, options);
  });
  const authorize = new URL(await client.authorizationUrl("https://example.com/"));
  await client.finishAuthorization(
    `https://example.com/?code=test-code&state=${authorize.searchParams.get("state")}`,
  );
  return { client, local, session, calls, authorize };
}

test("PKCE uses read scopes, state and verifier, without an app secret", async () => {
  const { client, calls, authorize } = await setup(() => {
    throw new Error("Unexpected");
  });
  assert.equal(authorize.searchParams.get("client_id"), DROPBOX_APP_KEY);
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorize.searchParams.get("scope"), "files.metadata.read files.content.read");
  assert.ok(calls[0].options.body.get("code_verifier").length >= 43);
  assert.equal(calls[0].options.body.has("client_secret"), false);
  assert.equal(client.connected(), true);
});

test("invalid state never exchanges a token", async () => {
  let count = 0;
  const client = new DropboxClient(storage(), storage(), async () => {
    count++;
    return json({});
  });
  await client.authorizationUrl("https://example.com/");
  await assert.rejects(client.finishAuthorization("https://example.com/?code=test&state=wrong"));
  assert.equal(count, 0);
  assert.equal(client.connected(), false);
});

test("browser fetch keeps its global receiver during OAuth and API calls", async () => {
  let calls = 0;
  const client = new DropboxClient(storage(), storage(), async function (url) {
    assert.equal(this, globalThis);
    calls++;
    if (url.endsWith("/oauth2/token"))
      return json({ access_token: "test", refresh_token: "test", expires_in: 3600 });
    return json({ entries: [], has_more: false });
  });
  const authorize = new URL(await client.authorizationUrl("https://example.com/"));
  await client.finishAuthorization(
    `https://example.com/?code=test&state=${authorize.searchParams.get("state")}`,
  );
  await client.backups("/Grok/grokbot");
  assert.equal(calls, 2);
  await assert.rejects(
    client.backups("/Grok/grokbot/아라/2026-10-03_아라.json"),
    /파일 경로가 아닌/,
  );
  assert.equal(calls, 2);
});

test("folder pagination and Unicode download headers import bot data, excluding MD", async () => {
  const { client, calls } = await setup((url, options) => {
    if (url.endsWith("/list_folder"))
      return json({
        entries: [{ ".tag": "file", name: "readme.md" }],
        cursor: "next",
        has_more: true,
      });
    if (url.endsWith("/list_folder/continue")) {
      assert.deepEqual(JSON.parse(options.body), { cursor: "next" });
      return json({ entries: [entry], has_more: false });
    }
    assert.equal(url, "https://content.dropboxapi.com/2/files/download");
    const argument = options.headers["Dropbox-API-Arg"];
    assert.match(argument, /\\u/);
    assert.equal(JSON.parse(argument).path, entry.path_lower);
    return json(fixture);
  });
  const result = await client.backups("/Grok/grokbot");
  assert.equal(result.backups[0].bot, "아라");
  assert.equal(result.backups[0].turns.length, 1);
  assert.deepEqual(result.errors, []);
  assert.equal(calls.filter((call) => call.url.includes("/download")).length, 1);
});

test("expired grant refreshes and disconnect removes credentials", async () => {
  const { client, local, calls } = await setup((url, options) => {
    if (url.endsWith("/oauth2/token")) {
      assert.equal(options.body.get("grant_type"), "refresh_token");
      return json({ access_token: "renewed", expires_in: 3600 });
    }
    if (url.endsWith("/list_folder")) {
      assert.equal(options.headers.Authorization, "Bearer renewed");
      return json({ entries: [], has_more: false });
    }
    if (url.endsWith("/revoke")) return new Response(null, { status: 200 });
    throw new Error("Unexpected");
  });
  local.setItem(
    "voice-grok-dropbox-grant",
    JSON.stringify({ access_token: "expired", refresh_token: "test-refresh", expires_at: 1 }),
  );
  await client.backups("/Grok/grokbot");
  await client.disconnect();
  assert.equal(client.connected(), false);
  assert.ok(calls.some((call) => call.url.endsWith("/revoke")));
});

test("out-of-folder and invalid JSON files are reported without importing", async () => {
  const { client, calls } = await setup((url) =>
    url.endsWith("/list_folder")
      ? json({
          entries: [
            { ...entry, path_lower: "/other/아라.json" },
            { ...entry, name: "bad.json" },
          ],
          has_more: false,
        })
      : new Response("broken JSON"),
  );
  const result = await client.backups("/Grok/grokbot");
  assert.equal(result.backups.length, 0);
  assert.equal(result.errors.length, 2);
  assert.equal(calls.filter((call) => call.url.includes("/download")).length, 1);
  await assert.rejects(client.backups("/Grok/../other"));
});

test("conflicting files for the same bot/day are not applied", async () => {
  const { client } = await setup((url) =>
    url.endsWith("/list_folder")
      ? json({ entries: [entry, { ...entry, name: "copy.json" }], has_more: false })
      : json(fixture),
  );
  const result = await client.backups("/Grok/grokbot");
  assert.equal(result.backups.length, 0);
  assert.equal(result.errors.length, 1);
});
