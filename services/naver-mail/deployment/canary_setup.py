"""Interactive synthetic-canary owner setup. No real account credentials."""
import argparse
import getpass
import hashlib
import json
import os
import secrets
import stat
import sys
import warnings
from pathlib import Path


def prepare(root, issuer, proxy, phrase):
    from integration.canary_common import origin
    import ipaddress
    root = Path(root)
    if (os.geteuid()!=0 or os.getegid()!=10001 or root.is_symlink()
            or not root.is_dir() or root.stat().st_uid!=0
            or stat.S_IMODE(root.stat().st_mode)!=0o750):
        raise ValueError('management_directory_invalid')
    private = root/'private'
    if private.exists() or private.is_symlink():
        raise ValueError('existing_canary_private_preserved')
    if not 16 <= len(phrase) <= 256 or any(ord(c)<32 for c in phrase):
        raise ValueError('invalid_owner_phrase')
    address = ipaddress.ip_address(proxy)
    if not address.is_private or address.is_unspecified:
        raise ValueError('single_private_proxy_required')
    salt = secrets.token_bytes(16)
    owner = {'salt':salt.hex(),'hash':hashlib.scrypt(phrase.encode(),salt=salt,n=16384,r=8,p=1).hex()}
    if issuer!=origin(issuer):
        raise ValueError('issuer_must_be_an_origin')
    values = {'owner.json':json.dumps(owner)+'\n',
              'health-token':secrets.token_urlsafe(48)+'\n',
              'config.json':json.dumps({'mode':'synthetic-oauth-canary','issuer':issuer,
                      'redirect_origins':['https://grok.com'],'trusted_proxy':str(address)},indent=2)+'\n'}
    private.mkdir(mode=0o750)
    private.chmod(0o750)
    for name,value in values.items():
        fd = os.open(private/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o440)
        with os.fdopen(fd,'w') as handle:
            if os.fstat(handle.fileno()).st_gid!=10001:
                raise ValueError('unexpected_file_group')
            os.fchmod(handle.fileno(),0o440)
            handle.write(value)
            handle.flush()
            os.fsync(handle.fileno())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--issuer',required=True)
    parser.add_argument('--proxy',required=True)
    args = parser.parse_args()
    if not sys.stdin.isatty() or not sys.stderr.isatty():
        raise SystemExit('INTERACTIVE_SSH_TERMINAL_REQUIRED=yes')
    try:
        warnings.simplefilter('error',getpass.GetPassWarning)
        with open('/dev/tty','rb',buffering=0) as tty:
            if not tty.isatty(): raise ValueError()
        if (Path('/project/private').exists() or Path('/project/private').is_symlink()
                or os.geteuid()!=0 or os.getegid()!=10001):
            raise ValueError('existing_private_or_wrong_identity')
        phrase = getpass.getpass('New CANARY-only approval passphrase (16+ characters, hidden): ')
        confirmation = getpass.getpass('Confirm CANARY-only passphrase (hidden): ')
        if phrase!=confirmation:
            raise ValueError('confirmation_mismatch')
        prepare('/project',args.issuer,args.proxy,phrase)
    except (Exception,KeyboardInterrupt):
        raise SystemExit('CANARY_OWNER_SETUP=failed; details suppressed') from None
    print('CANARY_OWNER_SETUP=passed')
    print('CREDENTIAL_VALUES_PRINTED=no')
    print('REAL_MAIL_ACCOUNT_CONNECTED=no')


if __name__=='__main__':
    main()
