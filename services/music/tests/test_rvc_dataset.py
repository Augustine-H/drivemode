import tempfile
import unittest
from pathlib import Path
import numpy as np
import soundfile as sf

from rvc_dataset import audit
from rvc_voice import profile


class RvcDatasetTests(unittest.TestCase):
    def test_empty_dataset_is_not_ready_and_does_not_train(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = audit(Path(temporary), 'ara')
            self.assertEqual(result['totalUniqueSeconds'], 0)
            self.assertFalse(result['quantityReady'])
            self.assertFalse(result['trainingStarted'])

    def test_duplicate_recordings_do_not_inflate_training_quantity(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            pcm = .1 * np.sin(2 * np.pi * 440 * np.arange(16000) / 16000)
            sf.write(root / 'first.wav', pcm, 16000)
            (root / 'duplicate.wav').write_bytes((root / 'first.wav').read_bytes())
            result = audit(root, 'ara')
            self.assertEqual(result['totalUniqueSeconds'], 1.)
            self.assertEqual(sum(row['duplicate'] for row in result['files']), 1)
            self.assertFalse(result['quantityReady'])

    def test_missing_model_cannot_fall_back_to_another_voice(self):
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(ValueError, 'NOT_TRAINED'):
                profile('ara', Path(temporary))
