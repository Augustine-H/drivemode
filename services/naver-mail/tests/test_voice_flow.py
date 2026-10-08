"""Cross-language production backend -> actual TLS MCP, with explicit model fixtures."""
import asyncio
import json
import subprocess
import sys
from pathlib import Path

import pytest
from integration.sdk_bridge import call


@pytest.mark.parametrize('url,tool', [
    ('https://mail.example.test/mcp', 'mail_list_recent'),
    ('http://127.0.0.1/mcp', 'mail_list_recent'),
    ('https://127.0.0.1/mcp', 'mail_delete'),
])
def test_bridge_rejects_external_targets_and_write_tools(url, tool):
    # All rejected before reading headers, CA files or opening sockets.
    with pytest.raises(ValueError):
        asyncio.run(call({'url': url, 'tool': tool}))


def test_production_voice_backend_with_real_https_canary():
    result = subprocess.run([sys.executable, '-m', 'integration.voice_check'],
        cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True, timeout=90)
    assert result.returncode == 0, 'Synthetic Voice Grok check failed; private diagnostics suppressed'
    report = json.loads(result.stdout)
    assert report['status'] == 'passed'
    assert report['sdk_call_attempts'] == 11
    assert all(report['checks'].values())
    assert {'app_auth_origin', 'all_seven_tools', 'mock_summary_isolation',
        'scope_expansion_korean_error', 'uidvalidity_korean_error',
        'revoked_token_korean_error', 'no_credentials_in_replies'} <= set(report['checks'])
    assert report['private_files_removed'] is True
    assert report['xai_verified'] is False and report['grok_web_verified'] is False
    assert report['android_voice_verified'] is False
    assert report['model_planning'] == report['model_summary'] == 'mock'
    assert report['mail_reads'] == 'synthetic-only'
    assert result.stderr == ''
    assert 'Bearer ' not in result.stdout and '합성 테스트 메일' not in result.stdout
