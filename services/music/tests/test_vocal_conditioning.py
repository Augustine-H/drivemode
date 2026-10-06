import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from vocal_conditioning import validate_conditioning, TEXT_LIMIT, LYRIC_LIMIT


class Pipeline:
    def __init__(self, text_count, lyric_count):
        self.counts = {'formatted text': text_count, 'formatted lyrics': lyric_count}
        self.seen = []

    def _get_task_instruction(self, **kwargs):
        assert kwargs == {'task_type': 'text2music'}
        return 'generate:'

    def _format_prompt(self, **kwargs):
        self.formatted = kwargs
        return 'formatted text', 'formatted lyrics'

    def tokenizer(self, value, **kwargs):
        self.seen.append((value, kwargs))
        return {'input_ids': list(range(self.counts[value]))}


class ConditioningTests(unittest.TestCase):
    request = {'prompt': '설명', 'lyrics': '가사', 'duration': 30}

    def test_exact_limit_includes_formatted_headers_and_special_tokens(self):
        pipe = Pipeline(TEXT_LIMIT, LYRIC_LIMIT)
        instruction, counts = validate_conditioning(pipe, self.request)
        self.assertEqual(instruction, 'generate:')
        self.assertEqual(counts['lyricsTokens'], LYRIC_LIMIT)
        self.assertEqual(pipe.formatted['lyrics'], '가사')
        self.assertEqual(pipe.formatted['instruction'], instruction)
        self.assertTrue(all(kwargs == {'truncation': False} for _, kwargs in pipe.seen))

    def test_each_input_overflow_is_rejected_without_disclosing_content(self):
        private_request = dict(self.request, prompt='PRIVATE_PROMPT_CONTENT', lyrics='PRIVATE_LYRICS_CONTENT')
        for text_count, lyric_count, code in ((TEXT_LIMIT + 1, 1, 'PROMPT'), (1, LYRIC_LIMIT + 1, 'LYRICS')):
            with self.subTest(code=code), self.assertRaisesRegex(ValueError, 'VOCAL_' + code + '_TOKEN_LIMIT') as error:
                validate_conditioning(Pipeline(text_count, lyric_count), private_request)
            self.assertNotIn(private_request['prompt'], str(error.exception))
            self.assertNotIn(private_request['lyrics'], str(error.exception))


if __name__ == '__main__':
    unittest.main()
