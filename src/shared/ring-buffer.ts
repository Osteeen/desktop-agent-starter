/** Generic time-evicted ring buffer. Items carry a timestamp; anything older than `windowMs` is dropped on push and on read. */
export class TimeRing<T extends { ts: number }> {
  private items: T[] = [];
  private sweep: NodeJS.Timeout | null = null;
  /**
   * Eviction on push alone is lazy: an idle ring would hold its last item indefinitely, so
   * "nothing older than 60 seconds" was false whenever nothing was being pushed. A timer sweeps
   * so the bound holds at rest.
   *
   * The bound is `windowMs` plus one sweep interval, not `windowMs` exactly. With a 60 s window
   * the sweep runs every 6 s, so an item can survive up to 66 s. State it that way rather than
   * claiming a wall-clock guarantee the implementation does not provide.
   */
  constructor(private readonly windowMs: number, private readonly maxItems = Infinity) {
    this.sweep = setInterval(() => this.evict(Date.now()), Math.max(1000, Math.floor(windowMs / 10)));
    this.sweep.unref?.();
  }
  /** Drop everything and stop sweeping. */
  dispose(): void { if (this.sweep) clearInterval(this.sweep); this.sweep = null; this.items = []; }
  push(item: T): void {
    this.items.push(item);
    this.evict(item.ts);
  }
  snapshot(now = Date.now()): T[] { this.evict(now); return this.items.slice(); }
  size(): number { return this.items.length; }
  clear(): void { this.items = []; }
  private evict(now: number): void {
    const cutoff = now - this.windowMs;
    let i = 0;
    while (i < this.items.length && this.items[i].ts < cutoff) i++;
    if (i > 0) this.items.splice(0, i);
    if (this.items.length > this.maxItems) this.items.splice(0, this.items.length - this.maxItems);
  }
}
