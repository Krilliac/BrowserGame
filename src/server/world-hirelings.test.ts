import { describe, expect, it } from 'vitest';
import { World, type PlayerSave } from './world.js';
import { initGameDb } from './content.js';
import { areaWorld, npcPos } from './test-support.js';

initGameDb(':memory:');

// Captain Aldric, the town recruiter — position from content (post-world-scale).
const RECRUITER = npcPos('town', 'recruiter');

const BASE_SAVE: PlayerSave = {
  name: 'Subject',
  hue: 0,
  hp: 100,
  mana: 100,
  level: 5,
  xp: 0,
  gold: 1000,
  loot: [],
  gear: [],
  equipment: {},
  god: false,
  quests: [],
  questsDone: [],
};

const hirelingsOf = (w: World) => w.snapshot().filter((e) => e.kind === 'hireling');

describe('hiring at the recruiter', () => {
  it('deducts gold and spawns the companion beside the player', () => {
    const w = areaWorld('town');
    const id = w.spawn('Boss');
    w.populateNpcs('town');
    w.teleport(id, RECRUITER.x, RECRUITER.y);
    w.giveItem(id, 'gold', 1000);

    const before = w.playerStats(id)!.gold;
    w.hire(id, 'guard');

    expect(w.playerStats(id)!.gold).toBeLessThan(before);
    const allies = hirelingsOf(w);
    expect(allies).toHaveLength(1);
    expect(allies[0]!.name).toBe('Guard');
    expect(allies[0]!.level).toBe(w.playerStats(id)!.level);
  });

  it('does nothing away from the recruiter, with bad types, or without gold', () => {
    const w = areaWorld('town');
    const id = w.spawn('Broke');
    w.populateNpcs('town');

    w.teleport(id, 50, 50); // nowhere near Captain Aldric
    w.giveItem(id, 'gold', 1000);
    w.hire(id, 'guard');
    expect(hirelingsOf(w)).toHaveLength(0);

    w.teleport(id, RECRUITER.x, RECRUITER.y);
    w.hire(id, 'not_a_merc');
    expect(hirelingsOf(w)).toHaveLength(0);

    const w2 = areaWorld('town');
    const poor = w2.spawn('Penniless');
    w2.populateNpcs('town');
    w2.teleport(poor, RECRUITER.x, RECRUITER.y);
    w2.hire(poor, 'guard'); // 0 gold
    expect(hirelingsOf(w2)).toHaveLength(0);
  });

  it('re-hiring replaces the current companion (never two at once)', () => {
    const w = areaWorld('town');
    const id = w.spawn('Switcher');
    w.populateNpcs('town');
    w.teleport(id, RECRUITER.x, RECRUITER.y);
    w.giveItem(id, 'gold', 5000);

    w.hire(id, 'guard');
    w.hire(id, 'marksman');
    const allies = hirelingsOf(w);
    expect(allies).toHaveLength(1);
    expect(allies[0]!.name).toBe('Marksman');
  });
});

describe('hireling combat', () => {
  it('fights nearby monsters and the kill credits the OWNER with XP', () => {
    // Use a plain World (no pinned seed needed) and set the wolf to 1 HP so the guard's very
    // first landed hit kills it. This eliminates two sources of flakiness:
    //   1. rollAbilityDamage uses Math.random (not the seeded World RNG) for hit rolls, so a
    //      run of bad luck could keep the wolf alive past a fixed tick budget.
    //   2. With normal HP the wolf could kill the guard before dying (wolf attacks always
    //      connect; guard attacks are hit-roll gated), voiding the contract and the XP.
    // With 1 HP, a single landed swing ends the fight. 200 ticks (10 sim-seconds) gives ~9
    // attack opportunities at the guard's 1 100 ms cooldown — P(all 9 miss) < 0.004 %, which
    // is safely below the "flake threshold" for a CI test run.
    const w = new World();
    w.importPlayer(1, { ...BASE_SAVE, god: true, hireling: { type: 'guard' } }, 400, 400);
    expect(hirelingsOf(w)).toHaveLength(1);
    w.spawnMobAt(1, 'wolf');

    // Pin the wolf at 1 HP so the first hit is lethal regardless of damage roll variance.
    const wolfSnap = w.snapshot().find((e) => e.kind === 'mob');
    expect(wolfSnap).toBeDefined();
    expect(w.boostMobHp(wolfSnap!.id, 1)).toBe(true);

    const xpBefore = w.playerStats(1)!.xp;
    // Advance until the mob is dead or the budget expires (it will die on the first swing).
    for (let i = 0; i < 200 && w.snapshot().some((e) => e.kind === 'mob' && e.hp > 0); i++) {
      w.tick(0.05);
    }
    expect(w.snapshot().some((e) => e.kind === 'mob' && e.hp > 0)).toBe(false);
    expect(w.playerStats(1)!.xp).toBeGreaterThan(xpBefore);
  });

  it('monsters can kill the hireling, which voids the contract', () => {
    const w = new World();
    w.importPlayer(2, { ...BASE_SAVE, god: true, hireling: { type: 'guard' } }, 400, 400);
    w.spawnMobAt(2, 'crypt_lord'); // a boss — far beyond a level-5 guard

    for (let i = 0; i < 2400 && hirelingsOf(w).length > 0; i++) w.tick(0.05);

    expect(hirelingsOf(w)).toHaveLength(0);
    expect(w.exportPlayer(2)!.hireling).toBeNull();
  });
});

describe('hireling persistence', () => {
  it('the contract survives an area transfer and the companion respawns beside the player', () => {
    const a = areaWorld('town');
    a.populateNpcs('town');
    const id = a.spawn('Mover');
    a.teleport(id, RECRUITER.x, RECRUITER.y);
    a.giveItem(id, 'gold', 1000);
    a.hire(id, 'marksman');

    const save = a.exportPlayer(id)!;
    expect(save.hireling).toEqual({ type: 'marksman' });

    const b = new World();
    b.importPlayer(id, save, 100, 200);
    const allies = hirelingsOf(b);
    expect(allies).toHaveLength(1);
    expect(allies[0]!.name).toBe('Marksman');
  });

  it('disconnecting removes the live companion from the instance', () => {
    const w = new World();
    w.importPlayer(3, { ...BASE_SAVE, hireling: { type: 'guard' } }, 400, 400);
    expect(hirelingsOf(w)).toHaveLength(1);
    w.remove(3);
    w.tick(0.05);
    expect(hirelingsOf(w)).toHaveLength(0);
  });
});
