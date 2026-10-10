"""Reference selection for offline SVC diagnostics, separate from queue profiles."""
from pathlib import Path


def select_reference(voice, diagnostic_audio):
    if diagnostic_audio is None:
        from singing_voice import profile
        path, metadata = profile(voice)
        return path, metadata, 'persona-profile'
    import numpy as np
    import soundfile as sf
    from provider import file_hash
    path = Path(diagnostic_audio).resolve(strict=True)
    pcm, rate = sf.read(path, dtype='float32', always_2d=True)
    if (rate <= 0 or pcm.shape[1] not in (1, 2)
            or not 3 <= len(pcm) / rate <= 25
            or not np.isfinite(pcm).all()
            or np.sqrt(np.mean(pcm.astype('float64') ** 2)) < 1e-6):
        raise ValueError('INVALID_DIAGNOSTIC_REFERENCE_AUDIO')
    return path, {'sha256': file_hash(path)}, 'diagnostic-local-audio'
