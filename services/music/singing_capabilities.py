"""Advertise only prepared local singing voices; never imply untrained engines work."""
import json
from pathlib import Path
from singing_voice import ROOT as PROFILES, profile

RUNTIME = Path(__file__).resolve().parents[2] / '.music-runtime/persona-singing-v1'


def available_voices():
    try:
        manifest = json.loads((RUNTIME / 'seed-models.json').read_text())
        if not (RUNTIME / 'seed-vc/inference.py').is_file() or not (RUNTIME / 'seed-deps/transformers').is_dir():
            return []
        if not manifest or any(not (Path(row['path']) / name).is_file() for row in manifest.values() for name in row['files']):
            return []
        voices = []
        for folder in PROFILES.iterdir():
            if folder.is_dir():
                try:
                    profile(folder.name)
                    voices.append(folder.name)
                except ValueError:
                    pass
        return sorted(voices)
    except (OSError, ValueError, KeyError, TypeError):
        return []
