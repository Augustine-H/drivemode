"""Paid source fixtures exercise queue completion without purchasing music."""
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from job_store import JobStore
from worker import MusicWorker
from provider import save_audio


class PaidPersonaTests(unittest.TestCase):
    def run_case(self, outcome):
        import numpy as np
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            worker = MusicWorker(root, lock_path=root / 'test.lock', min_free_bytes=0)
            worker.store = JobStore(root)
            request = dict(requestId='paid-persona', prompt='fixture', duration=10, bitrate=320,
                           kind='song', lyrics='fixture lyrics', generationProvider='elevenlabs',
                           paidGenerationConsent=True, singingVoice='ara', singingMethod='persona_seed_vc')
            job, _ = worker.store.enqueue(request)
            worker.store.claim()
            original = np.column_stack([np.sin(np.arange(441000) * .02) * .1] * 2).astype('float32')
            def generate(request, folder, cancelled):
                info = save_audio(original, 44100, folder / 'original.wav')
                if outcome == 'cancel':
                    worker.store.cancel(job['id'])
                return info, {'elapsedSeconds': 1, 'estimatedUsd': .025}
            def convert(folder, voice):
                self.assertEqual(worker.store.get(job['id'])['stage'], 'PERSONA_CONVERSION')
                if outcome == 'fail':
                    raise RuntimeError('PERSONA_FIXTURE_FAILURE')
                return save_audio(original * .5, 44100, folder / 'original.wav'), {
                    'voiceId': voice, 'method': 'demucs_seed_vc', 'elapsedSeconds': 2}
            with patch('paid_generation.generate', side_effect=generate) as paid, \
                 patch('persona_pipeline.convert', side_effect=convert) as conversion, \
                 patch('worker.encode_mp3', return_value={'decoded': {'duration': 10}}) as encode:
                worker._process(job)
            result = worker.store.get(job['id'])
            self.assertEqual(paid.call_count, 1)
            self.assertEqual(conversion.call_count, 0 if outcome == 'cancel' else 1)
            self.assertEqual(encode.call_count, 1 if outcome == 'success' else 0)
            self.assertEqual(result['state'], {'success': 'COMPLETED', 'fail': 'FAILED', 'cancel': 'CANCELLED'}[outcome])
            self.assertEqual(result['metrics']['paidGeneration']['estimatedUsd'], .025)
            self.assertIsNone(worker.error)
            if outcome == 'success':
                self.assertEqual(result['model']['singingVoice']['voiceId'], 'ara')
                self.assertEqual(result['metrics']['personaSingingSeconds'], 2)
            else:
                from provider import file_hash
                self.assertEqual(file_hash(root / 'audio' / job['id'] / 'original.wav'),
                                 result['artifacts']['wav']['sha256'])

    def test_paid_then_persona_then_encoding(self):
        self.run_case('success')

    def test_failed_conversion_preserves_paid_source_without_retry(self):
        self.run_case('fail')

    def test_cancel_after_paid_source_skips_conversion(self):
        self.run_case('cancel')

    def test_missing_conversion_metadata_does_not_overwrite_source(self):
        import numpy as np
        from provider import file_hash
        from persona_pipeline import convert
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            audio = np.full((44100, 2), .1, dtype='float32')
            save_audio(audio, 44100, folder / 'original.wav')
            before = file_hash(folder / 'original.wav')
            output = folder / 'persona-conversion'
            output.mkdir()
            save_audio(audio * .5, 44100, output / 'song.wav')
            with patch('persona_pipeline.subprocess.Popen') as process:
                process.return_value.wait.return_value = 0
                process.return_value.poll.return_value = 0
                with self.assertRaises(FileNotFoundError):
                    convert(folder, 'ara')
            self.assertEqual(file_hash(folder / 'original.wav'), before)
