import json
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from worker import read_recognition_progress


class RecognitionProgressReads(unittest.TestCase):
    def test_polling_access_conflict_does_not_fail_inference(self):
        path = Mock()
        path.read_text.side_effect = [PermissionError('sharing conflict'), '{"completedChunks": 2}']
        self.assertIsNone(read_recognition_progress(path))
        self.assertEqual(read_recognition_progress(path), {'completedChunks': 2})

    @patch('worker.time.sleep')
    def test_final_read_retries_temporary_conflict(self, sleep):
        path = Mock()
        path.read_text.side_effect = [PermissionError('sharing conflict'), '{"completedChunks": 5}']
        self.assertEqual(read_recognition_progress(path, required=True), {'completedChunks': 5})
        sleep.assert_called_once_with(0.05)

    @patch('worker.time.sleep')
    def test_persistent_final_access_error_is_reported(self, sleep):
        path = Mock()
        path.read_text.side_effect = PermissionError('persistent access denial')
        with self.assertRaises(PermissionError):
            read_recognition_progress(path, required=True)
        self.assertEqual(path.read_text.call_count, 4)

    def test_missing_poll_and_malformed_json_are_distinct(self):
        path = Mock()
        path.read_text.side_effect = FileNotFoundError()
        self.assertIsNone(read_recognition_progress(path))
        path.read_text.side_effect = None
        path.read_text.return_value = 'invalid json'
        with self.assertRaises(json.JSONDecodeError):
            read_recognition_progress(path)


if __name__ == '__main__':
    unittest.main()
