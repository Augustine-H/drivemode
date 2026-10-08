"""Write tokens only to private files. Never print token values."""
import argparse
import hashlib
import json
import os
import secrets
from pathlib import Path


def write_private(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + '.new')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'w') as handle:
            handle.write(value)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def add_token(registry_path, token_path, client, identifier):
    registry_path, token_path = Path(registry_path), Path(token_path)
    if token_path.exists():
        raise ValueError('token_output_already_exists')
    rows = json.loads(registry_path.read_text()) if registry_path.exists() else {'tokens': []}
    if any(r['id'] == identifier for r in rows['tokens']) or len(rows['tokens']) >= 32:
        raise ValueError('duplicate_or_full_registry')
    value = secrets.token_urlsafe(48)
    # Add new token before revoking an old one to support overlap rotation.
    write_private(token_path, value + '\n')
    rows['tokens'].append({'id': identifier, 'client': client, 'sha256': hashlib.sha256(value.encode()).hexdigest(), 'enabled': True})
    write_private(registry_path, json.dumps(rows, indent=2) + '\n')


def revoke_token(registry_path, identifier):
    rows = json.loads(Path(registry_path).read_text())
    if not any(r['id'] == identifier for r in rows['tokens']):
        raise ValueError('unknown_token_id')
    for row in rows['tokens']:
        if row['id'] == identifier:
            row['enabled'] = False
    write_private(registry_path, json.dumps(rows, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['add', 'revoke'])
    parser.add_argument('--registry', required=True)
    parser.add_argument('--id', required=True)
    parser.add_argument('--client', choices=['voice', 'grok_web'])
    parser.add_argument('--output')
    args = parser.parse_args()
    try:
        if args.operation == 'add':
            if not args.client or not args.output:
                parser.error('add requires --client and --output')
            add_token(args.registry, args.output, args.client, args.id)
        else:
            revoke_token(args.registry, args.id)
    except Exception:
        raise SystemExit('Token operation failed; check private paths and token ID') from None
    print('Token registry updated; values were not printed.')


if __name__ == '__main__':
    main()
