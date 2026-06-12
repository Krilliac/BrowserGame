import { describe, expect, it } from 'vitest';
import { World, type PlayerSave } from './world.js';
import { InstanceManager } from './instance-manager.js';
import { initGameDb, getContent } from './content.js';
import { areaWorld, npcPos } from './test-support.js';

initGameDb(':memory:');

// Saelis the Riftkeeper in town — position from content (post-world-scale).
const RIFTKEEPER = npcPos('town', 'riftkeeper');

const BASE_SAVE: PlayerSave = {
  name: 'Riftrunner',
  hue: 0,
  hp: 100,
  mana: 100,
  level: 9, // maxRiftTier = 3
  xp: 0,
  gold: 1000,
  loot: [],
  gear: [],
  equipment: {},
  god: false,
  quests: [],
  questsDone: [],
};

const riftWorld = (tier: number): World => {
  const w = new World(1500, 1300, { x: 750, y: 220 }, undefined, 'rift', undefined, tier);
  w.populateMobs('rift');
  return w;
};

describe('rift tier scaling', () => {
  it('a tiered rift packs more monsters than tier 0 ever rolls', () => {
    const mobs0 = riftWorld(0)
      .snapshot()
      .filter((e) => e.kind === 'mob');
    const mobs5 = riftWorld(5)
      .snapshot()
      .filter((e) => e.kind === 'mob');
    // Tier 5 density is 1.75×: its minimum roll (32 + boss) beats tier 0's maximum (26 + boss
    // + miniboss), so this holds for every random roll.
    expect(mobs5.length).toBeGreaterThan(mobs0.length);
  });

  it('the same monster spawns higher-level and tougher at a higher tier', () => {
    const compare = (tier: number) => {
      const w = new World(1500, 1300, { x: 750, y: 220 }, undefined, 'rift', undefined, tier);
      const id = w.spawn('Scout');
      w.spawnMobAt(id, 'rot_ghoul');
      return w.snapshot().find((e) => e.kind === 'mob')!;
    };
    const m0 = compare(0);
    const m5 = compare(5);
    expect(m5.level).toBe(m0.level + 10); // +2 levels per tier
    // 2.75× HP at tier 5 — comfortably above even an elite tier-0 roll of the same template.
    expect(m5.maxHp).toBeGreaterThan(m0.maxHp * 1.5);
  });
});

describe('paying the Riftkeeper', () => {
  it('takes the tier fee next to the Riftkeeper, within the unlocked tier range', () => {
    const w = areaWorld('town');
    w.populateNpcs('town');
    w.importPlayer(1, BASE_SAVE, RIFTKEEPER.x, RIFTKEEPER.y);

    expect(w.payForRift(1, 3)).toBe(true); // level 9 unlocks up to tier 3
    expect(w.playerStats(1)!.gold).toBe(1000 - 300); // 100g per tier

    expect(w.payForRift(1, 4)).toBe(false); // above the unlocked cap
    expect(w.payForRift(1, 0)).toBe(false); // tiers start at 1
    expect(w.payForRift(1, 2.5)).toBe(false); // integers only
    expect(w.playerStats(1)!.gold).toBe(700); // none of the refusals charged anything
  });

  it('refuses away from the Riftkeeper and without the gold', () => {
    const w = areaWorld('town');
    w.populateNpcs('town');
    w.importPlayer(2, BASE_SAVE, 50, 50); // nowhere near Saelis
    expect(w.payForRift(2, 1)).toBe(false);

    w.importPlayer(3, { ...BASE_SAVE, gold: 10 }, RIFTKEEPER.x, RIFTKEEPER.y);
    expect(w.payForRift(3, 1)).toBe(false); // 100g fee, 10g held
    expect(w.playerStats(3)!.gold).toBe(10);
  });
});

describe('opening and leaving rifts', () => {
  it('every opening is a fresh private instance; the exit portal returns to town and GCs it', () => {
    const m = new InstanceManager('auto');
    const p = m.join('Opener');
    const ev1 = m.openRift(p.instanceId, p.entityId, 3);
    expect(ev1).not.toBeNull();
    expect(ev1!.toAreaId).toBe('rift');
    const rift = m.get(ev1!.toInstanceId)!;
    expect(rift.world.snapshot().filter((e) => e.kind === 'mob').length).toBeGreaterThan(0);

    // A second opening never lands in the first player's rift.
    const q = m.join('Second');
    const ev2 = m.openRift(q.instanceId, q.entityId, 3);
    expect(ev2!.toInstanceId).not.toBe(ev1!.toInstanceId);

    // Walk into the exit portal: back to town, and the abandoned rift instance is dropped.
    const exit = getContent().area('rift')!.portals[0]!;
    rift.world.teleport(p.entityId, exit.rect.x + exit.rect.w / 2, exit.rect.y + exit.rect.h / 2);
    const transfers = m.tick(0);
    expect(transfers.some((t) => t.entityId === p.entityId && t.toAreaId === 'town')).toBe(true);
    expect(m.get(ev1!.toInstanceId)).toBeUndefined();
  });

  it('portals transfer only players — a hireling on the pad never ghost-transfers', () => {
    const m = new InstanceManager('single');
    const town = getContent().area('town')!;
    const portal = town.portals[0]!;
    const p = m.join('Owner');
    const w = m.get(p.instanceId)!.world;
    // Drop the owner (and their guard, who spawns at their side) squarely onto the portal pad.
    w.importPlayer(
      p.entityId,
      { ...BASE_SAVE, name: 'Owner', hireling: { type: 'guard' } },
      portal.rect.x + portal.rect.w / 2,
      portal.rect.y + portal.rect.h / 2,
    );

    m.tick(0); // resolve the crossing

    // The owner crossed and their companion respawned with them — but nowhere did the hireling
    // itself get exported as a "player" (the pre-guard bug would spawn a player named Guard).
    for (const inst of m.list()) {
      const ghosts = inst.world.snapshot().filter((e) => e.kind === 'player' && e.name === 'Guard');
      expect(ghosts).toHaveLength(0);
    }
    const dest = m.list().find((i) => i.world.playerIds().includes(p.entityId))!;
    expect(dest.world.snapshot().filter((e) => e.kind === 'hireling')).toHaveLength(1);
  });
});
