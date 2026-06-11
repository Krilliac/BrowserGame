/**
 * Monsters: RuneScape-flavored roaming, respawning creatures that aggro and melee nearby
 * players. Templates define stats per creature; the AI step is a pure function so it's
 * unit-tested (mobs.test.ts). The World owns mob state and applies the returned intent.
 */

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
};

export interface AreaMobSpawn {
  templateId: string;
  count: number;
}

/** Which monsters populate each area. Town is a safe zone. */
export const AREA_MOBS: Record<string, AreaMobSpawn[]> = {
  town: [],
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
};

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

/**
 * Aggro the nearest living player in range: chase until within attack range, then strike on
 * cooldown. Returns IDLE when no target — the World adds gentle wandering for idle mobs.
 */
export function stepMob(mob: MobView, players: PlayerView[], aggroScale = 1): MobIntent {
  const target = nearestTarget(mob, players, aggroScale);
  if (!target) return IDLE;

  const dx = target.x - mob.x;
  const dy = target.y - mob.y;
  const dist = Math.hypot(dx, dy);
  const facing = Math.atan2(dy, dx);
  const inv = dist > 1e-6 ? 1 / dist : 0;
  const t = mob.template;
  const speed = t.speed;

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
  return { vx: dx * inv * speed, vy: dy * inv * speed, facing, attackTargetId: null };
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
