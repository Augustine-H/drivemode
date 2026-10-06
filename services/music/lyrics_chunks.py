"""Bounded audio windows and conservative overlap merging, without reference lyrics."""
import unicodedata


def windows(frames, rate=16000):
    # The final window includes at least one second. Never create a tiny tail.
    start = 0
    while start < frames:
        end = min(start + 30 * rate, frames)
        yield start, end
        if end == frames:
            break
        start = end - 3 * rate


def normalized_positions(text):
    chars, positions = [], []
    for i, char in enumerate(text):
        for c in unicodedata.normalize('NFKC', char).casefold():
            # Thai vowels/tone marks are meaningful characters, even though
            # Python's isalnum() excludes their Unicode combining-mark category.
            if unicodedata.category(c)[0] in 'LNM':
                chars.append(c)
                positions.append(i + 1)
    return ''.join(chars), positions


def merge(previous, following):
    if not previous:
        return following, False
    if not following:
        return previous, False
    left, _ = normalized_positions(previous)
    right, positions = normalized_positions(following)
    # Only the touching edges may be removed, never a recurring chorus elsewhere.
    for count in range(min(64, len(left), len(right)), 5, -1):
        if left[-count:] == right[:count]:
            rest = following[positions[count - 1]:]
            tail = rest.lstrip(' \n\t、。，,.!?！？')
            separator = ' ' if tail and (tail[0].isascii() or any(c.isspace() for c in rest[:len(rest) - len(tail)])) else ''
            return previous.rstrip() + separator + tail, False
    # A window may begin mid-word and emit a short stray prefix. An exact,
    # substantial anchor at the previous ending still identifies the shared
    # audio. Limit this search to the first eight characters of the new window.
    for count in range(min(64, len(left), len(right)), 7, -1):
        for offset in range(1, min(8, len(right) - count) + 1):
            if left[-count:] == right[offset:offset + count]:
                rest = following[positions[offset + count - 1]:]
                tail = rest.lstrip(' \n\t、。，,.!?！？')
                separator = ' ' if tail and (tail[0].isascii() or any(c.isspace() for c in rest[:len(rest) - len(tail)])) else ''
                return previous.rstrip() + separator + tail, False
    # Keep both readings rather than guess which words were sung. Raw timed
    # segments remain available for inspection even when edges were merged.
    return previous.rstrip() + '\n' + following.lstrip(), True
