import { World } from './world.js';
import { areaOf, pointInRect, START_AREA, type AreaDef } from '../shared/areas.js';

/** One running area instance — conceptually its own "area server", here in-process. */
export interface Instance {
  id: string;
  areaId: string;
  world: World;
}

export interface Placement {
  instanceId: string;
  entityId: number;
  areaId: string;
}

export interface TransferEvent {
  entityId: number;
  fromInstanceId: string;
  toInstanceId: string;
  toAreaId: string;
}

/**
 * - 'auto'   : production-style. Each area holds players up to its cap; once every instance
 *              of an area is full, a new instance is spun up. This is how the open world
 *              scales horizontally (and how it would shard across processes later).
 * - 'single' : quick-testing. Unlimited cap, exactly one instance per area, never scales —
 *              "spin it all up under one world/instance" in a single process.
 */
export type InstancingMode = 'auto' | 'single';

/**
 * Routes players to area instances and scales instance count by load. Pure (no sockets,
 * no timers) so it is fully unit-tested in instance-manager.test.ts. The networking host
 * (index.ts) drives it.
 */
export class InstanceManager {
  private readonly instances = new Map<string, Instance>();
  private nextEntityId = 1;
  private instanceSeq = 0;

  constructor(private readonly mode: InstancingMode = 'auto') {}

  /** Place a new player into an area (the start area by default). */
  join(name: string, areaId: string = START_AREA): Placement {
    const area = areaOf(areaId);
    if (!area) throw new Error(`unknown area: ${areaId}`);
    const instance = this.pickInstance(area);
    const entityId = instance.world.spawn(name); // world uses the shared id allocator
    return { instanceId: instance.id, entityId, areaId: area.id };
  }

  remove(instanceId: string, entityId: number): void {
    const instance = this.instances.get(instanceId);
    if (!instance) return;
    instance.world.remove(entityId);
    this.gc(instance);
  }

  /** Advance every instance, then resolve portal crossings. Returns the transfers that happened. */
  tick(dt: number): TransferEvent[] {
    for (const instance of this.instances.values()) instance.world.tick(dt);
    return this.resolvePortals();
  }

  list(): Instance[] {
    return [...this.instances.values()];
  }

  get(instanceId: string): Instance | undefined {
    return this.instances.get(instanceId);
  }

  /** Player ids currently in an instance — used to scope snapshots and chat to one instance. */
  playerIdsIn(instanceId: string): number[] {
    return this.instances.get(instanceId)?.world.playerIds() ?? [];
  }

  get instanceCount(): number {
    return this.instances.size;
  }

  // --- internals ----------------------------------------------------------------------

  private cap(area: AreaDef): number {
    return this.mode === 'single' ? Number.POSITIVE_INFINITY : area.playerCap;
  }

  private pickInstance(area: AreaDef): Instance {
    const cap = this.cap(area);
    const ofArea = [...this.instances.values()].filter((i) => i.areaId === area.id);
    // Best-fit: pack into the fullest instance still under cap so areas stay social and we
    // run the fewest instances. Only spin up a new one when all are full.
    const open = ofArea
      .filter((i) => i.world.population < cap)
      .sort((a, b) => b.world.population - a.world.population);
    return open[0] ?? this.spawnInstance(area);
  }

  private spawnInstance(area: AreaDef): Instance {
    const id = `${area.id}#${++this.instanceSeq}`;
    const world = new World(area.width, area.height, area.spawn, () => this.nextEntityId++);
    world.populateMobs(area.id);
    const instance: Instance = { id, areaId: area.id, world };
    this.instances.set(id, instance);
    return instance;
  }

  private resolvePortals(): TransferEvent[] {
    const events: TransferEvent[] = [];
    // Snapshot the instance list so instances created mid-loop aren't scanned this tick.
    for (const instance of [...this.instances.values()]) {
      const area = areaOf(instance.areaId);
      if (!area || area.portals.length === 0) continue;

      for (const entity of instance.world.snapshot()) {
        const portal = area.portals.find((p) => pointInRect(entity.x, entity.y, p.rect));
        if (!portal) continue;

        const target = areaOf(portal.toArea);
        if (!target) continue;
        const dest = this.pickInstance(target);

        instance.world.remove(entity.id);
        // Preserve identity (id) and appearance (hue) across the transfer.
        dest.world.spawn(entity.name, {
          id: entity.id,
          x: portal.toSpawn.x,
          y: portal.toSpawn.y,
          hue: entity.hue,
        });
        events.push({
          entityId: entity.id,
          fromInstanceId: instance.id,
          toInstanceId: dest.id,
          toAreaId: target.id,
        });
      }
      this.gc(instance);
    }
    return events;
  }

  /** Drop an instance once empty so idle areas don't leak memory; it respawns on demand. */
  private gc(instance: Instance): void {
    if (instance.world.population === 0) this.instances.delete(instance.id);
  }
}
