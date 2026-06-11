import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuardStats, runGuarded } from './resilience.js';

describe('runGuarded', () => {
  beforeEach(() => {
    // The guard logs to console.error on a throw; silence it so test output stays clean.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the function result when it does not throw', () => {
    expect(runGuarded('ok', () => 42)).toBe(42);
  });

  it('returns undefined and does not rethrow when the function throws', () => {
    const out = runGuarded('bad', () => {
      throw new Error('boom');
    });
    expect(out).toBeUndefined();
  });

  it('logs under a labeled prefix on throw', () => {
    runGuarded('parse', () => {
      throw new Error('boom');
    });
    expect(console.error).toHaveBeenCalledWith('[guard:parse]', expect.any(Error));
  });

  it('invokes onError with the label and the thrown value', () => {
    const seen: Array<{ label: string; err: unknown }> = [];
    const err = new Error('boom');
    runGuarded(
      'tick',
      () => {
        throw err;
      },
      (label, e) => seen.push({ label, err: e }),
    );
    expect(seen).toEqual([{ label: 'tick', err }]);
  });

  it('does not call onError on success', () => {
    const onError = vi.fn();
    runGuarded('ok', () => 1, onError);
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('GuardStats', () => {
  it('counts errors per label', () => {
    const stats = new GuardStats();
    stats.record('a');
    stats.record('a');
    stats.record('b');
    expect(stats.countFor('a')).toBe(2);
    expect(stats.countFor('b')).toBe(1);
    expect(stats.countFor('missing')).toBe(0);
    expect(stats.total()).toBe(3);
  });

  it('reports the top offenders highest-first with stable tie-break', () => {
    const stats = new GuardStats();
    stats.record('zebra');
    stats.record('alpha');
    stats.record('alpha');
    stats.record('mid');
    expect(stats.top(2)).toEqual([
      { label: 'alpha', count: 2 },
      { label: 'mid', count: 1 },
    ]);
    // Tie between 'mid' and 'zebra' (count 1) breaks alphabetically.
    expect(stats.top(3)[2]).toEqual({ label: 'zebra', count: 1 });
  });

  it('integrates with runGuarded via onError', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stats = new GuardStats();
    for (let i = 0; i < 3; i++) {
      runGuarded(
        'msg',
        () => {
          throw new Error('x');
        },
        (label) => stats.record(label),
      );
    }
    expect(stats.countFor('msg')).toBe(3);
    vi.restoreAllMocks();
  });

  it('stays bounded: drops brand-new labels once at capacity', () => {
    const stats = new GuardStats(2);
    stats.record('a');
    stats.record('b');
    stats.record('c'); // dropped — already at 2 distinct labels
    expect(stats.size).toBe(2);
    expect(stats.countFor('c')).toBe(0);
    // Existing labels still count past capacity.
    stats.record('a');
    expect(stats.countFor('a')).toBe(2);
  });

  it('clears all counts', () => {
    const stats = new GuardStats();
    stats.record('a');
    stats.clear();
    expect(stats.total()).toBe(0);
    expect(stats.size).toBe(0);
  });
});
