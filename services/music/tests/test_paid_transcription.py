import base64
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch, MagicMock
import wave
import httpx
from pydantic import ValidationError
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api_common import GenerateRequest
from paid_transcription import transcribe, fields, PaidTranscriptionError
from nas_store import NasStore

def audio():
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000)
        wav.writeframes(b'\0\0' * 16000)
    return base64.b64encode(buf.getvalue()).decode()

class PaidTests(unittest.TestCase):
    def test_consent_and_task_boundaries(self):
        body = dict(requestId='paid-test', prompt='Lyrics', duration=1, kind='recognition', transcribe=True, audioBase64=audio())
        for provider in ['qwen', 'xai', 'openai', 'elevenlabs']:
            kwargs = {'transcriptionProvider': provider}
            if provider != 'qwen': kwargs['paidAudioConsent'] = True
            self.assertEqual(GenerateRequest(**body, **kwargs).transcriptionProvider, provider)
        for kwargs in [{'transcriptionProvider': 'openai'}, {'transcriptionProvider': 'invalid'},
                       {'transcriptionProvider': 'qwen', 'paidAudioConsent': True},
                       {'transcriptionProvider': 'openai', 'paidAudioConsent': False}]:
            with self.assertRaises(ValidationError): GenerateRequest(**body, **kwargs)
        with self.assertRaises(ValidationError):
            GenerateRequest(requestId='paid-song', prompt='Song', duration=30, kind='song', lyrics='Original', transcriptionProvider='openai', paidAudioConsent=True)

    def test_provider_fields_auto_and_language(self):
        self.assertIn(('languages[]', 'ja'), fields('openai', 'ja'))
        for provider in ['xai', 'openai', 'elevenlabs']:
            self.assertFalse(any(name in ['language', 'languages[]', 'language_code'] for name, _ in fields(provider, 'auto')))
            self.assertFalse(any(name in ['prompt', 'keywords', 'transcript_edit'] for name, _ in fields(provider, 'ko')))

    def test_success_and_same_folder_never_repeats_external_call(self):
        with tempfile.TemporaryDirectory() as name, patch('paid_transcription.load', return_value='fixture-key-never-real'):
            folder = Path(name)
            client = MagicMock()
            client.__enter__.return_value = client
            client.post.return_value = httpx.Response(200, json={'text': 'Test transcript'})
            with patch('paid_transcription.httpx.Client', return_value=client):
                text, receipt = transcribe(b'fixture', 'openai', 'ja', 30, consent=True, folder=folder)
                self.assertEqual(text, 'Test transcript')
                self.assertEqual(receipt['state'], 'COMPLETED')
                with self.assertRaisesRegex(PaidTranscriptionError, 'ALREADY_ATTEMPTED'):
                    transcribe(b'fixture', 'openai', 'ja', 30, consent=True, folder=folder)
                self.assertEqual(client.post.call_count, 1)
            self.assertNotIn('fixture-key', (folder/'paid-call.json').read_text())

    def test_timeout_no_retry_and_no_raw_error_leak(self):
        with tempfile.TemporaryDirectory() as name, patch('paid_transcription.load', return_value='fixture-key-never-real'):
            client = MagicMock(); client.__enter__.return_value = client
            client.post.side_effect = httpx.ReadTimeout('secret-key-in-provider-error')
            with patch('paid_transcription.httpx.Client', return_value=client):
                with self.assertRaisesRegex(PaidTranscriptionError, 'TIMEOUT_OUTCOME_UNKNOWN') as caught:
                    transcribe(b'fixture', 'xai', 'en', 30, consent=True, folder=Path(name))
                self.assertNotIn('secret-key', str(caught.exception))
                self.assertEqual(client.post.call_count, 1)
                self.assertEqual(json.loads((Path(name)/'paid-call.json').read_text())['state'], 'FAILED')

    def test_missing_consent_and_key_do_not_call(self):
        with tempfile.TemporaryDirectory() as name, patch('paid_transcription.httpx.Client') as client:
            with self.assertRaises(PaidTranscriptionError):
                transcribe(b'fixture', 'xai', 'en', 1, consent=False, folder=Path(name))
            with patch('paid_transcription.load', return_value=None):
                with self.assertRaisesRegex(PaidTranscriptionError, 'NOT_REGISTERED'):
                    transcribe(b'fixture', 'xai', 'en', 1, consent=True, folder=Path(name))
            client.assert_not_called()

    def test_nas_heartbeat_capabilities_and_terminal_scrub(self):
        with tempfile.TemporaryDirectory() as name:
            store = NasStore(Path(name))
            store.poll(True, 'test', ['qwen', 'openai'])
            self.assertEqual(store.health()['transcriptionProviders'], ['qwen', 'openai'])

    def test_failed_paid_job_keeps_worker_healthy_and_scrubs_sample(self):
        from worker import MusicWorker
        with tempfile.TemporaryDirectory() as name:
            worker = MusicWorker(Path(name)/'worker', lock_path=Path(name)/'test.lock', min_free_bytes=0)
            worker.start()
            try:
                body = dict(requestId='paid-error', prompt='Lyrics', duration=1, kind='recognition', transcribe=True,
                            transcriptionProvider='openai', paidAudioConsent=True, audioBase64=audio())
                with patch('worker.MusicWorker._extended', side_effect=PaidTranscriptionError('PAID_PROVIDER_HTTP_401')):
                    job, _ = worker.submit(body)
                    import time
                    deadline = time.monotonic() + 10
                    while worker.store.get(job['id'])['state'] not in ['FAILED', 'COMPLETED']:
                        if time.monotonic() > deadline: self.fail('Worker did not finish')
                        time.sleep(.03)
                result = worker.store.get(job['id'])
                self.assertEqual(result['state'], 'FAILED')
                self.assertNotIn('audioBase64', result['request'])
                self.assertTrue(worker.health()['acceptingJobs'])
                self.assertIsNone(worker.error)
            finally: worker.close()

if __name__ == '__main__': unittest.main()
