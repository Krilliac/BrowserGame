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
import type { AttributeSet } from './attributes.js';

/** One quest's state for the client quest log. */
export interface QuestState {
  id: string;
  name: string;
  description: string;
  /** 'kill' = slay N mobs (auto-progress); 'collect' = turn N items in to a quest-giver. */
  kind: 'kill' | 'collect';
  targetCount: number;
  /** Kills so far, or items currently held toward a collect quest (0 for available/done). */
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

/**
 * Wire-protocol version, checked first thing in `join`: a stale cached client (a phone bundle
 * that predates a deploy) is told to refresh instead of hitting confusing decode errors. Bump
 * on any breaking message-shape change.
 */
export const PROTOCOL_VERSION = 1;

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
  /**
   * Status bitflags for rendering tints / buff pips. Monster debuffs: 1 = slowed, 2 = burning,
   * 4 = weakened. Local-player buffs: 8 = might, 16 = haste, 32 = regen.
   */
  flags?: number;
  /** Humanoids (players/hirelings): visible-equipment bitfield for the paper-doll overlay —
   *  1 = helm (head), 2 = armor (chest), 4 = weapon (mainhand). Absent = no visible gear. */
  look?: number;
  /** Mobs only: true for an elite/champion (the client draws a marker + scales it up). */
  elite?: boolean;
  /** Mobs only: true once a player has damaged it — the client marks it as claimed/engaged
   *  (you still earn full shared credit for piling onto someone else's fight). */
  tagged?: boolean;
  /** NPCs only: their role, so the client shows the right prompt + marker ('vendor' | 'questgiver'). */
  npcKind?: string;
  /** Chests only: true once looted, so the client draws it open and stops prompting. */
  opened?: boolean;
  /** SQL sprite color override (#rrggbb, multiplied at render) — same source, many variations. */
  tint?: string;
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
  /** `v` is PROTOCOL_VERSION — mismatches get `refresh_required` and a close, never garbage. */
  | { t: 'join'; name: string; token?: string; v?: number }
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
  /** Socket a held gem into the first open socket on your equipped gear. */
  | { t: 'socket_gem'; gemId: string }
  /** Gamble gold for a random item of the given equip slot (at a nearby gambler NPC). */
  | { t: 'gamble'; slot: string }
  /** Hire a mercenary of the given type (at a nearby recruiter NPC; server validates gold). */
  | { t: 'hire'; type: string }
  /** Open an endgame rift at a difficulty tier (at the Riftkeeper; server validates tier + gold). */
  | { t: 'open_rift'; tier: number }
  /** Fast-travel to a previously-discovered area (server validates discovery). */
  | { t: 'waypoint'; areaId: string }
  /** Artificer: reroll a bag gear instance's affixes for gold + a rune shard. */
  | { t: 'enchant'; uid: number }
  /** Artificer: pop the gem out of an equipped item's socket back into the bag for gold. */
  | { t: 'unsocket_gem'; slot: string; index: number }
  /** Artificer: fuse 3 held gems of one kind into one of the next tier. */
  | { t: 'combine_gems' }
  /** Banker: move a bag gear instance into the stash (storage). */
  | { t: 'stash_deposit'; uid: number }
  /** Banker: move a stashed gear instance back into the bag. */
  | { t: 'stash_withdraw'; uid: number }
  /** Quaff a quick-use belt potion (instant restore, server-validated count + cooldown). */
  | { t: 'use_potion'; kind: 'health' | 'mana' }
  /** Spend one attribute point on an attribute (server validates the pool + the key). */
  | { t: 'allocate_attr'; attr: string }
  /** Spend one skill point to allocate a passive node (server validates points + prerequisites). */
  | { t: 'allocate_skill'; nodeId: string }
  /** Buy one item from a nearby vendor's stock. Server validates proximity, stock, and gold. */
  | { t: 'buy'; itemId: string }
  /** Sell the whole bag (materials + unequipped gear) to a nearby vendor. */
  | { t: 'sell' }
  /** Privileged "in-game engine" command — gated server-side by an admin token. */
  | { t: 'admin'; token: string; command: string }
  /** Dev engine panel request (Developer access). `rid` correlates the `engine_res` reply. */
  | { t: 'engine_req'; rid: number; op: EngineOp };

// --- Dev "Game Engine" panel (Developer access only) ------------------------------------

/** One operation the engine panel can ask the server to perform. The server gates the whole
 *  surface on access level >= Developer and validates each op at the boundary. */
export type EngineOp =
  | { kind: 'schema' } // editable-table specs + config knobs + dropdown lists
  | { kind: 'rows'; table: string } // all rows of a content table
  | { kind: 'edit'; table: string; id: string; column: string; value: string } // edit one cell
  | { kind: 'config'; path: string; value: number } // set a runtime config knob (e.g. difficulty.mobDamage)
  | { kind: 'reload' } // re-read content from the DB and re-skin all clients
  | { kind: 'spawn_bots'; count: number }
  | { kind: 'clear_bots' }
  | { kind: 'give'; itemId: string; qty: number } // gold via itemId 'gold'
  | { kind: 'add_xp'; amount: number }
  | { kind: 'set_level'; level: number }
  | { kind: 'spawn_mob'; templateId: string; count: number }
  | { kind: 'weather'; weather: string }
  | { kind: 'teleport'; areaId: string }
  | { kind: 'heal' }
  | { kind: 'set_access'; username: string; level: number };

/** Wire mirror of the server's editable-column spec (kept here so `shared` has no server import). */
export interface EngineColumnSpec {
  type: 'text' | 'int' | 'real' | 'color' | 'enum' | 'bool';
  min?: number;
  max?: number;
  values?: readonly string[];
  nullable?: boolean;
}
export interface EngineTableSpec {
  pk: string;
  label: string;
  note?: string;
  columns: Record<string, EngineColumnSpec>;
}
/** A runtime-tunable config knob (read/written live by the engine panel). */
export interface EngineConfigField {
  path: string; // e.g. 'difficulty.mobDamage'
  label: string;
  kind: 'int' | 'real';
  min: number;
  max: number;
  step: number;
  value: number;
}
export interface EngineConfigGroup {
  label: string;
  fields: EngineConfigField[];
}
export interface EngineNamed {
  id: string;
  name: string;
}
/** Everything the panel needs to render: schema, current config, and dropdown lists. */
export interface EngineSchema {
  tables: Record<string, EngineTableSpec>;
  config: EngineConfigGroup[];
  areas: EngineNamed[];
  templates: EngineNamed[];
  items: EngineNamed[];
  weathers: string[];
  access: { value: number; name: string }[];
}
export type EngineResData =
  | { kind: 'schema'; schema: EngineSchema }
  | { kind: 'rows'; columns: string[]; rows: Record<string, string | number | null>[] };

/** Messages the server sends to clients. */
export type ServerMessage =
  /** Game content from the server's SQLite DB, sent once on connect (areas, spells, items).
   *  `tints` are SQL sprite color overrides ('decor:<kind>' etc.) applied at render time. */
  | {
      t: 'content';
      areas: AreaDef[];
      abilities: Ability[];
      items: ItemInfo[];
      tints?: Record<string, string>;
      /** Area ids that are procedural dungeons — lets the client mark dungeon-bound portals. */
      dungeons?: string[];
    }
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
      /** Quick-use belt: counts of each potion kind. */
      potions: { health: number; mana: number };
      /** Allocated attributes (strength/vitality/dexterity/energy). */
      attributes: AttributeSet;
      /** Unspent attribute points to allocate. */
      attrPoints: number;
      /** Allocated passive skill-tree node ids. */
      skills: string[];
      /** Unspent skill points to allocate. */
      skillPoints: number;
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
      /** Area ids this character has visited (the waypoint fast-travel list). */
      discovered: string[];
      /** Area corruption 0..1 (drives the client's darkening of the scene). */
      corruption: number;
      /** Authoritative position + last input the server processed (client reconciliation). */
      x: number;
      y: number;
      ackSeq: number;
      /** Effective move multiplier (weather × affix × haste × slow) for the client predictor. */
      moveMul: number;
    }
  /** A nearby vendor's shop contents (sent when the player interacts with a vendor NPC). */
  | { t: 'shop'; vendor: string; stock: { itemId: string; price: number }[] }
  /** The player's stash (bank) contents — sent on opening a banker and after each deposit/withdraw. */
  | { t: 'stash'; items: ItemInstance[]; cap: number }
  /**
   * The receiving player's full party state. `members` is empty when not in a party;
   * `inviteFrom` is set when an unanswered invite is pending (so the client can prompt).
   */
  | { t: 'party'; members: PartyMember[]; inviteFrom?: string }
  /** The receiving player's full friends list with live presence. */
  | { t: 'friends'; list: FriendInfo[] }
  /** Open the gambling window (sent when interacting with a gambler NPC); `cost` is per pull. */
  | { t: 'gamble_open'; cost: number }
  /** Open the hire window (sent when interacting with a recruiter NPC). */
  | { t: 'hire_open'; offers: { type: string; name: string; cost: number }[] }
  /** Open the rift window (sent when interacting with the Riftkeeper); fee = tier × costBase. */
  | { t: 'rift_open'; maxTier: number; costBase: number }
  /** Open the Artificer window (sent when interacting with an artificer NPC). */
  | { t: 'artificer_open'; rerollCost: number; unsocketCost: number }
  /** The server moved this player to another area instance (e.g. through a portal). */
  | { t: 'area_changed'; areaId: string; instanceId: string }
  | { t: 'chat'; from: string; text: string; channel?: ChatChannel }
  /** The client's bundle predates the server's protocol — show a refresh prompt, stop retrying. */
  | { t: 'refresh_required' }
  | { t: 'admin_result'; ok: boolean; message: string }
  /** This connection's current access level (0 = Player; raised via /login). Lets the client
   *  surface GM-only settings. Purely a UX hint — privileged powers stay gated server-side. */
  | { t: 'access'; level: number }
  /** Reply to an `engine_req` (Dev engine panel). `rid` matches the request. */
  | { t: 'engine_res'; rid: number; ok: boolean; message?: string; data?: EngineResData };

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
