import { describe, expect, it } from 'vitest';
import { World } from './world.js';
import { initGameDb } from './content.js';
import { MAX_SPELL_RANK, STARTER_ABILITIES } from '../shared/combat.js';

initGameDb(':memory:');

/** A town world with the Merchant placed, plus a player standing on top of the vendor. */
function townWithShopper(): { w: World; id: number } {
  const w = new World(1600, 1200, { x: 660, y: 560 }, undefined, 'town');
  w.populateNpcs('town');
  const id = w.spawn('Shopper', { x: 660, y: 560 });
  return { w, id };
}

describe('spellbooks — learning + ranks', () => {
  it('a fresh player only knows the starter spells', () => {
    const w = new World();
    const id = w.spawn('Newbie');
    const known = w.playerStats(id)!.known;
    expect(Object.keys(known).sort()).toEqual([...STARTER_ABILITIES].sort());
    for (const a of STARTER_ABILITIES) expect(known[a]).toBe(1);
  });

  it('reading a spellbook learns the spell and consumes the book', () => {
    const w = new World();
    const id = w.spawn('Student');
    w.giveItem(id, 'tome_frost', 1);
    expect(w.playerStats(id)!.loot.tome_frost).toBe(1);

    w.learn(id, 'tome_frost');
    expect(w.playerStats(id)!.known.frost).toBe(1);
    expect(w.playerStats(id)!.loot.tome_frost ?? 0).toBe(0); // consumed
  });

  it('a duplicate book ranks the spell up, capping at MAX_SPELL_RANK', () => {
    const w = new World();
    const id = w.spawn('Ranker');
    w.giveItem(id, 'tome_frost', MAX_SPELL_RANK + 2);
    // MAX_SPELL_RANK reads reach the cap (1 to learn + MAX-1 to rank up); the next is a no-op.
    for (let i = 0; i < MAX_SPELL_RANK + 1; i++) w.learn(id, 'tome_frost');
    expect(w.playerStats(id)!.known.frost).toBe(MAX_SPELL_RANK);
    // Only MAX_SPELL_RANK books were consumed; the over-cap reads leave the spares as vendor fodder.
    expect(w.playerStats(id)!.loot.tome_frost).toBe(2);
  });

  it('learning a non-book or an unowned book does nothing', () => {
    const w = new World();
    const id = w.spawn('Cheater');
    w.learn(id, 'tome_frost'); // not held
    expect(w.playerStats(id)!.known.frost).toBeUndefined();
    w.giveItem(id, 'wolf_pelt', 1);
    w.learn(id, 'wolf_pelt'); // not a spellbook
    expect(Object.keys(w.playerStats(id)!.known).sort()).toEqual([...STARTER_ABILITIES].sort());
  });

  it('a dead player cannot learn or rank up spells (server-authority guard)', () => {
    const w = new World(1600, 1200, { x: 800, y: 600 }, undefined, 'crypt');
    const id = w.spawn('Corpse', { x: 800, y: 600 });
    w.giveItem(id, 'tome_frost', 1);
    // Park a Crypt Lord on top of the idle player and let it slam them to death.
    w.spawnMobAt(id, 'crypt_lord');
    for (let t = 0; t < 300 && !w.playerStats(id)!.dead; t++) w.tick(0.1);
    expect(w.playerStats(id)!.dead).toBe(true);

    w.learn(id, 'tome_frost'); // should be rejected while dead
    expect(w.playerStats(id)!.known.frost).toBeUndefined();
    expect(w.playerStats(id)!.loot.tome_frost).toBe(1); // book not consumed
  });

  it('giveItem clamps an absurd quantity instead of hanging', () => {
    const w = new World();
    const id = w.spawn('Greedy');
    w.giveItem(id, 'iron_sword', Number.POSITIVE_INFINITY); // would loop forever unclamped
    expect(w.playerStats(id)!.gear.length).toBeLessThanOrEqual(10_000);
    expect(w.playerStats(id)!.gear.length).toBeGreaterThan(0);
  });
});

describe('spellbooks — save robustness', () => {
  it('an empty learned-spells list grandfathers in every ability on load', () => {
    const a = new World();
    const id = a.spawn('Veteran');
    const save = a.exportPlayer(id)!;
    save.known = []; // simulate a save that somehow carries no learned spells
    const b = new World();
    b.importPlayer(id, save, 100, 100);
    const known = b.playerStats(id)!.known;
    // Every content ability is restored at rank 1 — never a spell-less character.
    for (const a2 of STARTER_ABILITIES) expect(known[a2]).toBe(1);
    expect(Object.keys(known).length).toBeGreaterThanOrEqual(STARTER_ABILITIES.length);
  });

  it('a pre-spellbook save (no known field) grandfathers in all abilities', () => {
    const a = new World();
    const id = a.spawn('Legacy');
    const save = a.exportPlayer(id)!;
    delete save.known;
    const b = new World();
    b.importPlayer(id, save, 0, 0);
    expect(Object.keys(b.playerStats(id)!.known).length).toBeGreaterThanOrEqual(
      STARTER_ABILITIES.length,
    );
  });
});

describe('spellbooks — cast gating', () => {
  it('rejects casting a spell the player has not learned', () => {
    const w = new World();
    const id = w.spawn('Caster', { x: 800, y: 600 });
    // 'lightning' is not a starter spell — the cast must be a no-op (no mana spent).
    const manaBefore = w.playerStats(id)!.mana;
    w.cast(id, 'lightning', 1, 0);
    expect(w.playerStats(id)!.mana).toBe(manaBefore);

    // After learning it, the same cast spends mana.
    w.giveItem(id, 'tome_lightning', 1);
    w.learn(id, 'tome_lightning');
    w.cast(id, 'lightning', 1, 0);
    expect(w.playerStats(id)!.mana).toBeLessThan(manaBefore);
  });
});

describe('vendor shop — buy / sell / proximity', () => {
  it('interacting with a vendor produces a shop offer with stock', () => {
    const { w, id } = townWithShopper();
    w.interact(id);
    const offers = w.drainShopOffers();
    expect(offers).toHaveLength(1);
    expect(offers[0]!.vendor).toBe('Merchant');
    expect(offers[0]!.stock.some((s) => s.itemId === 'tome_heal')).toBe(true);
  });

  it('buys a spellbook when the player can afford it', () => {
    const { w, id } = townWithShopper();
    w.giveItem(id, 'gold', 1000);
    const before = w.playerStats(id)!.gold;
    w.buy(id, 'tome_heal'); // priced 150
    const after = w.playerStats(id)!;
    expect(after.gold).toBe(before - 150);
    expect(after.loot.tome_heal).toBe(1);
  });

  it('refuses a purchase the player cannot afford (no gold, no item)', () => {
    const { w, id } = townWithShopper();
    // Fresh player has 0 gold.
    w.buy(id, 'tome_lightning'); // 700g
    const s = w.playerStats(id)!;
    expect(s.gold).toBe(0);
    expect(s.loot.tome_lightning ?? 0).toBe(0);
  });

  it('refuses buying an item not on the vendor shelf', () => {
    const { w, id } = townWithShopper();
    w.giveItem(id, 'gold', 100000);
    const before = w.playerStats(id)!.gold;
    w.buy(id, 'wolf_pelt'); // not stocked
    expect(w.playerStats(id)!.gold).toBe(before);
  });

  it('requires vendor proximity to buy (the open panel grants nothing)', () => {
    const { w, id } = townWithShopper();
    w.giveItem(id, 'gold', 1000);
    w.teleport(id, 50, 50); // walk far from the Merchant
    w.buy(id, 'tome_heal');
    expect(w.playerStats(id)!.loot.tome_heal ?? 0).toBe(0);
  });

  it('sells the whole bag for gold when next to a vendor', () => {
    const { w, id } = townWithShopper();
    w.giveItem(id, 'wolf_pelt', 5); // 6g each = 30g
    w.sell(id);
    const s = w.playerStats(id)!;
    expect(s.gold).toBe(30);
    expect(s.loot.wolf_pelt ?? 0).toBe(0);
  });
});

describe('town service NPCs (healer + gambler)', () => {
  /** A town world with all service NPCs placed and a player on the gambler/healer row. */
  function townWithServices(): { w: World; id: number } {
    const w = new World(1600, 1200, { x: 900, y: 560 }, undefined, 'town');
    w.populateNpcs('town');
    const id = w.spawn('Patron', { x: 900, y: 560 }); // near Sister Oona (860) + Lucky Marn (940)
    return { w, id };
  }

  it('a healer fully restores HP and mana on interact', () => {
    const { w, id } = townWithServices();
    // Stand on the healer and damage the player first.
    w.teleport(id, 860, 560);
    w.setLevel(id, 10);
    // Drain HP/mana via a cast + simulated damage: cast costs mana; then check restore.
    w.giveItem(id, 'tome_lightning', 1);
    w.learn(id, 'tome_lightning');
    w.cast(id, 'lightning', 1, 0); // spends mana
    expect(w.playerStats(id)!.mana).toBeLessThan(w.playerStats(id)!.maxMana);
    w.interact(id); // Sister Oona
    const s = w.playerStats(id)!;
    expect(s.mana).toBe(s.maxMana);
    expect(s.hp).toBe(s.maxHp);
  });

  it('a gambler opens a window and rolls an item of the chosen slot for gold', () => {
    const { w, id } = townWithServices();
    w.teleport(id, 940, 560); // stand on Lucky Marn
    w.interact(id);
    const offers = w.drainGambleOffers();
    expect(offers).toHaveLength(1);
    const cost = offers[0]!.cost;
    expect(cost).toBeGreaterThan(0);

    w.giveItem(id, 'gold', cost + 100);
    const goldBefore = w.playerStats(id)!.gold;
    const gearBefore = w.playerStats(id)!.gear.length;
    w.gamble(id, 'mainhand');
    const after = w.playerStats(id)!;
    expect(after.gold).toBe(goldBefore - cost);
    expect(after.gear.length).toBe(gearBefore + 1);
    // The gambled item is a weapon (mainhand base).
    expect(after.gear[after.gear.length - 1]!.baseId).toBeDefined();
  });

  it('the gambler refuses when the player cannot afford a pull', () => {
    const { w, id } = townWithServices();
    w.teleport(id, 940, 560);
    const gearBefore = w.playerStats(id)!.gear.length;
    w.gamble(id, 'mainhand'); // 0 gold
    expect(w.playerStats(id)!.gear.length).toBe(gearBefore);
  });

  it('gambling requires standing next to the gambler', () => {
    const { w, id } = townWithServices();
    w.giveItem(id, 'gold', 100000);
    w.teleport(id, 100, 100); // far from Lucky Marn
    const gearBefore = w.playerStats(id)!.gear.length;
    w.gamble(id, 'mainhand');
    expect(w.playerStats(id)!.gear.length).toBe(gearBefore);
  });
});

describe('gem socketing', () => {
  it('sockets a held gem into equipped gear, applies its bonus, and consumes the gem', () => {
    const w = new World();
    const id = w.spawn('Jeweler');
    // Give and equip a rare weapon (rare rolls 1 socket per socketCountFor).
    w.giveItem(id, 'iron_sword', 1);
    let gear = w.playerStats(id)!.gear;
    // Find an instance that actually rolled a socket; rare/epic/legendary do. Re-roll via more drops
    // until we have one with a socket (giveItem rolls random rarity).
    for (let i = 0; i < 50 && !gear.some((g) => (g.sockets?.length ?? 0) > 0); i++) {
      w.giveItem(id, 'iron_sword', 1);
      gear = w.playerStats(id)!.gear;
    }
    const socketed = gear.find((g) => (g.sockets?.length ?? 0) > 0)!;
    expect(socketed).toBeDefined();
    w.equip(id, socketed.uid);
    const powerBefore = w.playerStats(id)!.power;

    // Give a power gem and socket it.
    w.giveItem(id, 'ruby_t3', 1); // Flawless Ruby: +10 power
    expect(w.playerStats(id)!.loot.ruby_t3).toBe(1);
    w.socketGem(id, 'ruby_t3');

    // The gem is consumed and the equipped item now has it in a socket; power went up.
    expect(w.playerStats(id)!.loot.ruby_t3 ?? 0).toBe(0);
    const eqSlot = Object.values(w.playerStats(id)!.equipment).find((e) =>
      e?.sockets?.includes('ruby_t3'),
    );
    expect(eqSlot).toBeDefined();
    // The ruby adds power only if the equipped piece is a weapon; if it landed on armor, power may
    // be unchanged — so assert the socket is filled (above) and, when it's the weapon, power rose.
    if (eqSlot?.baseId === 'iron_sword') {
      expect(w.playerStats(id)!.power).toBeGreaterThan(powerBefore);
    }
  });

  it('rejects socketing with no open socket and does not consume the gem', () => {
    const w = new World();
    const id = w.spawn('NoSlots');
    w.giveItem(id, 'ruby_t1', 1);
    // No gear equipped → no sockets anywhere. The gem must remain in the bag.
    w.socketGem(id, 'ruby_t1');
    expect(w.playerStats(id)!.loot.ruby_t1).toBe(1);
  });

  it('rejects socketing a non-gem item', () => {
    const w = new World();
    const id = w.spawn('Faker');
    w.giveItem(id, 'wolf_pelt', 1);
    w.socketGem(id, 'wolf_pelt');
    expect(w.playerStats(id)!.loot.wolf_pelt).toBe(1); // untouched
  });
});

describe('quest log state (the wire data for the quest-log UI)', () => {
  it('reports available → active → done with progress', () => {
    const w = new World(1600, 1200, { x: 800, y: 600 }, undefined, 'wilderness');
    const id = w.spawn('Logger', { x: 800, y: 600 });

    // Every content quest starts as 'available'.
    let wolf = w.playerStats(id)!.quests.find((q) => q.id === 'wolf_cull')!;
    expect(wolf.status).toBe('available');
    expect(wolf.progress).toBe(0);
    expect(wolf.targetCount).toBe(5);

    // Accepting moves it to 'active'.
    w.acceptQuest(id, 'wolf_cull');
    wolf = w.playerStats(id)!.quests.find((q) => q.id === 'wolf_cull')!;
    expect(wolf.status).toBe('active');

    // Completing it (high-level god-mode wolf cull) moves it to 'done'.
    w.setLevel(id, 50);
    w.toggleGod(id);
    for (let t = 0; t < 2000; t++) {
      const q = w.playerStats(id)!.quests.find((x) => x.id === 'wolf_cull')!;
      if (q.status === 'done') break;
      w.spawnMobAt(id, 'wolf');
      w.cast(id, 'slash', 1, 0);
      w.tick(0.05);
    }
    expect(w.playerStats(id)!.quests.find((q) => q.id === 'wolf_cull')!.status).toBe('done');
  });
});

describe('quest reward items', () => {
  it('grants the reward item on completion (wolf_cull → tome_heal)', () => {
    // A high-level, god-mode hunter one-shots wolves with Slash; we keep a wolf next to the
    // player and tick until the 5-kill quest completes, then assert the reward tome arrived.
    const w = new World(1600, 1200, { x: 800, y: 600 }, undefined, 'wilderness');
    const id = w.spawn('Hunter', { x: 800, y: 600 });
    w.setLevel(id, 50); // big damage so each Slash kills a wolf outright
    w.toggleGod(id); // wolves can't kill us, so the quest can't be interrupted by death
    w.acceptQuest(id, 'wolf_cull');

    for (let t = 0; t < 2000 && (w.playerStats(id)!.loot.tome_heal ?? 0) === 0; t++) {
      // Always keep a fresh wolf within Slash range, directly to the player's right.
      w.spawnMobAt(id, 'wolf');
      w.cast(id, 'slash', 1, 0);
      w.tick(0.05);
    }

    const s = w.playerStats(id)!;
    expect(s.loot.tome_heal ?? 0).toBeGreaterThanOrEqual(1);
    expect(s.gold).toBeGreaterThanOrEqual(150); // retuned quest gold
  });
});
