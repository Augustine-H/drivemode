import unittest
from recognition_text import checked_transcription, subtitle_credit_only, checked_lyrics


class RecognitionText(unittest.TestCase):
    def test_real_repeated_chorus_is_preserved_with_uncertainty_warning(self):
        for text in [('우리의 꿈을 노래해요 오늘의 마음을 기억해\n' * 4),
                     ('ร้องเพลงด้วยกันในวันนี้\n' * 4),
                     ('We sing together under the stars\n' * 4)]:
            result, warnings = checked_lyrics(text)
            self.assertEqual(result, text.strip())
            self.assertTrue(warnings)

    def test_partial_loop_does_not_erase_other_audible_words(self):
        text = '처음 들리는 가사\n' + '아 ' * 200
        self.assertEqual(checked_lyrics(text)[0], text.strip())

    def test_new_lyrics_decoder_preserves_words_and_excludes_credits_or_loops(self):
        self.assertEqual(checked_lyrics('날 바라보는 너를 느끼듯이'), ('날 바라보는 너를 느끼듯이', []))
        for text in ['한글자막 by 다른 이름', '아 ' * 200]:
            filtered, warnings = checked_lyrics(text)
            self.assertEqual(filtered, '')
            self.assertTrue(warnings)
    def test_real_lyrics_are_not_retried_or_changed(self):
        calls = []
        lyric = '자막 같은 너의 마음을 읽어 subtitles by my window'
        def decode(timestamps):
            calls.append(timestamps)
            return lyric
        self.assertEqual(checked_transcription(decode), (lyric, [], False))
        self.assertEqual(calls, [True])

    def test_credit_retry_uses_same_audio_decoder_once(self):
        calls = []
        def decode(timestamps):
            calls.append(timestamps)
            return '한글자막 by 한효정' if timestamps else '나를 바라보는 너를 느끼듯이'
        text, warnings, retried = checked_transcription(decode)
        self.assertEqual(text, '나를 바라보는 너를 느끼듯이')
        self.assertTrue(retried)
        self.assertEqual(calls, [True, False])
        self.assertTrue(warnings)

    def test_failed_retry_is_excluded_without_a_loop(self):
        for retry in ['Subtitles by Someone', '아 ' * 200]:
            calls = []
            def decode(timestamps):
                calls.append(timestamps)
                return '한글자막 by 한효정' if timestamps else retry
            text, warnings, retried = checked_transcription(decode)
            self.assertEqual(text, '')
            self.assertTrue(retried)
            self.assertEqual(len(calls), 2)
            self.assertEqual(len(warnings), 2)

    def test_credits_must_be_the_entire_result(self):
        self.assertTrue(subtitle_credit_only('한글자막 by 다른 이름'))
        self.assertFalse(subtitle_credit_only('널 사랑해. 한글자막 by 다른 이름'))
        self.assertFalse(subtitle_credit_only('자막처럼 흘러가는 우리의 이야기'))
