"""Pinned, lightweight model contract shared by setup and the isolated runtime."""
ACE = 'ACE-Step/acestep-v15-xl-turbo-diffusers'
ACE_REVISION = '200ba991ae448051e14b0183157e35c2d27c9fb0'
WHISPER = 'openai/whisper-large-v3-turbo'
WHISPER_REVISION = '41f01f3fe87f28c78e2fbf8b568835947dd65ed9'

def prepared(kind):
    if kind == 'recognition':
        from qwen_lyrics import prepared as lyrics_prepared
        return lyrics_prepared()
    from pathlib import Path
    from huggingface_hub import try_to_load_from_cache
    repo, revision = (ACE, ACE_REVISION) if kind == 'song' else (WHISPER, WHISPER_REVISION)
    files = ['model.safetensors', 'preprocessor_config.json', 'tokenizer.json'] if kind != 'song' else [
        'model_index.json', 'tokenizer/chat_template.jinja', 'condition_encoder/diffusion_pytorch_model.safetensors',
        'text_encoder/model.safetensors', 'vae/diffusion_pytorch_model.safetensors',
        'transformer/diffusion_pytorch_model-00001-of-00002.safetensors',
        'transformer/diffusion_pytorch_model-00002-of-00002.safetensors']
    return all(isinstance(p := try_to_load_from_cache(repo, f, revision=revision), str) and Path(p).is_file() for f in files)
