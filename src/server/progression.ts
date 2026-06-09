/**
 * XP / leveling: a pure, framework-free progression curve shared by combat rewards and the
 * client XP bar. Everything here is deterministic (no I/O, no time, no randomness) so it can
 * be unit-tested (progression.test.ts) and reused on both sides of the wire.
 *
 * The curve is quadratic: xpForLevel(L) = 50 * (L-1) * L, giving 0, 100, 300, 600, 1000, ...
 * Each successive level costs 100 more XP than the last, a smooth RuneScape-ish ramp.
 */

/** Total cumulative XP required to BE at the given level (level 1 => 0). */
export function xpForLevel(level: number): number {
  const lvl = sanitizeLevel(level);
  return 50 * (lvl - 1) * lvl;
}

/** The level a given total XP corresponds to (inverse of xpForLevel; level >= 1). */
export function levelForXp(xp: number): number {
  const total = sanitizeXp(xp);
  // Solve 50 * (L-1) * L <= xp for the largest integer L, then floor and clamp.
  // 50L^2 - 50L - xp <= 0  =>  L <= (1 + sqrt(1 + xp/12.5)) / 2.
  const level = Math.floor((1 + Math.sqrt(1 + total / 12.5)) / 2);
  // Correct for any floating-point edge cases at exact boundaries.
  let result = Math.max(1, level);
  while (xpForLevel(result + 1) <= total) result++;
  while (result > 1 && xpForLevel(result) > total) result--;
  return result;
}

/** XP awarded for killing a monster of the given level. */
export function xpReward(mobLevel: number): number {
  const lvl = sanitizeLevel(mobLevel);
  return 12 + lvl * 8;
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
