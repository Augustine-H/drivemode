import unittest
import numpy as np
from seed_checkpoint import audit_checkpoint


class Module:
    def state_dict(self):
        return {'weight': np.zeros((2, 3)), 'estimator.input_pos': np.zeros(4)}

    def named_parameters(self):
        return [('weight', np.zeros((2, 3)))]


class CheckpointAuditTests(unittest.TestCase):
    def test_allows_generated_buffer_and_reports_unused_weights(self):
        saved = {'net': {'cfm': {'module.weight': np.zeros((2, 3)),
                                'unused': np.zeros(5)}}}
        row = audit_checkpoint({'cfm': Module()}, saved)['cfm']
        self.assertTrue(row['learnedParametersMatched'])
        self.assertEqual(row['generatedBuffersMissing'], ['estimator.input_pos'])
        self.assertEqual(row['unusedCheckpointKeys'], ['unused'])

    def test_rejects_missing_or_wrong_shaped_learned_weights(self):
        for state in ({}, {'weight': np.zeros((3, 2))}):
            with self.assertRaisesRegex(ValueError, 'LEARNED_WEIGHTS_INVALID'):
                audit_checkpoint({'cfm': Module()}, {'net': {'cfm': state}})

    def test_rejects_missing_module(self):
        with self.assertRaisesRegex(ValueError, 'MISSING_MODULE'):
            audit_checkpoint({'cfm': Module()}, {'net': {}})
