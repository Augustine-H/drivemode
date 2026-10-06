import unittest
from pathlib import Path
from unittest.mock import patch

from nas_bridge import publish_status


class BridgeStatusTests(unittest.TestCase):
    def test_transient_windows_permission_error_retries(self):
        with patch('nas_bridge.atomic_json', side_effect=[PermissionError('locked'), None]) as write, \
             patch('nas_bridge.threading.Event'):
            self.assertTrue(publish_status(Path('status.json'), {'state': 'IDLE'}))
            self.assertEqual(write.call_count, 2)

    def test_persistent_snapshot_failure_is_logged_without_stopping_bridge(self):
        with patch('nas_bridge.atomic_json', side_effect=PermissionError('locked')) as write, \
             patch('nas_bridge.threading.Event'), patch('nas_bridge.print') as log:
            self.assertFalse(publish_status(Path('status.json'), {'state': 'IDLE'}))
            self.assertEqual(write.call_count, 3)
            self.assertIn('BRIDGE_STATUS_WRITE_FAILED', log.call_args.args[0])

    def test_other_io_failure_is_logged_without_retry(self):
        with patch('nas_bridge.atomic_json', side_effect=OSError('disk full')) as write, \
             patch('nas_bridge.print') as log:
            self.assertFalse(publish_status(Path('status.json'), {'state': 'IDLE'}))
            self.assertEqual(write.call_count, 1)
            self.assertTrue(log.called)
