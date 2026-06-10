/**
 * Bot behavior state machine — simple, readable coverage of the core gameplay loops:
 * wander the area, fight the nearest mob, walk over ground loot, sell at the vendor,
 * and occasionally walk into a portal. Pure decisions over a snapshot view, so the
 * machine is unit-testable with fake data (no socket required).
 */

import type { EntityState, InputState } from '../../src/shared/protocol.js';
import { pointInRect, type AreaDef } from '../../src/shared/areas.js';

/** Which loops a bot runs: grind = fight/loot/vendor, wander = walk only, hopper = + portals. */
export type BotProfile = 'grind' | 'wander' | 'hopper';

export type BrainState = 'WANDER' | 'FIGHT' | 'LOOT' | 'VENDOR' | 'PORTAL_HOP';

/** Everything the brain reads each tick — built from BotClient state (or faked in tests). */
export interface BrainView {
  now: number;
  x: number;
  y: number;
  dead: boolean;
  /** Loot stacks + gear instances held (drives the vendor trip). */
  bagCount: number;
  selfId: number;
  entities: readonly EntityState[];
  area: AreaDef | undefined;
}

/** What the bot should do this tick. `input` is always present (idle = all false). */
export interface BrainAction {
  input: InputState;
  cast?: { ability: 'arrow'; dx: number; dy: number };
  interact?: boolean;
}

const IDLE: InputState = { up: false, down: false, left: false, right: false };
const ATTACK_RANGE = 300; // stand-off distance for the arrow (range 620)
const CAST_INTERVAL_MS = 450; // arrow cooldown is 380ms; stay safely under spam
const LOOT_NOTICE_RANGE = 350; // only detour for loot reasonably nearby
const VENDOR_RANGE = 55; // server INTERACT_RANGE is 70
const INTERACT_INTERVAL_MS = 1000;
const ARRIVE_DIST = 14;
const VENDOR_BAG_SIZE = 10; // head to town vendor once the bag holds this much
const HOP_MIN_MS = 15_000;
const HOP_JITTER_MS = 30_000;

export class BotBrain {
  state: BrainState = 'WANDER';
  private waypoint: { x: number; y: number } | null = null;
  private lastCastAt = 0;
  private lastInteractAt = 0;
  private nextHopAt: number;
  private portalIndex = 0;
  private lastAreaId = '';

  constructor(
    readonly profile: BotProfile,
    private readonly rng: () => number = Math.random,
    now: number = Date.now(),
  ) {
    this.nextHopAt = now + HOP_MIN_MS + this.rng() * HOP_JITTER_MS;
  }

  /** Call when the bot's area changes (portal taken) — resets goals tied to the old area. */
  noteArea(areaId: string, now: number = Date.now()): void {
    if (areaId === this.lastAreaId) return;
    this.lastAreaId = areaId;
    this.waypoint = null;
    if (this.state === 'PORTAL_HOP') {
      this.state = 'WANDER';
      this.nextHopAt = now + HOP_MIN_MS + this.rng() * HOP_JITTER_MS;
    }
  }

  decide(view: BrainView): BrainAction {
    if (view.dead) return { input: IDLE };
    this.pickState(view);
    switch (this.state) {
      case 'FIGHT':
        return this.fight(view);
      case 'LOOT':
        return this.loot(view);
      case 'VENDOR':
        return this.vendor(view);
      case 'PORTAL_HOP':
        return this.portalHop(view);
      default:
        return this.wander(view);
    }
  }

  private pickState(view: BrainView): void {
    if (this.profile === 'wander') {
      this.state = 'WANDER';
      return;
    }
    if (this.profile === 'hopper') {
      if (this.state !== 'PORTAL_HOP' && view.now >= this.nextHopAt && portals(view).length > 0) {
        this.state = 'PORTAL_HOP';
        this.portalIndex = Math.floor(this.rng() * portals(view).length);
        this.waypoint = null;
      }
      if (this.state !== 'PORTAL_HOP') this.state = 'WANDER';
      return;
    }
    // grind: vendor when the bag is heavy and a vendor is visible, else fight > loot > wander.
    const vendorNpc = nearest(view, (e) => e.kind === 'npc' && e.npcKind === 'vendor');
    if (view.bagCount >= VENDOR_BAG_SIZE && vendorNpc) {
      this.state = 'VENDOR';
      return;
    }
    if (nearest(view, (e) => e.kind === 'mob' && e.hp > 0)) {
      this.state = 'FIGHT';
      return;
    }
    if (nearestWithin(view, LOOT_NOTICE_RANGE, (e) => e.kind === 'item')) {
      this.state = 'LOOT';
      return;
    }
    this.state = 'WANDER';
  }

  private fight(view: BrainView): BrainAction {
    const mob = nearest(view, (e) => e.kind === 'mob' && e.hp > 0);
    if (!mob) return this.wander(view);
    const dist = Math.hypot(mob.x - view.x, mob.y - view.y);
    if (dist > ATTACK_RANGE) return { input: walkToward(view, mob.x, mob.y) };
    if (view.now - this.lastCastAt >= CAST_INTERVAL_MS) {
      this.lastCastAt = view.now;
      return { input: IDLE, cast: { ability: 'arrow', dx: mob.x - view.x, dy: mob.y - view.y } };
    }
    return { input: IDLE };
  }

  private loot(view: BrainView): BrainAction {
    const item = nearestWithin(view, LOOT_NOTICE_RANGE, (e) => e.kind === 'item');
    if (!item) return this.wander(view);
    return { input: walkToward(view, item.x, item.y) }; // pickup is automatic within 30px
  }

  private vendor(view: BrainView): BrainAction {
    const npc = nearest(view, (e) => e.kind === 'npc' && e.npcKind === 'vendor');
    if (!npc) return this.wander(view);
    const dist = Math.hypot(npc.x - view.x, npc.y - view.y);
    if (dist > VENDOR_RANGE) return { input: walkToward(view, npc.x, npc.y) };
    if (view.now - this.lastInteractAt >= INTERACT_INTERVAL_MS) {
      this.lastInteractAt = view.now;
      return { input: IDLE, interact: true };
    }
    return { input: IDLE };
  }

  private portalHop(view: BrainView): BrainAction {
    const ports = portals(view);
    const portal = ports[this.portalIndex % Math.max(1, ports.length)];
    if (!portal) return this.wander(view);
    const cx = portal.rect.x + portal.rect.w / 2;
    const cy = portal.rect.y + portal.rect.h / 2;
    return { input: walkToward(view, cx, cy) }; // crossing fires area_changed → noteArea resets
  }

  private wander(view: BrainView): BrainAction {
    const area = view.area;
    if (!area) return { input: IDLE };
    if (
      !this.waypoint ||
      Math.hypot(this.waypoint.x - view.x, this.waypoint.y - view.y) <= ARRIVE_DIST
    ) {
      this.waypoint = this.pickWaypoint(area);
    }
    return { input: walkToward(view, this.waypoint.x, this.waypoint.y) };
  }

  /** Random in-bounds point; re-rolled a few times to avoid landing inside a portal rect. */
  private pickWaypoint(area: AreaDef): { x: number; y: number } {
    const margin = 60;
    for (let i = 0; i < 5; i++) {
      const x = margin + this.rng() * Math.max(1, area.width - margin * 2);
      const y = margin + this.rng() * Math.max(1, area.height - margin * 2);
      if (!area.portals.some((p) => pointInRect(x, y, p.rect))) return { x, y };
    }
    return { x: area.spawn.x, y: area.spawn.y };
  }
}

/** 4-directional intent toward a target, with a small per-axis deadzone. */
export function walkToward(from: { x: number; y: number }, tx: number, ty: number): InputState {
  const dead = 6;
  return {
    up: ty < from.y - dead,
    down: ty > from.y + dead,
    left: tx < from.x - dead,
    right: tx > from.x + dead,
  };
}

function portals(view: BrainView): AreaDef['portals'] {
  return view.area?.portals ?? [];
}

function nearest(view: BrainView, pred: (e: EntityState) => boolean): EntityState | undefined {
  return nearestWithin(view, Infinity, pred);
}

function nearestWithin(
  view: BrainView,
  maxDist: number,
  pred: (e: EntityState) => boolean,
): EntityState | undefined {
  let best: EntityState | undefined;
  let bestDist = maxDist;
  for (const e of view.entities) {
    if (e.id === view.selfId || !pred(e)) continue;
    const d = Math.hypot(e.x - view.x, e.y - view.y);
    if (d <= bestDist) {
      best = e;
      bestDist = d;
    }
  }
  return best;
}
