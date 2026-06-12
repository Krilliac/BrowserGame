import { describe, expect, it } from 'vitest';
import { openDatabase } from './database.js';
import { loadContent } from '../content.js';
import { isAbilityId } from '../../shared/combat.js';
import { NEW_SPELLBOOKS, NEW_MERCHANT_STOCK, ensureSpellTomeContent } from './seed-spells.js';

describe('seed-spells data — internal consistency', () => {
  it('every tome teaches a real ability and follows the tome_<ability> naming', () => {
    for (const [id, b] of Object.entries(NEW_SPELLBOOKS)) {
      expect(isAbilityId(b.teaches), id).toBe(true);
      expect(id).toBe(`tome_${b.teaches}`);
      expect(b.name.length, id).toBeGreaterThan(0);
      expect(b.color, id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(b.sell, id).toBeGreaterThan(0);
    }
  });

  it('every shelf line references a defined tome, priced above its sell value', () => {
    for (const s of NEW_MERCHANT_STOCK) {
      const book = NEW_SPELLBOOKS[s.item];
      expect(book, s.item).toBeDefined();
      expect(s.price, s.item).toBeGreaterThan(0);
      expect(s.price, s.item).toBeGreaterThan(book!.sell); // no buy-low/sell-high money pump
    }
  });

  it('the chase tomes (novas + biggest nukes) are drop-only — not on the shelf', () => {
    const stocked = new Set(NEW_MERCHANT_STOCK.map((s) => s.item));
    for (const id of [
      'tome_galeburst',
      'tome_earthshatter',
      'tome_starfall',
      'tome_maelstrom_orb',
    ]) {
      expect(stocked.has(id), id).toBe(false);
      expect(NEW_SPELLBOOKS[id], id).toBeDefined(); // still registered, so it drops
    }
  });
});

describe('ensureSpellTomeContent — DB upsert', () => {
  it('inserts the tome items and Merchant shelf rows (visible through the content layer)', () => {
    const db = openDatabase(':memory:');
    ensureSpellTomeContent(db);
    const c = loadContent(db);

    for (const [id, b] of Object.entries(NEW_SPELLBOOKS)) {
      const item = c.item(id);
      expect(item?.kind, id).toBe('spellbook');
      expect(item?.teaches, id).toBe(b.teaches);
    }
    const stock = c.vendorStock('town', 'Merchant');
    for (const s of NEW_MERCHANT_STOCK) {
      const line = stock.find((x) => x.itemId === s.item);
      expect(line?.price, s.item).toBe(s.price);
    }
    // The new abilities themselves are seeded by seed.ts's ABILITY_ORDER loop, tomes aside.
    expect(c.ability('maelstrom_orb')?.kind).toBe('projectile');
  });

  it('is idempotent — a second run adds no duplicate shelf rows', () => {
    const db = openDatabase(':memory:');
    ensureSpellTomeContent(db);
    ensureSpellTomeContent(db);
    const count = db
      .prepare(
        "SELECT COUNT(*) AS n FROM vendor_stock WHERE area_id = 'town' AND npc_name = 'Merchant' AND item_id = 'tome_razor_wind'",
      )
      .get() as { n: number };
    expect(count.n).toBe(1);
  });
});
