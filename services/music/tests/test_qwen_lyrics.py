import unittest
from unittest.mock import patch
import qwen_lyrics


class QwenLyricsContract(unittest.TestCase):
    def test_unprepared_model_never_triggers_download_or_load(self):
        with patch('qwen_lyrics.prepared', return_value=False), \
             patch('transformers.AutoProcessor.from_pretrained') as processor, \
             patch('transformers.AutoModelForMultimodalLM.from_pretrained') as model:
            with self.assertRaisesRegex(RuntimeError, 'MODEL_NOT_PREPARED'):
                qwen_lyrics.transcribe([])
            processor.assert_not_called()
            model.assert_not_called()

    def test_unvalidated_language_does_not_silently_switch_mode(self):
        with patch('transformers.AutoProcessor.from_pretrained') as processor:
            with self.assertRaisesRegex(ValueError, 'LANGUAGE_NOT_SUPPORTED'):
                qwen_lyrics.transcribe([], language='French')
            processor.assert_not_called()
