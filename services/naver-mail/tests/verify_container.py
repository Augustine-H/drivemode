"""Isolated synthetic Docker smoke/restart test; no published ports or network."""
import argparse
import hashlib
import json
import secrets
import subprocess
import tempfile
import time
from pathlib import Path


def command(*args):
    result = subprocess.run(['docker', *args], capture_output=True, text=True, timeout=30)
    if result.returncode:
        # Docker errors may include private paths: never echo configuration.
        raise RuntimeError('Docker verification command failed: ' + args[0])
    return (result.stdout + (result.stderr if args[0] == 'logs' else '')).strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--image', default='voice-grok-naver-mail:test')
    image = parser.parse_args().image
    name = 'naver-mail-fixture-' + secrets.token_hex(4)
    with tempfile.TemporaryDirectory(prefix='naver-container-', dir='/workspace/.onboarding') as temporary:
        root = Path(temporary)
        # World-readable only for these randomly generated synthetic fixtures;
        # production secrets must instead use owner/group 10001 and mode 0440.
        root.chmod(0o755)
        token = secrets.token_urlsafe(48)
        data = {'config.json': json.dumps({'allowed_hosts': ['127.0.0.1:3001'], 'allowed_origins': ['https://grok.com'], 'token_file': '/run/secrets/tokens.json'}),
                'imap.json': json.dumps({'username': 'synthetic-not-a-naver-account', 'password': 'synthetic-not-an-app-password'}),
                'tokens.json': json.dumps({'tokens': [{'id': 'fixture', 'client': 'voice', 'sha256': hashlib.sha256(token.encode()).hexdigest()}]}), 'health-token': token}
        for filename, value in data.items():
            path = root/filename;path.write_text(value);path.chmod(0o444)
        try:
            command('run', '-d', '--name', name, '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--memory=384m', '--pids-limit=64', '--tmpfs=/tmp:size=16m', '--mount', f'type=bind,src={root},dst=/run/secrets,readonly', image)
            def health():
                deadline = time.monotonic()+15
                while time.monotonic() < deadline:
                    result = subprocess.run(['docker', 'exec', name, 'python', '-m', 'naver_mail.health'], capture_output=True, timeout=10)
                    if result.returncode == 0:
                        return
                    time.sleep(0.3)
                # The production entrypoint emits only fixed startup errors;
                # these synthetic runs never issue an IMAP/tool operation.
                detail = command('logs', name)[-1000:]
                raise RuntimeError('Container authenticated health failed: ' + detail)
            health()
            command('exec', name, 'python', '-c', "import urllib.request,urllib.error;\ntry: urllib.request.urlopen('http://127.0.0.1:3001/health',timeout=3); raise SystemExit(1)\nexcept urllib.error.HTTPError as e: assert e.code==401")
            info = json.loads(command('inspect', name))[0]
            assert info['Config']['User'] == '10001:10001'
            assert info['HostConfig']['ReadonlyRootfs'] and not info['HostConfig']['Privileged']
            command('restart', name)
            health()
            print(json.dumps({'container_start': 'passed', 'authenticated_health': 'passed', 'unauthenticated_health_401': 'passed', 'restart': 'passed', 'non_root_readonly': 'passed', 'real_imap_or_external_connection': 'not_run'}, indent=2))
        finally:
            subprocess.run(['docker', 'rm', '-f', name], capture_output=True, timeout=30)


if __name__ == '__main__':
    main()
