/**
 * Server configuration — the SINGLE place to tune the game and the host.
 *
 * Every operator/designer-facing knob lives here, grouped by concern: server ports + tick rate,
 * instance capacity, world scaling, difficulty, co-op + crowd-density scaling, drop rates, the
 * economy, the bounty/corruption + invasion meta, item/potion limits, and bot limits. Edit a
 * value here and the system that consumes it picks it up — nothing balance-related is tuned in
 * the individual modules anymore (they bind their local names to these values).
 *
 * Operational values (port, tick rate, instancing, admin token, db path, dev password) read an
 * environment override HERE, so even those are configured from one file. Game-balance values are
 * plain constants — change them in this file, no env needed.
 *
 * Deliberately NOT centralized here (and why):
 *  - The XP curve (XP_BASE / growth / knee) lives in `progression.ts`, and the combat math
 *    constants (crit chance/multiplier, effective-level offset, max-hit) live in
 *    `combat-formulas.ts`. Both modules are pure and documented as shareable with the CLIENT,
 *    so they must stay free of any server/`process.env` dependency. Tune those two curves in
 *    their own files.
 *  - Pure geometry/physics internals coupled to their logic (interaction/pickup radii, mob
 *    separation radius, dash duration, per-ability mechanic timings) stay with that logic — they
 *    are implementation detail, not server options.
 */

import { DEFAULT_TICK_RATE } from '../shared/protocol.js';

/** Read a numeric env override, falling back to `def` when unset, empty, or not a number. */
function numEnv(value: string | undefined, def: number): number {
  if (value === undefined || value === '') return def;
  const n = Number(value);
  return Number.isNaN(n) ? def : n;
}

export const config = {
  /** Host process: networking port, simulation rate, instancing mode, and secrets/paths. */
  server: {
    port: numEnv(process.env.PORT, 8080),
    tickRate: numEnv(process.env.TICK_RATE, DEFAULT_TICK_RATE),
    /** 'auto' scales instances by load; 'single' collapses each area to one instance. */
    instancing: process.env.INSTANCING === 'single' ? ('single' as const) : ('auto' as const),
    /** Bearer token that gates privileged in-game "engine" powers (empty disables them). */
    engineAdminToken: process.env.ENGINE_ADMIN_TOKEN ?? '',
    /** SQLite content database path (':memory:' for tests). */
    gameDbPath: process.env.GAME_DB ?? 'game.db',
    /** Seeded dev account password — override in production. */
    devPassword: process.env.DEV_PASSWORD ?? 'changeme',
    /** Idle socket is pinged/closed on this interval. */
    heartbeatMs: 15_000,
  },

  /** Per-player area-of-interest box: each client is sent only entities within these half-extents. */
  networking: {
    aoiHalfWidth: 1400,
    aoiHalfHeight: 1000,
  },

  /** Instance capacity. The load balancer keeps a crowd together until an instance hits this many
   *  players, then spins up another. Floored high on purpose: mob-density scaling caps PER instance,
   *  so packing players is cheaper for the whole-server tick than spreading them across instances
   *  that each balloon their mob roster. See instance-manager.ts. */
  instances: {
    minCap: 100,
  },

  /** World scaling applied at content load — authored data stays compact, the served world is larger. */
  world: {
    /** Linear size multiplier per side (zones become real expeditions). */
    scale: 5,
    /** Monster roster multiplier layered on the scaled ground. */
    mobCountScale: 10,
    /** Portal trigger-span multiplier (less than the world scale — a pad, not a wall of light). */
    portalSpanScale: 2,
    /** SIZE multiplier for terrain footprints (cliffs/mountains/boulders). Their POSITION still rides
     *  `scale`, but their size uses this — kept at canonical 1× so terrain is a ground feature, not a
     *  screen-filling wall. Tune up (e.g. 1.5–2) for more imposing massifs. */
    terrainSizeScale: 1,
  },

  /** Global difficulty — the world is balanced to be dangerous so ground is earned, not strolled. */
  difficulty: {
    /** Monster outgoing-damage multiplier. */
    mobDamage: 1.5,
    /** Monster max-HP multiplier. */
    mobHp: 1.4,
    /** Monster aggro-radius multiplier. */
    mobAggro: 1.2,
    /** Per-level HP growth: mob HP ×(1 + this×level). L18 ≈ +1.9×, L40 ≈ +3×. */
    levelHpScale: 0.05,
    /** Chance a spawn is upgraded to an elite ("champion") variant. */
    eliteChance: 0.09,
    /** Per-tier monster-damage growth cap: a mob whose level outpaces its template (deeper rifts)
     *  hits harder, scaled by level/templateLevel and capped at this multiplier. Tier 0 (the normal
     *  world) is ×1 — unchanged. Deliberately forgiving (gold scales to 4×, lethality only to this)
     *  so "deeper = deadlier" never spikes into one-shots. */
    damageLevelCap: 1.5,
  },

  /** Co-op scaling: grouping up makes an area meaningfully harder (and is rewarded by density). */
  coop: {
    /** Extra monster outgoing damage per additional living player in the instance. */
    damagePerPlayer: 0.15,
    /** Cap on the co-op damage multiplier. */
    damageCap: 2.2,
    /** Extra monster GOLD per additional living player (D3 "more players, more loot" — the reward
     *  side of grouping up, since drops are contested and the zone is harder). */
    goldPerPlayer: 0.12,
    /** Cap on the co-op gold multiplier. */
    goldCap: 1.6,
  },

  /** Crowd mob-density scaling (maintainDensity): keep a flooded zone full of targets. */
  density: {
    /** Target living-mob count rises by this fraction of the base roster per extra player. */
    perPlayer: 0.25,
    /** Cap on the density multiplier (×base roster). */
    cap: 6,
    /** How many mobs a single top-up pass may add (gradual refill). */
    topupPerCall: 40,
  },

  /** Progression knobs that are server-only. (The XP CURVE itself lives in progression.ts.) */
  progression: {
    /** Passive skill-tree points granted per level (separate from attribute points). */
    skillPointsPerLevel: 1,
  },

  /** Loot drop chances — the acquisition chase. */
  drops: {
    /** Unique (named legendary) chance on an ordinary gear drop. */
    unique: 0.02,
    /** Unique chance from a chest (richer than a kill). */
    chestUnique: 0.08,
    spellbookNormal: 0.004,
    spellbookElite: 0.03,
    spellbookBoss: 0.3,
    gemNormal: 0.02,
    gemElite: 0.12,
    gemBoss: 0.6,
    /** Health-globe drop chances (D3): a slain monster may spill a globe that instant-heals on
     *  pickup — the panic-button reward that keeps a fight flowing without a potion. Rare from
     *  trash, common from champions, near-guaranteed from bosses. */
    healthGlobeNormal: 0.015,
    healthGlobeElite: 0.1,
    healthGlobeBoss: 0.5,
  },

  /** Economy: gold sinks, vendor behavior, and reward payouts. */
  economy: {
    /** Vendor price multiplier (a gold sink that keeps drops the exciting path). */
    vendorPriceMult: 1.6,
    /** Rotating vendor stock window size. */
    vendorStockCap: 10,
    /** Vendor stock rotation period. */
    vendorRotateMs: 240_000,
    /** Rift opening fee per tier (the endgame gold sink). */
    riftCostPerTier: 100,
    chestGoldMin: 25,
    chestGoldMax: 90,
    potGoldMin: 2,
    potGoldMax: 14,
    /** Artificer reroll cost (gold; also consumes a rune shard). */
    artificerRerollGold: 250,
    /** Artificer unsocket cost (gold). */
    artificerUnsocketGold: 120,
  },

  /** Living-loot bounty + extra corrupted-gear sources. */
  bounty: {
    /** A monster type left alone this long has a full hunting bounty. */
    fullMs: 60_000,
    /** Bonus-drop chance at a full bounty. */
    maxChance: 0.5,
    /** Corrupted-gear chance from an invasion champion. */
    invasionCorruptChance: 0.08,
    /** Corrupted-gear chance from a boss. */
    bossCorruptChance: 0.003,
  },

  /** Invasion events (host-driven). */
  invasion: {
    /** How often the host rolls for an invasion. */
    intervalMs: 90_000,
    /** Per-instance chance each roll. */
    chance: 0.35,
  },

  /** Inventory limits. */
  items: {
    /** Unequipped-gear bag capacity (oldest evicted past the cap). */
    maxBagGear: 30,
    /** Bank stash slots. */
    stashCap: 60,
    /** How long dropped loot persists on the ground. */
    itemTtlMs: 30_000,
  },

  /** Quick-use potion belt. */
  potions: {
    cap: 8,
    /** How many of each a new character starts with. */
    start: 3,
    /** HP restored by a health potion. */
    heal: 70,
    /** Mana restored by a mana potion. */
    mana: 60,
    /** Shared use-cooldown. */
    cooldownMs: 2500,
  },

  /** Health globes (D3): the instant-heal pickup a slain monster may spill. */
  globes: {
    /** Fraction of the picker's MAX HP restored when they walk over a globe. */
    healFrac: 0.35,
    /** Fraction of MAX HP each nearby ally also gets (D3 globes heal the whole group). */
    allyHealFrac: 0.2,
    /** How close an ally must be (world px) to share in a globe's heal. */
    allyRadius: 220,
  },

  /** AI bots. */
  bots: {
    /** Max bots a single /bot call may spawn (finite so a typo can't lock the loop; stack by repeating). */
    spawnPerCallMax: 2000,
  },
};
