export type SnapshotClock = {
  now: () => number;
  set: (callback: () => void, delay: number) => unknown;
  clear: (timer: unknown) => void;
};

/** One queue survives content changes; returning to the app never shortens the debounce. */
export class StorageSnapshotScheduler {
  private timer: unknown;
  private due: number | null = null;
  private running = false;
  private stopped = false;
  private key: string | undefined;
  private readonly write: () => Promise<void>;
  private readonly visible: () => boolean;
  private readonly clock: SnapshotClock;
  private readonly delay: number;
  constructor(
    write: () => Promise<void>,
    visible: () => boolean,
    clock: SnapshotClock,
    delay = 30000,
  ) {
    this.write = write;
    this.visible = visible;
    this.clock = clock;
    this.delay = delay;
  }
  update(key: string) {
    if (this.key === key || this.stopped) return;
    this.key = key;
    this.request();
  }
  request() {
    if (this.stopped) return;
    this.due = this.clock.now() + this.delay;
    this.arm();
  }
  resume() {
    if (this.stopped || !this.visible()) return;
    if (this.due === null) this.request();
    else this.arm();
  }
  stop() {
    this.stopped = true;
    this.clock.clear(this.timer);
  }
  private arm() {
    this.clock.clear(this.timer);
    if (this.stopped || this.due === null || this.running || !this.visible()) return;
    this.timer = this.clock.set(() => void this.flush(), Math.max(0, this.due - this.clock.now()));
  }
  private async flush() {
    if (this.stopped || this.running || !this.visible() || this.due === null) return;
    if (this.due > this.clock.now()) return this.arm();
    this.due = null;
    this.running = true;
    try {
      await this.write();
    } finally {
      this.running = false;
      this.arm();
    }
  }
}
