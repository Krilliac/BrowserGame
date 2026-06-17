import { describe, expect, it } from 'vitest';
import { InstanceManager } from './instance-manager.js';
import { AREAS } from '../shared/areas.js';

describe('InstanceManager', () => {
  it('places a new player into the start area', () => {
    const mgr = new InstanceManager('auto');
    const p = mgr.join('Alice');
    expect(p.areaId).toBe('town');
    expect(mgr.instanceCount).toBe(1);
    expect(mgr.playerIdsIn(p.instanceId)).toContain(p.entityId);
  });

  it('packs players into one instance until the cap, then spins up another', () => {
    const mgr = new InstanceManager('auto');
    // The effective cap is floored at MIN_INSTANCE_CAP (100) over the authored per-area value, so a
    // crowd stays together; fill exactly that many, then overflow.
    const cap = Math.max(AREAS.town!.playerCap, 100);
    for (let i = 0; i < cap; i++) mgr.join(`P${i}`);
    expect(mgr.instanceCount).toBe(1);
    mgr.join('Overflow'); // cap + 1
    expect(mgr.instanceCount).toBe(2);
  });

  it('single mode keeps one instance per area with unlimited players', () => {
    const mgr = new InstanceManager('single');
    for (let i = 0; i < AREAS.town!.playerCap + 10; i++) mgr.join(`P${i}`);
    expect(mgr.instanceCount).toBe(1);
  });

  it('assigns globally unique entity ids across instances', () => {
    const mgr = new InstanceManager('auto');
    const ids = new Set<number>();
    for (let i = 0; i < AREAS.town!.playerCap + 5; i++) ids.add(mgr.join(`P${i}`).entityId);
    expect(ids.size).toBe(AREAS.town!.playerCap + 5);
  });

  it('transfers a player through a portal, preserving identity', () => {
    const mgr = new InstanceManager('auto');
    const p = mgr.join('Traveler');
    const start = mgr.get(p.instanceId)!;
    start.world.setInput(p.entityId, { up: false, down: false, left: false, right: true });

    let transfer;
    // The world is 5× as long: crossing half the town to the east gate takes a real walk now.
    for (let i = 0; i < 600 && !transfer; i++) {
      const events = mgr.tick(0.1);
      transfer = events.find((e) => e.entityId === p.entityId);
    }

    expect(transfer).toBeDefined();
    expect(transfer!.toAreaId).toBe('wilderness');

    // The player now lives in a wilderness instance, with the same id and name.
    const dest = mgr.get(transfer!.toInstanceId)!;
    const moved = dest.world.snapshot().find((e) => e.id === p.entityId);
    expect(moved?.name).toBe('Traveler');
    // ...and is no longer in the origin instance (which was GC'd when it emptied).
    expect(mgr.get(p.instanceId)).toBeUndefined();
  });

  it('carries the full inventory (gold, gear, loot, level) across a transfer', () => {
    const mgr = new InstanceManager('auto');
    const p = mgr.join('Hauler');
    const origin = mgr.get(p.instanceId)!.world;
    // Endow the player in the origin instance, then snapshot before crossing.
    origin.giveItem(p.entityId, 'gold', 250);
    origin.giveItem(p.entityId, 'iron_sword', 1); // a rolled gear instance in the bag
    origin.giveItem(p.entityId, 'mat_scrap', 5); // a stackable loot material
    origin.setLevel(p.entityId, 7);
    const before = origin.exportPlayer(p.entityId)!;

    const ev = mgr.teleport(p.instanceId, p.entityId, 'wilderness');
    expect(ev).toBeDefined();

    // The destination instance holds the SAME character state — nothing dropped on the floor.
    const after = mgr.get(ev!.toInstanceId)!.world.exportPlayer(p.entityId)!;
    expect(after.gold).toBe(before.gold);
    expect(after.level).toBe(before.level);
    expect(after.gear.map((g) => g.baseId)).toEqual(before.gear.map((g) => g.baseId));
    expect(after.gear.map((g) => g.uid)).toEqual(before.gear.map((g) => g.uid));
    expect(after.loot).toEqual(before.loot);
  });

  it('does not reissue a uid that a restored save already owns after a restart (SEC-101)', () => {
    // First "run": a player earns a gear instance, then we snapshot their save.
    const run1 = new InstanceManager('single');
    const a = run1.join('Returner');
    const w1 = run1.get(a.instanceId)!.world;
    w1.giveItem(a.entityId, 'iron_sword', 1); // a rolled gear instance with a real uid
    const save = w1.exportPlayer(a.entityId)!;
    expect(save.gear.length).toBeGreaterThan(0);

    // "Restart": a brand-new manager whose shared id counter has reset to 1. The returning player
    // is restored from the save (keeping prior-run uids), then earns a fresh item.
    const run2 = new InstanceManager('single');
    const b = run2.join('Returner', undefined, save);
    const w2 = run2.get(b.instanceId)!.world;
    w2.giveItem(b.entityId, 'iron_sword', 1); // freshly allocated uid in the new run

    // Every gear uid the player now holds must be distinct — the fresh item must not collide with
    // the uid baked into the restored gear (which it would if the counter restarted at 1).
    const uids = w2.exportPlayer(b.entityId)!.gear.map((g) => g.uid);
    expect(new Set(uids).size).toBe(uids.length);
  });

  it('garbage-collects an instance once it empties', () => {
    const mgr = new InstanceManager('auto');
    const p = mgr.join('Solo');
    expect(mgr.instanceCount).toBe(1);
    mgr.remove(p.instanceId, p.entityId);
    expect(mgr.instanceCount).toBe(0);
  });
});
