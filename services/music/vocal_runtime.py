"""Isolated ACE-Step / multilingual Qwen lyrics runtime; serial GPU worker only."""
import argparse
import asyncio
import base64
import io
import json
import os
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / '.music-runtime' / 'vocal-deps'))
from provider import atomic_json, save_audio

from vocal_models import ACE, ACE_REVISION
from qwen_lyrics import MODEL as ASR_MODEL, REVISION as ASR_REVISION, transcribe_segments
from recognition_text import checked_lyrics
from lyrics_chunks import windows, merge


def recognition(request, folder=None):
    import numpy as np
    import soundfile as sf
    raw = base64.b64decode(request['audioBase64'], validate=True)
    limit = 600 if request.get('fullFile') and request.get('transcribe') else 30
    if len(raw) > limit * 32000 + 4096:
        raise ValueError('RECOGNITION_AUDIO_TOO_LARGE')
    with sf.SoundFile(io.BytesIO(raw)) as source:
        if source.format != 'WAV' or source.subtype != 'PCM_16' or source.samplerate != 16000 or source.channels != 1 or not 1 <= len(source) / 16000 <= limit:
            raise ValueError('RECOGNITION_WAV_FORMAT_OR_DURATION_INVALID')
        audio = source.read(dtype='float32')
    if not np.isfinite(audio).all() or np.sqrt(np.mean(audio ** 2)) < 0.001:
        return {'transcription': '', 'titleMatch': None, 'warnings': ['음성이 없거나 소리가 너무 작습니다.']}
    result = {'warnings': []}
    if request.get('transcribe'):
        language = request.get('transcriptionLanguage') or 'ko'
        ranges = list(windows(len(audio)))
        if folder:
            atomic_json(folder / 'recognition-progress.json', {'completedChunks': 0, 'totalChunks': len(ranges), 'processedSeconds': 0, 'totalSeconds': round(len(audio) / 16000, 3)})
        text, segments = '', []
        # Silence is guarded per window, not just across the whole file.
        audible = [(a, b) for a, b in ranges if np.sqrt(np.mean(audio[a:b] ** 2)) >= 0.001]
        outputs = transcribe_segments((audio[a:b] for a, b in audible), language=language)
        try:
            for index, (a, b) in enumerate(ranges):
                if folder and (folder / 'cancel-recognition').exists():
                    break
                if (a, b) in audible:
                    chunk, warnings = checked_lyrics(next(outputs))
                    result['warnings'].extend(warnings)
                else:
                    chunk = ''
                text, ambiguous = merge(text, chunk)
                if ambiguous:
                    result['warnings'].append('구간 경계의 가사를 확실하게 합치지 못해 두 인식 결과를 줄바꿈으로 남겼습니다. 중복·누락을 확인하세요.')
                segments.append({'startSeconds': round(a / 16000, 3), 'endSeconds': round(b / 16000, 3), 'text': chunk})
                if folder:
                    atomic_json(folder / 'recognition-progress.json', {'completedChunks': index + 1, 'totalChunks': len(ranges), 'processedSeconds': round(b / 16000, 3), 'totalSeconds': round(len(audio) / 16000, 3)})
        finally:
            outputs.close()
        result['segments'] = segments
        result['warnings'] = list(dict.fromkeys(result['warnings']))
        if len(segments) < len(ranges):
            result['warnings'].append('취소된 작업의 완료 구간만 표시합니다. 파일 전체 가사가 아닙니다.')
        result['transcription'] = text
        result['transcriptionLanguage'] = language
        if language == 'auto':
            result['warnings'].append('자동 감지는 짧은 구간이나 여러 언어가 섞인 노래에서 틀릴 수 있습니다. 곡의 언어를 알면 직접 선택하세요.')
        result['warnings'].append('자동 받아쓰기입니다. 반주·발음에 따라 가사가 누락되거나 잘못 인식될 수 있습니다.')
    if request.get('identify') and not (folder and (folder / 'cancel-recognition').exists()):
        if request.get('fingerprintConsent') is not True:
            raise ValueError('FINGERPRINT_CONSENT_REQUIRED')
        from shazamio import Shazam
        try:
            sample = io.BytesIO()
            sf.write(sample, audio[:30 * 16000], 16000, format='WAV', subtype='PCM_16')
            response = asyncio.run(asyncio.wait_for(Shazam().recognize(sample.getvalue()), timeout=25))
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
            result = {'recognition': recognition(request, folder), 'model': {'provider': 'local_qwen3_asr_and_shazam_fingerprint', 'model': ASR_MODEL, 'modelRevision': ASR_REVISION,
                      'transcriptionDecoding': 'greedy', 'language': request.get('transcriptionLanguage') or 'ko', 'precision': 'bfloat16'}}
        else:
            from diffusers import AceStepPipeline
            pipe = AceStepPipeline.from_pretrained(ACE, revision=ACE_REVISION, torch_dtype=torch.bfloat16,
                                                   local_files_only=True)
            from vocal_conditioning import validate_conditioning, TEXT_LIMIT, LYRIC_LIMIT
            instruction, conditioning = validate_conditioning(pipe, request)
            pipe.vae.enable_tiling()
            pipe.enable_model_cpu_offload()
            load_seconds = time.perf_counter() - started
            generated = time.perf_counter()
            audio = pipe(prompt=request['prompt'], lyrics=request['lyrics'], vocal_language='ko',
                         audio_duration=float(request['duration']), num_inference_steps=8,
                         instruction=instruction, max_text_length=TEXT_LIMIT, max_lyric_length=LYRIC_LIMIT,
                         guidance_scale=1.0, shift=3.0,
                         generator=torch.Generator(device='cuda').manual_seed(request['seed'])).audios
            torch.cuda.synchronize()
            generation_seconds = time.perf_counter() - generated
            waveform = audio[0].T.cpu().float().numpy()
            wav = save_audio(waveform, pipe.sample_rate, folder / 'original.wav')
            result = {'wav': wav, 'model': {'provider': 'ace_step_local', 'model': ACE, 'modelRevision': ACE_REVISION,
                      'device': torch.cuda.get_device_name(), 'loadSeconds': round(load_seconds, 3), 'apiCostUsd': 0},
                      'metrics': {'generationSeconds': round(generation_seconds, 3),
                                  'conditioning': conditioning, 'numInferenceSteps': 8,
                                  'guidanceScale': 1.0, 'shift': 3.0}}
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
