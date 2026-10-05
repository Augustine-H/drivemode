import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from provider import atomic_json, encode_mp3, file_hash, save_audio, validate_request


class ProviderContractTests(unittest.TestCase):
    def test_duration_limits_and_prompt_are_checked_before_loading_model(self):
        for duration in (0, 121, -1, float("nan"), float("inf"), True, "30"):
            with self.subTest(duration=duration), self.assertRaises(ValueError):
                validate_request("Synthwave", duration, 1042)
        for prompt in ("", "  ", "a" * 2001, None):
            with self.subTest(prompt=prompt), self.assertRaises(ValueError):
                validate_request(prompt, 30, 1042)
        for seed in (-1, 2**31, True, 1.5):
            with self.subTest(seed=seed), self.assertRaises(ValueError):
                validate_request("Synthwave", 30, seed)
        validate_request("Instrumental synthwave", 120, 1042)

    def test_nonfinite_metadata_does_not_replace_last_valid_report(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "report.json"
            atomic_json(path, {"state": "ENCODING", "wavSaved": True})
            with self.assertRaises(ValueError):
                atomic_json(path, {"seconds": float("nan")})
            self.assertEqual(json.loads(path.read_text())["state"], "ENCODING")

    def test_invalid_audio_is_rejected(self):
        import numpy as np
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "audio.wav"
            for audio in (np.zeros((100, 2)), np.ones((100, 1)), np.full((100, 2), np.nan)):
                with self.assertRaises(RuntimeError):
                    save_audio(audio, 44100, path)
                self.assertFalse(path.exists())

    def test_real_wav_and_mp3_round_trip_preserves_source(self):
        import numpy as np
        import soundfile as sf
        with tempfile.TemporaryDirectory() as folder:
            wav = Path(folder) / "fixture.wav"
            mp3 = wav.with_suffix(".mp3")
            # Test signal only; never exposed as generated music.
            t = np.arange(44100) / 44100
            mono = (0.1 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
            result = save_audio(np.column_stack([mono, mono]), 44100, wav)
            self.assertEqual(result["duration"], 1)
            before = file_hash(wav)
            encoded = encode_mp3(wav, mp3)
            self.assertGreater(encoded["bytes"], 1000)
            self.assertEqual(file_hash(wav), before)
            samples, rate = sf.read(mp3)
            self.assertEqual(rate, 44100)
            self.assertEqual(samples.shape[1], 2)
            self.assertAlmostEqual(len(samples) / rate, 1.0, delta=0.1)

    def test_encoding_failure_never_removes_wav(self):
        with tempfile.TemporaryDirectory() as folder:
            wav = Path(folder) / "original.wav"
            wav.write_bytes(b"preserved-source")
            with patch("provider.subprocess.run") as run:
                run.return_value.returncode = 1
                with self.assertRaises(RuntimeError):
                    encode_mp3(wav, wav.with_suffix(".mp3"))
            self.assertEqual(wav.read_bytes(), b"preserved-source")


if __name__ == "__main__":
    unittest.main()
