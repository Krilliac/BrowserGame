/**
 * Item procs — the Diablo "chance on hit / on crit to do something" layer (TrinityCore spell_proc /
 * Flare passive_trigger, cut to essentials). A base item can carry procs; while it's equipped, every
 * landing hit gets a roll, gated by an internal cooldown (ICD) so fast attackers don't proc-storm.
 *
 * This module is PURE: it owns only the proc vocabulary and the roll/ICD decision. It never touches
 * the World — given a player's procs, whether the hit crit, the clock, and a per-player ICD map, it
 * returns the effects that fired (and stamps the ICD). The World applies those effects (bonus damage
 * via damageMob, or a status via applyStatus) and is responsible for the recursion guard so a proc's
 * own damage can't proc again. Effects reuse existing systems, so there's no new per-effect code.
 */

/** When a proc is eligible: every landing hit, or only a critical one. */
export type ProcTrigger = 'onHit' | 'onCrit';

/** What a proc does when it fires. Both kinds map onto existing World primitives. */
export type ProcEffect =
  /** Deal `amount` extra (untyped) damage to the mob just hit. */
  | { kind: 'damage'; amount: number }
  /** Apply `ability`'s configured on-hit status (slow/burn/weaken) to the mob just hit. */
  | { kind: 'status'; ability: string };

/** A fully-resolved proc. `id` is a stable key for ICD bookkeeping (per source item + index). */
export interface ProcDef {
  id: string;
  /** The base item id that carries this proc (the player has it while that item is equipped). */
  sourceId: string;
  trigger: ProcTrigger;
  /** Probability in [0,1] the proc fires when eligible and off cooldown. */
  chance: number;
  /** Internal cooldown in ms — the minimum gap between two fires of THIS proc for one entity. */
  icdMs: number;
  effect: ProcEffect;
}

/** The code DEFAULTS for item procs (seed source for the `item_procs` table). One proc per source. */
export interface ProcSeed {
  sourceId: string;
  trigger: ProcTrigger;
  chance: number;
  icdMs: number;
  effect: ProcEffect;
}

/**
 * Seeded procs on signature weapon bases — so the feature is FELT the moment it ships. Pieces are
 * existing droppable weapon bases; the status procs reuse real abilities' on-hit effects. Tune via
 * the DB. (Authoring note: the seeder writes one proc per source id, so keep these distinct.)
 */
export const DEFAULT_ITEM_PROCS: ProcSeed[] = [
  // A frost glaive that chills on hit — reuses Glacierspike's slow.
  {
    sourceId: 'frostforged_glaive',
    trigger: 'onHit',
    chance: 0.25,
    icdMs: 3000,
    effect: { kind: 'status', ability: 'glacierspike' },
  },
  // A brutal partisan whose every crit detonates for bonus damage.
  {
    sourceId: 'doomspike_partisan',
    trigger: 'onCrit',
    chance: 1.0,
    icdMs: 2500,
    effect: { kind: 'damage', amount: 22 },
  },
];

/**
 * Decide which procs fire for one landing hit. For each proc: an `onCrit` proc requires the hit to
 * be a crit; the proc must be off its internal cooldown; then it rolls its `chance`. A firing proc
 * stamps its next-ready time into `icd` (mutated in place) and contributes its effect. Pure aside
 * from the `icd` stamp; deterministic given `rng`.
 */
export function resolveProcs(
  procs: readonly ProcDef[],
  ctx: { crit: boolean; now: number },
  icd: Map<string, number>,
  rng: () => number = Math.random,
): ProcEffect[] {
  const fired: ProcEffect[] = [];
  for (const p of procs) {
    if (p.trigger === 'onCrit' && !ctx.crit) continue;
    if ((icd.get(p.id) ?? 0) > ctx.now) continue; // still on internal cooldown
    if (rng() >= p.chance) continue;
    icd.set(p.id, ctx.now + p.icdMs);
    fired.push(p.effect);
  }
  return fired;
}
