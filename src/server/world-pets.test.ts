import { describe, expect, it, beforeEach } from 'vitest';
import { initGameDb, getDb, reloadContent } from './content.js';
import { areaWorld } from './test-support.js';
import type { PlayerSave } from './world.js';

initGameDb(':memory:');

/**
 * Pets — the Diablo/Pokémon taming line: weaken a `tameable` creature below 30% HP, cast Tame, and it
 * becomes your persistent pet (reuses the minion AI + friendly-creature rendering). One pet at a time;
 * it follows across areas (saved) and is lost if it dies. 'wolf' is seeded tameable.
 */
describe('pets — taming', () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM creature_spawns').run();
    // A forced wolf (tameable) and a forced skeleton (not tameable) in the wilderness.
    db.prepare(
      'INSERT INTO creature_spawns (area_id,template_id,x,y,flags) VALUES (?,?,?,?,?)',
    ).run('wilderness', 'wolf', 100, 100, 0);
    reloadContent();
  });

  /** Build a wilderness world with the forced wolf, a player who knows Tame, both co-located. */
  function tamerWorld(): {
    w: ReturnType<typeof areaWorld>;
    id: number;
    wolfId: number;
    wx: number;
    wy: number;
  } {
    const w = areaWorld('wilderness');
    w.populateMobs('wilderness');
    const wolf = w.snapshot().find((e) => e.kind === 'mob' && e.name === 'Gloom Wolf')!;
    const id = w.spawn('Beastmaster');
    w.giveItem(id, 'tome_taming', 1);
    w.learn(id, 'tome_taming');
    w.teleport(id, wolf.x, wolf.y);
    return { w, id, wolfId: wolf.id, wx: wolf.x, wy: wolf.y };
  }

  const petCount = (w: ReturnType<typeof areaWorld>) =>
    w.snapshot().filter((e) => e.kind === 'mob' && e.friendly).length;

  it('tames a weakened tameable beast into a pet', () => {
    const { w, id, wolfId } = tamerWorld();
    w.setMobHp(wolfId, 5); // ~10% of the wolf's HP — weak enough
    expect(w.petStatus(id)).toContain('no pet');
    w.cast(id, 'tame', 1, 0);
    expect(w.petStatus(id)).toContain('Gloom Wolf');
    expect(petCount(w)).toBe(1); // the pet now fights at your side
    // The wild wolf is gone (captured).
    expect(w.snapshot().some((e) => e.kind === 'mob' && !e.friendly && e.id === wolfId)).toBe(
      false,
    );
  });

  it('refuses to tame a healthy beast (must weaken it first)', () => {
    const { w, id } = tamerWorld(); // wolf at full HP
    w.cast(id, 'tame', 1, 0);
    expect(w.petStatus(id)).toContain('no pet');
    expect(petCount(w)).toBe(0);
  });

  it('a pet persists across an area crossing', () => {
    const { w, id, wolfId } = tamerWorld();
    w.setMobHp(wolfId, 5);
    w.cast(id, 'tame', 1, 0);
    const save: PlayerSave = w.exportPlayer(id)!;
    expect(save.pet?.templateId).toBe('wolf');

    const dest = areaWorld('town');
    dest.importPlayer(id, save, 200, 200);
    expect(dest.petStatus(id)).toContain('Gloom Wolf');
    expect(petCount(dest)).toBe(1); // re-spawned at the player's side
  });

  it('dismiss releases the pet', () => {
    const { w, id, wolfId } = tamerWorld();
    w.setMobHp(wolfId, 5);
    w.cast(id, 'tame', 1, 0);
    expect(petCount(w)).toBe(1);
    expect(w.dismissPet(id)).toContain('release');
    expect(petCount(w)).toBe(0);
    expect(w.petStatus(id)).toContain('no pet');
  });
});
