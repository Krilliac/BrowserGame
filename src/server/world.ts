import { clamp } from '../shared/math.js';
import { moveVector, stepToward } from '../shared/movement.js';
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
  type BehaviorSpec,
  type DamageElement,
  type FxEvent,
} from '../shared/combat.js';
import { config } from './config.js';
import { aimAngle, circlesOverlap, inMeleeCone } from './combat.js';
import { pointToSegmentDist } from './geometry.js';
import { initialCharges, resolveHit, steerHoming, type MobLite } from './projectile-behaviors.js';
import { applyModifiers } from './spell-modifiers.js';
import {
  applyCrit,
  attackRoll,
  BASE_CRIT_CHANCE,
  defenceRoll,
  resistedDamage,
  rollCrit,
  rollDamage,
  rolledHit,
} from './combat-formulas.js';
import {
  gearSellValue,
  hasItemFlag,
  ItemFlags,
  rollAffixes,
  rollCorruptedAffixes,
  rollCorruptedInstance,
  rollItemInstance,
  rollVendorInstance,
  type BaseItem,
  type ItemInstance,
} from '../shared/items.js';
import { sortBag } from '../shared/bag-sort.js';
import {
  GEMS,
  GEMS_PER_COMBINE,
  gemBonuses,
  isGem,
  nextGemTier,
  rollGemDrop,
} from '../shared/gems.js';
import { gambleCost, isGambleSlot, rollGamble } from '../shared/gamble.js';
import { AreaCorruption } from './area-corruption.js';
import { EQUIP_SLOTS, dollSlotsFor, type EquipSlot, type ItemSlot } from '../shared/equipment.js';
import {
  stepMob,
  isPackish,
  traitDamageMult,
  type MobStepContext,
  type MobTemplate,
  type MobView,
  type PlayerView,
} from './mobs.js';
import {
  HIRELING_TEMPLATES,
  hirelingCost,
  hirelingStats,
  hirelingTemplate,
  stepHireling,
  type HirelingTemplate,
} from './hirelings.js';
import type { DungeonDef, Rect } from '../shared/areas.js';
import { NpcFlags, hasNpcFlag } from '../shared/npc-flags.js';
import { CreatureSpawnFlags, hasSpawnFlag } from '../shared/spawn-flags.js';
import { QuestFlags, hasQuestFlag } from '../shared/quest-flags.js';
import {
  blockersForDecor,
  pointInAnyBlocker,
  resolveCircleMove,
  separateCircles,
  PLAYER_COLLISION_RADIUS,
  type Blockers,
  type Circle,
} from '../shared/collision.js';
import { mulberry32 } from '../shared/math.js';
import {
  BOSS_SCRIPTS,
  newBossScriptState,
  stepBossScript,
  bossEnrageMultiplier,
  type BossScriptState,
} from './boss-scripts.js';
import {
  type AttributeSet,
  attributeBonuses,
  emptyAttributes,
  toAttributeSet,
  ATTRIBUTE_KEYS,
  ATTR_POINTS_PER_LEVEL,
  BASE_ATTRIBUTE,
} from '../shared/attributes.js';
import { aggregateSkillEffects, canAllocate } from '../shared/skilltree.js';
import { runewordBonuses, detectRuneword, rune, RUNES } from '../shared/runewords.js';
import { setBonuses } from '../shared/item-sets.js';
import { resolveProcs, type ProcDef } from './item-procs.js';
import { salvageYield, type MaterialKind, type MaterialYield } from './salvage.js';
import { applyCraft } from './crafting.js';
import { newlyEarned, DEFAULT_ACHIEVEMENTS } from './achievements.js';
import {
  rollRiftModifiers,
  aggregateRiftEffects,
  type RiftModifierDef,
  type RiftEffects,
} from './rift-modifiers.js';
import {
  createTrade,
  setOffer as tradeSetOfferPure,
  confirm as tradeConfirmPure,
  cancel as tradeCancelPure,
  commit as tradeCommitPure,
  bothConfirmed,
  isParticipant,
  type TradeSession,
  type TradeOffer,
} from './trade.js';
import {
  championGoldPile,
  coopScale,
  healthGlobeHeal,
  levelForXp,
  levelProgress,
  maxHpForLevel,
  scaleDamageForLevel,
  scaleGoldForLevel,
  tierGoldScale,
  xpForLevel,
  xpReward,
} from './progression.js';
import { StatusSet, type StatusId } from './status-effects.js';
import { STATUS_BITS } from '../shared/status-bits.js';
import { ABILITY_KNOCKBACK } from './ability-effects.js';
import { SpatialGrid } from './spatial.js';
import { getContent, type QuestDef } from './content.js';
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
/** Gold within this radius of a living player is vacuumed toward them (the ARPG gold-magnet feel). */
const GOLD_MAGNET_RADIUS = 95;
/** How fast vacuumed gold flies toward the player (world px/s). */
const GOLD_MAGNET_SPEED = 460;
let ITEM_TTL_MS = config.items.itemTtlMs;

/** Clamp a host-supplied liveops multiplier to a safe value: finite and >= 0, else 1 (no event). */
function sanitizeEventMult(mult: number): number {
  return Number.isFinite(mult) && mult >= 0 ? mult : 1;
}

/**
 * One gold-magnet step (pure): pull a gold drop toward the NEAREST living player that is within the
 * magnet radius but still outside the pickup radius (inside pickup, the normal pickup collects it —
 * we don't fight it). Returns the gold's new position; unchanged when no player qualifies. Exported
 * so the vacuum behavior is unit-testable without a World.
 */
export function goldMagnetStep(
  item: { x: number; y: number },
  players: Iterable<{ x: number; y: number; dead: boolean }>,
  dt: number,
): { x: number; y: number } {
  let bestDist = Infinity;
  let target: { x: number; y: number } | undefined;
  for (const p of players) {
    if (p.dead) continue;
    const d = Math.hypot(p.x - item.x, p.y - item.y);
    if (d > GOLD_MAGNET_RADIUS || d <= PICKUP_RADIUS) continue; // out of band → leave it
    if (d < bestDist) {
      bestDist = d;
      target = p;
    }
  }
  if (!target) return { x: item.x, y: item.y };
  return stepToward(item.x, item.y, target.x, target.y, GOLD_MAGNET_SPEED * dt);
}

/** Rift gold fee per tier â€” the endgame gold sink; the risk you choose is the fee you pay. */
let RIFT_COST_PER_TIER = config.economy.riftCostPerTier;
/** Highest rift tier a player may open: one tier unlocked per 3 levels, clamped to 1..10. */
function maxRiftTier(level: number): number {
  return Math.max(1, Math.min(10, Math.floor(level / 3)));
}
const INTERACT_RANGE = 70;
// The unequipped-gear bag holds up to this many pieces; a new piece beyond the cap evicts the oldest
// (sell or equip to keep the good stuff). The HUD only shows the newest few â€” see the client.
let MAX_BAG_GEAR = config.items.maxBagGear;
// Bank stash slots â€” far larger than the bag, so the overflow has somewhere safe to go.
let STASH_CAP = config.items.stashCap;
// Stash expansion (banker gold-sink): each purchase adds STASH_EXPAND_STEP slots above the base, up to
// STASH_MAX_EXPANSIONS purchases. The cost escalates per purchase so a fully-expanded stash is a major
// gold sink, not a trivial one.
const STASH_EXPAND_STEP = 10;
const STASH_MAX_EXPANSIONS = 5;
const STASH_EXPAND_COST = 1000;
// Shrines (decor kind 'shrine'): step within this radius to be blessed; the shrine then recharges
// for the cooldown before it can bless again (shared across players, Diablo-shrine style).
const SHRINE_RADIUS = 46;
const SHRINE_COOLDOWN_MS = 60_000;
// Chests (decor kind 'chest'): walk within this radius to pry one open once; it spills gold + gear.
const CHEST_RADIUS = 52;
let CHEST_GOLD_MIN = config.economy.chestGoldMin;
let CHEST_GOLD_MAX = config.economy.chestGoldMax;

// Breakable pots (decor kind 'pot'): brush against one to smash it â€” a little gold spills out,
// and once in a while it tops up a belt potion. The Diablo "smash everything" dopamine layer.
const POT_RADIUS = 30;
let POT_GOLD_MIN = config.economy.potGoldMin;
let POT_GOLD_MAX = config.economy.potGoldMax;

// Global difficulty tuning â€” the world is balanced to be DANGEROUS: monsters hit much harder,
// live longer, and notice you from farther away, so ground is earned rather than strolled
// through. Pairs with the exponential XP curve (progression.ts) for an hours-long climb.
let MOB_DMG_TUNING = config.difficulty.mobDamage;
let MOB_HP_TUNING = config.difficulty.mobHp;
let MOB_AGGRO_TUNING = config.difficulty.mobAggro;
// Per-level HP growth (×(1 + this×level)): early mobs barely change (L2 ≈ +10%), late mobs and
// bosses get genuinely tanky (L18 ≈ +1.9×, L40 ≈ +3×) so player power growth never trivializes
// a same-level fight. Calibrated against the pacing sim's one-shot-by-L8 finding.
let LEVEL_HP_SCALE = config.difficulty.levelHpScale;
// Co-op difficulty: each extra living player in an instance raises monster outgoing damage by
// this much (capped), so grouping up makes the area meaningfully harder — survival wants a team.
let COOP_DAMAGE_PER_PLAYER = config.coop.damagePerPlayer;
let COOP_DAMAGE_CAP = config.coop.damageCap;
// ...and raises monster GOLD by this much (capped) — the reward side of grouping up.
let COOP_GOLD_PER_PLAYER = config.coop.goldPerPlayer;
let COOP_GOLD_CAP = config.coop.goldCap;
// Crowd mob-density scaling (maintainDensity): each extra living player raises the target living-
// mob count by this fraction of the base roster, capped, topped up gradually so a flooded zone
// stays full of targets instead of being farmed to extinction.
let DENSITY_PER_PLAYER = config.density.perPlayer;
let DENSITY_CAP = config.density.cap;
let DENSITY_TOPUP_PER_CALL = config.density.topupPerCall;
// Radius within which same-template monsters count as "packmates" for the trait AI (pack speed,
// craven-in-numbers). Queried via a spatial grid so it's a local check, not an O(mobs²) scan.
const PACK_RADIUS = 220;

// Quick-use potion belt: instant restore on use, a shared use-cooldown, and a carry cap. Topped up
// by the Healer and found in chests â€” the active-survival layer on top of passive regen.
let POTION_CAP = config.potions.cap;
let POTION_START = config.potions.start; // a new character starts with a few of each
let POTION_HEAL = config.potions.heal; // HP restored by a health potion
let POTION_MANA = config.potions.mana; // mana restored by a mana potion
let POTION_COOLDOWN_MS = config.potions.cooldownMs;
// Passive skill-tree points earned per level (separate pool from attribute points).
let SKILL_POINTS_PER_LEVEL = config.progression.skillPointsPerLevel;
// Cost (gold) to refund all allocated attribute + skill points, scaled by level so a respec stays a
// meaningful sink for a geared character. A fresh build is cheap to undo; a level-50 one is not.
const RESPEC_COST_PER_LEVEL = 50;
// Unique (named legendary) drop chances: the loot chase. A slim base chance on any gear drop, better
// from a chest. Elites/bosses already drop more gear, so they roll the base chance more often.
let UNIQUE_DROP_CHANCE = config.drops.unique;
let CHEST_UNIQUE_CHANCE = config.drops.chestUnique;
// Artificer service costs (flat, predictable): reroll an item's affixes for gold + a rune shard;
// pop a socketed gem back to the bag for gold.
export let ARTIFICER_REROLL_GOLD = config.economy.artificerRerollGold;
export let ARTIFICER_UNSOCKET_GOLD = config.economy.artificerUnsocketGold;
const DASH_MS = 300; // how long a charger's lunge lasts

// Living loot meta â€” a "hunting bounty" per monster type that regenerates while it is left alone and
// is consumed on a kill, so the first kills after a lull are richer and spam-farming yields base loot.
let BOUNTY_FULL_MS = config.bounty.fullMs; // a minute untouched = a full bounty
let BOUNTY_MAX_CHANCE = config.bounty.maxChance; // bonus-drop chance at a full bounty

// Extra corrupted-gear sources independent of the area's corruption level: a slim chance from
// invasion champions, and an even slimmer chance from bosses (below the ~0.43% legendary rate).
let INVASION_CORRUPT_CHANCE = config.bounty.invasionCorruptChance;
let BOSS_CORRUPT_CHANCE = config.bounty.bossCorruptChance;

// Spellbook drops: spells are loot. An independent per-kill roll (separate from gear/materials)
// drops a random tome â€” the exciting acquisition path beside the deterministic vendor shelf.
// Tuned to ~1â€“2 books per play-hour in level-appropriate content (PoE2 uncut-gem model).
let SPELLBOOK_DROP_NORMAL = config.drops.spellbookNormal; // 0.4% per ordinary kill (1 in 250)
let SPELLBOOK_DROP_ELITE = config.drops.spellbookElite; // 3% per champion
let SPELLBOOK_DROP_BOSS = config.drops.spellbookBoss; // 30% per area boss

// Gem drops: more common than spellbooks (they stack into sockets, a smaller per-item bonus).
let GEM_DROP_NORMAL = config.drops.gemNormal; // 2% per ordinary kill
let GEM_DROP_ELITE = config.drops.gemElite; // 12% per champion
let GEM_DROP_BOSS = config.drops.gemBoss; // 60% per area boss

// Health-globe drops (D3): a slain monster may spill a globe that instant-heals on pickup.
let HEALTH_GLOBE_NORMAL = config.drops.healthGlobeNormal; // 1.5% per ordinary kill
let HEALTH_GLOBE_ELITE = config.drops.healthGlobeElite; // 10% per champion
let HEALTH_GLOBE_BOSS = config.drops.healthGlobeBoss; // 50% per area boss
let GLOBE_HEAL_FRAC = config.globes.healFrac; // fraction of the picker's max HP restored
let GLOBE_ALLY_HEAL_FRAC = config.globes.allyHealFrac; // fraction nearby allies also get
let GLOBE_ALLY_RADIUS = config.globes.allyRadius; // how close an ally must be to share the heal

/** Reserved ground-item id for a health globe — handled specially on pickup (heals, never bagged). */
const HEALTH_GLOBE_ITEM = 'healthglobe';

/** Per-tier monster outgoing-damage cap (deeper rifts hit harder; tier 0 unchanged). */
let DAMAGE_LEVEL_CAP = config.difficulty.damageLevelCap;

// How often a support-caster monster may re-cast its self-buff/heal (War Cry / Sprint / Renew).
const MOB_SUPPORT_COOLDOWN_MS = 7000;

/** Minimum milliseconds between successive orbit hits on the same mob (prevents per-tick spam). */
const ORBIT_REHIT_MS = 350;

// Vendor stock: spell prices are scaled up (a gold sink that keeps drops the exciting path), and a
// vendor shows only a rotating WINDOW of its tomes so the shop never overflows the UI. The window
// advances on a sim-time bucket, so the spell selection rotates over the session.
let VENDOR_PRICE_MULT = config.economy.vendorPriceMult;
let VENDOR_STOCK_CAP = config.economy.vendorStockCap;
let VENDOR_ROTATE_MS = config.economy.vendorRotateMs; // ~4 minutes per rotation

// Elite ("champion") monsters: a small chance to spawn a beefed-up variant with a flavor modifier.
// The modifier roster itself is data-driven (the `elite_modifiers` content table); createMob reads
// it via getContent().eliteModifiers(). Only the spawn CHANCE is bound here from config.
let ELITE_CHANCE = config.difficulty.eliteChance;

/**
 * Re-read the runtime-tunable knobs from the live `config` object. The values above are bound
 * once at module load; the Dev engine panel mutates `config` and then calls this so the change
 * takes effect immediately (numbers are read per-use by the sim). Keep this in sync with the
 * `let` bindings — anything the engine config editor exposes must be refreshed here.
 */
export function applyRuntimeConfig(): void {
  ITEM_TTL_MS = config.items.itemTtlMs;
  RIFT_COST_PER_TIER = config.economy.riftCostPerTier;
  MAX_BAG_GEAR = config.items.maxBagGear;
  STASH_CAP = config.items.stashCap;
  CHEST_GOLD_MIN = config.economy.chestGoldMin;
  CHEST_GOLD_MAX = config.economy.chestGoldMax;
  POT_GOLD_MIN = config.economy.potGoldMin;
  POT_GOLD_MAX = config.economy.potGoldMax;
  MOB_DMG_TUNING = config.difficulty.mobDamage;
  MOB_HP_TUNING = config.difficulty.mobHp;
  MOB_AGGRO_TUNING = config.difficulty.mobAggro;
  LEVEL_HP_SCALE = config.difficulty.levelHpScale;
  COOP_DAMAGE_PER_PLAYER = config.coop.damagePerPlayer;
  COOP_DAMAGE_CAP = config.coop.damageCap;
  COOP_GOLD_PER_PLAYER = config.coop.goldPerPlayer;
  COOP_GOLD_CAP = config.coop.goldCap;
  DENSITY_PER_PLAYER = config.density.perPlayer;
  DENSITY_CAP = config.density.cap;
  DENSITY_TOPUP_PER_CALL = config.density.topupPerCall;
  POTION_CAP = config.potions.cap;
  POTION_START = config.potions.start;
  POTION_HEAL = config.potions.heal;
  POTION_MANA = config.potions.mana;
  POTION_COOLDOWN_MS = config.potions.cooldownMs;
  SKILL_POINTS_PER_LEVEL = config.progression.skillPointsPerLevel;
  UNIQUE_DROP_CHANCE = config.drops.unique;
  CHEST_UNIQUE_CHANCE = config.drops.chestUnique;
  ARTIFICER_REROLL_GOLD = config.economy.artificerRerollGold;
  ARTIFICER_UNSOCKET_GOLD = config.economy.artificerUnsocketGold;
  BOUNTY_FULL_MS = config.bounty.fullMs;
  BOUNTY_MAX_CHANCE = config.bounty.maxChance;
  INVASION_CORRUPT_CHANCE = config.bounty.invasionCorruptChance;
  BOSS_CORRUPT_CHANCE = config.bounty.bossCorruptChance;
  SPELLBOOK_DROP_NORMAL = config.drops.spellbookNormal;
  SPELLBOOK_DROP_ELITE = config.drops.spellbookElite;
  SPELLBOOK_DROP_BOSS = config.drops.spellbookBoss;
  GEM_DROP_NORMAL = config.drops.gemNormal;
  GEM_DROP_ELITE = config.drops.gemElite;
  GEM_DROP_BOSS = config.drops.gemBoss;
  HEALTH_GLOBE_NORMAL = config.drops.healthGlobeNormal;
  HEALTH_GLOBE_ELITE = config.drops.healthGlobeElite;
  HEALTH_GLOBE_BOSS = config.drops.healthGlobeBoss;
  GLOBE_HEAL_FRAC = config.globes.healFrac;
  GLOBE_ALLY_HEAL_FRAC = config.globes.allyHealFrac;
  GLOBE_ALLY_RADIUS = config.globes.allyRadius;
  DAMAGE_LEVEL_CAP = config.difficulty.damageLevelCap;
  VENDOR_PRICE_MULT = config.economy.vendorPriceMult;
  VENDOR_STOCK_CAP = config.economy.vendorStockCap;
  VENDOR_ROTATE_MS = config.economy.vendorRotateMs;
  ELITE_CHANCE = config.difficulty.eliteChance;
}

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
  /** This character's stash capacity — starts at the base and grows via banker expansions (persisted). */
  stashCap: number;
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
  /** GM debug speed multiplier (the `/speed` command); 1 = normal. Folds into playerMoveMul so the
   *  client predictor (which reads the reported moveMul) stays in sync — no rubber-banding. */
  debugSpeed: number;
  /** Incoming-damage multiplier from +fragile (raises it) and +armor (lowers it); floored. */
  damageTakenMult: number;
  /** Bonus HP regenerated per second from +vigor affixes (added to base regen). */
  vigor: number;
  /** Extra projectile chain bounces (from 'chain' gems). */
  chainAdd: number;
  /** Extra pierce-through count (from 'pierce' gems). */
  pierceAdd: number;
  /** Extra fork splits on projectile hit (from 'fork' gems). */
  forkAdd: number;
  /** Spell AoE radius bonus (from 'spellaoe' gems). */
  spellAoe: number;
  /** Extra homing projectile count (reserved for future homing gem; init 0). */
  homingAdd: number;
  /** Multiplicative spell-damage bonus (1 = no change; increased by spell-damage gems). */
  spellDamageMult: number;
  /** Per-element bonus damage percent (from elemental-damage affixes; Slice 4). */
  elemDamage: Record<DamageElement, number>;
  /** Percent of enemy resistance ignored (from +penetration affixes; Slice 4). */
  penetration: number;
  /** Percent bonus to ailment duration (from +ailmentdur affixes; Slice 4). */
  ailmentDuration: number;
  /** Percent bonus to ailment magnitude (from +ailmentmag affixes; Slice 4). */
  ailmentMagnitude: number;
  /** Bonus mana/sec from the Energy attribute (added to base mana regen). */
  manaRegenBonus: number;
  /** Item procs from equipped gear (rebuilt in recomputeStats; chance-on-hit/crit effects). */
  procs: ProcDef[];
  /** Per-proc internal-cooldown clocks (procId → next-ready sim time). Persists across recomputes. */
  procIcd: Map<string, number>;
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
  /** Unlocked achievement ids (milestone dedupe key; persisted in the save). */
  earnedAchievements: Set<string>;
  /** Lifetime monster kills credited to this character (persisted; drives achievements + ladder). */
  kills: number;
  /** Lifetime boss-tier kills (hp >= 200; persisted) — drives the boss-slayer achievements. */
  bossKills: number;
  /** Distinct monster template ids this character has killed — the bestiary (persisted). */
  bestiary: Set<string>;
  /** Kills since the last death — the current deathless streak (reset to 0 on death; persisted). */
  deathlessStreak: number;
  /** The best deathless streak ever reached (a permanent record; drives the streak ladder). */
  bestDeathlessStreak: number;
  /** Learned spells: ability id -> rank (1..MAX_SPELL_RANK). Casting is gated on this. */
  known: Map<AbilityId, number>;
  /** Area ids this character has visited â€” the waypoint fast-travel list. */
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
  /** Mercenary contract (hired at the Recruiter). Null = none; voided when the hireling dies. */
  hireling: { type: string } | null;
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
  /** Banked stash gear (absent on pre-stash saves â€” defaults to empty). */
  stash?: ItemInstance[];
  /** Stash capacity (absent on pre-expansion saves — defaults to the base cap). */
  stashCap?: number;
  /** Potion belt counts (absent on pre-potion saves â€” defaults to the starting amount). */
  potions?: { health: number; mana: number };
  /** Allocated attributes (absent on pre-attribute saves â€” granted retroactively on load). */
  attributes?: AttributeSet;
  /** Unspent attribute points (absent on old saves). */
  attrPoints?: number;
  /** Allocated skill-tree node ids (absent on pre-skill saves). */
  skills?: string[];
  /** Unspent skill points (absent on old saves â€” granted retroactively on load). */
  skillPoints?: number;
  /** Equipped gear by doll slot; partial-friendly so older saves migrate cleanly. */
  equipment: Record<string, ItemInstance | null>;
  god: boolean;
  quests: [string, number][];
  questsDone: string[];
  /** Unlocked achievement ids (absent on pre-achievement saves — defaults to empty). */
  earnedAchievements?: string[];
  /** Lifetime monster kills (absent on old saves — defaults to 0). Drives kill achievements + ladder. */
  kills?: number;
  /** Lifetime boss-tier kills (absent on old saves — defaults to 0). */
  bossKills?: number;
  /** Distinct monster template ids killed — the bestiary (absent on old saves — defaults to empty). */
  bestiary?: string[];
  /** Current deathless streak (kills since last death; absent on old saves — defaults to 0). */
  deathlessStreak?: number;
  /** Best deathless streak ever reached (absent on old saves — defaults to the current streak). */
  bestDeathlessStreak?: number;
  /** Learned spells (id -> rank). Absent in pre-spellbook saves; those grandfather to all spells. */
  known?: [string, number][];
  /** Visited area ids (waypoints). Absent on old saves â€” the current area is added on load. */
  discovered?: string[];
  /** Mercenary contract; the hireling respawns beside the player in the destination instance. */
  hireling?: { type: string } | null;
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
  /** Every player who has damaged this mob — all taggers share full kill credit (co-op,
   *  no last-hit tax), and the client marks a tagged mob so others know it's claimed. */
  taggers: Set<number>;
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
  /** Spawned by an invasion event â€” its drops carry a slim corrupted-gear chance. */
  invader: boolean;
  /** Sim time (ms) until which this mob is ALERTED (hurt, or a packmate called for help) â€”
   *  alerted mobs hunt with greatly extended aggro reach instead of idling. */
  alertUntil: number;
  /** Apex-boss phase-script cursor (only set for templates in BOSS_SCRIPTS). */
  bossScript?: BossScriptState;
  /** Sim time (ms) a scripted boss's current fight began (first player hit), for soft-enrage. */
  engagedAt?: number;
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
  /** True for an enemy (mob) projectile â€” it damages players instead of mobs. */
  hostile: boolean;
  /** Effective behavior list resolved at spawn (ability behaviors; + player modifiers in Slice 2). */
  behaviors: BehaviorSpec[];
  /** Mob ids already damaged — never double-hit on pierce/chain. */
  hitMobs: Set<number>;
  bouncesLeft: number;
  piercesLeft: number;
  forksLeft: number;
  /** Running falloff multiplier applied to damage (1 at spawn). */
  damageScale: number;
  /** `homing` acquisition (mob id), if any. */
  homingTargetId?: number;
  /** `return` latch — set once the projectile has reversed. */
  returned?: boolean;
  /** Current angle (radians) for orbit projectiles; set at spawn, advanced each tick. */
  orbitAngle?: number;
  /** Per-mob re-hit gate for orbit projectiles: mobId → sim-time (ms) it may be hit again. */
  orbitHits?: Map<number, number>;
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

type NpcKind =
  | 'vendor'
  | 'questgiver'
  | 'healer'
  | 'gambler'
  | 'artificer'
  | 'banker'
  | 'recruiter'
  | 'riftkeeper';

interface Npc {
  id: number;
  name: string;
  x: number;
  y: number;
  hue: number;
  kind: NpcKind;
  /** Bitmask of {@link NpcFlags} — the services this NPC offers (drives E-key interaction). */
  flags: number;
}

/** A live mercenary entity: follows its owner, fights monsters, dies (voiding the contract). */
interface Hireling {
  id: number;
  ownerId: number;
  template: HirelingTemplate;
  x: number;
  y: number;
  facing: number;
  hp: number;
  maxHp: number;
  level: number;
  power: number;
  attackCd: number;
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
  private procDepth = 0; // recursion guard: a fired proc's own damage must not itself proc
  // Liveops XP multiplier from active timed game-events. Injected by the host each tick (the schedule
  // is wall-clock-ish and computed OUTSIDE the sim to keep the World deterministic); 1 = no event.
  private xpEventMult = 1;
  // Liveops GOLD-drop multiplier from active timed game-events (e.g. Golden Hour). Host-injected like
  // xpEventMult; folded into every gold drop. 1 = no event.
  private goldEventMult = 1;
  // Active player-to-player trades, keyed by EACH participant's id (both map to the same session).
  // One trade per player. The negotiation logic is the pure trade.ts state machine; the World owns
  // the inventory transfer + re-validation at commit (security-critical).
  private readonly tradeSessions = new Map<number, TradeSession>();
  // Shrines for this area, lazily built from the area's 'shrine' decor (null = not yet built).
  private shrines: { x: number; y: number; readyAt: number }[] | null = null;
  // Solid colliders for this area — rects (house walls, cliffs, ridges, barriers) AND circles
  // (round terrain: mountains, boulders). Lazily built from decor (null = not yet built).
  private blockerCache: Blockers | null = null;
  // Lootable chests for this area, lazily built from 'chest' decor (null = not yet built).
  private chests: { id: number; x: number; y: number; opened: boolean }[] | null = null;
  // Breakable pots for this area, lazily built from 'pot' decor (null = not yet built).
  private pots: { id: number; x: number; y: number; broken: boolean }[] | null = null;
  // Den entrances (cellar hatches under houses + hidden dens in the wild), rolled per instance
  // (null = not yet built). Stepping onto one descends into a fresh private mini-dungeon.
  private dens: { id: number; x: number; y: number; name: string }[] | null = null;
  /** Pending den descents for the host to resolve (instance transfer is host-level). */
  private denEntries: { playerId: number }[] = [];
  /** Players already queued for a descent this drain cycle (no double-fires while standing). */
  private readonly denPending = new Set<number>();

  private readonly players = new Map<number, Player>();
  private readonly mobs = new Map<number, Mob>();
  private readonly hirelings = new Map<number, Hireling>();
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
  /** Pending hire windows to deliver (player just interacted with a recruiter NPC). */
  private hireOffers: {
    playerId: number;
    offers: { type: string; name: string; cost: number }[];
  }[] = [];
  /** Pending rift windows to deliver (player just interacted with the Riftkeeper). */
  private riftOffers: { playerId: number; maxTier: number; costBase: number }[] = [];
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
    /** Rift difficulty tier (0 = a normal area). Scales monster level/HP/damage/density. */
    private readonly tier = 0,
    /** Instance seed: every roll inside the sim flows from it, so a recorded seed reproduces
     *  the exact layout/loot rolls (bug repros, deterministic tests, future daily seeds). */
    readonly seed: number = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0,
  ) {
    this.allocId = allocId ?? (() => this.localId++);
    this.areaId = areaId;
    this.areaCorruption = areaCorruption ?? new AreaCorruption();
    this.rand = mulberry32(this.seed);
    // Rift modifiers: a tiered rift rolls named mutators (D3-style). Rolled from a DERIVED seed so it
    // never disturbs the main spawn/loot rng — same rift seed ⇒ same modifiers. Tier 0 = none (the
    // effects stay the neutral identity, so ordinary areas are completely unaffected).
    if (this.tier > 0) {
      const modRng = mulberry32((this.seed + 0x9e3779b9) >>> 0);
      this.riftModifiers = rollRiftModifiers(this.tier, modRng, 2, getContent().riftModifiers());
      this.riftEffects = aggregateRiftEffects(this.riftModifiers);
    }
  }

  /** The named rift mutators rolled for this instance (empty for a non-rift area). */
  readonly riftModifiers: RiftModifierDef[] = [];
  /** Aggregated rift-modifier effects, applied at mob spawn + reward sites; identity for tier 0. */
  private riftEffects: RiftEffects = {
    mobDamageMult: 1,
    mobHpMult: 1,
    mobSpeedMult: 1,
    lootQuantityBonus: 0,
    xpBonus: 0,
  };

  /** The instance's seeded RNG â€” the only randomness source inside the simulation. */
  private readonly rand: () => number;

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
    const mods = getContent().weatherMods(weather);
    this.moveScale = mods.moveScale;
    this.aggroScale = mods.aggroScale;
  }

  /** Populate the area's monsters. Called once by the instance manager after construction. */
  populateMobs(areaId: string): void {
    // Dungeons are populated procedurally (random pack, elevated elites, a boss) â€” not from the
    // fixed area_mobs roster. Each instance is a fresh roll, so re-entering re-rolls the dungeon.
    const dungeon = getContent().dungeon(areaId);
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
    // Explicit per-spawn placements (uid rows): fixed position + per-spawn flags (e.g. forced elite).
    for (const spawn of content.creatureSpawns(areaId)) {
      const template = content.mobTemplate(spawn.templateId);
      if (!template) continue;
      this.createMob(
        template,
        spawn.x,
        spawn.y,
        hasSpawnFlag(spawn.flags, CreatureSpawnFlags.ELITE),
      );
    }
  }

  /**
   * Keep a crowded overworld area populated: a flood of players clears mobs far faster than the
   * respawn timer refills, starving everyone of targets. This tops the roster up toward a target
   * that SCALES with the living-player count — so 50 players in one zone find ~5× the monsters a
   * soloist does, not the same thin handful fought to extinction. No-op for dungeons (fixed
   * procedural rolls), the den, and quiet/solo instances. Called on a host interval, not per tick.
   */
  maintainDensity(): void {
    if (getContent().isDungeon(this.areaId) || this.areaId === 'den') return;
    const roster = getContent()
      .areaMobs(this.areaId)
      .map((s) => ({ t: getContent().mobTemplate(s.templateId), n: s.count }))
      .filter((r): r is { t: MobTemplate; n: number } => !!r.t);
    if (roster.length === 0) return; // safe zones (town/villages) stay empty

    const players = [...this.players.values()].filter((p) => !p.dead).length;
    if (players <= 1) return; // solo instances ride the normal respawn loop untouched
    const base = roster.reduce((s, r) => s + r.n, 0);
    // Each extra player adds DENSITY_PER_PLAYER worth of mobs, capped so a mega-crowd doesn't
    // carpet the map (the same per-extra-player scaling shape as co-op damage/gold). The roster
    // count is already world-scaled (×10) at content load.
    const target = Math.round(base * coopScale(players, DENSITY_PER_PLAYER, DENSITY_CAP));
    let living = 0;
    for (const m of this.mobs.values()) if (!m.dead) living++;
    let toSpawn = Math.min(target - living, DENSITY_TOPUP_PER_CALL);
    while (toSpawn-- > 0) {
      // Weighted pick by roster count, so common roster mobs stay common in the top-up.
      let roll = this.rand() * base;
      let pick = roster[0]!.t;
      for (const r of roster) {
        roll -= r.n;
        if (roll <= 0) {
          pick = r.t;
          break;
        }
      }
      this.createMob(pick, this.randomMobX(), this.randomMobY());
    }
  }

  /** A random in-bounds spawn x/y, kept off the very edges so mobs aren't born in a wall. */
  private randomMobX(): number {
    return 80 + this.rand() * (this.width - 160);
  }
  private randomMobY(): number {
    return 80 + this.rand() * (this.height - 160);
  }

  /**
   * Roll a procedural dungeon: a random-sized pack drawn (with replacement) from the dungeon's pool
   * at random positions and an elevated elite chance, plus the boss once and â€” sometimes â€” a bonus
   * champion mini-boss. Mirrors the Diablo "every run is different" feel.
   */
  private populateDungeon(d: DungeonDef): void {
    const content = getContent();
    // A rift tier packs the dungeon denser and rolls champions far more often â€” risk and reward
    // both ramp with the tier the player chose at the Riftkeeper. The flat Ã—8 matches the
    // world-scale roster bump (the floor is 25Ã— the ground; the packs grow with it).
    const density = 8 * (1 + 0.15 * this.tier);
    const eliteChance = Math.min(0.6, d.eliteChance + 0.03 * this.tier);
    const base = d.minMobs + Math.floor(this.rand() * (d.maxMobs - d.minMobs + 1));
    const count = Math.round(base * density);
    for (let i = 0; i < count; i++) {
      const id = d.pool[Math.floor(this.rand() * d.pool.length)];
      const template = id ? content.mobTemplate(id) : undefined;
      if (template)
        this.createMob(template, this.randomMobX(), this.randomMobY(), false, false, eliteChance);
    }
    const boss = content.mobTemplate(d.boss);
    if (boss) this.createMob(boss, this.width / 2, this.height * 0.62);
    if (d.miniBoss && this.rand() < d.miniBossChance) {
      const mini = content.mobTemplate(d.miniBoss);
      if (mini) this.createMob(mini, this.randomMobX(), this.randomMobY());
    }
  }

  /**
   * Spawn a sudden invasion wave: `count` forced-elite monsters drawn from the area's roster, ringed
   * around a random living player â€” a spontaneous raid. Returns false if there's no one to invade.
   */
  spawnInvasion(areaId: string, count: number): boolean {
    const content = getContent();
    const alive = [...this.players.values()].filter((p) => !p.dead);
    const templates = content
      .areaMobs(areaId)
      .map((s) => content.mobTemplate(s.templateId))
      .filter((t): t is MobTemplate => !!t && t.hp < 200);
    if (alive.length === 0 || templates.length === 0) return false;
    const anchor = alive[Math.floor(this.rand() * alive.length)]!;
    for (let i = 0; i < count; i++) {
      const t = templates[Math.floor(this.rand() * templates.length)]!;
      const ang = this.rand() * Math.PI * 2;
      const r = 170 + this.rand() * 130;
      this.createMob(
        t,
        clamp(anchor.x + Math.cos(ang) * r, 0, this.width),
        clamp(anchor.y + Math.sin(ang) * r, 0, this.height),
        true, // forced elite
        true, // invader â†’ slim corrupted-drop chance
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
    // HP) never roll elite â€” they are already special. Invasions force the elite flag. Dungeons pass
    // an elevated eliteChance, so tougher champions show up far more often inside them.
    const isBoss = template.hp >= 200;
    const elite = !isBoss && (forceElite || this.rand() < eliteChance);
    const eliteMods = getContent().eliteModifiers();
    const mod = elite ? (eliteMods[Math.floor(this.rand() * eliteMods.length)] ?? null) : null;
    // Rift tier scaling: every spawn levels up (more XP per kill) and hits/lives harder.
    const tierHp = 1 + 0.35 * this.tier;
    const tierDmg = 1 + 0.18 * this.tier;
    // Per-level HP scaling: player attack power climbs fast (gear + strength + skill nodes), so
    // without this a mid-level mob dies in one hit and the danger evaporates. Scaling HP with the
    // template's level keeps same-level fights at several hits — and makes the apex bosses tanky.
    const levelHp = 1 + LEVEL_HP_SCALE * template.level;
    const hp = Math.round(
      (mod ? template.hp * mod.hp : template.hp) *
        tierHp *
        this.riftEffects.mobHpMult *
        MOB_HP_TUNING *
        levelHp,
    );
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
      level: template.level + this.tier * 2,
      attackCd: 0,
      wanderAngle: null,
      wanderUntil: 0,
      statuses: new StatusSet(),
      lastAttacker: 0,
      taggers: new Set(),
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
      dmgMult: (mod ? mod.dmg : 1) * tierDmg * this.riftEffects.mobDamageMult,
      spdMult: (mod ? mod.spd : 1) * this.riftEffects.mobSpeedMult,
      invader,
      alertUntil: 0,
    });
  }

  /** Place static NPCs for the area (from the content DB). Called once after construction. */
  populateNpcs(areaId: string): void {
    const KINDS: NpcKind[] = [
      'vendor',
      'questgiver',
      'healer',
      'gambler',
      'artificer',
      'banker',
      'recruiter',
      'riftkeeper',
    ];
    for (const npc of getContent().npcs(areaId)) {
      const id = this.allocId();
      const kind = (KINDS as string[]).includes(npc.kind) ? (npc.kind as NpcKind) : 'vendor';
      this.npcs.set(id, {
        id,
        name: npc.name,
        x: npc.x,
        y: npc.y,
        hue: npc.hue,
        kind,
        flags: npc.flags,
      });
    }
  }

  /** Interact with the nearest in-range NPC: vendor shop, quest-giver, healer, or gambler. */
  interact(id: number): void {
    const player = this.players.get(id);
    if (!player || player.dead) return;
    const npc = this.nearbyNpc(player);
    if (!npc) return;
    if (hasNpcFlag(npc.flags, NpcFlags.VENDOR)) {
      // Open the shop; selling is now an explicit button, never a destructive side effect of E.
      this.shopOffers.push({
        playerId: player.id,
        vendor: npc.name,
        stock: this.vendorStockFor(npc.name),
      });
    } else if (hasNpcFlag(npc.flags, NpcFlags.HEALER)) {
      this.healAtNpc(player, npc.name);
    } else if (hasNpcFlag(npc.flags, NpcFlags.GAMBLER)) {
      this.gambleOffers.push({ playerId: player.id, cost: gambleCost(player.level) });
    } else if (hasNpcFlag(npc.flags, NpcFlags.ARTIFICER)) {
      this.artificerOffers.push({ playerId: player.id });
    } else if (hasNpcFlag(npc.flags, NpcFlags.BANKER)) {
      this.pushStash(player); // open the stash window with the current contents
    } else if (hasNpcFlag(npc.flags, NpcFlags.RECRUITER)) {
      const cost = hirelingCost(player.level);
      this.hireOffers.push({
        playerId: player.id,
        offers: Object.values(HIRELING_TEMPLATES).map((t) => ({
          type: t.type,
          name: t.name,
          cost,
        })),
      });
    } else if (hasNpcFlag(npc.flags, NpcFlags.RIFTKEEPER)) {
      this.riftOffers.push({
        playerId: player.id,
        maxTier: maxRiftTier(player.level),
        costBase: RIFT_COST_PER_TIER,
      });
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

  /** Dev (engine panel): fully restore a living player's HP and mana. */
  devHeal(id: number): boolean {
    const player = this.players.get(id);
    if (!player || player.dead) return false;
    player.hp = player.maxHp;
    player.mana = PLAYER_MAX_MANA;
    return true;
  }

  /**
   * Dev/QA loot showcase: drop a curated spread of ground loot around the player so the loot
   * visuals (rarity glints, top-tier name labels) and the health-globe pickup/heal can be verified
   * in one frame — a guaranteed unique and a corrupted piece (always labeled), several random gear
   * rolls (a glint spread), and a health globe at the player's feet. The player is left lightly
   * wounded so grabbing the globe fires the heal floater. Returns the number of items dropped.
   */
  devLootShowcase(id: number): number {
    const player = this.players.get(id);
    if (!player || player.dead) return 0;
    let n = 0;
    // A wide horizontal row south of the player. X spacing is generous (the tilted projection
    // compresses Y, not X) so each drop's glint + label reads without overlapping its neighbor or
    // the character.
    const place = (k: number) => ({ x: player.x + (k - 2.5) * 96, y: player.y + 150 });

    const unique = getContent().rollRandomUnique(this.allocId());
    if (unique) {
      this.dropGround(unique.baseId, 1, place(0).x, place(0).y).instance = unique;
      n++;
    }
    const corruptBase = this.randomEquipBase();
    if (corruptBase) {
      const corrupt = rollCorruptedInstance(this.allocId(), corruptBase);
      this.dropGround(corruptBase.id, 1, place(1).x, place(1).y).instance = corrupt;
      n++;
    }
    for (let k = 2; k < 6; k++) {
      const base = this.randomEquipBase();
      if (!base) continue;
      const inst = rollItemInstance(this.allocId(), base, this.rand, 1);
      this.dropGround(base.id, 1, place(k).x, place(k).y).instance = inst;
      n++;
    }
    // A health globe a little further south — far enough to sit on the ground (not auto-collected),
    // so it's visible until the player walks onto it — and a wound so the pickup heals (floats a +N).
    this.dropItemAt(HEALTH_GLOBE_ITEM, 1, player.x, player.y + 170);
    n++;
    player.hp = Math.max(1, Math.round(player.maxHp * 0.4));
    return n;
  }

  /**
   * Gamble gold for a random item of an equip slot (the D3-Kadala gold sink). Re-validates the
   * gambler is in range, the slot is real, and the player can afford the per-level cost.
   */
  gamble(id: number, slot: string): void {
    const player = this.players.get(id);
    if (!player || player.dead) return;
    const npc = this.nearbyNpc(player);
    if (!npc || !hasNpcFlag(npc.flags, NpcFlags.GAMBLER)) return;
    const bases = this.equipBases();
    if (!isGambleSlot(slot, bases)) return;
    const cost = gambleCost(player.level);
    if (player.gold < cost) return;
    const inst = rollGamble(this.allocId(), slot, bases);
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

  /** Drain pending hire windows for the host to deliver as `hire_open` packets. */
  drainHireOffers(): {
    playerId: number;
    offers: { type: string; name: string; cost: number }[];
  }[] {
    const drained = this.hireOffers;
    this.hireOffers = [];
    return drained;
  }

  /** Drain pending rift windows for the host to deliver as `rift_open` packets. */
  drainRiftOffers(): { playerId: number; maxTier: number; costBase: number }[] {
    const drained = this.riftOffers;
    this.riftOffers = [];
    return drained;
  }

  /**
   * Validate and pay for opening a rift at a tier: requires Riftkeeper proximity, a tier within
   * the player's unlocked range, and the gold fee. Returns true when paid â€” the HOST then creates
   * the fresh rift instance and transfers the player (see InstanceManager.openRift).
   */
  payForRift(id: number, tier: number): boolean {
    const player = this.players.get(id);
    if (!player || player.dead) return false;
    const npc = this.nearbyNpc(player);
    if (!npc || !hasNpcFlag(npc.flags, NpcFlags.RIFTKEEPER)) return false;
    if (!Number.isInteger(tier) || tier < 1 || tier > maxRiftTier(player.level)) return false;
    const cost = tier * RIFT_COST_PER_TIER;
    if (player.gold < cost) {
      this.notify(player.id, `You need ${cost}g to open a tier ${tier} rift.`);
      return false;
    }
    player.gold -= cost;
    return true;
  }

  /**
   * Hire a mercenary at the Recruiter. Re-validates proximity, the type, and gold. Re-hiring
   * (after a death, or to switch types) replaces the current companion and costs the full fee.
   */
  hire(id: number, type: string): void {
    const player = this.players.get(id);
    if (!player || player.dead) return;
    const npc = this.nearbyNpc(player);
    if (!npc || !hasNpcFlag(npc.flags, NpcFlags.RECRUITER)) return;
    const template = hirelingTemplate(type);
    if (!template) return;
    const cost = hirelingCost(player.level);
    if (player.gold < cost) {
      this.notify(player.id, `You need ${cost}g to hire a ${template.name}.`);
      return;
    }
    player.gold -= cost;
    player.hireling = { type };
    this.despawnHirelingOf(player.id);
    this.spawnHireling(player);
    this.notify(player.id, `${template.name} hired â€” they will fight at your side.`);
  }

  /** Spawn the player's contracted hireling beside them (on hire, import, or area arrival). */
  private spawnHireling(player: Player): void {
    const template = player.hireling ? hirelingTemplate(player.hireling.type) : undefined;
    if (!template) return;
    const stats = hirelingStats(player.level);
    const id = this.allocId();
    this.hirelings.set(id, {
      id,
      ownerId: player.id,
      template,
      x: clamp(player.x + 26, 0, this.width),
      y: clamp(player.y + 10, 0, this.height),
      facing: 0,
      hp: stats.maxHp,
      maxHp: stats.maxHp,
      level: player.level,
      power: stats.power,
      attackCd: 0,
    });
  }

  /** Remove the live hireling entity owned by a player (on disconnect, transfer, or replace). */
  private despawnHirelingOf(ownerId: number): void {
    for (const h of this.hirelings.values()) {
      if (h.ownerId === ownerId) this.hirelings.delete(h.id);
    }
  }

  /** Queue the player's current stash contents to be sent as a `stash` packet. */
  private pushStash(player: Player): void {
    this.stashOffers.push({ playerId: player.id, items: player.stash });
  }

  /** Gold to buy the NEXT stash expansion for this character, or 0 once fully expanded. */
  private nextStashExpandCost(p: Player): number {
    const bought = Math.round((p.stashCap - STASH_CAP) / STASH_EXPAND_STEP);
    return bought >= STASH_MAX_EXPANSIONS ? 0 : (bought + 1) * STASH_EXPAND_COST;
  }

  /** Drain pending stash windows for the host to deliver as `stash` packets (cap + next expand cost). */
  drainStashOffers(): {
    playerId: number;
    items: ItemInstance[];
    cap: number;
    expandCost: number;
  }[] {
    const drained = this.stashOffers.map((o) => {
      const p = this.players.get(o.playerId);
      return {
        ...o,
        cap: p?.stashCap ?? STASH_CAP,
        expandCost: p ? this.nextStashExpandCost(p) : 0,
      };
    });
    this.stashOffers = [];
    return drained;
  }

  /** Banker: deposit a bag gear instance into the stash. Requires banker proximity + stash room. */
  depositToStash(id: number, uid: number): void {
    const player = this.players.get(id);
    if (!player || player.dead) return;
    if (!hasNpcFlag(this.nearbyNpc(player)?.flags ?? 0, NpcFlags.BANKER)) return;
    if (player.stash.length >= player.stashCap) {
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
    if (!hasNpcFlag(this.nearbyNpc(player)?.flags ?? 0, NpcFlags.BANKER)) return;
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
   * Banker: buy another block of stash slots for gold. Requires banker proximity. The cost escalates
   * with each block already purchased, and the stash can be expanded at most STASH_MAX_EXPANSIONS
   * times. Server-authoritative: validates proximity, the cap ceiling, and gold before mutating.
   */
  expandStash(playerId: number): { ok: boolean; message: string } {
    const player = this.players.get(playerId);
    if (!player || player.dead) return { ok: false, message: 'No character.' };
    if (!hasNpcFlag(this.nearbyNpc(player)?.flags ?? 0, NpcFlags.BANKER)) {
      return { ok: false, message: 'Visit a Banker to expand your stash.' };
    }
    const cost = this.nextStashExpandCost(player);
    if (cost === 0) {
      return {
        ok: false,
        message: `Your stash is already fully expanded (${player.stashCap} slots).`,
      };
    }
    if (player.gold < cost) {
      return { ok: false, message: `Expanding costs ${cost}g — you only have ${player.gold}g.` };
    }
    player.gold -= cost;
    player.stashCap += STASH_EXPAND_STEP;
    this.pushStash(player); // refresh the open panel with the new cap
    return { ok: true, message: `Stash expanded to ${player.stashCap} slots for ${cost}g.` };
  }

  /** Abstract salvage material kind → the concrete content loot item id it grants. */
  private static readonly SALVAGE_ITEM_ID: Record<MaterialKind, string> = {
    scrap: 'mat_scrap',
    dust: 'mat_dust',
    essence: 'mat_essence',
    shard: 'rune_shard', // the top tier reuses the existing rune-shard material
  };

  /**
   * Salvage a BAG gear instance into crafting materials (D2-cube disenchant). Only unequipped bag
   * items qualify (equipped gear lives in `equipment`, never found here). Deterministic via the
   * world rng. Returns the materials granted, or a reason it failed.
   */
  salvage(
    playerId: number,
    uid: number,
  ): { ok: boolean; reason?: string; yields?: MaterialYield[] } {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'No such player.' };
    const idx = player.gear.findIndex((g) => g.uid === uid);
    if (idx < 0) return { ok: false, reason: 'No such item in your bag.' };
    const [inst] = player.gear.splice(idx, 1);
    if (!inst) return { ok: false, reason: 'No such item.' };
    const yields = salvageYield(inst, this.rand);
    this.grantMaterials(player, yields);
    return { ok: true, yields };
  }

  /** Credit a bundle of salvage-material yields into a player's loot (the shared tail of both salvages). */
  private grantMaterials(player: Player, yields: readonly MaterialYield[]): void {
    for (const y of yields) {
      const itemId = World.SALVAGE_ITEM_ID[y.kind];
      player.loot.set(itemId, (player.loot.get(itemId) ?? 0) + y.qty);
    }
  }

  /**
   * Bulk-salvage every common/magic piece in the bag into materials, KEEPING rare and better gear so
   * the player can never accidentally shred a good drop. Returns the count salvaged and the combined
   * material yield. Server-authoritative; a no-op (ok:false) when there's no junk to break down.
   */
  salvageAll(playerId: number): {
    ok: boolean;
    reason?: string;
    count?: number;
    yields?: MaterialYield[];
  } {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'No such player.' };
    const JUNK = new Set(['common', 'magic']); // protect rare/epic/legendary/unique from bulk salvage
    const keep: ItemInstance[] = [];
    const totals = new Map<MaterialKind, number>();
    let count = 0;
    for (const inst of player.gear) {
      if (!JUNK.has(inst.rarity)) {
        keep.push(inst);
        continue;
      }
      for (const y of salvageYield(inst, this.rand)) {
        totals.set(y.kind, (totals.get(y.kind) ?? 0) + y.qty);
      }
      count += 1;
    }
    if (count === 0) return { ok: false, reason: 'No common or magic gear to salvage.' };
    player.gear = keep;
    const yields: MaterialYield[] = [...totals].map(([kind, qty]) => ({ kind, qty }));
    this.grantMaterials(player, yields);
    return { ok: true, count, yields };
  }

  /**
   * Craft a recipe: spend its material inputs from the player's loot for its outputs. The pure
   * applyCraft validates affordability + does the check-then-mutate spend (never partial/negative).
   * Returns whether it crafted; notifies the player either way. Recipe set is content-driven.
   */
  craft(playerId: number, recipeId: string): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;
    const recipe = getContent()
      .craftingRecipes()
      .find((r) => r.id === recipeId);
    if (!recipe) {
      this.notify(playerId, `Unknown recipe "${recipeId}".`);
      return false;
    }
    const have: Record<string, number> = Object.fromEntries(player.loot);
    if (!applyCraft(recipe, have)) {
      this.notify(playerId, `Not enough materials for ${recipe.name}.`);
      return false;
    }
    player.loot = new Map(Object.entries(have));
    this.notify(playerId, `Crafted: ${recipe.name}.`);
    return true;
  }

  /**
   * Sort the player's bag for display (slot group → best rarity → heavier roll → name). Pure ordering
   * lives in shared/bag-sort; here we just supply the content slot lookup and write the result back.
   * The next `you` packet ships the reordered bag, so the client updates with no extra message.
   */
  sortBag(playerId: number): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;
    const content = getContent();
    player.gear = sortBag(
      player.gear,
      (baseId) => content.item(baseId)?.slot ?? null,
      (inst) => content.item(inst.baseId)?.name ?? inst.baseId,
    );
    return true;
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
    if (!npc || !hasNpcFlag(npc.flags, NpcFlags.ARTIFICER)) return;
    const inst = player.gear.find((g) => g.uid === uid);
    if (!inst || (inst.affixes?.length ?? 0) === 0) return;
    if (player.gold < ARTIFICER_REROLL_GOLD || (player.loot.get('rune_shard') ?? 0) < 1) return;
    player.gold -= ARTIFICER_REROLL_GOLD;
    this.consumeLoot(player, 'rune_shard');
    inst.affixes = inst.rarity === 'corrupted' ? rollCorruptedAffixes() : rollAffixes(inst.rarity);
    this.notify(player.id, 'The Artificer reforges your gear â€” new powers emerge.');
  }

  /**
   * Artificer: pop the gem out of an equipped item's socket, returning it to the bag for gold.
   * Re-validates artificer proximity, the slot, and that the socket actually holds a gem.
   */
  unsocketGem(id: number, slot: string, index: number): void {
    const player = this.players.get(id);
    if (!player || player.dead) return;
    const npc = this.nearbyNpc(player);
    if (!npc || !hasNpcFlag(npc.flags, NpcFlags.ARTIFICER)) return;
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
   * Diablo gem-cube). Free â€” the gems are the cost. Upgrades the first eligible stack (stable order),
   * so repeated clicks work through a hoard. Re-validates artificer proximity server-side.
   */
  combineGems(id: number): void {
    const player = this.players.get(id);
    if (!player || player.dead) return;
    const npc = this.nearbyNpc(player);
    if (!npc || !hasNpcFlag(npc.flags, NpcFlags.ARTIFICER)) return;
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
   * vendor â€” the open shop panel on a client grants nothing; proximity is re-checked here.
   */
  sell(id: number): void {
    const player = this.players.get(id);
    if (!player || player.dead) return;
    const npc = this.nearbyNpc(player);
    if (!npc || !hasNpcFlag(npc.flags, NpcFlags.VENDOR)) return;
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
    if (!npc || !hasNpcFlag(npc.flags, NpcFlags.VENDOR)) return;
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
   * shop never overflows), with prices scaled up. The window advances on a sim-time bucket â€” the
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
   * bag. Auto-targets so it's a single tap â€” no fiddly drag/drop. Server-authoritative: the gem
   * must be held and a real gem, and there must be an open socket.
   */
  socketGem(id: number, gemId: string): void {
    const player = this.players.get(id);
    if (!player || player.dead) return;
    // Both gems and runes (for runewords) are socketable; both are held as stackable loot.
    if ((player.loot.get(gemId) ?? 0) <= 0 || (!isGem(gemId) && !rune(gemId))) return;
    // Find the first equipped piece with a free socket (stable slot order).
    for (const slot of EQUIP_SLOTS) {
      const inst = player.equipment[slot];
      if (!inst?.sockets) continue;
      const free = inst.sockets.indexOf(null);
      if (free >= 0) {
        inst.sockets[free] = gemId;
        this.consumeLoot(player, gemId);
        this.recomputeStats(player);
        const itemName = getContent().item(inst.baseId)?.name ?? slot;
        const rw = detectRuneword(inst.sockets);
        this.notify(
          player.id,
          rw
            ? `Runeword formed â€” ${rw.name} on your ${itemName}!`
            : `Socketed into your ${itemName}.`,
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
        ? `${next.description} (bring ${next.turnInCount} â€” turn in here)`
        : next.exploreArea
          ? `${next.description} (travel there to complete)`
          : next.description;
      this.notify(player.id, `Quest accepted: ${next.name} â€” ${ask}`);
      // An explore quest for an already-visited area completes the instant it is offered.
      if (next.exploreArea) this.progressExploreQuests(player);
      return;
    }
    const active = quests.find((q) => player.quests.has(q.id));
    if (active) {
      const got = active.turnInItem
        ? (player.loot.get(active.turnInItem) ?? 0)
        : active.exploreArea
          ? player.discovered.has(active.exploreArea)
            ? 1
            : 0
          : (player.quests.get(active.id) ?? 0);
      const need = active.turnInItem
        ? active.turnInCount
        : active.exploreArea
          ? 1
          : active.targetCount;
      this.notify(player.id, `In progress: ${active.name} (${Math.min(got, need)}/${need})`);
    } else {
      this.notify(player.id, 'No new quests right now â€” well done, adventurer.');
    }
  }

  /** Grant a quest's rewards, mark it done, and notify â€” shared by kill + collect completion. */
  private completeQuest(player: Player, quest: QuestDef): void {
    player.quests.delete(quest.id);
    // A repeatable quest is never marked permanently done, so it can be taken again.
    if (!hasQuestFlag(quest.flags, QuestFlags.REPEATABLE)) player.questsDone.add(quest.id);
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
    // A completion can cross a quest milestone (and the gold/xp reward a gold/level one).
    this.checkAchievements(player);
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

  /** Set the liveops XP multiplier (1 = none). Host-driven from active timed game-events; clamped >=0. */
  setXpEventMult(mult: number): void {
    this.xpEventMult = sanitizeEventMult(mult);
  }

  /** Set the liveops GOLD-drop multiplier (1 = none). Host-driven from active events; clamped >=0. */
  setGoldEventMult(mult: number): void {
    this.goldEventMult = sanitizeEventMult(mult);
  }

  // --- Player-to-player trading -----------------------------------------------------------
  // Negotiation is the pure trade.ts state machine (offers + the anti-scam "change voids confirms"
  // rule); the World owns proximity, the session registry, and the atomic re-validated swap.

  /** Max distance (px) between two players to open a trade — they must be near each other. */
  private static readonly TRADE_RANGE = 220;

  /**
   * Open a trade between two players in THIS instance. Both must exist, be alive, be within range,
   * and neither already be trading. Returns the outcome for the host to relay to the initiator.
   */
  startTrade(aId: number, bId: number): { ok: boolean; reason?: string } {
    if (aId === bId) return { ok: false, reason: 'You cannot trade with yourself.' };
    const a = this.players.get(aId);
    const b = this.players.get(bId);
    if (!a || !b || a.dead || b.dead) return { ok: false, reason: 'That player is not available.' };
    if (this.tradeSessions.has(aId) || this.tradeSessions.has(bId))
      return { ok: false, reason: 'One of you is already trading.' };
    if (Math.hypot(a.x - b.x, a.y - b.y) > World.TRADE_RANGE)
      return { ok: false, reason: 'You are too far apart to trade.' };
    const session = createTrade(aId, bId);
    if (!session) return { ok: false, reason: 'Could not open trade.' };
    this.tradeSessions.set(aId, session);
    this.tradeSessions.set(bId, session);
    return { ok: true };
  }

  /** Stage a player's offer (gold + bag-item uids). True if applied (host then re-broadcasts state). */
  tradeSetOffer(playerId: number, offer: TradeOffer): boolean {
    const s = this.tradeSessions.get(playerId);
    if (!s) return false;
    return tradeSetOfferPure(s, playerId, offer);
  }

  /**
   * Confirm a player's side. When BOTH have confirmed, atomically commit the swap (re-validating
   * ownership + gold + bag space) and tear the session down. Returns the resulting status so the
   * host knows whether to re-broadcast state ('updated') or close the window ('committed'/'failed').
   */
  tradeConfirm(playerId: number): 'updated' | 'committed' | 'failed' | 'none' {
    const s = this.tradeSessions.get(playerId);
    if (!s) return 'none';
    if (!tradeConfirmPure(s, playerId)) return 'failed';
    if (!bothConfirmed(s)) return 'updated';
    const plan = tradeCommitPure(s);
    const done = plan ? this.applyTradeCommit(plan) : false;
    this.endTradeFor(playerId);
    return done ? 'committed' : 'failed';
  }

  /** Cancel a player's active trade. Returns the OTHER participant's id (to notify), or undefined. */
  tradeCancel(playerId: number): number | undefined {
    const s = this.tradeSessions.get(playerId);
    if (!s) return undefined;
    const other = s.aId === playerId ? s.bId : s.aId;
    tradeCancelPure(s);
    this.endTradeFor(playerId);
    return other;
  }

  /** The current trade view for a participant (host sends it to BOTH sides after each change). */
  tradeStateFor(playerId: number):
    | {
        aId: number;
        bId: number;
        aOffer: TradeOffer;
        bOffer: TradeOffer;
        aConfirmed: boolean;
        bConfirmed: boolean;
      }
    | undefined {
    const s = this.tradeSessions.get(playerId);
    if (!s || !isParticipant(s, playerId)) return undefined;
    return {
      aId: s.aId,
      bId: s.bId,
      aOffer: s.aOffer,
      bOffer: s.bOffer,
      aConfirmed: s.aConfirmed,
      bConfirmed: s.bConfirmed,
    };
  }

  /** Both participant ids of a player's active trade (host uses it to message both), or undefined. */
  tradePartners(playerId: number): { aId: number; bId: number } | undefined {
    const s = this.tradeSessions.get(playerId);
    return s ? { aId: s.aId, bId: s.bId } : undefined;
  }

  /** Drop the session both participants share (commit/cancel/disconnect/death). Idempotent. */
  private endTradeFor(playerId: number): void {
    const s = this.tradeSessions.get(playerId);
    if (!s) return;
    this.tradeSessions.delete(s.aId);
    this.tradeSessions.delete(s.bId);
  }

  /**
   * Atomically apply a confirmed trade plan: re-validate that each side STILL owns every offered uid
   * (a BAG item) + has the gold + will fit the incoming items, then swap. SECURITY-CRITICAL — the
   * pure module can't see inventories, so a client could move/sell an item between confirm and
   * commit; we re-check here and abort the WHOLE trade on any failure (never a partial transfer).
   */
  private applyTradeCommit(plan: {
    aId: number;
    bId: number;
    toA: TradeOffer;
    toB: TradeOffer;
  }): boolean {
    const pa = this.players.get(plan.aId);
    const pb = this.players.get(plan.bId);
    if (!pa || !pb || pa.dead || pb.dead) return false;
    const aGives = plan.toB; // A's own offer → B receives it
    const bGives = plan.toA; // B's own offer → A receives it
    // Re-validate ownership: every offered uid must still be a BAG item of the giver.
    const aItems = aGives.itemUids.map((u) => pa.gear.find((g) => g.uid === u));
    const bItems = bGives.itemUids.map((u) => pb.gear.find((g) => g.uid === u));
    if (aItems.some((g) => g === undefined) || bItems.some((g) => g === undefined)) return false;
    if (pa.gold < aGives.gold || pb.gold < bGives.gold) return false;
    // Re-validate bag space after the net swap, so nobody overflows their bag.
    const aFinal = pa.gear.length - aGives.itemUids.length + bGives.itemUids.length;
    const bFinal = pb.gear.length - bGives.itemUids.length + aGives.itemUids.length;
    if (aFinal > MAX_BAG_GEAR || bFinal > MAX_BAG_GEAR) return false;
    // All checks passed — apply atomically (validate-all-then-mutate).
    const aRemove = new Set(aGives.itemUids);
    const bRemove = new Set(bGives.itemUids);
    pa.gear = pa.gear.filter((g) => !aRemove.has(g.uid));
    pb.gear = pb.gear.filter((g) => !bRemove.has(g.uid));
    for (const g of aItems) if (g) pb.gear.push(g);
    for (const g of bItems) if (g) pa.gear.push(g);
    pa.gold += bGives.gold - aGives.gold;
    pb.gold += aGives.gold - bGives.gold;
    return true;
  }

  /** Derive power, max HP, crit, multishot, and damage-taken from level + every equipped instance. */
  private recomputeStats(player: Player): void {
    let power = 0;
    let bonusHp = 0;
    let crit = BASE_CRIT_CHANCE;
    let multishot = 0;
    let chainAdd = 0,
      pierceAdd = 0,
      forkAdd = 0,
      spellAoe = 0,
      homingAdd = 0,
      spellDamageMult = 1;
    let damageTaken = 1;
    let lifesteal = 0; // percent points
    let swift = 0; // percent cooldown reduction
    let move = 0; // percent move bonus
    let armor = 0; // percent incoming-damage reduction
    let vigor = 0; // bonus HP regenerated per second
    // Slice 4: element-damage, penetration, ailment accumulators (fraction: 0.0–N.0).
    const elemDamage: Record<DamageElement, number> = {
      physical: 0,
      fire: 0,
      cold: 0,
      lightning: 0,
      poison: 0,
    };
    let penetration = 0;
    let ailmentDuration = 0;
    let ailmentMagnitude = 0;
    const procs: ProcDef[] = []; // chance-on-hit/crit procs gathered from equipped gear
    for (const slot of EQUIP_SLOTS) {
      const inst = player.equipment[slot];
      if (!inst) continue;
      power += inst.power;
      bonusHp += inst.hp;
      procs.push(...getContent().itemProcs(inst.baseId));
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
        else if (a.stat === 'fragile')
          damageTaken += a.value / 100; // corrupted debuff: take more
        // Slice 4: element damage, penetration, ailment, and projectile-modifier affixes.
        // Percent stats (whole-percent in DB) → /100 to match the fraction unit gem path uses.
        else if (a.stat === 'firedmg') elemDamage.fire += a.value / 100;
        else if (a.stat === 'colddmg') elemDamage.cold += a.value / 100;
        else if (a.stat === 'lightningdmg') elemDamage.lightning += a.value / 100;
        else if (a.stat === 'poisondmg') elemDamage.poison += a.value / 100;
        else if (a.stat === 'physdmg') elemDamage.physical += a.value / 100;
        else if (a.stat === 'penetration') penetration += a.value / 100;
        else if (a.stat === 'ailmentdur') ailmentDuration += a.value / 100;
        else if (a.stat === 'ailmentmag') ailmentMagnitude += a.value / 100;
        // Integer counts — add directly (same unit as gem chain/pierce/fork).
        else if (a.stat === 'chain') chainAdd += a.value;
        else if (a.stat === 'pierce') pierceAdd += a.value;
        else if (a.stat === 'fork') forkAdd += a.value;
        // Spell AoE: affix stores whole-percent (8-18) → /100 to match gem fraction (0.2-0.5).
        else if (a.stat === 'spellaoe') spellAoe += a.value / 100;
      }
      // Socketed gems add the same stat kinds as affixes (crit gem value is in whole % points).
      const gems = gemBonuses(inst.sockets ?? []);
      power += gems.power;
      bonusHp += gems.hp;
      crit += gems.crit / 100;
      multishot += gems.multishot;
      chainAdd += gems.chain;
      pierceAdd += gems.pierce;
      forkAdd += gems.fork;
      spellAoe += gems.spellaoe;
      homingAdd += gems.homing;
      spellDamageMult *= gems.mult;
      lifesteal += gems.lifesteal;
      swift += gems.swift;
      move += gems.move;
      armor += gems.armor;
      vigor += gems.vigor;
      // A runeword (the right runes socketed in order) grants its bonus affixes on top of the runes.
      for (const a of runewordBonuses(inst.sockets ?? [])) {
        if (a.stat === 'power') power += a.value;
        else if (a.stat === 'hp') bonusHp += a.value;
        else if (a.stat === 'crit') crit += a.value / 100;
        else if (a.stat === 'multishot') multishot += a.value;
        else if (a.stat === 'lifesteal') lifesteal += a.value;
        else if (a.stat === 'swift') swift += a.value;
        else if (a.stat === 'move') move += a.value;
        else if (a.stat === 'armor') armor += a.value;
        else if (a.stat === 'vigor') vigor += a.value;
        // Slice 4: runeword can grant the same new stat kinds as affixes.
        else if (a.stat === 'firedmg') elemDamage.fire += a.value / 100;
        else if (a.stat === 'colddmg') elemDamage.cold += a.value / 100;
        else if (a.stat === 'lightningdmg') elemDamage.lightning += a.value / 100;
        else if (a.stat === 'poisondmg') elemDamage.poison += a.value / 100;
        else if (a.stat === 'physdmg') elemDamage.physical += a.value / 100;
        else if (a.stat === 'penetration') penetration += a.value / 100;
        else if (a.stat === 'ailmentdur') ailmentDuration += a.value / 100;
        else if (a.stat === 'ailmentmag') ailmentMagnitude += a.value / 100;
        else if (a.stat === 'chain') chainAdd += a.value;
        else if (a.stat === 'pierce') pierceAdd += a.value;
        else if (a.stat === 'fork') forkAdd += a.value;
        else if (a.stat === 'spellaoe') spellAoe += a.value / 100;
      }
    }
    // Item-set bonuses: wearing several pieces of one set grants threshold bonuses (D2 set items).
    // Folded once over the whole loadout (not per-item) since they depend on the equipped-piece count.
    for (const a of setBonuses(EQUIP_SLOTS.map((s) => player.equipment[s]?.baseId))) {
      if (a.stat === 'power') power += a.value;
      else if (a.stat === 'hp') bonusHp += a.value;
      else if (a.stat === 'crit') crit += a.value / 100;
      else if (a.stat === 'multishot') multishot += a.value;
      else if (a.stat === 'lifesteal') lifesteal += a.value;
      else if (a.stat === 'swift') swift += a.value;
      else if (a.stat === 'move') move += a.value;
      else if (a.stat === 'armor') armor += a.value;
      else if (a.stat === 'vigor') vigor += a.value;
      // Slice 4: set bonuses can grant the same new stat kinds as affixes.
      else if (a.stat === 'firedmg') elemDamage.fire += a.value / 100;
      else if (a.stat === 'colddmg') elemDamage.cold += a.value / 100;
      else if (a.stat === 'lightningdmg') elemDamage.lightning += a.value / 100;
      else if (a.stat === 'poisondmg') elemDamage.poison += a.value / 100;
      else if (a.stat === 'physdmg') elemDamage.physical += a.value / 100;
      else if (a.stat === 'penetration') penetration += a.value / 100;
      else if (a.stat === 'ailmentdur') ailmentDuration += a.value / 100;
      else if (a.stat === 'ailmentmag') ailmentMagnitude += a.value / 100;
      else if (a.stat === 'chain') chainAdd += a.value;
      else if (a.stat === 'pierce') pierceAdd += a.value;
      else if (a.stat === 'fork') forkAdd += a.value;
      else if (a.stat === 'spellaoe') spellAoe += a.value / 100;
    }
    // Attribute bonuses (strengthâ†’power, vitalityâ†’maxHp, dexterityâ†’crit, energyâ†’mana regen).
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
    // Slice 4: skill-tree nodes can grant chain/pierce/fork (integer counts) and spellaoe (fraction).
    // spellaoe is stored as a fraction in SkillEffects (same unit as concussive/seeking gems).
    chainAdd += skill.chain ?? 0;
    pierceAdd += skill.pierce ?? 0;
    forkAdd += skill.fork ?? 0;
    spellAoe += skill.spellaoe ?? 0;
    player.power = power;
    player.critChance = crit;
    player.multishot = multishot;
    player.chainAdd = chainAdd;
    player.pierceAdd = pierceAdd;
    player.forkAdd = forkAdd;
    player.spellAoe = spellAoe;
    player.homingAdd = homingAdd;
    player.spellDamageMult = spellDamageMult;
    player.procs = procs;
    player.lifesteal = Math.min(0.6, lifesteal / 100); // cap life steal at 60% of damage
    player.cooldownMult = Math.max(0.4, 1 - swift / 100); // cap attack speed at +60%
    player.moveMult = Math.min(1.5, 1 + move / 100); // cap move speed at +50%
    // Armor reduces incoming damage (stacking with the corrupted +fragile penalty), capped at 50%.
    player.damageTakenMult = damageTaken * Math.max(0.5, 1 - armor / 100);
    player.vigor = vigor; // flat HP/sec added to base regen in tickPlayers
    player.manaRegenBonus = attr.manaRegen + skill.manaRegen;
    // Slice 4: element-damage multipliers, penetration, and ailment modifiers.
    player.elemDamage = elemDamage;
    player.penetration = penetration;
    player.ailmentDuration = ailmentDuration;
    player.ailmentMagnitude = ailmentMagnitude;
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
    this.createMob(
      template,
      clamp(p.x + (this.rand() - 0.5) * 60, 0, this.width),
      clamp(p.y + (this.rand() - 0.5) * 60, 0, this.height),
    );
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

  /**
   * Spawn a ground-item stack at an exact world point (no scatter). The public seam over the private
   * `dropGround` scatter-spawn: lets tests place a drop (e.g. a health globe) at a controlled
   * distance from a player, and gives GM tooling a way to seed loot. Returns the new item's id.
   */
  dropItemAt(itemId: string, qty: number, x: number, y: number): number {
    const id = this.allocId();
    this.items.set(id, { id, itemId, qty, x, y, ttl: ITEM_TTL_MS });
    return id;
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

  /**
   * Refund every allocated attribute and skill point for gold, resetting the build to a blank slate.
   * Points are CONSERVED by counting what's actually allocated (attributes above {@link BASE_ATTRIBUTE},
   * plus the size of the passive-node set), so the refund never invents or loses points regardless of
   * level math. The gold cost scales with level. Server-authoritative: validates gold + that there is
   * something to refund before touching anything.
   */
  respec(playerId: number): { ok: boolean; message: string } {
    const p = this.players.get(playerId);
    if (!p) return { ok: false, message: 'No character.' };
    const spentAttr = ATTRIBUTE_KEYS.reduce(
      (sum, k) => sum + (p.attributes[k] - BASE_ATTRIBUTE),
      0,
    );
    const spentSkill = p.skills.size;
    if (spentAttr <= 0 && spentSkill <= 0) {
      return { ok: false, message: 'Nothing to respec — you have no points allocated.' };
    }
    const cost = p.level * RESPEC_COST_PER_LEVEL;
    if (p.gold < cost) {
      return { ok: false, message: `Respec costs ${cost}g — you only have ${p.gold}g.` };
    }
    p.gold -= cost;
    p.attributes = emptyAttributes();
    p.attrPoints += spentAttr;
    p.skills.clear();
    p.skillPoints += spentSkill;
    this.recomputeStats(p);
    return {
      ok: true,
      message: `Respec done — refunded ${spentAttr} attribute and ${spentSkill} skill points for ${cost}g.`,
    };
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

  /**
   * Test seam: inject a status directly onto a mob (identified by entity id from the snapshot).
   * Only usable in tests — production paths go through applyStatus / the content-driven table.
   */
  injectMobStatus(mobId: number, statusId: string, durationMs: number, magnitude: number): boolean {
    const mob = this.mobs.get(mobId);
    if (!mob || mob.dead) return false;
    mob.statuses.apply(statusId as Parameters<StatusSet['apply']>[0], durationMs, magnitude);
    return true;
  }

  /** Test seam: override a mob's current and maximum HP so it can absorb hits in test scenarios. */
  boostMobHp(mobId: number, hp: number): boolean {
    const mob = this.mobs.get(mobId);
    if (!mob || mob.dead) return false;
    mob.hp = hp;
    mob.maxHp = hp;
    return true;
  }

  /** Test seam: warp a mob to an exact world position (bypass the random placement in spawnMobAt). */
  teleportMob(mobId: number, x: number, y: number): boolean {
    const mob = this.mobs.get(mobId);
    if (!mob || mob.dead) return false;
    mob.x = x;
    mob.y = y;
    return true;
  }

  /**
   * Test seam: directly set a player's ailment-scaling stats (fraction values; e.g. 0.5 = +50%).
   * Only usable in tests — production paths go through recomputeStats / gear affixes.
   */
  setPlayerAilmentStats(
    playerId: number,
    ailmentDuration: number,
    ailmentMagnitude: number,
  ): boolean {
    const p = this.players.get(playerId);
    if (!p) return false;
    p.ailmentDuration = ailmentDuration;
    p.ailmentMagnitude = ailmentMagnitude;
    return true;
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
      stashCap: STASH_CAP,
      potions: { health: POTION_START, mana: POTION_START },
      potionReadyAt: 0,
      manaRegenBonus: 0,
      procs: [],
      procIcd: new Map(),
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
      debugSpeed: 1,
      damageTakenMult: 1,
      vigor: 0,
      chainAdd: 0,
      pierceAdd: 0,
      forkAdd: 0,
      spellAoe: 0,
      homingAdd: 0,
      spellDamageMult: 1,
      elemDamage: { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0 },
      penetration: 0,
      ailmentDuration: 0,
      ailmentMagnitude: 0,
      god: false,
      quests: new Map(),
      questsDone: new Set(),
      earnedAchievements: new Set(),
      kills: 0,
      bossKills: 0,
      bestiary: new Set(),
      deathlessStreak: 0,
      bestDeathlessStreak: 0,
      known: new Map(STARTER_ABILITIES.map((a) => [a, 1])),
      discovered: new Set([this.areaId]),
      input: { up: false, down: false, left: false, right: false },
      lastSeq: 0,
      cooldowns: new Map(),
      buffs: new StatusSet(),
      debuffs: new StatusSet(),
      hireling: null,
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
      stashCap: p.stashCap,
      potions: { ...p.potions },
      attributes: { ...p.attributes },
      attrPoints: p.attrPoints,
      skills: [...p.skills],
      skillPoints: p.skillPoints,
      equipment: { ...p.equipment },
      god: p.god,
      quests: [...p.quests],
      questsDone: [...p.questsDone],
      earnedAchievements: [...p.earnedAchievements],
      kills: p.kills,
      bossKills: p.bossKills,
      bestiary: [...p.bestiary],
      deathlessStreak: p.deathlessStreak,
      bestDeathlessStreak: p.bestDeathlessStreak,
      known: [...p.known],
      discovered: [...p.discovered],
      hireling: p.hireling,
    };
  }

  /** Restore a player (with stable id) from a save, at the given position. */
  importPlayer(id: number, save: PlayerSave, x: number, y: number): void {
    this.spawn(save.name, { id, x, y, hue: save.hue });
    const p = this.players.get(id);
    if (!p) return;
    p.level = save.level;
    // Grandfather saves from before the exponential curve: keep the character's LEVEL by
    // raising their XP to its new floor, so nobody ever de-levels on a rebalance.
    p.xp = Math.max(save.xp, xpForLevel(save.level));
    p.gold = save.gold;
    p.loot = new Map(save.loot);
    p.gear = [...save.gear];
    p.stash = [...(save.stash ?? [])]; // pre-stash saves start with an empty bank
    // At least the current base cap; a saved expansion above it is preserved.
    p.stashCap = Math.max(save.stashCap ?? STASH_CAP, STASH_CAP);
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
    p.earnedAchievements = new Set(save.earnedAchievements ?? []);
    p.kills = save.kills ?? 0;
    p.bossKills = save.bossKills ?? 0;
    p.bestiary = new Set(save.bestiary ?? []);
    p.deathlessStreak = save.deathlessStreak ?? 0;
    // Old saves without a record default it to the current streak so the ladder isn't under-counted.
    p.bestDeathlessStreak = Math.max(save.bestDeathlessStreak ?? 0, p.deathlessStreak);
    p.known = restoreKnown(save.known);
    // Carry visited areas across the transfer + always mark the area we just arrived in.
    p.discovered = new Set(save.discovered ?? []);
    p.discovered.add(this.areaId);
    this.progressExploreQuests(p); // arriving here may complete an explore quest
    this.recomputeStats(p);
    p.hp = Math.min(save.hp, p.maxHp);
    p.mana = save.mana;
    // The mercenary contract crosses with the player; the companion respawns at their side.
    p.hireling = save.hireling ?? null;
    if (p.hireling) this.spawnHireling(p);
  }

  remove(id: number): void {
    this.endTradeFor(id); // drop any active trade so the partner isn't stuck "in trade"
    this.despawnHirelingOf(id);
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
    // Validate the aim at the boundary: a hostile client can put NaN/Infinity in dx/dy, which
    // would poison player.facing and spawn a NaN-position projectile broadcast to everyone.
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
      dx = Math.cos(player.facing);
      dy = Math.sin(player.facing);
    }
    const ability = getContent().ability(abilityId);
    if (!ability) return;
    // Loot = your build: you can only cast spells you have learned (from a spellbook). A hostile
    // client cannot cast what it never learned â€” this is validated server-side, never on the wire.
    const rank = player.known.get(abilityId);
    if (rank === undefined) return;
    if ((player.cooldowns.get(abilityId) ?? 0) > 0 || player.mana < ability.manaCost) return;
    // Silence (and stun/freeze, which imply silence) prevents casting. Checked after the cooldown
    // and mana guards so we don't waste a gate order, but before mana is spent or the cooldown set.
    if (player.debuffs.silenced()) return;

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
    const buff = getContent().castBuff(abilityId);
    if (buff) player.buffs.apply(buff.buff, buff.ms, buff.magnitude);
    // Outgoing damage this cast: boosted by an active MIGHT buff, cut by an enemy WEAKEN debuff.
    const mightMult = player.buffs.damageFactor() * player.debuffs.weakenFactor();

    if (ability.kind === 'heal') {
      player.hp = Math.min(player.maxHp, player.hp + ability.damage * rankMult);
    } else if (ability.kind === 'melee') {
      const halfAngle = ability.meleeHalfAngle ?? 0.6;
      for (const mob of this.mobs.values()) {
        if (mob.dead) continue;
        if (inMeleeCone(player.x, player.y, facing, mob.x, mob.y, ability.range, halfAngle)) {
          const elem = ability.element ?? 'physical';
          const power =
            (ability.damage + player.power) * rankMult * mightMult * (1 + player.elemDamage[elem]);
          const base = rollAbilityDamage(player.level, mob.level, power, this.rand);
          const crit = base > 0 && rollCrit(this.rand, player.critChance);
          const dmg = applyCrit(base, crit);
          const finalDmg = resistedDamage(
            dmg,
            elem,
            getContent().mobResists(mob.templateId),
            player.penetration,
          );
          this.damageMob(mob, finalDmg, abilityId, player.id, crit);
          if (finalDmg > 0) {
            applyStatus(mob, abilityId, {
              durMult: 1 + player.ailmentDuration,
              magMult: 1 + player.ailmentMagnitude,
            });
            const kbPx = ABILITY_KNOCKBACK[abilityId];
            if (kbPx) this.knockbackMob(mob, player.x, player.y, kbPx);
          }
        }
      }
    } else {
      const behaviors = ability.behaviors ?? [];

      // --- Beam (hitscan) branch ---
      // When an ability carries `{ type: 'beam' }`, skip projectile spawning entirely and instead
      // trace an instant line from the caster. Every mob whose edge intersects the segment takes
      // the full deterministic hit pipeline (same math as the melee branch above).
      const beamSpec = behaviors.find((b) => b.type === 'beam');
      if (beamSpec && beamSpec.type === 'beam') {
        const elem = ability.element ?? 'physical';
        const bx = player.x + Math.cos(facing) * beamSpec.range;
        const by = player.y + Math.sin(facing) * beamSpec.range;
        for (const mob of this.mobs.values()) {
          if (mob.dead) continue;
          if (
            pointToSegmentDist(mob.x, mob.y, player.x, player.y, bx, by) <=
            beamSpec.width + MOB_RADIUS
          ) {
            const power =
              (ability.damage + player.power) *
              rankMult *
              mightMult *
              (1 + player.elemDamage[elem]);
            const base = rollAbilityDamage(player.level, mob.level, power, this.rand);
            const crit = base > 0 && rollCrit(this.rand, player.critChance);
            const dmg = applyCrit(base, crit);
            const finalDmg = resistedDamage(
              dmg,
              elem,
              getContent().mobResists(mob.templateId),
              player.penetration,
            );
            this.damageMob(mob, finalDmg, abilityId, player.id, crit);
            if (finalDmg > 0) {
              applyStatus(mob, abilityId, {
                durMult: 1 + player.ailmentDuration,
                magMult: 1 + player.ailmentMagnitude,
              });
              const kbSpec = behaviors.find((b) => b.type === 'knockback');
              if (kbSpec && kbSpec.type === 'knockback') {
                this.knockbackMob(mob, player.x, player.y, kbSpec.px);
              }
            }
          }
        }
        this.events.push({ kind: 'beam', x: player.x, y: player.y, x2: bx, y2: by, element: elem });
        // Beam replaces projectile spawning — nothing more to do for this cast.
        return;
      }

      const speed = ability.projectileSpeed ?? 300;
      // Multishot: the ability's `multishot` behavior OR the player's multishot stat (whichever is
      // larger) fans extra projectiles around the aim. Slice 2 adds gem-driven multishot.
      const ms = behaviors.find((b) => b.type === 'multishot');
      const count = Math.max(1 + player.multishot, ms ? ms.count : 1);
      const spread = ms ? ms.spreadRad : 0.18;
      // Behaviors carried by each projectile exclude the cast-time `multishot` entry.
      // Gem modifier stats (chain/pierce/fork/spellAoe/homing) are merged in here.
      const carried = applyModifiers(
        behaviors.filter((b) => b.type !== 'multishot'),
        {
          chainAdd: player.chainAdd,
          pierceAdd: player.pierceAdd,
          forkAdd: player.forkAdd,
          spellAoe: player.spellAoe,
          homingAdd: player.homingAdd,
        },
      );
      const charges = initialCharges(carried);
      const hasOrbit = carried.some((b) => b.type === 'orbit');
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
          damage:
            (ability.damage + player.power) *
            rankMult *
            mightMult *
            player.spellDamageMult *
            (1 + player.elemDamage[ability.element ?? 'physical']),
          radius: ability.radius,
          ownerId: player.id,
          ownerLevel: player.level,
          critChance: player.critChance,
          hostile: false,
          behaviors: carried,
          hitMobs: new Set<number>(),
          bouncesLeft: charges.bouncesLeft,
          piercesLeft: charges.piercesLeft,
          forksLeft: charges.forksLeft,
          damageScale: 1,
          // Orbit projectiles start at the fan angle so multishot spreads evenly around the ring.
          ...(hasOrbit ? { orbitAngle: a, orbitHits: new Map<number, number>() } : {}),
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
    this.tickHirelings(dt);
    this.tickProjectiles(dt);
    this.tickItems(dt);
  }

  /** Mob-damage multiplier from corruption (1 at calm, up to 1 + CORRUPT_MAX_DMG_BONUS at full). */
  private corruptionDmg(): number {
    return 1 + this.corruption() * config.corruption.maxDmgBonus;
  }

  /**
   * A player's effective movement multiplier: weather Ã— +move affix/gem Ã— HASTE buff Ã— enemy SLOW
   * debuff. The same value is sent in the `you` packet so the client predictor integrates exactly
   * like this, keeping movement in sync (no rubber-banding) even when slowed/hasted/move-buffed.
   */
  private playerMoveMul(player: Player): number {
    return (
      this.moveScale *
      player.moveMult *
      player.debugSpeed *
      player.buffs.moveFactor() *
      player.debuffs.slowFactor()
    );
  }

  /**
   * Set a player's GM debug speed multiplier (the `/speed` command). Clamped to a sane range so a
   * typo can't make the player un-collidable (huge per-tick steps tunnel through walls). Returns the
   * clamped value actually applied. Folds into playerMoveMul, so the reported moveMul carries it and
   * the client predictor stays in lockstep.
   */
  setDebugSpeed(id: number, mult: number): number {
    const player = this.players.get(id);
    if (!player) return 1;
    const clamped = Math.max(0.1, Math.min(10, mult));
    player.debugSpeed = clamped;
    return clamped;
  }

  /**
   * A monster's outgoing hit damage: base Ã— elite mult Ã— area corruption, scaled by its own status
   * effects â€” a WEAKEN debuff cuts it, a MIGHT self-buff (from a War Cry support cast) raises it.
   */
  /**
   * Co-op difficulty: each additional living player in the instance makes its monsters hit
   * harder (×1 + COOP_DAMAGE_PER_PLAYER each, capped), so a crowded area is genuinely more
   * dangerous — you want allies at your back, not just sharing your XP. Solo play is unscaled.
   */
  /** Living players in this instance — the head-count both co-op scales key off. */
  private livingPlayerCount(): number {
    let alive = 0;
    for (const p of this.players.values()) if (!p.dead) alive++;
    return alive;
  }

  private coopDamageScale(): number {
    return coopScale(this.livingPlayerCount(), COOP_DAMAGE_PER_PLAYER, COOP_DAMAGE_CAP);
  }

  /** Co-op GOLD multiplier: a crowded instance drops richer gold (D3 "more players, more loot"). */
  private coopGoldScale(): number {
    return coopScale(this.livingPlayerCount(), COOP_GOLD_PER_PLAYER, COOP_GOLD_CAP);
  }

  private mobOutgoing(mob: Mob, template: MobTemplate): number {
    return (
      // Deeper rifts hit harder: scale the base by how far the mob's level outpaces its template
      // (tier 0 keeps it exactly), capped tight so "deeper = deadlier" never spikes into one-shots.
      scaleDamageForLevel(template.damage, mob.level, template.level, DAMAGE_LEVEL_CAP) *
      MOB_DMG_TUNING *
      this.coopDamageScale() *
      // Enraged brutes (trait, below 35% HP) hit half again as hard â€” finish them or back off.
      traitDamageMult(template.traits, mob.maxHp > 0 ? mob.hp / mob.maxHp : 1) *
      mob.dmgMult *
      this.corruptionDmg() *
      mob.statuses.weakenFactor() *
      mob.statuses.damageFactor() *
      // Scripted-boss soft-enrage: damage climbs the longer a fight drags (engagedAt set on first hit).
      (mob.engagedAt !== undefined ? bossEnrageMultiplier(this.now - mob.engagedAt) : 1)
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
      // Advance enemy debuffs; DoT effects (burn, ignite, poison, bleed) chip HP over time.
      const { dotDamage } = player.debuffs.tick(dt * 1000);
      if (dotDamage > 0) this.damagePlayer(player, dotDamage, true);
      if (player.dead) continue;
      for (const [ability, remaining] of player.cooldowns) {
        const next = remaining - dt * 1000;
        if (next <= 0) player.cooldowns.delete(ability);
        else player.cooldowns.set(ability, next);
      }

      const { dx, dy } = moveVector(player.input);
      // Root (stun / freeze): the player cannot move from input this tick; all other per-tick
      // housekeeping above (regen, debuff tick, cooldown drain) still runs normally.
      if ((dx !== 0 || dy !== 0) && !player.debuffs.rooted()) {
        // Full effective speed (weather Ã— affix Ã— haste Ã— slow). The client predictor receives this
        // same multiplier in the `you` packet, so the two stay in sync â€” no rubber-banding.
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
          this.circleList(),
        );
        player.x = resolved.x;
        player.y = resolved.y;
        player.facing = Math.atan2(dy, dx);
      }
      this.checkShrines(player);
      this.checkChests(player);
      this.checkPots(player);
      this.checkDens(player);
    }
  }

  /** The area's solid wall colliders, built once from its house decor (empty for areas with none). */
  /** The area's solid geometry (rects + circles), built once from decor and cached. */
  private blockers(): Blockers {
    if (this.blockerCache === null) {
      this.blockerCache = blockersForDecor(getContent().area(this.areaId)?.decor ?? []);
    }
    return this.blockerCache;
  }
  private wallList(): readonly Rect[] {
    return this.blockers().rects;
  }
  private circleList(): readonly Circle[] {
    return this.blockers().circles;
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
      const pool = getContent().shrineBuffs();
      if (pool.length === 0) return;
      const buff = pool[Math.floor(this.rand() * pool.length)]!;
      player.buffs.apply(buff.buff, buff.ms, buff.magnitude);
      s.readyAt = this.now + SHRINE_COOLDOWN_MS;
      this.notify(player.id, `A shrine blesses you â€” ${buff.label}.`);
      return; // one blessing per tick
    }
  }

  /**
   * The area's chests, built once per instance: the authored 'chest' decor PLUS a random roll â€”
   * every instance hides a few extra chests at fresh spots (dens always hold at least one), so
   * exploring the same zone twice still pays.
   */
  private chestList(): { id: number; x: number; y: number; opened: boolean }[] {
    if (this.chests === null) {
      const decor = getContent().area(this.areaId)?.decor ?? [];
      this.chests = decor
        .filter((d) => d.kind === 'chest')
        .map((d) => ({ id: this.allocId(), x: d.x, y: d.y, opened: false }));
      const bonus =
        this.areaId === 'den' ? 1 + Math.floor(this.rand() * 2) : Math.floor(this.rand() * 3);
      for (let i = 0; i < bonus; i++) {
        this.chests.push({
          id: this.allocId(),
          x: this.randomMobX(),
          y: this.randomMobY(),
          opened: false,
        });
      }
    }
    return this.chests;
  }

  /**
   * Den entrances for this instance, rolled ONCE lazily â€” the Diablo cellar loop. Every house
   * footprint has a 50% chance of a cellar hatch in its interior, and open country (any
   * non-dungeon area with monsters) hides 2-4 dens at random spots. Each instance re-rolls, so
   * the world never reads the same twice.
   */
  private denList(): { id: number; x: number; y: number; name: string }[] {
    if (this.dens === null) {
      this.dens = [];
      if (this.areaId !== 'den' && !getContent().isDungeon(this.areaId)) {
        const area = getContent().area(this.areaId);
        for (const d of area?.decor ?? []) {
          if (d.kind !== 'house' || d.x2 === undefined || d.y2 === undefined) continue;
          if (this.rand() < 0.5) continue;
          // Tucked into the house interior, clear of the south-edge doorway.
          const hx = d.x + (d.x2 - d.x) * (0.25 + this.rand() * 0.5);
          const hy = d.y + (d.y2 - d.y) * 0.35;
          this.dens.push({ id: this.allocId(), x: hx, y: hy, name: 'Cellar' });
        }
        if ((area?.decor?.length ?? 0) > 0 && getContent().areaMobs(this.areaId).length > 0) {
          const count = 2 + Math.floor(this.rand() * 3);
          for (let i = 0; i < count; i++) {
            const x = this.randomMobX();
            const y = this.randomMobY();
            // Never within a screen of the arrival point â€” dens are found, not tripped over.
            if (Math.hypot(x - this.spawnPoint.x, y - this.spawnPoint.y) < 500) continue;
            this.dens.push({ id: this.allocId(), x, y, name: 'Hidden Den' });
          }
        }
      }
    }
    return this.dens;
  }

  /** Queue a descent for any player standing on a den entrance (the host resolves transfers). */
  private checkDens(player: Player): void {
    if (this.denPending.has(player.id)) return;
    for (const den of this.denList()) {
      if (Math.hypot(player.x - den.x, player.y - den.y) > 34) continue;
      this.denPending.add(player.id);
      this.denEntries.push({ playerId: player.id });
      return;
    }
  }

  /** Drain pending den descents for the host (InstanceManager.openDen does the transfer). */
  drainDenEntries(): { playerId: number }[] {
    const drained = this.denEntries;
    this.denEntries = [];
    for (const e of drained) this.denPending.delete(e.playerId);
    return drained;
  }

  /**
   * Populate a DEN instance: a small private cellar stocked from the SOURCE area's roster (so a
   * Gloomwood cellar crawls with Gloomwood things), an elevated champion chance, and sometimes a
   * beefed-up den boss. The guaranteed chest comes from chestList's den roll.
   */
  populateDen(sourceAreaId: string): void {
    const content = getContent();
    let roster = content.areaMobs(sourceAreaId);
    if (roster.length === 0) roster = content.areaMobs('wilderness');
    const templates = roster
      .map((s) => content.mobTemplate(s.templateId))
      .filter((t): t is MobTemplate => !!t && t.hp < 200);
    if (templates.length === 0) return;
    const count = 10 + Math.floor(this.rand() * 7);
    for (let i = 0; i < count; i++) {
      const t = templates[Math.floor(this.rand() * templates.length)]!;
      this.createMob(t, this.randomMobX(), this.randomMobY(), false, false, 0.35);
    }
    // Sometimes the den has a landlord: the toughest local template, forced elite.
    if (this.rand() < 0.35) {
      const boss = templates.reduce((a, b) => (b.level > a.level ? b : a));
      this.createMob(boss, this.width / 2, this.height * 0.4, true);
    }
  }

  /** The area's breakable pots, built once from its 'pot' decor (each gets a stable entity id). */
  private potList(): { id: number; x: number; y: number; broken: boolean }[] {
    if (this.pots === null) {
      const decor = getContent().area(this.areaId)?.decor ?? [];
      this.pots = decor
        .filter((d) => d.kind === 'pot')
        .map((d) => ({ id: this.allocId(), x: d.x, y: d.y, broken: false }));
    }
    return this.pots;
  }

  /** Smash any pot a player brushes against: a sparkle, a little gold, sometimes a belt potion. */
  private checkPots(player: Player): void {
    for (const pot of this.potList()) {
      if (pot.broken) continue;
      if (Math.hypot(player.x - pot.x, player.y - pot.y) > POT_RADIUS) continue;
      pot.broken = true;
      this.events.push({ kind: 'pickup', x: pot.x, y: pot.y });
      const base = POT_GOLD_MIN + Math.floor(this.rand() * (POT_GOLD_MAX - POT_GOLD_MIN + 1));
      const gold = Math.round(base * tierGoldScale(this.tier) * this.coopGoldScale());
      this.dropGround('gold', gold, pot.x, pot.y);
      if (this.rand() < 0.1) {
        player.potions.health = Math.min(POTION_CAP, player.potions.health + 1);
      }
    }
  }

  /** Pop open any closed chest a player walks up to, spilling gold + gear on the ground (once). */
  private checkChests(player: Player): void {
    for (const c of this.chestList()) {
      if (c.opened) continue;
      if (Math.hypot(player.x - c.x, player.y - c.y) > CHEST_RADIUS) continue;
      c.opened = true;
      const base = CHEST_GOLD_MIN + Math.floor(this.rand() * (CHEST_GOLD_MAX - CHEST_GOLD_MIN + 1));
      const gold = Math.round(base * tierGoldScale(this.tier) * this.coopGoldScale());
      this.dropGround('gold', gold, c.x, c.y);
      const corrupt = this.corruption() * config.corruption.dropMax;
      this.dropBonusGear(c.x, c.y, 1, corrupt, CHEST_UNIQUE_CHANCE); // one good piece (rare unique)...
      if (this.rand() < 0.4) this.dropBonusGear(c.x, c.y, 0, corrupt); // ...sometimes a second
      // A chest also stocks your belt with a couple of potions.
      player.potions.health = Math.min(
        POTION_CAP,
        player.potions.health + 1 + (this.rand() < 0.5 ? 1 : 0),
      );
      if (this.rand() < 0.6) player.potions.mana = Math.min(POTION_CAP, player.potions.mana + 1);
      // ...and sometimes a rune (for runewords).
      if (this.rand() < 0.5) {
        const r = RUNES[Math.floor(this.rand() * RUNES.length)];
        if (r) this.giveItem(player.id, r.id, 1);
      }
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
    // Hirelings are valid monster targets too â€” a mob fights whoever is closest, ally included.
    for (const h of this.hirelings.values()) views.push({ id: h.id, x: h.x, y: h.y, alive: true });

    // Spatial index of living mobs (positions at tick start) so the per-mob "packmates nearby"
    // check is a local neighborhood query, not an O(mobs²) scan of the whole roster — the single
    // biggest cost when a crowd has scaled an instance up to a thousand-plus monsters.
    const packGrid = new SpatialGrid<Mob>(PACK_RADIUS);
    for (const m of this.mobs.values()) if (!m.dead) packGrid.insert(m);

    for (const mob of this.mobs.values()) {
      if (mob.dead) {
        if (this.now >= mob.respawnAt) this.respawnMob(mob);
        continue;
      }
      if (mob.attackCd > 0) mob.attackCd -= dt * 1000;
      if (mob.supportCd > 0) mob.supportCd -= dt * 1000;

      // Status effects: DoT (burn/ignite/poison/bleed) chips HP, regen heals; slow/haste scale movement.
      const { dotDamage, regenHeal } = mob.statuses.tick(dt * 1000);
      if (dotDamage > 0) this.damageMob(mob, dotDamage, undefined, mob.lastAttacker);
      if (mob.dead) continue;
      if (regenHeal > 0) mob.hp = Math.min(mob.maxHp, mob.hp + regenHeal);
      // Hard CC: a stunned or frozen mob cannot move, attack, or cast this tick. DoT and regen
      // above still apply (burning while stunned is intentional). Mirror the telegraphUntil pattern.
      if (mob.statuses.rooted()) {
        mob.telegraphUntil = 0; // stun/freeze cancels any pending wind-up — no delayed strike post-stun
        continue;
      }
      const moveMul = mob.statuses.slowFactor() * mob.statuses.moveFactor();

      const template = getContent().mobTemplate(mob.templateId)!;

      // Support casters periodically buff/heal themselves while a player is in the fight.
      const support = template.support;
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
          // A lunge slams into walls like everything else (no charging through a house).
          const dashed = resolveCircleMove(
            mob.x,
            mob.y,
            clamp(mob.x + mob.dashVx * dt, 0, this.width),
            clamp(mob.y + mob.dashVy * dt, 0, this.height),
            PLAYER_COLLISION_RADIUS,
            this.wallList(),
            this.circleList(),
          );
          mob.x = dashed.x;
          mob.y = dashed.y;
          for (const player of this.players.values()) {
            if (player.dead || mob.dashHit.has(player.id)) continue;
            if (circlesOverlap(mob.x, mob.y, MOB_RADIUS, player.x, player.y, PLAYER_RADIUS)) {
              this.damagePlayer(player, this.mobOutgoing(mob, template));
              mob.dashHit.add(player.id);
            }
          }
          for (const ally of this.hirelings.values()) {
            if (mob.dashHit.has(ally.id)) continue;
            if (circlesOverlap(mob.x, mob.y, MOB_RADIUS, ally.x, ally.y, PLAYER_RADIUS)) {
              mob.dashHit.add(ally.id); // mark BEFORE the hit â€” a kill deletes the hireling
              this.damageHireling(ally, this.mobOutgoing(mob, template));
            }
          }
          continue;
        }
      }

      // Attack wind-up: a telegraphed mob is rooted, facing its locked aim. The strike lands when
      // the wind-up elapses â€” moving out of the way during it is how a player dodges.
      if (mob.telegraphUntil > 0) {
        mob.facing = mob.telegraphFacing;
        if (this.now >= mob.telegraphUntil) {
          mob.telegraphUntil = 0;
          this.executeMobAttack(mob, template);
          mob.attackCd = template.attackCooldownMs * mob.statuses.cooldownFactor();
        }
        continue;
      }

      // Apex bosses run a scripted phase loop (move/cast/summon/shout choreography) layered over
      // their normal brawling AI. The script returns an action to take this tick, an empty object
      // to stand still (a scripted pause), or null to fall through to stepMob (the brawl window).
      const script = BOSS_SCRIPTS[mob.templateId];
      if (script) {
        if (!mob.bossScript) mob.bossScript = newBossScriptState();
        const action = stepBossScript(
          script,
          mob.bossScript,
          this.now,
          mob.maxHp > 0 ? mob.hp / mob.maxHp : 1,
          mob.x,
          mob.y,
          this.width,
          this.height,
        );
        if (action !== null) {
          if (action.shout) this.broadcastNotice(action.shout);
          if (action.cast) {
            mob.telegraphFacing = mob.facing;
            this.castMobSpell(mob, template, action.cast);
            mob.attackCd = template.attackCooldownMs * mob.statuses.cooldownFactor();
          }
          if (action.summon) {
            const add = getContent().mobTemplate(action.summon.templateId);
            if (add) {
              for (let s = 0; s < action.summon.count; s++) {
                const ang = this.rand() * Math.PI * 2;
                const r = this.rand() * action.summon.radius;
                this.createMob(
                  add,
                  clamp(mob.x + Math.cos(ang) * r, 0, this.width),
                  clamp(mob.y + Math.sin(ang) * r, 0, this.height),
                  true, // forced elite — the boss's honor guard
                );
              }
            }
          }
          if (action.move) {
            const speed = template.speed * moveMul * mob.spdMult;
            const resolved = resolveCircleMove(
              mob.x,
              mob.y,
              clamp(mob.x + action.move.vx * speed * dt, 0, this.width),
              clamp(mob.y + action.move.vy * speed * dt, 0, this.height),
              PLAYER_COLLISION_RADIUS,
              this.wallList(),
              this.circleList(),
            );
            mob.x = resolved.x;
            mob.y = resolved.y;
            mob.facing = action.move.facing;
          }
          continue; // the script owns this tick
        }
        // null: the brawl — fall through to normal AI below.
      }

      const view: MobView = { x: mob.x, y: mob.y, template, attackReady: mob.attackCd <= 0 };
      // Per-mob AI context: drives the trait behaviors (pack speed, craven flight, enrage
      // pace, flanking curves) and the alerted hunt after a hit or a packmate's help-call.
      let packNearby = 0;
      for (const ally of packGrid.queryRadius(mob.x, mob.y, PACK_RADIUS)) {
        if (ally.id !== mob.id && !ally.dead && ally.templateId === mob.templateId) packNearby++;
      }
      const ctx: MobStepContext = {
        hpFrac: mob.maxHp > 0 ? mob.hp / mob.maxHp : 1,
        packNearby,
        seed: mob.id,
        alerted: this.now < mob.alertUntil,
      };
      // Weather may dampen aggro; the difficulty tuning widens it (monsters notice you sooner).
      const intent = stepMob(view, views, this.aggroScale * MOB_AGGRO_TUNING, ctx);

      if (intent.attackTargetId !== null) {
        const targetAlive =
          this.players.get(intent.attackTargetId)?.dead === false ||
          this.hirelings.has(intent.attackTargetId);
        if (targetAlive) {
          mob.facing = intent.facing ?? mob.facing;
          mob.telegraphFacing = mob.facing;
          mob.telegraphTargetId = intent.attackTargetId;
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
        // Mobs respect house walls (sliding along them like players do) and, when a wall pins
        // them mid-chase, head for the nearest doorway instead of grinding the bricks.
        const nx = clamp(mob.x + intent.vx * moveMul * mob.spdMult * dt, 0, this.width);
        const ny = clamp(mob.y + intent.vy * moveMul * mob.spdMult * dt, 0, this.height);
        const resolved = resolveCircleMove(
          mob.x,
          mob.y,
          nx,
          ny,
          PLAYER_COLLISION_RADIUS,
          this.wallList(),
          this.circleList(),
        );
        const intended = Math.hypot(nx - mob.x, ny - mob.y);
        const moved = Math.hypot(resolved.x - mob.x, resolved.y - mob.y);
        mob.x = resolved.x;
        mob.y = resolved.y;
        if (intended > 0.5 && moved < intended * 0.3) this.steerTowardDoor(mob, dt, template);
        if (intent.facing !== null) mob.facing = intent.facing;
      } else {
        this.wander(mob, dt, template.speed * moveMul * mob.spdMult);
      }
    }

    // Soft crowd (the arcade-solver pattern): overlapping mobs push each other apart half the
    // overlap each, so packs spread around the player instead of merging into one pixel-pile. A
    // spatial grid keeps this a local-neighborhood pass (each mob only checks the handful in its
    // cells), not O(mobs²). One pass per tick converges invisibly; chargers mid-dash pass through.
    const limit = MOB_RADIUS * 2;
    const sepGrid = new SpatialGrid<Mob>(limit);
    for (const m of this.mobs.values()) if (!m.dead && m.dashUntil <= 0) sepGrid.insert(m);
    for (const a of this.mobs.values()) {
      if (a.dead || a.dashUntil > 0) continue;
      for (const b of sepGrid.queryRadius(a.x, a.y, limit)) {
        if (b.id <= a.id) continue; // each unordered pair once; skip self
        const sep = separateCircles(a.x, a.y, b.x, b.y, MOB_RADIUS, MOB_RADIUS);
        a.x = clamp(sep.ax, 0, this.width);
        a.y = clamp(sep.ay, 0, this.height);
        b.x = clamp(sep.bx, 0, this.width);
        b.y = clamp(sep.by, 0, this.height);
      }
    }
  }

  /**
   * A wall-pinned mob heads for the nearest house DOORWAY (the gap centered on the south edge
   * of every footprint) — the cheap, testable alternative to pathfinding while our only solid
   * geometry is rectangular houses.
   */
  private steerTowardDoor(mob: Mob, dt: number, template: MobTemplate): void {
    let best: { x: number; y: number } | undefined;
    let bestDist = Infinity;
    for (const d of getContent().area(this.areaId)?.decor ?? []) {
      if (d.kind !== 'house' || d.x2 === undefined || d.y2 === undefined) continue;
      const door = { x: (d.x + d.x2) / 2, y: d.y2 };
      const dist = Math.hypot(door.x - mob.x, door.y - mob.y);
      if (dist < bestDist) {
        best = door;
        bestDist = dist;
      }
    }
    if (!best || bestDist < 8) return;
    const inv = 1 / bestDist;
    const speed = template.speed * mob.spdMult;
    const resolved = resolveCircleMove(
      mob.x,
      mob.y,
      clamp(mob.x + (best.x - mob.x) * inv * speed * dt, 0, this.width),
      clamp(mob.y + (best.y - mob.y) * inv * speed * dt, 0, this.height),
      PLAYER_COLLISION_RADIUS,
      this.wallList(),
      this.circleList(),
    );
    mob.x = resolved.x;
    mob.y = resolved.y;
  }

  /**
   * Advance every hireling: keep pace with the owner's level, heel to their side, and fight
   * nearby monsters. Kill credit (XP, quests, corruption relief) flows to the OWNER â€” the
   * hireling is a damage partner, never a separate progression track.
   */
  private tickHirelings(dt: number): void {
    for (const h of this.hirelings.values()) {
      const owner = this.players.get(h.ownerId);
      if (!owner || !owner.hireling) {
        this.hirelings.delete(h.id);
        continue;
      }
      if (h.attackCd > 0) h.attackCd -= dt * 1000;

      // Keep pace with the owner: rescale stats (and heal up) on each level they gain.
      if (owner.level !== h.level) {
        const stats = hirelingStats(owner.level);
        h.level = owner.level;
        h.maxHp = stats.maxHp;
        h.hp = stats.maxHp;
        h.power = stats.power;
      }

      // Catch up instantly when hopelessly left behind (a waypoint jump, a respawn).
      if (Math.hypot(owner.x - h.x, owner.y - h.y) > 900) {
        h.x = clamp(owner.x + 26, 0, this.width);
        h.y = clamp(owner.y + 10, 0, this.height);
      }

      const targets = [...this.mobs.values()]
        .filter((m) => !m.dead)
        .map((m) => ({ id: m.id, x: m.x, y: m.y, alive: true }));
      const intent = stepHireling(
        { x: h.x, y: h.y, template: h.template, attackReady: h.attackCd <= 0 },
        owner,
        targets,
      );
      if (intent.facing !== null) h.facing = intent.facing;

      if (intent.attackTargetId !== null) {
        const mob = this.mobs.get(intent.attackTargetId);
        if (mob && !mob.dead) {
          h.attackCd = h.template.attackCooldownMs;
          if (h.template.behavior === 'ranged') {
            const speed = 360;
            const pid = this.allocId();
            this.projectiles.set(pid, {
              id: pid,
              abilityId: 'arrow',
              x: h.x,
              y: h.y,
              vx: Math.cos(h.facing) * speed,
              vy: Math.sin(h.facing) * speed,
              ttl: 1600,
              damage: h.power,
              radius: 8,
              ownerId: h.ownerId, // owner gets the kill credit (and their lifesteal, if any)
              ownerLevel: h.level,
              critChance: 0,
              hostile: false,
              behaviors: [],
              hitMobs: new Set<number>(),
              bouncesLeft: 0,
              piercesLeft: 0,
              forksLeft: 0,
              damageScale: 1,
            });
            this.events.push({ kind: 'cast', x: h.x, y: h.y, facing: h.facing });
          } else {
            const dmg = rollAbilityDamage(h.level, mob.level, h.power, this.rand);
            this.damageMob(mob, dmg, undefined, h.ownerId);
            this.events.push({ kind: 'melee', x: h.x, y: h.y, facing: h.facing });
          }
        }
      } else if (intent.vx !== 0 || intent.vy !== 0) {
        h.x = clamp(h.x + intent.vx * dt, 0, this.width);
        h.y = clamp(h.y + intent.vy * dt, 0, this.height);
      }
    }
  }

  /** Damage a hireling; at zero it dies and the owner's contract is voided (re-hire in town). */
  private damageHireling(h: Hireling, amount: number): void {
    h.hp -= amount;
    this.events.push({ kind: 'hit', x: h.x, y: h.y, value: Math.ceil(amount) });
    if (h.hp <= 0) {
      this.events.push({ kind: 'death', x: h.x, y: h.y });
      this.hirelings.delete(h.id);
      const owner = this.players.get(h.ownerId);
      if (owner) {
        owner.hireling = null;
        this.notify(owner.id, `Your ${h.template.name} has fallen. Hire anew at the Recruiter.`);
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
    const spell = template.spell;
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
        behaviors: [],
        hitMobs: new Set<number>(),
        bouncesLeft: 0,
        piercesLeft: 0,
        forksLeft: 0,
        damageScale: 1,
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
      for (const ally of this.hirelings.values()) {
        if (Math.hypot(ally.x - mob.x, ally.y - mob.y) <= template.slamRadius + PLAYER_RADIUS) {
          this.damageHireling(ally, this.mobOutgoing(mob, template));
        }
      }
      this.events.push({ kind: 'slam', x: mob.x, y: mob.y, radius: template.slamRadius });
      return;
    }
    const reach = template.attackRange + PLAYER_RADIUS;
    const target = this.players.get(mob.telegraphTargetId);
    if (target && !target.dead && Math.hypot(target.x - mob.x, target.y - mob.y) <= reach) {
      this.damagePlayer(target, this.mobOutgoing(mob, template));
    } else {
      const ally = this.hirelings.get(mob.telegraphTargetId);
      if (ally && Math.hypot(ally.x - mob.x, ally.y - mob.y) <= reach) {
        this.damageHireling(ally, this.mobOutgoing(mob, template));
      }
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
    // Silence (and stun/freeze, which imply silence) prevents spell casting. Basic melee swings
    // are NOT gated here — they go through executeMobAttack → the non-spell branches.
    if (mob.statuses.silenced()) return;
    const ability = getContent().ability(abilityId);
    if (!ability) return;
    this.events.push({ kind: 'cast', x: mob.x, y: mob.y, facing: mob.telegraphFacing, abilityId });

    if (ability.kind === 'heal') {
      const buff = getContent().castBuff(abilityId);
      if (buff) mob.statuses.apply(buff.buff, buff.ms, buff.magnitude);
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
      for (const ally of this.hirelings.values()) {
        const hit = inMeleeCone(
          mob.x,
          mob.y,
          mob.telegraphFacing,
          ally.x,
          ally.y,
          ability.range,
          halfAngle,
        );
        if (hit) this.damageHireling(ally, dmg);
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
      behaviors: [],
      hitMobs: new Set<number>(),
      bouncesLeft: 0,
      piercesLeft: 0,
      forksLeft: 0,
      damageScale: 1,
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
    // Fork children are buffered here and inserted AFTER the iteration to avoid mutating
    // this.projectiles while we are iterating it (which would process children in the same tick).
    const spawned: Projectile[] = [];

    for (const proj of this.projectiles.values()) {
      // On-travel behaviors (server-authoritative).
      const homing = proj.behaviors.find((b) => b.type === 'homing');
      if (homing && !proj.hostile) {
        let tgt: MobLite | undefined;
        let best = homing.acquireRange;
        for (const m of this.mobs.values()) {
          if (m.dead || proj.hitMobs.has(m.id)) continue;
          const d = Math.hypot(m.x - proj.x, m.y - proj.y);
          if (d <= best) {
            best = d;
            tgt = { id: m.id, x: m.x, y: m.y };
          }
        }
        if (tgt) {
          const v = steerHoming(proj.x, proj.y, proj.vx, proj.vy, tgt, homing.turnRate, dt * 1000);
          proj.vx = v.vx;
          proj.vy = v.vy;
        }
      }
      const ret = proj.behaviors.find((b) => b.type === 'return');
      if (
        ret &&
        !proj.returned &&
        proj.ttl <= (getContent().ability(proj.abilityId)?.projectileTtlMs ?? 1200) / 2
      ) {
        proj.vx = -proj.vx;
        proj.vy = -proj.vy;
        proj.returned = true;
        proj.hitMobs.clear();
        proj.damageScale *= ret.falloff;
      }

      // Orbit: position is owner-relative, not velocity-driven. Non-orbit projectiles use vx/vy.
      const orbitBehavior = proj.behaviors.find((b) => b.type === 'orbit');
      if (orbitBehavior && orbitBehavior.type === 'orbit') {
        const owner = this.players.get(proj.ownerId);
        if (!owner) {
          this.projectiles.delete(proj.id);
          continue;
        }
        proj.orbitAngle = (proj.orbitAngle ?? 0) + orbitBehavior.angularSpeed * dt;
        proj.x = owner.x + Math.cos(proj.orbitAngle) * orbitBehavior.radius;
        proj.y = owner.y + Math.sin(proj.orbitAngle) * orbitBehavior.radius;
      } else {
        proj.x += proj.vx * dt;
        proj.y += proj.vy * dt;
      }
      proj.ttl -= dt * 1000;

      // Walls stop normal shots — but orbit projectiles circle the owner (owner-relative position)
      // so passing through a wall tile is not meaningful; skip the blocker-delete for them.
      if (!orbitBehavior && pointInAnyBlocker(proj.x, proj.y, this.blockers())) {
        this.projectiles.delete(proj.id);
        continue;
      }

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
        if (!consumed) {
          for (const ally of this.hirelings.values()) {
            if (circlesOverlap(proj.x, proj.y, proj.radius, ally.x, ally.y, PLAYER_RADIUS)) {
              this.damageHireling(ally, proj.damage);
              consumed = true;
              break;
            }
          }
        }
      } else if (orbitBehavior) {
        // Orbit hit: scan ALL living mobs each tick; hit each one independently when its per-target
        // cooldown has expired. Never consume the projectile — it lives until TTL.
        const orbitHits = proj.orbitHits ?? new Map<number, number>();
        for (const mob of this.mobs.values()) {
          if (mob.dead) continue;
          if ((orbitHits.get(mob.id) ?? 0) > this.now) continue; // still on cooldown
          if (!circlesOverlap(proj.x, proj.y, proj.radius, mob.x, mob.y, MOB_RADIUS)) continue;
          // Hit this mob and start its re-hit cooldown.
          orbitHits.set(mob.id, this.now + ORBIT_REHIT_MS);
          this.applyProjectileDamage(proj, mob, proj.damageScale);
          // Respect a co-present knockback behavior on orbit projectiles.
          const kb = proj.behaviors.find((b) => b.type === 'knockback');
          if (kb && kb.type === 'knockback') this.knockbackMob(mob, proj.x, proj.y, kb.px);
        }
        proj.orbitHits = orbitHits;
        // consumed stays false — orbit persists until TTL.
      } else {
        let hit: Mob | undefined;
        for (const mob of this.mobs.values()) {
          if (mob.dead || proj.hitMobs.has(mob.id)) continue;
          if (circlesOverlap(proj.x, proj.y, proj.radius, mob.x, mob.y, MOB_RADIUS)) {
            hit = mob;
            break;
          }
        }
        if (hit) {
          proj.hitMobs.add(hit.id);
          const candidates: MobLite[] = [];
          for (const m of this.mobs.values()) {
            if (m.dead || proj.hitMobs.has(m.id)) continue;
            candidates.push({ id: m.id, x: m.x, y: m.y });
          }
          const res = resolveHit({
            x: proj.x,
            y: proj.y,
            vx: proj.vx,
            vy: proj.vy,
            damageScale: proj.damageScale,
            behaviors: proj.behaviors,
            charges: {
              bouncesLeft: proj.bouncesLeft,
              piercesLeft: proj.piercesLeft,
              forksLeft: proj.forksLeft,
            },
            hitMobs: proj.hitMobs,
            hitMob: { id: hit.id, x: hit.x, y: hit.y },
            candidates,
          });
          this.applyProjectileDamage(proj, hit, res.primaryDamageScale);
          // Knockback behavior: shove the primary hit target away from the impact point.
          const kb = proj.behaviors.find((b) => b.type === 'knockback');
          if (kb && kb.type === 'knockback') this.knockbackMob(hit, proj.x, proj.y, kb.px);
          if (res.splash) {
            for (const m of this.mobs.values()) {
              if (m.dead || m.id === hit.id || proj.hitMobs.has(m.id)) continue;
              if (Math.hypot(m.x - hit.x, m.y - hit.y) <= res.splash.radius) {
                this.applyProjectileDamage(proj, m, res.primaryDamageScale * res.splash.scale);
                proj.hitMobs.add(m.id);
              }
            }
          }
          for (const f of res.forks) {
            const cid = this.allocId();
            spawned.push({
              id: cid,
              abilityId: proj.abilityId,
              x: proj.x,
              y: proj.y,
              vx: f.vx,
              vy: f.vy,
              ttl: getContent().ability(proj.abilityId)?.projectileTtlMs ?? 1200,
              damage: proj.damage,
              radius: proj.radius,
              ownerId: proj.ownerId,
              ownerLevel: proj.ownerLevel,
              critChance: proj.critChance,
              hostile: false,
              behaviors: [],
              hitMobs: new Set<number>(),
              bouncesLeft: 0,
              piercesLeft: 0,
              forksLeft: 0,
              damageScale: f.damageScale,
            });
          }
          proj.bouncesLeft = res.charges.bouncesLeft;
          proj.piercesLeft = res.charges.piercesLeft;
          proj.forksLeft = res.charges.forksLeft;
          proj.damageScale = res.damageScaleAfter;
          if (res.redirect) {
            proj.vx = res.redirect.vx;
            proj.vy = res.redirect.vy;
            if (res.arcTo) {
              this.events.push({
                kind: 'arc',
                x: hit.x,
                y: hit.y,
                x2: res.arcTo.x,
                y2: res.arcTo.y,
                element: getContent().ability(proj.abilityId)?.element ?? 'physical',
              });
            }
          }
          consumed = res.consume;
        }
      }
      if (consumed || proj.ttl <= 0 || this.outOfBounds(proj.x, proj.y)) {
        this.projectiles.delete(proj.id);
      }
    }

    // Insert fork children now that iteration is complete.
    for (const p of spawned) this.projectiles.set(p.id, p);
  }

  /** Roll + apply one projectile damage instance to a mob (crit, element resist, status), scaled. */
  private applyProjectileDamage(proj: Projectile, mob: Mob, scale: number): void {
    const base = rollAbilityDamage(proj.ownerLevel, mob.level, proj.damage * scale, this.rand);
    const crit = base > 0 && rollCrit(this.rand, proj.critChance);
    const dmg = applyCrit(base, crit);
    const owner = this.players.get(proj.ownerId);
    const finalDmg = resistedDamage(
      dmg,
      getContent().ability(proj.abilityId)?.element ?? 'physical',
      getContent().mobResists(mob.templateId),
      owner?.penetration ?? 0,
    );
    this.damageMob(mob, finalDmg, proj.abilityId, proj.ownerId, crit);
    if (finalDmg > 0) {
      applyStatus(
        mob,
        proj.abilityId,
        owner
          ? { durMult: 1 + owner.ailmentDuration, magMult: 1 + owner.ailmentMagnitude }
          : undefined,
      );
      const kbPx = ABILITY_KNOCKBACK[proj.abilityId];
      if (kbPx) this.knockbackMob(mob, proj.x, proj.y, kbPx);
    }
  }

  /**
   * One-shot positional knockback: shove a mob `px` pixels away from (fromX, fromY), clamped to
   * the map bounds and resolved against solid collision geometry. Deterministic (no randomness) so
   * a recorded input sequence reproduces the same displacement. Called after damage is applied.
   */
  private knockbackMob(mob: Mob, fromX: number, fromY: number, px: number): void {
    const dx = mob.x - fromX;
    const dy = mob.y - fromY;
    const len = Math.hypot(dx, dy) || 1;
    const tx = mob.x + (dx / len) * px;
    const ty = mob.y + (dy / len) * px;
    const res = resolveCircleMove(
      mob.x,
      mob.y,
      clamp(tx, 0, this.width),
      clamp(ty, 0, this.height),
      PLAYER_COLLISION_RADIUS,
      this.wallList(),
      this.circleList(),
    );
    mob.x = res.x;
    mob.y = res.y;
  }

  private wander(mob: Mob, dt: number, speed: number): void {
    if (this.now >= mob.wanderUntil) {
      mob.wanderAngle = this.rand() < 0.6 ? this.rand() * Math.PI * 2 : null;
      mob.wanderUntil = this.now + 800 + this.rand() * 1600;
    }
    // Leash back home if we have drifted too far.
    const homeDist = Math.hypot(mob.x - mob.homeX, mob.y - mob.homeY);
    if (homeDist > 220) mob.wanderAngle = Math.atan2(mob.homeY - mob.y, mob.homeX - mob.x);
    if (mob.wanderAngle === null) return;
    const resolved = resolveCircleMove(
      mob.x,
      mob.y,
      clamp(mob.x + Math.cos(mob.wanderAngle) * speed * 0.35 * dt, 0, this.width),
      clamp(mob.y + Math.sin(mob.wanderAngle) * speed * 0.35 * dt, 0, this.height),
      PLAYER_COLLISION_RADIUS,
      this.wallList(),
      this.circleList(),
    );
    mob.x = resolved.x;
    mob.y = resolved.y;
    mob.facing = mob.wanderAngle;
  }

  private damageMob(
    mob: Mob,
    amount: number,
    abilityId: AbilityId | undefined,
    attackerId: number,
    crit = false,
  ): void {
    // Scale by the mob's incoming-damage multiplier (shock/brittle/curse → >1; default 1 = no-op).
    amount = amount * mob.statuses.vulnFactor();
    if (attackerId !== 0) {
      mob.lastAttacker = attackerId;
      // Anyone who lands a hit is a TAGGER — they share the kill (no last-hit stealing).
      if (this.players.has(attackerId)) mob.taggers.add(attackerId);
      // Start the soft-enrage clock the first time a scripted boss is engaged.
      if (mob.engagedAt === undefined && BOSS_SCRIPTS[mob.templateId]) mob.engagedAt = this.now;
    }
    mob.hp -= amount;
    // A hurt monster is ALERTED (extended aggro reach â€” it hunts rather than idles), and a
    // pack hunter calls for help: same-template packmates in earshot join the alert.
    mob.alertUntil = this.now + 8000;
    if (isPackish(getContent().mobTemplate(mob.templateId)?.traits)) {
      for (const ally of this.mobs.values()) {
        if (ally.dead || ally.templateId !== mob.templateId || ally.id === mob.id) continue;
        if (Math.hypot(ally.x - mob.x, ally.y - mob.y) <= 360) {
          ally.alertUntil = Math.max(ally.alertUntil, this.now + 8000);
        }
      }
    }
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
    } else if (
      this.procDepth === 0 &&
      amount > 0 &&
      attacker &&
      !attacker.dead &&
      attacker.procs.length > 0
    ) {
      // On-hit item procs (gear-granted "chance on hit/crit"). Only on a SURVIVING mob, and only at
      // depth 0 so a proc's own damage can't itself proc — no proc-storm, no infinite recursion. A
      // lethal proc's recursive damageMob handles the kill + loot exactly once.
      this.procDepth++;
      for (const eff of resolveProcs(
        attacker.procs,
        { crit, now: this.now },
        attacker.procIcd,
        this.rand,
      )) {
        if (eff.kind === 'damage') this.damageMob(mob, eff.amount, undefined, attackerId, false);
        else
          applyStatus(
            mob,
            eff.ability as AbilityId,
            attacker
              ? { durMult: 1 + attacker.ailmentDuration, magMult: 1 + attacker.ailmentMagnitude }
              : undefined,
          );
        if (mob.dead) break;
      }
      this.procDepth--;
    }
  }

  /** Award XP to the killer and drop loot on the ground. */
  private onMobKilled(mob: Mob): void {
    // Clearing monsters pushes back the area's corruption.
    this.areaCorruption.pushBack(this.areaId);
    const killer = this.players.get(mob.lastAttacker);
    if (killer || mob.taggers.size > 0) {
      // A small group XP bonus on top of the elite multiplier — a kill that took several hands is
      // worth more total, so co-op pays even though everyone shares it.
      const groupBonus = 1 + 0.1 * Math.max(0, mob.taggers.size - 1);
      // xpEventMult folds in a liveops event bonus (e.g. Bloodmoon); riftEffects.xpBonus folds in any
      // rolled rift mutator (e.g. Scholarly +40% XP). Both default to neutral outside their context.
      const reward = Math.round(
        xpReward(mob.level) *
          (mob.elite ? 3 : 1) *
          groupBonus *
          this.xpEventMult *
          (1 + this.riftEffects.xpBonus),
      );
      // Shared credit: EVERY player who tagged the mob, plus party members present in THIS instance,
      // each get the full XP and quest progress — grouping (and helping) is rewarded, never taxed.
      const credited = new Set<number>(mob.taggers);
      if (killer) credited.add(killer.id);
      for (const tagger of mob.taggers) {
        for (const memberId of this.partyResolver(tagger)) {
          const m = this.players.get(memberId);
          if (m && !m.dead) credited.add(memberId);
        }
      }
      for (const id of credited) {
        if (this.players.get(id)) this.creditKill(id, reward, mob.templateId);
      }
    }
    // Loot (materials + gear) comes from the DB-backed content drop tables. Equipment items roll a
    // rarity + stats into a unique instance; materials/currency drop as plain stacks.
    const content = getContent();
    const isBoss = (content.mobTemplate(mob.templateId)?.hp ?? 0) >= 200;
    const corruptedChance = this.corruptedDropChance(mob, isBoss);
    for (const stack of content.rollLoot(mob.templateId, this.rand)) {
      const id = this.allocId();
      // Base drop-table gold is fixed per template; scale it by the mob's actual level (i.e. rift
      // tier) so deeper monsters spill richer hoards (tier 0 keeps the table amount), then by the
      // co-op multiplier so a crowded instance pays more. Solo at tier 0 = exactly the table amount.
      const qty =
        stack.item === 'gold'
          ? Math.round(
              scaleGoldForLevel(
                stack.qty,
                mob.level,
                content.mobTemplate(mob.templateId)?.level ?? mob.level,
              ) *
                this.coopGoldScale() *
                this.goldEventMult, // Golden Hour & friends spill richer hoards
            )
          : // Rift "Bountiful"-style mutators boost material stack sizes (0 outside a rift).
            Math.max(1, Math.round(stack.qty * (1 + this.riftEffects.lootQuantityBonus)));
      const item: GroundItem = {
        id,
        itemId: stack.item,
        qty,
        x: mob.x + (this.rand() - 0.5) * 30,
        y: mob.y + (this.rand() - 0.5) * 30,
        ttl: ITEM_TTL_MS,
      };
      const def = content.item(stack.item);
      if (def && def.kind === 'equip') {
        // The loot chase: a slim chance (better from bosses) the gear is instead a named unique.
        const uniqueChance = isBoss ? UNIQUE_DROP_CHANCE * 4 : UNIQUE_DROP_CHANCE;
        const unique =
          this.rand() < uniqueChance ? content.rollRandomUnique(this.allocId()) : undefined;
        if (unique) {
          item.instance = unique;
          item.itemId = unique.baseId;
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

    // Champion bonus: a level-scaled pile of gold + one guaranteed, rarity-bumped piece of gear.
    if (mob.elite) {
      this.dropGround(
        'gold',
        Math.round(
          championGoldPile(mob.level, this.rand) * this.coopGoldScale() * this.goldEventMult,
        ),
        mob.x,
        mob.y,
      );
      this.dropBonusGear(mob.x, mob.y, 2, corruptedChance);
    }

    // Spells are loot: an independent book-drop roll, richer from elites and bosses.
    const bookChance = isBoss
      ? SPELLBOOK_DROP_BOSS
      : mob.elite
        ? SPELLBOOK_DROP_ELITE
        : SPELLBOOK_DROP_NORMAL;
    if (this.rand() < bookChance) this.dropSpellbook(mob.x, mob.y);

    // Gems are loot too: an independent roll (elites/bosses far likelier), tier-weighted toward
    // chipped. A socketed gem is a small, stackable build bonus â€” the "loot = your build" layer.
    const gemChance = isBoss ? GEM_DROP_BOSS : mob.elite ? GEM_DROP_ELITE : GEM_DROP_NORMAL;
    if (this.rand() < gemChance) this.dropGround(rollGemDrop(), 1, mob.x, mob.y);

    // Health globes (D3): an independent roll (champions/bosses far likelier) spills a globe that
    // instant-heals whoever walks over it — the panic-button reward that keeps a fight flowing.
    const globeChance = isBoss
      ? HEALTH_GLOBE_BOSS
      : mob.elite
        ? HEALTH_GLOBE_ELITE
        : HEALTH_GLOBE_NORMAL;
    if (this.rand() < globeChance) this.dropGround(HEALTH_GLOBE_ITEM, 1, mob.x, mob.y);

    // Living loot meta: consume this monster type's accumulated hunting bounty. A long lull since the
    // last kill (or a never-farmed type) means a high chance of a bonus rarity-bumped drop; the kill
    // resets the timer, so farming the same spot quickly depletes it back to base loot.
    const last = this.lastKillAt.get(mob.templateId);
    const bounty = last === undefined ? 1 : Math.min(1, (this.now - last) / BOUNTY_FULL_MS);
    this.lastKillAt.set(mob.templateId, this.now);
    if (this.rand() < bounty * BOUNTY_MAX_CHANCE) {
      this.dropBonusGear(mob.x, mob.y, 1, corruptedChance);
      if (killer) this.notify(killer.id, 'A hunting bounty! Fresh quarry yields richer loot.');
    }
  }

  /** Drop a random spellbook as a ground stack (picked up into the bag, then read to learn). */
  private dropSpellbook(x: number, y: number): void {
    const books = getContent()
      .items()
      .filter((i) => i.kind === 'spellbook');
    const book = books[Math.floor(this.rand() * books.length)];
    if (book) this.dropGround(book.id, 1, x, y);
  }

  /** A random equippable base item (any slot), or null if the content has none. */
  /**
   * All equippable BASE items from the content DB, as BaseItems (the pool for random gear / gamble
   * rolls). Legendaries live in the items table too (LEGENDARY flag) but are excluded here — they
   * drop only via the dedicated unique roll, never from a random/gamble pull.
   */
  private equipBases(): BaseItem[] {
    return getContent()
      .items()
      .filter((i) => i.kind === 'equip' && !hasItemFlag(i.flags, ItemFlags.LEGENDARY))
      .map(asBaseItem)
      .filter((b): b is BaseItem => b !== null);
  }

  private randomEquipBase(): BaseItem | null {
    const bases = this.equipBases();
    return bases[Math.floor(this.rand() * bases.length)] ?? null;
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
    if (uniqueChance > 0 && this.rand() < uniqueChance) {
      const inst = getContent().rollRandomUnique(this.allocId());
      if (inst) {
        this.dropGround(inst.baseId, 1, x, y).instance = inst;
        return;
      }
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
    if (this.rand() < corruptedChance) {
      return rollCorruptedInstance(this.allocId(), base);
    }
    return rollItemInstance(this.allocId(), base, this.rand, rarityBump);
  }

  /**
   * Combined corrupted-drop chance for a slain mob: the area's corruption (scaled), plus a slim flat
   * bonus for invasion champions and an even slimmer one for bosses.
   */
  private corruptedDropChance(mob: Mob, isBoss: boolean): number {
    let chance = this.corruption() * config.corruption.dropMax;
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
      x: x + (this.rand() - 0.5) * 30,
      y: y + (this.rand() - 0.5) * 30,
      ttl: ITEM_TTL_MS,
    };
    this.items.set(id, item);
    return item;
  }

  // --- quests + per-player notices -----------------------------------------------------

  private notify(playerId: number, text: string): void {
    this.notices.push({ playerId, text });
  }

  /** Notify every living player in the instance (boss shouts, area-wide events). */
  private broadcastNotice(text: string): void {
    for (const p of this.players.values()) if (!p.dead) this.notices.push({ playerId: p.id, text });
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
    // An explore quest for an area the player has already visited completes the moment it is taken.
    if (quest.exploreArea) this.progressExploreQuests(player);
    return `Quest accepted: ${quest.name} â€” ${quest.description}`;
  }

  /** Human-readable quest log lines (available + in-progress + done). */
  questLog(playerId: number): string[] {
    const player = this.players.get(playerId);
    if (!player) return [];
    return getContent()
      .quests()
      .map((q) => {
        if (player.questsDone.has(q.id)) return `âœ“ ${q.name} (done)`;
        if (player.quests.has(q.id)) {
          const got = q.exploreArea
            ? player.discovered.has(q.exploreArea)
              ? 1
              : 0
            : (player.quests.get(q.id) ?? 0);
          const need = q.exploreArea ? 1 : q.targetCount;
          return `â–¸ ${q.name}: ${got}/${need} â€” ${q.description}`;
        }
        return `Â· ${q.name} [${q.id}] â€” /accept ${q.id}`;
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
        const explore = !!q.exploreArea;
        const kind = explore
          ? ('explore' as const)
          : collect
            ? ('collect' as const)
            : ('kill' as const);
        // Explore quests are a single binary objective (0/1 = arrived); collect quests show how many
        // of the item the player currently holds; kill quests show kills so far.
        const progress = explore
          ? player.discovered.has(q.exploreArea!)
            ? 1
            : 0
          : collect
            ? Math.min(player.loot.get(q.turnInItem!) ?? 0, q.turnInCount)
            : (player.quests.get(q.id) ?? 0);
        return {
          id: q.id,
          name: q.name,
          description: q.description,
          kind,
          targetCount: explore ? 1 : collect ? q.turnInCount : q.targetCount,
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
    p.kills += 1; // shared-credit: every tagger/party member who is credited counts the kill
    // Boss-tier templates (hp >= 200, the same threshold the spawner uses) feed the boss-slayer line.
    if ((getContent().mobTemplate(mobTemplateId)?.hp ?? 0) >= 200) p.bossKills += 1;
    p.bestiary.add(mobTemplateId); // record the species for the bestiary collection
    p.deathlessStreak += 1; // climbs with every kill; a death snaps it back to 0
    if (p.deathlessStreak > p.bestDeathlessStreak) p.bestDeathlessStreak = p.deathlessStreak; // record
    this.recomputeStats(p);
    this.progressQuests(p, mobTemplateId);
    this.checkAchievements(p);
  }

  /**
   * Unlock any newly-earned achievements (level/gold milestones) for a player and announce them.
   * Idempotent — the earned set dedupes, so calling this every kill is cheap and never re-announces.
   */
  private checkAchievements(player: Player): void {
    const fresh = newlyEarned(
      {
        level: player.level,
        gold: player.gold,
        kills: player.kills,
        bossKills: player.bossKills,
        bestiary: player.bestiary.size,
        deathless: player.deathlessStreak,
        quests: player.questsDone.size,
      },
      player.earnedAchievements,
    );
    for (const a of fresh) {
      player.earnedAchievements.add(a.id);
      this.notify(player.id, `Achievement unlocked: ${a.name} — ${a.desc}`);
    }
  }

  /** Formatted achievement lines for /achievements: earned ones ticked, the rest with progress. */
  achievementStatus(playerId: number): string[] {
    const p = this.players.get(playerId);
    if (!p) return ['No character.'];
    const stats: Record<string, number> = {
      level: p.level,
      gold: p.gold,
      kills: p.kills,
      bossKills: p.bossKills,
      bestiary: p.bestiary.size,
      deathless: p.deathlessStreak,
      quests: p.questsDone.size,
    };
    return DEFAULT_ACHIEVEMENTS.map((a) => {
      const cur = stats[a.metric] ?? 0;
      const done = p.earnedAchievements.has(a.id) || cur >= a.threshold;
      return done ? `✓ ${a.name} — ${a.desc}` : `· ${a.name} (${cur}/${a.threshold} ${a.metric})`;
    });
  }

  /** Bestiary summary for /bestiary: the distinct species this character has slain, by name. */
  bestiaryStatus(playerId: number): string[] {
    const p = this.players.get(playerId);
    if (!p) return ['No character.'];
    if (p.bestiary.size === 0) return ['Bestiary: no monsters slain yet.'];
    const names = [...p.bestiary]
      .map((id) => getContent().mobTemplate(id)?.name ?? id)
      .sort((a, b) => a.localeCompare(b));
    return [`Bestiary: ${names.length} species discovered`, names.join(', ')];
  }

  private progressQuests(player: Player, mobTemplateId: string): void {
    const content = getContent();
    for (const [questId, kills] of player.quests) {
      const quest = content.quest(questId);
      // Only kill quests auto-progress here; collect/explore quests complete via their own paths.
      if (!quest || quest.turnInItem || quest.exploreArea || quest.targetMob !== mobTemplateId)
        continue;
      const next = kills + 1;
      if (next >= quest.targetCount) this.completeQuest(player, quest);
      else player.quests.set(questId, next);
    }
  }

  /**
   * Complete any active explore quest whose target area the player has now discovered. Called when
   * the discovered set grows (area transfer) and when a quest is accepted (so an explore quest for an
   * already-visited area resolves at once). Iterates a copy of the keys since completion mutates the
   * map. Idempotent: a quest already moved to questsDone is no longer in `player.quests`.
   */
  private progressExploreQuests(player: Player): void {
    const content = getContent();
    for (const questId of [...player.quests.keys()]) {
      const quest = content.quest(questId);
      if (!quest?.exploreArea) continue;
      if (player.discovered.has(quest.exploreArea)) this.completeQuest(player, quest);
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
      // Gold-vacuum: pull a gold drop toward the nearest living player in magnet range (ARPG feel).
      if (item.itemId === 'gold') {
        const moved = goldMagnetStep(item, this.players.values(), dt);
        item.x = moved.x;
        item.y = moved.y;
      }
      for (const player of this.players.values()) {
        if (player.dead) continue;
        if (Math.hypot(player.x - item.x, player.y - item.y) <= PICKUP_RADIUS) {
          // Health globe: only a wounded player collects it — a full-HP player walks over it and
          // leaves it on the ground for an ally who needs it (D3 globes persist until used).
          if (item.itemId === HEALTH_GLOBE_ITEM) {
            if (player.hp >= player.maxHp) continue;
            this.collectHealthGlobe(player);
          } else if (item.itemId === 'gold') {
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

  /**
   * Apply a health globe a `picker` walked over: instant-heal the picker, and every living ally
   * within {@link GLOBE_ALLY_RADIUS} a smaller share (D3 globes heal the whole group). Each heal is
   * clamped to that character's missing-HP headroom and emits a 'heal' floater for the client.
   */
  private collectHealthGlobe(picker: Player): void {
    this.healByGlobe(picker, GLOBE_HEAL_FRAC);
    for (const ally of this.players.values()) {
      if (ally === picker || ally.dead) continue;
      if (Math.hypot(ally.x - picker.x, ally.y - picker.y) <= GLOBE_ALLY_RADIUS) {
        this.healByGlobe(ally, GLOBE_ALLY_HEAL_FRAC);
      }
    }
  }

  /** Heal one player by a fraction of their max HP (clamped to the missing headroom) + a floater. */
  private healByGlobe(player: Player, frac: number): void {
    const healed = Math.min(player.maxHp - player.hp, healthGlobeHeal(player.maxHp, frac));
    if (healed <= 0) return;
    player.hp += healed;
    this.events.push({ kind: 'heal', x: player.x, y: player.y, value: Math.round(healed) });
  }

  private damagePlayer(player: Player, amount: number, silent = false): void {
    if (player.god) return;
    // Scale by the player's incoming-damage multiplier (shock/brittle/curse → >1; default 1 = no-op).
    amount = amount * player.debuffs.vulnFactor();
    const taken = amount * player.damageTakenMult; // corrupted +fragile makes hits land harder
    player.hp -= taken;
    // Round the floating damage (mult'd by corruption/fragile) for a clean floating number. Burn
    // (damage-over-time) ticks pass silent=true so they don't spew a number every server tick.
    if (!silent)
      this.events.push({ kind: 'hit', x: player.x, y: player.y, value: Math.ceil(taken) });
    if (player.hp <= 0) {
      player.hp = 0;
      player.dead = true;
      player.deathlessStreak = 0; // a death ends the streak
      player.respawnAt = this.now + PLAYER_RESPAWN_MS;
      this.events.push({ kind: 'death', x: player.x, y: player.y });
      // Every player's death feeds the shared area-wide corruption â€” darker and deadlier for all.
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
    // Re-randomize the respawn position (and update its home) so the world doesn't feel static â€”
    // cleared ground refills somewhere new rather than the exact same spots every time.
    mob.x = this.randomMobX();
    mob.y = this.randomMobY();
    mob.homeX = mob.x;
    mob.homeY = mob.y;
    mob.attackCd = 0;
    mob.taggers.clear(); // a respawned mob is un-claimed again
    delete mob.bossScript; // a fresh fight starts the phase loop from the top
    delete mob.engagedAt; // and resets the soft-enrage clock
  }

  private outOfBounds(x: number, y: number): boolean {
    return x < 0 || y < 0 || x > this.width || y > this.height;
  }

  snapshot(): EntityState[] {
    const out: EntityState[] = [];
    for (const p of this.players.values()) {
      if (p.dead) continue;
      // Build the full status bitfield from STATUS_BITS — covers all debuffs (p.debuffs) and buffs
      // (p.buffs). Skip 'enrage' which is mob-only (triggered by might|haste self-buff, not a status
      // a player can hold). Each bit drives client tinting (debuffs) or HUD pips (buffs).
      let flags = 0;
      for (const [name, bit] of Object.entries(STATUS_BITS)) {
        if (name === 'enrage') continue;
        if (p.debuffs.has(name as StatusId) || p.buffs.has(name as StatusId)) flags |= bit;
      }
      // Visible-equipment bitfield for the paper-doll: head→helm(1), chest→armor(2), mainhand→weapon(4).
      const look =
        (p.equipment.head ? 1 : 0) | (p.equipment.chest ? 2 : 0) | (p.equipment.mainhand ? 4 : 0);
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
        ...(look ? { look } : {}),
      });
    }
    for (const h of this.hirelings.values()) {
      const e: EntityState = {
        id: h.id,
        x: h.x,
        y: h.y,
        name: h.template.name,
        // The owner's hue, so a hireling visually reads as part of that player's retinue.
        hue: this.players.get(h.ownerId)?.hue ?? 120,
        kind: 'hireling',
        facing: h.facing,
        hp: Math.ceil(h.hp),
        maxHp: h.maxHp,
        level: h.level,
        look: 6, // hirelings read as armed warriors (armor + weapon)
      };
      const hTint = getContent().spriteTint(`hireling:${h.template.type}`);
      if (hTint) e.tint = hTint;
      out.push(e);
    }
    for (const m of this.mobs.values()) {
      if (m.dead) continue;
      // Build the full status bitfield for the mob: loop every STATUS_BITS entry (skip enrage —
      // that's computed below from might|haste), then OR in the enrage bit separately.
      let flags = 0;
      for (const [name, bit] of Object.entries(STATUS_BITS)) {
        if (name === 'enrage') continue;
        if (m.statuses.has(name as StatusId)) flags |= bit;
      }
      if (m.statuses.has('might') || m.statuses.has('haste')) flags |= STATUS_BITS.enrage; // enraged/hasted self-buff
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
      if (m.taggers.size > 0) mob.tagged = true; // claimed/engaged — others can still pile in
      // SQL sprite color override ('mob:<templateId>') â€” one sprite source, many variations.
      const mobTint = getContent().spriteTint(`mob:${m.templateId}`);
      if (mobTint) mob.tint = mobTint;
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
      const e: EntityState = {
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
        // Townsfolk paper-doll look by role: the recruiter reads as an armed sergeant (armor+weapon),
        // robed roles (artificer/healer/banker/riftkeeper) wear armor only, vendors/gamblers go plain.
        ...(npc.kind === 'recruiter'
          ? { look: 6 }
          : npc.kind === 'artificer' ||
              npc.kind === 'healer' ||
              npc.kind === 'banker' ||
              npc.kind === 'riftkeeper'
            ? { look: 2 }
            : {}),
      };
      const npcTint = getContent().spriteTint(`npc:${npc.kind}`);
      if (npcTint) e.tint = npcTint;
      out.push(e);
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
    for (const pot of this.potList()) {
      if (pot.broken) continue; // a smashed pot is gone â€” it simply leaves the snapshot
      out.push({
        id: pot.id,
        x: pot.x,
        y: pot.y,
        name: '',
        hue: 0,
        kind: 'pot',
        facing: 0,
        hp: 0,
        maxHp: 0,
        level: 0,
      });
    }
    for (const den of this.denList()) {
      out.push({
        id: den.id,
        x: den.x,
        y: den.y,
        name: den.name,
        hue: 0,
        kind: 'den',
        facing: 0,
        hp: 0,
        maxHp: 0,
        level: 0,
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
        /** Effective move multiplier â€” the client predictor integrates with this to stay in sync. */
        moveMul: number;
        kills: number;
        bossKills: number;
        deathlessStreak: number;
        /** Extra chain bounces aggregated from socketed modifier gems. */
        chainAdd: number;
        /** Extra pierce-through count aggregated from socketed modifier gems. */
        pierceAdd: number;
        /** Extra fork splits aggregated from socketed modifier gems. */
        forkAdd: number;
        /** Spell AoE radius bonus aggregated from socketed modifier gems. */
        spellAoe: number;
        /** Homing projectile count from socketed seeking gems. */
        homingAdd: number;
        /** Multiplicative spell-damage modifier from support gems (1 = no penalty). */
        spellDamageMult: number;
        /** Per-element bonus damage fraction (from elemental-damage affixes; Slice 4). */
        elemDamage: Record<DamageElement, number>;
        /** Fraction of enemy resistance ignored (from +penetration affixes; Slice 4). */
        penetration: number;
        /** Fraction bonus to ailment duration (from +ailmentdur affixes; Slice 4). */
        ailmentDuration: number;
        /** Fraction bonus to ailment magnitude (from +ailmentmag affixes; Slice 4). */
        ailmentMagnitude: number;
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
      kills: p.kills,
      bossKills: p.bossKills,
      deathlessStreak: p.deathlessStreak,
      chainAdd: p.chainAdd,
      pierceAdd: p.pierceAdd,
      forkAdd: p.forkAdd,
      spellAoe: p.spellAoe,
      homingAdd: p.homingAdd,
      spellDamageMult: p.spellDamageMult,
      elemDamage: { ...p.elemDamage },
      penetration: p.penetration,
      ailmentDuration: p.ailmentDuration,
      ailmentMagnitude: p.ailmentMagnitude,
    };
  }

  /** Player count (used for instance cap + GC). Excludes monsters. */
  get population(): number {
    return this.players.size;
  }

  /** All player ids in this instance (including dead/respawning) â€” for snapshot + chat routing. */
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
  rng: () => number = Math.random,
): number {
  const atk = attackRoll(attackerLevel, 8); // small inherent accuracy so early hits mostly land
  const def = defenceRoll(defenderLevel);
  if (!rolledHit(atk, def, rng)) return 0;
  const half = Math.ceil(baseDamage * 0.5);
  return half + rollDamage(baseDamage - half, rng);
}

/**
 * Map an ability's on-hit effect onto a monster. The effects are data-driven (the
 * `ability_status_effects` content table); a spell may carry several (e.g. a curse that both slows
 * and weakens), each applied independently.
 *
 * Pass `mods` with the caster's ailment multipliers to scale duration and magnitude. Defaults to
 * 1/1 (no scaling) so existing call sites that omit mods are behaviour-identical.
 */
function applyStatus(
  mob: { statuses: StatusSet },
  abilityId: AbilityId,
  mods?: { durMult: number; magMult: number },
): void {
  const dm = mods?.durMult ?? 1;
  const mm = mods?.magMult ?? 1;
  for (const e of getContent().abilityStatusEffects(abilityId)) {
    mob.statuses.apply(e.effect, e.ms * dm, e.magnitude * mm);
  }
}

/** Map an enemy spell's on-hit effect onto a PLAYER (so monster spells slow/burn/weaken you too). */
function applyPlayerDebuff(player: { debuffs: StatusSet }, abilityId: AbilityId): void {
  for (const e of getContent().abilityStatusEffects(abilityId)) {
    player.debuffs.apply(e.effect, e.ms, e.magnitude);
  }
}

function sanitizeName(name: string): string {
  const trimmed = (name ?? '').trim().slice(0, MAX_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : 'Adventurer';
}

/**
 * Rebuild a player's learned-spells map from a save. A pre-spellbook save (no `known`) grandfathers
 * in **every ability the content defines** at rank 1 â€” nobody loses a button they had before the
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
