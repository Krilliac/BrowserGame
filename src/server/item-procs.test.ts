import { describe, expect, it } from 'vitest';
import { resolveProcs, type ProcDef } from './item-procs.js';

const onHit = (overrides: Partial<ProcDef> = {}): ProcDef => ({
  id: 'p1',
  sourceId: 'sword',
  trigger: 'onHit',
  chance: 1,
  icdMs: 1000,
  effect: { kind: 'damage', amount: 10 },
  ...overrides,
});

// A scripted rng yielding a fixed cycle of values.
const seq = (xs: number[]): (() => number) => {
  let i = 0;
  return () => xs[i++ % xs.length]!;
};

describe('resolveProcs', () => {
  it('fires a guaranteed onHit proc and stamps its ICD', () => {
    const icd = new Map<string, number>();
    const fired = resolveProcs([onHit()], { crit: false, now: 0 }, icd, seq([0]));
    expect(fired).toEqual([{ kind: 'damage', amount: 10 }]);
    expect(icd.get('p1')).toBe(1000); // now(0) + icdMs(1000)
  });

  it('does not fire when the chance roll fails', () => {
    const icd = new Map<string, number>();
    const fired = resolveProcs([onHit({ chance: 0.25 })], { crit: false, now: 0 }, icd, seq([0.9]));
    expect(fired).toEqual([]);
    expect(icd.has('p1')).toBe(false); // a non-fire does not start the cooldown
  });

  it('respects the internal cooldown: fire, blocked within window, fires again after', () => {
    const icd = new Map<string, number>();
    const p = [onHit({ icdMs: 1000 })];
    expect(resolveProcs(p, { crit: false, now: 0 }, icd, seq([0]))).toHaveLength(1); // fires, ready=1000
    expect(resolveProcs(p, { crit: false, now: 999 }, icd, seq([0]))).toHaveLength(0); // still on ICD
    expect(resolveProcs(p, { crit: false, now: 1000 }, icd, seq([0]))).toHaveLength(1); // ICD elapsed → fires
  });

  it('an onCrit proc fires only on a critical hit', () => {
    const icd = new Map<string, number>();
    const critProc = [onHit({ trigger: 'onCrit' })];
    expect(resolveProcs(critProc, { crit: false, now: 0 }, icd, seq([0]))).toEqual([]);
    expect(resolveProcs(critProc, { crit: true, now: 0 }, icd, seq([0]))).toHaveLength(1);
  });

  it('resolves multiple procs independently with their own ICDs', () => {
    const icd = new Map<string, number>();
    const procs = [
      onHit({ id: 'a', icdMs: 5000, effect: { kind: 'damage', amount: 5 } }),
      onHit({ id: 'b', icdMs: 1000, effect: { kind: 'status', ability: 'fireball' } }),
    ];
    const fired = resolveProcs(procs, { crit: false, now: 0 }, icd, seq([0]));
    expect(fired).toContainEqual({ kind: 'damage', amount: 5 });
    expect(fired).toContainEqual({ kind: 'status', ability: 'fireball' });
    // 'a' is still on its long ICD at now=2000, but 'b' is ready again.
    const next = resolveProcs(procs, { crit: false, now: 2000 }, icd, seq([0]));
    expect(next).toEqual([{ kind: 'status', ability: 'fireball' }]);
  });
});
