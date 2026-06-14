import { describe, expect, it } from 'vitest';
import { World, type PlayerSave } from './world.js';
import { initGameDb } from './content.js';

initGameDb(':memory:');

/**
 * Health globes (D3): a slain monster may spill a globe that instant-heals whoever walks over it,
 * plus nearby allies a smaller share. A full-HP player leaves it on the ground for someone who
 * needs it. These tests place a globe at a controlled distance via `dropItemAt` and tick the world.
 */
const woundedSave = (hp: number): PlayerSave => ({
  name: 'Bleeder',
  hue: 0,
  hp,
  mana: 5,
  level: 8,
  xp: 0,
  gold: 0,
  loot: [],
  gear: [],
  equipment: {},
  god: false,
  quests: [],
  questsDone: [],
  potions: { health: 0, mana: 0 },
});

const newWorld = () => new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');
const globesOn = (w: World) =>
  w.snapshot().filter((e) => e.kind === 'item' && e.itemId === 'healthglobe');

describe('health globes', () => {
  it('heals a wounded player who walks over it, then the globe is gone', () => {
    const w = newWorld();
    w.importPlayer(1, woundedSave(10), 100, 100);
    const before = w.playerStats(1)!;
    w.dropItemAt('healthglobe', 1, 100, 100); // right at the player's feet

    w.tick(0.05);

    const after = w.playerStats(1)!;
    expect(after.hp).toBeGreaterThan(before.hp); // healed
    expect(globesOn(w)).toHaveLength(0); // consumed
  });

  it('never overheals past max HP', () => {
    const w = newWorld();
    w.importPlayer(1, woundedSave(10), 100, 100);
    const maxHp = w.playerStats(1)!.maxHp;
    w.dropItemAt('healthglobe', 1, 100, 100);
    w.tick(0.05);
    expect(w.playerStats(1)!.hp).toBeLessThanOrEqual(maxHp);
  });

  it('a full-HP player leaves the globe on the ground for someone who needs it', () => {
    const w = newWorld();
    const id = w.spawn('Topped'); // spawns at full HP
    w.teleport(id, 100, 100);
    const fullHp = w.playerStats(id)!.hp;
    w.dropItemAt('healthglobe', 1, 100, 100);

    w.tick(0.05);

    expect(w.playerStats(id)!.hp).toBe(fullHp); // no heal
    expect(globesOn(w)).toHaveLength(1); // still on the ground
  });

  it('shares the heal with a wounded ally in range, far more than the trivial passive regen a distant one gets', () => {
    const w = newWorld();
    w.importPlayer(1, woundedSave(10), 100, 100); // picker, on the globe
    w.importPlayer(2, woundedSave(10), 100, 300); // ally 200px away — inside the 220 share radius
    w.importPlayer(3, woundedSave(10), 100, 800); // ally far away — outside it (only passive regen)
    const near0 = w.playerStats(2)!.hp;
    const far0 = w.playerStats(3)!.hp;
    w.dropItemAt('healthglobe', 1, 100, 100);

    w.tick(0.05);

    const nearHealed = w.playerStats(2)!.hp - near0; // globe share + a tick of regen
    const farHealed = w.playerStats(3)!.hp - far0; // a tick of regen only
    expect(nearHealed).toBeGreaterThan(farHealed + 5); // the globe share dwarfs passive regen
  });

  it('the picker gets a bigger heal than a shared ally (globe favors who grabbed it)', () => {
    const w = newWorld();
    w.importPlayer(1, woundedSave(10), 100, 100); // picker
    w.importPlayer(2, woundedSave(10), 100, 280); // ally inside share radius
    const picker0 = w.playerStats(1)!.hp;
    const ally0 = w.playerStats(2)!.hp;
    w.dropItemAt('healthglobe', 1, 100, 100);

    w.tick(0.05);

    const pickerHealed = w.playerStats(1)!.hp - picker0;
    const allyHealed = w.playerStats(2)!.hp - ally0;
    expect(pickerHealed).toBeGreaterThan(allyHealed);
  });
});
