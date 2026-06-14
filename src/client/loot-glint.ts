/**
 * Loot-glint descriptor: turns an item's rarity into the cosmetic "this drop matters" read on the
 * ground — the glow color, how strongly it pulses, and whether the drop is exciting enough to wear a
 * floating name label (the ARPG loot-pop feel). Pure and framework-free so the renderer can stay a
 * thin consumer and the mapping is unit-tested (loot-glint.test.ts) instead of eyeballed.
 */
import { RARITY, RARITY_ORDER, type Rarity } from '../shared/items.js';

export interface LootGlint {
  /** Glow color — the rarity color, or a neutral white for material/non-gear drops. */
  color: string;
  /** Glow strength 0..1: 0 = no glint (plain materials/common), rising with rarity. */
  intensity: number;
  /** Whether the drop deserves a floating name label (reserved for the genuinely exciting tiers). */
  label: boolean;
}

/** Neutral glow for materials and unknown/absent rarities — present but quiet. */
const NEUTRAL = '#dfe7f0';

/**
 * Glint intensity for a normal-roll rarity, keyed off RARITY_ORDER so it tracks the real tier ladder
 * (common → magic → rare → epic → legendary). Common is flat 0 (no glint — the dopamine gate); each
 * step up glows harder. Off-ladder tiers (corrupted, unique) are handled explicitly below.
 */
function ladderIntensity(rarity: Rarity): number {
  const i = RARITY_ORDER.indexOf(rarity);
  if (i <= 0) return 0; // common (or not on the normal ladder) → no glint here
  return i / (RARITY_ORDER.length - 1); // magic ≈ 0.25 … legendary = 1
}

/**
 * Resolve the glint for a ground drop. `rarity` is the gear instance's rarity (undefined for plain
 * material/currency stacks). Materials get a faint neutral glow with no label; common gear gets none;
 * rare-and-better gear glows in its rarity color and — from epic up, plus uniques/corrupted — earns
 * a name label.
 */
export function lootGlint(rarity: string | undefined): LootGlint {
  if (!rarity) return { color: NEUTRAL, intensity: 0.12, label: false };
  const def = RARITY[rarity as Rarity];
  if (!def) return { color: NEUTRAL, intensity: 0.12, label: false }; // unknown tier (older client)

  // Uniques and corrupted sit off the weighted ladder but are top-shelf finds — always loud + labeled.
  if (rarity === 'unique' || rarity === 'corrupted') {
    return { color: def.color, intensity: 1, label: true };
  }
  const intensity = ladderIntensity(rarity as Rarity);
  // Epic and legendary are the "stop and grab it" tiers that warrant a label.
  const label = rarity === 'epic' || rarity === 'legendary';
  return { color: def.color, intensity, label };
}
