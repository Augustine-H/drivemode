"""Explicit free local A/B probe; no NAS writes or paid API calls."""
import argparse
import json
import os
from pathlib import Path
import shutil
import time
import httpx
import uuid

from provider import atomic_json
from worker_auth import worker_token

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--voices', nargs='+', default=['ara', 'eve'])
    parser.add_argument('--seeds', nargs='+', type=int, default=[1042, 2026])
    parser.add_argument('--baseline-job', help='Reuse an already submitted first baseline after an interrupted probe')
    parser.add_argument('--run', type=Path, help='Resume an existing probe without creating new job IDs')
    args = parser.parse_args()
    os.environ['LOCALAPPDATA'] = json.loads((ROOT / '.music-runtime/autostart/config.json').read_text())['localAppData']
    token = worker_token()

    def api(path, data=None):
        with httpx.Client(trust_env=False, timeout=30) as client:
            response = client.request('POST' if data is not None else 'GET',
                'http://127.0.0.1:8093' + path, json=data,
                headers={'Authorization': 'Bearer ' + token})
            response.raise_for_status()
            return response.json()

    run = args.run or ROOT / '.music-runtime/persona-singing-v1' / ('probe-' + uuid.uuid4().hex[:8])
    if not args.run:
        run.mkdir(parents=True, exist_ok=False)
    report = {'method': 'ace_step_reference_timbre', 'apiCostUsd': 0, 'results': [],
              'qualityVerified': False, 'speakerSimilarity': 'not-measured', 'output': str(run)}
    if (run / 'report.json').is_file():
        report = json.loads((run / 'report.json').read_text())
    print(str(run), flush=True)
    for seed in args.seeds:
        for voice in [None, *args.voices]:
            if any(r['voice'] == (voice or 'unconditioned') and r['seed'] == seed for r in report['results']):
                continue
            request = {'requestId': f'{run.name}-{voice or "unconditioned"}-{seed}', 'kind': 'song',
                'prompt': 'Warm Korean acoustic pop, solo female vocal, piano and gentle guitar, clear singing, 90 BPM',
                'lyrics': '[Verse]\n오늘도 너와 함께 걷고 싶어\n따뜻한 바람에 마음을 실어\n[Chorus]\n우리의 작은 노래가 빛나\n내일도 너의 곁에 있을게',
                'duration': 30, 'seed': seed, 'bitrate': 320, 'generationProvider': 'local'}
            if voice:
                request['singingVoice'] = voice
                request['singingMethod'] = 'ace_reference_experiment'
            started = time.perf_counter()
            if args.baseline_job and voice is None and seed == args.seeds[0]:
                job = api('/v1/jobs/' + args.baseline_job)
                for key in ('prompt', 'lyrics', 'duration', 'seed', 'kind'):
                    if job['request'][key] != request[key]:
                        raise ValueError('BASELINE_JOB_INPUT_MISMATCH')
            else:
                job = api('/v1/jobs', request)['job']
            atomic_json(run / 'active-job.json', {'jobId': job['id'], 'voice': voice, 'seed': seed})
            deadline = time.monotonic() + 300
            while job['state'] not in {'COMPLETED', 'FAILED', 'INTERRUPTED', 'CANCELLED'}:
                if time.monotonic() > deadline:
                    raise TimeoutError('PERSONA_PROBE_TIMEOUT_NO_RESUBMISSION')
                time.sleep(1)
                job = api('/v1/jobs/' + job['id'])
            entry = {'voice': voice or 'unconditioned', 'seed': seed, 'jobId': job['id'],
                     'state': job['state'], 'elapsedSeconds': round(time.perf_counter() - started, 3),
                     'model': job.get('model'), 'metrics': job.get('metrics'), 'error': job.get('error')}
            if job['state'] == 'COMPLETED':
                destination = run / f'{voice or "unconditioned"}-{seed}'
                destination.mkdir()
                for name in ('original.wav', 'preview.mp3'):
                    shutil.copy2(ROOT / '.music-runtime/worker/audio' / job['id'] / name, destination / name)
                entry['output'] = str(destination)
            report['results'].append(entry)
            atomic_json(run / 'report.json', report)
            print(json.dumps(entry, ensure_ascii=False), flush=True)
            if job['state'] != 'COMPLETED':
                raise RuntimeError('PERSONA_PROBE_FAILED_NO_FALLBACK')


if __name__ == '__main__':
    main()
