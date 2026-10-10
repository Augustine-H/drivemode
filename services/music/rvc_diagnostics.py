"""Explicit local RVC F0 diagnostics; upstream files and trained data stay intact."""
import numpy as np


def protection_weights(raw, offset, count, protect):
    raw = np.asarray(raw)
    if raw.ndim != 1 or offset < 0 or count < 0 or offset + count > raw.size:
        raise ValueError('RVC_DIAGNOSTIC_MASK_ALIGNMENT')
    if not np.isfinite(raw).all() or np.any(raw < 0) or not 0 <= protect <= .5:
        raise ValueError('RVC_DIAGNOSTIC_INVALID_MASK')
    return np.where(raw[offset:offset + count] == 0, protect, 1.).astype(np.float32)


def restore_unvoiced(coarse, continuous, raw):
    coarse, continuous, raw = np.asarray(coarse), np.asarray(continuous), np.asarray(raw)
    if coarse.shape != raw.shape or continuous.shape != raw.shape:
        raise ValueError('RVC_DIAGNOSTIC_F0_SHAPE_MISMATCH')
    if not np.isfinite(raw).all() or np.any(raw < 0):
        raise ValueError('RVC_DIAGNOSTIC_INVALID_RAW_F0')
    unvoiced = raw == 0
    result_coarse, result_continuous = coarse.copy(), continuous.copy()
    result_coarse[unvoiced] = 1
    result_continuous[unvoiced] = 0
    return result_coarse, result_continuous


def install(mode):
    from infer.rmvpe import RMVPE
    from infer.vc.pipeline import Pipeline
    if mode not in ('baseline', 'preserve-unvoiced', 'protect-only'):
        raise ValueError('INVALID_RVC_DIAGNOSTIC_MODE')
    evidence = {'mode':mode, 'f0Calls':[]}
    original_rmvpe = RMVPE.infer_from_audio
    original_f0 = Pipeline.get_f0

    def capture(self, *args, **kwargs):
        result = original_rmvpe(self, *args, **kwargs)
        self.diagnostic_raw_f0 = np.asarray(result).copy()
        return result

    def get_f0(self, x, p_len, key, method):
        if method != 'rmvpe':
            raise ValueError('RVC_DIAGNOSTIC_REQUIRES_RMVPE')
        coarse, continuous = original_f0(self, x, p_len, key, method)
        raw = self.model_rmvpe.diagnostic_raw_f0
        self.diagnostic_raw_f0 = raw.copy()
        self.diagnostic_filled_f0 = continuous.astype(np.float32).copy()
        row = {'frames':int(raw.size), 'rawUnvoicedFrames':int(np.sum(raw == 0)),
               'baselineUnvoicedFrames':int(np.sum(continuous == 0))}
        if mode == 'preserve-unvoiced':
            coarse, continuous = restore_unvoiced(coarse, continuous, raw)
        row['returnedUnvoicedFrames'] = int(np.sum(continuous == 0))
        evidence['f0Calls'].append(row)
        return coarse, continuous

    RMVPE.infer_from_audio = capture
    Pipeline.get_f0 = get_f0
    if mode == 'protect-only':
        import inspect
        import textwrap
        import torch
        import hashlib
        original_vc = Pipeline.vc
        source = textwrap.dedent(inspect.getsource(original_vc))
        old = 'pitchff = pitchf.clone()\n        pitchff[pitchf > 0] = 1\n        pitchff[pitchf < 1] = protect'
        if source.count(old) != 1:
            raise ValueError('RVC_DIAGNOSTIC_PROTECTION_SOURCE_CHANGED')

        def mask(self, pitchf, protect):
            if pitchf.ndim != 2 or pitchf.shape[0] != 1 or pitchf.stride(1) != 1:
                raise ValueError('RVC_DIAGNOSTIC_PITCH_LAYOUT')
            offset, count = pitchf.storage_offset(), pitchf.shape[1]
            expected = self.diagnostic_filled_f0[offset:offset + count]
            actual = pitchf.detach().cpu().numpy()[0]
            if not np.array_equal(actual, expected):
                raise ValueError('RVC_DIAGNOSTIC_SYNTH_F0_CHANGED')
            weights = protection_weights(self.diagnostic_raw_f0, offset, count, protect)
            evidence.setdefault('protectionCalls', []).append({
                'offset': offset, 'frames': count,
                'protectedFrames': int(np.sum(weights < 1)),
                'synthF0Unchanged': True,
                'synthF0Sha256': hashlib.sha256(actual.tobytes()).hexdigest()})
            return torch.as_tensor(weights, device=pitchf.device, dtype=pitchf.dtype).unsqueeze(0)

        namespace = dict(original_vc.__globals__, _diagnostic_protection_mask=mask)
        patched = source.replace(old, 'pitchff = _diagnostic_protection_mask(self, pitchf, protect)')
        exec(compile(patched, '<rvc-protect-only-diagnostic>', 'exec'), namespace)
        Pipeline.vc = namespace['vc']
    return evidence
