import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch, MagicMock
import httpx
from pydantic import ValidationError
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api_common import GenerateRequest
from paid_generation import generate, payload, PaidGenerationError

def request(**extra):
    return dict(requestId='generation-test', prompt='piano pop', duration=30, seed=42,
                generationProvider='elevenlabs', paidGenerationConsent=True, **extra)

class PaidGenerationTests(unittest.TestCase):
    def test_contract_requires_explicit_consent(self):
        self.assertEqual(GenerateRequest(**request()).generationProvider, 'elevenlabs')
        for change in [dict(paidGenerationConsent=False),dict(duration=1),dict(generationProvider='local'),dict(kind='recognition')]:
            with self.assertRaises(ValidationError): GenerateRequest(**(request() | change))
        self.assertIsNone(GenerateRequest(requestId='local',prompt='piano',duration=30).generationProvider)

    def test_payload_instrumental_and_exact_lyrics_plan(self):
        instrumental=payload(request())
        self.assertTrue(instrumental['force_instrumental'])
        self.assertNotIn('seed',instrumental)
        song=payload(request(kind='song',lyrics='[Verse]\n새로운 아침'))
        self.assertNotIn('prompt',song)
        self.assertNotIn('music_length_ms',song)
        self.assertEqual(song['composition_plan']['chunks'][0]['duration_ms'],30000)
        self.assertEqual(song['composition_plan']['chunks'][0]['text'],'[Verse]\n새로운 아침')

    def test_failure_is_single_attempt_and_sanitized(self):
        with tempfile.TemporaryDirectory() as name, patch('paid_generation.load',return_value='private-key'):
            client=MagicMock()
            response=MagicMock(status_code=403,is_success=False)
            client.stream.return_value.__enter__.return_value=response
            with patch('paid_generation.httpx.Client') as factory:
                factory.return_value.__enter__.return_value=client
                with self.assertRaisesRegex(PaidGenerationError,'HTTP_403') as caught:
                    generate(request(),Path(name))
                self.assertNotIn('private-key',str(caught.exception))
                with self.assertRaisesRegex(PaidGenerationError,'ALREADY_ATTEMPTED'):
                    generate(request(),Path(name))
                self.assertEqual(client.stream.call_count,1)
            self.assertEqual(json.loads((Path(name)/'paid-generation-call.json').read_text())['state'],'FAILED')

    def test_cancel_and_consent_do_not_call(self):
        with tempfile.TemporaryDirectory() as name, patch('paid_generation.load',return_value='private-key'), patch('paid_generation.httpx.Client') as client:
            with self.assertRaises(PaidGenerationError): generate(request() | {'paidGenerationConsent':False},Path(name))
            with self.assertRaisesRegex(PaidGenerationError,'CANCELLED_BEFORE_CALL'): generate(request(),Path(name),lambda: True)
            client.assert_not_called()

    def test_free_plan_error_is_actionable_without_secret_logging(self):
        with tempfile.TemporaryDirectory() as name, patch('paid_generation.load',return_value='private-key'), patch('paid_generation.httpx.Client') as factory:
            response=MagicMock(status_code=402,is_success=False)
            response.json.return_value={'detail':{'status':'limited_access','message':'Music API is not available for free users. private-key piano pop'}}
            factory.return_value.__enter__.return_value.stream.return_value.__enter__.return_value=response
            with self.assertRaisesRegex(PaidGenerationError,'requires a paid plan'):
                generate(request(),Path(name))
            stored=(Path(name)/'paid-generation-call.json').read_text()
            self.assertNotIn('private-key',stored)
            self.assertNotIn('piano pop',stored)
            self.assertEqual(json.loads(stored)['providerErrorCode'],'limited_access')

    def test_timeout_never_retries(self):
        with tempfile.TemporaryDirectory() as name, patch('paid_generation.load',return_value='private-key'), patch('paid_generation.httpx.Client') as factory:
            client=factory.return_value.__enter__.return_value
            client.stream.side_effect=httpx.ReadTimeout('private-key')
            with self.assertRaisesRegex(PaidGenerationError,'OUTCOME_UNKNOWN_NO_RETRY'):
                generate(request(),Path(name))
            self.assertEqual(client.stream.call_count,1)

    def test_real_audio_decode_pipeline_with_mock_http(self):
        import numpy as np
        from provider import save_audio, encode_mp3, verify_audio_file
        with tempfile.TemporaryDirectory() as name, patch('paid_generation.load',return_value='private-key'):
            root=Path(name)
            frames=np.arange(441000)
            signal=(.1*np.sin(frames*2*np.pi*440/44100)).astype('float32')
            save_audio(np.stack([signal,signal],axis=1),44100,root/'fixture.wav')
            encode_mp3(root/'fixture.wav',root/'fixture.mp3',128)
            response=MagicMock(status_code=200,is_success=True)
            response.iter_bytes.return_value=[(root/'fixture.mp3').read_bytes()]
            with patch('paid_generation.httpx.Client') as factory:
                factory.return_value.__enter__.return_value.stream.return_value.__enter__.return_value=response
                wav,record=generate(request() | {'duration':10},root/'job')
            self.assertAlmostEqual(wav['duration'],10,places=2)
            self.assertTrue(verify_audio_file(root/'job/original.wav')['verified'])
            self.assertEqual(record['wavSource'],'decoded-from-provider-mp3')
            self.assertEqual((root/'job/provider-original.mp3').read_bytes(),(root/'fixture.mp3').read_bytes())
            self.assertEqual(record['state'],'COMPLETED')

    def test_paid_failure_does_not_poison_gpu_worker(self):
        from worker import MusicWorker
        import time
        with tempfile.TemporaryDirectory() as name:
            worker=MusicWorker(Path(name)/'worker',lock_path=Path(name)/'test.lock',min_free_bytes=0)
            worker.start()
            try:
                with patch('paid_generation.generate',side_effect=PaidGenerationError('PAID_GENERATION_HTTP_403')):
                    j,_=worker.submit(request(kind='song',lyrics='새로운 아침'))
                    deadline=time.monotonic()+5
                    while worker.store.get(j['id'])['state'] not in ['COMPLETED','FAILED']:
                        if time.monotonic()>deadline: self.fail('Worker timeout')
                        time.sleep(.03)
                self.assertEqual(worker.store.get(j['id'])['state'],'FAILED')
                self.assertTrue(worker.health()['acceptingJobs'])
                self.assertIsNone(worker.error)
            finally: worker.close()

    def test_duration_failure_preserves_response_and_blocks_repeat(self):
        from provider import file_hash
        with tempfile.TemporaryDirectory() as name, patch('paid_generation.load',return_value='private-key'), patch('paid_generation.httpx.Client') as factory:
            folder=Path(name)
            response=MagicMock(status_code=200,is_success=True)
            response.iter_bytes.return_value=[b'complete-response']
            client=factory.return_value.__enter__.return_value
            client.stream.return_value.__enter__.return_value=response
            with patch('paid_generation.subprocess.run',return_value=MagicMock(returncode=0)), patch('paid_generation.verify_audio_file',return_value={'duration':119.5,'verified':True}) as verify:
                with self.assertRaisesRegex(PaidGenerationError,'DURATION_MISMATCH'):
                    generate(request() | {'duration':120},folder)
            self.assertEqual(verify.call_args.args[0],folder/'provider-decoded.wav')
            stored=json.loads((folder/'paid-generation-call.json').read_text())
            self.assertEqual(stored['state'],'FAILED')
            self.assertEqual(stored['decodedAudio']['duration'],119.5)
            self.assertEqual(stored['durationDeltaSeconds'],-.5)
            self.assertEqual(stored['sourceMp3Sha256'],file_hash(folder/'provider-original.mp3'))
            self.assertEqual((folder/'provider-original.mp3').read_bytes(),b'complete-response')
            self.assertFalse((folder/'original.wav').exists())
            with self.assertRaisesRegex(PaidGenerationError,'ALREADY_ATTEMPTED'):
                generate(request() | {'duration':120},folder)
            self.assertEqual(client.stream.call_count,1)

    def test_invalid_complete_audio_is_preserved_but_partial_stream_is_not(self):
        for partial in [False,True]:
            with self.subTest(partial=partial), tempfile.TemporaryDirectory() as name, patch('paid_generation.load',return_value='private-key'), patch('paid_generation.httpx.Client') as factory:
                folder=Path(name)
                def stream():
                    yield b'invalid-audio'
                    if partial: raise httpx.ReadTimeout('private-key')
                response=MagicMock(status_code=200,is_success=True)
                response.iter_bytes.return_value=stream()
                factory.return_value.__enter__.return_value.stream.return_value.__enter__.return_value=response
                with patch('paid_generation.subprocess.run',return_value=MagicMock(returncode=0)), patch('paid_generation.verify_audio_file',side_effect=RuntimeError('invalid audio')):
                    with self.assertRaises(RuntimeError): generate(request(),folder)
                self.assertEqual((folder/'provider-original.mp3').exists(),not partial)
                self.assertFalse((folder/'provider.partial.mp3').exists())
                stored=json.loads((folder/'paid-generation-call.json').read_text())
                self.assertEqual(stored['state'],'FAILED')
                self.assertNotIn('private-key',json.dumps(stored))
