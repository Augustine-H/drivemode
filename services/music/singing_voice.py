"""Local immutable reference profiles for experimental Persona Singing Voice v1."""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / '.music-runtime' / 'persona-singing-v1' / 'profiles'
VOICE_ID = re.compile(r'^[a-z][a-z0-9_-]{0,39}$')


def profile(voice, root=ROOT):
    if not isinstance(voice, str) or not VOICE_ID.fullmatch(voice):
        raise ValueError('SINGING_VOICE_ID_INVALID')
    folder = root / voice
    manifest, reference = folder / 'profile.json', folder / 'reference.wav'
    if folder.is_symlink() or manifest.is_symlink() or reference.is_symlink():
        raise ValueError('SINGING_VOICE_SYMLINK_REJECTED')
    if not manifest.is_file() or not reference.is_file():
        raise ValueError('SINGING_VOICE_NOT_PREPARED')
    if manifest.stat().st_size > 4096 or reference.stat().st_size > 30 * 48000 * 4 + 4096:
        raise ValueError('SINGING_VOICE_FILE_TOO_LARGE')
    data = json.loads(manifest.read_text(encoding='utf-8'))
    digest = hashlib.sha256(reference.read_bytes()).hexdigest()
    if data.get('version') != 1 or data.get('voiceId') != voice or data.get('sha256') != digest:
        raise ValueError('SINGING_VOICE_REFERENCE_CHANGED')
    return reference, data


def register(voice, source, *, provenance, root=ROOT):
    """Explicit local setup only; never download or synthesize a voice implicitly."""
    import numpy as np
    import soundfile as sf
    import torch
    import torchaudio
    from provider import atomic_json
    if not VOICE_ID.fullmatch(voice):
        raise ValueError('SINGING_VOICE_ID_INVALID')
    folder = root / voice
    if folder.exists():
        raise ValueError('SINGING_VOICE_ALREADY_REGISTERED')
    source = Path(source)
    if source.stat().st_size > 32 * 2**20:
        raise ValueError('SINGING_VOICE_SOURCE_TOO_LARGE')
    with sf.SoundFile(source) as f:
        if not 5 <= len(f) / f.samplerate <= 30 or f.channels not in (1, 2):
            raise ValueError('SINGING_VOICE_REQUIRES_5_TO_30_SECONDS')
        audio, sr = f.read(dtype='float32', always_2d=True), f.samplerate
    if not np.isfinite(audio).all() or np.sqrt(np.mean(audio ** 2)) < .001:
        raise ValueError('SINGING_VOICE_SILENT_OR_INVALID')
    pcm = torchaudio.functional.resample(torch.from_numpy(audio.T.copy()), sr, 48000)
    if pcm.shape[0] == 1:
        pcm = pcm.repeat(2, 1)
    folder.mkdir(parents=True, exist_ok=False)
    reference = folder / 'reference.wav'
    try:
        sf.write(reference, pcm.T.numpy(), 48000, subtype='PCM_16')
        data = {'version': 1, 'voiceId': voice, 'sha256': hashlib.sha256(reference.read_bytes()).hexdigest(),
                'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                'source': str(provenance)[:1000], 'sampleRate': 48000, 'channels': 2,
                'seconds': pcm.shape[-1] / 48000, 'method': 'ace_step_reference_timbre',
                'qualityVerified': False}
        atomic_json(folder / 'profile.json', data)
    except BaseException:
        reference.unlink(missing_ok=True)
        folder.rmdir()
        raise
    return data


def load_reference(voice):
    import numpy as np
    import soundfile as sf
    import torch
    reference, data = profile(voice)
    audio, sr = sf.read(reference, dtype='float32', always_2d=True)
    if sr != 48000 or audio.shape[1] != 2 or not 5 <= len(audio) / sr <= 30 or not np.isfinite(audio).all():
        raise ValueError('SINGING_VOICE_WAV_INVALID')
    if np.sqrt(np.mean(audio ** 2)) < .001:
        raise ValueError('SINGING_VOICE_SILENT_OR_INVALID')
    return torch.from_numpy(audio.T.copy()), data


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('voice')
    parser.add_argument('source', type=Path)
    parser.add_argument('--provenance', required=True)
    args = parser.parse_args()
    print(json.dumps(register(args.voice, args.source, provenance=args.provenance), ensure_ascii=False))
