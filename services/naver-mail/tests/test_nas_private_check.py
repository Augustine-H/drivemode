import hashlib
import json
import pytest
from deployment.private_check import check


@pytest.fixture
def private(tmp_path):
    root = tmp_path/'private';root.mkdir(mode=0o750)
    health = 'synthetic-health-token-'+'x'*40
    rows = [{'id': 'health-v1', 'client': 'voice', 'sha256': hashlib.sha256(health.encode()).hexdigest()},
            {'id': 'web-v1', 'client': 'grok_web', 'sha256': hashlib.sha256(b'synthetic-web-token').hexdigest()}]
    values = {'config.json': {'token_file': '/run/secrets/tokens.json', 'allowed_hosts': ['127.0.0.1:3001'],
                'allowed_origins': ['https://grok.com'], 'web_auth_verified': False},
              'imap.json': {'username': 'fixture', 'password': 'synthetic-not-naver'},
              'tokens.json': {'tokens': rows}}
    for name, value in values.items():
        (root/name).write_text(json.dumps(value));(root/name).chmod(0o440)
    (root/'health-token').write_text(health);(root/'health-token').chmod(0o440)
    return root


def test_private_check_is_offline_and_never_returns_values(private):
    report = check(private)
    assert report['status'] == 'passed' and all(report['checks'].values())
    assert report['imap_authenticated'] is False and report['proxy_peer_verified'] is False
    output = json.dumps(report)
    assert 'synthetic' not in output and 'sha256' not in output


def test_private_check_rejects_world_readable_secrets(private):
    (private/'imap.json').chmod(0o444)
    with pytest.raises(ValueError, match='private_file_permissions'):
        check(private)


@pytest.mark.parametrize('change', ['web_gate', 'proxy', 'health', 'shared_token'])
def test_private_check_rejects_unsafe_configuration(private, change):
    name = 'tokens.json' if change == 'shared_token' else 'config.json'
    path = private/name
    data = json.loads(path.read_text())
    if change == 'web_gate': data['web_auth_verified'] = True
    if change == 'proxy': data['trusted_proxies'] = ['0.0.0.0/0']
    if change == 'health': data['allowed_hosts'] = ['mail.example.test']
    if change == 'shared_token': data['tokens'][1]['sha256'] = data['tokens'][0]['sha256']
    path.chmod(0o600);path.write_text(json.dumps(data));path.chmod(0o440)
    with pytest.raises(ValueError):
        check(private)
