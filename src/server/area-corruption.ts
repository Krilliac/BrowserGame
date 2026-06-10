/**
 * Area-wide corruption: a dread level (0..1) per **area** (not per instance), so every player's
 * death anywhere in an area feeds the same pool and every instance of that area reads it. It rises
 * on player deaths, is pushed back by kills, fades slowly on its own, and **resets every morning**
 * (a 06:00 local-time boundary). Owned by the host, shared into each World by area id.
 */

export const CORRUPT_DECAY_PER_SEC = 0.003; // slow fade, so a day's deaths accumulate
export const CORRUPT_PER_DEATH = 0.15; // each player death feeds the corruption
export const CORRUPT_PER_KILL = 0.012; // each monster slain pushes it back
export const CORRUPT_MAX_DMG_BONUS = 0.6; // mob damage scales up to +60% at full corruption
export const CORRUPT_DROP_MAX = 0.3; // at full corruption, up to 30% of gear drops are corrupted

/** Corruption tiers by ascending threshold; index = tier (0 = calm ... 3 = rampant). */
export const CORRUPT_TIERS = [0, 0.25, 0.55, 0.85];

/** The tier a corruption level falls into. */
export function tierOf(level: number): number {
  let t = 0;
  for (let i = 0; i < CORRUPT_TIERS.length; i++) if (level >= CORRUPT_TIERS[i]!) t = i;
  return t;
}

export class AreaCorruption {
  private readonly level = new Map<string, number>();
  private readonly lastTier = new Map<string, number>();
  private day = Number.NEGATIVE_INFINITY;

  /** Current corruption (0..1) for an area. */
  get(areaId: string): number {
    return this.level.get(areaId) ?? 0;
  }

  /** A player died in this area — every player's death counts toward the shared pool. */
  addDeath(areaId: string): void {
    this.bump(areaId, CORRUPT_PER_DEATH);
  }

  /** A monster was slain in this area — push the corruption back. */
  pushBack(areaId: string): void {
    this.bump(areaId, -CORRUPT_PER_KILL);
  }

  /** Natural fade. Driven once per tick by the host (never per-instance, to avoid double decay). */
  decay(dt: number): void {
    for (const [areaId, v] of this.level) {
      const next = Math.max(0, v - CORRUPT_DECAY_PER_SEC * dt);
      if (next <= 0) this.level.delete(areaId);
      else this.level.set(areaId, next);
    }
  }

  /** Clear all corruption when the morning day index advances. Returns true if it reset. */
  rolloverIfNewDay(dayIndex: number): boolean {
    if (dayIndex === this.day) return false;
    this.day = dayIndex;
    this.level.clear();
    this.lastTier.clear();
    return true;
  }

  /**
   * Detect whether an area has crossed into a new corruption tier since the last poll — the basis
   * for "the forces of darkness grow stronger/weaker" announcements (no numeric meter). Returns the
   * new tier and the direction it moved, or null if unchanged.
   */
  pollTierChange(areaId: string): { tier: number; dir: 'up' | 'down' } | null {
    const tier = tierOf(this.get(areaId));
    const prev = this.lastTier.get(areaId) ?? 0;
    if (tier === prev) return null;
    this.lastTier.set(areaId, tier);
    return { tier, dir: tier > prev ? 'up' : 'down' };
  }

  private bump(areaId: string, delta: number): void {
    this.level.set(areaId, Math.min(1, Math.max(0, this.get(areaId) + delta)));
  }
}

/**
 * The local-day index with a 06:00 "morning" boundary — corruption resets when this advances. Pure:
 * the caller passes `Date.now()` and `new Date().getTimezoneOffset()`.
 */
export function morningDayIndex(nowMs: number, tzOffsetMinutes: number): number {
  const localMs = nowMs - tzOffsetMinutes * 60_000;
  return Math.floor((localMs - 6 * 3_600_000) / 86_400_000);
}
