import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api_common import GenerateRequest
from singing_voice import profile
from pydantic import ValidationError


class SingingVoiceTests(unittest.TestCase):
    def test_voice_requires_song_and_paid_reference_is_not_supported(self):
        base = dict(requestId='persona-probe', prompt='piano', duration=30, singingVoice='ara')
        for fields in ({}, {'kind': 'recognition'}, {'kind': 'song', 'lyrics': 'hello',
                       'generationProvider': 'elevenlabs', 'paidGenerationConsent': True,
                       'singingMethod': 'ace_reference_experiment'}):
            with self.assertRaises(ValidationError):
                GenerateRequest(**base, **fields)
        self.assertEqual(GenerateRequest(**base, kind='song', lyrics='hello').singingVoice, 'ara')
        self.assertEqual(GenerateRequest(**base, kind='song', lyrics='hello',
            generationProvider='elevenlabs', paidGenerationConsent=True,
            singingMethod='persona_seed_vc').singingVoice, 'ara')
        with self.assertRaises(ValidationError):
            GenerateRequest(**base, kind='song', lyrics='hello', generationProvider='elevenlabs')

    def test_method_without_voice_is_rejected(self):
        with self.assertRaises(ValidationError):
            GenerateRequest(requestId='method', prompt='piano', duration=30, kind='song',
                            lyrics='hello', singingMethod='persona_seed_vc')

    def test_paths_are_not_voice_ids(self):
        for voice in ('../ara', 'C:/voice', '', 'ARA', 'a' * 41):
            with self.assertRaises(ValueError):
                profile(voice)

    def test_changed_reference_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            folder = root / 'ara'
            folder.mkdir()
            reference = folder / 'reference.wav'
            reference.write_bytes(b'reference fixture')
            (folder / 'profile.json').write_text(json.dumps({'version': 1, 'voiceId': 'ara',
                'sha256': hashlib.sha256(reference.read_bytes()).hexdigest()}))
            self.assertEqual(profile('ara', root)[0], reference)
            reference.write_bytes(b'changed fixture')
            with self.assertRaisesRegex(ValueError, 'REFERENCE_CHANGED'):
                profile('ara', root)

    def test_missing_voice_does_not_select_another_voice(self):
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(ValueError, 'NOT_PREPARED'):
                profile('iris', Path(temporary))
