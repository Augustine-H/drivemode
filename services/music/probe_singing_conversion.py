"""Pinned offline Seed-VC SVC experiment, separate from the production queue."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / '.music-runtime/persona-singing-v1'
COMMIT = '51383efd921027683c89e5348211d93ff12ac2a8'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True, type=Path)
    references = parser.add_mutually_exclusive_group(required=True)
    references.add_argument('--voice')
    references.add_argument('--diagnostic-reference', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--diffusion-steps', type=int, default=30)
    parser.add_argument('--cfg-rate', type=float, default=.7)
    parser.add_argument('--precision', choices=['fp16', 'fp32'], default='fp16')
    parser.add_argument('--queue-parent-pid', type=int, help='Internal: direct Worker parent owns the GPU lock')
    args = parser.parse_args()
    if args.queue_parent_pid is not None and args.diagnostic_reference is not None:
        parser.error('diagnostic references are unavailable to the production queue')
    if not 10 <= args.diffusion_steps <= 60 or not 0 <= args.cfg_rate <= 1:
        parser.error('diffusion-steps must be 10..60 and cfg-rate must be 0..1')
    os.environ['LOCALAPPDATA'] = json.loads((ROOT / '.music-runtime/autostart/config.json').read_text())['localAppData']
    source, output = args.source.resolve(), args.output.resolve()
    repository = RUNTIME / 'seed-vc'
    if subprocess.check_output(['git', '-C', str(repository), 'rev-parse', 'HEAD'], text=True).strip() != COMMIT:
        raise ValueError('SEED_VC_SOURCE_REVISION_CHANGED')
    manifest = json.loads((RUNTIME / 'seed-models.json').read_text())
    sys.path.insert(0, str(RUNTIME / 'seed-deps'))
    sys.path.insert(0, str(repository))
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1')
    from singing_probe_reference import select_reference
    reference, profile_data, reference_mode = select_reference(args.voice, args.diagnostic_reference)
    # Every helper download is replaced by a lookup in the explicit prepared manifest.
    import hf_utils

    def prepared(repo, filename='pytorch_model.bin', config_filename=None):
        row = manifest[repo]
        if filename not in row['files'] or (config_filename and config_filename not in row['files']):
            raise ValueError('UNPREPARED_SEED_VC_DEPENDENCY')
        path = Path(row['path'])
        return (str(path / filename), str(path / config_filename)) if config_filename else str(path / filename)

    hf_utils.load_custom_model_from_hf = prepared
    import torch
    import torchaudio
    import soundfile as sf
    import yaml
    import inference
    from seed_checkpoint import audit_checkpoint
    original_load_checkpoint = inference.load_checkpoint
    checkpoint_audits = []

    def checked_load(model, optimizer, path, **options):
        checkpoint = torch.load(path, map_location='cpu')
        checkpoint_audits.append(audit_checkpoint(model, checkpoint))
        del checkpoint
        return original_load_checkpoint(model, optimizer, path, **options)

    inference.load_checkpoint = checked_load
    if not torch.cuda.is_available():
        raise RuntimeError('CUDA_NOT_AVAILABLE')
    # Local directories keep the upstream BigVGAN/Whisper calls offline and pinned.
    config_path = Path(manifest['Plachta/Seed-VC']['path']) / 'config_dit_mel_seed_uvit_whisper_base_f0_44k.yml'
    config = yaml.safe_load(config_path.read_text())
    config['model_params']['vocoder']['name'] = manifest['nvidia/bigvgan_v2_44khz_128band_512x']['path']
    config['model_params']['speech_tokenizer']['name'] = manifest['openai/whisper-small']['path']
    output.mkdir(parents=True, exist_ok=False)
    local_config = output / 'model-config.yml'
    local_config.write_text(yaml.safe_dump(config), encoding='utf-8')
    # Upstream saves float PCM with torchaudio; use the existing SoundFile backend on Windows.
    def save(path, pcm, rate):
        sf.write(path, pcm.T.cpu().numpy(), rate, subtype='PCM_24')
    torchaudio.save = save
    request = argparse.Namespace(source=str(source), target=str(reference), output=str(output),
        diffusion_steps=args.diffusion_steps, length_adjust=1.0, inference_cfg_rate=args.cfg_rate, f0_condition=True,
        auto_f0_adjust=False, semi_tone_shift=0, fp16=args.precision == 'fp16',
        checkpoint=prepared('Plachta/Seed-VC', 'DiT_seed_v2_uvit_whisper_base_f0_44k_bigvgan_pruned_ft_ema_v2.pth'),
        config=str(local_config))
    from benchmark import ResourceMonitor
    from provider import atomic_json, file_hash
    from worker_auth import local_directory
    from filelock import FileLock
    from contextlib import nullcontext
    lock = FileLock(str(local_directory() / 'gpu-worker.lock'), timeout=0)
    if args.queue_parent_pid is not None:
        import psutil
        from filelock import Timeout
        # Windows venv python.exe may insert its redirector as the immediate parent.
        parents = psutil.Process().parents()[:2]
        owner = next((parent for parent in parents if parent.pid == args.queue_parent_pid), None)
        if owner is None or not any(str(a).endswith('worker_api.py') for a in owner.cmdline()):
            raise ValueError('INVALID_QUEUE_PARENT')
        try:
            lock.acquire(timeout=0)
        except Timeout:
            pass
        else:
            lock.release()
            raise ValueError('QUEUE_GPU_LOCK_NOT_HELD')
        lock = nullcontext()
    torch.manual_seed(1042)
    torch.cuda.reset_peak_memory_stats()
    started = time.perf_counter()
    os.chdir(repository)
    with lock, ResourceMonitor() as monitor:
        inference.main(request)
    files = list(output.glob('vc_*.wav'))
    if len(files) != 1:
        raise ValueError('EXPECTED_ONE_CONVERTED_VOCAL')
    import numpy as np
    pcm, sample_rate = sf.read(files[0], dtype='float32', always_2d=True)
    source_info = sf.info(source)
    if (sample_rate != 44100 or pcm.shape[1] != 1 or not np.isfinite(pcm).all()
            or len(pcm) == 0 or np.sqrt(np.mean(pcm.astype('float64') ** 2)) < 1e-6):
        raise ValueError('INVALID_CONVERTED_VOCAL')
    if abs(len(pcm) / sample_rate - source_info.duration) > .05:
        raise ValueError('CONVERSION_DURATION_MISMATCH')
    result = {'apiCostUsd': 0, 'offline': True, 'sourceRevision': COMMIT,
              'sourceSha256': file_hash(source),
              'parameters': {'diffusionSteps': args.diffusion_steps, 'cfgRate': args.cfg_rate,
                             'seed': 1042, 'pitchShift': 0, 'autoF0Adjust': False,
                             'fp16': request.fp16},
              'checkpointAudits': checkpoint_audits,
              'voiceId': args.voice, 'referenceMode': reference_mode,
              'referenceSha256': profile_data['sha256'],
              'elapsedSeconds': round(time.perf_counter()-started, 3),
              'peakAllocatedMiB': round(torch.cuda.max_memory_allocated()/2**20, 2),
              'resources': monitor.metrics(), 'models': manifest, 'qualityVerified': False,
              'audio': {'sampleRate': sample_rate, 'channels': pcm.shape[1],
                        'duration': len(pcm) / sample_rate, 'finite': True}}
    atomic_json(output / 'conversion.json', result)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
