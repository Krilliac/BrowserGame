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
