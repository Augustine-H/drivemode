"""Offline pilot training. Pause only an idle Worker and restore it in finally."""
import argparse
import json
import hashlib
import os
import re
from pathlib import Path
import subprocess
import sys
import time

import httpx
import psutil
from filelock import FileLock
from provider import atomic_json
from worker_auth import local_directory, worker_token

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / '.music-runtime/persona-singing-v1'
REPO = RUNTIME / 'rvc'
PYTHON = RUNTIME / 'rvc-venv/Scripts/python.exe'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--voice', choices=['ara', 'eve'], required=True)
    parser.add_argument('--epochs', type=int, default=40)
    parser.add_argument('--batch-size', type=int, choices=[2, 4, 8], default=4)
    parser.add_argument('--experiment-suffix', default='', help='Separate local pilot; safe lowercase label only')
    parser.add_argument('--loader-workers', type=int, choices=[0, 1, 4], default=4)
    args = parser.parse_args()
    if not 1 <= args.epochs <= 100:
        raise ValueError('INVALID_PILOT_EPOCHS')
    if args.experiment_suffix and not re.fullmatch(r'[a-z][a-z0-9-]{0,23}', args.experiment_suffix):
        raise ValueError('INVALID_EXPERIMENT_SUFFIX')
    if subprocess.check_output(['git', '-C', str(REPO), 'rev-parse', 'HEAD'], text=True).strip() != '81eed5e8f68b6bed1789f682fe78cdd324495afc':
        raise ValueError('RVC_SOURCE_CHANGED')
    os.environ['LOCALAPPDATA'] = json.loads((ROOT / '.music-runtime/autostart/config.json').read_text())['localAppData']
    environment = os.environ.copy()
    environment.update(PYTHONUTF8='1', PYTHONUNBUFFERED='1', HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1',
                       RVC_CUDA_GRAPH='0', RVC_AUDIO_FORCE_CPU='1', PYTHONPATH=str(REPO),
                       OMP_NUM_THREADS='4', MKL_NUM_THREADS='4')
    environment['PATH'] = str(RUNTIME/'rvc-tools') + os.pathsep + environment['PATH']
    environment['RVC_TRAIN_LOADER_WORKERS'] = str(args.loader_workers)
    name = 'persona-' + args.voice + '-20261010'
    if args.experiment_suffix:
        name += '-' + args.experiment_suffix
    exp = REPO / 'logs' / name
    files = list((exp/'0_gt_wavs').glob('*.wav'))
    if not files or not (exp/'config.json').is_file():
        raise RuntimeError('PREPROCESSED_DATA_REQUIRED')
    import soundfile as sf
    seconds = sum(sf.info(p).duration for p in files)
    if seconds < 600:
        raise RuntimeError('PREPROCESSED_TRAINING_DATA_BELOW_600_SECONDS')
    manifest = json.loads((RUNTIME/'rvc-training-models.json').read_text())
    for entry in manifest['files']:
        if hashlib.sha256((REPO/entry['file']).read_bytes()).hexdigest() != entry['sha256']:
            raise RuntimeError('PRETRAINED_MODEL_CHANGED')
    status = {'voiceId': args.voice, 'epochs': args.epochs, 'batchSize': args.batch_size,
              'experiment': name,
              'loaderWorkers': args.loader_workers,
              'preprocessedSeconds': round(seconds, 3), 'state': 'STARTING', 'apiCostUsd': 0,
              'stageSeconds': {}}
    report = exp/'pilot-status.json'
    with httpx.Client(base_url='http://127.0.0.1:8093', headers={'Authorization':'Bearer '+worker_token()}, trust_env=False) as client:
        response = client.get('/health'); response.raise_for_status(); health = response.json()
        if health.get('activeJobId') or health.get('queue', {}).get('QUEUED', 0):
            raise RuntimeError('WORKER_BUSY_TRAINING_NOT_STARTED')
    workers = []
    for process in psutil.process_iter(['pid','ppid','cmdline']):
        command = process.info['cmdline'] or []
        if any(Path(arg).resolve() == ROOT/'services/music/worker_api.py' for arg in command[1:] if arg.endswith('worker_api.py')):
            workers.append(process)
    ids = {p.pid for p in workers}
    roots = [p for p in workers if p.ppid() not in ids]
    if len(roots) != 1:
        raise RuntimeError('WORKER_PROCESS_IDENTITY_UNCLEAR')
    stopped = False
    started = time.perf_counter()
    try:
        subprocess.run(['taskkill','/PID',str(roots[0].pid),'/T','/F'],check=True,capture_output=True)
        stopped = True
        with FileLock(str(local_directory()/'gpu-worker.lock'), timeout=20):
            def stage(label, arguments, timeout=1800):
                status.update(state=label); atomic_json(report,status)
                stage_started = time.perf_counter()
                with (exp/(label+'.log')).open('ab') as log:
                    child = subprocess.Popen([str(PYTHON),*arguments],cwd=REPO,env=environment,stdout=log,stderr=subprocess.STDOUT)
                    try:
                        code = child.wait(timeout=timeout)
                    except subprocess.TimeoutExpired:
                        subprocess.run(['taskkill','/PID',str(child.pid),'/T','/F'],capture_output=True)
                        child.wait()
                        raise RuntimeError(label+'_TIMEOUT')
                    except BaseException:
                        subprocess.run(['taskkill','/PID',str(child.pid),'/T','/F'],capture_output=True)
                        child.wait()
                        raise
                    if code:
                        raise RuntimeError(label+'_EXIT_'+str(code))
                status['stageSeconds'][label] = round(time.perf_counter()-stage_started, 3)
                atomic_json(report,status)
            stage('F0', ['-m','train.dataset.extract_f0','cuda','1','0','0',str(exp),'True'])
            stage('HUBERT', ['-m','train.dataset.extract_hubert_feature','cuda','1','0','0',str(exp),'v2','True'])
            rows = []
            for wav in sorted(files):
                paths = [wav,exp/'3_feature768'/(wav.stem+'.npy'),exp/'2a_f0'/(wav.name+'.npy'),exp/'2b-f0nsf'/(wav.name+'.npy')]
                if not all(p.is_file() for p in paths):
                    raise RuntimeError('MISSING_EXTRACTED_FEATURE:'+wav.name)
                rows.append('|'.join(str(p).replace('\\','/') for p in paths)+'|0')
            (exp/'filelist.txt').write_text('\n'.join(rows),encoding='utf8')
            entrypoint = ['-m', 'train.train'] if args.loader_workers == 4 else [str(ROOT/'services/music/rvc_train_runtime.py')]
            stage('TRAIN', [*entrypoint,'-e',name,'-sr','40k','-f0','1','-bs',str(args.batch_size),'-g','0',
                '-te',str(args.epochs),'-se','10','-pg','pretrained_v2/f0G40k.pth','-pd','pretrained_v2/f0D40k.pth',
                '-l','1','-c','0','-sw','1','-v','v2'],timeout=3600)
            model = REPO/'assets/weights'/(name+'.pth')
            if not model.is_file():
                raise RuntimeError('TRAINING_DID_NOT_EXPORT_MODEL')
            import torch
            exported = torch.load(model, map_location='cpu', weights_only=True)
            if exported.get('info') != str(args.epochs) + 'epoch':
                raise RuntimeError('EXPORTED_MODEL_EPOCH_MISMATCH')
            stage('INDEX', ['-m','train.train_index',name,'v2',str(exp/'index-links'),'2'])
            status.update(state='TRAINED_REQUIRES_SINGING_EVALUATION',model=str(model),trainingFiles=len(rows))
    except Exception as error:
        status.update(state='FAILED',error=str(error))
        raise
    finally:
        status['elapsedSeconds'] = round(time.perf_counter()-started,3)
        if stopped:
            restored = subprocess.run([str(ROOT/'.music-runtime/venv/Scripts/python.exe'),str(ROOT/'services/music/autostart.py')],cwd=ROOT,capture_output=True)
            status['workerRestoreExitCode'] = restored.returncode
        atomic_json(report,status)
        with (exp/'pilot-history.jsonl').open('a', encoding='utf8') as history:
            history.write(json.dumps(status)+'\n')
        print(json.dumps(status),flush=True)


if __name__ == '__main__':
    main()
