import { describe, expect, it, beforeEach } from 'vitest';
import { initGameDb, getDb, reloadContent } from './content.js';
import { CreatureSpawnFlags } from '../shared/spawn-flags.js';
import { World } from './world.js';

initGameDb(':memory:');

/**
 * Volatile elites: a champion with the `explode_dmg` modifier detonates on death, hitting players
 * within EXPLODE_RADIUS for a multiple of its normal hit. To make the roll deterministic the test
 * collapses the elite-modifier roster to a single Volatile entry — so every forced champion is
 * volatile regardless of RNG — then forces one via a `creature_spawns` ELITE flag, kills it with an
 * injected lethal DoT, and checks who got caught in the blast.
 */
describe('volatile elite death-explosion', () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM elite_modifiers').run();
    db.prepare(
      'INSERT INTO elite_modifiers (id,name,hp_mult,damage_mult,speed_mult,explode_dmg,sort_order) VALUES (?,?,?,?,?,?,?)',
    ).run('volatile', 'Volatile', 1.0, 1.0, 1.0, 4.0, 0);
    db.prepare('DELETE FROM creature_spawns').run();
    db.prepare(
      'INSERT INTO creature_spawns (area_id,template_id,x,y,flags) VALUES (?,?,?,?,?)',
    ).run('crypt', 'skeleton', 90, 90, CreatureSpawnFlags.ELITE);
    reloadContent();
  });

  /** Build a crypt world, populate it, and return the forced Volatile elite's id (warped to center). */
  function volatileEliteWorld(): { w: World; eliteId: number } {
    const w = new World(2000, 2000, { x: 1000, y: 1000 }, undefined, 'crypt');
    w.populateMobs('crypt');
    // The forced ELITE spawn carries the only modifier (Volatile), so its name is prefixed.
    const elite = w
      .snapshot()
      .filter((e) => e.kind === 'mob')
      .find((m) => m.name.startsWith('Volatile'));
    if (!elite) throw new Error('no volatile elite spawned');
    // Warp it to open center, away from the rest of the populated roster, so only our placed
    // players are anywhere near the blast.
    w.teleportMob(elite.id, 1000, 1000);
    return { w, eliteId: elite.id };
  }

  it('damages a player inside the blast radius and spares one outside it', () => {
    const { w, eliteId } = volatileEliteWorld();
    w.boostMobHp(eliteId, 1); // one point of DoT will kill it

    const near = w.spawn('Near');
    const far = w.spawn('Far');
    w.teleport(near, 1000, 1120); // 120px from the corpse — inside EXPLODE_RADIUS (150), out of melee
    w.teleport(far, 1000, 1600); // 600px away — well outside the blast

    const nearBefore = w.playerStats(near)!.hp;
    const farBefore = w.playerStats(far)!.hp;

    // Lethal injected DoT: the 1-HP elite dies this tick and detonates.
    w.injectMobStatus(eliteId, 'ignite', 3000, 100);
    w.tick(0.2);

    const nearAfter = w.playerStats(near)!.hp;
    const farAfter = w.playerStats(far)!.hp;

    expect(w.snapshot().find((e) => e.id === eliteId)).toBeUndefined(); // the elite is gone (dead)
    expect(nearAfter).toBeLessThan(nearBefore); // caught in the blast
    expect(farAfter).toBe(farBefore); // out of range — untouched
  });

  it('does not explode a non-volatile elite (explode_dmg 0)', () => {
    // Swap the roster to a non-volatile modifier and rebuild.
    const db = getDb();
    db.prepare('UPDATE elite_modifiers SET explode_dmg = 0 WHERE id = ?').run('volatile');
    reloadContent();

    const { w, eliteId } = volatileEliteWorld();
    w.boostMobHp(eliteId, 1);
    const near = w.spawn('Bystander');
    w.teleport(near, 1000, 1120);
    const before = w.playerStats(near)!.hp;

    w.injectMobStatus(eliteId, 'ignite', 3000, 100);
    w.tick(0.2);

    expect(w.playerStats(near)!.hp).toBe(before); // no blast: the bystander is unharmed
  });
});
