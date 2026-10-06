"""Offline multilingual lyrics transcription; never downloads during inference."""
from pathlib import Path
from recognition_languages import model_language

MODEL = 'Qwen/Qwen3-ASR-1.7B-hf'
REVISION = 'bcd2b5b7f32b480ab5790554cfa8347f246a14f3'
DIRECTORY = Path(__file__).resolve().parents[2] / '.music-runtime' / 'qwen-asr' / REVISION
FILES = ('config.json', 'generation_config.json', 'processor_config.json',
         'tokenizer.json', 'tokenizer_config.json', 'chat_template.jinja', 'model.safetensors')


def prepared():
    return all((DIRECTORY / name).is_file() for name in FILES)


def transcribe(audio, language='ko'):
    outputs = transcribe_segments([audio], language)
    try:
        return next(outputs)
    finally:
        outputs.close()


def transcribe_segments(segments, language='ko'):
    language = model_language(language)
    if not prepared():
        raise RuntimeError('QWEN_LYRICS_MODEL_NOT_PREPARED')
    import torch
    from transformers import AutoProcessor, AutoModelForMultimodalLM
    processor = AutoProcessor.from_pretrained(DIRECTORY, local_files_only=True)
    model = AutoModelForMultimodalLM.from_pretrained(
        DIRECTORY, local_files_only=True, dtype=torch.bfloat16,
        attn_implementation='sdpa').to('cuda').eval()
    try:
        with torch.inference_mode():
            for audio in segments:
                inputs = processor.apply_transcription_request(audio=audio, language=language).to('cuda', torch.bfloat16)
                tokens = model.generate(**inputs, max_new_tokens=512, do_sample=False)
                generated = tokens[:, inputs['input_ids'].shape[1]:]
                text = processor.decode(generated, return_format='transcription_only')[0].strip()
                del inputs, tokens, generated
                yield text
    finally:
        del model
        torch.cuda.empty_cache()
