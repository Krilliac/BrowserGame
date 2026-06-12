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

  it('packs players into one instance until the area cap, then spins up another', () => {
    const mgr = new InstanceManager('auto');
    const cap = AREAS.town!.playerCap;
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

  it('garbage-collects an instance once it empties', () => {
    const mgr = new InstanceManager('auto');
    const p = mgr.join('Solo');
    expect(mgr.instanceCount).toBe(1);
    mgr.remove(p.instanceId, p.entityId);
    expect(mgr.instanceCount).toBe(0);
  });
});
