import { describe, expect, it } from 'vitest';
import { World } from './world.js';
import { initGameDb } from './content.js';

initGameDb(':memory:');

/**
 * Monster spellcasting: caster mobs fire real spells (offensive, tagged with the ability id) and
 * support mobs self-buff. Driven through full ticks (aggro → telegraph → cast), with the player
 * levelled up so it survives long enough to observe the cast.
 */
describe('monster spellcasting', () => {
  it('a caster mob fires its spell as a hostile, ability-tagged projectile (cultist → shadow_bolt)', () => {
    const w = new World();
    const id = w.spawn('Bait');
    w.setLevel(id, 20); // beefy enough to survive while we watch
    w.teleport(id, 1000, 1000);
    expect(w.spawnMobAt(id, 'cultist')).toBe(true);

    let sawSpell = false;
    for (let i = 0; i < 120 && !sawSpell; i++) {
      w.tick(0.05);
      sawSpell = w
        .snapshot()
        .some(
          (e) => e.kind === 'projectile' && e.hostile === true && e.abilityId === 'shadow_bolt',
        );
    }
    expect(sawSpell).toBe(true);
  });

  it('a support mob self-buffs and reads as enraged (magma_crawler → War Cry)', () => {
    const w = new World();
    const id = w.spawn('Witness');
    w.setLevel(id, 20);
    w.teleport(id, 1000, 1000);
    expect(w.spawnMobAt(id, 'magma_crawler')).toBe(true);

    let enraged = false;
    for (let i = 0; i < 160 && !enraged; i++) {
      w.tick(0.05);
      const mob = w.snapshot().find((e) => e.kind === 'mob');
      enraged = !!mob && ((mob.flags ?? 0) & 64) !== 0; // bit 64 = might/haste self-buff
    }
    expect(enraged).toBe(true);
  });
});
