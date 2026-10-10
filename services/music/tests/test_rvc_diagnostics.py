import unittest
import numpy as np
from rvc_diagnostics import restore_unvoiced, protection_weights


class UnvoicedDiagnosticsTests(unittest.TestCase):
    def test_protection_uses_aligned_raw_mask_without_changing_pitch(self):
        raw = np.array([0., 200., 0., 300., 0.])
        filled = np.array([200., 200., 250., 300., 300.])
        np.testing.assert_allclose(protection_weights(raw, 1, 3, .1), [1., .1, 1.])
        np.testing.assert_array_equal(filled, [200., 200., 250., 300., 300.])
        np.testing.assert_array_equal(raw, [0., 200., 0., 300., 0.])

    def test_rejects_unaligned_protection_slice(self):
        for offset, count in ((-1, 2), (1, 3)):
            with self.assertRaisesRegex(ValueError, 'MASK_ALIGNMENT'):
                protection_weights(np.array([0., 200.]), offset, count, .1)

    def test_restores_only_unvoiced_frames_without_changing_inputs(self):
        raw = np.array([0., 200., 0., 300.])
        filled = np.array([200., 200., 250., 300.])
        coarse = np.array([40, 40, 60, 80])
        c, f = restore_unvoiced(coarse, filled, raw)
        np.testing.assert_array_equal(c, [1, 40, 1, 80])
        np.testing.assert_array_equal(f, [0, 200, 0, 300])
        np.testing.assert_array_equal(filled, [200, 200, 250, 300])
        np.testing.assert_array_equal(coarse, [40, 40, 60, 80])

    def test_rejects_unaligned_frames(self):
        with self.assertRaisesRegex(ValueError, 'SHAPE_MISMATCH'):
            restore_unvoiced(np.ones(2), np.ones(2), np.ones(3))

    def test_rejects_invalid_raw_f0(self):
        for raw in ([0, float('nan')], [0, -1]):
            with self.assertRaisesRegex(ValueError, 'INVALID_RAW_F0'):
                restore_unvoiced(np.ones(2), np.ones(2), raw)
