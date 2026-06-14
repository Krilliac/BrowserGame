/**
 * XP / leveling: a pure, framework-free progression curve shared by combat rewards and the
 * client XP bar. Everything here is deterministic (no I/O, no time, no randomness) so it can
 * be unit-tested (progression.test.ts) and reused on both sides of the wire.
 *
 * The game is paced as THREE ACTS of roughly 20 levels each (Act 1 exits around 15-20, Act 2
 * around 40, Act 3 runs to ~60). The curve is PIECEWISE EXPONENTIAL: a steep ~28%-per-level
 * climb through the Act 1 band (so the opening act takes hours, not minutes), easing to
 * ~12%-per-level beyond level 20 — paired with kill XP that scales up super-linearly for
 * Act 2/3 monsters, so later acts stay a grind without needing astronomical totals.
 * Cumulative: L10 ≈ 2.6k, L20 ≈ 35k, L30 ≈ 207k, L40 ≈ 741k, L50 ≈ 2.4M, L60 ≈ 7.6M.
 */
const XP_BASE = 90; // cost of level 1 -> 2
const XP_GROWTH_ACT1 = 1.28; // per-level cost multiplier through the Act 1 band
const XP_GROWTH_LATE = 1.12; // gentler multiplier beyond the knee (Acts 2-3)
const XP_KNEE = 20; // the level where the growth rate eases

/** Total cumulative XP required to BE at the given level (level 1 => 0). */
export function xpForLevel(level: number): number {
  const lvl = sanitizeLevel(level);
  // Two geometric series stitched at the knee, rounded to whole XP.
  const act1Levels = Math.min(lvl - 1, XP_KNEE - 1);
  let total = (XP_BASE * (Math.pow(XP_GROWTH_ACT1, act1Levels) - 1)) / (XP_GROWTH_ACT1 - 1);
  if (lvl > XP_KNEE) {
    const atKnee = XP_BASE * Math.pow(XP_GROWTH_ACT1, XP_KNEE - 1);
    total += (atKnee * (Math.pow(XP_GROWTH_LATE, lvl - XP_KNEE) - 1)) / (XP_GROWTH_LATE - 1);
  }
  return Math.round(total);
}

/** The level a given total XP corresponds to (inverse of xpForLevel; level >= 1). */
export function levelForXp(xp: number): number {
  const total = sanitizeXp(xp);
  // Walk up from a cheap guess; the correction loops keep it exact at rounded boundaries.
  let result = 1;
  while (xpForLevel(result + 1) <= total) result++;
  while (result > 1 && xpForLevel(result) > total) result--;
  return result;
}

/**
 * XP awarded for killing a monster of the given level. Linear through the Act 1 band, then a
 * quadratic bonus for Act 2/3 monsters — later acts' kills are worth real chunks, so 20 levels
 * per act stays a grind of hundreds of kills, not thousands.
 */
export function xpReward(mobLevel: number): number {
  const lvl = sanitizeLevel(mobLevel);
  const base = 8 + lvl * 5;
  const pastKnee = Math.max(0, lvl - 18);
  return base + 2 * pastKnee * pastKnee;
}

/**
 * Gold in a champion/elite monster's bonus pile, scaled by its level so the reward tracks the threat:
 * a level-1 wolf spills a handful, a level-60 rift champion a real hoard. A flat base + a level-scaled
 * core + a level-scaled random spread. Pure given the injected rng (deterministic + testable).
 */
export function championGoldPile(mobLevel: number, rng: () => number = Math.random): number {
  const lvl = sanitizeLevel(mobLevel);
  return Math.round(40 + lvl * 9 + rng() * (30 + lvl * 5));
}

/**
 * Scale a monster's base drop-table gold by how far its actual level outpaces its template level —
 * i.e. by rift tier (a mob spawns at templateLevel + 2·tier). A mob at its base level (tier 0) keeps
 * the table's amount exactly, so the normal game is unchanged; deeper rifts pay more, capped at 4×
 * so it never runs away. Always at least 1. Pure.
 */
export function scaleGoldForLevel(
  baseQty: number,
  mobLevel: number,
  templateLevel: number,
): number {
  const base = Math.max(0, Math.floor(baseQty) || 0);
  const factor = Math.min(4, Math.max(1, sanitizeLevel(mobLevel) / sanitizeLevel(templateLevel)));
  return Math.max(1, Math.round(base * factor));
}

/**
 * Co-op scaling factor for an instance with `alive` living players: 1 solo, then +`perPlayer` for
 * each additional player, capped at `cap`. Used both ways — to make a crowded zone more dangerous
 * (damage) and more rewarding (gold). Pure; a non-positive/garbage count resolves to solo (×1).
 */
export function coopScale(alive: number, perPlayer: number, cap: number): number {
  const n = Math.max(0, Math.floor(alive) || 0);
  return Math.min(cap, 1 + perPlayer * Math.max(0, n - 1));
}

/**
 * Gold multiplier from an area's rift tier — for level-less gold sources (chests, smashed pots) that
 * can't use {@link scaleGoldForLevel}. Tier 0 (the normal world) is ×1 so nothing changes there;
 * deeper rifts pay more, capped at 4×. Pure; a non-positive/garbage tier resolves to ×1.
 */
export function tierGoldScale(tier: number): number {
  const t = Math.max(0, Math.floor(tier) || 0);
  return Math.min(4, 1 + t * 0.35);
}

/**
 * Scale a monster's outgoing damage by how far its actual level outpaces its template level — i.e.
 * by rift tier (a mob spawns at templateLevel + 2·tier). Mirrors {@link scaleGoldForLevel} so the
 * "deeper = deadlier" reward and threat track together, but with a much tighter cap (gold runs to
 * 4×; lethality only to `cap`, default 1.5×) so deep rifts sting without one-shotting. A mob at its
 * base level (tier 0) keeps its damage exactly, so the normal game is unchanged. Pure; never below
 * the base damage.
 */
export function scaleDamageForLevel(
  baseDamage: number,
  mobLevel: number,
  templateLevel: number,
  cap = 1.5,
): number {
  const base = Number.isFinite(baseDamage) ? Math.max(0, baseDamage) : 0;
  const ceiling = Math.max(1, cap);
  const factor = Math.min(
    ceiling,
    Math.max(1, sanitizeLevel(mobLevel) / sanitizeLevel(templateLevel)),
  );
  return base * factor;
}

/**
 * HP a health globe restores to a character with the given max HP: `frac` of max, rounded, never
 * negative. Pure (the World clamps the result to the missing-HP headroom on pickup).
 */
export function healthGlobeHeal(maxHp: number, frac: number): number {
  const cap = Number.isFinite(maxHp) ? Math.max(0, maxHp) : 0;
  const f = Number.isFinite(frac) ? Math.max(0, frac) : 0;
  return Math.round(cap * f);
}

/** Player max HP at a given level (base 100, scaling up per level). */
export function maxHpForLevel(level: number): number {
  const lvl = sanitizeLevel(level);
  return 100 + (lvl - 1) * 15;
}

/** Progress within the current level, for rendering an XP bar. */
export interface LevelProgress {
  level: number;
  intoLevel: number; // xp earned past the current level's start
  neededForNext: number; // xp span from this level to the next
  fraction: number; // 0..1 progress to next level
}

export function levelProgress(xp: number): LevelProgress {
  const total = sanitizeXp(xp);
  const level = levelForXp(total);
  const start = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const neededForNext = next - start;
  const intoLevel = total - start;
  const fraction = neededForNext > 0 ? intoLevel / neededForNext : 0;
  return { level, intoLevel, neededForNext, fraction };
}

/** Treat NaN / negative / sub-1 levels as level 1, and floor fractional levels. */
function sanitizeLevel(level: number): number {
  if (!Number.isFinite(level)) return 1;
  return Math.max(1, Math.floor(level));
}

/** Treat NaN / negative XP as 0. */
function sanitizeXp(xp: number): number {
  if (!Number.isFinite(xp) || xp < 0) return 0;
  return xp;
}
