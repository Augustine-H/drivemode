"""Separate user-bound API credential; never expose the Hugging Face token."""
import os
from pathlib import Path
import secrets

from credentials import _transform
from filelock import FileLock


def local_directory() -> Path:
    if os.name != "nt" or not os.environ.get("LOCALAPPDATA"):
        raise RuntimeError("WINDOWS_LOCAL_PROFILE_REQUIRED")
    return Path(os.environ["LOCALAPPDATA"]) / "VoiceGrok" / "Music"


def worker_token(*, create: bool = False) -> str:
    directory = local_directory()
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / "worker-api.dpapi"
    with FileLock(str(directory / "worker-credential.lock"), timeout=5):
        if not path.exists():
            if not create:
                raise RuntimeError("WORKER_CREDENTIAL_NOT_INITIALIZED")
            token = secrets.token_urlsafe(48)
            temporary = path.with_suffix(".tmp")
            temporary.write_bytes(_transform(token.encode("ascii"), protect=True, entropy=b"VoiceGrok.Music.Worker.v1"))
            temporary.replace(path)
        if path.stat().st_size > 16384:
            raise RuntimeError("INVALID_WORKER_CREDENTIAL")
        token = _transform(path.read_bytes(), protect=False, entropy=b"VoiceGrok.Music.Worker.v1").decode("ascii")
        if len(token) != 64 or any(c not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_" for c in token):
            raise RuntimeError("INVALID_WORKER_CREDENTIAL")
        return token
