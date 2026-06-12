/**
 * Brain-consumable world state + the single message→state application path.
 *
 * This is the seam between transport and decisions: the live BotClient (bot-client.ts)
 * and offline replay (replay.ts) both funnel decoded server messages through
 * `applyServerMessage`, so a recorded session drives the brain exactly like a live one.
 * Everything here is pure data-in/data-out — no sockets, no timers, no I/O.
 */

import type { EntityState, ServerMessage } from '../../src/shared/protocol.js';
import type { AreaDef } from '../../src/shared/areas.js';
import type { ItemInstance } from '../../src/shared/items.js';
import type { BrainView } from './behaviors.js';

/** The personal 'you' stats the bot cares about (subset of the wire message). */
export interface YouState {
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  dead: boolean;
  level: number;
  gold: number;
  x: number;
  y: number;
  loot: Record<string, number>;
  gear: ItemInstance[];
}

/** Everything the brain reads, accumulated from server messages. */
export interface BotWorldState {
  selfId: number;
  tickRate: number;
  areaId: string;
  /** Latest area-of-interest snapshot (entities near this bot). */
  entities: readonly EntityState[];
  you: YouState | null;
  /** Area definitions from the server's content packet, by id. */
  areas: Map<string, AreaDef>;
}

export function emptyWorldState(): BotWorldState {
  return { selfId: 0, tickRate: 0, areaId: '', entities: [], you: null, areas: new Map() };
}

/** The message kinds the brain consumes ('other' = ignored: chat, shop, admin, …). */
export type AppliedKind = 'content' | 'welcome' | 'snapshot' | 'you' | 'area_changed' | 'other';

/**
 * Apply one decoded server message to the world state. Defensive on purpose: decodeServer
 * only guarantees valid JSON, not field shapes, so every read is type-checked — a weird
 * field degrades to a safe default instead of corrupting the state.
 */
export function applyServerMessage(state: BotWorldState, msg: ServerMessage): AppliedKind {
  switch (msg.t) {
    case 'content':
      if (Array.isArray(msg.areas)) {
        for (const area of msg.areas) {
          if (area && typeof area.id === 'string') state.areas.set(area.id, area);
        }
      }
      return 'content';
    case 'welcome':
      state.selfId = typeof msg.id === 'number' ? msg.id : 0;
      state.tickRate = typeof msg.tickRate === 'number' ? msg.tickRate : 0;
      state.areaId = typeof msg.areaId === 'string' ? msg.areaId : '';
      return 'welcome';
    case 'snapshot':
      if (Array.isArray(msg.entities)) state.entities = msg.entities;
      return 'snapshot';
    case 'you':
      state.you = {
        hp: num(msg.hp),
        maxHp: num(msg.maxHp),
        mana: num(msg.mana),
        maxMana: num(msg.maxMana),
        dead: msg.dead === true,
        level: num(msg.level),
        gold: num(msg.gold),
        x: num(msg.x),
        y: num(msg.y),
        loot: msg.loot && typeof msg.loot === 'object' ? msg.loot : {},
        gear: Array.isArray(msg.gear) ? msg.gear : [],
      };
      return 'you';
    case 'area_changed':
      if (typeof msg.areaId === 'string') state.areaId = msg.areaId;
      state.entities = []; // stale: they belong to the previous instance
      return 'area_changed';
    default:
      // Unknown-but-parseable type: forward-compat, not an error worth crashing over.
      return 'other';
  }
}

/** Build the brain's per-tick view from world state (shared by stress.ts and replay.ts). */
export function viewFrom(state: BotWorldState, now: number): BrainView {
  const you = state.you;
  return {
    now,
    x: you?.x ?? 0,
    y: you?.y ?? 0,
    dead: you?.dead ?? false,
    bagCount: you ? Object.keys(you.loot).length + you.gear.length : 0,
    selfId: state.selfId,
    entities: state.entities,
    area: state.areas.get(state.areaId),
  };
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
