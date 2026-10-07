import { ttsUnits } from "./tts-chunking.ts";

// Publish complete sentences only. Their indices never change as more tokens arrive.
export function speechParts(text: string, done = false): string[] {
  return ttsUnits(text,done);
}
