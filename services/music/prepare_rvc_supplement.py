"""Prepare an isolated pronunciation pilot, preserving base and held-out audio."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess

from provider import atomic_json, file_hash

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / '.music-runtime/persona-singing-v1'
REPO = RUNTIME / 'rvc'
DATA = Path('I:/Grok/페르소나음성')
REVISION = '81eed5e8f68b6bed1789f682fe78cdd324495afc'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--voice', choices=['ara', 'eve'], required=True)
    args = parser.parse_args()
    if subprocess.check_output(['git', '-C', str(REPO), 'rev-parse', 'HEAD'], text=True).strip() != REVISION:
        raise ValueError('RVC_SOURCE_CHANGED')
    corpus = DATA / '발음보강_v1'
    import hashlib
    text_hash = hashlib.sha256((corpus/'학습용_대본.txt').read_text(encoding='utf8').strip().encode()).hexdigest()
    eval_hash = hashlib.sha256((corpus/'평가용_대본.txt').read_text(encoding='utf8').strip().encode()).hexdigest()
    if text_hash == eval_hash:
        raise ValueError('TRAIN_EVAL_IDENTICAL')
    ledger = json.loads((DATA/'xai-budget-ledger.json').read_text(encoding='utf8'))
    rows = [r for r in ledger['requests'] if r['voiceId'] == args.voice and r['textSha256'] == text_hash]
    if len(rows) != 1 or rows[0]['state'] != 'COMPLETED':
        raise ValueError('SUPPLEMENT_AUDIO_NOT_VERIFIED')
    name = {'ara':'아라', 'eve':'서연'}[args.voice]
    audio = DATA/name/'xai-training'/(text_hash[:16]+'.wav')
    if file_hash(audio) != rows[0]['outputSha256']:
        raise ValueError('SUPPLEMENT_AUDIO_CHANGED')
    source = REPO/'logs'/('persona-'+args.voice+'-20261010')
    target = REPO/'logs'/(source.name+'-suppfix60')
    if target.exists():
        raise ValueError('SUPPLEMENT_EXPERIMENT_ALREADY_EXISTS')
    import torch
    for filename in ('G_2333333.pth', 'D_2333333.pth'):
        checkpoint = torch.load(source/filename, map_location='cpu', weights_only=True, mmap=True)
        if checkpoint['iteration'] != 40:
            raise ValueError('BASE_CHECKPOINT_NOT_EPOCH40')
        del checkpoint
    target.mkdir()
    for filename in ('config.json','G_2333333.pth','D_2333333.pth'):
        shutil.copyfile(source/filename, target/filename)
    prep = target/'supplement-preprocessing'
    inp = prep/'input'; inp.mkdir(parents=True)
    base = RUNTIME/'rvc-datasets'/args.voice
    split = json.loads((base/'provenance.json').read_text(encoding='utf8'))['split']['train.wav']
    if file_hash(base/'train.wav') != split['sha256']:
        raise ValueError('BASE_TRAIN_AUDIO_CHANGED')
    shutil.copyfile(base/'train.wav', inp/'base.wav')
    shutil.copyfile(audio, inp/'supplement.wav')
    env = os.environ.copy()
    env.update(PYTHONUTF8='1', PYTHONUNBUFFERED='1', RVC_AUDIO_FORCE_CPU='1',
               PYTHONPATH=str(REPO), OMP_NUM_THREADS='4', MKL_NUM_THREADS='4')
    env['PATH'] = str(RUNTIME/'rvc-tools') + os.pathsep + env['PATH']
    with (prep/'stage.log').open('xb') as log:
        result = subprocess.run([str(RUNTIME/'rvc-venv/Scripts/python.exe'), str(ROOT/'services/music/rvc_preprocess_runtime.py'),
            str(inp),'40000','1',str(prep),'True','3.7'], cwd=REPO, env=env,
            stdout=log, stderr=subprocess.STDOUT, timeout=300)
    if result.returncode:
        raise RuntimeError('SUPPLEMENT_PREPROCESS_FAILED')
    import soundfile as sf
    new = list((prep/'0_gt_wavs').glob('*.wav'))
    if not new:
        raise ValueError('SUPPLEMENT_PREPROCESS_EMPTY')
    import numpy as np
    durations = {}
    for path in new:
        pcm, rate = sf.read(path, dtype='float32')
        if not len(pcm) or rate != 40000 or not np.isfinite(pcm).all() or not np.any(pcm):
            raise ValueError('INVALID_PREPROCESSED_AUDIO')
        key = 'base' if path.name.startswith('0_') else 'supplement'
        durations[key] = durations.get(key, 0) + len(pcm)/rate
        for folder in ('0_gt_wavs','1_16k_wavs'):
            original = prep/folder/path.name
            if not original.is_file():
                raise ValueError('SUPPLEMENT_PAIR_MISSING')
            (target/folder).mkdir(exist_ok=True)
            shutil.copyfile(original, target/folder/path.name)
    if durations.get('supplement', 0) < rows[0]['seconds'] * .5 or durations.get('base', 0) < 600:
        raise ValueError('PREPROCESS_RETENTION_BELOW_PILOT_MINIMUM')
    provenance = {'voiceId':args.voice, 'sourceExperiment':str(source), 'resumeIteration':40,
        'targetNominalEpochs':50, 'supplementAudio':str(audio), 'supplementSha256':file_hash(audio),
        'supplementRawSeconds':rows[0]['seconds'], 'totalChunks':len(new),
        'preprocessedChunkSeconds':durations, 'baseRawSeconds':split['seconds'],
        'preprocessingAdapter':'rvc_preprocess_runtime.py; retain all utterance tails',
        'trainingTextSha256':text_hash, 'evaluationTextSha256':eval_hash,
        'heldoutIncluded':False, 'evaluationIncluded':False, 'duplicatesAdded':False,
        'sourceCheckpointSha256':{n:file_hash(source/n) for n in ('G_2333333.pth','D_2333333.pth')},
        'limitation':'Chunk overlap is not unique audio duration; speech supplementation plus preprocessing correction.'}
    atomic_json(target/'resume-provenance.json', provenance)
    print(json.dumps(provenance), flush=True)


if __name__ == '__main__':
    main()
