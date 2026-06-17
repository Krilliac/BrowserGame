import { describe, expect, it, beforeEach } from 'vitest';
import { initGameDb, getDb, reloadContent } from './content.js';
import { areaWorld } from './test-support.js';
import { World, type PlayerSave } from './world.js';
import { getContent } from './content.js';

initGameDb(':memory:');

/**
 * Pet bonding: a tamed pet earns bond XP from kills its owner shares with it, climbing bond TIERS
 * that scale its HP + damage above the owner-level base. The top tier (PET_MAX_TIER = 5) is its
 * EVOLUTION. Progress persists on the save; it is lost only if the pet dies.
 */
describe('pets — bonding levels & evolution', () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM creature_spawns').run();
    db.prepare('DELETE FROM area_mobs WHERE area_id = ?').run('wilderness'); // no random scatter
    db.prepare(
      'INSERT INTO creature_spawns (area_id,template_id,x,y,flags) VALUES (?,?,?,?,?)',
    ).run('wilderness', 'wolf', 100, 100, 0);
    reloadContent();
  });

  /** A seeded wilderness world (deterministic combat) with a player who has just tamed the wolf. */
  function tamed(): { w: World; id: number } {
    const area = getContent().area('wilderness')!;
    const w = new World(
      area.width,
      area.height,
      area.spawn,
      undefined,
      'wilderness',
      undefined,
      0,
      1,
    );
    w.populateMobs('wilderness');
    const wolf = w.snapshot().find((e) => e.kind === 'mob' && e.name === 'Gloom Wolf')!;
    const id = w.spawn('Beastmaster');
    w.giveItem(id, 'tome_taming', 1);
    w.learn(id, 'tome_taming');
    w.teleport(id, wolf.x, wolf.y);
    w.setMobHp(wolf.id, 5);
    w.cast(id, 'tame', 1, 0);
    return { w, id };
  }

  it('a freshly tamed pet starts at bond level 0', () => {
    const { w, id } = tamed();
    expect(w.petStatus(id)).toContain('bond level 0');
    expect(w.exportPlayer(id)!.pet).toMatchObject({ templateId: 'wolf', xp: 0, tier: 0 });
    // The pet's bond tier is surfaced in the snapshot (0 for a fresh pet) for the client marker.
    expect(w.snapshot().find((e) => e.kind === 'mob' && e.friendly)!.petTier).toBe(0);
  });

  it('a pet earns bond XP from a kill its owner shares', () => {
    const { w, id } = tamed();
    const me = w.playerStats(id)!;
    w.spawnMobAt(id, 'bat');
    const bat = w.snapshot().find((e) => e.kind === 'mob' && !e.friendly)!;
    w.teleportMob(bat.id, me.x, me.y); // drop the victim right on the pet
    w.setMobHp(bat.id, 1); // one landed hit kills it
    for (let t = 0; t < 160; t++) w.tick(0.05); // deterministic (fixed seed) — the pet finishes it
    expect(w.exportPlayer(id)!.pet!.xp).toBeGreaterThan(0);
  });

  it('restores bond progress from a save and scales an evolved pet up', () => {
    const { w, id } = tamed();
    const tier0Save = w.exportPlayer(id)!;
    // Single-player test worlds: the only friendly creature in the snapshot is this player's pet.
    const petHp = (world: World): number =>
      world.snapshot().find((e) => e.kind === 'mob' && e.friendly)!.hp;

    // Re-import the same character into a fresh world — first at tier 0, then fully evolved.
    const a = areaWorld('town');
    a.importPlayer(id, tier0Save, 200, 200);
    const hp0 = petHp(a);

    const evolvedSave: PlayerSave = {
      ...tier0Save,
      pet: { templateId: tier0Save.pet!.templateId, xp: 300, tier: 5 },
    };
    const b = areaWorld('town');
    b.importPlayer(id, evolvedSave, 200, 200);
    expect(b.petStatus(id)).toContain('EVOLVED');
    expect(petHp(b)).toBeGreaterThan(hp0); // +18%/tier ⇒ a tier-5 pet is markedly tougher
    // The evolved tier is surfaced in the snapshot so the client draws the evolved flourish.
    expect(b.snapshot().find((e) => e.kind === 'mob' && e.friendly)!.petTier).toBe(5);
  });

  it('evolving a pet tallies petsEvolved and unlocks the Beastmaster achievement', () => {
    // Borrow a valid save, then put its pet one kill short of evolution (avoids grinding 300 kills).
    const seed = tamed();
    const save = seed.w.exportPlayer(seed.id)!;
    save.pet = { templateId: 'wolf', xp: 5 * 60 - 1, tier: 4 }; // 299 xp, tier 4 — on the brink

    const area = getContent().area('wilderness')!;
    const w = new World(
      area.width,
      area.height,
      area.spawn,
      undefined,
      'wilderness',
      undefined,
      0,
      1,
    );
    const id = w.spawn('Evolver');
    const me = w.playerStats(id)!;
    w.importPlayer(id, save, me.x, me.y);
    expect(w.exportPlayer(id)!.petsEvolved ?? 0).toBe(0);

    // One shared kill tips the pet from tier 4 to tier 5 (evolution).
    w.spawnMobAt(id, 'bat');
    const bat = w.snapshot().find((e) => e.kind === 'mob' && !e.friendly)!;
    w.teleportMob(bat.id, w.playerStats(id)!.x, w.playerStats(id)!.y);
    w.setMobHp(bat.id, 1);
    for (let t = 0; t < 160; t++) w.tick(0.05);

    const after = w.exportPlayer(id)!;
    expect(after.pet!.tier).toBe(5);
    expect(after.petsEvolved).toBe(1);
    expect(
      w.achievementStatus(id).some((l) => l.includes('Beastmaster') && l.startsWith('✓')),
    ).toBe(true);
  });
});
