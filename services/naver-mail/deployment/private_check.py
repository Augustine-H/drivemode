"""Offline NAS private-mount check. No IMAP, mail reads or credential output."""
import hashlib
import ipaddress
import json
import re
import stat
from pathlib import Path
from urllib.parse import urlsplit


def check(directory='/run/secrets'):
    root = Path(directory)
    checks = {}
    def require(condition, code):
        if not condition:
            raise ValueError(code)
    require(stat.S_ISDIR(root.lstat().st_mode) and stat.S_IMODE(root.stat().st_mode) in {0o700, 0o750}, 'private_directory_permissions')
    values = {}
    for name in ('config.json', 'imap.json', 'tokens.json', 'health-token'):
        path = root/name
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) in {0o400, 0o440}, 'private_file_permissions')
        require(info.st_size <= 16384, 'private_file_size')
        values[name] = path.read_text()
    checks['private_mount_readable_and_restricted'] = True
    config, credentials, registry = [json.loads(values[name]) for name in ('config.json', 'imap.json', 'tokens.json')]
    require(config.get('token_file') == '/run/secrets/tokens.json'
            and config.get('credentials_file', '/run/secrets/imap.json') == '/run/secrets/imap.json', 'private_mount_paths')
    require(not config.get('test_http') and config.get('web_auth_verified') is False, 'initial_security_gates')
    hosts, origins = config.get('allowed_hosts'), config.get('allowed_origins')
    require(isinstance(hosts, list) and '127.0.0.1:3001' in hosts, 'health_host_required')
    for host in hosts:
        require(isinstance(host, str) and '*' not in host, 'invalid_host_allowlist')
        url = urlsplit('https://'+host)
        require(bool(url.hostname) and url.username is None and not url.path and not url.query
                and not url.fragment and not any(c.isspace() for c in host), 'invalid_host_allowlist')
        _ = url.port
    require(isinstance(origins, list) and bool(origins), 'origin_allowlist_required')
    for origin in origins:
        url = urlsplit(origin)
        require(url.scheme == 'https' and bool(url.hostname) and url.username is None
                and url.path in {'', '/'} and not url.query and not url.fragment
                and '*' not in origin and not any(c.isspace() for c in origin), 'invalid_origin_allowlist')
    for cidr in config.get('trusted_proxies', []):
        require(ipaddress.ip_network(cidr).prefixlen > 0, 'unbounded_proxy_trust')
    require(type(config.get('requests_per_minute', 60)) is int
            and 1 <= config.get('requests_per_minute', 60) <= 120, 'invalid_rate_limit')
    checks['initial_https_host_origin_proxy_gates'] = True
    for name, maximum in [('username', 254), ('password', 256)]:
        value = credentials.get(name)
        require(isinstance(value, str) and 0 < len(value) <= maximum
                and all(ord(c) >= 32 for c in value), 'invalid_imap_configuration')
    checks['imap_configuration_format_only'] = True
    rows = registry.get('tokens')
    require(isinstance(rows, list) and 1 <= len(rows) <= 32, 'invalid_registry')
    ids, hashes, roles = set(), set(), set()
    enabled_voice = set()
    for row in rows:
        identifier, digest, role = row.get('id'), row.get('sha256'), row.get('client')
        require(isinstance(identifier, str) and bool(identifier) and identifier not in ids, 'duplicate_or_invalid_token_id')
        require(isinstance(digest, str) and re.fullmatch(r'[a-f0-9]{64}', digest)
                and digest not in hashes and role in {'voice', 'grok_web'}, 'invalid_or_shared_token_hash')
        require(type(row.get('enabled', True)) is bool, 'invalid_token_enabled')
        ids.add(identifier); hashes.add(digest)
        if row.get('enabled', True):
            roles.add(role)
            if role == 'voice':
                enabled_voice.add(digest)
    require(roles == {'voice', 'grok_web'}, 'separate_client_tokens_required')
    health = values['health-token'].strip()
    require(bool(re.fullmatch(r'[A-Za-z0-9_-]{32,256}', health))
            and hashlib.sha256(health.encode()).hexdigest() in enabled_voice, 'health_token_not_registered')
    checks['separate_roles_and_registered_health_token'] = True
    return {'status': 'passed', 'checks': checks, 'imap_authenticated': False,
            'nas_ports_checked': False, 'proxy_peer_verified': False, 'grok_web_verified': False}


def main():
    try:
        report = check()
    except Exception:
        print(json.dumps({'status': 'failed', 'error': 'private_mount_or_configuration_invalid',
                          'private_details_suppressed': True}))
        raise SystemExit(1) from None
    print(json.dumps(report))


if __name__ == '__main__':
    main()
