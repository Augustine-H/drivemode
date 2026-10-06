"""Wire metadata only: safe on the CPU-only NAS without credentials."""
from typing import Literal
TranscriptionProvider = Literal['qwen', 'xai', 'openai', 'elevenlabs']
PAID = {
    'xai': {'model': 'grok-voice-transcribe-2.0', 'estimatedUsdPerHour': .10},
    'openai': {'model': 'gpt-transcribe', 'estimatedUsdPerHour': .27},
    'elevenlabs': {'model': 'scribe_v2', 'estimatedUsdPerHour': .22},
}
PRICING_CHECKED = '2026-10-06'
