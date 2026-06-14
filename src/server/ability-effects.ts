/**
 * On-hit status-effect data for abilities — the CODE DEFAULTS that seed the `ability_status_effects`
 * content table. At runtime the simulation reads the (live-editable) table via
 * `Content.abilityStatusEffects(id)`, so a designer can retune how long a chill snares or how hard a
 * burn ticks with SQL — no recompile.
 *
 * `effect` maps 1:1 onto a {@link StatusId}: 'slow' (movement factor), 'burn' (damage per second),
 * 'weaken' (outgoing-damage reduction factor). An ability may carry several effects (e.g. a curse
 * that both slows and weakens) — one row each. `magnitude` is the factor (slow/weaken) or the
 * per-tick damage (burn).
 */
export type StatusEffectKind = 'slow' | 'burn' | 'weaken';

export interface AbilityStatusEffectDef {
  abilityId: string;
  effect: StatusEffectKind;
  ms: number;
  magnitude: number;
}

export const DEFAULT_ABILITY_STATUS_EFFECTS: AbilityStatusEffectDef[] = [
  // Chilling / snaring spells that slow on hit (magnitude = movement factor).
  { abilityId: 'frost', effect: 'slow', ms: 1500, magnitude: 0.4 },
  { abilityId: 'venom', effect: 'slow', ms: 2200, magnitude: 0.3 },
  { abilityId: 'frostshard', effect: 'slow', ms: 1200, magnitude: 0.5 },
  { abilityId: 'frostlance', effect: 'slow', ms: 1600, magnitude: 0.45 },
  { abilityId: 'frostnova', effect: 'slow', ms: 2000, magnitude: 0.4 },
  { abilityId: 'glacierspike', effect: 'slow', ms: 2000, magnitude: 0.4 },
  { abilityId: 'entangling_vines', effect: 'slow', ms: 2200, magnitude: 0.35 },
  { abilityId: 'curse_of_decay', effect: 'slow', ms: 1800, magnitude: 0.4 },
  { abilityId: 'hamstring', effect: 'slow', ms: 1600, magnitude: 0.45 },
  { abilityId: 'mire_mortar', effect: 'slow', ms: 2000, magnitude: 0.35 },
  { abilityId: 'earthshatter', effect: 'slow', ms: 1800, magnitude: 0.35 },

  // Fire / poison / bleed spells that burn (damage-over-time; magnitude = damage per tick).
  { abilityId: 'fireball', effect: 'burn', ms: 2000, magnitude: 8 },
  { abilityId: 'meteor', effect: 'burn', ms: 2600, magnitude: 14 },
  { abilityId: 'emberbolt', effect: 'burn', ms: 2000, magnitude: 5 },
  { abilityId: 'flamewave', effect: 'burn', ms: 2200, magnitude: 7 },
  { abilityId: 'cinderorb', effect: 'burn', ms: 2400, magnitude: 9 },
  { abilityId: 'infernonova', effect: 'burn', ms: 2600, magnitude: 10 },
  { abilityId: 'poison_spit', effect: 'burn', ms: 2600, magnitude: 6 },
  { abilityId: 'shadow_bolt', effect: 'burn', ms: 2000, magnitude: 6 },
  { abilityId: 'draining_touch', effect: 'burn', ms: 2000, magnitude: 6 },
  { abilityId: 'shadow_nova', effect: 'burn', ms: 2200, magnitude: 7 },
  { abilityId: 'rend', effect: 'burn', ms: 2400, magnitude: 5 },
  { abilityId: 'wyrmfire_lance', effect: 'burn', ms: 2600, magnitude: 11 },
  { abilityId: 'starfall', effect: 'burn', ms: 2800, magnitude: 12 },

  // Curse spells that weaken a target's outgoing damage on hit (magnitude = damage-reduction factor).
  { abilityId: 'curse_of_decay', effect: 'weaken', ms: 3000, magnitude: 0.4 },
  { abilityId: 'draining_touch', effect: 'weaken', ms: 2500, magnitude: 0.3 },
  { abilityId: 'shadow_nova', effect: 'weaken', ms: 2500, magnitude: 0.3 },
];
