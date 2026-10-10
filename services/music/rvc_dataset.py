"""Local-only RVC data audit: no synthetic padding, duplication or automatic training."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

import numpy as np
import soundfile as sf
from provider import atomic_json
from singing_voice import VOICE_ID


def audit(folder: Path, voice: str):
    if not VOICE_ID.fullmatch(voice) or not folder.is_dir():
        raise ValueError('INVALID_RVC_DATASET')
    import imageio_ffmpeg
    root = folder.resolve()
    rows, errors, seen = [], [], set()
    total, voiced = 0., 0.
    extensions = {'.wav', '.flac', '.mp3', '.m4a', '.ogg', '.aac', '.webm'}
    for path in sorted(root.rglob('*')):
        if path.suffix.lower() not in extensions or not path.is_file():
            continue
        if path.is_symlink() or not path.resolve().is_relative_to(root) or path.stat().st_size > 256 * 2**20:
            errors.append({'file': str(path), 'error': 'UNSAFE_OR_OVERSIZED_INPUT'})
            continue
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest in seen:
            rows.append({'file': str(path), 'sha256': digest, 'duplicate': True})
            continue
        seen.add(digest)
        try:
            with tempfile.TemporaryDirectory() as temporary:
                wav = Path(temporary) / 'decoded.wav'
                result = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-nostdin', '-v', 'error',
                    '-i', str(path), '-t', '3600', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_f32le', str(wav)],
                    capture_output=True, timeout=180)
                if result.returncode:
                    raise ValueError('AUDIO_DECODE_FAILED')
                pcm, rate = sf.read(wav, dtype='float32')
            if not len(pcm) or not np.isfinite(pcm).all():
                raise ValueError('EMPTY_OR_NONFINITE_AUDIO')
            seconds = len(pcm) / rate
            # Energy is a coarse audit, not a speech detector or quality approval.
            blocks = [pcm[a:a+rate//10] for a in range(0, len(pcm), rate//10)]
            audible = sum(len(b)/rate for b in blocks if np.sqrt(np.mean(b.astype('float64')**2)) > .005)
            total += seconds
            voiced += audible
            rows.append({'file': str(path), 'sha256': digest, 'seconds': seconds,
                         'audibleSeconds': round(audible, 3), 'duplicate': False,
                         'clippedFraction': float(np.mean(np.abs(pcm) >= .999))})
        except (ValueError, OSError, subprocess.TimeoutExpired) as error:
            errors.append({'file': str(path), 'error': str(error)})
    return {'voiceId': voice, 'folder': str(root), 'totalUniqueSeconds': round(total, 3),
            'audibleUniqueSeconds': round(voiced, 3), 'minimumRecommendedSeconds': 600,
            'quantityReady': voiced >= 600 and not errors, 'trainingStarted': False,
            'qualityVerified': False, 'apiCostUsd': 0, 'files': rows, 'errors': errors,
            'limitations': 'Energy does not prove clean speech, consistent speaker, pronunciation or rights. Byte-identical duplicates excluded; recoded duplicates require listening. Files over one hour are capped and require manual review.'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--folder', type=Path, required=True)
    parser.add_argument('--voice', required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    report = audit(args.folder, args.voice)
    atomic_json(args.report, report)
    print(json.dumps({key: report[key] for key in ('voiceId', 'totalUniqueSeconds', 'audibleUniqueSeconds', 'quantityReady', 'trainingStarted')}))


if __name__ == '__main__':
    main()
