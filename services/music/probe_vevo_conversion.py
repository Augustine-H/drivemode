"""Pinned, offline Vevo 1.5 FM-only SVC comparison; not a queue provider."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / '.music-runtime/persona-singing-v1'
COMMIT = '26f6883110181f1dbfe95c70a7c7dbaf4de5f42a'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    repository = RUNTIME / 'amphion-vevo'
    if subprocess.check_output(['git', '-C', str(repository), 'rev-parse', 'HEAD'], text=True).strip() != COMMIT:
        raise ValueError('VEVO_SOURCE_REVISION_CHANGED')
    manifest = json.loads((RUNTIME / 'vevo-model.json').read_text())
    if manifest['revision'] != 'f4053ca0d8badb57dffdce44eac97c08b7f6f922':
        raise ValueError('VEVO_MODEL_REVISION_CHANGED')
    whisper_manifest = json.loads((RUNTIME / 'vevo-whisper.json').read_text())
    os.environ['LOCALAPPDATA'] = json.loads((ROOT / '.music-runtime/autostart/config.json').read_text())['localAppData']
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1')
    sys.path[:0] = [str(RUNTIME / 'vevo-deps'), str(RUNTIME / 'seed-deps'), str(repository)]
    import numpy as np
    import soundfile as sf
    import torch
    import whisper
    from safetensors.torch import load_file
    from filelock import FileLock
    from worker_auth import local_directory
    from provider import atomic_json, file_hash
    from benchmark import ResourceMonitor
    from singing_voice import profile
    from models.svc.vevosing import vevosing_utils as vevo

    if not torch.cuda.is_available():
        raise RuntimeError('CUDA_NOT_AVAILABLE')
    source = args.source.resolve()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    source_info = sf.info(source)
    if not 0 < source_info.duration <= 30.01:
        raise ValueError('VEVO_WHISPER_MAX_DURATION_30_SECONDS')
    for row in manifest['files']:
        if file_hash(Path(row['path'])) != row['sha256']:
            raise ValueError('VEVO_CHECKPOINT_HASH_MISMATCH')
    if file_hash(Path(whisper_manifest['path'])) != whisper_manifest['sha256']:
        raise ValueError('WHISPER_CHECKPOINT_HASH_MISMATCH')
    # Keep the upstream inference math. Validate every active weight/buffer before
    # its official Accelerate loader, which ignores training-only checkpoint keys.
    audits = []
    def checked_load(builder, cfg, path, device):
        model = builder(cfg, device)
        saved = load_file(str(Path(path) / 'model.safetensors'), device='cpu')
        expected = model.state_dict()
        invalid = [key for key, value in expected.items()
                   if key not in saved or saved[key].shape != value.shape]
        if invalid:
            raise ValueError('VEVO_ACTIVE_STATE_MISMATCH:' + ','.join(invalid[:8]))
        audits.append({'builder': builder.__name__, 'matchedActiveStateKeys': len(expected),
                       'unusedCheckpointKeys': sorted(set(saved) - set(expected))})
        del saved
        vevo.accelerate.load_checkpoint_and_dispatch(model, path)
        return model
    vevo.load_checkpoint = checked_load
    original_whisper_load = whisper.load_model
    def local_whisper(name, device, **options):
        if name != 'medium':
            raise ValueError('UNPREPARED_WHISPER_MODEL')
        return original_whisper_load(whisper_manifest['path'], device=device, **options)
    whisper.load_model = local_whisper
    torch.set_num_threads(4)
    torch.cuda.reset_peak_memory_stats()
    os.chdir(repository)
    started = time.perf_counter()
    weights = Path(manifest['path'])
    report = {'state': 'RUNNING', 'apiCostUsd': 0, 'offline': True, 'results': [],
              'sourceSha256': file_hash(source), 'sourceRevision': COMMIT,
              'model': manifest, 'whisper': whisper_manifest, 'qualityVerified': False,
              'parameters': {'flowMatchingSteps': 32, 'seed': 1042,
                             'shiftedProsody': False, 'shiftedContentStyle': False,
                             'whisperSpecPerturb': False, 'precision': 'upstream-fp32'}}
    try:
        with FileLock(str(local_directory() / 'gpu-worker.lock'), timeout=0), ResourceMonitor() as monitor:
            torch.manual_seed(1042)
            pipeline = vevo.VevosingInferencePipeline(
                content_style_tokenizer_ckpt_path=str(weights / 'tokenizer/contentstyle_fvq16384_12.5hz'),
                fmt_cfg_path='models/svc/vevosing/config/fm_emilia101k_singnet7k.json',
                fmt_ckpt_path=str(weights / 'acoustic_modeling/fm_emilia101k_singnet7k'),
                vocoder_cfg_path='models/svc/vevosing/config/vocoder.json',
                vocoder_ckpt_path=str(weights / 'acoustic_modeling/Vocoder'),
                device=torch.device('cuda'))
            report['modelLoadingSeconds'] = round(time.perf_counter() - started, 3)
            report['checkpointAudits'] = audits
            for voice in ('ara', 'eve'):
                reference, data = profile(voice)
                folder = output / voice
                folder.mkdir()
                torch.manual_seed(1042)
                inference_started = time.perf_counter()
                with torch.inference_mode():
                    waveform = pipeline.inference_fm(
                        src_wav_path=str(source), timbre_ref_wav_path=str(reference),
                        use_shifted_src_to_extract_prosody=False,
                        use_shifted_src_to_extract_contentstyle=False,
                        flow_matching_steps=32, display_audio=False)
                pcm = waveform.float().cpu().numpy().reshape(-1)
                if not np.isfinite(pcm).all() or np.sqrt(np.mean(pcm.astype('float64') ** 2)) < 1e-6:
                    raise ValueError('INVALID_VEVO_AUDIO')
                if abs(len(pcm) / 24000 - source_info.duration) > .05:
                    raise ValueError('VEVO_CONVERSION_DURATION_MISMATCH')
                sf.write(folder / 'vc_vocals.wav', pcm, 24000, subtype='PCM_24')
                result = {'voiceId': voice, 'referenceSha256': data['sha256'],
                          'sourceSha256': report['sourceSha256'], 'qualityVerified': False,
                          'inferenceSeconds': round(time.perf_counter()-inference_started, 3),
                          'durationSeconds': len(pcm)/24000, 'sampleRate': 24000,
                          'parameters': report['parameters']}
                atomic_json(folder / 'conversion.json', result)
                report['results'].append(result)
                atomic_json(output / 'conversion-report.json', report)
                print(voice, 'Vevo conversion completed', flush=True)
            report.update(resources=monitor.metrics(),
                          peakAllocatedMiB=round(torch.cuda.max_memory_allocated()/2**20, 2))
        report['state'] = 'COMPLETED_REQUIRES_LISTENING'
    except Exception as error:
        report.update(state='FAILED', errorType=type(error).__name__, error=str(error),
                      checkpointAudits=audits)
        raise
    finally:
        report['elapsedSeconds'] = round(time.perf_counter() - started, 3)
        atomic_json(output / 'conversion-report.json', report)


if __name__ == '__main__':
    main()
