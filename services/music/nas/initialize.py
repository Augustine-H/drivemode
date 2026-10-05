"""One-time NAS/Linux deployment initialization; never prints or replaces secrets."""
import os
from pathlib import Path
import re
import secrets


def main():
    if os.name != "posix" or os.geteuid() != 0:
        raise RuntimeError("RUN_ON_NAS_AS_ROOT_FOR_SERVICE_FILE_OWNERSHIP")
    root = Path(__file__).resolve().parent
    secret_dir = root / "secrets"
    data_dir = root / "data"
    for path in (secret_dir, data_dir):
        if path.is_symlink() or path.resolve().parent != root:
            raise RuntimeError("UNEXPECTED_DEPLOYMENT_PATH")
        path.mkdir(mode=0o700, exist_ok=True)
        os.chown(path, 10001, 10001)
        os.chmod(path, 0o700)
    for name in ("client_token", "bridge_token"):
        path = secret_dir / name
        if path.is_symlink():
            raise RuntimeError("UNEXPECTED_SECRET_PATH")
        if path.exists():
            if not re.fullmatch(r"[A-Za-z0-9_-]{64}", path.read_text().strip()):
                raise RuntimeError("EXISTING_SECRET_INVALID_NOT_REPLACED")
        else:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o400)
            with os.fdopen(descriptor, "w") as stream:
                stream.write(secrets.token_urlsafe(48))
                stream.flush()
                os.fsync(stream.fileno())
        os.chown(path, 10001, 10001)
        os.chmod(path, 0o400)
    print("NAS data directory and two separate service secrets initialized; no secret values displayed.")


if __name__ == "__main__":
    main()
