import hashlib
import json
from pathlib import Path
import pytest
from starlette.testclient import TestClient
from mcp.shared.version import SUPPORTED_PROTOCOL_VERSIONS
from naver_mail.server import create_app, TOOLS
from naver_mail.manage_tokens import add_token, revoke_token
from conftest import approved

TOKEN = 'fixture-voice-token-' + 'x' * 40
WEB_TOKEN = 'fixture-web-token-' + 'y' * 40


@pytest.fixture
def config(tmp_path):
    tokens = tmp_path / 'tokens.json'
    tokens.write_text(json.dumps({'tokens': [{'id': 'voice-v1', 'client': 'voice', 'sha256': hashlib.sha256(TOKEN.encode()).hexdigest()}, {'id': 'web-v1', 'client': 'grok_web', 'sha256': hashlib.sha256(WEB_TOKEN.encode()).hexdigest()}]}))
    return {'token_file': str(tokens), 'allowed_hosts': ['mail.example.test', '127.0.0.1:3001'], 'allowed_origins': ['https://grok.com'], 'trusted_proxies': ['127.0.0.1/32'], 'web_auth_verified': False}


def rpc(client, method, params=None, token=TOKEN, scope=None, protocol='2025-11-25', extra=None):
    headers = {'authorization': 'Bearer ' + token, 'accept': 'application/json, text/event-stream', 'MCP-Protocol-Version': protocol}
    if scope:
        headers['X-Naver-Mail-Scope'] = approved(*scope)
    headers.update(extra or {})
    return client.post('/mcp', json={'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params or {}}, headers=headers)


def test_auth_host_origin_https_chunked_limits(mail, config):
    app = create_app(mail, config)
    with TestClient(app, base_url='https://mail.example.test') as client:
        assert client.post('/mcp').status_code == 401
        assert rpc(client, 'tools/list', token='z'*50).status_code == 401
        assert rpc(client, 'tools/list', extra={'origin': 'https://evil.test'}).status_code == 403
        assert rpc(client, 'tools/list', extra={'host': 'evil.test'}).status_code == 403
        assert rpc(client, 'tools/list', token=WEB_TOKEN).status_code == 401
        assert client.post('/mcp', content=b'x'*16385, headers={'authorization': f'Bearer {TOKEN}'}).status_code == 413
        chunks = iter([b'x'*9000, b'y'*9000])
        assert client.post('/mcp', content=chunks, headers={'authorization': f'Bearer {TOKEN}'}).status_code == 413
        assert rpc(client, 'tools/list', extra={'origin': 'https://grok.com'}).status_code == 200
        assert client.get('/health', headers={'authorization': f'Bearer {TOKEN}'}).json()['imap_checked'] is False
    with TestClient(create_app(mail, config), base_url='http://mail.example.test', client=('untrusted', 123)) as client:
        assert rpc(client, 'tools/list', extra={'x-forwarded-proto': 'https'}).status_code == 403


def test_protocol_negotiation_and_readonly_tools(mail, config):
    with TestClient(create_app(mail, config), base_url='https://mail.example.test') as client:
        response = rpc(client, 'initialize', {'protocolVersion': '2026-07-28', 'capabilities': {}, 'clientInfo': {'name': 'fixture-xai-shaped', 'version': '1.0'}})
        assert response.status_code == 200
        assert response.json()['result']['protocolVersion'] == '2025-11-25'
        assert '2026-07-28' not in SUPPORTED_PROTOCOL_VERSIONS
        assert rpc(client, 'tools/list', protocol='2026-07-28').status_code == 400
        tools = rpc(client, 'tools/list').json()['result']['tools']
        assert {tool['name'] for tool in tools} == set(TOOLS)
        assert all(t['annotations']['readOnlyHint'] and not t['annotations']['destructiveHint'] for t in tools)


def test_scoped_tool_calls_cannot_expand_access(mail, config):
    args = {'folder': 'INBOX', 'limit': 5, 'offset': 0}
    with TestClient(create_app(mail, config), base_url='https://mail.example.test') as client:
        result = rpc(client, 'tools/call', {'name': 'mail_list_recent', 'arguments': args}).json()['result']
        assert result['structuredContent']['error'] == 'scope_denied'
        result = rpc(client, 'tools/call', {'name': 'mail_list_recent', 'arguments': args}, scope=('mail_list_recent', args)).json()['result']
        assert len(result['structuredContent']['items']) == 2
        different = {**args, 'folder': 'Archive'}
        result = rpc(client, 'tools/call', {'name': 'mail_list_recent', 'arguments': different}, scope=('mail_list_recent', args)).json()['result']
        assert result['structuredContent']['error'] == 'scope_denied'
        detail_args = {'folder': 'INBOX', 'uid': 1, 'uidvalidity': 77, 'body_chars': 100, 'body_offset': 0}
        result = rpc(client, 'tools/call', {'name': 'mail_get_message', 'arguments': detail_args}, scope=('mail_get_message', detail_args)).json()['result']
        assert '한국어 본문' in result['structuredContent']['body']
        invalid = {**args, 'limit': True}
        assert rpc(client, 'tools/call', {'name': 'mail_list_recent', 'arguments': invalid}, scope=('mail_list_recent', invalid)).json()['result']['isError'] is True


def test_rotation_revocation_without_restart(mail, config, tmp_path):
    output = tmp_path / 'new-token'
    add_token(config['token_file'], output, 'voice', 'voice-v2')
    new = output.read_text().strip()
    assert output.stat().st_mode & 0o777 == 0o600
    with TestClient(create_app(mail, config), base_url='https://mail.example.test') as client:
        assert rpc(client, 'tools/list', token=new).status_code == 200
        assert rpc(client, 'tools/list').status_code == 200
        revoke_token(config['token_file'], 'voice-v1')
        assert rpc(client, 'tools/list').status_code == 401
        assert rpc(client, 'tools/list', token=new).status_code == 200
    assert TOKEN not in Path(config['token_file']).read_text()
    assert new not in Path(config['token_file']).read_text()
    with TestClient(create_app(mail, config), base_url='https://mail.example.test') as client:
        assert rpc(client, 'tools/list', token=new).status_code == 200


def test_rate_limit_and_invalid_registry(mail, config):
    config['requests_per_minute'] = 2
    with TestClient(create_app(mail, config), base_url='https://mail.example.test') as client:
        assert rpc(client, 'tools/list').status_code == 200
        assert rpc(client, 'tools/list').status_code == 200
        assert rpc(client, 'tools/list').status_code == 429
    Path(config['token_file']).write_text('not-json')
    with TestClient(create_app(mail, config), base_url='https://mail.example.test') as client:
        assert rpc(client, 'tools/list').status_code == 503
