import { describe, expect, it } from 'vitest';
import type { BehaviorSpec } from '../shared/combat.js';
import { applyModifiers, type SpellMods } from './spell-modifiers.js';

const NONE: SpellMods = { chainAdd: 0, pierceAdd: 0, forkAdd: 0, spellAoe: 0, homingAdd: 0 };

describe('applyModifiers', () => {
  it('returns an equivalent list when there are no modifiers', () => {
    const b: BehaviorSpec[] = [{ type: 'chain', count: 3, range: 150, falloff: 0.75 }];
    expect(applyModifiers(b, NONE)).toEqual(b);
  });
  it('does not mutate the input behaviors', () => {
    const b: BehaviorSpec[] = [{ type: 'chain', count: 3, range: 150, falloff: 0.75 }];
    applyModifiers(b, { ...NONE, chainAdd: 2 });
    expect(b[0]).toMatchObject({ count: 3 }); // original untouched
  });
  it('increases an existing chain count', () => {
    const b: BehaviorSpec[] = [{ type: 'chain', count: 3, range: 150, falloff: 0.75 }];
    const out = applyModifiers(b, { ...NONE, chainAdd: 2 });
    expect(out.find((x) => x.type === 'chain')).toMatchObject({ count: 5 });
  });
  it('adds a chain behavior to a spell that lacks one', () => {
    const out = applyModifiers([], { ...NONE, chainAdd: 2 });
    expect(out).toEqual([{ type: 'chain', count: 2, range: 150, falloff: 0.75 }]);
  });
  it('adds pierce and fork when missing', () => {
    const out = applyModifiers([], { ...NONE, pierceAdd: 1, forkAdd: 2 });
    expect(out).toContainEqual({ type: 'pierce', count: 1, falloff: 0.9 });
    expect(out).toContainEqual({ type: 'fork', count: 2, spreadRad: 0.35, falloff: 0.6 });
  });
  it('scales an existing splash radius by spellAoe but does NOT add splash to a non-splash spell', () => {
    const withSplash: BehaviorSpec[] = [{ type: 'splash', radius: 60, scale: 0.5 }];
    const out = applyModifiers(withSplash, { ...NONE, spellAoe: 0.5 });
    expect(out.find((x) => x.type === 'splash')).toMatchObject({ radius: 90, scale: 0.5 });
    expect(applyModifiers([], { ...NONE, spellAoe: 0.5 })).toEqual([]);
  });
  it('adds homing when homingAdd>0 and none present; never duplicates', () => {
    expect(applyModifiers([], { ...NONE, homingAdd: 1 })).toEqual([
      { type: 'homing', turnRate: 3.5, acquireRange: 220 },
    ]);
    const b: BehaviorSpec[] = [{ type: 'homing', turnRate: 3.5, acquireRange: 220 }];
    expect(applyModifiers(b, { ...NONE, homingAdd: 1 })).toEqual(b);
  });
});
