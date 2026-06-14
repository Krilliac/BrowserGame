import { describe, expect, it } from 'vitest';
import { openDatabase } from './db/database.js';
import { loadContent } from './content.js';
import { canCraft } from './crafting.js';

/**
 * Crafting recipes are data-driven content: the DB (seeded from crafting.ts DEFAULT_RECIPES) is the
 * runtime authority. The apply/affordability math is unit-tested in crafting.test.ts; here we cover
 * that the header + normalized I/O rows round-trip into CraftRecipe shape and feed the pure functions.
 */
describe('content crafting recipes', () => {
  it('round-trips the refinement ladder', () => {
    const c = loadContent(openDatabase(':memory:'));
    const byId = new Map(c.craftingRecipes().map((r) => [r.id, r]));
    expect(byId.get('refine_scrap')).toEqual({
      id: 'refine_scrap',
      name: 'Refine Scrap into Dust',
      inputs: [{ itemId: 'mat_scrap', qty: 3 }],
      outputs: [{ itemId: 'mat_dust', qty: 1 }],
    });
    expect(c.craftingRecipes().length).toBeGreaterThanOrEqual(5);
  });

  it('a loaded recipe drives the pure canCraft check', () => {
    const c = loadContent(openDatabase(':memory:'));
    const refine = c.craftingRecipes().find((r) => r.id === 'refine_scrap')!;
    expect(canCraft(refine, { mat_scrap: 3 })).toBe(true);
    expect(canCraft(refine, { mat_scrap: 2 })).toBe(false);
  });

  it('a DB-added recipe loads with its I/O', () => {
    const db = openDatabase(':memory:');
    db.prepare('INSERT INTO crafting_recipes (id,name) VALUES (?,?)').run('test_recipe', 'Test');
    db.prepare(
      'INSERT INTO crafting_recipe_io (recipe_id,role,item_id,qty,sort_order) VALUES (?,?,?,?,?)',
    ).run('test_recipe', 'input', 'mat_dust', 2, 0);
    db.prepare(
      'INSERT INTO crafting_recipe_io (recipe_id,role,item_id,qty,sort_order) VALUES (?,?,?,?,?)',
    ).run('test_recipe', 'output', 'rune_shard', 1, 0);
    const r = loadContent(db)
      .craftingRecipes()
      .find((x) => x.id === 'test_recipe')!;
    expect(r.inputs).toEqual([{ itemId: 'mat_dust', qty: 2 }]);
    expect(r.outputs).toEqual([{ itemId: 'rune_shard', qty: 1 }]);
  });
});
