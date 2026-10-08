"""Fresh root/TTY setup, standard library only; no network or existing secrets."""
import argparse
import getpass
import hashlib
import ipaddress
import json
import os
import secrets
import stat
import sys
import warnings
from pathlib import Path
from urllib.parse import urlsplit


def prepare(root,issuer,proxy,phrase):
    root=Path(root)
    info=root.lstat()
    if (os.geteuid()!=0 or os.getegid()!=10001 or not stat.S_ISDIR(info.st_mode)
            or info.st_uid!=0 or stat.S_IMODE(info.st_mode)!=0o750):
        raise ValueError('management_identity_invalid')
    private=root/'private'
    if private.exists() or private.is_symlink():raise ValueError('existing_private_preserved')
    state=(root/'state').lstat()
    if not stat.S_ISDIR(state.st_mode) or state.st_uid!=10001 or stat.S_IMODE(state.st_mode)!=0o700:
        raise ValueError('state_identity_invalid')
    url=urlsplit(issuer)
    if (url.scheme!='https' or not url.hostname or url.username or url.password or url.path
            or url.query or url.fragment or any(c.isspace() for c in issuer)):
        raise ValueError('issuer_origin_required')
    address=ipaddress.ip_address(proxy)
    if not address.is_private or address.is_unspecified:raise ValueError('private_proxy_required')
    if not 16<=len(phrase)<=256 or any(ord(c)<32 for c in phrase):raise ValueError('owner_phrase_invalid')
    salt=secrets.token_bytes(16)
    voice=secrets.token_urlsafe(48)
    data={'config.json':json.dumps({'mode':'validation','issuer':issuer,'trusted_proxy':str(address)}),
        'owner.json':json.dumps({'salt':salt.hex(),'hash':hashlib.scrypt(phrase.encode(),salt=salt,n=16384,r=8,p=1).hex()}),
        'state-key':secrets.token_bytes(32).hex(),'health-token':secrets.token_urlsafe(48),
        'validation-tokens.json':json.dumps({'tokens':[{'client':'voice','sha256':hashlib.sha256(voice.encode()).hexdigest()}]}),
        'voice-validation-token':voice}
    private.mkdir(mode=0o750);private.chmod(0o750)
    for name,value in data.items():
        fd=os.open(private/name,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o440)
        with os.fdopen(fd,'w') as handle:
            if os.fstat(handle.fileno()).st_gid!=10001:raise ValueError('unexpected_group')
            os.fchmod(handle.fileno(),0o440);handle.write(value+'\n');handle.flush();os.fsync(handle.fileno())


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--issuer',required=True);parser.add_argument('--proxy',required=True)
    args=parser.parse_args()
    if not sys.stdin.isatty() or not sys.stderr.isatty():raise SystemExit('INTERACTIVE_SSH_TERMINAL_REQUIRED=yes')
    try:
        warnings.simplefilter('error',getpass.GetPassWarning)
        with open('/dev/tty','rb',buffering=0) as tty:
            if not tty.isatty():raise ValueError()
        phrase=getpass.getpass('New MAIL access approval passphrase (16+ characters, hidden): ')
        confirmation=getpass.getpass('Confirm MAIL approval passphrase (hidden): ')
        if phrase!=confirmation:raise ValueError()
        prepare('/project',args.issuer,args.proxy,phrase)
    except (Exception,KeyboardInterrupt):
        raise SystemExit('OAUTH_OWNER_SETUP=failed; values suppressed') from None
    print('OAUTH_OWNER_SETUP=passed; MODE=validation; REAL_MAIL_CONNECTED=no; SECRET_VALUES_PRINTED=no')


if __name__=='__main__':main()
