"""Queue-owned offline singing conversion, with sequential model processes."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

from provider import save_audio

HERE = Path(__file__).resolve().parent


def convert(folder: Path, voice: str):
    started = time.perf_counter()
    baseline = folder / 'persona-baseline'
    baseline.mkdir(exist_ok=False)
    shutil.copyfile(folder / 'original.wav', baseline / 'original.wav')
    output = folder / 'persona-conversion'
    commands = [
        ['prepare_singing_vocals.py', str(baseline), '--folder'],
        ['probe_singing_conversion.py', '--source', str(baseline / 'vocals.wav'), '--voice', voice,
         '--output', str(output), '--queue-parent-pid', str(os.getpid())],
        ['remix_singing_conversion.py', '--baseline', str(baseline), '--conversion', str(output)],
    ]
    for arguments in commands:
        with (folder / (arguments[0] + '.log')).open('w', encoding='utf-8') as log:
            process = subprocess.Popen([sys.executable, str(HERE / arguments[0]), *arguments[1:]],
                                       stdout=log, stderr=log, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            try:
                code = process.wait(timeout=600)
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
            if code:
                raise RuntimeError(f'PERSONA_SINGING_STAGE_FAILED:{arguments[0]}:exit={code}; baseline preserved')
    import soundfile as sf
    pcm, rate = sf.read(output / 'song.wav', dtype='float32', always_2d=True)
    import numpy as np
    if abs(len(pcm) / rate - sf.info(baseline / 'original.wav').duration) > 0.1:
        raise RuntimeError('PERSONA_SINGING_DURATION_MISMATCH; baseline preserved')
    if not np.isfinite(pcm).all() or np.max(np.abs(pcm)) > 1:
        raise RuntimeError('PERSONA_SINGING_INVALID_PCM; baseline preserved')
    conversion = json.loads((output / 'conversion.json').read_text())
    remix = json.loads((output / 'remix.json').read_text())
    metadata = {'version': 1, 'voiceId': voice, 'method': 'demucs_seed_vc',
                 'referenceSha256': conversion['referenceSha256'],
                 'sourceRevision': conversion['sourceRevision'], 'apiCostUsd': 0,
                 'qualityVerified': False, 'userAudition': 'Ara/Eve prototype accepted; per-output quality not guaranteed',
                 'elapsedSeconds': round(time.perf_counter()-started, 3),
                 'conversion': conversion, 'remix': remix}
    # Complete metadata validation before replacing the paid/local original.
    wav = save_audio(pcm, rate, folder / 'original.wav')
    return wav, metadata
