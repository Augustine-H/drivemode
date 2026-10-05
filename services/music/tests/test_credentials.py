import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from credentials import _transform, configure_huggingface, credential_path


@unittest.skipUnless(os.name == "nt", "Windows DPAPI")
class CredentialTests(unittest.TestCase):
    def test_encrypted_token_roundtrip_does_not_store_plaintext(self):
        test_token = "hf_unitTestOnlyNotARealCredential"
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"LOCALAPPDATA": folder}, clear=True):
            path = credential_path()
            path.parent.mkdir(parents=True)
            encrypted = _transform(test_token.encode(), protect=True)
            self.assertNotIn(test_token.encode(), encrypted)
            path.write_bytes(encrypted)
            self.assertTrue(configure_huggingface())
            self.assertEqual(os.environ["HF_TOKEN"], test_token)

    def test_explicit_environment_token_takes_precedence(self):
        with patch.dict(os.environ, {"HF_TOKEN": "hf_explicitTestValue"}):
            with patch("credentials.credential_path", side_effect=AssertionError("must not read disk")):
                self.assertTrue(configure_huggingface())

    def test_absent_credential_does_not_create_one(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"LOCALAPPDATA": folder}, clear=True):
            self.assertFalse(configure_huggingface())
            self.assertFalse(credential_path().exists())

    def test_corrupted_credential_fails_closed(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"LOCALAPPDATA": folder}, clear=True):
            path = credential_path()
            path.parent.mkdir(parents=True)
            path.write_bytes(b"corrupted")
            with self.assertRaisesRegex(RuntimeError, "CREDENTIAL_DECRYPTION_FAILED"):
                configure_huggingface()
            self.assertNotIn("HF_TOKEN", os.environ)


if __name__ == "__main__":
    unittest.main()
