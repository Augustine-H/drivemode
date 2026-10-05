import base64
import io
import wave
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pydantic import ValidationError
from api_common import GenerateRequest
from nas_store import NasStore
from job_store import JobError

def request(**fields):
    return dict(requestId='vocal-contract', prompt='Korean piano pop', duration=30, seed=1042, bitrate=320, **fields)

def fixture():
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as output:
        output.setnchannels(1); output.setsampwidth(2); output.setframerate(16000)
        output.writeframes(b'\0\0' * 16000)
    return base64.b64encode(buffer.getvalue()).decode()

class VocalContract(unittest.TestCase):
    def test_song_requires_real_lyrics(self):
        for value in [request(kind='song'), request(kind='song', lyrics='  '), request(lyrics='unrouted')]:
            with self.assertRaises(ValidationError): GenerateRequest(**value)
        self.assertEqual(GenerateRequest(**request(kind='song', lyrics='직접 쓴 가사')).kind, 'song')

    def test_title_lookup_requires_explicit_consent(self):
        with self.assertRaises(ValidationError):
            GenerateRequest(**request(kind='recognition', audioBase64='AAAA', identify=True))
        self.assertTrue(GenerateRequest(**request(kind='recognition', audioBase64=fixture(), identify=True, fingerprintConsent=True)).identify)
        with self.assertRaises(ValidationError):
            GenerateRequest(**request(kind='recognition', audioBase64='AAAA', transcribe=True))

    def test_recognition_completion_has_no_audio_and_scrubs_sample(self):
        with tempfile.TemporaryDirectory() as folder:
            store = NasStore(Path(folder))
            body = request(kind='recognition', audioBase64=base64.b64encode(b'private-fixture').decode(), transcribe=True)
            job, _ = store.enqueue(body)
            store.poll(True, 'session')
            result = {'localJobId': '12345678-1234-1234-1234-123456789abc', 'workerState': 'COMPLETED', 'artifacts': {}}
            with self.assertRaises(JobError): store.report(job['id'], result)
            result['recognition'] = {'transcription': '시험', 'warnings': []}
            store.report(job['id'], result)
            final = store.finalize(job['id'])
            self.assertEqual(final['state'], 'COMPLETED')
            self.assertNotIn('audioBase64', final['request'])
            same, created = store.enqueue(body)
            self.assertFalse(created)
            self.assertEqual(same['id'], job['id'])

if __name__ == '__main__': unittest.main()
