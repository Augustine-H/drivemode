import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
import numpy as np
import soundfile as sf
from provider import file_hash
from singing_training_manifest import audit


class SingingCollectionTests(unittest.TestCase):
    def test_distinct_reviewed_collection_is_reported_without_launching_training(self):
        with TemporaryDirectory() as directory:
            root=Path(directory);records=[]
            for i,role in enumerate(('train','evaluation')):
                wav=root/f'{i}.wav'
                sf.write(wav,.1*np.sin(np.arange(64000)*(.02+i*.01)),16000,subtype='FLOAT')
                records.append({'id':str(i),'file':wav.name,'sha256':file_hash(wav),
                    'origin':'native_persona_singing','role':role,'phraseMelodyFamily':role,
                    'lyrics':'연습','humanReview':{'pronunciation':True,'personaIdentity':True,
                    'cleanVocal':True,'feedback':'Fixture approval only.'}})
            plan=root/'plan.json';plan.write_text('{}')
            manifest=root/'manifest.json';manifest.write_text(json.dumps({'schemaVersion':1,'voiceId':'ara','records':records}))
            result=audit(manifest,plan)
            self.assertEqual(result['eligibleCounts'],{'train':1,'evaluation':1})
            self.assertTrue(result['hasReviewedTrainingAndHeldoutData'])
            self.assertFalse(result['trainingStarted'])

    def test_missing_human_review_and_reserved_audio_cannot_be_accepted(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            wav = root/'candidate.wav'
            sf.write(wav, .1*np.sin(np.arange(64000)*.02), 16000, subtype='FLOAT')
            plan = root/'plan.json'
            plan.write_text(json.dumps({'evaluationReservedFiles':[str(wav)]}))
            manifest = root/'manifest.json'
            manifest.write_text(json.dumps({'schemaVersion':1,'voiceId':'ara','records':[{
                'id':'a','file':'candidate.wav','sha256':file_hash(wav),'origin':'synthetic_persona_singing',
                'role':'train','phraseMelodyFamily':'a','lyrics':'연습','generationProvenance':'fixture'}]}))
            report = audit(manifest, plan)
            self.assertEqual(report['eligibleCounts']['train'], 0)
            self.assertIn('HUMAN_REVIEW_INCOMPLETE',report['records'][0]['errors'])
            self.assertIn('RESERVED_EVALUATION_AUDIO',report['records'][0]['errors'])
            self.assertFalse(report['trainingStarted'])

    def test_review_does_not_allow_split_leakage_or_container_duplicates(self):
        with TemporaryDirectory() as directory:
            root=Path(directory)
            pcm=.1*np.sin(np.arange(64000)*.02)
            records=[]
            for i,role in enumerate(('train','evaluation')):
                wav=root/f'{i}.wav'
                sf.write(wav,pcm,16000,subtype='FLOAT',format='WAV' if i==0 else 'WAVEX')
                records.append({'id':str(i),'file':wav.name,'sha256':file_hash(wav),
                    'origin':'native_persona_singing','role':role,'phraseMelodyFamily':'shared',
                    'lyrics':'연습','humanReview':{'pronunciation':True,'personaIdentity':True,
                    'cleanVocal':True,'feedback':'Test fixture only, no real approval.'}})
            plan=root/'plan.json';plan.write_text('{}')
            manifest=root/'manifest.json';manifest.write_text(json.dumps({'schemaVersion':1,'voiceId':'eve','records':records}))
            report=audit(manifest,plan)
            self.assertFalse(report['hasReviewedTrainingAndHeldoutData'])
            for row in report['records']:
                self.assertIn('PHRASE_MELODY_FAMILY_LEAKAGE',row['errors'])
                self.assertIn('DUPLICATE_DECODED_AUDIO',row['errors'])


if __name__ == '__main__':
    unittest.main()
