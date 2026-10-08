"""Authenticated loopback health only; never accesses IMAP or token endpoints."""
import urllib.request
from pathlib import Path


def main():
    try:
        token = Path('/canary-private/health-token').read_text().strip()
        request = urllib.request.Request('http://127.0.0.1:3001/health',
                                         headers={'Authorization':'Bearer '+token})
        with urllib.request.urlopen(request,timeout=5) as response:
            if response.status != 200:
                raise ValueError()
    except Exception:
        raise SystemExit(1) from None


if __name__=='__main__':
    main()
