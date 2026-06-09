/**
 * Wire protocol shared by client and server.
 *
 * Design note (carried from SparkEngine's Networking architecture): the server is
 * AUTHORITATIVE. Clients send *intent* (inputs), never state. The server simulates
 * and broadcasts snapshots. This is the foundation of both fairness and anti-cheat —
 * a malicious client can lie about its input but cannot teleport, because it never
 * gets to assert its own position.
 */

import type { AbilityId, Ability, EntityKind, FxEvent } from './combat.js';
import type { AreaDef } from './areas.js';
import type { ItemInstance } from './items.js';

/** Item display/stat info sent to the client (mirrors the server's content DB items). */
export interface ItemInfo {
  id: string;
  name: string;
  kind: string;
  slot: 'weapon' | 'armor' | null;
  power: number | null;
  hp: number | null;
  color: string | null;
  sellValue: number;
}

/** Simulation tick rate in Hz. Overridable via the TICK_RATE env var on the server. */
export const DEFAULT_TICK_RATE = 20;

/** Per-entity movement speed in world units per second. Server-enforced. */
export const PLAYER_SPEED = 180;

/** World bounds in pixels. The authoritative server clamps every entity to this box. */
export const WORLD_WIDTH = 2000;
export const WORLD_HEIGHT = 2000;

/** Hard caps the server enforces on untrusted client input. */
export const MAX_CHAT_LENGTH = 200;
export const MAX_NAME_LENGTH = 16;

/** Largest accepted WebSocket frame (bytes). Anything bigger is dropped/closed. */
export const MAX_MESSAGE_BYTES = 4096;

/** A single networked entity's replicated state. */
export interface EntityState {
  id: number;
  x: number;
  y: number;
  /** Display name. */
  name: string;
  /** Cosmetic hue 0..360 so players are visually distinguishable. */
  hue: number;
  kind: EntityKind;
  /** Facing direction in radians (for character orientation / projectile travel). */
  facing: number;
  /** Current / max health. Projectiles report 0/0. */
  hp: number;
  maxHp: number;
  /** Character level (players and mobs). */
  level: number;
  /** Projectiles only: which ability spawned it, so the client picks the right sprite. */
  abilityId?: AbilityId;
  /** Projectiles only: true for an enemy projectile (hits players) — the client tints it hostile. */
  hostile?: boolean;
  /** Items only: dropped item id + quantity. */
  itemId?: string;
  qty?: number;
  /** Gear drops only: rarity tier, so the client can color the ground glint. */
  rarity?: string;
  /** Status bitflags for rendering tints (1 = slowed, 2 = burning). */
  flags?: number;
}

/** Directional intent for one frame, normalized to -1..1 on each axis. */
export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

/** Messages the client sends to the server. */
export type ClientMessage =
  | { t: 'join'; name: string; token?: string }
  /** Movement intent with a client sequence number (for prediction/reconciliation). */
  | { t: 'input'; input: InputState; seq: number }
  /** Cast an ability aimed in direction (dx, dy); the server normalizes and validates. */
  | { t: 'cast'; ability: AbilityId; dx: number; dy: number }
  | { t: 'chat'; text: string }
  /** Interact with a nearby NPC (e.g. sell loot to the town vendor). */
  | { t: 'interact' }
  /** Equip a gear instance from the player's bag, by its unique id. */
  | { t: 'equip'; uid: number }
  /** Privileged "in-game engine" command — gated server-side by an admin token. */
  | { t: 'admin'; token: string; command: string };

/** Messages the server sends to clients. */
export type ServerMessage =
  /** Game content from the server's SQLite DB, sent once on connect (areas, spells, items). */
  | { t: 'content'; areas: AreaDef[]; abilities: Ability[]; items: ItemInfo[] }
  | {
      t: 'welcome';
      id: number;
      tickRate: number;
      areaId: string;
      instanceId: string;
      /** Opaque save token for this client to persist and present on reconnect. */
      token: string;
    }
  | { t: 'snapshot'; tick: number; entities: EntityState[]; fx: FxEvent[] }
  /** Personal stats for the receiving player (kept off the shared snapshot). */
  | {
      t: 'you';
      hp: number;
      maxHp: number;
      mana: number;
      maxMana: number;
      dead: boolean;
      level: number;
      xp: number;
      xpInto: number;
      xpNext: number;
      gold: number;
      /** Non-gold material loot held: item id -> quantity (stackable, sold to the vendor). */
      loot: Record<string, number>;
      /** Unequipped gear instances held in the bag (each with rolled rarity + stats). */
      gear: ItemInstance[];
      /** Milliseconds until respawn while dead (0 when alive). */
      respawnIn: number;
      /** Attack power from the equipped weapon (added to every hit). */
      power: number;
      /** Equipped gear instances (null when the slot is empty). */
      weapon: ItemInstance | null;
      armor: ItemInstance | null;
      /** Authoritative position + last input the server processed (client reconciliation). */
      x: number;
      y: number;
      ackSeq: number;
    }
  /** The server moved this player to another area instance (e.g. through a portal). */
  | { t: 'area_changed'; areaId: string; instanceId: string }
  | { t: 'chat'; from: string; text: string }
  | { t: 'admin_result'; ok: boolean; message: string };

export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

export function decodeClient(raw: string): ClientMessage | null {
  return safeParse<ClientMessage>(raw);
}

export function decodeServer(raw: string): ServerMessage | null {
  return safeParse<ServerMessage>(raw);
}

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
