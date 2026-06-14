import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './db/database.js';
import { loadContent } from './content.js';
import { RARITY, DEFAULT_RARITY, applyRarityOverrides, type Rarity } from '../shared/items.js';

/**
 * Rarity tiers are TrinityCore-style content: the DB (seeded from DEFAULT_RARITY) is the runtime
 * authority for drop weights, stat multipliers, and colors. Both sides overlay the shared RARITY
 * table from their content source (server: DB; client: content packet). Restore defaults after each
 * test so the shared singleton never leaks across cases.
 */
afterEach(() => applyRarityOverrides({}));

describe('content rarity tiers', () => {
  it('exposes every rarity tier seeded from the defaults', () => {
    const c = loadContent(openDatabase(':memory:'));
    const tiers = c.rarityTiers();
    for (const [rarity, def] of Object.entries(DEFAULT_RARITY)) {
      expect(tiers[rarity as Rarity]).toEqual(def);
    }
  });

  it('overlays DB values onto the shared RARITY table', () => {
    const db = openDatabase(':memory:');
    db.prepare('UPDATE rarity_tiers SET weight = ?, color = ? WHERE rarity = ?').run(
      999,
      '#abcdef',
      'legendary',
    );
    const c = loadContent(db);
    applyRarityOverrides(c.rarityTiers());
    expect(RARITY.legendary.weight).toBe(999);
    expect(RARITY.legendary.color).toBe('#abcdef');
  });

  it('applyRarityOverrides({}) resets the table to the code defaults', () => {
    applyRarityOverrides({ legendary: { ...DEFAULT_RARITY.legendary, weight: 1 } });
    expect(RARITY.legendary.weight).toBe(1);
    applyRarityOverrides({});
    expect(RARITY.legendary.weight).toBe(DEFAULT_RARITY.legendary.weight);
  });
});
