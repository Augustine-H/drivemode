"""Validate local SVC output and reconstruct a listening comparison without stretching."""
import argparse
from pathlib import Path
import json

import numpy as np
import soundfile as sf
import torch
import torchaudio
from provider import atomic_json, encode_mp3, verify_audio_file


def aligned_audio(path: Path, rate: int, frames: int):
    pcm, source_rate = sf.read(path, dtype='float32', always_2d=True)
    if len(pcm) == 0 or pcm.shape[1] not in (1, 2) or not np.isfinite(pcm).all():
        raise ValueError('INVALID_CONVERSION_AUDIO')
    if np.sqrt(np.mean(pcm.astype('float64') ** 2)) < 1e-6:
        raise ValueError('SILENT_CONVERSION_AUDIO')
    pcm = torchaudio.functional.resample(torch.from_numpy(pcm.T.copy()), source_rate, rate).T.numpy()
    delta = len(pcm) - frames
    # Vocoder hop rounding can leave a few milliseconds; reject material duration changes.
    if abs(delta) > round(rate * .05):
        raise ValueError('CONVERSION_DURATION_MISMATCH')
    if delta < 0:
        pcm = np.pad(pcm, ((0, -delta), (0, 0)))
    elif delta > 0:
        pcm = pcm[:frames]
    if pcm.shape[1] == 1:
        pcm = np.repeat(pcm, 2, axis=1)
    return pcm, {'sourceRate': source_rate, 'alignmentDeltaFrames': delta,
                 'alignmentDeltaSeconds': round(delta / rate, 6), 'timeStretch': False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--baseline', required=True, type=Path)
    parser.add_argument('--conversion', required=True, type=Path)
    args = parser.parse_args()
    torch.set_num_threads(4)
    original = args.baseline / 'original.wav'
    validated = verify_audio_file(original)
    mixture, rate = sf.read(original, dtype='float32', always_2d=True)
    source, source_info = aligned_audio(args.baseline / 'vocals.wav', rate, len(mixture))
    files = list(args.conversion.glob('vc_*.wav'))
    if len(files) != 1:
        raise ValueError('EXPECTED_ONE_CONVERTED_VOCAL')
    converted, converted_info = aligned_audio(files[0], rate, len(mixture))
    # Preserve the baseline residual accompaniment; do not regenerate lyrics or melody.
    remix = mixture - source + converted
    peak = float(np.max(np.abs(remix)))
    gain = min(1.0, .98 / max(peak, 1e-6))
    wav = args.conversion / 'song.wav'
    sf.write(wav, remix * gain, rate, subtype='PCM_24')
    result = {'baseline': str(original.resolve()), 'convertedVocal': str(files[0].resolve()),
              'sourceAlignment': source_info, 'conversionAlignment': converted_info,
              'globalGain': gain, 'wav': verify_audio_file(wav),
              'mp3': encode_mp3(wav, args.conversion / 'song.mp3'),
              'qualityVerified': False, 'limitation': 'Demucs residual may contain original vocal bleed.'}
    atomic_json(args.conversion / 'remix.json', result)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
