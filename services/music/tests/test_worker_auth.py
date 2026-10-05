import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from worker_auth import worker_token


@unittest.skipUnless(os.name == "nt", "Windows DPAPI")
class WorkerCredentialTests(unittest.TestCase):
    def test_stable_encrypted_key_is_separate_from_huggingface(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"LOCALAPPDATA": folder}):
            with self.assertRaisesRegex(RuntimeError, "NOT_INITIALIZED"):
                worker_token()
            token = worker_token(create=True)
            self.assertEqual(worker_token(), token)
            self.assertEqual(len(token), 64)
            path = Path(folder) / "VoiceGrok/Music/worker-api.dpapi"
            self.assertNotIn(token.encode(), path.read_bytes())
            self.assertFalse((path.parent / "huggingface.dpapi").exists())
            path.write_bytes(b"corrupt")
            with self.assertRaisesRegex(RuntimeError, "DECRYPTION_FAILED"):
                worker_token(create=True)
