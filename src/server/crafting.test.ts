import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RECIPES,
  MAT_SCRAP,
  MAT_DUST,
  MAT_ESSENCE,
  RUNE_SHARD,
  canCraft,
  applyCraft,
  recipeById,
  type CraftRecipe,
} from './crafting.js';

describe('DEFAULT_RECIPES well-formedness', () => {
  it('has unique recipe ids', () => {
    const ids = DEFAULT_RECIPES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every recipe has a name, non-empty inputs and outputs, all positive integer qtys', () => {
    for (const r of DEFAULT_RECIPES) {
      expect(r.name.length).toBeGreaterThan(0);
      expect(r.inputs.length).toBeGreaterThan(0);
      expect(r.outputs.length).toBeGreaterThan(0);
      for (const io of [...r.inputs, ...r.outputs]) {
        expect(io.itemId.length).toBeGreaterThan(0);
        expect(io.qty).toBeGreaterThan(0);
        expect(Number.isInteger(io.qty)).toBe(true);
      }
    }
  });

  it('contains the three-step refinement ladder', () => {
    expect(recipeById('refine_scrap')).toBeDefined();
    expect(recipeById('refine_dust')).toBeDefined();
    expect(recipeById('refine_essence')).toBeDefined();
  });
});

describe('recipeById', () => {
  it('returns the recipe for a known id', () => {
    const r = recipeById('refine_scrap');
    expect(r?.id).toBe('refine_scrap');
    expect(r?.inputs[0]?.itemId).toBe(MAT_SCRAP);
  });

  it('returns undefined for an unknown id', () => {
    expect(recipeById('nope')).toBeUndefined();
  });
});

describe('canCraft', () => {
  const refineScrap = recipeById('refine_scrap') as CraftRecipe;

  it('is true at exactly the required quantity', () => {
    expect(canCraft(refineScrap, { [MAT_SCRAP]: 3 })).toBe(true);
  });

  it('is true with a surplus', () => {
    expect(canCraft(refineScrap, { [MAT_SCRAP]: 10 })).toBe(true);
  });

  it('is false one short', () => {
    expect(canCraft(refineScrap, { [MAT_SCRAP]: 2 })).toBe(false);
  });

  it('treats a missing material as zero', () => {
    expect(canCraft(refineScrap, {})).toBe(false);
  });

  it('requires ALL inputs of a multi-input recipe (synthetic)', () => {
    const multi: CraftRecipe = {
      id: 'test_multi',
      name: 'Test Multi',
      inputs: [
        { itemId: MAT_SCRAP, qty: 2 },
        { itemId: MAT_DUST, qty: 1 },
      ],
      outputs: [{ itemId: MAT_ESSENCE, qty: 1 }],
    };
    expect(canCraft(multi, { [MAT_SCRAP]: 2 })).toBe(false); // dust missing
    expect(canCraft(multi, { [MAT_SCRAP]: 2, [MAT_DUST]: 1 })).toBe(true);
  });

  it('does not mutate the inventory it inspects', () => {
    const have = { [MAT_SCRAP]: 3 };
    canCraft(refineScrap, have);
    expect(have).toEqual({ [MAT_SCRAP]: 3 });
  });
});

describe('applyCraft', () => {
  const refineScrap = recipeById('refine_scrap') as CraftRecipe;

  it('subtracts inputs and adds outputs, returning true', () => {
    const have: Record<string, number> = { [MAT_SCRAP]: 5 };
    expect(applyCraft(refineScrap, have)).toBe(true);
    expect(have).toEqual({ [MAT_SCRAP]: 2, [MAT_DUST]: 1 });
  });

  it('deletes a key that hits exactly zero', () => {
    const have: Record<string, number> = { [MAT_SCRAP]: 3 };
    expect(applyCraft(refineScrap, have)).toBe(true);
    expect(MAT_SCRAP in have).toBe(false);
    expect(have).toEqual({ [MAT_DUST]: 1 });
  });

  it('returns false and does NOT mutate when inputs are insufficient', () => {
    const have: Record<string, number> = { [MAT_SCRAP]: 2 };
    const snapshot = { ...have };
    expect(applyCraft(refineScrap, have)).toBe(false);
    expect(have).toEqual(snapshot);
  });

  it('returns false on an empty inventory without adding output keys', () => {
    const have: Record<string, number> = {};
    expect(applyCraft(refineScrap, have)).toBe(false);
    expect(have).toEqual({});
  });

  it('never produces a negative quantity', () => {
    const have: Record<string, number> = { [MAT_SCRAP]: 3 };
    applyCraft(refineScrap, have);
    for (const v of Object.values(have)) expect(v).toBeGreaterThan(0);
  });

  it('accumulates onto a pre-existing output stack', () => {
    const have: Record<string, number> = { [MAT_SCRAP]: 3, [MAT_DUST]: 4 };
    expect(applyCraft(refineScrap, have)).toBe(true);
    expect(have).toEqual({ [MAT_DUST]: 5 });
  });
});

describe('refinement ladder end-to-end', () => {
  it('walks 9 scrap → 3 dust → 1 essence via repeated crafts', () => {
    const refineScrap = recipeById('refine_scrap') as CraftRecipe;
    const refineDust = recipeById('refine_dust') as CraftRecipe;
    const have: Record<string, number> = { [MAT_SCRAP]: 9 };

    // 9 scrap → 3 dust
    expect(applyCraft(refineScrap, have)).toBe(true);
    expect(applyCraft(refineScrap, have)).toBe(true);
    expect(applyCraft(refineScrap, have)).toBe(true);
    expect(applyCraft(refineScrap, have)).toBe(false); // out of scrap
    expect(have).toEqual({ [MAT_DUST]: 3 });

    // 3 dust → 1 essence
    expect(applyCraft(refineDust, have)).toBe(true);
    expect(have).toEqual({ [MAT_ESSENCE]: 1 });
  });

  it('walks the full ladder 27 scrap → 1 rune_shard', () => {
    const refineScrap = recipeById('refine_scrap') as CraftRecipe;
    const refineDust = recipeById('refine_dust') as CraftRecipe;
    const refineEssence = recipeById('refine_essence') as CraftRecipe;
    const have: Record<string, number> = { [MAT_SCRAP]: 27 };

    for (let i = 0; i < 9; i++) expect(applyCraft(refineScrap, have)).toBe(true); // → 9 dust
    for (let i = 0; i < 3; i++) expect(applyCraft(refineDust, have)).toBe(true); // → 3 essence
    expect(applyCraft(refineEssence, have)).toBe(true); // → 1 shard

    expect(have).toEqual({ [RUNE_SHARD]: 1 });
  });
});
