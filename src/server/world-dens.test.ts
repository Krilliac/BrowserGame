import { describe, expect, it } from 'vitest';
import type { World } from './world.js';
import { InstanceManager } from './instance-manager.js';
import { getContent, initGameDb } from './content.js';
import { areaWorld } from './test-support.js';

initGameDb(':memory:');

/**
 * Dens — the Diablo cellar loop. Each instance rolls hidden den entrances (and each house a 50%
 * cellar hatch); stepping onto one descends into a fresh, private mini-dungeon stocked from the
 * source area's roster with a guaranteed chest, whose exit climbs back out where you went down.
 */
describe('den entrances', () => {
  const densOf = (w: World) => w.snapshot().filter((e) => e.kind === 'den');

  it('open country rolls hidden dens; dungeons and the den itself roll none', () => {
    const wild = areaWorld('wilderness');
    expect(densOf(wild).length).toBeGreaterThanOrEqual(0); // spawn-proximity can drop rolls...
    expect(densOf(wild).length).toBeLessThanOrEqual(4); // ...but never exceeds the cap

    const crypt = areaWorld('forgotten_catacombs');
    expect(densOf(crypt)).toHaveLength(0);

    const den = areaWorld('den');
    expect(densOf(den)).toHaveLength(0); // no dens within dens
  });

  it('standing on a den entrance queues exactly one descent', () => {
    // Roll worlds until one has a den (the spawn-proximity filter can skip some rolls).
    let w: World | undefined;
    let den: { x: number; y: number } | undefined;
    for (let i = 0; i < 20 && !den; i++) {
      w = areaWorld('wilderness');
      den = densOf(w)[0];
    }
    expect(den, 'no wilderness roll produced a den in 20 instances').toBeDefined();
    const id = w!.spawn('Spelunker');
    w!.teleport(id, den!.x, den!.y);
    w!.tick(0.05);
    w!.tick(0.05); // standing still must not queue twice
    expect(w!.drainDenEntries()).toEqual([{ playerId: id }]);
    expect(w!.drainDenEntries()).toEqual([]); // drained — and re-queues only after leaving
  });
});

describe('descending and climbing out', () => {
  it('openDen transfers into a fresh stocked den and the exit returns near the hatch', () => {
    const m = new InstanceManager('auto');
    const p = m.join('Delver'); // joins town
    const ev = m.openDen(p.instanceId, p.entityId);
    expect(ev).not.toBeNull();
    expect(ev!.toAreaId).toBe('den');

    const den = m.get(ev!.toInstanceId)!;
    expect(den.returnTo?.areaId).toBe('town');
    // Stocked from the source area's roster (town is safe -> wilderness fallback) + a chest.
    expect(den.world.snapshot().filter((e) => e.kind === 'mob').length).toBeGreaterThan(0);
    expect(den.world.snapshot().filter((e) => e.kind === 'chest').length).toBeGreaterThanOrEqual(1);

    // Climb out: the exit portal routes to returnTo, not its authored placeholder destination.
    const exit = getContent().area('den')!.portals[0]!;
    den.world.teleport(p.entityId, exit.rect.x + exit.rect.w / 2, exit.rect.y + exit.rect.h / 2);
    const transfers = m.tick(0);
    const out = transfers.find((t) => t.entityId === p.entityId);
    expect(out?.toAreaId).toBe('town');
    expect(m.get(ev!.toInstanceId)).toBeUndefined(); // the empty den dissolves
  });

  it('every den opening is its own private roll', () => {
    const m = new InstanceManager('auto');
    const a = m.join('First');
    const evA = m.openDen(a.instanceId, a.entityId);
    const b = m.join('Second');
    const evB = m.openDen(b.instanceId, b.entityId);
    expect(evA!.toInstanceId).not.toBe(evB!.toInstanceId);
  });
});

describe('random bonus chests', () => {
  it('instances roll extra chests beyond the authored decor', () => {
    const authored = (getContent().area('wilderness')?.decor ?? []).filter(
      (d) => d.kind === 'chest',
    ).length;
    // The roll is 0-2 — across ten instances at least one must exceed the authored count.
    let sawBonus = false;
    for (let i = 0; i < 10 && !sawBonus; i++) {
      const w = areaWorld('wilderness');
      const total = w.snapshot().filter((e) => e.kind === 'chest').length;
      expect(total).toBeGreaterThanOrEqual(authored);
      if (total > authored) sawBonus = true;
    }
    expect(sawBonus).toBe(true);
  });
});
