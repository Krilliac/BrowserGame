/**
 * Monsters: RuneScape-flavored roaming, respawning creatures that aggro and melee nearby
 * players. Templates define stats per creature; the AI step is a pure function so it's
 * unit-tested (mobs.test.ts). The World owns mob state and applies the returned intent.
 */

/** How a monster fights: a melee bruiser that closes in, or a ranged attacker that kites. */
export type MobBehavior = 'melee' | 'ranged';

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
  ],
  crypt: [
    { templateId: 'skeleton', count: 5 },
    { templateId: 'bat', count: 4 },
    { templateId: 'cultist', count: 3 },
    { templateId: 'crypt_lord', count: 1 },
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
