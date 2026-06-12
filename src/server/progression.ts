/**
 * XP / leveling: a pure, framework-free progression curve shared by combat rewards and the
 * client XP bar. Everything here is deterministic (no I/O, no time, no randomness) so it can
 * be unit-tested (progression.test.ts) and reused on both sides of the wire.
 *
 * The curve is EXPONENTIAL (the OSRS/Diablo long-chase shape): each level costs ~28% more XP
 * than the last, starting from 90. Early levels still pop fast (level 2 after a few kills) but
 * the climb stretches into hours through the teens and into a real endgame chase past 25 —
 * cumulative: L5 ≈ 540, L10 ≈ 2.6k, L15 ≈ 9.8k, L20 ≈ 35k, L25 ≈ 120k, L30 ≈ 410k.
 */
const XP_BASE = 90; // cost of level 1 -> 2
const XP_GROWTH = 1.28; // per-level cost multiplier

/** Total cumulative XP required to BE at the given level (level 1 => 0). */
export function xpForLevel(level: number): number {
  const lvl = sanitizeLevel(level);
  // Geometric series: base * (growth^(L-1) - 1) / (growth - 1), rounded to whole XP.
  return Math.round((XP_BASE * (Math.pow(XP_GROWTH, lvl - 1) - 1)) / (XP_GROWTH - 1));
}

/** The level a given total XP corresponds to (inverse of xpForLevel; level >= 1). */
export function levelForXp(xp: number): number {
  const total = sanitizeXp(xp);
  // Invert the geometric series for an initial guess, then correct at the rounded boundaries.
  const guess = Math.floor(
    1 + Math.log(1 + (total * (XP_GROWTH - 1)) / XP_BASE) / Math.log(XP_GROWTH),
  );
  let result = Math.max(1, guess);
  while (xpForLevel(result + 1) <= total) result++;
  while (result > 1 && xpForLevel(result) > total) result--;
  return result;
}

/** XP awarded for killing a monster of the given level. */
export function xpReward(mobLevel: number): number {
  const lvl = sanitizeLevel(mobLevel);
  return 8 + lvl * 5;
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
