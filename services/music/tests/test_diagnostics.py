import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from diagnostics import safe_error


class DiagnosticsTests(unittest.TestCase):
    def test_error_keeps_cause_without_tokens_or_signed_query(self):
        token = "hf_diagnosticTestNotARealToken"
        with patch.dict(os.environ, {"HF_TOKEN": token}):
            try:
                raise RuntimeError(f"download failed {token} https://example.com/file?signature=secret Bearer abc123")
            except RuntimeError as error:
                details = safe_error(error)
        text = str(details)
        self.assertIn("download failed", text)
        self.assertIn("RuntimeError", text)
        self.assertNotIn(token, text)
        self.assertNotIn("signature=secret", text)
        self.assertNotIn("abc123", text)


if __name__ == "__main__":
    unittest.main()
