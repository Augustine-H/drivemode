"""Private authenticated loopback liveness; no mail read or secret output."""
from pathlib import Path
import urllib.request


def main():
    try:
        token=Path('/oauth-private/health-token').read_text().strip()
        req=urllib.request.Request('http://127.0.0.1:3001/health',headers={'Authorization':'Bearer '+token})
        with urllib.request.urlopen(req,timeout=5) as response:
            if response.status!=200:raise ValueError()
    except Exception:
        raise SystemExit(1) from None


if __name__=='__main__':main()
