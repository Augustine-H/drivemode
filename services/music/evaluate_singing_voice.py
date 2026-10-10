"""Offline diagnostic speaker similarities, not a perceptual identity guarantee."""
import argparse
import json
import os
from pathlib import Path

os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1')

import numpy as np
import soundfile as sf
import torch
import torchaudio
from transformers import AutoFeatureExtractor, WavLMForXVector
from provider import atomic_json

MODEL = 'microsoft/wavlm-base-plus-sv'
REVISION = 'feb593a6c23c1cc3d9510425c29b0a14d2b07b1e'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('run', type=Path)
    parser.add_argument('--vocals', action='store_true')
    parser.add_argument('--conversions', nargs='+', type=Path, help='Additional offline SVC probe folders')
    args = parser.parse_args()
    torch.set_num_threads(4)
    processor = AutoFeatureExtractor.from_pretrained(MODEL, revision=REVISION, local_files_only=True)
    model = WavLMForXVector.from_pretrained(MODEL, revision=REVISION, local_files_only=True).eval()

    def embedding(path):
        audio, sr = sf.read(path, dtype='float32', always_2d=True)
        pcm = torchaudio.functional.resample(torch.from_numpy(audio.mean(axis=1)), sr, 16000).numpy()
        # Average equal-duration windows; evaluate every generated file identically.
        chunks = [pcm[a:a + 8 * 16000] for a in range(0, len(pcm), 8 * 16000) if len(pcm[a:a + 8 * 16000]) >= 3 * 16000]
        outputs = []
        for chunk in chunks:
            with torch.inference_mode():
                value = model(**processor(chunk, sampling_rate=16000, return_tensors='pt')).embeddings[0]
            outputs.append(torch.nn.functional.normalize(value, dim=0))
        return torch.nn.functional.normalize(torch.stack(outputs).mean(dim=0), dim=0)

    refs = {v: embedding(args.run.parent / 'profiles' / v / 'reference.wav') for v in ('ara', 'eve')}
    report = json.loads((args.run / 'report.json').read_text(encoding='utf-8'))
    scores, vectors = [], {}
    for row in report['results']:
        vector = embedding(Path(row['output']) / ('vocals.wav' if args.vocals else 'original.wav'))
        vectors[(row['voice'], row['seed'])] = vector
        scores.append({'voice': row['voice'], 'seed': row['seed'],
                       'similarity': {v: round(float(vector @ ref), 4) for v, ref in refs.items()}})
    converted_vectors = {}
    for folder in args.conversions or []:
        metadata = json.loads((folder / 'conversion.json').read_text(encoding='utf8'))
        files = list(folder.glob('vc_*.wav'))
        if len(files) != 1:
            raise ValueError('EXPECTED_ONE_CONVERTED_VOCAL')
        vector = embedding(files[0])
        method = metadata.get('method', 'seed_vc_singing_conversion')
        converted_vectors.setdefault((metadata['voiceId'], method), []).append(vector)
        scores.append({'voice': metadata['voiceId'], 'method': method,
                       'output': str(folder.resolve()),
                       'similarity': {v: round(float(vector @ ref), 4) for v, ref in refs.items()}})
    pairs = []
    for voice in ('unconditioned', 'ara', 'eve'):
        values = [vec for (v, _), vec in vectors.items() if v == voice]
        if len(values) == 2:
            pairs.append({'voice': voice, 'seedPairCosine': round(float(values[0] @ values[1]), 4)})
    result = {'model': MODEL, 'revision': REVISION, 'input': 'Demucs separated vocals' if args.vocals else 'full mixes, with accompaniment',
              'limitations': 'Speech-trained metric; accompaniment, language, phrasing and pitch confound identity. Not calibrated for singing. No pass threshold or claim of identical voices.',
              'referenceCosine': round(float(refs['ara'] @ refs['eve']), 4), 'scores': scores, 'pairs': pairs}
    if converted_vectors:
        result['conversionPairs'] = [{'voice': voice, 'method': method,
                                     'seedPairCosine': round(float(values[0] @ values[1]), 4)}
                                     for (voice, method), values in converted_vectors.items() if len(values) == 2]
    name = 'speaker-conversion-diagnostic.json' if args.conversions else ('speaker-vocals-diagnostic.json' if args.vocals else 'speaker-diagnostic.json')
    atomic_json(args.run / name, result)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
