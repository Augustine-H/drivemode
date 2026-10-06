"""Conservative output checks for locally decoded song samples."""
import re
import zlib


def subtitle_credit_only(text):
    """A standalone credit is suspicious; ordinary lyrics mentioning captions aren't."""
    return bool(re.fullmatch(
        r'\s*(?:(?:한글|한국어|영어)\s*)?자막\s*(?:by|제작[:：]?|제공[:：]?)\s+[^\n.!?]{1,40}[.!]?\s*'
        r'|\s*(?:subtitles?|captions?)\s+by\s+[^\n.!?]{1,40}[.!]?\s*',
        text, flags=re.IGNORECASE))


def checked_transcription(decode):
    """Retry only a demonstrated credit failure; never inject reference lyrics."""
    text = decode(True).strip()
    warnings = []
    retried = subtitle_credit_only(text)
    if retried:
        text = decode(False).strip()
        warnings.append('자막 출처 문구가 의심되어 같은 모델로 타임스탬프 없이 한 번 재시도했습니다. 가사 정확도를 확인하세요.')
        if subtitle_credit_only(text):
            text = ''
            warnings.append('재시도에서도 자막 출처 문구가 나와 받아쓰기 결과를 제외했습니다.')
    encoded = text.encode('utf-8')
    if len(encoded) > 40 and len(encoded) / len(zlib.compress(encoded)) > 2.4:
        text = ''
        warnings.append('반복된 글자·문장이 생성되어 받아쓰기 결과를 제외했습니다. 보컬이 또렷한 구간으로 다시 시도하세요.')
    return text, warnings, retried


def checked_lyrics(text):
    """Check the new decoder's result without substituting other model outputs."""
    text = text.strip()
    if subtitle_credit_only(text):
        return '', ['자막 출처 문구가 의심되어 받아쓰기 결과를 제외했습니다.']
    encoded = text.encode('utf-8')
    if len(encoded) > 40 and len(encoded) / len(zlib.compress(encoded)) > 2.4:
        return '', ['반복된 글자·문장이 생성되어 받아쓰기 결과를 제외했습니다. 보컬이 또렷한 구간으로 다시 시도하세요.']
    return text, []
