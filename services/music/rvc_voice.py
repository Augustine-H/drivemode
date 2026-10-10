"""Explicit local registration of a trained RVC voice; no generic voice fallback."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

from singing_voice import VOICE_ID
from provider import atomic_json, file_hash

ROOT = Path(__file__).resolve().parents[2] / '.music-runtime/persona-singing-v1/rvc-profiles'


def profile(voice, root=ROOT):
    if not VOICE_ID.fullmatch(voice):
        raise ValueError('INVALID_RVC_VOICE_ID')
    folder = root / voice
    if folder.is_symlink() or not (folder / 'profile.json').is_file():
        raise ValueError('RVC_VOICE_NOT_TRAINED')
    metadata = json.loads((folder / 'profile.json').read_text())
    for name in ('model.pth', 'voice.index'):
        path = folder / name
        expected = metadata.get('files', {}).get(name)
        if expected is None and name == 'voice.index':
            continue
        if path.is_symlink() or not path.is_file() or file_hash(path) != expected:
            raise ValueError('RVC_MODEL_CHANGED')
    if metadata.get('voiceId') != voice or metadata.get('version') != 1:
        raise ValueError('INVALID_RVC_PROFILE')
    return folder, metadata


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--voice', required=True)
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--index', type=Path)
    parser.add_argument('--provenance', required=True)
    args = parser.parse_args()
    if not VOICE_ID.fullmatch(args.voice) or not args.model.is_file():
        raise ValueError('INVALID_RVC_MODEL_INPUT')
    import torch
    checkpoint = torch.load(args.model, map_location='cpu', weights_only=True)
    if not isinstance(checkpoint, dict) or not isinstance(checkpoint.get('weight'), dict) or not isinstance(checkpoint.get('config'), list):
        raise ValueError('RVC_INFERENCE_WEIGHTS_REQUIRED')
    if checkpoint.get('version', 'v1') not in ('v1', 'v2') or checkpoint.get('f0', 1) != 1:
        raise ValueError('RVC_F0_SINGING_MODEL_REQUIRED')
    folder = ROOT / args.voice
    folder.mkdir(parents=True, exist_ok=False)
    shutil.copyfile(args.model, folder / 'model.pth')
    if args.index:
        shutil.copyfile(args.index, folder / 'voice.index')
    atomic_json(folder / 'profile.json', {'version': 1, 'voiceId': args.voice,
        'modelVersion': checkpoint.get('version', 'v1'), 'provenance': args.provenance,
        'files': {p.name: file_hash(p) for p in folder.iterdir() if p.is_file()}, 'qualityVerified': False})
    profile(args.voice)
    print('RVC voice registered; listening verification still required')


if __name__ == '__main__':
    main()
