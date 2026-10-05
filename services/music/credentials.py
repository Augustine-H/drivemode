"""Windows user-bound DPAPI credential storage. Never log or print token values."""
from __future__ import annotations

import ctypes
from ctypes import wintypes
import os
from pathlib import Path

ENTROPY = b"VoiceGrok.Music.HuggingFace.v1"


class Blob(ctypes.Structure):
    _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_byte))]


def credential_path() -> Path | None:
    local = os.environ.get("LOCALAPPDATA")
    return Path(local) / "VoiceGrok" / "Music" / "huggingface.dpapi" if local else None


def _transform(data: bytes, *, protect: bool, entropy: bytes = ENTROPY) -> bytes:
    if os.name != "nt":
        raise RuntimeError("WINDOWS_CREDENTIAL_STORE_REQUIRED")
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    buffer = ctypes.create_string_buffer(data)
    entropy_buffer = ctypes.create_string_buffer(entropy)
    source = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte)))
    entropy = Blob(len(entropy), ctypes.cast(entropy_buffer, ctypes.POINTER(ctypes.c_byte)))
    output = Blob()
    function = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
    function.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.POINTER(Blob),
                         ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    function.restype = wintypes.BOOL
    try:
        if not function(ctypes.byref(source), None, ctypes.byref(entropy), None, None,
                        1, ctypes.byref(output)):
            raise RuntimeError("CREDENTIAL_ENCRYPTION_FAILED" if protect else "CREDENTIAL_DECRYPTION_FAILED")
        return ctypes.string_at(output.data, output.size)
    finally:
        ctypes.memset(buffer, 0, len(data))
        if output.data:
            ctypes.memset(output.data, 0, output.size)
            kernel32.LocalFree(output.data)


def configure_huggingface() -> bool:
    """Explicit process credentials take precedence over our encrypted local store."""
    if os.environ.get("HF_TOKEN"):
        return True
    path = credential_path()
    if os.name != "nt" or path is None or not path.is_file():
        return False
    if path.stat().st_size > 16384:
        raise RuntimeError("INVALID_CREDENTIAL_FILE")
    token = _transform(path.read_bytes(), protect=False).decode("utf-8")
    if not token.startswith("hf_") or len(token) > 1024 or any(c.isspace() for c in token):
        raise RuntimeError("INVALID_HUGGINGFACE_CREDENTIAL")
    # HF libraries read this process-local value; no global env or plaintext cache writes.
    os.environ["HF_TOKEN"] = token
    return True
