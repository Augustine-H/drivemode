"""Executable integration harness and safe probe boundaries."""
import asyncio
import json
import subprocess
import sys
from pathlib import Path

import pytest
from integration.probe import endpoint, probe
from integration.https_canary import prepare


@pytest.mark.parametrize('url', [
    'http://127.0.0.1:3443/mcp', 'https://user:secret@example.test/mcp',
    'https://example.test/mcp?token=secret', 'https://example.test/mcp#secret',
    'https://example.test/health', 'https://example.test:99999/mcp',
    'https://example.test/\nmcp',
    'https://@example.test/mcp',
])
def test_probe_rejects_unsafe_urls(url):
    with pytest.raises(ValueError):
        endpoint(url)


def test_canary_probe_cannot_call_remote_mailbox(tmp_path):
    # Rejected before token reads, TLS setup or any outbound connection.
    with pytest.raises(ValueError, match='canary_calls_require_loopback'):
        asyncio.run(probe('https://real-mail.example.test/mcp', tmp_path/'absent', canary=True))


def test_canary_private_files_and_no_overwrite(tmp_path):
    directory = prepare(tmp_path/'private')
    original = (directory/'voice.token').read_text()
    assert directory.stat().st_mode & 0o777 == 0o700
    assert all(path.stat().st_mode & 0o777 == 0o600 for path in directory.iterdir())
    assert not (directory/'imap.json').exists()
    assert original.strip() not in (directory/'tokens.json').read_text()
    with pytest.raises(FileExistsError):
        prepare(directory)
    assert (directory/'voice.token').read_text() == original


def test_https_harness_in_fresh_process():
    result = subprocess.run([sys.executable, '-m', 'integration.self_check'],
        cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True, timeout=45)
    assert result.returncode == 0, 'Account-free HTTPS harness failed (private diagnostics suppressed)'
    report = json.loads(result.stdout)
    assert report['status'] == 'passed'
    assert report['checks']['protocol'] == '2025-11-25'
    assert report['checks']['readonly_tools'] == 7
    assert all(value is True for key, value in report['checks'].items() if key not in {'protocol', 'readonly_tools'})
    assert report['private_files_removed'] is True
    assert report['grok_web_verified'] is False and report['xai_verified'] is False
    assert result.stderr == ''
    assert '합성 테스트 메일' not in result.stdout and 'Bearer ' not in result.stdout
