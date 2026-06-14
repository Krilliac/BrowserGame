import { describe, expect, it } from 'vitest';
import { openDatabase } from './db/database.js';
import { loadContent } from './content.js';

/**
 * Rift modifiers are data-driven content: the DB (seeded from rift-modifiers.ts) is the pool a
 * tiered rift rolls from. The roll/aggregate math is unit-tested in rift-modifiers.test.ts; here we
 * cover that the rows round-trip into RiftModifierDef shape (incl. the descr→desc column rename).
 */
describe('content rift modifiers', () => {
  it('loads the seeded modifier pool', () => {
    const c = loadContent(openDatabase(':memory:'));
    expect(c.riftModifiers().length).toBe(8);
    const byId = new Map(c.riftModifiers().map((m) => [m.id, m]));
    expect(byId.get('berserk')).toMatchObject({
      name: 'Berserk',
      minTier: 1,
      mobDamageMult: 1.3,
      lootQuantityBonus: 0.4,
    });
    expect(byId.get('berserk')?.desc).toBeTruthy(); // descr column maps to .desc
  });

  it('a DB-added modifier loads', () => {
    const db = openDatabase(':memory:');
    db.prepare(
      'INSERT INTO rift_modifiers (id,name,descr,min_tier,mob_damage_mult,mob_hp_mult,mob_speed_mult,loot_quantity_bonus,xp_bonus) VALUES (?,?,?,?,?,?,?,?,?)',
    ).run('test_mod', 'Test', 'a test mutator', 4, 2, 1, 1, 0, 1);
    const m = loadContent(db)
      .riftModifiers()
      .find((x) => x.id === 'test_mod')!;
    expect(m).toMatchObject({ name: 'Test', minTier: 4, mobDamageMult: 2, xpBonus: 1 });
  });
});
