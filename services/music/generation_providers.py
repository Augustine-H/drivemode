"""CPU-only public generation metadata; no credentials."""
from typing import Literal
GenerationProvider = Literal['local', 'elevenlabs']
MUSIC_MODEL = 'music_v2_5'
MUSIC_PRICING = {'checkedAt': '2026-10-06', 'estimatedUsdPerMinute': .15,
                 'actualBillKnown': False, 'model': MUSIC_MODEL}
