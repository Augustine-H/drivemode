// Require sustained microphone energy; a brief click should not interrupt TTS.
export class SpeechOnsetDetector {
  private since: number | null = null;
  private emitted = false;
  update(level: number, now: number, threshold = 0.02) {
    if (level <= threshold) { this.since = null; return false; }
    if (this.since === null) this.since = now;
    if (!this.emitted && now - this.since >= 200) { this.emitted = true; return true; }
    return false;
  }
}
