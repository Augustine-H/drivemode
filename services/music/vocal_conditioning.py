"""Reject conditioning that the pinned ACE pipeline would silently truncate."""
TEXT_LIMIT = 256
LYRIC_LIMIT = 2048


class VocalInputLimit(ValueError):
    """A rejected input before GPU inference, not a CUDA/model failure."""


def validate_conditioning(pipe, request):
    instruction = pipe._get_task_instruction(task_type='text2music')
    text, lyrics = pipe._format_prompt(
        prompt=request['prompt'], lyrics=request['lyrics'], vocal_language='ko',
        audio_duration=float(request['duration']), instruction=instruction)
    counts = {}
    for name, value, limit in (('prompt', text, TEXT_LIMIT), ('lyrics', lyrics, LYRIC_LIMIT)):
        # Use the same tokenizer and special-token policy as encode_prompt,
        # including the pipeline's language/header/metadata formatting.
        count = len(pipe.tokenizer(value, truncation=False)['input_ids'])
        counts[name + 'Tokens'] = count
        counts[name + 'TokenLimit'] = limit
        if count > limit:
            label = '음악 설명' if name == 'prompt' else '가사'
            particle = '이' if name == 'prompt' else '가'
            raise VocalInputLimit(f'VOCAL_{name.upper()}_TOKEN_LIMIT: {label}{particle} 모델 입력 한도를 넘었습니다 '
                             f'({count}/{limit} 토큰). 내용을 줄여 다시 생성하세요. 입력을 임의로 자르지 않았습니다.')
    return instruction, counts
