"""Health is authenticated, reveals no account or token, does not contact IMAP."""
import os
import urllib.request
from pathlib import Path

def main():
    try:
        token = Path(os.environ.get('NAVER_MAIL_HEALTH_TOKEN_FILE', '/run/secrets/health-token')).read_text().strip()
        request = urllib.request.Request('http://127.0.0.1:3001/health', headers={'Authorization': f'Bearer {token}'})
        with urllib.request.urlopen(request, timeout=5) as response:
            if response.status != 200:
                raise ValueError()
    except Exception:
        raise SystemExit(1) from None

if __name__ == '__main__':
    main()
