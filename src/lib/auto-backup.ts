export type BackupClock = {
  set: (callback: () => void, delay: number) => unknown;
  clear: (timer: unknown) => void;
};

/** Debounces changes and serializes writes so an older snapshot cannot win a race. */
export class AutoBackupQueue {
  private timer: unknown;
  private latest: string | null = null;
  private saved: string | null;
  private running = false;
  private due = false;
  private stopped = false;
  private write: (snapshot: string) => Promise<boolean>;
  private delay: number;
  private clock: BackupClock;

  constructor(
    write: (snapshot: string) => Promise<boolean>,
    delay: number,
    clock: BackupClock,
    initialSaved: string | null = null,
  ) {
    this.write = write;
    this.delay = delay;
    this.clock = clock;
    this.saved = initialSaved;
  }

  update(snapshot: string) {
    if (this.stopped || snapshot === this.latest) return;
    this.latest = snapshot;
    this.clock.clear(this.timer);
    this.due = false;
    if (snapshot === this.saved) return;
    this.timer = this.clock.set(() => {
      this.due = true;
      void this.flush();
    }, this.delay);
  }

  stop() {
    this.stopped = true;
    this.clock.clear(this.timer);
  }

  private async flush() {
    if (
      this.stopped ||
      this.running ||
      !this.due ||
      this.latest === this.saved ||
      this.latest === null
    )
      return;
    const snapshot = this.latest;
    this.running = true;
    this.due = false;
    try {
      if (await this.write(snapshot)) this.saved = snapshot;
      else this.stop();
    } catch {
      this.stop();
    } finally {
      this.running = false;
      if (!this.stopped && this.due) void this.flush();
    }
  }
}
