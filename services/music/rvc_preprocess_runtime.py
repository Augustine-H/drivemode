"""Preserve every utterance tail in the pinned upstream preprocessing pilot."""
import runpy


def segment_slices(slices, sample_rate, seconds=3.7, overlap=.3):
    for audio in slices:
        start = 0
        while len(audio) - start > (seconds + overlap) * sample_rate:
            yield audio[start:start + int(seconds * sample_rate)]
            start += int((seconds - overlap) * sample_rate)
        if start < len(audio):
            yield audio[start:]


def main():
    namespace = runpy.run_module('train.preprocess', run_name='rvc_preprocess_pilot')
    cls = namespace['PreProcess']
    failures = []

    def pipeline(self, path, output_key, progress_index, total):
        try:
            audio = namespace['load_audio'](path, self.sr)
            audio = namespace['signal'].lfilter(self.bh, self.ah, audio)
            for index, chunk in enumerate(segment_slices(self.slicer.slice(audio), self.sr, self.per, self.overlap)):
                if not self.norm_write(chunk, output_key, index):
                    raise ValueError('INVALID_PREPROCESS_CHUNK')
            if namespace['should_report'](progress_index, total):
                namespace['println']('Preprocessing progress: %s/%s' % (progress_index + 1, total))
            return True
        except Exception:
            failures.append(str(path))
            namespace['println'](namespace['traceback'].format_exc())
            return False

    cls.pipeline = pipeline
    print('RVC preprocessing adapter: preserve every sliced utterance tail', flush=True)
    namespace['preprocess_trainset'](namespace['inp_root'], namespace['sr'], namespace['n_p'],
                                  namespace['exp_dir'], namespace['per'])
    if failures:
        raise RuntimeError('PREPROCESS_INPUT_FAILED:' + ','.join(failures))


if __name__ == '__main__':
    main()
