/**
 * Crafting / material refinement.
 *
 * WHY: the salvage system breaks junk gear into crafting MATERIALS held in
 * `player.loot` (`mat_scrap`, `mat_dust`, `mat_essence`, `rune_shard`, in
 * ascending value). Without a sink those materials pile up and feel worthless.
 * This module turns them into a clean upgrade ladder — combine many of a lower
 * tier into one of the next — plus a couple of terminal recipes, so collecting
 * scrap is always progress toward something.
 *
 * DESIGN: this module is intentionally PURE. It imports nothing from World, the
 * DB, or content; it only reads/mutates plain `Record<string, number>`
 * inventories handed to it. That keeps it trivially unit-testable and lets the
 * caller (`World.craft`) own all I/O — read `player.loot` into a record, apply,
 * write back. Every recipe is deterministic: fixed inputs → fixed outputs, no
 * rng. Outputs are restricted to the four known material ids so this module
 * never needs to know about gear/item ids it can't see.
 */

/** Known crafting-material item ids, lowest → highest value. */
export const MAT_SCRAP = 'mat_scrap';
export const MAT_DUST = 'mat_dust';
export const MAT_ESSENCE = 'mat_essence';
export const RUNE_SHARD = 'rune_shard';

/**
 * A single craftable recipe: a fixed bundle of inputs consumed to produce a
 * fixed bundle of outputs. Both lists are non-empty and quantities are positive
 * (enforced by tests, not the type system). Recipes are data — `DEFAULT_RECIPES`
 * is the seed source a DB loader can mirror.
 */
export interface CraftRecipe {
  id: string;
  name: string;
  inputs: { itemId: string; qty: number }[];
  outputs: { itemId: string; qty: number }[];
}

/**
 * The seed recipe set. The DB content table should mirror this shape so the
 * game can be re-tuned in SQL without code changes (see WIRING GUIDE).
 *
 * The core is a 3:1 refinement LADDER — three of a tier fuse into one of the
 * next. 3:1 (rather than 2:1) makes each tier meaningfully scarcer than the
 * last, so a `rune_shard` represents 27 scrap and feels earned. Two terminal
 * recipes give alternate, slightly worse conversions so a player who is short on
 * one tier still has a path forward.
 */
export const DEFAULT_RECIPES: CraftRecipe[] = [
  // --- Refinement ladder: 3 of a tier → 1 of the next. ---
  {
    id: 'refine_scrap',
    name: 'Refine Scrap into Dust',
    inputs: [{ itemId: MAT_SCRAP, qty: 3 }],
    outputs: [{ itemId: MAT_DUST, qty: 1 }],
  },
  {
    id: 'refine_dust',
    name: 'Refine Dust into Essence',
    inputs: [{ itemId: MAT_DUST, qty: 3 }],
    outputs: [{ itemId: MAT_ESSENCE, qty: 1 }],
  },
  {
    id: 'refine_essence',
    name: 'Refine Essence into Rune Shard',
    inputs: [{ itemId: MAT_ESSENCE, qty: 3 }],
    outputs: [{ itemId: RUNE_SHARD, qty: 1 }],
  },

  // --- Terminal recipes: alternate sinks, deliberately less efficient than the
  // ladder so the ladder stays the optimal path. ---
  {
    // 5 essence → 1 shard. Worse than the 3:1 ladder, but lets a player who has
    // over-invested in essence cash out without first going through dust math.
    id: 'forge_shard_from_essence',
    name: 'Forge Rune Shard from Essence',
    inputs: [{ itemId: MAT_ESSENCE, qty: 5 }],
    outputs: [{ itemId: RUNE_SHARD, qty: 1 }],
  },
  {
    // Bulk salvage: dump a big pile of scrap straight to essence. 12 scrap → 1
    // essence is worse than laddering (which costs 9), the convenience tax for
    // skipping the intermediate step.
    id: 'bulk_refine_scrap',
    name: 'Bulk-Refine Scrap into Essence',
    inputs: [{ itemId: MAT_SCRAP, qty: 12 }],
    outputs: [{ itemId: MAT_ESSENCE, qty: 1 }],
  },
];

/** Fast id → recipe index built once from `DEFAULT_RECIPES`. */
const RECIPE_BY_ID: ReadonlyMap<string, CraftRecipe> = new Map(
  DEFAULT_RECIPES.map((r) => [r.id, r] as const),
);

/** Look up a seed recipe by id. Returns `undefined` for unknown ids. */
export function recipeById(id: string): CraftRecipe | undefined {
  return RECIPE_BY_ID.get(id);
}

/**
 * True iff `have` contains every input of `recipe` in sufficient quantity.
 * A missing key reads as 0. Pure — never mutates `have`.
 */
export function canCraft(recipe: CraftRecipe, have: Readonly<Record<string, number>>): boolean {
  for (const input of recipe.inputs) {
    // `?? 0`: absent material counts as zero on hand.
    if ((have[input.itemId] ?? 0) < input.qty) return false;
  }
  return true;
}

/**
 * Apply `recipe` to `have` in place.
 *
 * If `canCraft` passes: subtract every input, add every output, delete any key
 * that lands at exactly 0 (keeps inventories tidy — no `mat_scrap: 0` litter),
 * and return `true`. If it fails: return `false` and leave `have` UNTOUCHED.
 *
 * WHY check-then-mutate in two passes: we validate the whole recipe before
 * touching anything so a partially-affordable recipe can never leave the
 * inventory half-spent or any key negative. This is the simulation-boundary
 * validation the project mandates.
 */
export function applyCraft(recipe: CraftRecipe, have: Record<string, number>): boolean {
  if (!canCraft(recipe, have)) return false;

  // Subtract inputs. Guaranteed non-negative because canCraft already passed.
  for (const input of recipe.inputs) {
    const next = (have[input.itemId] ?? 0) - input.qty;
    if (next <= 0) delete have[input.itemId];
    else have[input.itemId] = next;
  }

  // Add outputs. An output may re-create a key we just deleted (e.g. a recipe
  // that both consumes and produces the same id) — additive, so it's correct.
  for (const output of recipe.outputs) {
    have[output.itemId] = (have[output.itemId] ?? 0) + output.qty;
  }

  return true;
}
