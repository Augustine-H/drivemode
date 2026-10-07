import type { GoogleTtsStatus } from './google-tts-client';

export function mergeTtsStatus(previous: GoogleTtsStatus | null, next: GoogleTtsStatus): GoogleTtsStatus {
  // Backend usage frames may omit proxy metadata. Keep the selected server.
  return { ...next, routing: next.routing ?? previous?.routing };
}
