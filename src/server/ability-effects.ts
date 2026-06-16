/**
 * Ability & buff effect data — the CODE DEFAULTS that seed the effect content tables
 * (`ability_status_effects`, `ability_cast_buffs`, `shrine_buffs`). At runtime the simulation reads
 * the (live-editable) tables via the `Content` API, so a designer can retune how long a chill snares,
 * how hard a burn ticks, or how strong a shrine blessing is with SQL — no recompile.
 *
 * On-hit `effect` maps 1:1 onto a {@link StatusId}: 'slow' (movement factor), 'burn' (damage per
 * second), 'weaken' (outgoing-damage reduction factor). An ability may carry several effects (e.g. a
 * curse that both slows and weakens) — one row each. `magnitude` is the factor (slow/weaken) or the
 * per-tick damage (burn). Buffs use the same {@link StatusId} space ('might'/'haste'/'regen').
 */
import type { StatusId } from './status-effects.js';

export type StatusEffectKind =
  | 'slow'
  | 'burn'
  | 'weaken'
  | 'ignite'
  | 'poison'
  | 'bleed'
  | 'chill'
  | 'shock'
  | 'brittle'
  | 'maim'
  | 'sap'
  | 'stun'
  | 'freeze'
  | 'silence'
  | 'curse';

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

  // --- Element-signature ailments (Slice 3): every damaging ability imprints its school ailment ---

  // Fire → ignite (DoT; magnitude = damage per tick). Distinct from the legacy 'burn' rows above;
  // both coexist on fire abilities so the ignite system and the original burn system can be tuned
  // independently (e.g. ignite can be used as the proc-able ailment while burn stays the baseline).
  { abilityId: 'fireball', effect: 'ignite', ms: 2500, magnitude: 3 },
  { abilityId: 'meteor', effect: 'ignite', ms: 2500, magnitude: 3 },
  { abilityId: 'emberbolt', effect: 'ignite', ms: 2500, magnitude: 3 },
  { abilityId: 'flamewave', effect: 'ignite', ms: 2500, magnitude: 3 },
  { abilityId: 'cinderorb', effect: 'ignite', ms: 2500, magnitude: 3 },
  { abilityId: 'infernonova', effect: 'ignite', ms: 2500, magnitude: 3 },
  { abilityId: 'wyrmfire_lance', effect: 'ignite', ms: 2500, magnitude: 3 },

  // Cold → chill (slow factor; magnitude = movement multiplier applied on top of base speed).
  // Nova/AoE cold abilities (frostnova, glacierspike) also briefly freeze (root) on hit.
  { abilityId: 'frost', effect: 'chill', ms: 2000, magnitude: 0.3 },
  { abilityId: 'frostshard', effect: 'chill', ms: 2000, magnitude: 0.3 },
  { abilityId: 'frostlance', effect: 'chill', ms: 2000, magnitude: 0.3 },
  { abilityId: 'frostnova', effect: 'chill', ms: 2000, magnitude: 0.3 },
  { abilityId: 'frostnova', effect: 'freeze', ms: 900, magnitude: 1 },
  { abilityId: 'glacierspike', effect: 'chill', ms: 2000, magnitude: 0.3 },
  { abilityId: 'glacierspike', effect: 'freeze', ms: 900, magnitude: 1 },

  // Lightning → shock (vulnerability amplifier; magnitude = incoming-damage bonus fraction).
  { abilityId: 'lightning', effect: 'shock', ms: 2500, magnitude: 0.2 },
  { abilityId: 'sparkjolt', effect: 'shock', ms: 2500, magnitude: 0.2 },
  { abilityId: 'chainspark', effect: 'shock', ms: 2500, magnitude: 0.2 },
  { abilityId: 'staticburst', effect: 'shock', ms: 2500, magnitude: 0.2 },
  { abilityId: 'thunderlance', effect: 'shock', ms: 2500, magnitude: 0.2 },

  // Poison → poison (DoT; magnitude = damage per tick).
  { abilityId: 'venom', effect: 'poison', ms: 3000, magnitude: 2 },
  { abilityId: 'poison_spit', effect: 'poison', ms: 3000, magnitude: 2 },
  { abilityId: 'mire_mortar', effect: 'poison', ms: 3000, magnitude: 2 },

  // Physical projectiles and heavy melee → bleed (DoT; magnitude = damage per tick).
  { abilityId: 'slash', effect: 'bleed', ms: 2500, magnitude: 2 },
  { abilityId: 'arrow', effect: 'bleed', ms: 2500, magnitude: 2 },
  { abilityId: 'cleave', effect: 'bleed', ms: 2500, magnitude: 2 },
  { abilityId: 'quick_jab', effect: 'bleed', ms: 2500, magnitude: 2 },
  { abilityId: 'skewer', effect: 'bleed', ms: 2500, magnitude: 2 },
  { abilityId: 'broadsweep', effect: 'bleed', ms: 2500, magnitude: 2 },
  { abilityId: 'whirlwind', effect: 'bleed', ms: 2500, magnitude: 2 },
  { abilityId: 'bladestorm', effect: 'bleed', ms: 2500, magnitude: 2 },
  { abilityId: 'crushing_smash', effect: 'bleed', ms: 2500, magnitude: 2 },
  { abilityId: 'skullbreaker', effect: 'bleed', ms: 2500, magnitude: 2 },
  { abilityId: 'throwing_axe', effect: 'bleed', ms: 2500, magnitude: 2 },
  { abilityId: 'bone_chakram', effect: 'bleed', ms: 2500, magnitude: 2 },
  { abilityId: 'razor_wind', effect: 'bleed', ms: 2500, magnitude: 2 },

  // Control / hex rows on heavy-hitter and curse abilities.
  // Big slams stun briefly (root + no actions; magnitude = 1 = full stun).
  { abilityId: 'crushing_smash', effect: 'stun', ms: 700, magnitude: 1 },
  { abilityId: 'skullbreaker', effect: 'stun', ms: 700, magnitude: 1 },
  // Curse of Decay applies a proper curse debuff (amplifies all incoming magic damage).
  { abilityId: 'curse_of_decay', effect: 'curse', ms: 3000, magnitude: 0.2 },
  // Shadow Nova silences briefly (prevents ability use).
  { abilityId: 'shadow_nova', effect: 'silence', ms: 1500, magnitude: 1 },
];

/** A self-buff an ability grants its caster on cast (player War Cry / Sprint / Renew; mob heal-spells). */
export interface CastBuffDef {
  abilityId: string;
  buff: StatusId;
  ms: number;
  magnitude: number;
}

export const DEFAULT_CAST_BUFFS: CastBuffDef[] = [
  { abilityId: 'warcry', buff: 'might', ms: 8000, magnitude: 0.3 }, // +30% damage
  { abilityId: 'sprint', buff: 'haste', ms: 6000, magnitude: 0.35 }, // +35% attack speed & move
  { abilityId: 'renew', buff: 'regen', ms: 6000, magnitude: 10 }, // 10 hp/sec
  { abilityId: 'battle_trance', buff: 'might', ms: 10_000, magnitude: 0.45 }, // the late-game War Cry
];

/** A shrine blessing — stronger and longer than the buff spells (a found-shrine reward, Diablo-style). */
export interface ShrineBuffDef {
  id: string;
  buff: StatusId;
  ms: number;
  magnitude: number;
  label: string;
}

/**
 * One-shot knockback impulse: maps an ability id to the pixel distance the target is shoved
 * away from the attacker. Only applies to the named slam/blast abilities; omitted abilities have
 * no knockback (0 = no-op). Values are kept in the 50–90 px band so knockback is visible but
 * never map-breaking.
 */
export const ABILITY_KNOCKBACK: Record<string, number> = {
  crushing_smash: 70, // heavy melee slam
  skullbreaker: 60, // overhead skull-crack
  galeburst: 80, // wind-gust blast
};

export const DEFAULT_SHRINE_BUFFS: ShrineBuffDef[] = [
  {
    id: 'might',
    buff: 'might',
    ms: 30_000,
    magnitude: 0.4,
    label: 'Might — your blows strike harder',
  },
  {
    id: 'haste',
    buff: 'haste',
    ms: 30_000,
    magnitude: 0.4,
    label: 'Haste — you move and strike faster',
  },
  {
    id: 'regen',
    buff: 'regen',
    ms: 20_000,
    magnitude: 15,
    label: 'Renewal — your wounds knit closed',
  },
];
