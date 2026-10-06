import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lyrics_evaluation import evaluate, units


class LyricsEvaluationTests(unittest.TestCase):
    def test_known_edit_counts_and_whole_input_omissions(self):
        score = evaluate('cat dog', 'cat fog extra', 'words')
        self.assertEqual((score['errors'], score['substitutions'], score['insertions']), (2, 1, 1))
        self.assertEqual(evaluate('abcde', 'ab')['deletions'], 3)

    def test_repeats_are_not_deduplicated_or_rate_capped(self):
        self.assertEqual(evaluate('a', 'aaaa')['errorRate'], 3)
        self.assertEqual(evaluate('a a', 'a', 'words')['deletions'], 1)

    def test_empty_reference_is_not_false_perfect_score(self):
        self.assertIsNone(evaluate('', 'invented')['errorRate'])
        self.assertEqual(evaluate('ab', '')['errorRate'], 1)

    def test_unicode_marks_and_fixed_normalization(self):
        self.assertEqual(evaluate('Tiến', 'Tie\u0302\u0301n')['errors'], 0)
        self.assertNotEqual(units('ไทยนี้'), units('ไทยน'))
        self.assertEqual(evaluate('Ａ, b!', 'a b')['errors'], 0)
        with self.assertRaises(ValueError): units('test', 'phonetic')


if __name__ == '__main__': unittest.main()
