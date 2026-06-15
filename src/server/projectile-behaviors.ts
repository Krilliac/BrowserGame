/**
 * Pure spell-behavior resolution for the projectile engine (Slice 1). Framework-free and
 * deterministic — no Pixi/DOM, no Date.now/Math.random (any randomness is the caller's). The world
 * sim calls these and performs the side effects (damage, spawn, set velocity, delete, emit FX).
 *
 * On-hit precedence (documented so combos are predictable): splash always fires; fork spawns once;
 * then movement is exactly one of chain (redirect to nearest un-hit mob) → pierce (continue straight)
 * → consume. Chain is preferred over pierce while bounces remain (it is the more build-defining
 * behavior). Forks are plain projectiles (no recursive fork/chain) so growth is hard-bounded.
 */

import type { BehaviorSpec } from '../shared/combat.js';

export interface MobLite {
  id: number;
  x: number;
  y: number;
}

export interface ProjCharges {
  bouncesLeft: number;
  piercesLeft: number;
  forksLeft: number;
}

/** Initial per-projectile charge counts from its behavior list. */
export function initialCharges(behaviors: BehaviorSpec[]): ProjCharges {
  let bouncesLeft = 0;
  let piercesLeft = 0;
  let forksLeft = 0;
  for (const b of behaviors) {
    if (b.type === 'chain') bouncesLeft += b.count;
    else if (b.type === 'pierce') piercesLeft += b.count;
    else if (b.type === 'fork') forksLeft += b.count;
  }
  return { bouncesLeft, piercesLeft, forksLeft };
}

export interface HitInput {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Running damage multiplier carried by the projectile (1 at spawn). */
  damageScale: number;
  behaviors: BehaviorSpec[];
  charges: ProjCharges;
  /** Mob ids already damaged by this projectile (never re-hit). */
  hitMobs: ReadonlySet<number>;
  /** The mob just struck. */
  hitMob: MobLite;
  /** Alive mobs eligible as chain targets (caller excludes the dead; this fn excludes hitMobs). */
  candidates: MobLite[];
}

export interface ForkSpawn {
  vx: number;
  vy: number;
  damageScale: number;
}

export interface HitOutput {
  /** Damage multiplier to apply to the primary hit (== input.damageScale). */
  primaryDamageScale: number;
  /** AoE on impact, if any (caller applies radius damage). */
  splash?: { radius: number; scale: number };
  /** Child projectiles to spawn (plain, bounded). */
  forks: ForkSpawn[];
  /** New velocity for a chained projectile. */
  redirect?: { vx: number; vy: number };
  /** True if the projectile continues straight (pierce). */
  pierce: boolean;
  /** True if the projectile is deleted after this hit. */
  consume: boolean;
  /** Chain-arc VFX endpoint (the source is the hit position). */
  arcTo?: { x: number; y: number };
  /** Projectile damageScale for subsequent hits (after chain/pierce falloff). */
  damageScaleAfter: number;
  /** Remaining charges after this hit. */
  charges: ProjCharges;
}

function find<T extends BehaviorSpec['type']>(
  arr: BehaviorSpec[],
  type: T,
): Extract<BehaviorSpec, { type: T }> | undefined {
  return arr.find((b) => b.type === type) as Extract<BehaviorSpec, { type: T }> | undefined;
}

export function resolveHit(input: HitInput): HitOutput {
  const speed = Math.hypot(input.vx, input.vy) || 1;
  const charges: ProjCharges = { ...input.charges };
  const out: HitOutput = {
    primaryDamageScale: input.damageScale,
    forks: [],
    pierce: false,
    consume: true,
    damageScaleAfter: input.damageScale,
    charges,
  };

  const splash = find(input.behaviors, 'splash');
  if (splash) out.splash = { radius: splash.radius, scale: splash.scale };

  const fork = find(input.behaviors, 'fork');
  if (fork && charges.forksLeft > 0) {
    const baseAngle = Math.atan2(input.vy, input.vx);
    for (let i = 0; i < fork.count; i++) {
      const a = baseAngle + (i - (fork.count - 1) / 2) * fork.spreadRad;
      out.forks.push({
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        damageScale: input.damageScale * fork.falloff,
      });
    }
    charges.forksLeft = 0;
  }

  const chain = find(input.behaviors, 'chain');
  if (chain && charges.bouncesLeft > 0) {
    let best: MobLite | undefined;
    let bestD = chain.range;
    for (const c of input.candidates) {
      if (c.id === input.hitMob.id || input.hitMobs.has(c.id)) continue;
      const d = Math.hypot(c.x - input.hitMob.x, c.y - input.hitMob.y);
      if (d <= bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best) {
      const dx = best.x - input.hitMob.x;
      const dy = best.y - input.hitMob.y;
      const len = Math.hypot(dx, dy) || 1;
      out.redirect = { vx: (dx / len) * speed, vy: (dy / len) * speed };
      out.arcTo = { x: best.x, y: best.y };
      out.damageScaleAfter = input.damageScale * chain.falloff;
      out.consume = false;
      charges.bouncesLeft -= 1;
      return out;
    }
  }

  const pierce = find(input.behaviors, 'pierce');
  if (pierce && charges.piercesLeft > 0) {
    out.pierce = true;
    out.consume = false;
    out.damageScaleAfter = input.damageScale * pierce.falloff;
    charges.piercesLeft -= 1;
    return out;
  }

  return out;
}

/** Rotate `(vx,vy)` toward `target` by at most `turnRateRadPerS * dtMs/1000`, preserving speed. */
export function steerHoming(
  x: number,
  y: number,
  vx: number,
  vy: number,
  target: MobLite,
  turnRateRadPerS: number,
  dtMs: number,
): { vx: number; vy: number } {
  const speed = Math.hypot(vx, vy) || 1;
  const cur = Math.atan2(vy, vx);
  const want = Math.atan2(target.y - y, target.x - x);
  let delta = want - cur;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const maxStep = turnRateRadPerS * (dtMs / 1000);
  const step = Math.max(-maxStep, Math.min(maxStep, delta));
  const a = cur + step;
  return { vx: Math.cos(a) * speed, vy: Math.sin(a) * speed };
}
