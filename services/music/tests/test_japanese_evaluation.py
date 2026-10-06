import sys
from pathlib import Path
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from japanese_evaluation import spelling, reading, POLICY_VERSION

class JapaneseDiagnostics(unittest.TestCase):
    def test_ascii_phrase_adjacent_to_japanese_and_word_boundaries(self):
        self.assertEqual(spelling("感情のないI'm sorryそれは"), '感情のないアイムソーリーそれは')
        self.assertEqual(spelling("I’m sorry 一人"), 'アイムソーリー ひとり')
        self.assertEqual(spelling("I'm sorryish"), "i'm sorryish")
        self.assertEqual(POLICY_VERSION, 2)

    def test_newlines_do_not_duplicate_kana(self):
        for value in ['ねこ\nいぬ', 'ねこ\r\nいぬ', 'ねこ\n\nいぬ', 'ねこ\nいぬ\n']:
            self.assertEqual(reading(value), 'ねこいぬ')
        self.assertEqual(reading('ひとり\nねこ'), 'ひとりねこ')

    def test_han_kana_and_phrase_variants_share_diagnostic(self):
        self.assertEqual(reading("一人\nI'm sorry"), reading('ひとり\nアイムソーリー'))

if __name__ == '__main__': unittest.main()
