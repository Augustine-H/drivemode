"""CPU-only separation for the offline singing voice diagnostic and SVC probe."""
import argparse
import json
from pathlib import Path
import time
import torch
import torchaudio
import soundfile as sf


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('run', type=Path)
    parser.add_argument('--folder', action='store_true', help='Separate a single queue job folder')
    args = parser.parse_args()
    torch.set_num_threads(4)
    bundle = torchaudio.pipelines.HDEMUCS_HIGH_MUSDB_PLUS
    cached = Path(torch.hub.get_dir()) / 'torchaudio' / bundle._model_path
    if not cached.is_file():
        raise ValueError('DEMUCS_NOT_PREPARED_OFFLINE')
    model = bundle.get_model().eval().cpu()
    report = {'results': [{'output': str(args.run), 'voice': 'queue', 'seed': 'n/a'}]} if args.folder else json.loads((args.run / 'report.json').read_text())
    for row in report['results']:
        folder = Path(row['output'])
        if (folder / 'vocals.wav').exists():
            continue
        started = time.perf_counter()
        wave, sr = sf.read(folder / 'original.wav', dtype='float32', always_2d=True)
        pcm = torchaudio.functional.resample(torch.from_numpy(wave.T.copy()), sr, bundle.sample_rate)
        mean, scale = pcm.mean(), pcm.std().clamp(min=1e-5)
        normalized = (pcm - mean) / scale
        output, weight = torch.zeros_like(pcm), torch.zeros(pcm.shape[1])
        window, stride = 8 * bundle.sample_rate, 7 * bundle.sample_rate
        for start in range(0, pcm.shape[1], stride):
            end = min(start + window, pcm.shape[1])
            segment = normalized[:, start:end]
            padded = torch.nn.functional.pad(segment, (0, window - segment.shape[-1]))
            with torch.inference_mode():
                vocals = model(padded[None])[0, model.sources.index('vocals'), :, :end-start] * scale
            output[:, start:end] += vocals
            weight[start:end] += 1
        output /= weight.clamp(min=1)
        sf.write(folder / 'vocals.wav', output.T.numpy(), bundle.sample_rate, subtype='PCM_24')
        print(row['voice'], row['seed'], round(time.perf_counter() - started, 3), flush=True)


if __name__ == '__main__':
    main()
