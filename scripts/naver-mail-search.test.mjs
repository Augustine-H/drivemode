import test from 'node:test';
import assert from 'node:assert/strict';
import { searchNaverRows } from '../src/lib/naver-mail-search.server.ts';

function fixture(rows, native = []) {
  const calls = [];
  const client = {
    search: async (query, options) => {
      calls.push({ query, options });
      return query.text ? native : rows.filter(r => !query.seen || !r.flags.has('\\Seen')).map(r => r.uid);
    },
    fetchAll: async (uids, fields, options) => {
      calls.push({ uids, fields, options });
      return rows.filter(r => uids.includes(r.uid));
    },
  };
  return { client, calls };
}
const row = (uid, subject, name = '', seen = false) => ({
  uid, envelope: { subject, from: [{ name, address: 'self@example.com' }] },
  flags: new Set(seen ? ['\\Seen'] : []),
});

test('decoded Korean titles are found when IMAP TEXT returns nothing', async () => {
  const f = fixture([row(1, '다른 메일'), row(7, '[보이스 그록 테스트] 초안 수정 및 발송')]);
  assert.deepEqual((await searchNaverRows(f.client, '보이스 그록', false)).map(r => r.uid), [7]);
  assert.equal(f.calls.at(-1).fields.source, undefined);
  assert.equal(f.calls.at(-1).options.uid, true);
});
test('normalize Hangul and full-width text, match sender without matching unrelated fields', async () => {
  const f = fixture([row(3, '회의 안내'.normalize('NFD')), row(4, '안내', '허만학'), row(5, 'ＡＢＣ')]);
  assert.deepEqual((await searchNaverRows(f.client, '회의', false)).map(r => r.uid), [3]);
  assert.deepEqual((await searchNaverRows(f.client, '허만학', false)).map(r => r.uid), [4]);
  assert.deepEqual((await searchNaverRows(f.client, 'abc', false)).map(r => r.uid), [5]);
  assert.deepEqual(await searchNaverRows(f.client, '없는 검색어', false), []);
});
test('merge partial native body results with recent headers, deduplicate and sort', async () => {
  const f = fixture([row(1, 'older body match'), row(7, '보이스'), row(8, '보이스')], [1, 7]);
  assert.deepEqual((await searchNaverRows(f.client, '보이스', false)).map(r => r.uid), [8, 7, 1]);
});
test('respect unread filter and bound supplemental scanning to 100 and output to 20', async () => {
  const rows = Array.from({length: 160}, (_, i) => row(i + 1, '보이스', '', i === 159));
  const f = fixture(rows);
  const results = await searchNaverRows(f.client, '보이스', true);
  assert.equal(results.length, 20);
  assert.equal(results[0].uid, 159);
  assert.equal(f.calls.at(-1).uids.length, 100);
  assert.deepEqual(f.calls[0].query, { text: '보이스', seen: false });
});
test('native older results survive the recent window; ordinary listing stays one search', async () => {
  const rows = Array.from({length: 150}, (_, i) => row(i + 1, '다른 제목'));
  const f = fixture(rows, [1]);
  assert.deepEqual((await searchNaverRows(f.client, '본문', false)).map(r => r.uid), [1]);
  const plain = fixture(rows);
  assert.equal((await searchNaverRows(plain.client, '', false)).length, 20);
  assert.equal(plain.calls.filter(call => call.query).length, 1);
});
