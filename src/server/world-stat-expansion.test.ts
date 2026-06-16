/**
 * Stat-expansion integration tests (Slice 4).
 *
 * Each test equips an item with a hand-crafted affix, runs recomputeStats (implicit in
 * World.equip), then reads the player's stats via playerStats() to confirm the new Slice 4
 * fields — elemDamage, penetration, ailmentDuration, ailmentMagnitude, and chainAdd — are
 * sourced correctly from gear affixes (not only from gems).
 *
 * Seeding test: verifies that firedmg (a new Slice 4 key) is present in the affix_ranges
 * table seeded by ensureAffixes / loadContent, so it lands on existing DBs.
 */
import { describe, expect, it } from 'vitest';
import { type PlayerSave, World } from './world.js';
import { initGameDb, loadContent } from './content.js';
import { openDatabase } from './db/database.js';
import { type AffixStat, type ItemInstance } from '../shared/items.js';

initGameDb(':memory:');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal PlayerSave skeleton — only the fields that matter for equip tests. */
const BASE: Omit<PlayerSave, 'gear' | 'equipment' | 'loot'> = {
  name: 'StatTest',
  hue: 0,
  hp: 100,
  mana: 100,
  level: 1,
  xp: 0,
  gold: 0,
  god: false,
  quests: [],
  questsDone: [],
};

/** Build an iron_sword ItemInstance with a single hand-authored affix. */
function swordWithAffix(uid: number, stat: AffixStat, value: number): ItemInstance {
  return {
    uid,
    baseId: 'iron_sword',
    rarity: 'magic',
    power: 0,
    hp: 0,
    affixes: [{ stat, value }],
    sockets: [],
  };
}

/** Spawn a fresh World, import a player with one piece of gear, equip it, return the world. */
function worldWithEquippedAffix(stat: AffixStat, value: number): { w: World; id: number } {
  const w = new World();
  const id = 1;
  const inst = swordWithAffix(1, stat, value);
  w.importPlayer(id, { ...BASE, loot: [], gear: [inst], equipment: {} }, 100, 100);
  w.equip(id, 1); // triggers recomputeStats
  return { w, id };
}

// ---------------------------------------------------------------------------
// Affix seeding (content-affixes style)
// ---------------------------------------------------------------------------

describe('stat expansion — affix seeding', () => {
  it('firedmg affix range is present after ensureAffixes seeds a fresh DB', () => {
    const db = openDatabase(':memory:');
    const ranges = loadContent(db).affixRanges();
    expect(ranges.firedmg).toBeDefined();
    expect(ranges.firedmg!.min).toBeGreaterThan(0);
    expect(ranges.firedmg!.max).toBeGreaterThanOrEqual(ranges.firedmg!.min);
  });

  it('ailmentmag affix range is present after seeding', () => {
    const db = openDatabase(':memory:');
    const ranges = loadContent(db).affixRanges();
    expect(ranges.ailmentmag).toBeDefined();
  });

  it('penetration affix range is present after seeding', () => {
    const db = openDatabase(':memory:');
    const ranges = loadContent(db).affixRanges();
    expect(ranges.penetration).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Equip → recompute → playerStats path
// ---------------------------------------------------------------------------

describe('stat expansion — equip → playerStats', () => {
  it('firedmg affix value=6 → elemDamage.fire ≈ 0.06', () => {
    const { w, id } = worldWithEquippedAffix('firedmg', 6);
    const stats = w.playerStats(id)!;
    expect(stats.elemDamage.fire).toBeCloseTo(0.06, 5);
  });

  it('penetration affix value=5 → penetration ≈ 0.05', () => {
    const { w, id } = worldWithEquippedAffix('penetration', 5);
    const stats = w.playerStats(id)!;
    expect(stats.penetration).toBeCloseTo(0.05, 5);
  });

  it('chain affix value=1 → chainAdd rises by 1 (non-gem affix source)', () => {
    const w = new World();
    const id = 2;
    // Import without the item first to capture the baseline chainAdd.
    w.importPlayer(
      id,
      { ...BASE, name: 'ChainAffix', loot: [], gear: [], equipment: {} },
      100,
      100,
    );
    const chainBefore = w.playerStats(id)!.chainAdd;

    // Now add a sword with chain=1 to the bag and equip it.
    const inst = swordWithAffix(10, 'chain', 1);
    w.importPlayer(
      id,
      { ...BASE, name: 'ChainAffix', loot: [], gear: [inst], equipment: {} },
      100,
      100,
    );
    w.equip(id, 10);
    expect(w.playerStats(id)!.chainAdd).toBe(chainBefore + 1);
  });

  it('ailmentmag affix value=8 → ailmentMagnitude ≈ 0.08', () => {
    const { w, id } = worldWithEquippedAffix('ailmentmag', 8);
    const stats = w.playerStats(id)!;
    expect(stats.ailmentMagnitude).toBeCloseTo(0.08, 5);
  });
});
