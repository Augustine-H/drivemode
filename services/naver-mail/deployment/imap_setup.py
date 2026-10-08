"""Interactive NAS credential entry. No network calls or secret output."""
import getpass
import json
import os
import stat
import sys
import tempfile
import warnings
from pathlib import Path


def write_credentials(directory, username, password):
    root = Path(directory)
    info = root.lstat()
    if (not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o750
            or info.st_uid != 0 or info.st_gid != 10001
            or os.geteuid() != 0 or os.getegid() != 10001):
        raise ValueError('private_directory_or_management_identity_invalid')
    for value, maximum in [(username, 254), (password, 256)]:
        if not isinstance(value, str) or not 0 < len(value) <= maximum or any(ord(c) < 32 for c in value):
            raise ValueError('invalid_credential_format')
    destination = root / 'imap.json'
    if destination.exists() or destination.is_symlink():
        raise ValueError('existing_credentials_preserved')
    fd, temporary_name = tempfile.mkstemp(prefix='.imap-setup-', dir=root)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            os.fchmod(handle.fileno(), 0o440)
            if os.fstat(handle.fileno()).st_gid != 10001:
                raise ValueError('unexpected_private_file_group')
            json.dump({'username': username, 'password': password}, handle, ensure_ascii=False)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        # Atomic publication without replacing a concurrent writer or symlink.
        os.link(temporary, destination, follow_symlinks=False)
        directory_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    # Never allow getpass to fall back to echoing input in DSM scheduled jobs.
    if not sys.stdin.isatty() or not sys.stderr.isatty():
        print('INTERACTIVE_SSH_TERMINAL_REQUIRED=yes')
        raise SystemExit(1)
    try:
        warnings.simplefilter('error', getpass.GetPassWarning)
        with open('/dev/tty', 'r+') as terminal:
            if not terminal.isatty():
                raise ValueError('controlling_terminal_required')
        if os.geteuid() != 0 or os.getegid() != 10001:
            raise ValueError('management_identity_invalid')
        destination = Path('/private/imap.json')
        if destination.exists() or destination.is_symlink():
            raise ValueError('existing_credentials_preserved')
        username = getpass.getpass('Naver account ID (hidden): ')
        password = getpass.getpass('Naver application password (hidden): ')
        confirmation = getpass.getpass('Confirm application password (hidden): ')
        if password != confirmation:
            raise ValueError('password_confirmation_mismatch')
        write_credentials('/private', username, password)
    except (Exception, KeyboardInterrupt):
        print('IMAP_CONFIGURATION_WRITE=failed; details suppressed; existing credentials preserved')
        raise SystemExit(1) from None
    print('IMAP_CONFIGURATION_WRITE=passed')
    print('CREDENTIAL_VALUES_PRINTED=no')
    print('IMAP_AUTHENTICATION_TESTED=no')


if __name__ == '__main__':
    main()
