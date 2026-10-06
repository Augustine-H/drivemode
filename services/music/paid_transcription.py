"""Single explicit paid request. No retries, fallback, prompts or secret logging."""
import json
import os
import time
import httpx
from paid_credentials import load
from transcription_providers import PAID
from provider import atomic_json
ENDPOINTS = {'xai': 'https://api.x.ai/v1/stt',
             'openai': 'https://api.openai.com/v1/audio/transcriptions',
             'elevenlabs': 'https://api.elevenlabs.io/v1/speech-to-text'}

class PaidTranscriptionError(RuntimeError):
    pass

def fields(provider, language):
    model = PAID[provider]['model']
    if provider == 'xai':
        result, name = [('model', model), ('format', 'false')], 'language'
    elif provider == 'openai':
        result, name = [('model', model)], 'languages[]'
    else:
        result = [('model_id', model), ('tag_audio_events', 'false'),
                  ('diarize', 'false'), ('timestamps_granularity', 'none')]
        name = 'language_code'
    if language != 'auto':
        result.append((name, language))
    return result

def transcribe(raw, provider, language, seconds, *, consent, folder):
    if provider not in PAID or consent is not True:
        raise PaidTranscriptionError('PAID_AUDIO_CONSENT_REQUIRED')
    try:
        key = load(provider)
    except Exception:
        raise PaidTranscriptionError('PAID_CREDENTIAL_UNAVAILABLE') from None
    if not key:
        raise PaidTranscriptionError('PAID_CREDENTIAL_NOT_REGISTERED')
    receipt = folder / 'paid-call.json'
    record = {'provider': provider, 'model': PAID[provider]['model'], 'state': 'INFLIGHT',
              'seconds': seconds, 'estimatedUsd': round(seconds / 3600 * PAID[provider]['estimatedUsdPerHour'], 6),
              'actualBillKnown': False, 'automaticRetries': False}
    try:
        with receipt.open('x', encoding='utf8') as handle:
            json.dump(record, handle)
            handle.flush()
            os.fsync(handle.fileno())
    except FileExistsError:
        raise PaidTranscriptionError('PAID_CALL_ALREADY_ATTEMPTED') from None
    started = time.perf_counter()
    try:
        headers = {'xi-api-key': key} if provider == 'elevenlabs' else {'Authorization': 'Bearer ' + key}
        multipart = [(k, (None, v)) for k, v in fields(provider, language)]
        multipart.append(('file', ('sample.wav', raw, 'audio/wav')))
        with httpx.Client(timeout=httpx.Timeout(180, connect=20), trust_env=False, follow_redirects=False) as client:
            response = client.post(ENDPOINTS[provider], headers=headers, files=multipart)
        record['httpStatus'] = response.status_code
        if not response.is_success:
            raise PaidTranscriptionError(f'PAID_PROVIDER_HTTP_{response.status_code}')
        try:
            data = response.json()
        except ValueError:
            raise PaidTranscriptionError('PAID_PROVIDER_INVALID_RESPONSE') from None
        if not isinstance(data, dict) or not isinstance(data.get('text'), str) or len(data['text']) > 60000:
            raise PaidTranscriptionError('PAID_PROVIDER_INVALID_TRANSCRIPT')
        record['state'] = 'COMPLETED'
        return data['text'], record
    except httpx.TimeoutException:
        record['state'] = 'FAILED'
        raise PaidTranscriptionError('PAID_PROVIDER_TIMEOUT_OUTCOME_UNKNOWN_NO_RETRY') from None
    except httpx.TransportError:
        record['state'] = 'FAILED'
        raise PaidTranscriptionError('PAID_PROVIDER_NETWORK_OUTCOME_UNKNOWN_NO_RETRY') from None
    except PaidTranscriptionError:
        record['state'] = 'FAILED'
        raise
    finally:
        record['elapsedSeconds'] = round(time.perf_counter() - started, 3)
        atomic_json(receipt, record)
