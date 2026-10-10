"""Explicit offline English/Japanese diagnostic; does not extend the public API."""
import argparse
import json
import os
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / '.music-runtime/vocal-deps'))
from provider import atomic_json, save_audio, encode_mp3
from vocal_models import ACE, ACE_REVISION
from vocal_conditioning import validate_conditioning, TEXT_LIMIT, LYRIC_LIMIT


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--language', required=True, choices=['en', 'ja'])
    parser.add_argument('--request', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    from api_common import GenerateRequest
    request = GenerateRequest(**json.loads(args.request.read_text(encoding='utf-8'))).model_dump(exclude_none=True)
    if request.get('kind') != 'song' or request.get('generationProvider') != 'local' or request.get('singingVoice'):
        raise ValueError('Diagnostic requires a local unconverted song request')
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1')
    import torch
    from diffusers import AceStepPipeline
    from filelock import FileLock
    from worker_auth import local_directory
    from benchmark import ResourceMonitor
    if not torch.cuda.is_available():
        raise RuntimeError('CUDA_NOT_AVAILABLE')
    args.output.mkdir(parents=True, exist_ok=False)
    with FileLock(str(local_directory() / 'gpu-worker.lock'), timeout=0), ResourceMonitor() as monitor:
        started = time.perf_counter()
        torch.cuda.reset_peak_memory_stats()
        pipe = AceStepPipeline.from_pretrained(ACE, revision=ACE_REVISION,
            torch_dtype=torch.bfloat16, local_files_only=True)
        instruction, conditioning = validate_conditioning(pipe, request, vocal_language=args.language)
        pipe.vae.enable_tiling()
        pipe.enable_model_cpu_offload()
        loaded = time.perf_counter()
        audio = pipe(prompt=request['prompt'], lyrics=request['lyrics'], vocal_language=args.language,
            audio_duration=float(request['duration']), num_inference_steps=8, instruction=instruction,
            max_text_length=TEXT_LIMIT, max_lyric_length=LYRIC_LIMIT, guidance_scale=1.0, shift=3.0,
            generator=torch.Generator(device='cuda').manual_seed(request['seed'])).audios
        torch.cuda.synchronize()
        generated = time.perf_counter()
        wav = save_audio(audio[0].T.cpu().float().numpy(), pipe.sample_rate, args.output / 'original.wav')
        mp3 = encode_mp3(args.output / 'original.wav', args.output / 'original.mp3')
        report = {'language': args.language, 'apiCostUsd': 0, 'model': ACE, 'revision': ACE_REVISION,
            'device': torch.cuda.get_device_name(), 'conditioning': conditioning,
            'loadSeconds': round(loaded-started, 3), 'generationSeconds': round(generated-loaded, 3),
            'peakAllocatedMiB': round(torch.cuda.max_memory_allocated()/2**20, 2),
            'wav': wav, 'mp3': mp3, 'qualityReview': 'requires-listening'}
    report['resources'] = monitor.metrics()
    atomic_json(args.output / 'generation.json', report)
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
