"""Production Voice Grok backend with synthetic xAI and real HTTPS MCP transport."""
import json
import logging
import os
import socket
import subprocess
import sys
import tempfile
from pathlib import Path

from naver_mail.manage_tokens import revoke_token
from .https_canary import prepare
from .self_check import running


def node_flow(directory, url, revoked=False):
    service = Path(__file__).resolve().parents[1]
    environment = {**os.environ, 'NAVER_TEST_PRIVATE': str(directory),
                   'NAVER_TEST_URL': url, 'NAVER_TEST_PYTHON': sys.executable,
                   'NAVER_TEST_REVOKED': 'true' if revoked else 'false'}
    result = subprocess.run(['node', '--experimental-strip-types', str(service/'integration/voice_flow.mjs')],
                            cwd=service, env=environment, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        raise RuntimeError('voice_flow_failed')
    report = json.loads(result.stdout)
    if report.get('status') != 'passed':
        raise RuntimeError('voice_flow_report_failed')
    return report


def run():
    with tempfile.TemporaryDirectory(prefix='naver-voice-check-') as temporary:
        with socket.socket() as selection:
            selection.bind(('127.0.0.1', 0)); port = selection.getsockname()[1]
        directory = prepare(Path(temporary)/'private', port)
        url = f'https://127.0.0.1:{port}/mcp'
        with running(directory, port):
            report = node_flow(directory, url)
            revoke_token(directory/'tokens.json', 'voice-v1')
            revoked = node_flow(directory, url, revoked=True)
        return {**report, 'checks': {**report['checks'], **revoked['checks']},
                'sdk_call_attempts': report['sdk_call_attempts'] + revoked['sdk_call_attempts'],
                'mail_reads': 'synthetic-only', 'private_files_removed': True,
                'android_voice_verified': False}


def main():
    logging.disable(logging.CRITICAL)
    try:
        report = run()
    except Exception:
        raise SystemExit('Synthetic Voice Grok check failed; private diagnostics suppressed.') from None
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
