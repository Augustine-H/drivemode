import unittest
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
from remix_singing_conversion import aligned_audio


class SingingRemixTests(unittest.TestCase):
    def test_material_duration_change_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'voice.wav'
            sf.write(path, np.full((1000, 1), .1), 1000)
            with self.assertRaisesRegex(ValueError, 'DURATION_MISMATCH'):
                aligned_audio(path, 1000, 1100)

    def test_hop_rounding_is_padded_without_time_stretch(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'voice.wav'
            sf.write(path, np.full((990, 1), .1), 1000)
            pcm, metadata = aligned_audio(path, 1000, 1000)
            self.assertEqual(pcm.shape, (1000, 2))
            self.assertFalse(metadata['timeStretch'])
            self.assertEqual(metadata['alignmentDeltaFrames'], -10)
            self.assertTrue(np.all(pcm[-10:] == 0))

    def test_silent_and_nonfinite_output_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'voice.wav'
            for data in (np.zeros(1000), np.full(1000, np.nan)):
                sf.write(path, data, 1000, subtype='FLOAT')
                with self.assertRaises(ValueError):
                    aligned_audio(path, 1000, 1000)
