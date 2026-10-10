import unittest
from unittest.mock import patch
from types import SimpleNamespace
from rvc_preprocess_runtime import main, segment_slices


class UtteranceRetentionTests(unittest.TestCase):
    def test_separate_short_utterances_are_all_retained(self):
        slices = [[1] * 20, [2] * 30, [3] * 15]
        self.assertEqual(list(segment_slices(slices, 10)), slices)

    def test_long_utterance_retains_final_sample_and_has_no_gap(self):
        audio = list(range(100))
        chunks = list(segment_slices([audio], 10))
        self.assertEqual(chunks[-1][-1], 99)
        self.assertEqual(set(x for c in chunks for x in c), set(audio))
        self.assertEqual(chunks[0][-3:], chunks[1][:3])

    def test_empty_slice_does_not_create_invalid_chunk(self):
        self.assertEqual(list(segment_slices([[], [1, 2]], 10)), [[1, 2]])

    def test_failed_normalization_is_not_silently_accepted(self):
        class RejectingPreprocess:
            sr, per, overlap, bh, ah = 10, 3.7, .3, None, None
            slicer = SimpleNamespace(slice=lambda audio: [audio])

            def norm_write(self, *_):
                return False

        namespace = {'PreProcess':RejectingPreprocess, 'load_audio':lambda *_: [1, 2],
            'signal':SimpleNamespace(lfilter=lambda *_: [1, 2]),
            'println':lambda *_: None, 'traceback':SimpleNamespace(format_exc=lambda: 'failure'),
            'preprocess_trainset':lambda *_: RejectingPreprocess().pipeline('input.wav', '0', 0, 1),
            'inp_root':'input', 'sr':10, 'n_p':1, 'exp_dir':'output', 'per':3.7}
        with patch('rvc_preprocess_runtime.runpy.run_module', return_value=namespace):
            with self.assertRaisesRegex(RuntimeError, 'PREPROCESS_INPUT_FAILED:input.wav'):
                main()
