/** Generic time-evicted ring buffer. Items carry a timestamp; anything older than `windowMs` is dropped on push and on read. */
export class TimeRing<T extends { ts: number }> {
  private items: T[] = [];
  constructor(private readonly windowMs: number, private readonly maxItems = Infinity) {}
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
