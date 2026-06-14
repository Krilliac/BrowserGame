/**
 * Salvage / disenchant — the D2-cube-style "break junk gear into crafting materials" path.
 *
 * WHY this module exists: a Diablo-like floods the player with gear instances that aren't an upgrade.
 * Vendoring them for gold is the boring sink; salvaging turns the flood into a *crafting economy* —
 * every dropped item becomes raw materials you spend later (sockets, rerolls, upgrades). This makes
 * picking up white/blue trash worthwhile and gives the bag a second exit besides "sell".
 *
 * SCOPE / PURITY: this is a pure, framework-free reducer. It knows nothing about the World, the DB,
 * or the content tables — it maps an {@link ItemInstance}'s *abstract* properties (rarity, affixes,
 * sockets) to a list of *abstract* {@link MaterialKind} yields. The orchestrator wires the rest:
 *   - a `World.salvage(playerId, uid)` method that consumes the bag item and adds the yields,
 *   - a `/salvage` command,
 *   - and a mapping from each {@link MaterialKind} to a concrete content loot item id.
 * All randomness is injected via `rng: () => number` in [0,1) so every function here is deterministic
 * and unit-tested — same instance + same rng script ⇒ same yield, every time.
 */

import type { ItemInstance } from '../shared/items.js';

/**
 * Abstract crafting-material tiers, ascending in value: `scrap < dust < essence < shard`.
 *
 * They are deliberately *abstract* — the orchestrator maps each to a real content item id (suggested:
 * scrap ← common junk material, dust ← magic-tier material, essence ← rare/epic material, shard ←
 * legendary+/`rune_shard`). Keeping them abstract lets this pure module stay free of content ids.
 */
export type MaterialKind = 'scrap' | 'dust' | 'essence' | 'shard';

/** The material kinds in ascending value order — also the canonical sort/merge order for yields. */
export const MATERIAL_KINDS: MaterialKind[] = ['scrap', 'dust', 'essence', 'shard'];

/** A quantity of one material kind. Yields are returned as a list of these (one entry per kind). */
export interface MaterialYield {
  kind: MaterialKind;
  qty: number;
}

/**
 * The base material payout for each rarity, before per-affix / per-socket bonuses. Higher rarity →
 * more *and better* materials. Tuning rationale:
 *   - common    → 1 scrap            : whites are pure scrap fodder.
 *   - magic     → 1 scrap + 1 dust   : blues start yielding the next tier up.
 *   - rare      → 1 dust + 1 essence : yellows give a guaranteed essence.
 *   - epic      → 2 essence          : richer essence yield.
 *   - legendary → 1 essence + 1 shard: oranges are the only base source of the top-tier shard.
 *   - unique    → 1 essence + 1 shard: named drops salvage like a legendary.
 *   - corrupted → treated like epic (per spec): 2 essence.
 * The 1-2 RNG spread on the lowest tiers (see {@link salvageYield}) keeps white/blue salvage feeling
 * slightly variable without affecting the strict rarity-ordering of total value.
 *
 * NOTE: this is the *guaranteed floor* table. The actual common/magic scrap count gets a +0/+1 rng
 * nudge, and affixes/sockets layer bonus materials on top — both handled in {@link salvageYield}.
 */
const BASE_YIELD: Record<string, MaterialYield[]> = {
  common: [{ kind: 'scrap', qty: 1 }],
  magic: [
    { kind: 'scrap', qty: 1 },
    { kind: 'dust', qty: 1 },
  ],
  rare: [
    { kind: 'dust', qty: 1 },
    { kind: 'essence', qty: 1 },
  ],
  epic: [{ kind: 'essence', qty: 2 }],
  legendary: [
    { kind: 'essence', qty: 1 },
    { kind: 'shard', qty: 1 },
  ],
  unique: [
    { kind: 'essence', qty: 1 },
    { kind: 'shard', qty: 1 },
  ],
  // Corrupted gear is end-game-tier but not a guaranteed shard source — salvage it like an epic.
  corrupted: [{ kind: 'essence', qty: 2 }],
};

/**
 * The bonus material an affix or a socketed gem contributes, keyed by the item's *rarity tier band*.
 * WHY tier-banded: a richer item's modifiers should salvage into richer scraps — an affix on a
 * legendary is worth more raw material than an affix on a white. This is what makes "more valuable
 * items salvage richer" true beyond just the base table.
 */
const BONUS_KIND_BY_RARITY: Record<string, MaterialKind> = {
  common: 'scrap',
  magic: 'scrap',
  rare: 'dust',
  epic: 'essence',
  legendary: 'essence',
  unique: 'essence',
  corrupted: 'essence',
};

/**
 * Salvage a gear instance into crafting materials. **Deterministic** given `rng`.
 *
 * Algorithm:
 *   1. Start from the rarity's {@link BASE_YIELD} (unknown rarity → minimal 1 scrap, the safe floor).
 *   2. For common/magic, nudge the scrap count by +0 or +1 via one `rng()` draw (the 1-2 spread).
 *   3. For every affix and every *filled* socket, add one bonus material of the rarity's bonus kind
 *      (see {@link BONUS_KIND_BY_RARITY}) — modifiers and gems carry extra crafting value.
 *   4. Merge same-kind entries into a single entry, drop any zero-qty, and return ordered by
 *      ascending material value ({@link MATERIAL_KINDS}).
 *   5. Guarantee at least one material (never return an empty list).
 *
 * Only the fields it reads are required, so callers can pass a partial instance.
 *
 * @param inst gear being salvaged — only `rarity`, `affixes`, and `sockets` are consulted.
 * @param rng  injected uniform source in [0,1); defaults to Math.random for non-deterministic callers.
 */
export function salvageYield(
  inst: Pick<ItemInstance, 'rarity' | 'affixes' | 'sockets'>,
  rng: () => number = Math.random,
): MaterialYield[] {
  // Accumulate into a per-kind tally so merging same-kind yields is free.
  const tally: Record<MaterialKind, number> = { scrap: 0, dust: 0, essence: 0, shard: 0 };

  // 1. Base table — unknown/odd rarity degrades gracefully to a single scrap.
  const base = BASE_YIELD[inst.rarity] ?? [{ kind: 'scrap', qty: 1 }];
  for (const y of base) tally[y.kind] += y.qty;

  // 2. Low-tier variance: common/magic roll an extra scrap half the time (the "1-2 scrap" spread).
  //    One rng() draw keeps the script predictable for tests; higher tiers don't draw here.
  if (inst.rarity === 'common' || inst.rarity === 'magic') {
    if (rng() >= 0.5) tally.scrap += 1;
  }

  // 3. Per-affix and per-filled-socket bonus material. Bonus kind scales with the item's rarity band,
  //    so a legendary's affixes salvage into essence while a white's salvage into scrap.
  const bonusKind = BONUS_KIND_BY_RARITY[inst.rarity] ?? 'scrap';
  const affixCount = inst.affixes?.length ?? 0;
  const gemCount = (inst.sockets ?? []).filter((s) => s !== null && s !== undefined).length;
  tally[bonusKind] += affixCount + gemCount;

  // 4. Emit in ascending-value order, skipping empty kinds; merge is implicit via the tally.
  const out: MaterialYield[] = [];
  for (const kind of MATERIAL_KINDS) {
    if (tally[kind] > 0) out.push({ kind, qty: tally[kind] });
  }

  // 5. Always return at least one material — a pathological zero-yield (shouldn't happen) floors to scrap.
  if (out.length === 0) out.push({ kind: 'scrap', qty: 1 });
  return out;
}

/** Type guard: is `kind` one of the known {@link MaterialKind} values? */
export function isSalvageMaterial(kind: string): kind is MaterialKind {
  return (MATERIAL_KINDS as string[]).includes(kind);
}
