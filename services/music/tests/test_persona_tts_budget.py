import unittest
from persona_tts import validate_budget


class PersonaTtsBudgetTests(unittest.TestCase):
    def test_failed_and_reserved_requests_consume_budget(self):
        ledger = {'approvedTotalUsd': 1, 'approvalDate': '2026-10-10', 'requests': [
            {'inputCharacters': 40000, 'state': 'FAILED_OR_AMBIGUOUS'},
            {'inputCharacters': 26666, 'state': 'RESERVED'}]}
        with self.assertRaisesRegex(RuntimeError, 'BUDGET_EXCEEDED'):
            validate_budget(ledger, 1)

    def test_explicit_approval_required(self):
        with self.assertRaisesRegex(RuntimeError, 'NOT_APPROVED'):
            validate_budget({'requests': []}, 10)

    def test_six_voice_batch_fits_but_extra_full_batch_does_not(self):
        ledger = {'approvedTotalUsd': 1, 'approvalDate': '2026-10-10',
                  'requests': [{'inputCharacters': 8471} for _ in range(5)]}
        validate_budget(ledger, 8471)
        ledger['requests'] += [{'inputCharacters': 8471} for _ in range(2)]
        with self.assertRaisesRegex(RuntimeError, 'BUDGET_EXCEEDED'):
            validate_budget(ledger, 8471)
