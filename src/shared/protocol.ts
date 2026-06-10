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

/** One quest's state for the client quest log. */
export interface QuestState {
  id: string;
  name: string;
  description: string;
  targetCount: number;
  /** Kills so far (0 for available/done). */
  progress: number;
  status: 'available' | 'active' | 'done';
  /** Reward summary for the log (gold/xp + optional item name). */
  rewardGold: number;
  rewardXp: number;
  rewardItem: string | null;
}

/** Item display/stat info sent to the client (mirrors the server's content DB items). */
export interface ItemInfo {
  id: string;
  name: string;
  kind: string;
  /** Item slot (head/chest/mainhand/ring/…) for equippable items, else null. */
  slot: string | null;
  power: number | null;
  hp: number | null;
  color: string | null;
  sellValue: number;
  /** Spellbooks only: the ability this book teaches (null for everything else). */
  teaches: string | null;
}

/** Largest party size (leader + members). */
export const MAX_PARTY_SIZE = 5;

/** One member of a player's party, as shown in the party roster. */
export interface PartyMember {
  id: number;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  /** Area id the member is currently in (parties span instances/areas). */
  areaId: string;
  /** True while the member has a live connection. */
  online: boolean;
  /** True for the party leader. */
  leader: boolean;
}

/** Maximum friends per player. */
export const MAX_FRIENDS = 50;

/** One entry in a player's friends list. */
export interface FriendInfo {
  name: string;
  online: boolean;
  /** Area the friend is in when online (empty when offline). */
  areaId: string;
  /** Friend's level when online (0 when offline/unknown). */
  level: number;
}

/** Chat channel a message belongs to, so the client can color/route it. */
export type ChatChannel = 'say' | 'system' | 'party' | 'whisper';

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
  /** Mobs only: true for an elite/champion (the client draws a marker + scales it up). */
  elite?: boolean;
  /** NPCs only: their role, so the client shows the right prompt + marker ('vendor' | 'questgiver'). */
  npcKind?: string;
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
  /** Interact with a nearby NPC (open a vendor's shop / talk to a quest-giver). */
  | { t: 'interact' }
  /** Equip a gear instance from the player's bag, by its unique id. */
  | { t: 'equip'; uid: number }
  /** Unequip the item in a doll slot (head/chest/mainhand/ring1/…) back to the bag. */
  | { t: 'unequip'; slot: string }
  /** Read a spellbook from the bag: learn its spell (or rank it up). Server validates ownership. */
  | { t: 'learn'; itemId: string }
  /** Accept an available quest from the quest-log panel. Server validates it exists + isn't taken. */
  | { t: 'accept_quest'; questId: string }
  /** Invite another online player to a party by name (server resolves the target + caps size). */
  | { t: 'party_invite'; targetName: string }
  /** Accept the pending party invite (if any). */
  | { t: 'party_accept' }
  /** Decline the pending party invite (if any). */
  | { t: 'party_decline' }
  /** Leave the current party (the leader leaving disbands or promotes). */
  | { t: 'party_leave' }
  /** Add a player to the friends list by name. */
  | { t: 'friend_add'; name: string }
  /** Remove a friend by name. */
  | { t: 'friend_remove'; name: string }
  /** Send a private whisper to another player by name. */
  | { t: 'whisper'; to: string; text: string }
  /** Buy one item from a nearby vendor's stock. Server validates proximity, stock, and gold. */
  | { t: 'buy'; itemId: string }
  /** Sell the whole bag (materials + unequipped gear) to a nearby vendor. */
  | { t: 'sell' }
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
      /** Crit chance in [0,1] (base + equipped +crit affixes). */
      critChance: number;
      /** Equipped gear by doll slot (head/chest/mainhand/ring1/… → instance or null). */
      equipment: Record<string, ItemInstance | null>;
      /** Spells this character has learned: ability id → rank (1..MAX_SPELL_RANK). */
      known: Record<string, number>;
      /** Quest log: available + active (with progress) + completed quests. */
      quests: QuestState[];
      /** Area corruption 0..1 (drives the client's darkening of the scene). */
      corruption: number;
      /** Authoritative position + last input the server processed (client reconciliation). */
      x: number;
      y: number;
      ackSeq: number;
    }
  /** A nearby vendor's shop contents (sent when the player interacts with a vendor NPC). */
  | { t: 'shop'; vendor: string; stock: { itemId: string; price: number }[] }
  /**
   * The receiving player's full party state. `members` is empty when not in a party;
   * `inviteFrom` is set when an unanswered invite is pending (so the client can prompt).
   */
  | { t: 'party'; members: PartyMember[]; inviteFrom?: string }
  /** The receiving player's full friends list with live presence. */
  | { t: 'friends'; list: FriendInfo[] }
  /** The server moved this player to another area instance (e.g. through a portal). */
  | { t: 'area_changed'; areaId: string; instanceId: string }
  | { t: 'chat'; from: string; text: string; channel?: ChatChannel }
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
