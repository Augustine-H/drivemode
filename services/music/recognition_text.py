"""Conservative output checks for locally decoded song samples."""
import re
import zlib
import unicodedata


def repetition_check(text):
    """Compression is an uncertainty signal, not proof that a chorus is invalid."""
    encoded = text.encode('utf-8')
    if len(encoded) <= 40 or len(encoded) / len(zlib.compress(encoded)) <= 2.4:
        return False, []
    compact = ''.join(c for c in unicodedata.normalize('NFKC', text).casefold()
                      if unicodedata.category(c)[0] in 'LNM')
    # Restrict deletion to a whole-result, tiny motif repeated excessively.
    # Repeated phrases/verses and UTF-8-heavy Thai lyrics remain available.
    if len(compact) >= 96 and re.fullmatch(r'(.{1,3})\1{31,}', compact, flags=re.DOTALL):
        return True, ['짧은 글자가 과도하게 반복 생성되어 받아쓰기 결과를 제외했습니다. 보컬이 또렷한 구간으로 다시 시도하세요.']
    return False, ['반복이 많은 인식 결과입니다. 오인식 또는 정상 후렴일 수 있어 가사를 보존했습니다. 구간 원문과 실제 노래를 비교하세요.']


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
    exclude, repetition_warnings = repetition_check(text)
    warnings.extend(repetition_warnings)
    if exclude:
        text = ''
    return text, warnings, retried


def checked_lyrics(text):
    """Check the new decoder's result without substituting other model outputs."""
    text = text.strip()
    if subtitle_credit_only(text):
        return '', ['자막 출처 문구가 의심되어 받아쓰기 결과를 제외했습니다.']
    exclude, warnings = repetition_check(text)
    return ('' if exclude else text), warnings
