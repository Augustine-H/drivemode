// Production backend + real HTTPS MCP. xAI planning/summary are explicit fixtures.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { naverMailEndpoint } from '../../../src/lib/naver-mail.server.ts';

const directory = process.env.NAVER_TEST_PRIVATE;
const env = {
  NAVER_MAIL_ENABLED: 'true',
  NAVER_MAIL_MCP_URL: process.env.NAVER_TEST_URL,
  NAVER_MAIL_TOKEN_FILE: `${directory}/voice.token`,
  XAI_API_KEY: 'synthetic-xai-key-never-used-on-network',
  VOICE_GROK_PRIVATE_NAS: 'true',
  VOICE_GROK_NAS_ORIGIN: 'https://nas.example.test',
  VOICE_GROK_NAS_LOGIN: 'canary@example.test',
};
// There is no paid API fallback, even if the host later receives a real key.
globalThis.fetch = async () => { throw new Error('External fetch forbidden'); };
const check = (condition, code) => { if (!condition) throw new Error(code); };
let sdkCalls = 0;
let upstreamCalls = 0;
let summaryCalls = 0;
const token = (await readFile(env.NAVER_MAIL_TOKEN_FILE, 'utf8')).trim();

function bridge(packet) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.NAVER_TEST_PYTHON, ['-m', 'integration.sdk_bridge'], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(new Error('Synthetic MCP transport failed')) : resolve(value);
    };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(true); }, 15000);
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 100000) { child.kill('SIGKILL'); finish(true); }
      else chunks.push(chunk);
    });
    child.stderr.resume(); // Never relay diagnostics or private packet values.
    child.on('error', () => finish(true));
    child.stdin.on('error', () => finish(true));
    child.on('close', (code) => {
      if (code !== 0) return finish(true);
      try { finish(false, JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { finish(true); }
    });
    child.stdin.end(JSON.stringify(packet));
  });
}

function upstream(plan, attack = false) {
  return async (url, options) => {
    upstreamCalls++;
    check(url === 'https://api.x.ai/v1/responses', 'Unexpected upstream URL');
    const body = JSON.parse(options.body);
    check(!options.body.includes('DO_NOT_SEND_'), 'Unrelated memory reached upstream');
    check(body.store === false, 'Retention must be disabled');
    const first = body.tools?.[0];
    if (first?.type === 'function') {
      return Response.json({ output: [{ type: 'function_call', name: 'naver_mail_request',
        arguments: JSON.stringify(plan) }] });
    }
    if (first?.type === 'mcp') {
      check(body.max_tool_calls === 1 && body.parallel_tool_calls === false,
        'Remote tool count must be bounded');
      const approved = JSON.parse(body.input.find((row) => row.role === 'user').content);
      check(first.allowed_tools.length === 1 && first.allowed_tools[0] === approved.tool,
        'Tool allowlist differs from approved plan');
      check(first.server_url === env.NAVER_MAIL_MCP_URL, 'Unexpected MCP URL');
      sdkCalls++;
      const result = await bridge({ url: first.server_url, headers: first.headers,
        ca_file: `${directory}/ca.pem`, tool: approved.tool,
        arguments: attack ? { ...approved.arguments, uid: 2 } : approved.arguments });
      return Response.json({ output: [{ type: 'mcp_call', name: approved.tool,
        status: 'completed', output: JSON.stringify(result) }] });
    }
    summaryCalls++;
    check(body.tools === undefined, 'Summary must have no tools');
    const content = JSON.parse(body.input.find((row) => row.role === 'user').content);
    check(content.untrustedEmailExcerpt.includes('합성 테스트'), 'Expected synthetic excerpt');
    check(content.persona === '기존 페르소나', 'Persona style lost');
    check(Object.keys(content).sort().join(',') === 'persona,untrustedEmailExcerpt',
      'Unrelated context reached summary');
    return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text',
      text: '합성 메일의 회의는 2026년 10월 9일입니다.' }] }] });
  };
}

async function request(message, plan, selection = [], extra = {}) {
  const headers = {
    'content-type': 'application/json', origin: env.VOICE_GROK_NAS_ORIGIN,
    'tailscale-user-login': env.VOICE_GROK_NAS_LOGIN,
    'x-forwarded-host': 'nas.example.test', 'x-forwarded-proto': 'https', ...extra.headers,
  };
  const response = await naverMailEndpoint(new Request('https://nas.example.test/api/naver-mail', {
    method: 'POST', headers, body: JSON.stringify({ message, selection,
      persona: '기존 페르소나', history: 'DO_NOT_SEND_HISTORY', memory: 'DO_NOT_SEND_MEMORY' }),
  }), env, upstream(plan, extra.attack));
  check(response.headers.get('cache-control') === 'no-store', 'Private response cache enabled');
  const data = await response.json();
  const serialized = JSON.stringify(data);
  check(!serialized.includes(token) && !serialized.includes(env.XAI_API_KEY), 'Credential in response');
  check(!serialized.includes('DO_NOT_SEND_'), 'Unrelated private context in response');
  return { status: response.status, data };
}

async function run() {
  const checks = {};
  for (const headers of [{ 'tailscale-user-login': 'stranger@example.test' },
    { origin: 'https://evil.example' }]) {
    const before = upstreamCalls;
    const result = await request('네이버 메일 목록', { operation: 'mail_list_recent' }, [], { headers });
    check(result.status === 403 && upstreamCalls === before, 'App auth boundary failed');
  }
  checks.app_auth_origin = true;
  if (process.env.NAVER_TEST_REVOKED === 'true') {
    const result = await request('네이버 메일 목록', { operation: 'mail_list_recent' });
    check(result.status === 502 && /네이버 메일/.test(result.data.error), 'Revoked token error not handled');
    return { status: 'passed', checks: { ...checks, revoked_token_korean_error: true },
      sdk_call_attempts: sdkCalls, xai_verified: false, grok_web_verified: false };
  }
  const list = await request('네이버 메일 목록', { operation: 'mail_list_recent' });
  check(list.status === 200 && list.data.items.length === 1
    && list.data.text.includes('[CANARY] 한국어 안내'), 'List failed');
  const selection = list.data.items;
  checks.korean_list = true;
  const detailPlan = { operation: 'mail_get_message', folder: 'INBOX', uid: 1, uidvalidity: 77 };
  const previousSummaries = summaryCalls;
  const original = await request('첫 번째 메일 원문 읽어줘', detailPlan, selection);
  check(original.status === 200 && original.data.text.includes('합성 테스트 메일')
    && !original.data.voiceText.includes('@') && summaryCalls === previousSummaries, 'Read failed');
  checks.selected_original_voice_text = true;
  const summary = await request('첫 번째 메일 요약해줘', detailPlan, selection);
  check(summary.status === 200 && summary.data.voiceText.includes('10월 9일')
    && summaryCalls === previousSummaries + 1, 'Synthetic summary failed');
  checks.mock_summary_isolation = true;
  for (const plan of [
    { operation: 'mail_list_folders' }, { operation: 'mail_get_unread' },
    { operation: 'mail_search', subject: '한국어', since: '2026-10-08', before: '2026-10-09' },
    { ...detailPlan, operation: 'mail_list_attachments' },
    { ...detailPlan, operation: 'mail_get_thread' },
  ]) {
    const result = await request('네이버 첫 번째 메일 조회', plan, selection);
    check(result.status === 200, 'Additional read-only tool failed');
  }
  checks.all_seven_tools = true;
  const changed = await request('첫 번째 메일 원문 읽어줘', detailPlan, selection, { attack: true });
  check(changed.status === 502 && /네이버 메일/.test(changed.data.error), 'Scope expansion succeeded');
  checks.scope_expansion_korean_error = true;
  const stale = await request('첫 번째 메일 원문 읽어줘', { ...detailPlan, uidvalidity: 78 },
    selection.map((item) => ({ ...item, uidvalidity: 78 })));
  check(stale.status === 502 && stale.data.error.includes('식별자가 변경'), 'Stale identity not handled');
  checks.uidvalidity_korean_error = true;
  const callsBeforeWrite = upstreamCalls;
  const write = await request('네이버 메일 삭제해줘', detailPlan, selection);
  check(write.status === 200 && write.data.text.includes('조회 전용')
    && upstreamCalls === callsBeforeWrite, 'Write was not blocked before upstream');
  checks.write_intent_no_upstream = true;
  checks.no_credentials_in_replies = true;
  return { status: 'passed', checks, sdk_call_attempts: sdkCalls, xai_verified: false,
    grok_web_verified: false, model_planning: 'mock', model_summary: 'mock' };
}

try { console.log(JSON.stringify(await run())); }
catch { console.error('Synthetic Voice Grok flow failed; private diagnostics suppressed.'); process.exitCode = 1; }
