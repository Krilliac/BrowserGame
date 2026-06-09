/**
 * A tiny token-bucket rate limiter. Pure and time-injectable so it is trivially testable.
 *
 * Security pillar: every client is hostile. We cap how often a connection may act so a
 * single socket can't flood the simulation or chat. One bucket per connection per concern.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    now: number = Date.now(),
  ) {
    this.tokens = capacity;
    this.last = now;
  }

  /** Try to consume one token. Returns true if allowed, false if rate-limited. */
  tryRemove(now: number = Date.now()): boolean {
    this.refill(now);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  private refill(now: number): void {
    const elapsed = (now - this.last) / 1000;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
    this.last = now;
  }
}
