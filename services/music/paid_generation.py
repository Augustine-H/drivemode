"""Explicit single-call Eleven Music. Preserve API MP3 and decode WAV locally."""
import json
import os
import re
import subprocess
import time
import httpx
from paid_credentials import load
from generation_providers import MUSIC_MODEL, MUSIC_PRICING
from provider import atomic_json, file_hash, verify_audio_file, save_audio

class PaidGenerationError(RuntimeError):
    pass

def payload(request):
    common = {'model_id': MUSIC_MODEL, 'store_for_inpainting': False}
    if request.get('kind') == 'song':
        language_style = {'ko': 'Vocals sung in Korean', 'en': 'Vocals sung in English', 'ja': 'Vocals sung in Japanese'}[request.get('singingLanguage') or 'ko']
        return {**common, 'seed': request['seed'], 'composition_plan': {'chunks': [{
            'text': request['lyrics'], 'duration_ms': request['duration'] * 1000,
            'positive_styles': [request['prompt'], language_style], 'negative_styles': ['instrumental only'],
            'context_adherence': 'high'}]}}
    return {**common, 'prompt': request['prompt'], 'music_length_ms': request['duration'] * 1000,
            'force_instrumental': True}

def generate(request, folder, cancelled=lambda: False):
    if request.get('generationProvider') != 'elevenlabs' or request.get('paidGenerationConsent') is not True:
        raise PaidGenerationError('PAID_GENERATION_CONSENT_REQUIRED')
    try:
        key = load('elevenlabs')
    except Exception:
        raise PaidGenerationError('PAID_GENERATION_CREDENTIAL_UNAVAILABLE') from None
    if not key:
        raise PaidGenerationError('PAID_GENERATION_CREDENTIAL_NOT_REGISTERED')
    if cancelled():
        raise PaidGenerationError('PAID_GENERATION_CANCELLED_BEFORE_CALL')
    folder.mkdir(parents=True, exist_ok=True)
    receipt = folder / 'paid-generation-call.json'
    record = {'provider': 'elevenlabs', 'model': MUSIC_MODEL, 'state': 'INFLIGHT',
              'seconds': request['duration'], 'estimatedUsd': round(request['duration'] / 60 * MUSIC_PRICING['estimatedUsdPerMinute'], 6),
              'actualBillKnown': False, 'automaticRetries': False, 'apiSourceFormat': 'mp3',
              'wavSource': 'decoded-from-provider-mp3'}
    try:
        with receipt.open('x', encoding='utf8') as handle:
            json.dump(record, handle); handle.flush(); os.fsync(handle.fileno())
    except FileExistsError:
        raise PaidGenerationError('PAID_GENERATION_ALREADY_ATTEMPTED') from None
    started = time.perf_counter()
    temporary = folder / 'provider.partial.mp3'
    try:
        with httpx.Client(timeout=httpx.Timeout(600, connect=20), trust_env=False, follow_redirects=False) as client:
            with client.stream('POST', 'https://api.elevenlabs.io/v1/music',
                               params={'output_format': 'mp3_44100_128'},
                               headers={'xi-api-key': key}, json=payload(request)) as response:
                record['httpStatus'] = response.status_code
                if not response.is_success:
                    # Read only bounded error JSON; never log a key or submitted text.
                    response.read()
                    try:
                        data = response.json()
                        detail = data.get('detail', {}) if isinstance(data, dict) else {}
                        code = detail.get('status') if isinstance(detail, dict) else None
                        message = detail.get('message') if isinstance(detail, dict) else None
                        if isinstance(code, str) and re.fullmatch(r'[A-Za-z0-9_.:-]{1,80}', code):
                            record['providerErrorCode'] = code
                        if isinstance(message, str):
                            for secret in [key, request['prompt'], request.get('lyrics')]:
                                if secret: message = message.replace(secret, '[redacted]')
                            record['providerErrorMessage'] = message[:600]
                    except (ValueError, TypeError):
                        pass
                    if record.get('providerErrorCode') == 'limited_access' and 'free users' in record.get('providerErrorMessage', ''):
                        raise PaidGenerationError(f'PAID_GENERATION_HTTP_{response.status_code}: Music API requires a paid plan')
                    raise PaidGenerationError(f'PAID_GENERATION_HTTP_{response.status_code}')
                count = 0
                with temporary.open('wb') as handle:
                    for block in response.iter_bytes():
                        count += len(block)
                        if count > 16 * 2**20:
                            raise PaidGenerationError('PAID_GENERATION_RESPONSE_TOO_LARGE')
                        handle.write(block)
        # Preserve a fully received response before validation. Partial streams
        # still get deleted; a rejected complete response remains diagnostic data.
        source = folder / 'provider-original.mp3'
        temporary.replace(source)
        record['sourceMp3Sha256'] = file_hash(source)
        record['sourceMp3Bytes'] = source.stat().st_size
        record['responsePreserved'] = True
        import imageio_ffmpeg
        intermediate = folder / 'provider-decoded.wav'
        result = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-nostdin', '-hide_banner', '-loglevel', 'error',
                                 '-y', '-i', str(source), '-map_metadata', '-1', '-c:a', 'pcm_s24le', str(intermediate)],
                                capture_output=True, timeout=120)
        if result.returncode:
            raise PaidGenerationError('PAID_GENERATION_DECODE_FAILED')
        # Check the exact PCM that will be saved. Direct MP3 decoding through
        # libsndfile can disagree with FFmpeg about frame counts and gapless data.
        info = verify_audio_file(intermediate)
        record['decodedAudio'] = info
        record['validationDecoder'] = 'ffmpeg-to-pcm-wav'
        record['durationDeltaSeconds'] = round(info['duration'] - request['duration'], 6)
        record['durationToleranceSeconds'] = .25
        if abs(info['duration'] - request['duration']) > .25:
            raise PaidGenerationError('PAID_GENERATION_DURATION_MISMATCH')
        import soundfile as sf
        audio, rate = sf.read(intermediate, dtype='float32', always_2d=True)
        wav = save_audio(audio, rate, folder / 'original.wav')
        intermediate.unlink()
        record['state'] = 'COMPLETED'
        return wav, record
    except httpx.TimeoutException:
        record['state'] = 'FAILED'
        raise PaidGenerationError('PAID_GENERATION_TIMEOUT_OUTCOME_UNKNOWN_NO_RETRY') from None
    except httpx.TransportError:
        record['state'] = 'FAILED'
        raise PaidGenerationError('PAID_GENERATION_NETWORK_OUTCOME_UNKNOWN_NO_RETRY') from None
    except Exception:
        record['state'] = 'FAILED'
        raise
    finally:
        temporary.unlink(missing_ok=True)
        record['elapsedSeconds'] = round(time.perf_counter() - started, 3)
        atomic_json(receipt, record)
