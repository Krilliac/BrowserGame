import { clamp } from '../shared/math.js';
import { moveVector } from '../shared/movement.js';
import {
  MAX_NAME_LENGTH,
  PLAYER_SPEED,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type EntityState,
  type InputState,
  type QuestState,
} from '../shared/protocol.js';
import {
  HP_REGEN_PER_SEC,
  MANA_REGEN_PER_SEC,
  MAX_SPELL_RANK,
  MOB_RADIUS,
  MOB_RESPAWN_MS,
  PLAYER_MAX_HP,
  PLAYER_MAX_MANA,
  PLAYER_RADIUS,
  PLAYER_RESPAWN_MS,
  STARTER_ABILITIES,
  spellRankMult,
  type AbilityId,
  type FxEvent,
} from '../shared/combat.js';
import { aimAngle, circlesOverlap, inMeleeCone } from './combat.js';
import {
  applyCrit,
  attackRoll,
  BASE_CRIT_CHANCE,
  defenceRoll,
  rollCrit,
  rollDamage,
  rolledHit,
} from './combat-formulas.js';
import {
  gearSellValue,
  rollAffixes,
  rollCorruptedAffixes,
  rollCorruptedInstance,
  rollItemInstance,
  rollVendorInstance,
  type BaseItem,
  type ItemInstance,
} from '../shared/items.js';
import {
  GEMS,
  GEMS_PER_COMBINE,
  gemBonuses,
  isGem,
  nextGemTier,
  rollGemDrop,
} from '../shared/gems.js';
import { gambleCost, isGambleSlot, rollGamble } from '../shared/gamble.js';
import { AreaCorruption, CORRUPT_DROP_MAX, CORRUPT_MAX_DMG_BONUS } from './area-corruption.js';
import { EQUIP_SLOTS, dollSlotsFor, type EquipSlot, type ItemSlot } from '../shared/equipment.js';
import {
  stepMob,
  MOB_SPELLS,
  MOB_SUPPORT,
  type MobTemplate,
  type MobView,
  type PlayerView,
} from './mobs.js';
import { DUNGEONS, type DungeonDef, type Rect } from '../shared/areas.js';
import { resolveCircleMove, wallsForDecor, PLAYER_COLLISION_RADIUS } from '../shared/collision.js';
import { rollRandomUnique } from '../shared/uniques.js';
import {
  type AttributeSet,
  attributeBonuses,
  emptyAttributes,
  toAttributeSet,
  ATTRIBUTE_KEYS,
  ATTR_POINTS_PER_LEVEL,
} from '../shared/attributes.js';
import { aggregateSkillEffects, canAllocate } from '../shared/skilltree.js';
import { levelForXp, levelProgress, maxHpForLevel, xpForLevel, xpReward } from './progression.js';
import { StatusSet } from './status-effects.js';
import { getContent, type QuestDef } from './content.js';
import { weatherModifiers } from './weather-effects.js';
import type { WeatherKind } from '../shared/theme.js';

type Equipment = Record<EquipSlot, ItemInstance | null>;

/** A fresh equipment record with every doll slot empty. */
function emptyEquipment(): Equipment {
  const eq = {} as Equipment;
  for (const slot of EQUIP_SLOTS) eq[slot] = null;
  return eq;
}

/** Build the roll base from a content item, or null if it isn't equippable. */
function asBaseItem(def: {
  id: string;
  name: string;
  slot: string | null;
  kind: string;
  power: number | null;
  hp: number | null;
}): BaseItem | null {
  if (def.kind !== 'equip' || !def.slot) return null;
  return { id: def.id, name: def.name, slot: def.slot as ItemSlot, power: def.power, hp: def.hp };
}

const PICKUP_RADIUS = 30;
const ITEM_TTL_MS = 30_000;
const INTERACT_RANGE = 70;
// The unequipped-gear bag holds up to this many pieces; a new piece beyond the cap evicts the oldest
// (sell or equip to keep the good stuff). The HUD only shows the newest few — see the client.
const MAX_BAG_GEAR = 30;
// Bank stash slots — far larger than the bag, so the overflow has somewhere safe to go.
const STASH_CAP = 60;
// Shrines (decor kind 'shrine'): step within this radius to be blessed; the shrine then recharges
// for the cooldown before it can bless again (shared across players, Diablo-shrine style).
const SHRINE_RADIUS = 46;
const SHRINE_COOLDOWN_MS = 60_000;
// Chests (decor kind 'chest'): walk within this radius to pry one open once; it spills gold + gear.
const CHEST_RADIUS = 52;
const CHEST_GOLD_MIN = 25;
const CHEST_GOLD_MAX = 90;
// Quick-use potion belt: instant restore on use, a shared use-cooldown, and a carry cap. Topped up
// by the Healer and found in chests — the active-survival layer on top of passive regen.
const POTION_CAP = 8;
const POTION_START = 3; // a new character starts with a few of each
const POTION_HEAL = 70; // HP restored by a health potion
const POTION_MANA = 60; // mana restored by a mana potion
const POTION_COOLDOWN_MS = 2500;
// Passive skill-tree points earned per level (separate pool from attribute points).
const SKILL_POINTS_PER_LEVEL = 1;
// Unique (named legendary) drop chances: the loot chase. A slim base chance on any gear drop, better
// from a chest. Elites/bosses already drop more gear, so they roll the base chance more often.
const UNIQUE_DROP_CHANCE = 0.02;
const CHEST_UNIQUE_CHANCE = 0.08;
// Artificer service costs (flat, predictable): reroll an item's affixes for gold + a rune shard;
// pop a socketed gem back to the bag for gold.
export const ARTIFICER_REROLL_GOLD = 250;
export const ARTIFICER_UNSOCKET_GOLD = 120;
const DASH_MS = 300; // how long a charger's lunge lasts

// Living loot meta — a "hunting bounty" per monster type that regenerates while it is left alone and
// is consumed on a kill, so the first kills after a lull are richer and spam-farming yields base loot.
const BOUNTY_FULL_MS = 60_000; // a minute untouched = a full bounty
const BOUNTY_MAX_CHANCE = 0.5; // bonus-drop chance at a full bounty

// Extra corrupted-gear sources independent of the area's corruption level: a slim chance from
// invasion champions, and an even slimmer chance from bosses (below the ~0.43% legendary rate).
const INVASION_CORRUPT_CHANCE = 0.08;
const BOSS_CORRUPT_CHANCE = 0.003;

// Spellbook drops: spells are loot. An independent per-kill roll (separate from gear/materials)
// drops a random tome — the exciting acquisition path beside the deterministic vendor shelf.
// Tuned to ~1–2 books per play-hour in level-appropriate content (PoE2 uncut-gem model).
const SPELLBOOK_DROP_NORMAL = 0.004; // 0.4% per ordinary kill (1 in 250)
const SPELLBOOK_DROP_ELITE = 0.03; // 3% per champion
const SPELLBOOK_DROP_BOSS = 0.3; // 30% per area boss

// Gem drops: more common than spellbooks (they stack into sockets, a smaller per-item bonus).
const GEM_DROP_NORMAL = 0.02; // 2% per ordinary kill
const GEM_DROP_ELITE = 0.12; // 12% per champion
const GEM_DROP_BOSS = 0.6; // 60% per area boss

// How often a support-caster monster may re-cast its self-buff/heal (War Cry / Sprint / Renew).
const MOB_SUPPORT_COOLDOWN_MS = 7000;

// Vendor stock: spell prices are scaled up (a gold sink that keeps drops the exciting path), and a
// vendor shows only a rotating WINDOW of its tomes so the shop never overflows the UI. The window
// advances on a sim-time bucket, so the spell selection rotates over the session.
const VENDOR_PRICE_MULT = 1.6;
const VENDOR_STOCK_CAP = 10;
const VENDOR_ROTATE_MS = 240_000; // ~4 minutes per rotation

// Elite ("champion") monsters: a small chance to spawn a beefed-up variant with a flavor modifier.
const ELITE_CHANCE = 0.09;
const ELITE_MODIFIERS: { name: string; hp: number; dmg: number; spd: number }[] = [
  { name: 'Swift', hp: 2.0, dmg: 1.3, spd: 1.6 }, // fast and harassing
  { name: 'Brutal', hp: 2.4, dmg: 1.9, spd: 1.0 }, // hits like a truck
  { name: 'Vigorous', hp: 3.4, dmg: 1.4, spd: 1.0 }, // a damage sponge
];

export interface SpawnOptions {
  id?: number;
  x?: number;
  y?: number;
  hue?: number;
}

interface Player {
  id: number;
  name: string;
  x: number;
  y: number;
  hue: number;
  facing: number;
  hp: number;
  maxHp: number;
  mana: number;
  level: number;
  xp: number;
  gold: number;
  loot: Map<string, number>;
  /** Unequipped gear instances in the bag (rolled rarity + stats). */
  gear: ItemInstance[];
  /** Stored gear in the bank stash (deposited at a banker; persisted; far larger than the bag). */
  stash: ItemInstance[];
  equipment: Equipment;
  power: number;
  /** Crit chance in [0,1]: base plus the sum of equipped +crit affixes. */
  critChance: number;
  /** Extra projectiles per projectile cast, from equipped +multishot affixes. */
  multishot: number;
  /** Fraction of damage dealt healed back, 0..1 (from +lifesteal affixes). */
  lifesteal: number;
  /** Cooldown multiplier (<1 = faster), from +swift affixes; clamped. */
  cooldownMult: number;
  /** Movement-speed multiplier (>1 = faster), from +move affixes; clamped. */
  moveMult: number;
  /** Incoming-damage multiplier from +fragile (raises it) and +armor (lowers it); floored. */
  damageTakenMult: number;
  /** Bonus HP regenerated per second from +vigor affixes (added to base regen). */
  vigor: number;
  /** Bonus mana/sec from the Energy attribute (added to base mana regen). */
  manaRegenBonus: number;
  /** Allocatable attributes (strength/vitality/dexterity/energy) feeding derived stats. */
  attributes: AttributeSet;
  /** Unspent attribute points (earned on level-up). */
  attrPoints: number;
  /** Allocated passive skill-tree node ids. */
  skills: Set<string>;
  /** Unspent skill points (earned on level-up). */
  skillPoints: number;
  god: boolean;
  quests: Map<string, number>; // questId -> kill progress
  questsDone: Set<string>;
  /** Learned spells: ability id -> rank (1..MAX_SPELL_RANK). Casting is gated on this. */
  known: Map<AbilityId, number>;
  /** Area ids this character has visited — the waypoint fast-travel list. */
  discovered: Set<string>;
  input: InputState;
  lastSeq: number;
  cooldowns: Map<AbilityId, number>;
  /** Quick-use potion belt: counts of each kind, capped at POTION_CAP. */
  potions: { health: number; mana: number };
  /** Sim time (ms) when the belt can be used again (a shared use-cooldown across both potions). */
  potionReadyAt: number;
  /** Active temporary self-buffs (might / haste / regen) from buff spells. */
  buffs: StatusSet;
  /** Active debuffs applied by enemy spells (slow / burn / weaken). */
  debuffs: StatusSet;
  dead: boolean;
  respawnAt: number;
}

/** Serializable player state, carried across area instances on a portal crossing. */
export interface PlayerSave {
  name: string;
  hue: number;
  hp: number;
  mana: number;
  level: number;
  xp: number;
  gold: number;
  loot: [string, number][];
  gear: ItemInstance[];
  /** Banked stash gear (absent on pre-stash saves — defaults to empty). */
  stash?: ItemInstance[];
  /** Potion belt counts (absent on pre-potion saves — defaults to the starting amount). */
  potions?: { health: number; mana: number };
  /** Allocated attributes (absent on pre-attribute saves — granted retroactively on load). */
  attributes?: AttributeSet;
  /** Unspent attribute points (absent on old saves). */
  attrPoints?: number;
  /** Allocated skill-tree node ids (absent on pre-skill saves). */
  skills?: string[];
  /** Unspent skill points (absent on old saves — granted retroactively on load). */
  skillPoints?: number;
  /** Equipped gear by doll slot; partial-friendly so older saves migrate cleanly. */
  equipment: Record<string, ItemInstance | null>;
  god: boolean;
  quests: [string, number][];
  questsDone: string[];
  /** Learned spells (id -> rank). Absent in pre-spellbook saves; those grandfather to all spells. */
  known?: [string, number][];
  /** Visited area ids (waypoints). Absent on old saves — the current area is added on load. */
  discovered?: string[];
}

interface Mob {
  id: number;
  templateId: string;
  name: string;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  hue: number;
  facing: number;
  hp: number;
  maxHp: number;
  level: number;
  attackCd: number;
  wanderAngle: number | null;
  wanderUntil: number;
  statuses: StatusSet;
  lastAttacker: number;
  /** Support-caster cooldown (ms) until this mob may self-buff/heal again (0 = ready). */
  supportCd: number;
  dead: boolean;
  respawnAt: number;
  /** Attack wind-up: sim time (ms) the telegraphed strike lands at (0 = not winding up). */
  telegraphUntil: number;
  /** Aim locked when the wind-up started (so a moving player can dodge out of it). */
  telegraphFacing: number;
  telegraphTargetId: number;
  /** Charger dash: sim time (ms) the lunge ends at (0 = not dashing). */
  dashUntil: number;
  dashVx: number;
  dashVy: number;
  /** Players already struck by the current dash (each is hit at most once per lunge). */
  dashHit: Set<number>;
  /** Elite ("champion") flag + its stat multipliers; bigger, deadlier, drops better loot. */
  elite: boolean;
  dmgMult: number;
  spdMult: number;
  /** Spawned by an invasion event — its drops carry a slim corrupted-gear chance. */
  invader: boolean;
}

interface Projectile {
  id: number;
  abilityId: AbilityId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttl: number;
  damage: number;
  radius: number;
  ownerId: number;
  ownerLevel: number;
  /** Owner's crit chance at fire time (player projectiles); 0 for mob projectiles. */
  critChance: number;
  /** True for an enemy (mob) projectile — it damages players instead of mobs. */
  hostile: boolean;
}

interface GroundItem {
  id: number;
  itemId: string;
  qty: number;
  x: number;
  y: number;
  ttl: number;
  /** Set for gear drops: the rolled instance the picker-up receives. */
  instance?: ItemInstance;
}

type NpcKind = 'vendor' | 'questgiver' | 'healer' | 'gambler' | 'artificer' | 'banker';

interface Npc {
  id: number;
  name: string;
  x: number;
  y: number;
  hue: number;
  kind: NpcKind;
}

/**
 * The authoritative simulation for ONE area instance: players, monsters, projectiles, and
 * combat. Pure of any networking/timers so it is fully testable and could run in its own
 * process (the AreaServer model). Inputs/casts come in, the world advances by a fixed dt,
 * a snapshot + transient effects go out. No client ever writes state directly.
 */
export class World {
  private localId = 1;
  private readonly allocId: () => number;
  private now = 0; // accumulated sim time, ms (drives cooldowns/respawns)
  // Shrines for this area, lazily built from the area's 'shrine' decor (null = not yet built).
  private shrines: { x: number; y: number; readyAt: number }[] | null = null;
  // Solid wall colliders for this area (house footprints), lazily built from decor (null = not yet).
  private walls: Rect[] | null = null;
  // Lootable chests for this area, lazily built from 'chest' decor (null = not yet built).
  private chests: { id: number; x: number; y: number; opened: boolean }[] | null = null;

  private readonly players = new Map<number, Player>();
  private readonly mobs = new Map<number, Mob>();
  private readonly projectiles = new Map<number, Projectile>();
  private readonly items = new Map<number, GroundItem>();
  private readonly npcs = new Map<number, Npc>();
  private events: FxEvent[] = [];
  private notices: { playerId: number; text: string }[] = [];
  /** Pending shop windows to deliver: a vendor's stock for a player who just interacted with it. */
  private shopOffers: {
    playerId: number;
    vendor: string;
    stock: { itemId: string; price: number }[];
  }[] = [];
  /** Pending gambling windows to deliver (player just interacted with a gambler NPC). */
  private gambleOffers: { playerId: number; cost: number }[] = [];
  /** Pending Artificer windows to deliver (player just interacted with an artificer NPC). */
  private artificerOffers: { playerId: number }[] = [];
  /** Pending stash windows to deliver: the bank contents for a player who opened/changed it. */
  private stashOffers: { playerId: number; items: ItemInstance[] }[] = [];
  /** Living-loot meta: sim time (ms) each monster type was last killed, for the hunting bounty. */
  private readonly lastKillAt = new Map<string, number>();
  // Server-authoritative weather modifiers (so weather affects gameplay, not just visuals).
  private moveScale = 1;
  private aggroScale = 1;
  /**
   * Returns the co-party member ids that are CURRENTLY IN THIS INSTANCE for a given player, so a
   * kill can share XP + quest credit with present teammates. The host injects this (parties are
   * host-level, spanning instances); solo by default.
   */
  private partyResolver: (playerId: number) => number[] = () => [];
  private readonly areaId: string;
  /** Area-wide corruption pool, shared across every instance of the area (host-owned). */
  private readonly areaCorruption: AreaCorruption;

  constructor(
    private readonly width: number = WORLD_WIDTH,
    private readonly height: number = WORLD_HEIGHT,
    private readonly spawnPoint: { x: number; y: number } = {
      x: WORLD_WIDTH / 2,
      y: WORLD_HEIGHT / 2,
    },
    allocId?: () => number,
    areaId = 'world',
    areaCorruption?: AreaCorruption,
  ) {
    this.allocId = allocId ?? (() => this.localId++);
    this.areaId = areaId;
    this.areaCorruption = areaCorruption ?? new AreaCorruption();
  }

  /** Inject the host's party lookup (co-members present in this instance) for shared kill credit. */
  setPartyResolver(fn: (playerId: number) => number[]): void {
    this.partyResolver = fn;
  }

  /** Current corruption (0..1) of this world's area. */
  private corruption(): number {
    return this.areaCorruption.get(this.areaId);
  }

  /**
   * Apply the area's weather as gameplay modifiers (move speed, monster aggro range). Called by the
   * instance manager on creation and re-applied when a live theme edit changes the weather.
   */
  applyWeather(weather: WeatherKind): void {
    const mods = weatherModifiers(weather);
    this.moveScale = mods.moveScale;
    this.aggroScale = mods.aggroScale;
  }

  /** Populate the area's monsters. Called once by the instance manager after construction. */
  populateMobs(areaId: string): void {
    // Dungeons are populated procedurally (random pack, elevated elites, a boss) — not from the
    // fixed area_mobs roster. Each instance is a fresh roll, so re-entering re-rolls the dungeon.
    const dungeon = DUNGEONS[areaId];
    if (dungeon) {
      this.populateDungeon(dungeon);
      return;
    }
    const content = getContent();
    for (const spawn of content.areaMobs(areaId)) {
      const template = content.mobTemplate(spawn.templateId);
      if (!template) continue;
      for (let i = 0; i < spawn.count; i++) {
        this.createMob(template, this.randomMobX(), this.randomMobY());
      }
    }
  }

  /** A random in-bounds spawn x/y, kept off the very edges so mobs aren't born in a wall. */
  private randomMobX(): number {
    return 80 + Math.random() * (this.width - 160);
  }
  private randomMobY(): number {
    return 80 + Math.random() * (this.height - 160);
  }

  /**
   * Roll a procedural dungeon: a random-sized pack drawn (with replacement) from the dungeon's pool
   * at random positions and an elevated elite chance, plus the boss once and — sometimes — a bonus
   * champion mini-boss. Mirrors the Diablo "every run is different" feel.
   */
  private populateDungeon(d: DungeonDef): void {
    const content = getContent();
    const count = d.minMobs + Math.floor(Math.random() * (d.maxMobs - d.minMobs + 1));
    for (let i = 0; i < count; i++) {
      const id = d.pool[Math.floor(Math.random() * d.pool.length)];
      const template = id ? content.mobTemplate(id) : undefined;
      if (template)
        this.createMob(template, this.randomMobX(), this.randomMobY(), false, false, d.eliteChance);
    }
    const boss = content.mobTemplate(d.boss);
    if (boss) this.createMob(boss, this.width / 2, this.height * 0.62);
    if (d.miniBoss && Math.random() < d.miniBossChance) {
      const mini = content.mobTemplate(d.miniBoss);
      if (mini) this.createMob(mini, this.randomMobX(), this.randomMobY());
    }
  }

  /**
   * Spawn a sudden invasion wave: `count` forced-elite monsters drawn from the area's roster, ringed
   * around a random living player — a spontaneous raid. Returns false if there's no one to invade.
   */
  spawnInvasion(areaId: string, count: number): boolean {
    const content = getContent();
    const alive = [...this.players.values()].filter((p) => !p.dead);
    const templates = content
      .areaMobs(areaId)
      .map((s) => content.mobTemplate(s.templateId))
      .filter((t): t is MobTemplate => !!t && t.hp < 200);
    if (alive.length === 0 || templates.length === 0) return false;
    const anchor = alive[Math.floor(Math.random() * alive.length)]!;
    for (let i = 0; i < count; i++) {
      const t = templates[Math.floor(Math.random() * templates.length)]!;
      const ang = Math.random() * Math.PI * 2;
      const r = 170 + Math.random() * 130;
      this.createMob(
        t,
        clamp(anchor.x + Math.cos(ang) * r, 0, this.width),
        clamp(anchor.y + Math.sin(ang) * r, 0, this.height),
        true, // forced elite
        true, // invader → slim corrupted-drop chance
      );
    }
    return true;
  }

  private createMob(
    template: MobTemplate,
    x: number,
    y: number,
    forceElite = false,
    invader = false,
    eliteChance = ELITE_CHANCE,
  ): void {
    const id = this.allocId();
    // Elite ("champion") roll: a rare, beefed-up variant with a modifier prefix. Bosses (very high
    // HP) never roll elite — they are already special. Invasions force the elite flag. Dungeons pass
    // an elevated eliteChance, so tougher champions show up far more often inside them.
    const isBoss = template.hp >= 200;
    const elite = !isBoss && (forceElite || Math.random() < eliteChance);
    const mod = elite
      ? (ELITE_MODIFIERS[Math.floor(Math.random() * ELITE_MODIFIERS.length)] ?? null)
      : null;
    const hp = mod ? Math.round(template.hp * mod.hp) : template.hp;
    this.mobs.set(id, {
      id,
      templateId: template.id,
      name: mod ? `${mod.name} ${template.name}` : template.name,
      x,
      y,
      homeX: x,
      homeY: y,
      hue: template.hue,
      facing: 0,
      hp,
      maxHp: hp,
      level: template.level,
      attackCd: 0,
      wanderAngle: null,
      wanderUntil: 0,
      statuses: new StatusSet(),
      lastAttacker: 0,
      supportCd: 2000, // first self-buff/heal a couple seconds into a fight, not instantly
      dead: false,
      respawnAt: 0,
      telegraphUntil: 0,
      telegraphFacing: 0,
      telegraphTargetId: 0,
      dashUntil: 0,
      dashVx: 0,
      dashVy: 0,
      dashHit: new Set(),
      elite,
      dmgMult: mod ? mod.dmg : 1,
      spdMult: mod ? mod.spd : 1,
      invader,
    });
  }

  /** Place static NPCs for the area (from the content DB). Called once after construction. */
  populateNpcs(areaId: string): void {
    const KINDS: NpcKind[] = ['vendor', 'questgiver', 'healer', 'gambler', 'artificer', 'banker'];
    for (const npc of getContent().npcs(areaId)) {
      const id = this.allocId();
      const kind = (KINDS as string[]).includes(npc.kind) ? (npc.kind as NpcKind) : 'vendor';
      this.npcs.set(id, { id, name: npc.name, x: npc.x, y: npc.y, hue: npc.hue, kind });
    }
  }

  /** Interact with the nearest in-range NPC: vendor shop, quest-giver, healer, or gambler. */
  interact(id: number): void {
    const player = this.players.get(id);
    if (!player || player.dead) return;
    const npc = this.nearbyNpc(player);
    if (!npc) return;
    if (npc.kind === 'vendor') {
      // Open the shop; selling is now an explicit button, never a destructive side effect of E.
      this.shopOffers.push({
        playerId: player.id,
        vendor: npc.name,
        stock: this.vendorStockFor(npc.name),
      });
    } else if (npc.kind === 'healer') {
      this.healAtNpc(player, npc.name);
    } else if (npc.kind === 'gambler') {
      this.gambleOffers.push({ playerId: player.id, cost: gambleCost(player.level) });
    } else if (npc.kind === 'artificer') {
      this.artificerOffers.push({ playerId: player.id });
    } else if (npc.kind === 'banker') {
      this.pushStash(player); // open the stash window with the current contents
    } else {
      this.talkToQuestGiver(player);
    }
  }

  /** A healer NPC fully restores HP + mana and clears status effects (a free QoL service). */
  private healAtNpc(player: Player, npcName: string): void {
    player.hp = player.maxHp;
    player.mana = PLAYER_MAX_MANA;
    player.potions.health = POTION_CAP; // the Healer also refills your belt
    player.potions.mana = POTION_CAP;
    this.events.push({ kind: 'levelup', x: player.x, y: player.y, value: player.level });
    this.notify(player.id, `${npcName} mends your wounds and refills your belt.`);
  }

  /** Quaff a belt potion: instant restore, shared use-cooldown. No-op if empty, full, dead, or cooling. */
  usePotion(id: number, kind: 'health' | 'mana'): void {
    const player = this.players.get(id);
    if (!player || player.dead) return;
    if (this.now < player.potionReadyAt) return;
    if (kind === 'health') {
      if (player.potions.health <= 0 || player.hp >= player.maxHp) return;
      player.potions.health--;
      player.hp = Math.min(player.maxHp, player.hp + POTION_HEAL);
    } else {
      if (player.potions.mana <= 0 || player.mana >= PLAYER_MAX_MANA) return;
      player.potions.mana--;
      player.mana = Math.min(PLAYER_MAX_MANA, player.mana + POTION_MANA);
    }
    player.potionReadyAt = this.now + POTION_COOLDOWN_MS;
  }

  /**
   * Gamble gold for a random item of an equip slot (the D3-Kadala gold sink). Re-validates the
   * gambler is in range, the slot is real, and the player can afford the per-level cost.
   */
  gamble(id: number, slot: string): void {
    const player = this.players.get(id);
    if (!player || player.dead) return;
    const npc = this.nearbyNpc(player);
    if (!npc || npc.kind !== 'gambler') return;
    if (!isGambleSlot(slot)) return;
    const cost = gambleCost(player.level);
    if (player.gold < cost) return;
    const inst = rollGamble(this.allocId(), slot);
    if (!inst) return;
    player.gold -= cost;
    this.addGear(player, inst);
    this.notify(
      player.id,
      `You gamble ${cost}g and receive a ${getContent().item(inst.baseId)?.name ?? inst.baseId}.`,
    );
  }

  /** The interactable NPC within range of a player (the nearest), or undefined. */
  private nearbyNpc(player: Player): Npc | undefined {
    let best: Npc | undefined;
    let bestDist = INTERACT_RANGE;
    for (const npc of this.npcs.values()) {
      const d = Math.hypot(player.x - npc.x, player.y - npc.y);
      if (d <= bestDist) {
        best = npc;
        bestDist = d;
      }
    }
    return best;
  }

  /** Drain pending shop windows for the host to deliver as `shop` packets. */
  drainShopOffers(): {
    playerId: number;
    vendor: string;
    stock: { itemId: string; price: number }[];
  }[] {
    const drained = this.shopOffers;
    this.shopOffers = [];
    return drained;
  }

  /** Drain pending gambling windows for the host to deliver as `gamble_open` packets. */
  drainGambleOffers(): { playerId: number; cost: number }[] {
    const drained = this.gambleOffers;
    this.gambleOffers = [];
    return drained;
  }

  /** Drain pending Artificer windows for the host to deliver as `artificer_open` packets. */
  drainArtificerOffers(): { playerId: number }[] {
    const drained = this.artificerOffers;
    this.artificerOffers = [];
    return drained;
  }

  /** Queue the player's current stash contents to be sent as a `stash` packet. */
  private pushStash(player: Player): void {
    this.stashOffers.push({ playerId: player.id, items: player.stash });
  }

  /** Drain pending stash windows for the host to deliver as `stash` packets (with the cap). */
  drainStashOffers(): { playerId: number; items: ItemInstance[]; cap: number }[] {
    const drained = this.stashOffers.map((o) => ({ ...o, cap: STASH_CAP }));
    this.stashOffers = [];
    return drained;
  }

  /** Banker: deposit a bag gear instance into the stash. Requires banker proximity + stash room. */
  depositToStash(id: number, uid: number): void {
    const player = this.players.get(id);
    if (!player || player.dead) return;
    if (this.nearbyNpc(player)?.kind !== 'banker') return;
    if (player.stash.length >= STASH_CAP) {
      this.notify(player.id, 'Your stash is full.');
      return;
    }
    const idx = player.gear.findIndex((g) => g.uid === uid);
    if (idx < 0) return;
    const [inst] = player.gear.splice(idx, 1);
    if (inst) player.stash.push(inst);
    this.pushStash(player); // refresh the open panel
  }

  /** Banker: withdraw a stashed gear instance back to the bag. Requires banker proximity + bag room. */
  withdrawFromStash(id: number, uid: number): void {
    const player = this.players.get(id);
    if (!player || player.dead) return;
    if (this.nearbyNpc(player)?.kind !== 'banker') return;
    if (player.gear.length >= MAX_BAG_GEAR) {
      this.notify(player.id, 'Your bag is full.');
      return;
    }
    const idx = player.stash.findIndex((g) => g.uid === uid);
    if (idx < 0) return;
    const [inst] = player.stash.splice(idx, 1);
    if (inst) player.gear.push(inst);
    this.pushStash(player);
  }

  /**
   * Artificer: reroll a bag gear instance's affixes for gold + a rune shard. Requires being next to
   * an artificer, the item to have affixes, and the player to afford the cost. Corrupted gear rerolls
   * its buff/debuff pair; everything else rerolls normal affixes for its rarity.
   */
  enchant(id: number, uid: number): void {
    const player = this.players.get(id);
    if (!player || player.dead) return;
    const npc = this.nearbyNpc(player);
    if (!npc || npc.kind !== 'artificer') return;
    const inst = player.gear.find((g) => g.uid === uid);
    if (!inst || (inst.affixes?.length ?? 0) === 0) return;
    if (player.gold < ARTIFICER_REROLL_GOLD || (player.loot.get('rune_shard') ?? 0) < 1) return;
    player.gold -= ARTIFICER_REROLL_GOLD;
    this.consumeLoot(player, 'rune_shard');
    inst.affixes = inst.rarity === 'corrupted' ? rollCorruptedAffixes() : rollAffixes(inst.rarity);
    this.notify(player.id, 'The Artificer reforges your gear — new powers emerge.');
  }

  /**
   * Artificer: pop the gem out of an equipped item's socket, returning it to the bag for gold.
   * Re-validates artificer proximity, the slot, and that the socket actually holds a gem.
   */
  unsocketGem(id: number, slot: string, index: number): void {
    const player = this.players.get(id);
    if (!player || player.dead) return;
    const npc = this.nearbyNpc(player);
    if (!npc || npc.kind !== 'artificer') return;
    if (!(EQUIP_SLOTS as string[]).includes(slot)) return;
    const inst = player.equipment[slot as EquipSlot];
    const gemId = inst?.sockets?.[index];
    if (!inst || !gemId) return;
    if (player.gold < ARTIFICER_UNSOCKET_GOLD) return;
    player.gold -= ARTIFICER_UNSOCKET_GOLD;
    inst.sockets![index] = null;
    player.loot.set(gemId, (player.loot.get(gemId) ?? 0) + 1);
    this.recomputeStats(player);
    this.notify(
      player.id,
      `The Artificer frees a gem from your ${getContent().item(inst.baseId)?.name ?? slot}.`,
    );
  }

  /**
   * Artificer: fuse GEMS_PER_COMBINE held gems of one kind into a single gem of the next tier (the
   * Diablo gem-cube). Free — the gems are the cost. Upgrades the first eligible stack (stable order),
   * so repeated clicks work through a hoard. Re-validates artificer proximity server-side.
   */
  combineGems(id: number): void {
    const player = this.players.get(id);
    if (!player || player.dead) return;
    const npc = this.nearbyNpc(player);
    if (!npc || npc.kind !== 'artificer') return;
    for (const gemId of Object.keys(GEMS)) {
      const have = player.loot.get(gemId) ?? 0;
      const next = nextGemTier(gemId);
      if (have >= GEMS_PER_COMBINE && next) {
        for (let i = 0; i < GEMS_PER_COMBINE; i++) this.consumeLoot(player, gemId);
        player.loot.set(next, (player.loot.get(next) ?? 0) + 1);
        this.notify(
          player.id,
          `The Artificer fuses ${GEMS_PER_COMBINE} ${GEMS[gemId]!.name} into a ${GEMS[next]!.name}.`,
        );
        return;
      }
    }
    this.notify(player.id, 'You need 3 matching gems of the same kind to fuse a stronger one.');
  }

  /**
   * Sell the player's whole bag (materials + gear) to a vendor for gold. Requires being next to a
   * vendor — the open shop panel on a client grants nothing; proximity is re-checked here.
   */
  sell(id: number): void {
    const player = this.players.get(id);
    if (!player || player.dead) return;
    const npc = this.nearbyNpc(player);
    if (!npc || npc.kind !== 'vendor') return;
    const content = getContent();
    let gold = 0;
    for (const [item, qty] of player.loot) {
      const value = content.sellValue(item);
      if (value <= 0 || qty <= 0) continue;
      gold += value * qty;
      player.loot.delete(item);
    }
    for (const inst of player.gear) gold += gearSellValue(inst);
    player.gear = [];
    if (gold <= 0) return;
    player.gold += gold;
    this.events.push({ kind: 'coin', x: player.x, y: player.y, value: gold });
  }

  /**
   * Buy one item from a nearby vendor. Re-validates everything server-side: the player is next to a
   * vendor, the item is actually on that vendor's shelf, and the player can afford it. Gear is
   * rolled as a plain **common** instance (the shop is a floor; drops stay the jackpot); spellbooks
   * and materials stack in the bag.
   */
  buy(id: number, itemId: string): void {
    const player = this.players.get(id);
    if (!player || player.dead) return;
    const npc = this.nearbyNpc(player);
    if (!npc || npc.kind !== 'vendor') return;
    // Validate against the SHOWN (rotated + repriced) stock, so you can only buy what's currently on
    // the shelf and at the displayed price.
    const entry = this.vendorStockFor(npc.name).find((s) => s.itemId === itemId);
    // Guard against a non-positive price (e.g. a bad DB edit): a negative price would *add* gold.
    if (!entry || entry.price <= 0 || player.gold < entry.price) return;
    const def = getContent().item(itemId);
    if (!def) return;
    player.gold -= entry.price;
    const base = asBaseItem(def);
    if (base) {
      this.addGear(player, rollVendorInstance(this.allocId(), base));
    } else {
      player.loot.set(itemId, (player.loot.get(itemId) ?? 0) + 1);
    }
    this.notify(player.id, `Bought ${def.name} for ${entry.price}g.`);
  }

  /**
   * A vendor's shown stock: its basic gear always, plus a rotating window of its spell tomes (so the
   * shop never overflows), with prices scaled up. The window advances on a sim-time bucket — the
   * spell selection rotates over the session. Used for BOTH the shop panel and the buy check, so
   * what you see is exactly what you can buy, at that price.
   */
  private vendorStockFor(npcName: string): { itemId: string; price: number }[] {
    const full = getContent().vendorStock(this.areaId, npcName);
    const gear = full.filter((s) => !s.itemId.startsWith('tome_'));
    const tomes = full.filter((s) => s.itemId.startsWith('tome_'));
    const slots = Math.max(0, VENDOR_STOCK_CAP - gear.length);
    const shown = [...gear];
    if (tomes.length > 0 && slots > 0) {
      const start = (Math.floor(this.now / VENDOR_ROTATE_MS) * slots) % tomes.length;
      for (let i = 0; i < Math.min(slots, tomes.length); i++) {
        shown.push(tomes[(start + i) % tomes.length]!);
      }
    }
    return shown.map((s) => ({
      itemId: s.itemId,
      price: Math.max(1, Math.round(s.price * VENDOR_PRICE_MULT)),
    }));
  }

  /**
   * Read a spellbook from the bag: learn the spell, or rank it up if already known (the Diablo 1
   * duplicate rule). Consumes one book. A mastered spell (rank {@link MAX_SPELL_RANK}) leaves the
   * book in the bag as vendor fodder.
   */
  learn(id: number, itemId: string): void {
    const player = this.players.get(id);
    if (!player || player.dead) return;
    const have = player.loot.get(itemId) ?? 0;
    if (have <= 0) return;
    const def = getContent().item(itemId);
    if (!def || def.kind !== 'spellbook' || !def.teaches) return;
    const ability = getContent().ability(def.teaches);
    if (!ability) return;
    const spell = def.teaches as AbilityId;
    const current = player.known.get(spell);
    if (current === undefined) {
      this.consumeLoot(player, itemId);
      player.known.set(spell, 1);
      this.notify(player.id, `You learn ${ability.name}!`);
    } else if (current < MAX_SPELL_RANK) {
      this.consumeLoot(player, itemId);
      player.known.set(spell, current + 1);
      this.notify(player.id, `${ability.name} is now rank ${current + 1}.`);
    } else {
      this.notify(player.id, `${ability.name} is already mastered (rank ${MAX_SPELL_RANK}).`);
    }
  }

  /**
   * Socket a held gem into the first equipped item with an open socket. Consumes one gem from the
   * bag. Auto-targets so it's a single tap — no fiddly drag/drop. Server-authoritative: the gem
   * must be held and a real gem, and there must be an open socket.
   */
  socketGem(id: number, gemId: string): void {
    const player = this.players.get(id);
    if (!player || player.dead) return;
    if ((player.loot.get(gemId) ?? 0) <= 0 || !isGem(gemId)) return;
    // Find the first equipped piece with a free socket (stable slot order).
    for (const slot of EQUIP_SLOTS) {
      const inst = player.equipment[slot];
      if (!inst?.sockets) continue;
      const free = inst.sockets.indexOf(null);
      if (free >= 0) {
        inst.sockets[free] = gemId;
        this.consumeLoot(player, gemId);
        this.recomputeStats(player);
        this.notify(
          player.id,
          `Socketed a gem into your ${getContent().item(inst.baseId)?.name ?? slot}.`,
        );
        return;
      }
    }
    this.notify(player.id, 'No open sockets on your equipped gear.');
  }

  /** Add a gear instance to the bag, capping at MAX_BAG_GEAR by evicting the oldest piece. */
  private addGear(player: Player, inst: ItemInstance): void {
    player.gear.push(inst);
    while (player.gear.length > MAX_BAG_GEAR) player.gear.shift();
  }

  /** Remove one unit of a stackable loot item, deleting the stack when it hits zero. */
  private consumeLoot(player: Player, itemId: string): void {
    const n = (player.loot.get(itemId) ?? 0) - 1;
    if (n > 0) player.loot.set(itemId, n);
    else player.loot.delete(itemId);
  }

  /** Offer the next un-taken quest, turning in any completable collect quest first. */
  private talkToQuestGiver(player: Player): void {
    const quests = getContent().quests();
    // First: hand in any active collect quest the player can now complete (consume the items).
    for (const q of quests) {
      if (!q.turnInItem || q.turnInCount <= 0 || !player.quests.has(q.id)) continue;
      if ((player.loot.get(q.turnInItem) ?? 0) >= q.turnInCount) {
        for (let i = 0; i < q.turnInCount; i++) this.consumeLoot(player, q.turnInItem);
        this.completeQuest(player, q);
        return;
      }
    }
    const next = quests.find((q) => !player.quests.has(q.id) && !player.questsDone.has(q.id));
    if (next) {
      player.quests.set(next.id, 0);
      const ask = next.turnInItem
        ? `${next.description} (bring ${next.turnInCount} — turn in here)`
        : next.description;
      this.notify(player.id, `Quest accepted: ${next.name} — ${ask}`);
      return;
    }
    const active = quests.find((q) => player.quests.has(q.id));
    if (active) {
      const got = active.turnInItem
        ? (player.loot.get(active.turnInItem) ?? 0)
        : (player.quests.get(active.id) ?? 0);
      const need = active.turnInItem ? active.turnInCount : active.targetCount;
      this.notify(player.id, `In progress: ${active.name} (${Math.min(got, need)}/${need})`);
    } else {
      this.notify(player.id, 'No new quests right now — well done, adventurer.');
    }
  }

  /** Grant a quest's rewards, mark it done, and notify — shared by kill + collect completion. */
  private completeQuest(player: Player, quest: QuestDef): void {
    player.quests.delete(quest.id);
    player.questsDone.add(quest.id);
    player.gold += quest.rewardGold;
    player.xp += quest.rewardXp;
    player.level = levelForXp(player.xp);
    this.recomputeStats(player);
    let extra = '';
    if (quest.rewardItem) {
      this.giveItem(player.id, quest.rewardItem, 1);
      extra = ` + ${getContent().item(quest.rewardItem)?.name ?? quest.rewardItem}`;
    }
    this.notify(
      player.id,
      `Quest complete: ${quest.name}! +${quest.rewardGold}g +${quest.rewardXp}xp${extra}`,
    );
  }

  /** Equip a gear instance (by uid) from the player's bag, returning any displaced gear to the bag. */
  equip(id: number, uid: number): void {
    const player = this.players.get(id);
    if (!player) return;
    const idx = player.gear.findIndex((g) => g.uid === uid);
    if (idx < 0) return;
    const inst = player.gear[idx]!;
    const itemSlot = getContent().item(inst.baseId)?.slot as ItemSlot | undefined;
    if (!itemSlot) return;
    const slots = dollSlotsFor(itemSlot);
    if (slots.length === 0) return;
    // Prefer an empty doll slot (e.g. ring1 over ring2); otherwise replace the first.
    const target = slots.find((s) => player.equipment[s] === null) ?? slots[0]!;

    player.gear.splice(idx, 1);
    const previous = player.equipment[target];
    if (previous) this.addGear(player, previous);
    player.equipment[target] = inst;
    this.recomputeStats(player);
  }

  /** Unequip the item in a doll slot back to the bag. */
  unequip(id: number, slot: string): void {
    const player = this.players.get(id);
    if (!player) return;
    if (!(EQUIP_SLOTS as string[]).includes(slot)) return;
    const s = slot as EquipSlot;
    const inst = player.equipment[s];
    if (!inst) return;
    player.equipment[s] = null;
    this.addGear(player, inst);
    this.recomputeStats(player);
  }

  /** Derive power, max HP, crit, multishot, and damage-taken from level + every equipped instance. */
  private recomputeStats(player: Player): void {
    let power = 0;
    let bonusHp = 0;
    let crit = BASE_CRIT_CHANCE;
    let multishot = 0;
    let damageTaken = 1;
    let lifesteal = 0; // percent points
    let swift = 0; // percent cooldown reduction
    let move = 0; // percent move bonus
    let armor = 0; // percent incoming-damage reduction
    let vigor = 0; // bonus HP regenerated per second
    for (const slot of EQUIP_SLOTS) {
      const inst = player.equipment[slot];
      if (!inst) continue;
      power += inst.power;
      bonusHp += inst.hp;
      for (const a of inst.affixes ?? []) {
        if (a.stat === 'power') power += a.value;
        else if (a.stat === 'hp') bonusHp += a.value;
        else if (a.stat === 'crit') crit += a.value / 100;
        else if (a.stat === 'multishot') multishot += a.value;
        else if (a.stat === 'lifesteal') lifesteal += a.value;
        else if (a.stat === 'swift') swift += a.value;
        else if (a.stat === 'move') move += a.value;
        else if (a.stat === 'armor') armor += a.value;
        else if (a.stat === 'vigor') vigor += a.value;
        else if (a.stat === 'frail')
          bonusHp -= a.value; // corrupted debuff: less max HP
        else if (a.stat === 'fragile') damageTaken += a.value / 100; // corrupted debuff: take more
      }
      // Socketed gems add the same stat kinds as affixes (crit gem value is in whole % points).
      const gems = gemBonuses(inst.sockets ?? []);
      power += gems.power;
      bonusHp += gems.hp;
      crit += gems.crit / 100;
      multishot += gems.multishot;
      lifesteal += gems.lifesteal;
      swift += gems.swift;
      move += gems.move;
      armor += gems.armor;
      vigor += gems.vigor;
    }
    // Attribute bonuses (strength→power, vitality→maxHp, dexterity→crit, energy→mana regen).
    const attr = attributeBonuses(player.attributes);
    power += attr.power;
    bonusHp += attr.maxHp;
    crit += attr.critChance;
    // Passive skill-tree bonuses (allocated nodes) fold in on top, same stat kinds.
    const skill = aggregateSkillEffects(player.skills);
    power += skill.power;
    crit += skill.critPct / 100;
    lifesteal += skill.lifestealPct;
    swift += skill.swiftPct;
    move += skill.movePct;
    armor += skill.armorPct;
    vigor += skill.vigor;
    multishot += skill.multishot;
    player.power = power;
    player.critChance = crit;
    player.multishot = multishot;
    player.lifesteal = Math.min(0.6, lifesteal / 100); // cap life steal at 60% of damage
    player.cooldownMult = Math.max(0.4, 1 - swift / 100); // cap attack speed at +60%
    player.moveMult = Math.min(1.5, 1 + move / 100); // cap move speed at +50%
    // Armor reduces incoming damage (stacking with the corrupted +fragile penalty), capped at 50%.
    player.damageTakenMult = damageTaken * Math.max(0.5, 1 - armor / 100);
    player.vigor = vigor; // flat HP/sec added to base regen in tickPlayers
    player.manaRegenBonus = attr.manaRegen + skill.manaRegen;
    // Max HP: base + flat bonuses, then the skill tree's percentage max-HP increase.
    player.maxHp = Math.max(
      1,
      Math.round((maxHpForLevel(player.level) + bonusHp) * (1 + skill.maxHpPct / 100)),
    );
    if (player.hp > player.maxHp) player.hp = player.maxHp;
  }

  // --- GM / chat-command support (gated by access level in commands.ts) ----------------

  teleport(id: number, x: number, y: number): void {
    const p = this.players.get(id);
    if (!p) return;
    p.x = clamp(x, 0, this.width);
    p.y = clamp(y, 0, this.height);
  }

  healFull(id: number): void {
    const p = this.players.get(id);
    if (!p) return;
    p.hp = p.maxHp;
    p.mana = PLAYER_MAX_MANA;
  }

  /** Spawn a monster near the player. Returns false for an unknown template. */
  spawnMobAt(playerId: number, templateId: string): boolean {
    const p = this.players.get(playerId);
    if (!p) return false;
    const template = getContent().mobTemplate(templateId);
    if (!template) return false;
    this.createMob(template, p.x + (Math.random() - 0.5) * 60, p.y + (Math.random() - 0.5) * 60);
    return true;
  }

  /**
   * Add an item to a player's bag. Equipment becomes rolled gear instance(s) in the gear bag;
   * materials/currency stack in the loot map. Returns false for an unknown item id.
   */
  giveItem(id: number, itemId: string, qty: number): boolean {
    const p = this.players.get(id);
    const def = getContent().item(itemId);
    if (!p || !def) return false;
    // Clamp the quantity at the boundary: a non-finite or absurd qty would spin the loop below
    // forever and stall the tick. The cap is far above any legitimate single grant.
    const n = Math.max(1, Math.min(Math.floor(qty) || 1, 10_000));
    const base = asBaseItem(def);
    if (def.kind === 'currency') {
      p.gold += n; // gold is the wallet, not a bag stack
    } else if (base) {
      for (let i = 0; i < n; i++) this.addGear(p, rollItemInstance(this.allocId(), base));
    } else {
      p.loot.set(itemId, (p.loot.get(itemId) ?? 0) + n);
    }
    return true;
  }

  setLevel(id: number, level: number): void {
    const p = this.players.get(id);
    if (!p) return;
    p.xp = xpForLevel(Math.max(1, level));
    p.level = levelForXp(p.xp);
    this.recomputeStats(p);
  }

  addXp(id: number, amount: number): void {
    const p = this.players.get(id);
    if (!p) return;
    p.xp = Math.max(0, p.xp + amount);
    const newLevel = levelForXp(p.xp);
    if (newLevel > p.level) {
      const g = newLevel - p.level;
      p.attrPoints += g * ATTR_POINTS_PER_LEVEL;
      p.skillPoints += g * SKILL_POINTS_PER_LEVEL;
    }
    p.level = newLevel;
    this.recomputeStats(p);
  }

  /** Spend one attribute point to raise an attribute (server-authoritative; ignores invalid input). */
  allocateAttribute(id: number, attr: string): void {
    const p = this.players.get(id);
    if (!p || p.attrPoints <= 0) return;
    if (!(ATTRIBUTE_KEYS as string[]).includes(attr)) return;
    p.attributes[attr as keyof AttributeSet]++;
    p.attrPoints--;
    this.recomputeStats(p);
  }

  /** Spend one skill point to allocate a passive node (validates points + prerequisites). */
  allocateSkill(id: number, nodeId: string): void {
    const p = this.players.get(id);
    if (!p || p.skillPoints <= 0) return;
    if (!canAllocate(nodeId, p.skills)) return;
    p.skills.add(nodeId);
    p.skillPoints--;
    this.recomputeStats(p);
  }

  toggleGod(id: number): boolean {
    const p = this.players.get(id);
    if (!p) return false;
    p.god = !p.god;
    return p.god;
  }

  killAllMobs(): number {
    let n = 0;
    for (const mob of this.mobs.values()) {
      if (mob.dead) continue;
      mob.dead = true;
      mob.respawnAt = this.now + MOB_RESPAWN_MS;
      this.events.push({ kind: 'death', x: mob.x, y: mob.y });
      n++;
    }
    return n;
  }

  playerPos(id: number): { x: number; y: number } | undefined {
    const p = this.players.get(id);
    return p ? { x: p.x, y: p.y } : undefined;
  }

  playerNames(): string[] {
    return [...this.players.values()].map((p) => p.name);
  }

  /** Create a player. Pass an explicit id to keep identity stable across area transfers. */
  spawn(name: string, opts: SpawnOptions = {}): number {
    const id = opts.id ?? this.allocId();
    this.players.set(id, {
      id,
      name: sanitizeName(name),
      x: opts.x ?? this.spawnPoint.x,
      y: opts.y ?? this.spawnPoint.y,
      hue: opts.hue ?? (id * 47) % 360,
      facing: 0,
      hp: PLAYER_MAX_HP,
      maxHp: PLAYER_MAX_HP,
      mana: PLAYER_MAX_MANA,
      level: 1,
      xp: 0,
      gold: 0,
      loot: new Map(),
      gear: [],
      stash: [],
      potions: { health: POTION_START, mana: POTION_START },
      potionReadyAt: 0,
      manaRegenBonus: 0,
      attributes: emptyAttributes(),
      attrPoints: 0,
      skills: new Set(),
      skillPoints: 0,
      equipment: emptyEquipment(),
      power: 0,
      critChance: BASE_CRIT_CHANCE,
      multishot: 0,
      lifesteal: 0,
      cooldownMult: 1,
      moveMult: 1,
      damageTakenMult: 1,
      vigor: 0,
      god: false,
      quests: new Map(),
      questsDone: new Set(),
      known: new Map(STARTER_ABILITIES.map((a) => [a, 1])),
      discovered: new Set([this.areaId]),
      input: { up: false, down: false, left: false, right: false },
      lastSeq: 0,
      cooldowns: new Map(),
      buffs: new StatusSet(),
      debuffs: new StatusSet(),
      dead: false,
      respawnAt: 0,
    });
    return id;
  }

  /** Snapshot a player's persistent state to carry across an area transfer. */
  exportPlayer(id: number): PlayerSave | undefined {
    const p = this.players.get(id);
    if (!p) return undefined;
    return {
      name: p.name,
      hue: p.hue,
      hp: p.hp,
      mana: p.mana,
      level: p.level,
      xp: p.xp,
      gold: p.gold,
      loot: [...p.loot],
      gear: [...p.gear],
      stash: [...p.stash],
      potions: { ...p.potions },
      attributes: { ...p.attributes },
      attrPoints: p.attrPoints,
      skills: [...p.skills],
      skillPoints: p.skillPoints,
      equipment: { ...p.equipment },
      god: p.god,
      quests: [...p.quests],
      questsDone: [...p.questsDone],
      known: [...p.known],
      discovered: [...p.discovered],
    };
  }

  /** Restore a player (with stable id) from a save, at the given position. */
  importPlayer(id: number, save: PlayerSave, x: number, y: number): void {
    this.spawn(save.name, { id, x, y, hue: save.hue });
    const p = this.players.get(id);
    if (!p) return;
    p.level = save.level;
    p.xp = save.xp;
    p.gold = save.gold;
    p.loot = new Map(save.loot);
    p.gear = [...save.gear];
    p.stash = [...(save.stash ?? [])]; // pre-stash saves start with an empty bank
    p.potions = save.potions
      ? { health: save.potions.health, mana: save.potions.mana }
      : { health: POTION_START, mana: POTION_START };
    // Attributes: restore them, or for a pre-attribute save grant the points the character has earned
    // across its levels retroactively (so existing characters get their fair allotment to spend).
    if (save.attributes) {
      p.attributes = toAttributeSet(save.attributes);
      p.attrPoints = Math.max(0, Math.floor(save.attrPoints ?? 0));
    } else {
      p.attributes = emptyAttributes();
      p.attrPoints = Math.max(0, (save.level - 1) * ATTR_POINTS_PER_LEVEL);
    }
    // Skill tree: restore allocated nodes + points, or grant a legacy save its level-worth of points.
    if (save.skills || save.skillPoints !== undefined) {
      p.skills = new Set(save.skills ?? []);
      p.skillPoints = Math.max(0, Math.floor(save.skillPoints ?? 0));
    } else {
      p.skills = new Set();
      p.skillPoints = Math.max(0, (save.level - 1) * SKILL_POINTS_PER_LEVEL);
    }
    p.equipment = { ...emptyEquipment(), ...save.equipment };
    p.god = save.god;
    p.quests = new Map(save.quests);
    p.questsDone = new Set(save.questsDone);
    p.known = restoreKnown(save.known);
    // Carry visited areas across the transfer + always mark the area we just arrived in.
    p.discovered = new Set(save.discovered ?? []);
    p.discovered.add(this.areaId);
    this.recomputeStats(p);
    p.hp = Math.min(save.hp, p.maxHp);
    p.mana = save.mana;
  }

  remove(id: number): void {
    this.players.delete(id);
  }

  setInput(id: number, input: InputState, seq = 0): void {
    const player = this.players.get(id);
    if (!player) return;
    player.input = {
      up: !!input.up,
      down: !!input.down,
      left: !!input.left,
      right: !!input.right,
    };
    if (seq > player.lastSeq) player.lastSeq = seq;
  }

  /** Cast an ability aimed in direction (dx,dy). Validated server-side: alive, cooldown, mana. */
  cast(id: number, abilityId: AbilityId, dx: number, dy: number): void {
    const player = this.players.get(id);
    if (!player || player.dead) return;
    const ability = getContent().ability(abilityId);
    if (!ability) return;
    // Loot = your build: you can only cast spells you have learned (from a spellbook). A hostile
    // client cannot cast what it never learned — this is validated server-side, never on the wire.
    const rank = player.known.get(abilityId);
    if (rank === undefined) return;
    if ((player.cooldowns.get(abilityId) ?? 0) > 0 || player.mana < ability.manaCost) return;

    const facing = aimAngle(dx, dy, player.facing);
    player.facing = facing;
    player.mana -= ability.manaCost;
    // Cooldown is shortened by the +swift affix and by an active HASTE buff.
    player.cooldowns.set(
      abilityId,
      ability.cooldownMs * player.cooldownMult * player.buffs.cooldownFactor(),
    );
    this.events.push({ kind: 'cast', x: player.x, y: player.y, facing, abilityId });
    // Each spell rank above 1 boosts the effect (the Diablo 1 duplicate-tome rule).
    const rankMult = spellRankMult(rank);
    // Self-buff spells apply their timed buff to the caster (might / haste / regen).
    const buff = BUFF_ON_CAST[abilityId];
    if (buff) player.buffs.apply(buff.id, buff.ms, buff.magnitude);
    // Outgoing damage this cast: boosted by an active MIGHT buff, cut by an enemy WEAKEN debuff.
    const mightMult = player.buffs.damageFactor() * player.debuffs.weakenFactor();

    if (ability.kind === 'heal') {
      player.hp = Math.min(player.maxHp, player.hp + ability.damage * rankMult);
    } else if (ability.kind === 'melee') {
      const halfAngle = ability.meleeHalfAngle ?? 0.6;
      for (const mob of this.mobs.values()) {
        if (mob.dead) continue;
        if (inMeleeCone(player.x, player.y, facing, mob.x, mob.y, ability.range, halfAngle)) {
          const power = (ability.damage + player.power) * rankMult * mightMult;
          const base = rollAbilityDamage(player.level, mob.level, power);
          const crit = base > 0 && rollCrit(Math.random, player.critChance);
          const dmg = applyCrit(base, crit);
          this.damageMob(mob, dmg, abilityId, player.id, crit);
          if (dmg > 0) applyStatus(mob, abilityId);
        }
      }
    } else {
      // Multishot affixes add extra projectiles, fanned around the aim — gear shapes the kit.
      const speed = ability.projectileSpeed ?? 300;
      const count = 1 + player.multishot;
      const spread = 0.18; // radians between adjacent shots
      for (let i = 0; i < count; i++) {
        const a = facing + (i - (count - 1) / 2) * spread;
        const pid = this.allocId();
        this.projectiles.set(pid, {
          id: pid,
          abilityId,
          x: player.x,
          y: player.y,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          ttl: ability.projectileTtlMs ?? 1200,
          damage: (ability.damage + player.power) * rankMult * mightMult,
          radius: ability.radius,
          ownerId: player.id,
          ownerLevel: player.level,
          critChance: player.critChance,
          hostile: false,
        });
      }
    }
  }

  /** Advance the simulation by dt seconds. */
  tick(dt: number): void {
    this.now += dt * 1000;
    // Corruption decay is driven once by the host on the shared registry, not per-instance here.
    this.tickPlayers(dt);
    this.tickMobs(dt);
    this.tickProjectiles(dt);
    this.tickItems(dt);
  }

  /** Mob-damage multiplier from corruption (1 at calm, up to 1 + CORRUPT_MAX_DMG_BONUS at full). */
  private corruptionDmg(): number {
    return 1 + this.corruption() * CORRUPT_MAX_DMG_BONUS;
  }

  /**
   * A player's effective movement multiplier: weather × +move affix/gem × HASTE buff × enemy SLOW
   * debuff. The same value is sent in the `you` packet so the client predictor integrates exactly
   * like this, keeping movement in sync (no rubber-banding) even when slowed/hasted/move-buffed.
   */
  private playerMoveMul(player: Player): number {
    return (
      this.moveScale * player.moveMult * player.buffs.moveFactor() * player.debuffs.slowFactor()
    );
  }

  /**
   * A monster's outgoing hit damage: base × elite mult × area corruption, scaled by its own status
   * effects — a WEAKEN debuff cuts it, a MIGHT self-buff (from a War Cry support cast) raises it.
   */
  private mobOutgoing(mob: Mob, template: MobTemplate): number {
    return (
      template.damage *
      mob.dmgMult *
      this.corruptionDmg() *
      mob.statuses.weakenFactor() *
      mob.statuses.damageFactor()
    );
  }

  private tickPlayers(dt: number): void {
    for (const player of this.players.values()) {
      if (player.dead) {
        if (this.now >= player.respawnAt) this.respawnPlayer(player);
        continue;
      }
      player.mana = Math.min(
        PLAYER_MAX_MANA,
        player.mana + (MANA_REGEN_PER_SEC + player.manaRegenBonus) * dt,
      );
      // Base HP regen plus any +vigor from equipped gear.
      player.hp = Math.min(player.maxHp, player.hp + (HP_REGEN_PER_SEC + player.vigor) * dt);
      // Advance self-buffs; an active REGEN buff heals over time on top of base regen.
      const { regenHeal } = player.buffs.tick(dt * 1000);
      if (regenHeal > 0) player.hp = Math.min(player.maxHp, player.hp + regenHeal);
      // Advance enemy debuffs; a BURN debuff (from an enemy fire spell) chips HP over time.
      const { burnDamage } = player.debuffs.tick(dt * 1000);
      if (burnDamage > 0) this.damagePlayer(player, burnDamage, true);
      if (player.dead) continue;
      for (const [ability, remaining] of player.cooldowns) {
        const next = remaining - dt * 1000;
        if (next <= 0) player.cooldowns.delete(ability);
        else player.cooldowns.set(ability, next);
      }

      const { dx, dy } = moveVector(player.input);
      if (dx !== 0 || dy !== 0) {
        // Full effective speed (weather × affix × haste × slow). The client predictor receives this
        // same multiplier in the `you` packet, so the two stay in sync — no rubber-banding.
        const speed = PLAYER_SPEED * this.playerMoveMul(player);
        const nx = clamp(player.x + dx * speed * dt, 0, this.width);
        const ny = clamp(player.y + dy * speed * dt, 0, this.height);
        // Resolve against solid house walls (door gaps stay passable). The client predictor runs the
        // identical resolveCircleMove on the same walls, so this adds collision with no rubber-banding.
        const resolved = resolveCircleMove(
          player.x,
          player.y,
          nx,
          ny,
          PLAYER_COLLISION_RADIUS,
          this.wallList(),
        );
        player.x = resolved.x;
        player.y = resolved.y;
        player.facing = Math.atan2(dy, dx);
      }
      this.checkShrines(player);
      this.checkChests(player);
    }
  }

  /** The area's solid wall colliders, built once from its house decor (empty for areas with none). */
  private wallList(): Rect[] {
    if (this.walls === null) {
      this.walls = wallsForDecor(getContent().area(this.areaId)?.decor ?? []);
    }
    return this.walls;
  }

  /** The area's shrines, built once from its 'shrine' decor (empty for areas with none). */
  private shrineList(): { x: number; y: number; readyAt: number }[] {
    if (this.shrines === null) {
      const decor = getContent().area(this.areaId)?.decor ?? [];
      this.shrines = decor
        .filter((d) => d.kind === 'shrine')
        .map((d) => ({ x: d.x, y: d.y, readyAt: 0 }));
    }
    return this.shrines;
  }

  /** Bless a player who steps onto a charged shrine with a random timed buff, then recharge it. */
  private checkShrines(player: Player): void {
    const shrines = this.shrineList();
    for (const s of shrines) {
      if (this.now < s.readyAt) continue;
      if (Math.hypot(player.x - s.x, player.y - s.y) > SHRINE_RADIUS) continue;
      const buff = SHRINE_BUFFS[Math.floor(Math.random() * SHRINE_BUFFS.length)]!;
      player.buffs.apply(buff.id, buff.ms, buff.magnitude);
      s.readyAt = this.now + SHRINE_COOLDOWN_MS;
      this.notify(player.id, `A shrine blesses you — ${buff.label}.`);
      return; // one blessing per tick
    }
  }

  /** The area's chests, built once from its 'chest' decor (each gets a stable entity id). */
  private chestList(): { id: number; x: number; y: number; opened: boolean }[] {
    if (this.chests === null) {
      const decor = getContent().area(this.areaId)?.decor ?? [];
      this.chests = decor
        .filter((d) => d.kind === 'chest')
        .map((d) => ({ id: this.allocId(), x: d.x, y: d.y, opened: false }));
    }
    return this.chests;
  }

  /** Pop open any closed chest a player walks up to, spilling gold + gear on the ground (once). */
  private checkChests(player: Player): void {
    for (const c of this.chestList()) {
      if (c.opened) continue;
      if (Math.hypot(player.x - c.x, player.y - c.y) > CHEST_RADIUS) continue;
      c.opened = true;
      const gold =
        CHEST_GOLD_MIN + Math.floor(Math.random() * (CHEST_GOLD_MAX - CHEST_GOLD_MIN + 1));
      this.dropGround('gold', gold, c.x, c.y);
      const corrupt = this.corruption() * CORRUPT_DROP_MAX;
      this.dropBonusGear(c.x, c.y, 1, corrupt, CHEST_UNIQUE_CHANCE); // one good piece (rare unique)...
      if (Math.random() < 0.4) this.dropBonusGear(c.x, c.y, 0, corrupt); // ...sometimes a second
      // A chest also stocks your belt with a couple of potions.
      player.potions.health = Math.min(
        POTION_CAP,
        player.potions.health + 1 + (Math.random() < 0.5 ? 1 : 0),
      );
      if (Math.random() < 0.6) player.potions.mana = Math.min(POTION_CAP, player.potions.mana + 1);
      this.notify(player.id, 'You pry open a chest!');
    }
  }

  private tickMobs(dt: number): void {
    const views: PlayerView[] = [...this.players.values()].map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      alive: !p.dead,
    }));

    for (const mob of this.mobs.values()) {
      if (mob.dead) {
        if (this.now >= mob.respawnAt) this.respawnMob(mob);
        continue;
      }
      if (mob.attackCd > 0) mob.attackCd -= dt * 1000;
      if (mob.supportCd > 0) mob.supportCd -= dt * 1000;

      // Status effects: burn (debuff) chips HP, regen (self-buff) heals; slow/haste scale movement.
      const { burnDamage, regenHeal } = mob.statuses.tick(dt * 1000);
      if (burnDamage > 0) this.damageMob(mob, burnDamage, undefined, mob.lastAttacker);
      if (mob.dead) continue;
      if (regenHeal > 0) mob.hp = Math.min(mob.maxHp, mob.hp + regenHeal);
      const moveMul = mob.statuses.slowFactor() * mob.statuses.moveFactor();

      const template = getContent().mobTemplate(mob.templateId)!;

      // Support casters periodically buff/heal themselves while a player is in the fight.
      const support = MOB_SUPPORT[mob.templateId];
      if (support && mob.supportCd <= 0 && this.anyLivingPlayerWithin(mob, template.aggroRange)) {
        this.castMobSpell(mob, template, support);
        mob.supportCd = MOB_SUPPORT_COOLDOWN_MS;
      }

      // Charger lunge: while dashing, the mob barrels along its locked aim, striking each player it
      // passes through once. Overrides normal movement/attack until the dash ends.
      if (mob.dashUntil > 0) {
        if (this.now >= mob.dashUntil) {
          mob.dashUntil = 0;
        } else {
          mob.x = clamp(mob.x + mob.dashVx * dt, 0, this.width);
          mob.y = clamp(mob.y + mob.dashVy * dt, 0, this.height);
          for (const player of this.players.values()) {
            if (player.dead || mob.dashHit.has(player.id)) continue;
            if (circlesOverlap(mob.x, mob.y, MOB_RADIUS, player.x, player.y, PLAYER_RADIUS)) {
              this.damagePlayer(player, this.mobOutgoing(mob, template));
              mob.dashHit.add(player.id);
            }
          }
          continue;
        }
      }

      // Attack wind-up: a telegraphed mob is rooted, facing its locked aim. The strike lands when
      // the wind-up elapses — moving out of the way during it is how a player dodges.
      if (mob.telegraphUntil > 0) {
        mob.facing = mob.telegraphFacing;
        if (this.now >= mob.telegraphUntil) {
          mob.telegraphUntil = 0;
          this.executeMobAttack(mob, template);
          mob.attackCd = template.attackCooldownMs * mob.statuses.cooldownFactor();
        }
        continue;
      }

      const view: MobView = { x: mob.x, y: mob.y, template, attackReady: mob.attackCd <= 0 };
      const intent = stepMob(view, views, this.aggroScale); // weather may dampen aggro range

      if (intent.attackTargetId !== null) {
        const target = this.players.get(intent.attackTargetId);
        if (target && !target.dead) {
          mob.facing = intent.facing ?? mob.facing;
          mob.telegraphFacing = mob.facing;
          mob.telegraphTargetId = target.id;
          if (template.telegraphMs > 0) {
            // Begin the wind-up; show the tell so the player can react.
            mob.telegraphUntil = this.now + template.telegraphMs;
            // A slammer shows an AoE circle; a charger telegraphs the lunge as an aimed line; plain
            // melee shows a strike arc; ranged shows its aim line.
            const tellStyle: 'melee' | 'ranged' | 'slam' = template.slamRadius
              ? 'slam'
              : template.behavior === 'melee'
                ? 'melee'
                : 'ranged';
            const tele: FxEvent = {
              kind: 'telegraph',
              x: mob.x,
              y: mob.y,
              facing: mob.facing,
              value: template.telegraphMs,
              behavior: tellStyle,
            };
            if (template.slamRadius) tele.radius = template.slamRadius;
            this.events.push(tele);
          } else {
            this.executeMobAttack(mob, template);
            mob.attackCd = template.attackCooldownMs * mob.statuses.cooldownFactor();
          }
        }
      } else if (intent.vx !== 0 || intent.vy !== 0) {
        mob.x = clamp(mob.x + intent.vx * moveMul * mob.spdMult * dt, 0, this.width);
        mob.y = clamp(mob.y + intent.vy * moveMul * mob.spdMult * dt, 0, this.height);
        if (intent.facing !== null) mob.facing = intent.facing;
      } else {
        this.wander(mob, dt, template.speed * moveMul * mob.spdMult);
      }
    }
  }

  /**
   * Resolve a mob's attack at the moment its wind-up completes. Melee strikes the locked target if
   * it is still in reach (so dodging out of range whiffs it); ranged fires a hostile projectile
   * along the locked aim (so side-stepping the line dodges it).
   */
  private executeMobAttack(mob: Mob, template: MobTemplate): void {
    // Spellcaster monsters cast a real ability in place of their basic ranged/melee attack (the
    // charger keeps its signature lunge). The spell's projectile/cone debuffs the player it hits.
    const spell = MOB_SPELLS[mob.templateId];
    if (spell && template.behavior !== 'charger') {
      this.castMobSpell(mob, template, spell);
      return;
    }
    if (template.behavior === 'charger') {
      // Begin the lunge along the locked aim; contact damage is applied during the dash ticks.
      mob.dashUntil = this.now + DASH_MS;
      const dashSpeed = (template.dashSpeed ?? 480) * mob.spdMult;
      mob.dashVx = Math.cos(mob.telegraphFacing) * dashSpeed;
      mob.dashVy = Math.sin(mob.telegraphFacing) * dashSpeed;
      mob.dashHit.clear();
      this.events.push({ kind: 'melee', x: mob.x, y: mob.y, facing: mob.telegraphFacing });
      return;
    }
    if (template.behavior === 'ranged') {
      const speed = template.projectileSpeed ?? 280;
      const pid = this.allocId();
      this.projectiles.set(pid, {
        id: pid,
        abilityId: 'arrow', // sprite hint only; the client tints hostile projectiles separately
        x: mob.x,
        y: mob.y,
        vx: Math.cos(mob.telegraphFacing) * speed,
        vy: Math.sin(mob.telegraphFacing) * speed,
        ttl: 2400,
        damage: this.mobOutgoing(mob, template),
        radius: 8,
        ownerId: 0,
        ownerLevel: template.level,
        critChance: 0,
        hostile: true,
      });
      this.events.push({ kind: 'cast', x: mob.x, y: mob.y, facing: mob.telegraphFacing });
      return;
    }
    // Melee: a slam hits everyone within slamRadius; a normal strike hits the locked target if it
    // is still in reach. Either way, dodging out of range during the wind-up avoids the hit.
    if (template.slamRadius) {
      for (const player of this.players.values()) {
        if (player.dead) continue;
        if (Math.hypot(player.x - mob.x, player.y - mob.y) <= template.slamRadius + PLAYER_RADIUS) {
          this.damagePlayer(player, this.mobOutgoing(mob, template));
        }
      }
      this.events.push({ kind: 'slam', x: mob.x, y: mob.y, radius: template.slamRadius });
      return;
    }
    const target = this.players.get(mob.telegraphTargetId);
    const reach = template.attackRange + PLAYER_RADIUS;
    if (target && !target.dead && Math.hypot(target.x - mob.x, target.y - mob.y) <= reach) {
      this.damagePlayer(target, this.mobOutgoing(mob, template));
    }
    this.events.push({ kind: 'melee', x: mob.x, y: mob.y, facing: mob.telegraphFacing });
  }

  /**
   * A monster casts one of the player abilities, dispatched by kind:
   *  - heal: a self-buff (might/haste/regen, from a buff spell) or a flat self-heal.
   *  - melee: a cone/nova around the mob; every player in reach is hit and debuffed.
   *  - projectile: a hostile bolt along the locked aim that debuffs the player it strikes.
   * Damage uses the mob's own scaled output; the ability supplies the shape, visuals, and on-hit
   * status. Used both for offensive casts (in place of the basic attack) and periodic self-support.
   */
  private castMobSpell(mob: Mob, template: MobTemplate, abilityId: AbilityId): void {
    const ability = getContent().ability(abilityId);
    if (!ability) return;
    this.events.push({ kind: 'cast', x: mob.x, y: mob.y, facing: mob.telegraphFacing, abilityId });

    if (ability.kind === 'heal') {
      const buff = BUFF_ON_CAST[abilityId];
      if (buff) mob.statuses.apply(buff.id, buff.ms, buff.magnitude);
      else mob.hp = Math.min(mob.maxHp, mob.hp + ability.damage);
      return;
    }

    const dmg = this.mobOutgoing(mob, template);
    if (ability.kind === 'melee') {
      const halfAngle = ability.meleeHalfAngle ?? 0.6;
      for (const player of this.players.values()) {
        if (player.dead) continue;
        const hit = inMeleeCone(
          mob.x,
          mob.y,
          mob.telegraphFacing,
          player.x,
          player.y,
          ability.range,
          halfAngle,
        );
        if (hit) {
          this.damagePlayer(player, dmg);
          applyPlayerDebuff(player, abilityId);
        }
      }
      this.events.push({ kind: 'melee', x: mob.x, y: mob.y, facing: mob.telegraphFacing });
      return;
    }

    // Projectile: tagged with abilityId so the client colors it and its hit applies the debuff.
    const speed = ability.projectileSpeed ?? 300;
    const pid = this.allocId();
    this.projectiles.set(pid, {
      id: pid,
      abilityId,
      x: mob.x,
      y: mob.y,
      vx: Math.cos(mob.telegraphFacing) * speed,
      vy: Math.sin(mob.telegraphFacing) * speed,
      ttl: ability.projectileTtlMs ?? 1800,
      damage: dmg,
      radius: ability.radius,
      ownerId: 0,
      ownerLevel: template.level,
      critChance: 0,
      hostile: true,
    });
  }

  /** True if any living player is within `range` of the mob (cheap aggro gate, no allocation). */
  private anyLivingPlayerWithin(mob: Mob, range: number): boolean {
    for (const p of this.players.values()) {
      if (!p.dead && Math.hypot(p.x - mob.x, p.y - mob.y) <= range) return true;
    }
    return false;
  }

  private tickProjectiles(dt: number): void {
    for (const proj of this.projectiles.values()) {
      proj.x += proj.vx * dt;
      proj.y += proj.vy * dt;
      proj.ttl -= dt * 1000;

      let consumed = false;
      if (proj.hostile) {
        // Enemy projectile: hits the first living, non-godmode player it overlaps.
        for (const player of this.players.values()) {
          if (player.dead) continue;
          if (circlesOverlap(proj.x, proj.y, proj.radius, player.x, player.y, PLAYER_RADIUS)) {
            this.damagePlayer(player, proj.damage);
            // Spell projectiles debuff on hit (frost slows, fire burns, curses weaken); a plain
            // 'arrow' has no mapping, so this is a no-op for non-caster mobs.
            applyPlayerDebuff(player, proj.abilityId);
            consumed = true;
            break;
          }
        }
      } else {
        for (const mob of this.mobs.values()) {
          if (mob.dead) continue;
          if (circlesOverlap(proj.x, proj.y, proj.radius, mob.x, mob.y, MOB_RADIUS)) {
            const base = rollAbilityDamage(proj.ownerLevel, mob.level, proj.damage);
            const crit = base > 0 && rollCrit(Math.random, proj.critChance);
            const dmg = applyCrit(base, crit);
            this.damageMob(mob, dmg, proj.abilityId, proj.ownerId, crit);
            if (dmg > 0) applyStatus(mob, proj.abilityId);
            consumed = true;
            break;
          }
        }
      }
      if (consumed || proj.ttl <= 0 || this.outOfBounds(proj.x, proj.y)) {
        this.projectiles.delete(proj.id);
      }
    }
  }

  private wander(mob: Mob, dt: number, speed: number): void {
    if (this.now >= mob.wanderUntil) {
      mob.wanderAngle = Math.random() < 0.6 ? Math.random() * Math.PI * 2 : null;
      mob.wanderUntil = this.now + 800 + Math.random() * 1600;
    }
    // Leash back home if we have drifted too far.
    const homeDist = Math.hypot(mob.x - mob.homeX, mob.y - mob.homeY);
    if (homeDist > 220) mob.wanderAngle = Math.atan2(mob.homeY - mob.y, mob.homeX - mob.x);
    if (mob.wanderAngle === null) return;
    mob.x = clamp(mob.x + Math.cos(mob.wanderAngle) * speed * 0.35 * dt, 0, this.width);
    mob.y = clamp(mob.y + Math.sin(mob.wanderAngle) * speed * 0.35 * dt, 0, this.height);
    mob.facing = mob.wanderAngle;
  }

  private damageMob(
    mob: Mob,
    amount: number,
    abilityId: AbilityId | undefined,
    attackerId: number,
    crit = false,
  ): void {
    if (attackerId !== 0) mob.lastAttacker = attackerId;
    mob.hp -= amount;
    // Life steal: the attacker heals for a fraction of the damage they just dealt.
    const attacker = this.players.get(attackerId);
    if (attacker && !attacker.dead && attacker.lifesteal > 0 && amount > 0) {
      attacker.hp = Math.min(attacker.maxHp, attacker.hp + amount * attacker.lifesteal);
    }
    const hit: FxEvent = { kind: 'hit', x: mob.x, y: mob.y, value: Math.ceil(amount) };
    if (abilityId !== undefined) hit.abilityId = abilityId;
    if (crit) hit.crit = true;
    this.events.push(hit);
    if (mob.hp <= 0) {
      mob.dead = true;
      mob.respawnAt = this.now + MOB_RESPAWN_MS;
      this.events.push({ kind: 'death', x: mob.x, y: mob.y });
      this.onMobKilled(mob);
    }
  }

  /** Award XP to the killer and drop loot on the ground. */
  private onMobKilled(mob: Mob): void {
    // Clearing monsters pushes back the area's corruption.
    this.areaCorruption.pushBack(this.areaId);
    const killer = this.players.get(mob.lastAttacker);
    if (killer) {
      const reward = xpReward(mob.level) * (mob.elite ? 3 : 1); // champions give a big XP bonus
      // Shared credit: the killer plus any party members present in THIS instance each get the full
      // XP and quest progress — grouping is rewarded, not taxed (the ARPG convention).
      const credited = new Set<number>([killer.id]);
      for (const memberId of this.partyResolver(killer.id)) {
        const m = this.players.get(memberId);
        if (m && !m.dead) credited.add(memberId);
      }
      for (const id of credited) this.creditKill(id, reward, mob.templateId);
    }
    // Loot (materials + gear) comes from the DB-backed content drop tables. Equipment items roll a
    // rarity + stats into a unique instance; materials/currency drop as plain stacks.
    const content = getContent();
    const isBoss = (content.mobTemplate(mob.templateId)?.hp ?? 0) >= 200;
    const corruptedChance = this.corruptedDropChance(mob, isBoss);
    for (const stack of content.rollLoot(mob.templateId)) {
      const id = this.allocId();
      const item: GroundItem = {
        id,
        itemId: stack.item,
        qty: stack.qty,
        x: mob.x + (Math.random() - 0.5) * 30,
        y: mob.y + (Math.random() - 0.5) * 30,
        ttl: ITEM_TTL_MS,
      };
      const def = content.item(stack.item);
      if (def && def.kind === 'equip') {
        // The loot chase: a slim chance (better from bosses) the gear is instead a named unique.
        const uniqueChance = isBoss ? UNIQUE_DROP_CHANCE * 4 : UNIQUE_DROP_CHANCE;
        if (Math.random() < uniqueChance) {
          item.instance = rollRandomUnique(this.allocId());
          item.itemId = item.instance.baseId;
        } else {
          // A gear drop rolls a *random* equippable (any slot) for full variety; the loot table just
          // controls how often gear drops. Relabel the ground item so the glint matches the piece.
          const base = this.randomEquipBase() ?? asBaseItem(def);
          if (base) {
            item.itemId = base.id;
            item.instance = this.rollGear(base, 0, corruptedChance);
          }
        }
      }
      this.items.set(id, item);
    }

    // Champion bonus: a pile of gold + one guaranteed, rarity-bumped piece of gear.
    if (mob.elite) {
      this.dropGround('gold', 30 + Math.floor(Math.random() * 50), mob.x, mob.y);
      this.dropBonusGear(mob.x, mob.y, 2, corruptedChance);
    }

    // Spells are loot: an independent book-drop roll, richer from elites and bosses.
    const bookChance = isBoss
      ? SPELLBOOK_DROP_BOSS
      : mob.elite
        ? SPELLBOOK_DROP_ELITE
        : SPELLBOOK_DROP_NORMAL;
    if (Math.random() < bookChance) this.dropSpellbook(mob.x, mob.y);

    // Gems are loot too: an independent roll (elites/bosses far likelier), tier-weighted toward
    // chipped. A socketed gem is a small, stackable build bonus — the "loot = your build" layer.
    const gemChance = isBoss ? GEM_DROP_BOSS : mob.elite ? GEM_DROP_ELITE : GEM_DROP_NORMAL;
    if (Math.random() < gemChance) this.dropGround(rollGemDrop(), 1, mob.x, mob.y);

    // Living loot meta: consume this monster type's accumulated hunting bounty. A long lull since the
    // last kill (or a never-farmed type) means a high chance of a bonus rarity-bumped drop; the kill
    // resets the timer, so farming the same spot quickly depletes it back to base loot.
    const last = this.lastKillAt.get(mob.templateId);
    const bounty = last === undefined ? 1 : Math.min(1, (this.now - last) / BOUNTY_FULL_MS);
    this.lastKillAt.set(mob.templateId, this.now);
    if (Math.random() < bounty * BOUNTY_MAX_CHANCE) {
      this.dropBonusGear(mob.x, mob.y, 1, corruptedChance);
      if (killer) this.notify(killer.id, 'A hunting bounty! Fresh quarry yields richer loot.');
    }
  }

  /** Drop a random spellbook as a ground stack (picked up into the bag, then read to learn). */
  private dropSpellbook(x: number, y: number): void {
    const books = getContent()
      .items()
      .filter((i) => i.kind === 'spellbook');
    const book = books[Math.floor(Math.random() * books.length)];
    if (book) this.dropGround(book.id, 1, x, y);
  }

  /** A random equippable base item (any slot), or null if the content has none. */
  private randomEquipBase(): BaseItem | null {
    const equips = getContent()
      .items()
      .filter((i) => i.kind === 'equip');
    const def = equips[Math.floor(Math.random() * equips.length)];
    return def ? asBaseItem(def) : null;
  }

  /** Drop one random equipment piece as a rolled, rarity-bumped instance (elite + bounty rewards). */
  private dropBonusGear(
    x: number,
    y: number,
    rarityBump: number,
    corruptedChance: number,
    uniqueChance = 0,
  ): void {
    // The loot chase: a slim chance the piece is instead a named unique (its own base + fixed affixes).
    if (uniqueChance > 0 && Math.random() < uniqueChance) {
      const inst = rollRandomUnique(this.allocId());
      this.dropGround(inst.baseId, 1, x, y).instance = inst;
      return;
    }
    const base = this.randomEquipBase();
    if (!base) return;
    const ground = this.dropGround(base.id, 1, x, y);
    ground.instance = this.rollGear(base, rarityBump, corruptedChance);
  }

  /**
   * Roll a gear instance for a drop. With probability `corruptedChance` the item is born
   * **corrupted** (a strong buff + a debuff); otherwise it's a normal rolled instance.
   */
  private rollGear(base: BaseItem, rarityBump: number, corruptedChance: number): ItemInstance {
    if (Math.random() < corruptedChance) {
      return rollCorruptedInstance(this.allocId(), base);
    }
    return rollItemInstance(this.allocId(), base, Math.random, rarityBump);
  }

  /**
   * Combined corrupted-drop chance for a slain mob: the area's corruption (scaled), plus a slim flat
   * bonus for invasion champions and an even slimmer one for bosses.
   */
  private corruptedDropChance(mob: Mob, isBoss: boolean): number {
    let chance = this.corruption() * CORRUPT_DROP_MAX;
    if (mob.invader) chance += INVASION_CORRUPT_CHANCE;
    if (isBoss) chance += BOSS_CORRUPT_CHANCE;
    return chance;
  }

  /** Spawn a ground item (gold or a material/gear stack) with a little scatter. Returns it. */
  private dropGround(itemId: string, qty: number, x: number, y: number): GroundItem {
    const id = this.allocId();
    const item: GroundItem = {
      id,
      itemId,
      qty,
      x: x + (Math.random() - 0.5) * 30,
      y: y + (Math.random() - 0.5) * 30,
      ttl: ITEM_TTL_MS,
    };
    this.items.set(id, item);
    return item;
  }

  // --- quests + per-player notices -----------------------------------------------------

  private notify(playerId: number, text: string): void {
    this.notices.push({ playerId, text });
  }

  /** Drain per-player system notices (quest completions, level-ups) for the host to deliver. */
  drainNotices(): { playerId: number; text: string }[] {
    const drained = this.notices;
    this.notices = [];
    return drained;
  }

  /** Accept a quest from the content DB. Returns a status message. */
  acceptQuest(playerId: number, questId: string): string {
    const player = this.players.get(playerId);
    if (!player) return 'no such player';
    const quest = getContent().quest(questId);
    if (!quest) return `No such quest: ${questId}`;
    if (player.questsDone.has(questId)) return `Already completed: ${quest.name}`;
    if (player.quests.has(questId)) return `Already on quest: ${quest.name}`;
    player.quests.set(questId, 0);
    return `Quest accepted: ${quest.name} — ${quest.description}`;
  }

  /** Human-readable quest log lines (available + in-progress + done). */
  questLog(playerId: number): string[] {
    const player = this.players.get(playerId);
    if (!player) return [];
    return getContent()
      .quests()
      .map((q) => {
        if (player.questsDone.has(q.id)) return `✓ ${q.name} (done)`;
        if (player.quests.has(q.id)) {
          return `▸ ${q.name}: ${player.quests.get(q.id)}/${q.targetCount} — ${q.description}`;
        }
        return `· ${q.name} [${q.id}] — /accept ${q.id}`;
      });
  }

  /** Structured quest states for the client quest-log panel (available + active + done). */
  private questStates(player: Player): QuestState[] {
    return getContent()
      .quests()
      .map((q) => {
        const status: QuestState['status'] = player.questsDone.has(q.id)
          ? 'done'
          : player.quests.has(q.id)
            ? 'active'
            : 'available';
        const collect = !!q.turnInItem;
        // Collect quests show how many of the item the player currently holds; kill quests show kills.
        const progress = collect
          ? Math.min(player.loot.get(q.turnInItem!) ?? 0, q.turnInCount)
          : (player.quests.get(q.id) ?? 0);
        return {
          id: q.id,
          name: q.name,
          description: q.description,
          kind: collect ? ('collect' as const) : ('kill' as const),
          targetCount: collect ? q.turnInCount : q.targetCount,
          progress,
          status,
          rewardGold: q.rewardGold,
          rewardXp: q.rewardXp,
          rewardItem: q.rewardItem,
        };
      });
  }

  /** Award one player XP + quest progress for a kill (used for the killer and each present party member). */
  private creditKill(playerId: number, xp: number, mobTemplateId: string): void {
    const p = this.players.get(playerId);
    if (!p) return;
    p.xp += xp;
    const newLevel = levelForXp(p.xp);
    if (newLevel > p.level) {
      const gained = newLevel - p.level;
      p.attrPoints += gained * ATTR_POINTS_PER_LEVEL; // earn attribute points per level
      p.skillPoints += gained * SKILL_POINTS_PER_LEVEL; // and a skill point per level
      this.notify(
        p.id,
        `You reached level ${newLevel}! (+${ATTR_POINTS_PER_LEVEL} attributes, +${SKILL_POINTS_PER_LEVEL} skill)`,
      );
      this.events.push({ kind: 'levelup', x: p.x, y: p.y, value: newLevel });
    }
    p.level = newLevel;
    this.recomputeStats(p);
    this.progressQuests(p, mobTemplateId);
  }

  private progressQuests(player: Player, mobTemplateId: string): void {
    const content = getContent();
    for (const [questId, kills] of player.quests) {
      const quest = content.quest(questId);
      // Only kill quests auto-progress here; collect quests are turned in at a quest-giver.
      if (!quest || quest.turnInItem || quest.targetMob !== mobTemplateId) continue;
      const next = kills + 1;
      if (next >= quest.targetCount) this.completeQuest(player, quest);
      else player.quests.set(questId, next);
    }
  }

  /** Decay dropped items and let nearby players pick them up. */
  private tickItems(dt: number): void {
    for (const item of this.items.values()) {
      item.ttl -= dt * 1000;
      if (item.ttl <= 0) {
        this.items.delete(item.id);
        continue;
      }
      for (const player of this.players.values()) {
        if (player.dead) continue;
        if (Math.hypot(player.x - item.x, player.y - item.y) <= PICKUP_RADIUS) {
          if (item.itemId === 'gold') {
            player.gold += item.qty;
            this.events.push({ kind: 'coin', x: item.x, y: item.y, value: item.qty });
          } else if (item.instance) {
            this.addGear(player, item.instance);
            this.events.push({
              kind: 'pickup',
              x: item.x,
              y: item.y,
              rarity: item.instance.rarity,
            });
          } else {
            player.loot.set(item.itemId, (player.loot.get(item.itemId) ?? 0) + item.qty);
            this.events.push({ kind: 'pickup', x: item.x, y: item.y });
          }
          this.items.delete(item.id);
          break;
        }
      }
    }
  }

  private damagePlayer(player: Player, amount: number, silent = false): void {
    if (player.god) return;
    const taken = amount * player.damageTakenMult; // corrupted +fragile makes hits land harder
    player.hp -= taken;
    // Round the floating damage (mult'd by corruption/fragile) for a clean floating number. Burn
    // (damage-over-time) ticks pass silent=true so they don't spew a number every server tick.
    if (!silent)
      this.events.push({ kind: 'hit', x: player.x, y: player.y, value: Math.ceil(taken) });
    if (player.hp <= 0) {
      player.hp = 0;
      player.dead = true;
      player.respawnAt = this.now + PLAYER_RESPAWN_MS;
      this.events.push({ kind: 'death', x: player.x, y: player.y });
      // Every player's death feeds the shared area-wide corruption — darker and deadlier for all.
      this.areaCorruption.addDeath(this.areaId);
    }
  }

  private respawnPlayer(player: Player): void {
    player.dead = false;
    player.hp = player.maxHp;
    player.mana = PLAYER_MAX_MANA;
    player.x = this.spawnPoint.x;
    player.y = this.spawnPoint.y;
    player.cooldowns.clear();
    player.buffs.clear(); // don't carry a War Cry / Sprint / Renew through death
    player.debuffs.clear(); // and shed any enemy slow / burn / weaken on respawn
  }

  private respawnMob(mob: Mob): void {
    const template = getContent().mobTemplate(mob.templateId)!;
    mob.dead = false;
    mob.hp = template.hp;
    // Re-randomize the respawn position (and update its home) so the world doesn't feel static —
    // cleared ground refills somewhere new rather than the exact same spots every time.
    mob.x = this.randomMobX();
    mob.y = this.randomMobY();
    mob.homeX = mob.x;
    mob.homeY = mob.y;
    mob.attackCd = 0;
  }

  private outOfBounds(x: number, y: number): boolean {
    return x < 0 || y < 0 || x > this.width || y > this.height;
  }

  snapshot(): EntityState[] {
    const out: EntityState[] = [];
    for (const p of this.players.values()) {
      if (p.dead) continue;
      // Debuff bits (slow=1, burn=2, weaken=4) match the monster tint bits — so a slowed/burning
      // player tints like a monster — while buff bits (might=8, haste=16, regen=32) drive HUD pips.
      const flags =
        (p.debuffs.has('slow') ? 1 : 0) |
        (p.debuffs.has('burn') ? 2 : 0) |
        (p.debuffs.has('weaken') ? 4 : 0) |
        (p.buffs.has('might') ? 8 : 0) |
        (p.buffs.has('haste') ? 16 : 0) |
        (p.buffs.has('regen') ? 32 : 0);
      out.push({
        id: p.id,
        x: p.x,
        y: p.y,
        name: p.name,
        hue: p.hue,
        kind: 'player',
        facing: p.facing,
        hp: Math.ceil(p.hp),
        maxHp: p.maxHp,
        level: p.level,
        ...(flags ? { flags } : {}),
      });
    }
    for (const m of this.mobs.values()) {
      if (m.dead) continue;
      const flags =
        (m.statuses.has('slow') ? 1 : 0) |
        (m.statuses.has('burn') ? 2 : 0) |
        (m.statuses.has('weaken') ? 4 : 0) |
        (m.statuses.has('might') || m.statuses.has('haste') ? 64 : 0); // enraged/hasted self-buff
      const mob: EntityState = {
        id: m.id,
        x: m.x,
        y: m.y,
        name: m.name,
        hue: m.hue,
        kind: 'mob',
        facing: m.facing,
        hp: Math.ceil(m.hp),
        maxHp: m.maxHp,
        level: m.level,
      };
      if (flags > 0) mob.flags = flags;
      if (m.elite) mob.elite = true;
      out.push(mob);
    }
    for (const proj of this.projectiles.values()) {
      const e: EntityState = {
        id: proj.id,
        x: proj.x,
        y: proj.y,
        name: '',
        hue: 0,
        kind: 'projectile',
        facing: Math.atan2(proj.vy, proj.vx),
        hp: 0,
        maxHp: 0,
        level: 0,
        abilityId: proj.abilityId,
      };
      if (proj.hostile) e.hostile = true;
      out.push(e);
    }
    for (const item of this.items.values()) {
      const e: EntityState = {
        id: item.id,
        x: item.x,
        y: item.y,
        name: '',
        hue: 0,
        kind: 'item',
        facing: 0,
        hp: 0,
        maxHp: 0,
        level: 0,
        itemId: item.itemId,
        qty: item.qty,
      };
      if (item.instance) e.rarity = item.instance.rarity;
      out.push(e);
    }
    for (const npc of this.npcs.values()) {
      out.push({
        id: npc.id,
        x: npc.x,
        y: npc.y,
        name: npc.name,
        hue: npc.hue,
        kind: 'npc',
        facing: Math.PI / 2,
        hp: 0,
        maxHp: 0,
        level: 0,
        npcKind: npc.kind,
      });
    }
    for (const chest of this.chestList()) {
      out.push({
        id: chest.id,
        x: chest.x,
        y: chest.y,
        name: '',
        hue: 0,
        kind: 'chest',
        facing: 0,
        hp: 0,
        maxHp: 0,
        level: 0,
        opened: chest.opened,
      });
    }
    return out;
  }

  /** Return and clear the transient effects accumulated since the last drain. */
  drainEvents(): FxEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  /** Personal stats for the 'you' message (kept off the shared snapshot). */
  playerStats(id: number):
    | {
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
        loot: Record<string, number>;
        gear: ItemInstance[];
        potions: { health: number; mana: number };
        attributes: AttributeSet;
        attrPoints: number;
        skills: string[];
        skillPoints: number;
        respawnIn: number;
        power: number;
        critChance: number;
        equipment: Equipment;
        known: Record<string, number>;
        quests: QuestState[];
        discovered: string[];
        corruption: number;
        x: number;
        y: number;
        ackSeq: number;
        /** Effective move multiplier — the client predictor integrates with this to stay in sync. */
        moveMul: number;
      }
    | undefined {
    const p = this.players.get(id);
    if (!p) return undefined;
    const progress = levelProgress(p.xp);
    return {
      hp: Math.ceil(p.hp),
      maxHp: p.maxHp,
      mana: Math.floor(p.mana),
      maxMana: PLAYER_MAX_MANA,
      dead: p.dead,
      level: p.level,
      xp: p.xp,
      xpInto: progress.intoLevel,
      xpNext: progress.neededForNext,
      gold: p.gold,
      loot: Object.fromEntries(p.loot),
      gear: p.gear,
      potions: { ...p.potions },
      attributes: { ...p.attributes },
      attrPoints: p.attrPoints,
      skills: [...p.skills],
      skillPoints: p.skillPoints,
      respawnIn: p.dead ? Math.max(0, Math.ceil(p.respawnAt - this.now)) : 0,
      power: p.power,
      critChance: p.critChance,
      equipment: p.equipment,
      known: Object.fromEntries(p.known),
      quests: this.questStates(p),
      discovered: [...p.discovered],
      corruption: this.corruption(),
      x: p.x,
      y: p.y,
      ackSeq: p.lastSeq,
      moveMul: this.playerMoveMul(p),
    };
  }

  /** Player count (used for instance cap + GC). Excludes monsters. */
  get population(): number {
    return this.players.size;
  }

  /** All player ids in this instance (including dead/respawning) — for snapshot + chat routing. */
  playerIds(): number[] {
    return [...this.players.keys()];
  }

  nameOf(id: number): string | undefined {
    return this.players.get(id)?.name;
  }
}

/**
 * OSRS-inspired hit resolution layered on our ability damage: an accuracy roll (attacker level
 * vs monster level) decides hit/miss; on a hit, damage is rolled in the upper half of the
 * ability's base damage so hits still feel meaningful. Returns 0 on a miss.
 */
function rollAbilityDamage(
  attackerLevel: number,
  defenderLevel: number,
  baseDamage: number,
): number {
  const atk = attackRoll(attackerLevel, 8); // small inherent accuracy so early hits mostly land
  const def = defenceRoll(defenderLevel);
  if (!rolledHit(atk, def)) return 0;
  const half = Math.ceil(baseDamage * 0.5);
  return half + rollDamage(baseDamage - half);
}

/** Chilling/snaring spells that slow on hit: id → {duration ms, movement factor}. */
const SLOW_ON_HIT: Partial<Record<AbilityId, { ms: number; factor: number }>> = {
  frost: { ms: 1500, factor: 0.4 },
  venom: { ms: 2200, factor: 0.3 },
  frostshard: { ms: 1200, factor: 0.5 },
  frostlance: { ms: 1600, factor: 0.45 },
  frostnova: { ms: 2000, factor: 0.4 },
  glacierspike: { ms: 2000, factor: 0.4 },
  entangling_vines: { ms: 2200, factor: 0.35 },
  curse_of_decay: { ms: 1800, factor: 0.4 },
  hamstring: { ms: 1600, factor: 0.45 },
};
/** Fire / poison / bleed spells that burn (damage-over-time) on hit: id → {duration ms, dmg per tick}. */
const BURN_ON_HIT: Partial<Record<AbilityId, { ms: number; dmg: number }>> = {
  fireball: { ms: 2000, dmg: 8 },
  meteor: { ms: 2600, dmg: 14 },
  emberbolt: { ms: 2000, dmg: 5 },
  flamewave: { ms: 2200, dmg: 7 },
  cinderorb: { ms: 2400, dmg: 9 },
  infernonova: { ms: 2600, dmg: 10 },
  poison_spit: { ms: 2600, dmg: 6 },
  shadow_bolt: { ms: 2000, dmg: 6 },
  draining_touch: { ms: 2000, dmg: 6 },
  shadow_nova: { ms: 2200, dmg: 7 },
  rend: { ms: 2400, dmg: 5 },
};

/** Curse spells that weaken a monster's outgoing damage on hit: id → {duration ms, dmg-reduction}. */
const WEAKEN_ON_HIT: Partial<Record<AbilityId, { ms: number; factor: number }>> = {
  curse_of_decay: { ms: 3000, factor: 0.4 }, // the curse both slows and saps its bite
  draining_touch: { ms: 2500, factor: 0.3 },
  shadow_nova: { ms: 2500, factor: 0.3 },
};

/** Self-buff spells: which timed buff they grant the caster. */
const BUFF_ON_CAST: Partial<
  Record<AbilityId, { id: 'might' | 'haste' | 'regen'; ms: number; magnitude: number }>
> = {
  warcry: { id: 'might', ms: 8000, magnitude: 0.3 }, // +30% damage
  sprint: { id: 'haste', ms: 6000, magnitude: 0.35 }, // +35% attack speed & move
  renew: { id: 'regen', ms: 6000, magnitude: 10 }, // 10 hp/sec
};

/** Shrine blessings — stronger and longer than the buff spells (a found-shrine reward, Diablo-style). */
const SHRINE_BUFFS: {
  id: 'might' | 'haste' | 'regen';
  ms: number;
  magnitude: number;
  label: string;
}[] = [
  { id: 'might', ms: 30_000, magnitude: 0.4, label: 'Might — your blows strike harder' },
  { id: 'haste', ms: 30_000, magnitude: 0.4, label: 'Haste — you move and strike faster' },
  { id: 'regen', ms: 20_000, magnitude: 15, label: 'Renewal — your wounds knit closed' },
];

/**
 * Map an ability's on-hit effect onto a monster. A spell may appear in several maps (e.g. a curse
 * that both slows and weakens), so each is applied independently rather than first-match-wins.
 */
function applyStatus(mob: { statuses: StatusSet }, abilityId: AbilityId): void {
  const slow = SLOW_ON_HIT[abilityId];
  if (slow) mob.statuses.apply('slow', slow.ms, slow.factor);
  const burn = BURN_ON_HIT[abilityId];
  if (burn) mob.statuses.apply('burn', burn.ms, burn.dmg);
  const weaken = WEAKEN_ON_HIT[abilityId];
  if (weaken) mob.statuses.apply('weaken', weaken.ms, weaken.factor);
}

/** Map an enemy spell's on-hit effect onto a PLAYER (so monster spells slow/burn/weaken you too). */
function applyPlayerDebuff(player: { debuffs: StatusSet }, abilityId: AbilityId): void {
  const slow = SLOW_ON_HIT[abilityId];
  if (slow) player.debuffs.apply('slow', slow.ms, slow.factor);
  const burn = BURN_ON_HIT[abilityId];
  if (burn) player.debuffs.apply('burn', burn.ms, burn.dmg);
  const weaken = WEAKEN_ON_HIT[abilityId];
  if (weaken) player.debuffs.apply('weaken', weaken.ms, weaken.factor);
}

function sanitizeName(name: string): string {
  const trimmed = (name ?? '').trim().slice(0, MAX_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : 'Adventurer';
}

/**
 * Rebuild a player's learned-spells map from a save. A pre-spellbook save (no `known`) grandfathers
 * in **every ability the content defines** at rank 1 — nobody loses a button they had before the
 * spellbook system. A modern save is filtered to abilities that still exist, with ranks clamped.
 */
function restoreKnown(saved: [string, number][] | undefined): Map<AbilityId, number> {
  const content = getContent();
  // Absent OR empty grandfathers in every ability: a character must never end up unable to cast
  // anything (an empty list would otherwise wipe even the starter spells on the next load).
  if (!saved || saved.length === 0) {
    return new Map(content.abilityOrder().map((id) => [id, 1] as [AbilityId, number]));
  }
  const known = new Map<AbilityId, number>();
  for (const [id, rank] of saved) {
    if (!content.ability(id)) continue; // ability removed from content since the save
    known.set(id as AbilityId, clamp(Math.round(rank), 1, MAX_SPELL_RANK));
  }
  return known;
}
