/**
 * Timed status effects on a single entity — debuffs on monsters (SLOW, BURN, WEAKEN) and buffs on
 * players (MIGHT, HASTE, REGEN). One generic, server-owned, tick-driven set powers both.
 *
 * Server-owned, pure, and tick-driven: time only advances via an explicit `dtMs`
 * passed to `tick()`. No `Date.now`, no randomness, no I/O — so the simulation is
 * deterministic and unit-testable.
 */

export type StatusId =
  // Monster debuffs (legacy set — do not renumber the wire bits):
  | 'slow' // reduces movement
  | 'burn' // damage over time
  | 'weaken' // reduces the monster's outgoing damage
  // Player buffs:
  | 'might' // increases the player's outgoing damage
  | 'haste' // faster attacks (lower cooldowns) + faster movement
  | 'regen' // heal over time
  // Extended ailment / CC suite (slice 3):
  | 'ignite' // fire DoT (harder tick than burn; stacks with burn)
  | 'poison' // poison DoT
  | 'bleed' // physical DoT
  | 'chill' // moderate snare (lighter than slow)
  | 'shock' // lightning debuff (amplifies damage taken)
  | 'brittle' // reduces armor / increases crit taken
  | 'maim' // heavy movement impair (stacks with slow)
  | 'sap' // reduces attack speed / cooldown recovery
  | 'stun' // hard CC: cannot move or act
  | 'freeze' // hard CC: cannot move or act (cold variant)
  | 'silence' // prevents ability casts
  | 'curse'; // magic debuff (amplifies spell damage taken)

/** Lowest movement multiplier slow can ever produce (so a slow can't fully freeze). */
const SLOW_FACTOR_FLOOR = 0.2;
/** Floors so a single debuff/buff can't fully zero a stat. */
const WEAKEN_FACTOR_FLOOR = 0.25;
const HASTE_COOLDOWN_FLOOR = 0.4;
/** Additive poison magnitude cap (prevents runaway stacking). */
const POISON_MAX = 20;

/** Result of advancing a StatusSet by some dt. */
export interface StatusTickResult {
  /** Total DoT (burn + ignite + poison + bleed) damage dealt this tick. */
  dotDamage: number;
  /** Total regen (heal-over-time) restored this tick. */
  regenHeal: number;
}

/** Internal per-status state: how long it lasts and how strong it is. */
interface StatusState {
  remainingMs: number;
  magnitude: number;
}

/**
 * A set of timed status effects on a single entity. Server-owned; pure and tick-driven.
 * - 'slow' reduces movement: slowFactor() returns a multiplier in (0,1].
 * - 'burn' deals damage over time, reported from tick().
 */
export class StatusSet {
  private readonly effects = new Map<StatusId, StatusState>();

  /**
   * Apply (or refresh) a status. Re-applying refreshes duration and takes the stronger
   * magnitude. Refresh rule: `remainingMs = max(remaining, durationMs)` so a fresh hit
   * never shortens an existing effect, and `magnitude = max(existing, new)` so the
   * stronger effect wins. Non-positive durations/magnitudes are ignored.
   */
  apply(id: StatusId, durationMs: number, magnitude: number): void {
    if (durationMs <= 0 || magnitude <= 0) return;

    const existing = this.effects.get(id);
    if (existing) {
      if (id === 'poison') {
        // Poison stacks additively (capped), and duration takes the longer of the two.
        existing.magnitude = Math.min(POISON_MAX, existing.magnitude + magnitude);
        existing.remainingMs = Math.max(existing.remainingMs, durationMs);
      } else {
        existing.remainingMs = Math.max(existing.remainingMs, durationMs);
        existing.magnitude = Math.max(existing.magnitude, magnitude);
      }
      return;
    }

    this.effects.set(id, { remainingMs: durationMs, magnitude });
  }

  /**
   * Advance all effects by dtMs, expiring finished ones. Returns dotDamage (sum of all
   * damage-over-time sources: burn, ignite, poison, bleed) and regenHeal this tick.
   *
   * Per-DoT accounting counts only the *active* elapsed time: if an effect expires partway
   * through the tick, damage is `magnitude * (activeMs / 1000)` rather than the full dt.
   */
  tick(dtMs: number): StatusTickResult {
    let dotDamage = 0;
    let regenHeal = 0;
    if (dtMs <= 0) return { dotDamage, regenHeal };

    for (const [id, state] of this.effects) {
      const activeMs = Math.min(state.remainingMs, dtMs);

      if (id === 'burn' || id === 'ignite' || id === 'poison' || id === 'bleed') {
        dotDamage += state.magnitude * (activeMs / 1000);
      } else if (id === 'regen') {
        regenHeal += state.magnitude * (activeMs / 1000);
      }

      state.remainingMs -= dtMs;
      if (state.remainingMs <= 0) this.effects.delete(id);
    }

    return { dotDamage, regenHeal };
  }

  private mag(id: StatusId): number {
    return this.effects.get(id)?.magnitude ?? 0;
  }

  /**
   * Movement multiplier from active slow + chill + maim (1 = normal speed; e.g. 0.5 = half).
   * The combined magnitude is the total fractional slow in [0,1); the result is clamped to a
   * sane floor so a stack of slows can't stop an entity dead.
   */
  slowFactor(): number {
    return Math.max(
      SLOW_FACTOR_FLOOR,
      1 - (this.mag('slow') + this.mag('chill') + this.mag('maim')),
    );
  }

  /** Monster outgoing-damage multiplier from weaken + sap + curse (1 = normal; floored). */
  weakenFactor(): number {
    return Math.max(
      WEAKEN_FACTOR_FLOOR,
      1 - (this.mag('weaken') + this.mag('sap') + this.mag('curse')),
    );
  }

  /**
   * Incoming-damage multiplier from shock + brittle + curse (1 = normal; >1 = more damage taken).
   * shock is multiplicative; brittle and curse are additive before being applied as a multiplier.
   */
  vulnFactor(): number {
    return (1 + this.mag('shock')) * (1 + this.mag('brittle') + this.mag('curse'));
  }

  /** Whether the entity is rooted (cannot move) due to stun or freeze. */
  rooted(): boolean {
    return this.has('stun') || this.has('freeze');
  }

  /** Whether the entity is silenced (cannot cast abilities) due to stun, freeze, or silence. */
  silenced(): boolean {
    return this.rooted() || this.has('silence');
  }

  /** Player outgoing-damage multiplier from MIGHT (1 = normal; e.g. magnitude 0.3 => 1.3). */
  damageFactor(): number {
    return 1 + this.mag('might');
  }

  /** Player cooldown multiplier from HASTE (lower = faster attacks; floored). */
  cooldownFactor(): number {
    return Math.max(HASTE_COOLDOWN_FLOOR, 1 - this.mag('haste'));
  }

  /** Player movement multiplier from HASTE (1 = normal; e.g. magnitude 0.35 => 1.35). */
  moveFactor(): number {
    return 1 + this.mag('haste');
  }

  /** Whether a given status is currently active. */
  has(id: StatusId): boolean {
    return this.effects.has(id);
  }

  /** Number of active effects (for tests/inspection). */
  get size(): number {
    return this.effects.size;
  }

  /** Remove all effects. */
  clear(): void {
    this.effects.clear();
  }
}
