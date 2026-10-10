"""Bounded diagnostic: replace a converted phrase with another converted phrase."""
import argparse
from pathlib import Path
import numpy as np
import soundfile as sf
from provider import atomic_json, file_hash


def stitch_tail(original, replacement, rate, crop_start, replace_start, fade_seconds=.2):
    original, replacement = np.asarray(original), np.asarray(replacement)
    if (original.ndim != 1 or replacement.ndim != 1 or rate <= 0
            or not np.isfinite(original).all() or not np.isfinite(replacement).all()):
        raise ValueError('INVALID_TAIL_AUDIO')
    crop, start, fade = (round(value * rate) for value in (crop_start, replace_start, fade_seconds))
    if not 0 <= crop <= start or fade < 2 or start + fade > len(original):
        raise ValueError('INVALID_TAIL_BOUNDARIES')
    expected = len(original) - crop
    delta = len(replacement) - expected
    if abs(delta) > round(rate * .05):
        raise ValueError('TAIL_DURATION_MISMATCH')
    aligned = np.pad(replacement, (0, max(0, -delta)))[:expected]
    offset = start - crop
    weight = np.linspace(0., 1., fade)
    result = original.copy()
    result[start:start + fade] = original[start:start + fade] * (1 - weight) + aligned[offset:offset + fade] * weight
    result[start + fade:] = aligned[offset + fade:]
    return result, {'cropStartFrame': crop, 'replaceStartFrame': start,
                    'fadeFrames': fade, 'alignmentDeltaFrames': delta,
                    'prefixSamplesUnchanged': bool(np.array_equal(result[:start], original[:start])),
                    'timeStretch': False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--original', required=True, type=Path)
    parser.add_argument('--replacement', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--crop-start', type=float, default=14.)
    parser.add_argument('--replace-start', type=float, default=22.)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError('TAIL_OUTPUT_EXISTS')
    original, rate = sf.read(args.original, dtype='float32')
    replacement, other_rate = sf.read(args.replacement, dtype='float32')
    if rate != other_rate:
        raise ValueError('TAIL_SAMPLE_RATE_MISMATCH')
    result, evidence = stitch_tail(original, replacement, rate, args.crop_start, args.replace_start)
    sf.write(args.output, result, rate, subtype='PCM_24')
    written, written_rate = sf.read(args.output, dtype='float32')
    if written_rate != rate or not np.array_equal(written[:evidence['replaceStartFrame']], original[:evidence['replaceStartFrame']]):
        raise ValueError('TAIL_PREFIX_CHANGED_AFTER_ENCODING')
    evidence.update(originalSha256=file_hash(args.original), replacementSha256=file_hash(args.replacement),
                    outputSha256=file_hash(args.output), sampleRate=rate, frames=len(result),
                    limitation='Crossfade between two independently converted vocals; continuity requires listening.')
    atomic_json(args.output.with_suffix('.json'), evidence)


if __name__ == '__main__':
    main()
