import { describe, expect, it } from 'vitest';
import { TokenBucket } from './rate-limit.js';

describe('TokenBucket', () => {
  it('allows up to capacity immediately, then blocks', () => {
    const bucket = new TokenBucket(3, 1, 0);
    expect(bucket.tryRemove(0)).toBe(true);
    expect(bucket.tryRemove(0)).toBe(true);
    expect(bucket.tryRemove(0)).toBe(true);
    expect(bucket.tryRemove(0)).toBe(false);
  });

  it('refills over time at the configured rate', () => {
    const bucket = new TokenBucket(2, 2, 0); // 2 tokens/sec
    expect(bucket.tryRemove(0)).toBe(true);
    expect(bucket.tryRemove(0)).toBe(true);
    expect(bucket.tryRemove(0)).toBe(false);
    // 0.5s later → 1 token back
    expect(bucket.tryRemove(500)).toBe(true);
    expect(bucket.tryRemove(500)).toBe(false);
  });

  it('never exceeds capacity when idle', () => {
    const bucket = new TokenBucket(2, 100, 0);
    // Idle a long time; should still cap at 2.
    expect(bucket.tryRemove(10_000)).toBe(true);
    expect(bucket.tryRemove(10_000)).toBe(true);
    expect(bucket.tryRemove(10_000)).toBe(false);
  });
});
