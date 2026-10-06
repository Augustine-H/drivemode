"""Paid keys stay in the Windows user's existing DPAPI store."""
import os
from credentials import _transform
from worker_auth import local_directory
NAMES = {'xai': 'XAI_API_KEY', 'openai': 'OPENAI_API_KEY', 'elevenlabs': 'ELEVENLABS_API_KEY'}

def load(provider):
    if provider not in NAMES:
        raise ValueError('PAID_PROVIDER_INVALID')
    value = os.environ.get(NAMES[provider])
    if not value:
        path = local_directory() / 'paid-lyrics' / (provider + '.dpapi')
        if not path.is_file():
            return None
        if path.stat().st_size > 16384:
            raise ValueError('PAID_CREDENTIAL_INVALID')
        value = _transform(path.read_bytes(), protect=False,
                           entropy=('VoiceGrok.PaidLyrics.' + provider + '.v1').encode()).decode('utf8')
    if not 20 <= len(value) <= 512 or not value.isascii() or any(c.isspace() for c in value):
        raise ValueError('PAID_CREDENTIAL_INVALID')
    return value

def available():
    providers = ['qwen']
    for provider in NAMES:
        try:
            if load(provider):
                providers.append(provider)
        except Exception:
            pass
    return providers
