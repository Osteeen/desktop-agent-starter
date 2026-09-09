/** Generic time-evicted ring buffer. Items carry a timestamp; anything older than `windowMs` is dropped on push and on read. */
export class TimeRing<T extends { ts: number }> {
  private items: T[] = [];
  private sweep: NodeJS.Timeout | null = null;
  /**
   * `windowMs` is a guarantee, not a hint. Eviction on push alone is lazy: an idle ring holds
   * its last item indefinitely, so "nothing older than 60 seconds" would be false whenever
   * nothing was being pushed. A timer sweeps on the same schedule so the claim holds at rest.
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
