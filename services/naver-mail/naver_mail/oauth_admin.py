"""Local grant revocation. Mount state/key privately; no token arguments/output."""
import argparse
from pathlib import Path
from .oauth_store import Store


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['revoke-all'])
    parser.add_argument('--state',default='/oauth-state')
    parser.add_argument('--key-file',default='/oauth-private/state-key')
    args=parser.parse_args()
    try:
        Store(args.state,bytes.fromhex(Path(args.key_file).read_text().strip())).revoke_all()
    except Exception:
        raise SystemExit('OAUTH_REVOCATION=failed; values suppressed') from None
    print('OAUTH_REVOCATION=passed; token_values_printed=no')


if __name__=='__main__':main()
