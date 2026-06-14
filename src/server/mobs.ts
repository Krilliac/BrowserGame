/**
 * Monsters: RuneScape-flavored roaming, respawning creatures that aggro and melee nearby
 * players. Templates define stats per creature; the AI step is a pure function so it's
 * unit-tested (mobs.test.ts). The World owns mob state and applies the returned intent.
 */

import type { AbilityId } from '../shared/combat.js';

/**
 * How a monster fights:
 *  - melee   : closes in and strikes at short range.
 *  - ranged  : kites to keep its distance and fires projectiles.
 *  - charger  : closes in, then telegraphs and dashes through its target.
 */
export type MobBehavior = 'melee' | 'ranged' | 'charger';

export interface MobTemplate {
  id: string;
  name: string;
  hp: number;
  level: number;
  hue: number;
  /** Movement speed (px/s). */
  speed: number;
  aggroRange: number;
  /** Melee reach, or (for ranged) maximum firing range. */
  attackRange: number;
  damage: number;
  attackCooldownMs: number;
  /** Combat archetype. Defaults to melee. */
  behavior: MobBehavior;
  /** Wind-up (ms) before an attack lands — the telegraph window players can dodge in (0 = instant). */
  telegraphMs: number;
  /** Ranged only: projectile speed (px/s). */
  projectileSpeed?: number;
  /** Ranged only: preferred minimum distance — the mob backs off to keep this gap. */
  kiteRange?: number;
  /** Melee only: if set, the strike is an AoE slam that hits every player within this radius. */
  slamRadius?: number;
  /** Charger only: dash speed (px/s) of the lunge after the wind-up. */
  dashSpeed?: number;
}

export const MOB_TEMPLATES: Record<string, MobTemplate> = {
  wolf: {
    id: 'wolf',
    name: 'Gloom Wolf',
    hp: 45,
    level: 3,
    hue: 25,
    speed: 110,
    aggroRange: 340,
    attackRange: 44,
    damage: 7,
    attackCooldownMs: 900,
    behavior: 'melee',
    telegraphMs: 220, // a quick lunge tell
  },
  skeleton: {
    id: 'skeleton',
    name: 'Crypt Skeleton',
    hp: 60,
    level: 5,
    hue: 210,
    speed: 80,
    aggroRange: 300,
    attackRange: 46,
    damage: 10,
    attackCooldownMs: 1100,
    behavior: 'melee',
    telegraphMs: 360,
  },
  bat: {
    id: 'bat',
    name: 'Cave Bat',
    hp: 24,
    level: 2,
    hue: 300,
    speed: 150,
    aggroRange: 260,
    attackRange: 38,
    damage: 5,
    attackCooldownMs: 700,
    behavior: 'melee',
    telegraphMs: 120, // a fast, hard-to-read flurry
  },
  // Ranged kiter: keeps its distance and lobs gloom-bolts with a clear wind-up.
  sprite: {
    id: 'sprite',
    name: 'Gloom Sprite',
    hp: 30,
    level: 4,
    hue: 150,
    speed: 120,
    aggroRange: 460,
    attackRange: 340,
    damage: 8,
    attackCooldownMs: 1500,
    behavior: 'ranged',
    telegraphMs: 600,
    projectileSpeed: 280,
    kiteRange: 200,
  },
  // Ranged caster in the crypt: slower, hits harder, longer tell.
  cultist: {
    id: 'cultist',
    name: 'Hooded Cultist',
    hp: 48,
    level: 6,
    hue: 330,
    speed: 70,
    aggroRange: 480,
    attackRange: 360,
    damage: 12,
    attackCooldownMs: 1700,
    behavior: 'ranged',
    telegraphMs: 650,
    projectileSpeed: 300,
    kiteRange: 220,
  },
  // Charger: closes the gap, winds up, then lunges through its target.
  boar: {
    id: 'boar',
    name: 'Gloom Boar',
    hp: 70,
    level: 5,
    hue: 18,
    speed: 95,
    aggroRange: 360,
    attackRange: 200, // charge-trigger distance
    damage: 14,
    attackCooldownMs: 2000,
    behavior: 'charger',
    telegraphMs: 500,
    dashSpeed: 520,
  },
  crypt_lord: {
    id: 'crypt_lord',
    name: 'Crypt Lord',
    hp: 400,
    level: 10,
    hue: 280,
    speed: 62,
    aggroRange: 420,
    attackRange: 64,
    damage: 22,
    attackCooldownMs: 1500,
    behavior: 'melee',
    telegraphMs: 660, // a big, readable slam — learn the rhythm to dodge
    slamRadius: 95, // hits everyone nearby, not just one target
  },

  // --- Rotfen Marsh (L8–12): a poison-soaked branch off Gloomwood ---
  marsh_leech: {
    id: 'marsh_leech',
    name: 'Marsh Leech',
    hp: 38,
    level: 8,
    hue: 90,
    speed: 160, // fast fodder that swarms
    aggroRange: 320,
    attackRange: 40,
    damage: 9,
    attackCooldownMs: 800,
    behavior: 'melee',
    telegraphMs: 160,
  },
  bog_shambler: {
    id: 'bog_shambler',
    name: 'Bog Shambler',
    hp: 130,
    level: 9,
    hue: 70,
    speed: 58, // slow, tanky
    aggroRange: 300,
    attackRange: 56,
    damage: 18,
    attackCooldownMs: 1400,
    behavior: 'melee',
    telegraphMs: 480,
  },
  mire_spitter: {
    id: 'mire_spitter',
    name: 'Mire Spitter',
    hp: 52,
    level: 9,
    hue: 110,
    speed: 95,
    aggroRange: 480,
    attackRange: 380,
    damage: 14,
    attackCooldownMs: 1600,
    behavior: 'ranged', // lobs venom from range
    telegraphMs: 620,
    projectileSpeed: 300,
    kiteRange: 240,
  },
  fen_strangler: {
    id: 'fen_strangler',
    name: 'Fen Strangler',
    hp: 96,
    level: 11,
    hue: 130,
    speed: 100,
    aggroRange: 380,
    attackRange: 210,
    damage: 20,
    attackCooldownMs: 2100,
    behavior: 'charger', // lunges out of the reeds
    telegraphMs: 520,
    dashSpeed: 540,
  },
  fenwitch: {
    id: 'fenwitch',
    name: 'The Fenwitch',
    hp: 320,
    level: 12,
    hue: 140,
    speed: 78,
    aggroRange: 520,
    attackRange: 420,
    damage: 24,
    attackCooldownMs: 1500,
    behavior: 'ranged', // the marsh mini-boss
    telegraphMs: 700,
    projectileSpeed: 320,
    kiteRange: 260,
  },

  // --- Emberdeep Mines (L12–16): a volcanic underground, gated past the crypt ---
  cinder_imp: {
    id: 'cinder_imp',
    name: 'Cinder Imp',
    hp: 60,
    level: 12,
    hue: 18,
    speed: 165, // fast harasser
    aggroRange: 340,
    attackRange: 42,
    damage: 13,
    attackCooldownMs: 760,
    behavior: 'melee',
    telegraphMs: 150,
  },
  magma_crawler: {
    id: 'magma_crawler',
    name: 'Magma Crawler',
    hp: 190,
    level: 13,
    hue: 12,
    speed: 54, // slow tank
    aggroRange: 300,
    attackRange: 60,
    damage: 24,
    attackCooldownMs: 1500,
    behavior: 'melee',
    telegraphMs: 520,
  },
  deep_cultist: {
    id: 'deep_cultist',
    name: 'Deep Cultist',
    hp: 90,
    level: 14,
    hue: 8, // a fire-hued reskin of the Hooded Cultist
    speed: 74,
    aggroRange: 500,
    attackRange: 380,
    damage: 20,
    attackCooldownMs: 1700,
    behavior: 'ranged',
    telegraphMs: 660,
    projectileSpeed: 320,
    kiteRange: 240,
  },
  forge_tyrant: {
    id: 'forge_tyrant',
    name: 'Forge Tyrant',
    hp: 620,
    level: 16,
    hue: 6,
    speed: 70,
    aggroRange: 460,
    attackRange: 80,
    damage: 30,
    attackCooldownMs: 1600,
    behavior: 'melee', // a slam boss guarding the exit
    telegraphMs: 720,
    slamRadius: 120,
  },

  // --- Frostpeak Pass (L15–20): ice highlands, the current act-end ---
  frost_wolf: {
    id: 'frost_wolf',
    name: 'Frost Wolf',
    hp: 120,
    level: 16,
    hue: 200, // an icy reskin of the Gloom Wolf
    speed: 120,
    aggroRange: 360,
    attackRange: 46,
    damage: 18,
    attackCooldownMs: 850,
    behavior: 'melee',
    telegraphMs: 220,
  },
  rime_archer: {
    id: 'rime_archer',
    name: 'Rime Archer',
    hp: 110,
    level: 17,
    hue: 195,
    speed: 90,
    aggroRange: 520,
    attackRange: 440,
    damage: 24,
    attackCooldownMs: 1500,
    behavior: 'ranged',
    telegraphMs: 600,
    projectileSpeed: 360,
    kiteRange: 280,
  },
  avalanche_shade: {
    id: 'avalanche_shade',
    name: 'Avalanche Shade',
    hp: 170,
    level: 18,
    hue: 210,
    speed: 110,
    aggroRange: 400,
    attackRange: 220,
    damage: 28,
    attackCooldownMs: 2100,
    behavior: 'charger',
    telegraphMs: 540,
    dashSpeed: 600,
  },
  tundra_behemoth: {
    id: 'tundra_behemoth',
    name: 'Tundra Behemoth',
    hp: 280,
    level: 19,
    hue: 205,
    speed: 50, // slow, heavy, long tell
    aggroRange: 320,
    attackRange: 72,
    damage: 34,
    attackCooldownMs: 1900,
    behavior: 'melee',
    telegraphMs: 820,
    slamRadius: 90,
  },
  pale_king: {
    id: 'pale_king',
    name: 'The Pale King',
    hp: 900,
    level: 20,
    hue: 215,
    speed: 76,
    aggroRange: 520,
    attackRange: 88,
    damage: 38,
    attackCooldownMs: 1500,
    behavior: 'melee', // the act-end boss
    telegraphMs: 700,
    slamRadius: 130,
  },

  // ===================================================================================
  // Dungeon bestiary — monsters that fill the procedural dungeons (and enrich invasions).
  // Spread across the level brackets; the four named bosses cap each dungeon.
  // ===================================================================================

  // L1-5
  rot_ghoul: {
    id: 'rot_ghoul',
    name: 'Rot Ghoul',
    hp: 50,
    level: 3,
    hue: 88,
    speed: 130,
    aggroRange: 320,
    attackRange: 44,
    damage: 7,
    attackCooldownMs: 850,
    behavior: 'melee',
    telegraphMs: 180,
  },
  carrion_swarm: {
    id: 'carrion_swarm',
    name: 'Carrion Swarm',
    hp: 28,
    level: 2,
    hue: 48,
    speed: 158,
    aggroRange: 280,
    attackRange: 38,
    damage: 5,
    attackCooldownMs: 700,
    behavior: 'melee',
    telegraphMs: 130,
  },
  thornling_archer: {
    id: 'thornling_archer',
    name: 'Thornling Archer',
    hp: 34,
    level: 4,
    hue: 110,
    speed: 105,
    aggroRange: 440,
    attackRange: 340,
    damage: 8,
    attackCooldownMs: 1500,
    behavior: 'ranged',
    telegraphMs: 540,
    projectileSpeed: 290,
    kiteRange: 210,
  },
  tusk_runner: {
    id: 'tusk_runner',
    name: 'Tusk Runner',
    hp: 60,
    level: 5,
    hue: 28,
    speed: 100,
    aggroRange: 360,
    attackRange: 200,
    damage: 9,
    attackCooldownMs: 1900,
    behavior: 'charger',
    telegraphMs: 480,
    dashSpeed: 530,
  },

  // L6-10
  plague_hound: {
    id: 'plague_hound',
    name: 'Plague Hound',
    hp: 58,
    level: 7,
    hue: 78,
    speed: 155,
    aggroRange: 340,
    attackRange: 42,
    damage: 11,
    attackCooldownMs: 780,
    behavior: 'melee',
    telegraphMs: 160,
  },
  grave_golem: {
    id: 'grave_golem',
    name: 'Grave Golem',
    hp: 130,
    level: 9,
    hue: 230,
    speed: 58,
    aggroRange: 300,
    attackRange: 58,
    damage: 17,
    attackCooldownMs: 1400,
    behavior: 'melee',
    telegraphMs: 500,
  },
  ember_acolyte: {
    id: 'ember_acolyte',
    name: 'Ember Acolyte',
    hp: 70,
    level: 8,
    hue: 22,
    speed: 80,
    aggroRange: 480,
    attackRange: 360,
    damage: 14,
    attackCooldownMs: 1650,
    behavior: 'ranged',
    telegraphMs: 620,
    projectileSpeed: 300,
    kiteRange: 230,
  },
  abyssal_warden: {
    id: 'abyssal_warden',
    name: 'Abyssal Warden',
    hp: 300,
    level: 10,
    hue: 270,
    speed: 66,
    aggroRange: 440,
    attackRange: 70,
    damage: 26,
    attackCooldownMs: 1600,
    behavior: 'melee',
    telegraphMs: 700,
    slamRadius: 100,
  },

  // L10-15
  bile_ooze: {
    id: 'bile_ooze',
    name: 'Bile Ooze',
    hp: 110,
    level: 12,
    hue: 95,
    speed: 60,
    aggroRange: 300,
    attackRange: 56,
    damage: 16,
    attackCooldownMs: 1350,
    behavior: 'melee',
    telegraphMs: 460,
    slamRadius: 70,
  },
  shardspine_hurler: {
    id: 'shardspine_hurler',
    name: 'Shardspine Hurler',
    hp: 90,
    level: 13,
    hue: 188,
    speed: 92,
    aggroRange: 500,
    attackRange: 400,
    damage: 19,
    attackCooldownMs: 1600,
    behavior: 'ranged',
    telegraphMs: 600,
    projectileSpeed: 320,
    kiteRange: 250,
  },
  gravetide_revenant: {
    id: 'gravetide_revenant',
    name: 'Gravetide Revenant',
    hp: 150,
    level: 14,
    hue: 255,
    speed: 108,
    aggroRange: 400,
    attackRange: 210,
    damage: 22,
    attackCooldownMs: 2100,
    behavior: 'charger',
    telegraphMs: 520,
    dashSpeed: 560,
  },
  molten_colossus: {
    id: 'molten_colossus',
    name: 'Molten Colossus',
    hp: 560,
    level: 15,
    hue: 14,
    speed: 62,
    aggroRange: 460,
    attackRange: 78,
    damage: 30,
    attackCooldownMs: 1600,
    behavior: 'melee',
    telegraphMs: 740,
    slamRadius: 115,
  },

  // L15-26
  wraithfrost_stalker: {
    id: 'wraithfrost_stalker',
    name: 'Wraithfrost Stalker',
    hp: 160,
    level: 17,
    hue: 198,
    speed: 150,
    aggroRange: 360,
    attackRange: 46,
    damage: 20,
    attackCooldownMs: 820,
    behavior: 'melee',
    telegraphMs: 200,
  },
  hollow_runeseer: {
    id: 'hollow_runeseer',
    name: 'Hollow Runeseer',
    hp: 140,
    level: 18,
    hue: 285,
    speed: 86,
    aggroRange: 520,
    attackRange: 430,
    damage: 26,
    attackCooldownMs: 1500,
    behavior: 'ranged',
    telegraphMs: 640,
    projectileSpeed: 350,
    kiteRange: 270,
  },
  obsidian_juggernaut: {
    id: 'obsidian_juggernaut',
    name: 'Obsidian Juggernaut',
    hp: 260,
    level: 22,
    hue: 260,
    speed: 90,
    aggroRange: 420,
    attackRange: 215,
    damage: 32,
    attackCooldownMs: 2200,
    behavior: 'charger',
    telegraphMs: 560,
    dashSpeed: 590,
  },
  voidmaw_devourer: {
    id: 'voidmaw_devourer',
    name: 'Voidmaw Devourer',
    hp: 1050,
    level: 25,
    hue: 295,
    speed: 72,
    aggroRange: 520,
    attackRange: 86,
    damage: 42,
    attackCooldownMs: 1500,
    behavior: 'melee',
    telegraphMs: 800,
    slamRadius: 135,
  },

  // --- Named dungeon bosses (one per dungeon) ---
  maggath: {
    id: 'maggath',
    name: 'Maggath, the Bonecaller',
    hp: 460,
    level: 9,
    hue: 270,
    speed: 60,
    aggroRange: 460,
    attackRange: 76,
    damage: 24,
    attackCooldownMs: 1600,
    behavior: 'melee',
    telegraphMs: 700,
    slamRadius: 110,
  },
  vorraxia: {
    id: 'vorraxia',
    name: 'Vorraxia, the Brood Mother',
    hp: 700,
    level: 14,
    hue: 95,
    speed: 56,
    aggroRange: 460,
    attackRange: 80,
    damage: 28,
    attackCooldownMs: 1700,
    behavior: 'melee',
    telegraphMs: 720,
    slamRadius: 120,
  },
  balthuzar: {
    id: 'balthuzar',
    name: "Bal'thuzar, the Forgemaster",
    hp: 860,
    level: 19,
    hue: 14,
    speed: 64,
    aggroRange: 480,
    attackRange: 84,
    damage: 34,
    attackCooldownMs: 1600,
    behavior: 'melee',
    telegraphMs: 760,
    slamRadius: 125,
  },
  kaldris: {
    id: 'kaldris',
    name: 'Kaldris, the Warden Eternal',
    hp: 1000,
    level: 23,
    hue: 200,
    speed: 60,
    aggroRange: 520,
    attackRange: 88,
    damage: 40,
    attackCooldownMs: 1500,
    behavior: 'melee',
    telegraphMs: 800,
    slamRadius: 135,
  },

  // --- The Sundered Wastes (act 2, L20-26): a void-scarred end-of-world highland ---
  void_revenant: {
    id: 'void_revenant',
    name: 'Void Revenant',
    hp: 180,
    level: 21,
    hue: 290,
    speed: 120,
    aggroRange: 380,
    attackRange: 50,
    damage: 26,
    attackCooldownMs: 950,
    behavior: 'melee',
    telegraphMs: 240,
  },
  ashen_warlock: {
    id: 'ashen_warlock',
    name: 'Ashen Warlock',
    hp: 150,
    level: 22,
    hue: 28,
    speed: 84,
    aggroRange: 520,
    attackRange: 430,
    damage: 28,
    attackCooldownMs: 1500,
    behavior: 'ranged',
    telegraphMs: 640,
    projectileSpeed: 350,
    kiteRange: 270,
  },
  xalthirun: {
    id: 'xalthirun',
    name: "Xal'thirun, the Unmaker",
    hp: 1200,
    level: 26,
    hue: 300,
    speed: 70,
    aggroRange: 540,
    attackRange: 90,
    damage: 44,
    attackCooldownMs: 1500,
    behavior: 'melee', // the act-2 boss
    telegraphMs: 820,
    slamRadius: 140,
  },

  // --- The Blighted Spire (act 3, L27-32): a corrupted citadel, the new endgame ceiling ---
  blight_knight: {
    id: 'blight_knight',
    name: 'Blight Knight',
    hp: 240,
    level: 27,
    hue: 110,
    speed: 100,
    aggroRange: 400,
    attackRange: 54,
    damage: 30,
    attackCooldownMs: 1000,
    behavior: 'melee',
    telegraphMs: 280,
  },
  pyre_caster: {
    id: 'pyre_caster',
    name: 'Pyre Caster',
    hp: 180,
    level: 28,
    hue: 18,
    speed: 84,
    aggroRange: 540,
    attackRange: 440,
    damage: 30,
    attackCooldownMs: 1600,
    behavior: 'ranged', // hurls Meteor (see MOB_SPELLS) — burns on hit
    telegraphMs: 680,
    projectileSpeed: 320,
    kiteRange: 280,
  },
  ruin_colossus: {
    id: 'ruin_colossus',
    name: 'Ruin Colossus',
    hp: 420,
    level: 29,
    hue: 30,
    speed: 56,
    aggroRange: 460,
    attackRange: 84,
    damage: 36,
    attackCooldownMs: 1700,
    behavior: 'melee',
    telegraphMs: 760,
    slamRadius: 130,
  },
  throne_tyrant: {
    id: 'throne_tyrant',
    name: 'Vorzel, the Throne-Tyrant',
    hp: 1500,
    level: 32,
    hue: 320,
    speed: 68,
    aggroRange: 560,
    attackRange: 94,
    damage: 48,
    attackCooldownMs: 1500,
    behavior: 'melee', // the act-3 boss
    telegraphMs: 840,
    slamRadius: 150,
  },

  // ===================================================================================
  // Expansion bestiary — fills out the overworld zones with creatures drawn from the
  // so-far-unused 32rogues sprites (kobolds, orcs, ettins, nagas, drakes…). Seeded into
  // areas + loot via src/server/db/seed-expansion.ts.
  // ===================================================================================

  // --- Gloomwood Wilderness (L2-5) ---
  thistle_kobold: {
    id: 'thistle_kobold',
    name: 'Thistle Kobold',
    hp: 26,
    level: 2,
    hue: 95,
    speed: 145, // skittering fodder, like the Cave Bat
    aggroRange: 280,
    attackRange: 40,
    damage: 5,
    attackCooldownMs: 750,
    behavior: 'melee',
    telegraphMs: 140,
  },
  mosshide_orc: {
    id: 'mosshide_orc',
    name: 'Mosshide Orc',
    hp: 55,
    level: 4,
    hue: 105,
    speed: 95,
    aggroRange: 330,
    attackRange: 48,
    damage: 8,
    attackCooldownMs: 1000,
    behavior: 'melee',
    telegraphMs: 300,
  },
  shadowmaw_bear: {
    id: 'shadowmaw_bear',
    name: 'Shadowmaw Bear',
    hp: 85,
    level: 5,
    hue: 28,
    speed: 90, // the wilderness bruiser — slow but heavy
    aggroRange: 320,
    attackRange: 52,
    damage: 12,
    attackCooldownMs: 1300,
    behavior: 'melee',
    telegraphMs: 420,
  },

  // --- Rotfen Marsh (L8-12) ---
  rotfen_naga: {
    id: 'rotfen_naga',
    name: 'Rotfen Naga',
    hp: 60,
    level: 10,
    hue: 120,
    speed: 92,
    aggroRange: 480,
    attackRange: 370,
    damage: 16,
    attackCooldownMs: 1650,
    behavior: 'ranged', // spits venom from the reeds (see MOB_SPELLS)
    telegraphMs: 620,
    projectileSpeed: 300,
    kiteRange: 230,
  },
  fen_ettin: {
    id: 'fen_ettin',
    name: 'Rotfen Ettin',
    hp: 160,
    level: 11,
    hue: 80,
    speed: 55, // two heads, one slow slam
    aggroRange: 320,
    attackRange: 60,
    damage: 20,
    attackCooldownMs: 1600,
    behavior: 'melee',
    telegraphMs: 560,
    slamRadius: 85,
  },

  // --- Emberdeep Mines (L12-16) ---
  gloomcap_myconid: {
    id: 'gloomcap_myconid',
    name: 'Gloomcap Myconid',
    hp: 75,
    level: 12,
    hue: 265,
    speed: 60, // a shuffling fungus that lobs spore-bursts
    aggroRange: 460,
    attackRange: 360,
    damage: 17,
    attackCooldownMs: 1700,
    behavior: 'ranged',
    telegraphMs: 640,
    projectileSpeed: 290,
    kiteRange: 220,
  },
  basalt_basilisk: {
    id: 'basalt_basilisk',
    name: 'Basalt Basilisk',
    hp: 165,
    level: 15,
    hue: 16,
    speed: 85,
    aggroRange: 380,
    attackRange: 215, // charge-trigger distance
    damage: 24,
    attackCooldownMs: 2200,
    behavior: 'charger', // a heavy, well-telegraphed lunge
    telegraphMs: 560,
    dashSpeed: 540,
  },

  // --- Frostpeak Pass (L15-20) ---
  gnarlfang_lycan: {
    id: 'gnarlfang_lycan',
    name: 'Gnarlfang Lycan',
    hp: 150,
    level: 17,
    hue: 220,
    speed: 155, // a sprinting pack-hunter (see MOB_SUPPORT)
    aggroRange: 380,
    attackRange: 46,
    damage: 19,
    attackCooldownMs: 800,
    behavior: 'melee',
    telegraphMs: 190,
  },
  crag_manticore: {
    id: 'crag_manticore',
    name: 'Crag Manticore',
    hp: 150,
    level: 18,
    hue: 192,
    speed: 95,
    aggroRange: 520,
    attackRange: 430,
    damage: 25,
    attackCooldownMs: 1550,
    behavior: 'ranged', // flings tail-spikes from the cliffs
    telegraphMs: 620,
    projectileSpeed: 350,
    kiteRange: 270,
  },

  // --- The Sundered Wastes (L20-26) ---
  riftwing_harpy: {
    id: 'riftwing_harpy',
    name: 'Riftwing Harpy',
    hp: 170,
    level: 21,
    hue: 305,
    speed: 125,
    aggroRange: 420,
    attackRange: 220,
    damage: 27,
    attackCooldownMs: 2100,
    behavior: 'charger', // a fast diving strike
    telegraphMs: 500,
    dashSpeed: 620,
  },
  voidscale_drake: {
    id: 'voidscale_drake',
    name: 'Voidscale Drake',
    hp: 210,
    level: 24,
    hue: 280,
    speed: 88,
    aggroRange: 540,
    attackRange: 440,
    damage: 30,
    attackCooldownMs: 1600,
    behavior: 'ranged', // breathes searing orbs (see MOB_SPELLS)
    telegraphMs: 660,
    projectileSpeed: 340,
    kiteRange: 280,
  },

  // ===================================================================================
  // The Abyssal Throne (the endgame dungeon, L30-40) — seeded via seed-frontier.ts.
  // Floor mobs stay under hp 200 (so traits apply); the throne guards and the Sovereign
  // are boss-tier (hp >= 200, traitless) with their own mechanics.
  // ===================================================================================
  abyss_thrall: {
    id: 'abyss_thrall',
    name: 'Abyssal Thrall',
    hp: 170,
    level: 30,
    hue: 275,
    speed: 125, // shuffling dead, but a lot of them
    aggroRange: 380,
    attackRange: 48,
    damage: 30,
    attackCooldownMs: 900,
    behavior: 'melee',
    telegraphMs: 240,
  },
  duskfire_hexer: {
    id: 'duskfire_hexer',
    name: 'Duskfire Hexer',
    hp: 160,
    level: 31,
    hue: 315,
    speed: 86,
    aggroRange: 540,
    attackRange: 440,
    damage: 32,
    attackCooldownMs: 1550,
    behavior: 'ranged', // hurls shadow bolts (see MOB_SPELLS)
    telegraphMs: 660,
    projectileSpeed: 340,
    kiteRange: 280,
  },
  thronespawn_ravager: {
    id: 'thronespawn_ravager',
    name: 'Thronespawn Ravager',
    hp: 190,
    level: 33,
    hue: 350,
    speed: 105,
    aggroRange: 440,
    attackRange: 230, // charge-trigger distance
    damage: 38,
    attackCooldownMs: 2200,
    behavior: 'charger', // a corridor-length pounce
    telegraphMs: 560,
    dashSpeed: 640,
  },
  // The two throne guards: a slam elite and a ranged caster elite, roaming the floor.
  throne_sentinel: {
    id: 'throne_sentinel',
    name: 'Sentinel of the Black Throne',
    hp: 400,
    level: 34,
    hue: 310,
    speed: 70,
    aggroRange: 480,
    attackRange: 80,
    damage: 40,
    attackCooldownMs: 1600,
    behavior: 'melee', // a wide, readable slam
    telegraphMs: 760,
    slamRadius: 115,
  },
  throne_magus: {
    id: 'throne_magus',
    name: 'Magus of the Black Throne',
    hp: 340,
    level: 36,
    hue: 265,
    speed: 86,
    aggroRange: 560,
    attackRange: 450,
    damage: 38,
    attackCooldownMs: 1500,
    behavior: 'ranged', // casts Thunder Lance (see MOB_SPELLS)
    telegraphMs: 660,
    projectileSpeed: 360,
    kiteRange: 280,
  },
  // The apex boss of the game: a charging horror — survive the rush, punish the recovery.
  nyxathor: {
    id: 'nyxathor',
    name: 'Nyxathor, the Abyssal Sovereign',
    hp: 1500,
    level: 40,
    hue: 335,
    speed: 84,
    aggroRange: 600,
    attackRange: 240, // charge-trigger distance
    damage: 56,
    attackCooldownMs: 2100,
    behavior: 'charger',
    telegraphMs: 680,
    dashSpeed: 700,
  },

  // --- The Blighted Spire (L27-32) ---
  blightgore_minotaur: {
    id: 'blightgore_minotaur',
    name: 'Blightgore Minotaur',
    hp: 300,
    level: 29,
    hue: 95,
    speed: 95,
    aggroRange: 440,
    attackRange: 225,
    damage: 35,
    attackCooldownMs: 2300,
    behavior: 'charger', // a hallway-clearing bull rush
    telegraphMs: 580,
    dashSpeed: 610,
  },

  // ===================================================================================
  // Act 2 road bestiary (L21-31) — the zones west of Duskhaven (seed-acts.ts): the
  // Grimfrost Barrows, the Howling Barrens, and the Sunken Pass. Floor mobs stay under
  // hp 200 (traits apply); Maelgor is the road's mid-boss.
  // ===================================================================================
  barrow_wight: {
    id: 'barrow_wight',
    name: 'Barrow Wight',
    hp: 165,
    level: 21,
    hue: 235,
    speed: 115,
    aggroRange: 380,
    attackRange: 48,
    damage: 26,
    attackCooldownMs: 950,
    behavior: 'melee', // drains with a grave-cold touch (see MOB_SPELLS)
    telegraphMs: 260,
  },
  cairn_banshee: {
    id: 'cairn_banshee',
    name: 'Cairn Banshee',
    hp: 140,
    level: 22,
    hue: 250,
    speed: 88,
    aggroRange: 520,
    attackRange: 430,
    damage: 27,
    attackCooldownMs: 1550,
    behavior: 'ranged', // wails shadow bolts across the ice (see MOB_SPELLS)
    telegraphMs: 640,
    projectileSpeed: 340,
    kiteRange: 270,
  },
  barrens_warg: {
    id: 'barrens_warg',
    name: 'Barrens Warg',
    hp: 175,
    level: 24,
    hue: 215,
    speed: 150, // pack-hunter of the pines
    aggroRange: 380,
    attackRange: 46,
    damage: 28,
    attackCooldownMs: 820,
    behavior: 'melee',
    telegraphMs: 200,
  },
  hexpine_shaman: {
    id: 'hexpine_shaman',
    name: 'Hexpine Shaman',
    hp: 160,
    level: 26,
    hue: 100,
    speed: 84,
    aggroRange: 520,
    attackRange: 430,
    damage: 30,
    attackCooldownMs: 1600,
    behavior: 'ranged', // a support caster — roars itself into a frenzy (see MOB_SUPPORT)
    telegraphMs: 650,
    projectileSpeed: 340,
    kiteRange: 270,
  },
  drowned_hulk: {
    id: 'drowned_hulk',
    name: 'Drowned Hulk',
    hp: 195,
    level: 29,
    hue: 175,
    speed: 60, // waterlogged and slow, and it will not stay down (see MOB_SUPPORT)
    aggroRange: 320,
    attackRange: 64,
    damage: 36,
    attackCooldownMs: 1600,
    behavior: 'melee',
    telegraphMs: 560,
    slamRadius: 90,
  },
  tidegrave_lurker: {
    id: 'tidegrave_lurker',
    name: 'Tidegrave Lurker',
    hp: 180,
    level: 30,
    hue: 185,
    speed: 110,
    aggroRange: 430,
    attackRange: 225, // charge-trigger distance
    damage: 38,
    attackCooldownMs: 2200,
    behavior: 'charger', // erupts from the floodwater
    telegraphMs: 560,
    dashSpeed: 620,
  },
  // The Act 2 road's mid-boss, holding the Sunken Pass gate (quest: pass_tidewarden).
  maelgor: {
    id: 'maelgor',
    name: 'Maelgor, the Tidewarden',
    hp: 330,
    level: 31,
    hue: 195,
    speed: 66,
    aggroRange: 500,
    attackRange: 84,
    damage: 42,
    attackCooldownMs: 1600,
    behavior: 'melee',
    telegraphMs: 760,
    slamRadius: 125,
  },

  // ===================================================================================
  // Act 3 bestiary (L40-60) — the dead lands beyond Vhal'reth (seed-acts.ts): the
  // Ashveil Desert, the Shattered Causeway, the Voidmarch, and the Unmade Court.
  // Floor mobs stay under hp 200; the zone mid-bosses, the Court's guards, and
  // Athraxis are boss-tier with their own mechanics.
  // ===================================================================================
  ash_dire_wolf: {
    id: 'ash_dire_wolf',
    name: 'Ashen Dire Wolf',
    hp: 175,
    level: 40,
    hue: 20,
    speed: 145, // dune pack-hunter
    aggroRange: 380,
    attackRange: 46,
    damage: 42,
    attackCooldownMs: 850,
    behavior: 'melee',
    telegraphMs: 210,
  },
  cinderbone_archer: {
    id: 'cinderbone_archer',
    name: 'Cinderbone Archer',
    hp: 160,
    level: 41,
    hue: 24,
    speed: 92,
    aggroRange: 540,
    attackRange: 450,
    damage: 44,
    attackCooldownMs: 1500,
    behavior: 'ranged', // looses cinder orbs (see MOB_SPELLS)
    telegraphMs: 620,
    projectileSpeed: 360,
    kiteRange: 280,
  },
  ashveil_gorgon: {
    id: 'ashveil_gorgon',
    name: 'Ashveil Gorgon',
    hp: 190,
    level: 43,
    hue: 140,
    speed: 86,
    aggroRange: 540,
    attackRange: 440,
    damage: 46,
    attackCooldownMs: 1650,
    behavior: 'ranged', // a petrifying gaze — frost lances that slow (see MOB_SPELLS)
    telegraphMs: 660,
    projectileSpeed: 340,
    kiteRange: 280,
  },
  causeway_golem: {
    id: 'causeway_golem',
    name: 'Causeway Golem',
    hp: 195,
    level: 45,
    hue: 240,
    speed: 62, // the bridge's old wardens, still keeping the toll
    aggroRange: 330,
    attackRange: 66,
    damage: 50,
    attackCooldownMs: 1650,
    behavior: 'melee',
    telegraphMs: 600,
    slamRadius: 95,
  },
  voidtouched_centaur: {
    id: 'voidtouched_centaur',
    name: 'Voidtouched Centaur',
    hp: 180,
    level: 46,
    hue: 285,
    speed: 120,
    aggroRange: 450,
    attackRange: 235, // charge-trigger distance
    damage: 52,
    attackCooldownMs: 2200,
    behavior: 'charger', // a lance-charge out of the murk (see MOB_SUPPORT: sprint)
    telegraphMs: 540,
    dashSpeed: 650,
  },
  null_revenant: {
    id: 'null_revenant',
    name: 'Null Revenant',
    hp: 195,
    level: 49,
    hue: 265,
    speed: 128,
    aggroRange: 400,
    attackRange: 50,
    damage: 55,
    attackCooldownMs: 900,
    behavior: 'melee',
    telegraphMs: 240,
  },
  // The Ashveil Desert's mid-boss (quest: ash_tyrant).
  sarghul: {
    id: 'sarghul',
    name: 'Sarghul, the Ash-Tyrant',
    hp: 450,
    level: 44,
    hue: 28,
    speed: 70,
    aggroRange: 500,
    attackRange: 86,
    damage: 58,
    attackCooldownMs: 1600,
    behavior: 'melee',
    telegraphMs: 780,
    slamRadius: 130,
  },
  // The Voidmarch's mid-boss (quest: void_matron).
  vessirah: {
    id: 'vessirah',
    name: "Vess'irah, the Void Hag",
    hp: 520,
    level: 52,
    hue: 305,
    speed: 80,
    aggroRange: 560,
    attackRange: 450,
    damage: 60,
    attackCooldownMs: 1500,
    behavior: 'ranged', // hurls arcane orbs (see MOB_SPELLS)
    telegraphMs: 700,
    projectileSpeed: 360,
    kiteRange: 290,
  },
  // The Unmade Court's two named guards: a slam elite and a caster elite.
  court_executioner: {
    id: 'court_executioner',
    name: 'Executioner of the Unmade Court',
    hp: 660,
    level: 57,
    hue: 345,
    speed: 72,
    aggroRange: 520,
    attackRange: 88,
    damage: 68,
    attackCooldownMs: 1600,
    behavior: 'melee', // a wide, readable slam
    telegraphMs: 780,
    slamRadius: 130,
  },
  court_oracle: {
    id: 'court_oracle',
    name: 'Oracle of the Unmade Court',
    hp: 580,
    level: 58,
    hue: 270,
    speed: 84,
    aggroRange: 580,
    attackRange: 460,
    damage: 64,
    attackCooldownMs: 1500,
    behavior: 'ranged', // casts Thunder Lance (see MOB_SPELLS)
    telegraphMs: 680,
    projectileSpeed: 370,
    kiteRange: 290,
  },
  // The true end of the game: a hollowed god on an unmade throne. Slow, enormous slams —
  // learn the rhythm or be erased.
  athraxis: {
    id: 'athraxis',
    name: 'Athraxis, the Unmade God',
    hp: 3000,
    level: 60,
    hue: 55,
    speed: 82,
    aggroRange: 620,
    attackRange: 96,
    damage: 78,
    attackCooldownMs: 1500,
    behavior: 'melee',
    telegraphMs: 880,
    slamRadius: 160,
  },

  // ===================================================================================
  // Wilds bestiary — wildlife and vermin that fill the ecological gaps across the world,
  // each drawn from a so-far-unused 32rogues sprite (spider, satyr, rat, snake, ant,
  // cockatrice, earthworm). Spread early→mid-late so every act gains a roaming species.
  // Seeded into areas + loot via src/server/db/seed-wilds.ts.
  // ===================================================================================

  // --- Gloomwood Wilderness (L2-5): a venom-fanged ambusher and a goat-legged charger. ---
  gloomweb_spider: {
    id: 'gloomweb_spider',
    name: 'Gloomweb Spider',
    hp: 28,
    level: 3,
    hue: 280,
    speed: 150, // a fast, flanking skitter
    aggroRange: 300,
    attackRange: 40,
    damage: 6,
    attackCooldownMs: 800,
    behavior: 'melee',
    telegraphMs: 150,
  },
  bramble_satyr: {
    id: 'bramble_satyr',
    name: 'Bramble Satyr',
    hp: 64,
    level: 5,
    hue: 110,
    speed: 100,
    aggroRange: 360,
    attackRange: 190, // charge-trigger distance
    damage: 12,
    attackCooldownMs: 1900,
    behavior: 'charger',
    telegraphMs: 480,
    dashSpeed: 500,
  },

  // --- Shadow Crypt (L5-7): skittering tomb vermin that swarm and flee when alone. ---
  tomb_rat: {
    id: 'tomb_rat',
    name: 'Tomb Rat',
    hp: 22,
    level: 5,
    hue: 30,
    speed: 155,
    aggroRange: 260,
    attackRange: 36,
    damage: 6,
    attackCooldownMs: 700,
    behavior: 'melee',
    telegraphMs: 130,
  },

  // --- Rotfen Marsh (L8-12): a venom-spitting serpent that kites from the reeds. ---
  mire_serpent: {
    id: 'mire_serpent',
    name: 'Mire Serpent',
    hp: 70,
    level: 9,
    hue: 140,
    speed: 105,
    aggroRange: 470,
    attackRange: 350,
    damage: 13,
    attackCooldownMs: 1600,
    behavior: 'ranged',
    telegraphMs: 600,
    projectileSpeed: 300,
    kiteRange: 210,
  },

  // --- Emberdeep Mines (L12-16): a chitinous swarm-ant from the deep galleries. ---
  cinder_ant: {
    id: 'cinder_ant',
    name: 'Cinder Ant',
    hp: 110,
    level: 14,
    hue: 18,
    speed: 120,
    aggroRange: 320,
    attackRange: 46,
    damage: 18,
    attackCooldownMs: 1000,
    behavior: 'melee',
    telegraphMs: 220,
  },

  // --- Frostpeak Pass (L15-20): a petrifying cockatrice whose gaze-bolt slows on hit. ---
  wyrmcrag_cockatrice: {
    id: 'wyrmcrag_cockatrice',
    name: 'Wyrmcrag Cockatrice',
    hp: 150,
    level: 18,
    hue: 200,
    speed: 110,
    aggroRange: 500,
    attackRange: 360,
    damage: 22,
    attackCooldownMs: 1700,
    behavior: 'ranged',
    telegraphMs: 680,
    projectileSpeed: 320,
    kiteRange: 230,
  },

  // --- The Sundered Wastes (L20-26): a void-bloated burrower that heaves up to slam. ---
  sundered_worm: {
    id: 'sundered_worm',
    name: 'Sundered Worm',
    hp: 190,
    level: 24,
    hue: 300,
    speed: 78,
    aggroRange: 340,
    attackRange: 60,
    damage: 30,
    attackCooldownMs: 1500,
    behavior: 'melee',
    telegraphMs: 560,
    slamRadius: 120,
  },

  // --- Act 2 road wilds (L22-28): a barrow swarm, a pine ambusher, a drowned caster. ---
  barrow_vermin: {
    id: 'barrow_vermin',
    name: 'Barrow Vermin',
    hp: 95,
    level: 22,
    hue: 210,
    speed: 160, // a fast grave-rat swarm amid the slow barrow dead
    aggroRange: 280,
    attackRange: 40,
    damage: 16,
    attackCooldownMs: 720,
    behavior: 'melee',
    telegraphMs: 140,
  },
  pineweb_spider: {
    id: 'pineweb_spider',
    name: 'Pineweb Spider',
    hp: 130,
    level: 24,
    hue: 90,
    speed: 150,
    aggroRange: 320,
    attackRange: 44,
    damage: 22,
    attackCooldownMs: 900,
    behavior: 'melee',
    telegraphMs: 170,
  },
  drowned_serpent: {
    id: 'drowned_serpent',
    name: 'Tidefang Serpent',
    hp: 160,
    level: 28,
    hue: 150,
    speed: 110,
    aggroRange: 480,
    attackRange: 360,
    damage: 28,
    attackCooldownMs: 1600,
    behavior: 'ranged',
    telegraphMs: 640,
    projectileSpeed: 320,
    kiteRange: 230,
  },
};

export interface AreaMobSpawn {
  templateId: string;
  count: number;
}

/** Which monsters populate each area. Town is a safe zone. */
export const AREA_MOBS: Record<string, AreaMobSpawn[]> = {
  town: [],
  duskhaven: [], // the frontier village is a safe zone, like town
  wilderness: [
    { templateId: 'wolf', count: 6 },
    { templateId: 'sprite', count: 3 },
    { templateId: 'boar', count: 2 },
  ],
  crypt: [
    { templateId: 'skeleton', count: 5 },
    { templateId: 'bat', count: 4 },
    { templateId: 'cultist', count: 3 },
    { templateId: 'crypt_lord', count: 1 },
  ],
  marsh: [
    { templateId: 'marsh_leech', count: 7 },
    { templateId: 'bog_shambler', count: 3 },
    { templateId: 'mire_spitter', count: 3 },
    { templateId: 'fen_strangler', count: 2 },
    { templateId: 'fenwitch', count: 1 },
  ],
  mines: [
    { templateId: 'cinder_imp', count: 6 },
    { templateId: 'magma_crawler', count: 3 },
    { templateId: 'deep_cultist', count: 3 },
    { templateId: 'forge_tyrant', count: 1 },
  ],
  frostpeak: [
    { templateId: 'frost_wolf', count: 6 },
    { templateId: 'rime_archer', count: 3 },
    { templateId: 'avalanche_shade', count: 2 },
    { templateId: 'tundra_behemoth', count: 2 },
    { templateId: 'pale_king', count: 1 },
  ],
  sundered_wastes: [
    { templateId: 'void_revenant', count: 7 },
    { templateId: 'ashen_warlock', count: 3 },
    { templateId: 'obsidian_juggernaut', count: 2 },
    { templateId: 'hollow_runeseer', count: 2 },
    { templateId: 'xalthirun', count: 1 },
  ],
  blighted_spire: [
    { templateId: 'blight_knight', count: 7 },
    { templateId: 'pyre_caster', count: 3 },
    { templateId: 'ruin_colossus', count: 3 },
    { templateId: 'throne_tyrant', count: 1 },
  ],
  // --- Act 2 road (L21-31): Duskhaven → the Blighted Spire ---
  grimfrost_barrow: [
    { templateId: 'barrow_wight', count: 5 },
    { templateId: 'cairn_banshee', count: 4 },
    { templateId: 'void_revenant', count: 4 },
    { templateId: 'obsidian_juggernaut', count: 3 },
  ],
  howling_barrens: [
    { templateId: 'barrens_warg', count: 5 },
    { templateId: 'riftwing_harpy', count: 4 },
    { templateId: 'hexpine_shaman', count: 3 },
    { templateId: 'voidscale_drake', count: 3 },
    { templateId: 'blight_knight', count: 3 },
  ],
  sunken_pass: [
    { templateId: 'drowned_hulk', count: 5 },
    { templateId: 'tidegrave_lurker', count: 4 },
    { templateId: 'pyre_caster', count: 3 },
    { templateId: 'ruin_colossus', count: 3 },
    { templateId: 'maelgor', count: 1 },
  ],
  // --- Act 3 (L40-52): the dead lands beyond Vhal'reth ---
  vhalreth: [], // the last city is a safe zone, like town
  ashveil_desert: [
    { templateId: 'ash_dire_wolf', count: 5 },
    { templateId: 'cinderbone_archer', count: 4 },
    { templateId: 'ashveil_gorgon', count: 3 },
    { templateId: 'thronespawn_ravager', count: 3 },
    { templateId: 'sarghul', count: 1 },
  ],
  shattered_causeway: [
    { templateId: 'causeway_golem', count: 5 },
    { templateId: 'voidtouched_centaur', count: 4 },
    { templateId: 'abyss_thrall', count: 4 },
    { templateId: 'cinderbone_archer', count: 3 },
    { templateId: 'blightgore_minotaur', count: 3 },
  ],
  voidmarch: [
    { templateId: 'null_revenant', count: 5 },
    { templateId: 'duskfire_hexer', count: 4 },
    { templateId: 'ashveil_gorgon', count: 3 },
    { templateId: 'throne_magus', count: 3 },
    { templateId: 'vessirah', count: 1 },
  ],
};

/**
 * Spellcaster monsters: the ability a mob casts *in place of* its basic attack (on its normal attack
 * cadence). Projectile spells suit ranged mobs (fired along the aim); melee/nova spells suit melee
 * mobs (cone around the mob). The spell's on-hit status (frost slows, fire burns, curses weaken) is
 * applied to the *player* it hits — this is how monsters debuff you.
 */
export const MOB_SPELLS: Record<string, AbilityId> = {
  sprite: 'frostshard', // gloom sprites lob chilling shards
  cultist: 'shadow_bolt',
  thornling_archer: 'entangling_vines',
  mire_spitter: 'poison_spit',
  fenwitch: 'venom',
  deep_cultist: 'fireball',
  shardspine_hurler: 'frostlance',
  rime_archer: 'frost',
  ashen_warlock: 'cinderorb',
  hollow_runeseer: 'arcane_orb',
  pyre_caster: 'meteor',
  // Expansion bestiary casters.
  rotfen_naga: 'venom',
  gloomcap_myconid: 'poison_spit',
  crag_manticore: 'frostlance',
  voidscale_drake: 'cinderorb',
  // Abyssal Throne casters.
  duskfire_hexer: 'shadow_bolt',
  throne_magus: 'thunderlance',
  // Act 2 road casters.
  barrow_wight: 'draining_touch', // a grave-cold melee drain
  cairn_banshee: 'shadow_bolt',
  // Act 3 casters.
  cinderbone_archer: 'cinderorb',
  ashveil_gorgon: 'frostlance', // the petrifying gaze — slows on hit
  vessirah: 'arcane_orb',
  court_oracle: 'thunderlance',
  // Wilds bestiary casters.
  mire_serpent: 'poison_spit', // a venom bolt from the reeds
  wyrmcrag_cockatrice: 'frostlance', // the petrifying gaze — slows on hit
  drowned_serpent: 'venom', // a heavier venom bolt down the drowned road
};

/**
 * Support-caster monsters: a buff or heal a mob casts on *itself* periodically while in a fight
 * (separate from its basic attack). War Cry enrages (more damage), Sprint hastes (faster), Renew is
 * a self heal-over-time — monsters using the buff/heal spells.
 */
export const MOB_SUPPORT: Record<string, AbilityId> = {
  ember_acolyte: 'warcry',
  bog_shambler: 'renew',
  magma_crawler: 'warcry',
  avalanche_shade: 'sprint',
  fen_strangler: 'sprint',
  gnarlfang_lycan: 'sprint', // a pack-hunter that bursts to close the gap
  hexpine_shaman: 'warcry', // roars itself into a frenzy mid-fight
  drowned_hulk: 'renew', // the waterlogged dead knit themselves back together
  voidtouched_centaur: 'sprint', // bursts to set up its lance-charge
};

/**
 * Personality traits that vary how a monster fights (resolved per-template via MOB_TRAITS):
 *  - pack    : bolder and faster with same-template packmates nearby.
 *  - craven  : flees when badly hurt — unless packmates make it brave.
 *  - enrage  : faster and harder-hitting once badly hurt (damage side via traitDamageMult).
 *  - flanker : curves around its target instead of beelining straight in.
 */
export type MobTrait = 'pack' | 'craven' | 'enrage' | 'flanker';

/** hpFrac below which a craven mob breaks and runs. */
const CRAVEN_FLEE_HP_FRAC = 0.3;
/** hpFrac below which an enrage mob speeds up (and hits harder via traitDamageMult). */
const ENRAGE_HP_FRAC = 0.35;

/**
 * Trait assignments across the bestiary. Bosses and elites (hp >= 200) are deliberately
 * traitless — they have their own mechanics. A template can carry up to two traits.
 */
export const MOB_TRAITS: Record<string, MobTrait[]> = {
  // Canines, harpies, and swarms hunt in packs.
  wolf: ['pack'],
  frost_wolf: ['pack'],
  plague_hound: ['pack'],
  marsh_leech: ['pack'],
  gloomcap_myconid: ['pack'],
  riftwing_harpy: ['pack'],
  abyss_thrall: ['pack'],
  bat: ['pack', 'craven'],
  carrion_swarm: ['pack', 'craven'],
  thistle_kobold: ['pack', 'craven'],
  gnarlfang_lycan: ['pack', 'flanker'],
  // Skirmishers, imps, and frail casters are craven — they break and run when bloodied.
  sprite: ['craven'],
  cultist: ['craven'],
  mire_spitter: ['craven'],
  deep_cultist: ['craven'],
  rime_archer: ['craven'],
  thornling_archer: ['craven'],
  ember_acolyte: ['craven'],
  shardspine_hurler: ['craven'],
  hollow_runeseer: ['craven'],
  ashen_warlock: ['craven'],
  pyre_caster: ['craven'],
  rotfen_naga: ['craven'],
  duskfire_hexer: ['craven'],
  cinder_imp: ['craven', 'flanker'],
  // Brutes, orcs, ettins, golems, and beasts enrage when badly hurt.
  boar: ['enrage'],
  tusk_runner: ['enrage'],
  bog_shambler: ['enrage'],
  magma_crawler: ['enrage'],
  grave_golem: ['enrage'],
  rot_ghoul: ['enrage'],
  mosshide_orc: ['enrage'],
  shadowmaw_bear: ['enrage'],
  fen_ettin: ['enrage'],
  crag_manticore: ['enrage'],
  // Stalkers, lurkers, and reptiles flank — they curve around you instead of beelining.
  fen_strangler: ['flanker'],
  avalanche_shade: ['flanker'],
  gravetide_revenant: ['flanker'],
  wraithfrost_stalker: ['flanker'],
  void_revenant: ['flanker'],
  basalt_basilisk: ['flanker'],
  thronespawn_ravager: ['enrage', 'flanker'],
  // Act 2 road bestiary.
  barrow_wight: ['flanker'],
  cairn_banshee: ['craven'],
  barrens_warg: ['pack', 'flanker'],
  hexpine_shaman: ['craven'],
  drowned_hulk: ['enrage'],
  tidegrave_lurker: ['flanker'],
  // Act 3 bestiary.
  ash_dire_wolf: ['pack'],
  cinderbone_archer: ['craven'],
  ashveil_gorgon: ['craven'],
  causeway_golem: ['enrage'],
  voidtouched_centaur: ['flanker'],
  null_revenant: ['enrage', 'flanker'],
  // Wilds bestiary — vermin swarm, the cockatrice/worm enrage, beasts flank.
  tomb_rat: ['pack', 'craven'],
  cinder_ant: ['pack'],
  gloomweb_spider: ['pack', 'flanker'],
  bramble_satyr: ['flanker'],
  mire_serpent: ['craven'],
  wyrmcrag_cockatrice: ['enrage'],
  sundered_worm: ['enrage'],
  // Act 2 road wilds.
  barrow_vermin: ['pack', 'craven'],
  pineweb_spider: ['pack', 'flanker'],
  drowned_serpent: ['craven'],
};

/**
 * Damage multiplier the orchestrator applies to an attacking mob's outgoing damage:
 * enraged templates hit 1.5x harder while below the enrage threshold.
 */
export function traitDamageMult(templateId: string, hpFrac: number): number {
  const enraged = MOB_TRAITS[templateId]?.includes('enrage') && hpFrac < ENRAGE_HP_FRAC;
  return enraged ? 1.5 : 1;
}

/** Whether a template runs in packs — the orchestrator uses this for help-calls (alerting packmates). */
export function isPackish(templateId: string): boolean {
  return MOB_TRAITS[templateId]?.includes('pack') ?? false;
}

export interface MobView {
  x: number;
  y: number;
  template: MobTemplate;
  attackReady: boolean;
}

export interface PlayerView {
  id: number;
  x: number;
  y: number;
  alive: boolean;
}

export interface MobIntent {
  /** Desired velocity (px/s); World applies dt and clamps to world bounds. */
  vx: number;
  vy: number;
  /** New facing (radians), or null to keep current. */
  facing: number | null;
  /** Player id to hit this tick, or null. */
  attackTargetId: number | null;
}

const IDLE: MobIntent = { vx: 0, vy: 0, facing: null, attackTargetId: null };

/** Flanker curve band: outside it (or right on top of the target) they commit straight in. */
const FLANK_MIN_DIST = 70;
const FLANK_MAX_DIST = 220;
/** Perpendicular blend strength of a flanker's approach (normalized afterwards). */
const FLANK_BLEND = 0.45;

/**
 * Per-tick context the World supplies so traits (MOB_TRAITS) can act. Omitting it disables
 * all trait behavior — stepMob then behaves exactly as the trait-free baseline.
 */
export interface MobStepContext {
  /** This mob's hp fraction 0..1 (drives craven flight + enrage). */
  hpFrac: number;
  /** Living same-template packmates within ~220px (drives pack speed). */
  packNearby: number;
  /** Stable per-mob seed (e.g. its entity id) for deterministic variation. */
  seed: number;
  /** Set when the mob was recently hurt or an ally called for help — extends aggro reach. */
  alerted: boolean;
}

/**
 * Aggro the nearest living player in range: chase until within attack range, then strike on
 * cooldown. Returns IDLE when no target — the World adds gentle wandering for idle mobs.
 *
 * With a MobStepContext, the template's traits kick in: alerted mobs hunt far beyond their
 * normal aggro range, packs run faster and bolder, craven mobs flee when bloodied (unless
 * packmates hold them in line), enraged mobs speed up, and flankers curve around their target.
 * Pure and deterministic: same inputs always yield the same intent.
 */
export function stepMob(
  mob: MobView,
  players: PlayerView[],
  aggroScale = 1,
  ctx?: MobStepContext,
): MobIntent {
  const traits = ctx ? (MOB_TRAITS[mob.template.id] ?? []) : [];

  let aggroMult = 1;
  let speedMult = 1;
  if (ctx) {
    if (ctx.alerted) aggroMult *= 2.5;
    if (traits.includes('pack') && ctx.packNearby >= 1) {
      aggroMult *= 1.3;
      speedMult *= ctx.packNearby >= 3 ? 1.25 : 1.15;
    }
    if (traits.includes('enrage') && ctx.hpFrac < ENRAGE_HP_FRAC) speedMult *= 1.35;
  }

  const target = nearestTarget(mob, players, aggroScale * aggroMult);
  if (!target) return IDLE;

  const dx = target.x - mob.x;
  const dy = target.y - mob.y;
  const dist = Math.hypot(dx, dy);
  const facing = Math.atan2(dy, dx);
  const inv = dist > 1e-6 ? 1 / dist : 0;
  const t = mob.template;
  const speed = t.speed * speedMult;

  // Craven: badly hurt and outnumbered → backpedal away at full speed, still facing the
  // threat (readable). Cowards are brave in numbers: with 2+ packmates they hold the line.
  if (ctx && traits.includes('craven') && ctx.hpFrac < CRAVEN_FLEE_HP_FRAC && ctx.packNearby < 2) {
    return { vx: -dx * inv * speed, vy: -dy * inv * speed, facing, attackTargetId: null };
  }

  if (t.behavior === 'ranged') {
    // Kite: stay in the band [kiteRange, attackRange]. Approach if too far, retreat if too close,
    // and fire (when ready) while holding inside the band. Aim is always at the target.
    const kite = t.kiteRange ?? t.attackRange * 0.6;
    if (dist > t.attackRange) {
      return { vx: dx * inv * speed, vy: dy * inv * speed, facing, attackTargetId: null };
    }
    if (dist < kite) {
      return { vx: -dx * inv * speed, vy: -dy * inv * speed, facing, attackTargetId: null };
    }
    return { vx: 0, vy: 0, facing, attackTargetId: mob.attackReady ? target.id : null };
  }

  // Melee: close to attack range, then strike on cooldown.
  if (dist <= t.attackRange) {
    return { vx: 0, vy: 0, facing, attackTargetId: mob.attackReady ? target.id : null };
  }

  // Flanker: in the mid-range band, blend in a perpendicular component (side picked
  // deterministically from the seed) so the mob curves around the player instead of
  // beelining. Renormalized, so net speed is unchanged; below the band it commits straight in.
  let ux = dx * inv;
  let uy = dy * inv;
  if (ctx && traits.includes('flanker') && dist >= FLANK_MIN_DIST && dist <= FLANK_MAX_DIST) {
    const side = Math.abs(ctx.seed) % 2 === 0 ? 1 : -1;
    const bx = ux - uy * side * FLANK_BLEND;
    const by = uy + ux * side * FLANK_BLEND;
    const norm = Math.hypot(bx, by);
    ux = bx / norm;
    uy = by / norm;
  }
  return { vx: ux * speed, vy: uy * speed, facing, attackTargetId: null };
}

function nearestTarget(mob: MobView, players: PlayerView[], aggroScale = 1): PlayerView | null {
  let best: PlayerView | null = null;
  let bestDist = mob.template.aggroRange * aggroScale;
  for (const p of players) {
    if (!p.alive) continue;
    const dist = Math.hypot(p.x - mob.x, p.y - mob.y);
    if (dist <= bestDist) {
      best = p;
      bestDist = dist;
    }
  }
  return best;
}
