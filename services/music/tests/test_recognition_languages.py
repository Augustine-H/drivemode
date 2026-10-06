import base64
import io
import unittest
from unittest.mock import patch
import numpy as np
import soundfile as sf
from typing import get_args
from recognition_languages import TranscriptionLanguage, model_language
from vocal_runtime import recognition


class LanguageRouting(unittest.TestCase):
    def test_codes_match_installed_processor(self):
        from transformers.models.qwen3_asr.processing_qwen3_asr import LANGUAGE_CODE_TO_NAME
        self.assertEqual(set(get_args(TranscriptionLanguage)) - {'auto'}, set(LANGUAGE_CODE_TO_NAME))
        self.assertIsNone(model_language('auto'))
        self.assertEqual(model_language('ja'), 'ja')
        with self.assertRaises(ValueError): model_language('xx')

    def test_actual_request_routes_language_and_keeps_original_script(self):
        data = io.BytesIO()
        sf.write(data, .05 * np.sin(np.arange(16000) * .1), 16000, format='WAV', subtype='PCM_16')
        body = dict(audioBase64=base64.b64encode(data.getvalue()).decode(), transcribe=True)
        for language, text in [('en', 'Morning light'), ('ja', '朝の光'), ('auto', 'Bonjour')]:
            with patch('vocal_runtime.transcribe_segments', side_effect=lambda *args, **kwargs: (x for x in [text])) as asr:
                result = recognition(dict(body, transcriptionLanguage=language))
                self.assertEqual(asr.call_args.kwargs['language'], language)
                self.assertEqual(result['transcription'], text)
                self.assertEqual(result['transcriptionLanguage'], language)
        with patch('vocal_runtime.transcribe_segments', side_effect=lambda *args, **kwargs: (x for x in ['아침 빛'])) as asr:
            recognition(body)
            self.assertEqual(asr.call_args.kwargs['language'], 'ko')

    def test_silence_never_calls_asr_in_foreign_mode(self):
        data = io.BytesIO()
        sf.write(data, np.zeros(16000), 16000, format='WAV', subtype='PCM_16')
        with patch('vocal_runtime.transcribe_segments') as asr:
            result = recognition(dict(audioBase64=base64.b64encode(data.getvalue()).decode(),
                                      transcribe=True, transcriptionLanguage='en'))
            self.assertEqual(result['transcription'], '')
            asr.assert_not_called()
