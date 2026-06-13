import { World, type PlayerSave } from './world.js';
import { pointInRect, START_AREA, type AreaDef } from '../shared/areas.js';
import { getContent } from './content.js';
import { AreaCorruption } from './area-corruption.js';

/** Minimum players an instance holds before the load balancer spins up another — a global floor
 *  over the authored per-area caps, so a crowd (or a bot flood) stays together in one world.
 *  Sized to 100 deliberately: mob-density scaling caps per-instance (~1200 mobs at 6×), so packing
 *  more players into ONE instance is far cheaper for the whole-server tick than spreading them
 *  across many instances that each independently balloon their roster. The spatial-grid tickMobs
 *  keeps a packed instance at ~15ms p99 even at 500 players / 1200 mobs (tools/playtest/tick-bench).
 *  Network (per-socket snapshot/AoI) is the real concurrency ceiling (~500–600 single-process),
 *  and it's independent of how players are grouped — so a higher floor never costs more there. */
const MIN_INSTANCE_CAP = 100;

/** One running area instance — conceptually its own "area server", here in-process. */
export interface Instance {
  id: string;
  areaId: string;
  world: World;
  /** The world's RNG seed — recorded so any instance's exact rolls are reproducible. */
  seed: number;
  /** Set on DEN instances: any portal out returns to this spot (where the player descended). */
  returnTo?: { areaId: string; x: number; y: number };
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

  constructor(
    private readonly mode: InstancingMode = 'auto',
    /** Shared area-wide corruption pool (host-owned), handed to every World by area id. */
    readonly corruption: AreaCorruption = new AreaCorruption(),
  ) {}

  /**
   * Place a new player into an area (the start area by default). If a `save` is given (a returning
   * player), their persistent state is restored at the area's spawn point.
   */
  join(name: string, areaId: string = START_AREA, save?: PlayerSave): Placement {
    const area = getContent().area(areaId);
    if (!area) throw new Error(`unknown area: ${areaId}`);
    const instance = this.pickInstance(area);
    const entityId = instance.world.spawn(name); // world uses the shared id allocator
    if (save) instance.world.importPlayer(entityId, save, area.spawn.x, area.spawn.y);
    return { instanceId: instance.id, entityId, areaId: area.id };
  }

  /**
   * Place a new player into a SPECIFIC existing instance, bypassing the player-cap load balancer.
   * Used to colocate AI bots with the GM who spawned them (so a `/bot 300` flood lands in your
   * world, not scattered across freshly-scaled instances). Returns null if the instance is gone.
   */
  joinInstance(instanceId: string, name: string): Placement | null {
    const instance = this.instances.get(instanceId);
    if (!instance) return null;
    const entityId = instance.world.spawn(name);
    return { instanceId: instance.id, entityId, areaId: instance.areaId };
  }

  /**
   * Fast-travel a player to another area's spawn (the waypoint system), carrying their full
   * persistent state — the same export/import dance as a portal crossing, but triggered on demand
   * rather than by stepping into a rect. Returns the transfer, or null if the area/player is gone.
   */
  teleport(fromInstanceId: string, entityId: number, toAreaId: string): TransferEvent | null {
    const from = this.instances.get(fromInstanceId);
    const target = getContent().area(toAreaId);
    if (!from || !target) return null;
    const save = from.world.exportPlayer(entityId);
    if (!save) return null;
    const dest = this.pickInstance(target);
    from.world.remove(entityId);
    dest.world.importPlayer(entityId, save, target.spawn.x, target.spawn.y);
    this.gc(from);
    return {
      entityId,
      fromInstanceId: from.id,
      toInstanceId: dest.id,
      toAreaId: target.id,
    };
  }

  /**
   * Open a FRESH rift instance at a difficulty tier and move the player into it. Unlike
   * teleport(), this never joins an existing instance — every opening is private, so the rift
   * re-rolls per run and the tier belongs to whoever paid for it. The instance is GC'd like any
   * other once it empties (leaving via the exit portal or disconnecting).
   */
  openRift(fromInstanceId: string, entityId: number, tier: number): TransferEvent | null {
    const from = this.instances.get(fromInstanceId);
    const target = getContent().area('rift');
    if (!from || !target) return null;
    const save = from.world.exportPlayer(entityId);
    if (!save) return null;
    const dest = this.spawnInstance(target, tier);
    from.world.remove(entityId);
    dest.world.importPlayer(entityId, save, target.spawn.x, target.spawn.y);
    this.gc(from);
    return {
      entityId,
      fromInstanceId: from.id,
      toInstanceId: dest.id,
      toAreaId: target.id,
    };
  }

  /**
   * Descend into a DEN: a fresh, private cellar-sized instance populated from the SOURCE area's
   * roster, whose exit returns to the exact spot the player went down (offset a step so the
   * hatch doesn't immediately re-trigger). Always a new instance — every den is its own roll.
   */
  openDen(fromInstanceId: string, entityId: number): TransferEvent | null {
    const from = this.instances.get(fromInstanceId);
    const den = getContent().area('den');
    if (!from || !den) return null;
    const stats = from.world.playerStats(entityId);
    const save = from.world.exportPlayer(entityId);
    if (!stats || !save) return null;
    const dest = this.spawnInstance(den);
    dest.returnTo = { areaId: from.areaId, x: stats.x + 70, y: stats.y + 40 };
    dest.world.populateDen(from.areaId);
    from.world.remove(entityId);
    dest.world.importPlayer(entityId, save, den.spawn.x, den.spawn.y);
    this.gc(from);
    return {
      entityId,
      fromInstanceId: from.id,
      toInstanceId: dest.id,
      toAreaId: den.id,
    };
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
    if (this.mode === 'single') return Number.POSITIVE_INFINITY;
    // A global floor so a crowd lands together in one instance (the authored per-area caps were
    // sized for a quiet world); dynamic mob-density scaling keeps a packed area from starving.
    return Math.max(area.playerCap, MIN_INSTANCE_CAP);
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

  private spawnInstance(area: AreaDef, tier = 0): Instance {
    const id = `${area.id}#${++this.instanceSeq}`;
    // Provenance: every instance carries its seed, so "dungeon seed X rolled a chest in a
    // wall" is a reproducible report, not an anecdote.
    const seed = (Date.now() ^ (this.instanceSeq * 2654435761)) >>> 0;
    const world = new World(
      area.width,
      area.height,
      area.spawn,
      () => this.nextEntityId++,
      area.id,
      this.corruption,
      tier,
      seed,
    );
    world.populateMobs(area.id);
    world.populateNpcs(area.id);
    world.applyWeather(area.theme?.weather ?? 'none');
    const instance: Instance = { id, areaId: area.id, world, seed };
    this.instances.set(id, instance);
    return instance;
  }

  private resolvePortals(): TransferEvent[] {
    const events: TransferEvent[] = [];
    // Snapshot the instance list so instances created mid-loop aren't scanned this tick.
    for (const instance of [...this.instances.values()]) {
      const area = getContent().area(instance.areaId);
      if (!area || area.portals.length === 0) continue;

      for (const entity of instance.world.snapshot()) {
        // Only PLAYERS portal-transfer. A hireling (or a wandering mob) crossing the rect must
        // not be exported — exportPlayer would miss and it would respawn as a ghost "player".
        if (entity.kind !== 'player') continue;
        const portal = area.portals.find((p) => pointInRect(entity.x, entity.y, p.rect));
        if (!portal) continue;

        // Den exits ignore the portal's authored destination: you come back up the same hatch.
        const target = getContent().area(instance.returnTo?.areaId ?? portal.toArea);
        if (!target) continue;
        const dest = this.pickInstance(target);
        const spawnAt = instance.returnTo ?? portal.toSpawn;

        // Carry the player's full persistent state (xp, gold, loot, gear, quests) across.
        const save = instance.world.exportPlayer(entity.id);
        instance.world.remove(entity.id);
        if (save) {
          dest.world.importPlayer(entity.id, save, spawnAt.x, spawnAt.y);
        } else {
          dest.world.spawn(entity.name, {
            id: entity.id,
            x: spawnAt.x,
            y: spawnAt.y,
            hue: entity.hue,
          });
        }
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
