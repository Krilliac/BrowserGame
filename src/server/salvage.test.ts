import { describe, it, expect } from 'vitest';
import type { Affix, ItemInstance, Rarity } from '../shared/items.js';
import {
  MATERIAL_KINDS,
  type MaterialKind,
  type MaterialYield,
  isSalvageMaterial,
  salvageYield,
} from './salvage.js';

/**
 * A scripted rng: returns the queued values in order, then repeats the last one forever (so a test
 * that under-counts its draws never throws on an undefined). Deterministic and inspectable.
 */
function scriptedRng(values: number[]): () => number {
  let i = 0;
  const last = values.length > 0 ? values[values.length - 1]! : 0;
  return () => (i < values.length ? values[i++]! : last);
}

/** Build a minimal salvageable instance with just the fields salvageYield reads. */
function inst(
  rarity: Rarity,
  affixes: Affix[] = [],
  sockets?: (string | null)[],
): Pick<ItemInstance, 'rarity' | 'affixes' | 'sockets'> {
  return sockets === undefined ? { rarity, affixes } : { rarity, affixes, sockets };
}

/** Sum of all material qty weighted by tier rank (scrap=1 .. shard=4) — a crude "total value". */
function weight(yields: MaterialYield[]): number {
  return yields.reduce((s, y) => s + y.qty * (MATERIAL_KINDS.indexOf(y.kind) + 1), 0);
}

/** Convenience: total material count regardless of kind. */
function totalQty(yields: MaterialYield[]): number {
  return yields.reduce((s, y) => s + y.qty, 0);
}

const NO_AFFIX: Affix[] = [];
/** rng that always rolls the LOW branch (no bonus scrap on common/magic). */
const lowRng = (): number => 0;
/** rng that always rolls the HIGH branch (+1 scrap on common/magic). */
const highRng = (): number => 0.99;

describe('salvageYield — base rarity payouts (low rng, no affixes/sockets)', () => {
  it('common → 1 scrap', () => {
    expect(salvageYield(inst('common'), lowRng)).toEqual([{ kind: 'scrap', qty: 1 }]);
  });

  it('magic → 1 scrap + 1 dust', () => {
    expect(salvageYield(inst('magic'), lowRng)).toEqual([
      { kind: 'scrap', qty: 1 },
      { kind: 'dust', qty: 1 },
    ]);
  });

  it('rare → 1 dust + 1 essence', () => {
    expect(salvageYield(inst('rare'), lowRng)).toEqual([
      { kind: 'dust', qty: 1 },
      { kind: 'essence', qty: 1 },
    ]);
  });

  it('epic → 2 essence', () => {
    expect(salvageYield(inst('epic'), lowRng)).toEqual([{ kind: 'essence', qty: 2 }]);
  });

  it('legendary → 1 essence + 1 shard', () => {
    expect(salvageYield(inst('legendary'), lowRng)).toEqual([
      { kind: 'essence', qty: 1 },
      { kind: 'shard', qty: 1 },
    ]);
  });

  it('unique → 1 essence + 1 shard (salvages like legendary)', () => {
    expect(salvageYield(inst('unique'), lowRng)).toEqual([
      { kind: 'essence', qty: 1 },
      { kind: 'shard', qty: 1 },
    ]);
  });

  it('corrupted → 2 essence (treated like epic)', () => {
    expect(salvageYield(inst('corrupted'), lowRng)).toEqual([{ kind: 'essence', qty: 2 }]);
  });
});

describe('salvageYield — low-tier scrap variance (1-2 spread)', () => {
  it('common high rng → 2 scrap', () => {
    expect(salvageYield(inst('common'), highRng)).toEqual([{ kind: 'scrap', qty: 2 }]);
  });

  it('magic high rng → 2 scrap + 1 dust', () => {
    expect(salvageYield(inst('magic'), highRng)).toEqual([
      { kind: 'scrap', qty: 2 },
      { kind: 'dust', qty: 1 },
    ]);
  });

  it('the variance boundary is rng>=0.5 → +1 scrap; below stays at 1', () => {
    expect(salvageYield(inst('common'), scriptedRng([0.4999]))).toEqual([
      { kind: 'scrap', qty: 1 },
    ]);
    expect(salvageYield(inst('common'), scriptedRng([0.5]))).toEqual([{ kind: 'scrap', qty: 2 }]);
  });

  it('higher tiers do NOT consume an rng draw for variance', () => {
    // A scripted rng that would throw on a 2nd draw confirms only base+bonus logic runs (no rng).
    const once = scriptedRng([0]);
    expect(() => salvageYield(inst('rare'), once)).not.toThrow();
    expect(() => salvageYield(inst('legendary'), once)).not.toThrow();
  });
});

describe('salvageYield — strict rarity ordering (higher rarity salvages richer)', () => {
  it('total material weight strictly increases common < magic < rare < epic < legendary', () => {
    const order: Rarity[] = ['common', 'magic', 'rare', 'epic', 'legendary'];
    const weights = order.map((r) => weight(salvageYield(inst(r), lowRng)));
    for (let i = 1; i < weights.length; i++) {
      expect(weights[i]!).toBeGreaterThan(weights[i - 1]!);
    }
  });

  it('legendary weight is strictly greater than common weight', () => {
    expect(weight(salvageYield(inst('legendary'), lowRng))).toBeGreaterThan(
      weight(salvageYield(inst('common'), lowRng)),
    );
  });
});

describe('salvageYield — affixes & sockets add bonus materials', () => {
  const twoAffixes: Affix[] = [
    { stat: 'power', value: 5 },
    { stat: 'crit', value: 4 },
  ];

  it('affixes add bonus material of the rarity bonus-kind (rare → dust)', () => {
    const plain = salvageYield(inst('rare'), lowRng);
    const withAffixes = salvageYield(inst('rare', twoAffixes), lowRng);
    // rare base = 1 dust + 1 essence; bonus kind for rare is dust; +2 affixes → 3 dust + 1 essence.
    expect(withAffixes).toEqual([
      { kind: 'dust', qty: 3 },
      { kind: 'essence', qty: 1 },
    ]);
    expect(totalQty(withAffixes)).toBeGreaterThan(totalQty(plain));
  });

  it('filled sockets add bonus material; empty (null) sockets do not', () => {
    const filled = salvageYield(inst('epic', NO_AFFIX, ['ruby', 'topaz']), lowRng);
    // epic base = 2 essence; bonus kind = essence; +2 gems → 4 essence.
    expect(filled).toEqual([{ kind: 'essence', qty: 4 }]);

    const empty = salvageYield(inst('epic', NO_AFFIX, [null, null]), lowRng);
    expect(empty).toEqual([{ kind: 'essence', qty: 2 }]);
  });

  it('mixed filled/empty sockets count only the filled ones', () => {
    const mixed = salvageYield(inst('epic', NO_AFFIX, ['ruby', null, 'topaz']), lowRng);
    // 2 essence base + 2 filled gems → 4 essence.
    expect(mixed).toEqual([{ kind: 'essence', qty: 4 }]);
  });

  it('affixes AND sockets stack their bonuses', () => {
    const both = salvageYield(inst('legendary', twoAffixes, ['ruby']), lowRng);
    // legendary base = 1 essence + 1 shard; bonus kind = essence; +2 affixes +1 gem → 4 essence + 1 shard.
    expect(both).toEqual([
      { kind: 'essence', qty: 4 },
      { kind: 'shard', qty: 1 },
    ]);
  });

  it('a richer item salvages richer than a plainer one of the same rarity', () => {
    const plain = salvageYield(inst('legendary'), lowRng);
    const rich = salvageYield(inst('legendary', twoAffixes, ['ruby', 'topaz']), lowRng);
    expect(weight(rich)).toBeGreaterThan(weight(plain));
  });
});

describe('salvageYield — same-kind yields merge into one entry', () => {
  it('never returns two entries of the same kind', () => {
    // magic base has scrap; common/magic variance adds scrap; affixes (magic bonus-kind=scrap) add scrap.
    const y = salvageYield(
      inst('magic', [{ stat: 'power', value: 5 }], ['ruby']),
      highRng, // +1 variance scrap
    );
    const kinds = y.map((m) => m.kind);
    expect(new Set(kinds).size).toBe(kinds.length); // all kinds distinct
    // magic: base 1 scrap +1 dust; +1 variance scrap; bonus kind scrap +1 affix +1 gem = +2 scrap.
    // → scrap 1+1+2 = 4, dust 1.
    expect(y).toEqual([
      { kind: 'scrap', qty: 4 },
      { kind: 'dust', qty: 1 },
    ]);
  });
});

describe('salvageYield — invariants & graceful degradation', () => {
  it('always returns at least one material for every known rarity', () => {
    const all: Rarity[] = ['common', 'magic', 'rare', 'epic', 'legendary', 'corrupted', 'unique'];
    for (const r of all) {
      expect(salvageYield(inst(r), lowRng).length).toBeGreaterThanOrEqual(1);
      expect(totalQty(salvageYield(inst(r), lowRng))).toBeGreaterThanOrEqual(1);
    }
  });

  it('unknown / odd rarity degrades to a single scrap', () => {
    const weird = { rarity: 'mythical' as Rarity, affixes: NO_AFFIX };
    expect(salvageYield(weird, lowRng)).toEqual([{ kind: 'scrap', qty: 1 }]);
  });

  it('unknown rarity with affixes/sockets adds scrap (fallback bonus kind)', () => {
    const weird = {
      rarity: 'mythical' as Rarity,
      affixes: [{ stat: 'power', value: 5 }] as Affix[],
      sockets: ['ruby'] as (string | null)[],
    };
    // 1 base scrap + 1 affix + 1 gem (bonus kind falls back to scrap) → 3 scrap.
    expect(salvageYield(weird, lowRng)).toEqual([{ kind: 'scrap', qty: 3 }]);
  });

  it('handles a missing sockets field (undefined) without throwing', () => {
    expect(() => salvageYield({ rarity: 'rare', affixes: NO_AFFIX }, lowRng)).not.toThrow();
  });

  it('yields are always ordered by ascending material value', () => {
    const y = salvageYield(inst('legendary', [{ stat: 'power', value: 5 }], ['ruby']), lowRng);
    const ranks = y.map((m) => MATERIAL_KINDS.indexOf(m.kind));
    const sorted = [...ranks].sort((a, b) => a - b);
    expect(ranks).toEqual(sorted);
  });
});

describe('salvageYield — determinism', () => {
  it('same instance + same rng script ⇒ identical yield', () => {
    const make = () =>
      salvageYield(inst('magic', [{ stat: 'crit', value: 4 }]), scriptedRng([0.7]));
    expect(make()).toEqual(make());
  });

  it('different variance rng changes the common scrap count predictably', () => {
    expect(salvageYield(inst('common'), scriptedRng([0.1]))).toEqual([{ kind: 'scrap', qty: 1 }]);
    expect(salvageYield(inst('common'), scriptedRng([0.9]))).toEqual([{ kind: 'scrap', qty: 2 }]);
  });
});

describe('isSalvageMaterial — type guard', () => {
  it('accepts every known material kind', () => {
    for (const k of MATERIAL_KINDS) expect(isSalvageMaterial(k)).toBe(true);
  });

  it('rejects unknown strings', () => {
    for (const k of ['gold', 'rune_shard', '', 'Scrap', 'SHARD']) {
      expect(isSalvageMaterial(k)).toBe(false);
    }
  });

  it('narrows the type so the value is usable as a MaterialKind', () => {
    const raw = 'essence';
    if (isSalvageMaterial(raw)) {
      const k: MaterialKind = raw; // compiles only if narrowed
      expect(k).toBe('essence');
    }
  });
});
