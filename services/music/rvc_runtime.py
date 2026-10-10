"""Pinned offline RVC adapter. Requires a genuinely trained local voice model."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time

from rvc_voice import profile
from provider import atomic_json, file_hash
from worker_auth import local_directory

ROOT = Path(__file__).resolve().parents[2]
REVISION = '81eed5e8f68b6bed1789f682fe78cdd324495afc'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--voice', required=True)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--index-rate', type=float, default=.75)
    parser.add_argument('--protect', type=float, default=.33)
    parser.add_argument('--seed', type=int, default=1042)
    parser.add_argument('--diagnostic-mode', choices=['baseline', 'preserve-unvoiced', 'protect-only'], default='baseline')
    args = parser.parse_args()
    if not 0 <= args.index_rate <= 1 or not 0 <= args.protect <= .5:
        parser.error('index-rate must be 0..1 and protect must be 0..0.5')
    if not 0 <= args.seed <= 2**31-1:
        parser.error('seed must be 0..2147483647')
    autostart = ROOT / '.music-runtime/autostart/config.json'
    if autostart.is_file():
        os.environ['LOCALAPPDATA'] = json.loads(autostart.read_text())['localAppData']
    folder, metadata = profile(args.voice)
    source, output = args.source.resolve(), args.output.resolve()
    repository = ROOT / '.music-runtime/persona-singing-v1/rvc'
    if subprocess.check_output(['git', '-C', str(repository), 'rev-parse', 'HEAD'], text=True).strip() != REVISION:
        raise ValueError('RVC_SOURCE_CHANGED')
    required = ['assets/hubert_base/config.json', 'assets/hubert_base/preprocessor_config.json',
                'assets/hubert_base/pytorch_model.bin', 'assets/rmvpe/rmvpe.pt']
    if any(not (repository / name).is_file() for name in required):
        raise ValueError('RVC_BASE_MODELS_NOT_PREPARED')
    if not source.is_file() or output.exists():
        raise ValueError('INVALID_RVC_SOURCE_OR_EXISTING_OUTPUT')
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', RVC_CUDA_GRAPH='0',
        RVC_AUDIO_FORCE_CPU='1', weight_root=str(folder), rmvpe_root=str(repository / 'assets/rmvpe'))
    os.environ['PATH'] = str(ROOT / '.music-runtime/persona-singing-v1/rvc-tools') + os.pathsep + os.environ['PATH']
    sys.path.insert(0, str(repository))
    os.chdir(repository)
    sys.argv = [sys.argv[0]]  # Upstream Config owns its own command-line parser.
    from filelock import FileLock
    with FileLock(str(local_directory() / 'gpu-worker.lock'), timeout=0):
        started = time.perf_counter()
        import torch
        import numpy as np
        import soundfile as sf
        import psutil
        if torch.cuda.is_available():
            torch.cuda.reset_peak_memory_stats()
        from configs.config import Config
        from infer.vc.modules import VC
        config = Config()
        converter = VC(config)
        converter.get_vc('model.pth')
        from rvc_diagnostics import install
        diagnostic = install(args.diagnostic_mode)
        load_seconds = time.perf_counter() - started
        torch.manual_seed(args.seed)
        status, result = converter.vc_single(0, str(source), 0, 'rmvpe',
            str(folder / 'voice.index') if (folder / 'voice.index').is_file() else '',
            args.index_rate if (folder / 'voice.index').is_file() else 0., 0, 1., args.protect)
        if result is None or result[1] is None:
            raise RuntimeError('RVC_CONVERSION_FAILED:' + str(status))
        rate, pcm = result
        pcm = np.asarray(pcm)
        if not pcm.size or not np.isfinite(pcm).all() or not np.any(pcm):
            raise ValueError('INVALID_RVC_OUTPUT')
        sf.write(output, pcm, rate)
        atomic_json(output.with_suffix('.json'), {'voiceId': args.voice, 'revision': REVISION,
            'method': 'rvc_trained_persona', 'loadSeconds': round(load_seconds, 3),
            'parameters': {'indexRate': args.index_rate if (folder / 'voice.index').is_file() else 0.,
                           'protect': args.protect, 'pitchShift': 0, 'f0Method': 'rmvpe', 'rmsMixRate': 1., 'seed':args.seed},
            'diagnostic': diagnostic,
            'elapsedSeconds': round(time.perf_counter() - started, 3),
            'profile': metadata, 'sampleRate': rate, 'frames': len(pcm), 'apiCostUsd': 0,
            'sourceSha256': file_hash(source), 'outputSha256': file_hash(output),
            'gpuPeakAllocatedBytes': torch.cuda.max_memory_allocated() if torch.cuda.is_available() else None,
            'gpuPeakReservedBytes': torch.cuda.max_memory_reserved() if torch.cuda.is_available() else None,
            'processRssBytesAtEnd': psutil.Process().memory_info().rss,
            'qualityVerified': False, 'device': config.device})


if __name__ == '__main__':
    main()
