"""Isolated ACE-Step / Whisper runtime. Invoked only by the serial GPU worker."""
import argparse
import asyncio
import base64
import io
import json
import os
from pathlib import Path
import sys
import time
import zlib

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / '.music-runtime' / 'vocal-deps'))
from provider import atomic_json, save_audio

from vocal_models import ACE, ACE_REVISION, WHISPER, WHISPER_REVISION


def recognition(request):
    import numpy as np
    import soundfile as sf
    raw = base64.b64decode(request['audioBase64'], validate=True)
    if len(raw) > 1024 * 1024:
        raise ValueError('RECOGNITION_AUDIO_TOO_LARGE')
    with sf.SoundFile(io.BytesIO(raw)) as source:
        if source.format != 'WAV' or source.samplerate != 16000 or source.channels != 1 or not 1 <= len(source) / 16000 <= 30:
            raise ValueError('RECOGNITION_REQUIRES_MONO_16KHZ_WAV_1_TO_30_SECONDS')
        audio = source.read(dtype='float32')
    if not np.isfinite(audio).all() or np.sqrt(np.mean(audio ** 2)) < 0.001:
        return {'transcription': '', 'titleMatch': None, 'warnings': ['음성이 없거나 소리가 너무 작습니다.']}
    result = {'warnings': []}
    if request.get('transcribe'):
        import torch
        from transformers import AutoProcessor, WhisperForConditionalGeneration
        processor = AutoProcessor.from_pretrained(WHISPER, revision=WHISPER_REVISION, local_files_only=True)
        model = WhisperForConditionalGeneration.from_pretrained(WHISPER, revision=WHISPER_REVISION,
                                                               local_files_only=True).to('cuda')
        inputs = processor(audio, sampling_rate=16000, return_tensors='pt').input_features.to('cuda')
        with torch.inference_mode():
            tokens = model.generate(inputs, task='transcribe', max_new_tokens=440,
                                    do_sample=False, return_timestamps=True,
                                    temperature=0.0,
                                    no_speech_threshold=0.6, logprob_threshold=-1.0,
                                    compression_ratio_threshold=2.4)
        text = processor.batch_decode(tokens, skip_special_tokens=True)[0].strip()
        encoded = text.encode('utf-8')
        if len(encoded) > 40 and len(encoded) / len(zlib.compress(encoded)) > 2.4:
            text = ''
            result['warnings'].append('반복된 글자·문장이 생성되어 받아쓰기 결과를 제외했습니다. 보컬이 또렷한 구간으로 다시 시도하세요.')
        result['transcription'] = text
        result['warnings'].append('자동 받아쓰기입니다. 반주·발음에 따라 가사가 누락되거나 잘못 인식될 수 있습니다.')
        del model
        torch.cuda.empty_cache()
    if request.get('identify'):
        if request.get('fingerprintConsent') is not True:
            raise ValueError('FINGERPRINT_CONSENT_REQUIRED')
        from shazamio import Shazam
        try:
            response = asyncio.run(asyncio.wait_for(Shazam().recognize(raw), timeout=25))
            track = response.get('track') or {}
            result['titleMatch'] = {'title': str(track['title'])[:300], 'artist': str(track.get('subtitle', ''))[:300]} if track.get('title') and response.get('matches') else None
            if result['titleMatch'] is None:
                result['warnings'].append('등록된 곡과 일치하는 지문을 찾지 못했습니다. 제목·가수를 추측하지 않습니다.')
        except Exception as error:
            from diagnostics import safe_error
            result['titleMatch'] = None
            result['identificationError'] = type(error).__name__ + ': ' + safe_error(error)['message'][:500]
            result['warnings'].append('곡 검색 서비스에 연결하지 못했습니다. 받아쓰기 결과와 별도로 표시합니다.')
    return result


def run(request, folder):
    import torch
    from benchmark import ResourceMonitor
    if not torch.cuda.is_available():
        raise RuntimeError('CUDA_NOT_AVAILABLE')
    os.environ['HF_HUB_OFFLINE'] = '1'
    started = time.perf_counter()
    torch.cuda.reset_peak_memory_stats()
    with ResourceMonitor() as monitor:
        if request['kind'] == 'recognition':
            result = {'recognition': recognition(request), 'model': {'provider': 'local_whisper_and_shazam_fingerprint', 'model': WHISPER, 'modelRevision': WHISPER_REVISION}}
        else:
            from diffusers import AceStepPipeline
            pipe = AceStepPipeline.from_pretrained(ACE, revision=ACE_REVISION, torch_dtype=torch.bfloat16,
                                                   local_files_only=True)
            pipe.vae.enable_tiling()
            pipe.enable_model_cpu_offload()
            load_seconds = time.perf_counter() - started
            generated = time.perf_counter()
            audio = pipe(prompt=request['prompt'], lyrics=request['lyrics'], vocal_language='ko',
                         audio_duration=float(request['duration']), num_inference_steps=8,
                         generator=torch.Generator(device='cuda').manual_seed(request['seed'])).audios
            torch.cuda.synchronize()
            generation_seconds = time.perf_counter() - generated
            waveform = audio[0].T.cpu().float().numpy()
            wav = save_audio(waveform, pipe.sample_rate, folder / 'original.wav')
            result = {'wav': wav, 'model': {'provider': 'ace_step_local', 'model': ACE, 'modelRevision': ACE_REVISION,
                      'device': torch.cuda.get_device_name(), 'loadSeconds': round(load_seconds, 3), 'apiCostUsd': 0},
                      'metrics': {'generationSeconds': round(generation_seconds, 3)}}
    result.setdefault('metrics', {}).update(totalSeconds=round(time.perf_counter() - started, 3),
                                           peakAllocatedMiB=round(torch.cuda.max_memory_allocated() / 2**20, 2),
                                           peakReservedMiB=round(torch.cuda.max_memory_reserved() / 2**20, 2),
                                           resources=monitor.metrics())
    atomic_json(folder / 'vocal-result.json', result)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('request', type=Path)
    parser.add_argument('folder', type=Path)
    args = parser.parse_args()
    try:
        run(json.loads(args.request.read_text(encoding='utf-8')), args.folder)
    except Exception as error:
        from diagnostics import safe_error
        atomic_json(args.folder / 'vocal-error.json', safe_error(error))
        raise
