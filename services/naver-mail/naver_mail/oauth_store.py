"""Bounded encrypted OAuth state; never accepts mail content or IMAP secrets."""
import hashlib
import json
import os
import sqlite3
import stat
import time
from contextlib import contextmanager
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


class Store:
    LIMITS = {'client':32, 'pending':32, 'code':32, 'access':128,
              'refresh':128, 'spent':512, 'meta':8}

    def __init__(self, directory, key):
        root = Path(directory)
        info = root.lstat()
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid()
                or stat.S_IMODE(info.st_mode) != 0o700 or len(key) != 32):
            raise ValueError('invalid_oauth_state_directory')
        self.path = root/'oauth.db'
        self.cipher = AESGCM(key)
        fd = os.open(self.path,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
        try:
            info = os.fstat(fd)
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
                    or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1):
                raise ValueError('invalid_oauth_state_file')
        finally:
            os.close(fd)
        with self.transaction() as db:
            db.execute('CREATE TABLE IF NOT EXISTS state(kind TEXT, ident TEXT, payload BLOB, expires REAL, PRIMARY KEY(kind,ident))')

    @contextmanager
    def transaction(self):
        # No WAL sidecar/secret spill. A process-wide 077 umask protects journals
        # in runtime; SQLite also uses the database mode for its journal files.
        db = sqlite3.connect(self.path,timeout=5,isolation_level=None)
        try:
            db.execute('PRAGMA secure_delete=ON')
            db.execute('PRAGMA journal_mode=DELETE')
            db.execute('BEGIN IMMEDIATE')
            # First transaction precedes table creation.
            if db.execute("SELECT 1 FROM sqlite_master WHERE name='state'").fetchone():
                db.execute('DELETE FROM state WHERE expires <= ?', (time.time(),))
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def get(self, db, kind, ident):
        row = db.execute('SELECT payload FROM state WHERE kind=? AND ident=?',(kind,ident)).fetchone()
        if row is None:
            return None
        raw = row[0]
        return json.loads(self.cipher.decrypt(raw[:12],raw[12:],(kind+':'+ident).encode()))

    def put(self, db, kind, ident, value, expires):
        if kind not in self.LIMITS:
            raise ValueError('invalid_state_kind')
        existing = db.execute('SELECT 1 FROM state WHERE kind=? AND ident=?',(kind,ident)).fetchone()
        if not existing and self.count(db,kind) >= self.LIMITS[kind]:
            raise ValueError('oauth_state_limit')
        plain = json.dumps(value,separators=(',',':')).encode()
        if len(plain)>20000:
            raise ValueError('oauth_state_size')
        nonce = os.urandom(12)
        blob = nonce+self.cipher.encrypt(nonce,plain,(kind+':'+ident).encode())
        db.execute('INSERT OR REPLACE INTO state VALUES(?,?,?,?)',(kind,ident,blob,expires))

    def delete(self, db, kind, ident):
        db.execute('DELETE FROM state WHERE kind=? AND ident=?',(kind,ident))

    def count(self, db, kind):
        return db.execute('SELECT COUNT(*) FROM state WHERE kind=?',(kind,)).fetchone()[0]

    def family(self, db, family):
        for kind,ident in db.execute("SELECT kind,ident FROM state WHERE kind IN ('access','refresh')").fetchall():
            if self.get(db,kind,ident)['family']==family:
                self.delete(db,kind,ident)

    def revoke_all(self):
        with self.transaction() as db:
            db.execute("DELETE FROM state WHERE kind IN ('pending','code','access','refresh','spent')")
