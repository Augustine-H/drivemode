import { chunkText, type Turn } from './transcript.ts';
import { voiceResponse } from './voice-formatter.ts';
import { ttsUnits } from './tts-chunking.ts';

export function speechForTurn(turn: Turn): string[] {
  // Older saved replies contain a shortened voiceText/speechParts copy.
  // Rebuild finished replies from their original text without changing history.
  if (!turn.streaming && turn.speaker === 'grok' &&
      (turn.voiceText !== undefined || turn.speechParts !== undefined)) {
    return ttsUnits(voiceResponse(turn.text, true), true);
  }
  return turn.speechParts ?? chunkText(turn.voiceText ?? turn.text);
}
