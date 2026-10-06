"""Validated ISO language codes shared by the CPU API and local ASR."""
from typing import Literal, get_args

TranscriptionLanguage = Literal[
    'auto', 'ko', 'en', 'ja', 'zh', 'yue', 'es', 'fr', 'de', 'it', 'pt',
    'ar', 'ru', 'th', 'vi', 'tr', 'hi', 'ms', 'id', 'nl', 'sv', 'da',
    'fi', 'pl', 'cs', 'fil', 'fa', 'el', 'hu', 'mk', 'ro']


def model_language(language):
    if language not in get_args(TranscriptionLanguage):
        raise ValueError('QWEN_LYRICS_LANGUAGE_NOT_SUPPORTED_BY_THIS_CONFIGURATION')
    return None if language == 'auto' else language
