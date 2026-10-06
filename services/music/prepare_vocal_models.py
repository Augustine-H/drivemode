"""Explicit setup download; the serving worker never downloads models on demand."""
from credentials import configure_huggingface
from huggingface_hub import snapshot_download
from vocal_models import ACE, ACE_REVISION
from qwen_lyrics import MODEL, REVISION, DIRECTORY

MODELS = [
    (ACE, ACE_REVISION),
    (MODEL, REVISION),
]

if __name__ == '__main__':
    configure_huggingface()
    for repo, revision in MODELS:
        print('Preparing', repo, flush=True)
        snapshot_download(repo, revision=revision, allow_patterns=['*.json', '*.safetensors', '*.txt', '*.model', '*.jinja'], max_workers=3,
                          **({'local_dir': str(DIRECTORY)} if repo == MODEL else {}))
        print('Cached', repo, flush=True)
