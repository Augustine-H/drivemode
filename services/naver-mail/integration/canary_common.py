"""Public, standard-library-only validation shared with root setup tooling."""
import hashlib
from urllib.parse import urlsplit


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def origin(url):
    parsed = urlsplit(url)
    if (parsed.scheme!='https' or not parsed.hostname or parsed.username is not None
            or parsed.password is not None or parsed.fragment
            or any(c.isspace() for c in url)):
        raise ValueError('invalid_https_url')
    return f'https://{parsed.hostname}' + (f':{parsed.port}' if parsed.port not in {None,443} else '')
