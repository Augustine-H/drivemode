import unittest
import numpy as np
from stitch_singing_tail import stitch_tail


class TailStitchTests(unittest.TestCase):
    def test_keeps_prefix_and_aligns_replacement_with_context(self):
        original = np.arange(100, dtype=np.float32)
        replacement = np.arange(50, 130, dtype=np.float32)
        result, evidence = stitch_tail(original, replacement, 10, 2., 6., .4)
        np.testing.assert_array_equal(result[:60], original[:60])
        self.assertEqual(result[60], original[60])
        self.assertEqual(result[63], replacement[43])
        np.testing.assert_array_equal(result[64:], replacement[44:])
        self.assertTrue(evidence['prefixSamplesUnchanged'])
        self.assertEqual(len(result), 100)

    def test_rejects_material_duration_change(self):
        with self.assertRaisesRegex(ValueError, 'DURATION_MISMATCH'):
            stitch_tail(np.ones(1000), np.ones(900), 100, 2., 6., .2)

    def test_rejects_invalid_boundary_and_nonfinite_audio(self):
        with self.assertRaisesRegex(ValueError, 'BOUNDARIES'):
            stitch_tail(np.ones(100), np.ones(80), 10, 2., 9.9)
        with self.assertRaisesRegex(ValueError, 'INVALID_TAIL_AUDIO'):
            stitch_tail(np.ones(100), np.full(80, np.nan), 10, 2., 6.)
