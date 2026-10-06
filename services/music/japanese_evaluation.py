"""V2 supplementary diagnostics. Preserve frozen historical benchmark scores."""
import re
import unicodedata
POLICY_VERSION = 2

def spelling(text):
    text = unicodedata.normalize('NFKC', text).casefold().replace('\u2019', "'")
    text = re.sub(r"(?<![a-z])i'm\s+sorry(?![a-z])", 'アイムソーリー', text)
    return text.replace('一人', 'ひとり')

def reading(text):
    import pykakasi
    converter = pykakasi.kakasi()
    return ''.join(''.join(item['hira'] for item in converter.convert(line))
                   for line in spelling(text).splitlines() if line)
