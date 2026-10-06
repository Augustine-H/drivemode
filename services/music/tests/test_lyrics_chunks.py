import base64
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
import soundfile as sf
from api_common import GenerateRequest
from lyrics_chunks import windows, merge
from vocal_runtime import recognition


def body(seconds=36, **kwargs):
    buffer = io.BytesIO()
    sf.write(buffer, .05 * np.sin(np.arange(seconds * 16000) * .1), 16000, format='WAV', subtype='PCM_16')
    return dict(requestId='full-file-test', prompt='Lyrics', kind='recognition',
                duration=seconds, transcribe=True, fullFile=True,
                audioBase64=base64.b64encode(buffer.getvalue()).decode(), **kwargs)


class FullFileLyrics(unittest.TestCase):
    def test_audio_boundaries_and_overlap(self):
        self.assertEqual(list(windows(36 * 16000)), [(0, 480000), (432000, 576000)])
        for frames in (16000, 480000, 480001, 600 * 16000):
            ranges = list(windows(frames))
            self.assertEqual(ranges[-1][1], frames)
            self.assertTrue(all(16000 <= b - a <= 480000 for a, b in ranges))

    def test_exact_overlap_keeps_non_boundary_chorus(self):
        self.assertEqual(merge('첫 줄. 오늘도 아름다운 밤', '오늘도 아름다운 밤, 다음 가사')[0], '첫 줄. 오늘도 아름다운 밤 다음 가사')
        self.assertEqual(merge('the sunshine', 'sunshine is here')[0], 'the sunshine is here')
        self.assertEqual(merge('君とのラブストーリー', 'ラブストーリーそれは予想通り')[0], '君とのラブストーリーそれは予想通り')
        self.assertEqual(merge('君とのロマンスは人生から。', '人々のロマンスは人生から続き')[0], '君とのロマンスは人生から。続き')
        value, uncertain = merge('chorus then another verse', 'chorus once again')
        self.assertTrue(uncertain)
        self.assertIn('chorus once again', value)
        self.assertEqual(merge('old verse', '')[0], 'old verse')

    def test_long_audio_requires_explicit_mode_and_transcription(self):
        request = body()
        self.assertEqual(GenerateRequest(**request).duration, 36)
        for changes in ({'fullFile': False}, {'fullFile': None}, {'transcribe': False, 'identify': True, 'fingerprintConsent': True}, {'duration': 601}):
            with self.assertRaises(ValueError): GenerateRequest(**dict(request, **changes))
        with self.assertRaises(ValueError):
            GenerateRequest(requestId='test', prompt='music', duration=121)
        self.assertEqual(GenerateRequest(**body(600)).duration, 600)
        with self.assertRaises(ValueError): GenerateRequest(**body(601))

    def test_one_model_iterator_progress_and_raw_segments(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch('vocal_runtime.transcribe_segments', return_value=(t for t in ['the sunshine', 'sunshine is here'])) as asr:
                result = recognition(body(), Path(folder))
            self.assertEqual(asr.call_count, 1)
            self.assertEqual(result['transcription'], 'the sunshine is here')
            self.assertEqual(len(result['segments']), 2)
            self.assertIn('"completedChunks": 2', (Path(folder) / 'recognition-progress.json').read_text())

    def test_cancel_finishes_current_window_and_skips_remaining(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)
            def outputs(*args, **kwargs):
                (path / 'cancel-recognition').touch()
                yield 'first window'
                self.fail('Cancelled task transcribed another window')
            with patch('vocal_runtime.transcribe_segments', side_effect=outputs):
                result = recognition(body(), path)
            self.assertEqual(len(result['segments']), 1)


if __name__ == '__main__': unittest.main()
