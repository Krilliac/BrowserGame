import { describe, expect, it } from 'vitest';
import { World } from './world.js';
import { initGameDb } from './content.js';

initGameDb(':memory:');

/**
 * Helper: give the player enough iron_swords until at least one has a socket, equip it, and return.
 * Mirrors the pattern in world-spellbook.test.ts "gem socketing" describe block.
 */
function equipSocketedWeapon(w: World, id: number): void {
  let gear = w.playerStats(id)!.gear;
  for (let i = 0; i < 50 && !gear.some((g) => (g.sockets?.length ?? 0) > 0); i++) {
    w.giveItem(id, 'iron_sword', 1);
    gear = w.playerStats(id)!.gear;
  }
  const socketed = gear.find((g) => (g.sockets?.length ?? 0) > 0);
  if (!socketed) throw new Error('Could not roll a socketed iron_sword in 50 tries');
  w.equip(id, socketed.uid);
}

describe('modifier gems — socket integration', () => {
  it('socketing voltaic_t3 raises chainAdd by 2', () => {
    const w = new World();
    const id = w.spawn('ChainTest');

    equipSocketedWeapon(w, id);

    const chainBefore = w.playerStats(id)!.chainAdd;

    w.giveItem(id, 'voltaic_t3', 1);
    expect(w.playerStats(id)!.loot.voltaic_t3).toBe(1);
    w.socketGem(id, 'voltaic_t3');

    // voltaic_t3 grants chain 2 — chainAdd must rise by at least 2.
    expect(w.playerStats(id)!.loot.voltaic_t3 ?? 0).toBe(0); // gem consumed
    const eqSlot = Object.values(w.playerStats(id)!.equipment).find((e) =>
      e?.sockets?.includes('voltaic_t3'),
    );
    expect(eqSlot).toBeDefined(); // gem placed in a socket
    expect(w.playerStats(id)!.chainAdd).toBeGreaterThanOrEqual(chainBefore + 2);
  });

  it('socketing overcharge_t3 raises chainAdd by 3 AND spellDamageMult drops below 1', () => {
    const w = new World();
    const id = w.spawn('OverchargeTest');

    equipSocketedWeapon(w, id);

    const chainBefore = w.playerStats(id)!.chainAdd;

    w.giveItem(id, 'overcharge_t3', 1);
    w.socketGem(id, 'overcharge_t3');

    // overcharge_t3: +3 chain at a 20% damage cost (mult 0.8).
    expect(w.playerStats(id)!.loot.overcharge_t3 ?? 0).toBe(0); // gem consumed
    const eqSlot = Object.values(w.playerStats(id)!.equipment).find((e) =>
      e?.sockets?.includes('overcharge_t3'),
    );
    expect(eqSlot).toBeDefined();
    expect(w.playerStats(id)!.chainAdd).toBeGreaterThanOrEqual(chainBefore + 3);
    expect(w.playerStats(id)!.spellDamageMult).toBeLessThan(1); // ~0.8
  });

  it('socketing seeking_t3 grants homingAdd >= 1', () => {
    const w = new World();
    const id = w.spawn('SeekingTest');

    equipSocketedWeapon(w, id);

    w.giveItem(id, 'seeking_t3', 1);
    w.socketGem(id, 'seeking_t3');

    // seeking_t3 sets grantsHoming — homingAdd must be at least 1.
    expect(w.playerStats(id)!.loot.seeking_t3 ?? 0).toBe(0); // gem consumed
    const eqSlot = Object.values(w.playerStats(id)!.equipment).find((e) =>
      e?.sockets?.includes('seeking_t3'),
    );
    expect(eqSlot).toBeDefined();
    expect(w.playerStats(id)!.homingAdd).toBeGreaterThanOrEqual(1);
  });
});
