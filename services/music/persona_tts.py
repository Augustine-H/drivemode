"""One explicitly requested TTS call, with a durable character budget reservation."""
import argparse
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import time

import httpx
from filelock import FileLock

from paid_credentials import load
from provider import atomic_json

ROOT = Path(__file__).resolve().parents[2]
DATA = Path('I:/Grok/페르소나음성')
VOICES = {'ara': '아라', 'eve': '서연', 'luna': '혜정', 'aurora': '나경', 'carina': '알리나', 'iris': '그록'}


def validate_budget(ledger, characters):
    if ledger.get('approvedTotalUsd') != 1 or ledger.get('approvalDate') != '2026-10-10':
        raise RuntimeError('BUDGET_NOT_APPROVED')
    if not isinstance(characters, int) or not 1 <= characters <= 60000:
        raise ValueError('INVALID_CORPUS_LENGTH')
    count = sum(entry['inputCharacters'] for entry in ledger['requests']) + characters
    if Decimal(count) * Decimal('0.000015') > Decimal('1'):
        raise RuntimeError('APPROVED_CHARACTER_BUDGET_EXCEEDED')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--voice', choices=VOICES, required=True)
    parser.add_argument('--corpus', type=Path, required=True)
    args = parser.parse_args()
    os.environ['LOCALAPPDATA'] = json.loads((ROOT / '.music-runtime/autostart/config.json').read_text())['localAppData']
    text = args.corpus.read_text(encoding='utf8').strip()
    if not 1 <= len(text) <= 60000:
        raise ValueError('INVALID_CORPUS_LENGTH')
    key = load('xai')
    if not key:
        raise RuntimeError('XAI_CREDENTIAL_MISSING')
    digest = hashlib.sha256(text.encode()).hexdigest()
    folder = DATA / VOICES[args.voice] / 'xai-training'
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / (digest[:16] + '.wav')
    ledger_path = DATA / 'xai-budget-ledger.json'
    with FileLock(str(ledger_path.with_suffix('.lock')), timeout=0):
        ledger = json.loads(ledger_path.read_text())
        validate_budget(ledger, len(text))
        for entry in ledger['requests']:
            if entry['voiceId'] == args.voice and entry['textSha256'] == digest:
                if entry['state'] == 'COMPLETED' and output.is_file():
                    print('ALREADY_GENERATED', args.voice)
                    return
                raise RuntimeError('PRIOR_REQUEST_FAILED_OR_AMBIGUOUS_NO_AUTOMATIC_RETRY')
        entry = {'voiceId': args.voice, 'inputCharacters': len(text), 'textSha256': digest,
                 'state': 'RESERVED', 'estimatedUsd': float(Decimal(len(text)) * Decimal('0.000015'))}
        ledger['requests'].append(entry)
        atomic_json(ledger_path, ledger)  # Failed/ambiguous calls remain charged to this cap.
        (folder / (digest[:16] + '.txt')).write_text(text, encoding='utf8')
        started = time.perf_counter()
        temporary = output.with_suffix('.partial.wav')
        try:
            with httpx.Client(timeout=httpx.Timeout(600, connect=30), trust_env=False, follow_redirects=False) as client:
                with client.stream('POST', 'https://api.x.ai/v1/tts',
                    headers={'Authorization': 'Bearer ' + key},
                    json={'text': text, 'voice_id': args.voice, 'language': 'ko',
                          'output_format': {'codec': 'wav', 'sample_rate': 44100}}) as response:
                    if response.status_code != 200:
                        entry['httpStatus'] = response.status_code
                        raise RuntimeError('XAI_TTS_HTTP_' + str(response.status_code))
                    size = 0
                    with temporary.open('xb') as handle:
                        for block in response.iter_bytes(65536):
                            size += len(block)
                            if size > 256 * 2**20:
                                raise RuntimeError('TTS_OUTPUT_SIZE_LIMIT')
                            handle.write(block)
            import soundfile as sf
            import numpy as np
            pcm, rate = sf.read(temporary, dtype='float32')
            if not len(pcm) or not np.isfinite(pcm).all() or not np.any(pcm):
                raise RuntimeError('INVALID_TTS_AUDIO')
            temporary.replace(output)
            entry.update(state='COMPLETED', seconds=len(pcm)/rate, sampleRate=rate,
                         outputSha256=hashlib.sha256(output.read_bytes()).hexdigest())
        except Exception as error:
            entry.update(state='FAILED_OR_AMBIGUOUS', errorType=type(error).__name__)
            raise
        finally:
            entry['elapsedSeconds'] = round(time.perf_counter()-started, 3)
            atomic_json(ledger_path, ledger)
            print(json.dumps(entry, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
