/**
 * Combat model shared by client and server. The server is authoritative for all damage and
 * deaths; this file just defines the *rules* (ability stats, resources) so the client can
 * draw cooldowns, mana, and projectiles consistently.
 *
 * Flavor: WoW/Diablo/WC3-style direct-action abilities (a melee swing, a fireball, an arrow,
 * a frostbolt) with RuneScape-ish roaming, respawning monsters to fight.
 */

export type EntityKind =
  | 'player'
  | 'mob'
  | 'projectile'
  | 'item'
  | 'npc'
  | 'chest'
  | 'hireling'
  | 'pot'
  | 'den';

// AbilityId is derived from the ABILITIES table below (see the declaration), so adding a spell to
// that one object automatically extends the id type, ABILITY_ORDER, and the content seeding.
export type AbilityKind = 'melee' | 'projectile' | 'heal';

/**
 * The damage school of an ability. 'physical' is the neutral default (no mob carries physical
 * resistance by default, so untyped content behaves exactly as before). The elemental schools let
 * gear/affixes and mob resistances open a whole defensive axis (a fire mob shrugs off fireballs).
 */
export type DamageElement = 'physical' | 'fire' | 'cold' | 'lightning' | 'poison';

/**
 * A composable spell behavior (Slice 1 of the spell-behavior engine). Declared as data on an ability
 * and seeded into the content DB (`abilities.behaviors_json`), so behaviors are SQL-tunable. The
 * server resolves them via `src/server/projectile-behaviors.ts`. `falloff` is a per-event damage
 * multiplier (0.7 = each subsequent jump/pierce deals 70% of the prior).
 */
export type BehaviorSpec =
  | { type: 'chain'; count: number; range: number; falloff: number }
  | { type: 'pierce'; count: number; falloff: number }
  | { type: 'fork'; count: number; spreadRad: number; falloff: number }
  | { type: 'splash'; radius: number; scale: number }
  | { type: 'homing'; turnRate: number; acquireRange: number }
  | { type: 'multishot'; count: number; spreadRad: number }
  | { type: 'return'; falloff: number }
  /** Push the primary hit target `px` pixels directly away from the projectile impact point. */
  | { type: 'knockback'; px: number }
  /**
   * Caster-attached orbiting blade. The projectile ignores vx/vy and instead circles its owner
   * at `radius` pixels, rotating by `angularSpeed` rad/s each tick. It persists for its full TTL,
   * hitting each mob independently on a per-target re-hit cooldown (ORBIT_REHIT_MS) so a sweeping
   * ring damages multiple enemies without consuming itself.
   */
  | { type: 'orbit'; radius: number; angularSpeed: number }
  /**
   * Instant hitscan beam. Instead of spawning a projectile, the server traces a line segment from
   * the caster and applies the full deterministic hit pipeline to every living mob whose edge
   * (`pointToSegmentDist ≤ width + MOB_RADIUS`) overlaps the segment. Replaces the projectile-spawn
   * when present on a `kind:'projectile'` ability.
   */
  | { type: 'beam'; range: number; width: number };

export interface Ability {
  id: string;
  name: string;
  /** Legacy hotbar key. The client now binds the hotbar by slot position (1-6), so this is
   *  cosmetic/unused — kept only because the content DB column is NOT NULL. */
  key: string;
  kind: AbilityKind;
  damage: number;
  /** Melee reach (px) for melee; informational max travel for projectiles. */
  range: number;
  cooldownMs: number;
  manaCost: number;
  /** Render color (projectile body / melee arc). */
  color: string;
  /** Melee only: half-angle of the hit cone, radians. */
  meleeHalfAngle?: number;
  /** Projectile only. */
  projectileSpeed?: number;
  projectileTtlMs?: number;
  /** Projectile hit radius / melee arc thickness. */
  radius: number;
  /** Damage school (defaults to 'physical' when the DB column is unset). Drives mob resistances. */
  element?: DamageElement;
  /** Composable projectile behaviors (chain/pierce/fork/splash/homing/multishot/return). */
  behaviors?: BehaviorSpec[];
}

const ABILITY_DEFS = {
  slash: {
    id: 'slash',
    name: 'Slash',
    key: '1',
    kind: 'melee',
    damage: 14,
    range: 78,
    cooldownMs: 480,
    manaCost: 0,
    color: '#e8e8e8',
    meleeHalfAngle: 0.7,
    radius: 78,
  },
  fireball: {
    id: 'fireball',
    name: 'Fireball',
    key: '2',
    kind: 'projectile',
    damage: 26,
    range: 480,
    cooldownMs: 900,
    manaCost: 18,
    color: '#ff7a33',
    projectileSpeed: 320,
    projectileTtlMs: 1500,
    radius: 12,
    behaviors: [{ type: 'splash', radius: 70, scale: 0.5 }],
  },
  arrow: {
    id: 'arrow',
    name: 'Arrow',
    key: '3',
    kind: 'projectile',
    damage: 15,
    range: 620,
    cooldownMs: 380,
    manaCost: 0,
    color: '#d9c08a',
    projectileSpeed: 560,
    projectileTtlMs: 1100,
    radius: 5,
    behaviors: [{ type: 'pierce', count: 2, falloff: 0.9 }],
  },
  frost: {
    id: 'frost',
    name: 'Frostbolt',
    key: '4',
    kind: 'projectile',
    damage: 20,
    range: 420,
    cooldownMs: 1100,
    manaCost: 14,
    color: '#7fd4ff',
    projectileSpeed: 300,
    projectileTtlMs: 1400,
    radius: 10,
    behaviors: [{ type: 'splash', radius: 50, scale: 0.4 }],
  },
  heal: {
    id: 'heal',
    name: 'Heal',
    key: '5',
    kind: 'heal',
    damage: 35, // hp restored
    range: 0,
    cooldownMs: 6000,
    manaCost: 30,
    color: '#7cfc7c',
    radius: 0,
  },
  lightning: {
    id: 'lightning',
    name: 'Lightning',
    key: '6',
    kind: 'projectile',
    damage: 34,
    range: 560,
    cooldownMs: 1400,
    manaCost: 24,
    color: '#b388ff',
    projectileSpeed: 640,
    projectileTtlMs: 900,
    radius: 8,
    behaviors: [{ type: 'chain', count: 3, range: 150, falloff: 0.75 }],
  },
  // A heavy sweeping melee — wide arc, big hit, slow swing. The two-hander fantasy.
  cleave: {
    id: 'cleave',
    name: 'Cleave',
    key: '7',
    kind: 'melee',
    damage: 24,
    range: 92,
    cooldownMs: 1000,
    manaCost: 8,
    color: '#e0a060',
    meleeHalfAngle: 1.3,
    radius: 92,
  },
  // A venom bolt that poisons (slows) on hit — control + chip damage.
  venom: {
    id: 'venom',
    name: 'Venom Bolt',
    key: '8',
    kind: 'projectile',
    damage: 18,
    range: 440,
    cooldownMs: 950,
    manaCost: 14,
    color: '#9fd86a',
    projectileSpeed: 340,
    projectileTtlMs: 1300,
    radius: 9,
    behaviors: [{ type: 'splash', radius: 60, scale: 0.5 }],
  },
  // The big nuke: slow, expensive, hits hard and sets the target ablaze.
  meteor: {
    id: 'meteor',
    name: 'Meteor',
    key: '9',
    kind: 'projectile',
    damage: 44,
    range: 520,
    cooldownMs: 1800,
    manaCost: 34,
    color: '#ff5a2a',
    projectileSpeed: 300,
    projectileTtlMs: 1500,
    radius: 14,
    behaviors: [{ type: 'splash', radius: 70, scale: 0.5 }],
  },

  // --- Expanded spellbook: elemental (fire / ice / lightning) ---
  emberbolt: {
    id: 'emberbolt',
    name: 'Ember Bolt',
    key: '',
    kind: 'projectile',
    damage: 16,
    range: 440,
    cooldownMs: 420,
    manaCost: 6,
    color: '#ff9a4d',
    projectileSpeed: 560,
    projectileTtlMs: 1100,
    radius: 7,
  },
  frostshard: {
    id: 'frostshard',
    name: 'Frost Shard',
    key: '',
    kind: 'projectile',
    damage: 15,
    range: 420,
    cooldownMs: 460,
    manaCost: 7,
    color: '#aee7ff',
    projectileSpeed: 500,
    projectileTtlMs: 1100,
    radius: 7,
    behaviors: [{ type: 'splash', radius: 50, scale: 0.4 }],
  },
  sparkjolt: {
    id: 'sparkjolt',
    name: 'Spark Jolt',
    key: '',
    kind: 'projectile',
    damage: 14,
    range: 540,
    cooldownMs: 360,
    manaCost: 5,
    color: '#cdb4ff',
    projectileSpeed: 720,
    projectileTtlMs: 820,
    radius: 6,
  },
  frostlance: {
    id: 'frostlance',
    name: 'Frost Lance',
    key: '',
    kind: 'projectile',
    damage: 22,
    range: 470,
    cooldownMs: 820,
    manaCost: 14,
    color: '#7fd4ff',
    projectileSpeed: 440,
    projectileTtlMs: 1300,
    radius: 9,
    behaviors: [{ type: 'pierce', count: 2, falloff: 0.9 }],
  },
  flamewave: {
    id: 'flamewave',
    name: 'Flame Wave',
    key: '',
    kind: 'melee',
    damage: 20,
    range: 130,
    cooldownMs: 1300,
    manaCost: 16,
    color: '#ff6a2a',
    meleeHalfAngle: 1.3,
    radius: 130,
  },
  frostnova: {
    id: 'frostnova',
    name: 'Frost Nova',
    key: '',
    kind: 'melee',
    damage: 16,
    range: 150,
    cooldownMs: 1600,
    manaCost: 18,
    color: '#bff0ff',
    meleeHalfAngle: 3.15,
    radius: 150,
  },
  staticburst: {
    id: 'staticburst',
    name: 'Static Burst',
    key: '',
    kind: 'melee',
    damage: 18,
    range: 140,
    cooldownMs: 1400,
    manaCost: 17,
    color: '#c0a6ff',
    meleeHalfAngle: 3.15,
    radius: 140,
  },
  chainspark: {
    id: 'chainspark',
    name: 'Chain Spark',
    key: '',
    kind: 'projectile',
    damage: 30,
    range: 580,
    cooldownMs: 1100,
    manaCost: 22,
    color: '#b388ff',
    projectileSpeed: 760,
    projectileTtlMs: 880,
    radius: 8,
    behaviors: [{ type: 'chain', count: 3, range: 150, falloff: 0.75 }],
  },
  cinderorb: {
    id: 'cinderorb',
    name: 'Cinder Orb',
    key: '',
    kind: 'projectile',
    damage: 32,
    range: 460,
    cooldownMs: 1250,
    manaCost: 24,
    color: '#ff7e3a',
    projectileSpeed: 330,
    projectileTtlMs: 1500,
    radius: 13,
  },
  glacierspike: {
    id: 'glacierspike',
    name: 'Glacier Spike',
    key: '',
    kind: 'projectile',
    damage: 40,
    range: 500,
    cooldownMs: 1700,
    manaCost: 32,
    color: '#6fc6ff',
    projectileSpeed: 300,
    projectileTtlMs: 1500,
    radius: 14,
    behaviors: [{ type: 'splash', radius: 50, scale: 0.4 }],
  },
  thunderlance: {
    id: 'thunderlance',
    name: 'Thunder Lance',
    key: '',
    kind: 'projectile',
    damage: 42,
    range: 600,
    cooldownMs: 1650,
    manaCost: 32,
    color: '#9a7bff',
    projectileSpeed: 820,
    projectileTtlMs: 820,
    radius: 9,
    behaviors: [{ type: 'chain', count: 3, range: 150, falloff: 0.75 }],
  },
  infernonova: {
    id: 'infernonova',
    name: 'Inferno Nova',
    key: '',
    kind: 'melee',
    damage: 22,
    range: 165,
    cooldownMs: 2100,
    manaCost: 30,
    color: '#ff5320',
    meleeHalfAngle: 3.15,
    radius: 165,
  },

  // --- Expanded spellbook: occult & nature (shadow / poison / holy / arcane) ---
  poison_spit: {
    id: 'poison_spit',
    name: 'Poison Spit',
    key: '',
    kind: 'projectile',
    damage: 18,
    range: 440,
    cooldownMs: 800,
    manaCost: 14,
    color: '#7ccf3a',
    projectileSpeed: 340,
    projectileTtlMs: 1500,
    radius: 10,
    behaviors: [{ type: 'splash', radius: 60, scale: 0.5 }],
  },
  shadow_bolt: {
    id: 'shadow_bolt',
    name: 'Shadow Bolt',
    key: '',
    kind: 'projectile',
    damage: 24,
    range: 480,
    cooldownMs: 850,
    manaCost: 16,
    color: '#8a5bd6',
    projectileSpeed: 360,
    projectileTtlMs: 1400,
    radius: 10,
  },
  draining_touch: {
    id: 'draining_touch',
    name: 'Draining Touch',
    key: '',
    kind: 'projectile',
    damage: 22,
    range: 400,
    cooldownMs: 1000,
    manaCost: 18,
    color: '#a23bbf',
    projectileSpeed: 320,
    projectileTtlMs: 1300,
    radius: 9,
  },
  entangling_vines: {
    id: 'entangling_vines',
    name: 'Entangling Vines',
    key: '',
    kind: 'projectile',
    damage: 16,
    range: 460,
    cooldownMs: 1100,
    manaCost: 18,
    color: '#4a9e52',
    projectileSpeed: 300,
    projectileTtlMs: 1600,
    radius: 11,
  },
  arcane_orb: {
    id: 'arcane_orb',
    name: 'Arcane Orb',
    key: '',
    kind: 'projectile',
    damage: 30,
    range: 500,
    cooldownMs: 1200,
    manaCost: 22,
    color: '#3fa9f5',
    projectileSpeed: 300,
    projectileTtlMs: 1700,
    radius: 14,
    behaviors: [{ type: 'orbit', radius: 48, angularSpeed: 3.2 }],
  },
  radiant_smite: {
    id: 'radiant_smite',
    name: 'Radiant Smite',
    key: '',
    kind: 'projectile',
    damage: 28,
    range: 470,
    cooldownMs: 1000,
    manaCost: 20,
    color: '#ffd966',
    projectileSpeed: 380,
    projectileTtlMs: 1300,
    radius: 11,
  },
  curse_of_decay: {
    id: 'curse_of_decay',
    name: 'Curse of Decay',
    key: '',
    kind: 'melee',
    damage: 20,
    range: 170,
    cooldownMs: 1300,
    manaCost: 20,
    color: '#6b8e2a',
    meleeHalfAngle: 1.3,
    radius: 26,
  },
  shadow_nova: {
    id: 'shadow_nova',
    name: 'Shadow Nova',
    key: '',
    kind: 'melee',
    damage: 16,
    range: 150,
    cooldownMs: 1600,
    manaCost: 22,
    color: '#5a3a8c',
    meleeHalfAngle: 3.15,
    radius: 30,
  },
  consecration: {
    id: 'consecration',
    name: 'Consecration',
    key: '',
    kind: 'melee',
    damage: 18,
    range: 160,
    cooldownMs: 1900,
    manaCost: 24,
    color: '#ffe9a8',
    meleeHalfAngle: 3.15,
    radius: 32,
  },
  lesser_mend: {
    id: 'lesser_mend',
    name: 'Lesser Mend',
    key: '',
    kind: 'heal',
    damage: 22,
    range: 0,
    cooldownMs: 4000,
    manaCost: 20,
    color: '#9be8a0',
    radius: 0,
  },
  greater_restoration: {
    id: 'greater_restoration',
    name: 'Greater Restoration',
    key: '',
    kind: 'heal',
    damage: 52,
    range: 0,
    cooldownMs: 8000,
    manaCost: 34,
    color: '#e8f5b0',
    radius: 0,
  },
  natures_renewal: {
    id: 'natures_renewal',
    name: "Nature's Renewal",
    key: '',
    kind: 'heal',
    damage: 38,
    range: 0,
    cooldownMs: 6000,
    manaCost: 28,
    color: '#6fd98f',
    radius: 0,
  },

  // --- Expanded spellbook: martial / physical weapon skills ---
  quick_jab: {
    id: 'quick_jab',
    name: 'Quick Jab',
    key: '',
    kind: 'melee',
    damage: 13,
    range: 74,
    cooldownMs: 360,
    manaCost: 0,
    color: '#e8e8ee',
    meleeHalfAngle: 0.4,
    radius: 74,
  },
  skewer: {
    id: 'skewer',
    name: 'Skewer',
    key: '',
    kind: 'melee',
    damage: 18,
    range: 120,
    cooldownMs: 560,
    manaCost: 4,
    color: '#cfd2d8',
    meleeHalfAngle: 0.4,
    radius: 120,
  },
  broadsweep: {
    id: 'broadsweep',
    name: 'Broadsweep',
    key: '',
    kind: 'melee',
    damage: 21,
    range: 96,
    cooldownMs: 1050,
    manaCost: 8,
    color: '#d4d8de',
    meleeHalfAngle: 1.3,
    radius: 96,
  },
  whirlwind: {
    id: 'whirlwind',
    name: 'Whirlwind',
    key: '',
    kind: 'melee',
    damage: 17,
    range: 110,
    cooldownMs: 1300,
    manaCost: 6,
    color: '#d8d8e0',
    meleeHalfAngle: 3.15,
    radius: 110,
  },
  bladestorm: {
    id: 'bladestorm',
    name: 'Bladestorm',
    key: '',
    kind: 'melee',
    damage: 20,
    range: 130,
    cooldownMs: 1700,
    manaCost: 12,
    color: '#c2c6cf',
    meleeHalfAngle: 3.15,
    radius: 130,
  },
  crushing_smash: {
    id: 'crushing_smash',
    name: 'Crushing Smash',
    key: '',
    kind: 'melee',
    damage: 34,
    range: 88,
    cooldownMs: 1300,
    manaCost: 10,
    color: '#b8bcc4',
    meleeHalfAngle: 0.7,
    radius: 88,
  },
  skullbreaker: {
    id: 'skullbreaker',
    name: 'Skullbreaker',
    key: '',
    kind: 'melee',
    damage: 40,
    range: 92,
    cooldownMs: 1600,
    manaCost: 12,
    color: '#a8acb4',
    meleeHalfAngle: 0.7,
    radius: 92,
  },
  rend: {
    id: 'rend',
    name: 'Rend',
    key: '',
    kind: 'melee',
    damage: 16,
    range: 90,
    cooldownMs: 900,
    manaCost: 7,
    color: '#b22b2b',
    meleeHalfAngle: 0.7,
    radius: 90,
  },
  hamstring: {
    id: 'hamstring',
    name: 'Hamstring',
    key: '',
    kind: 'melee',
    damage: 14,
    range: 84,
    cooldownMs: 700,
    manaCost: 6,
    color: '#9aa2b0',
    meleeHalfAngle: 0.7,
    radius: 84,
  },
  throwing_axe: {
    id: 'throwing_axe',
    name: 'Throwing Axe',
    key: '',
    kind: 'projectile',
    damage: 22,
    range: 0,
    cooldownMs: 620,
    manaCost: 5,
    color: '#cdd1d7',
    projectileSpeed: 520,
    projectileTtlMs: 900,
    radius: 14,
  },

  // --- Self-buff spells (kind 'heal' = instant self-cast; the buff is applied server-side) ---
  // War Cry: temporary outgoing-damage boost (MIGHT).
  warcry: {
    id: 'warcry',
    name: 'War Cry',
    key: '',
    kind: 'heal',
    damage: 0,
    range: 0,
    cooldownMs: 9000,
    manaCost: 16,
    color: '#ffb347',
    radius: 0,
  },
  // Sprint: temporary attack-speed + movement boost (HASTE).
  sprint: {
    id: 'sprint',
    name: 'Sprint',
    key: '',
    kind: 'heal',
    damage: 0,
    range: 0,
    cooldownMs: 8000,
    manaCost: 12,
    color: '#7cf0ff',
    radius: 0,
  },
  // Renew: a heal-over-time (REGEN), distinct from the instant Heal.
  renew: {
    id: 'renew',
    name: 'Renew',
    key: '',
    kind: 'heal',
    damage: 0,
    range: 0,
    cooldownMs: 7000,
    manaCost: 18,
    color: '#9be8a0',
    radius: 0,
  },

  // --- Long-climb expansion: chase spells spread across the lengthened progression ---
  // Razor Wind: a whisper-cheap, blade-fast sliver — the machine-gun pick of the early game.
  razor_wind: {
    id: 'razor_wind',
    name: 'Razor Wind',
    key: '',
    kind: 'projectile',
    damage: 15,
    range: 600,
    cooldownMs: 400,
    manaCost: 5,
    color: '#bfe8d8',
    projectileSpeed: 780,
    projectileTtlMs: 800,
    radius: 5,
  },
  // Bone Chakram: a wide spinning disc — generous hit radius makes it feel like it skips into targets.
  bone_chakram: {
    id: 'bone_chakram',
    name: 'Bone Chakram',
    key: '',
    kind: 'projectile',
    damage: 19,
    range: 520,
    cooldownMs: 700,
    manaCost: 9,
    color: '#efe6cd',
    projectileSpeed: 600,
    projectileTtlMs: 950,
    radius: 12,
    behaviors: [{ type: 'return', falloff: 0.8 }],
  },
  // Mire Mortar: a slow, heavy glob lobbed in a lazy arc — big splat, mid-game crowd softener.
  // The sheer weight of impact shoves the primary target away on hit.
  mire_mortar: {
    id: 'mire_mortar',
    name: 'Mire Mortar',
    key: '',
    kind: 'projectile',
    damage: 24,
    range: 380,
    cooldownMs: 1400,
    manaCost: 16,
    color: '#8a6b42',
    projectileSpeed: 220,
    projectileTtlMs: 1900,
    radius: 18,
    behaviors: [{ type: 'knockback', px: 55 }],
  },
  // Galeburst: a full-circle gust nova (half-angle ~π = all around), the mid-game "get off me".
  galeburst: {
    id: 'galeburst',
    name: 'Galeburst',
    key: '',
    kind: 'melee',
    damage: 19,
    range: 175,
    cooldownMs: 1900,
    manaCost: 26,
    color: '#9fe0c8',
    meleeHalfAngle: 3.15,
    radius: 175,
  },
  // Earthshatter: the biggest nova in the book — long cooldown, costly, the ground itself revolts.
  earthshatter: {
    id: 'earthshatter',
    name: 'Earthshatter',
    key: '',
    kind: 'melee',
    damage: 26,
    range: 185,
    cooldownMs: 2400,
    manaCost: 34,
    color: '#b97f3e',
    meleeHalfAngle: 3.15,
    radius: 185,
  },
  // Divine Mending: the big slow expensive heal — a long-cooldown panic reset.
  divine_mending: {
    id: 'divine_mending',
    name: 'Divine Mending',
    key: '',
    kind: 'heal',
    damage: 70, // hp restored
    range: 0,
    cooldownMs: 11000,
    manaCost: 44,
    color: '#fff2c8',
    radius: 0,
  },
  // Battle Trance: a late-game self-buff (a stronger War Cry). The timed MIGHT buff is applied
  // server-side via world.ts BUFF_ON_CAST — like warcry/sprint/renew, damage stays 0 here.
  battle_trance: {
    id: 'battle_trance',
    name: 'Battle Trance',
    key: '',
    kind: 'heal',
    damage: 0,
    range: 0,
    cooldownMs: 12000,
    manaCost: 30,
    color: '#ff7088',
    radius: 0,
  },
  // Wyrmfire Lance: a late-game rail of dragonfire — fastest bolt in the book, hits like one.
  wyrmfire_lance: {
    id: 'wyrmfire_lance',
    name: 'Wyrmfire Lance',
    key: '',
    kind: 'projectile',
    damage: 50,
    range: 640,
    cooldownMs: 2100,
    manaCost: 40,
    color: '#ff3d3d',
    projectileSpeed: 860,
    projectileTtlMs: 780,
    radius: 10,
    behaviors: [{ type: 'pierce', count: 2, falloff: 0.9 }],
  },
  // Starfall: a bolt of pure starfire that pierces the sky and burns everything in its path.
  // Uses the beam behavior: an instant hitscan line rather than a travelling projectile.
  starfall: {
    id: 'starfall',
    name: 'Starfall',
    key: '',
    kind: 'projectile',
    damage: 55,
    range: 560,
    cooldownMs: 2300,
    manaCost: 42,
    color: '#e8d8ff',
    projectileSpeed: 340,
    projectileTtlMs: 1700,
    radius: 16,
    behaviors: [{ type: 'beam', range: 360, width: 18 }],
  },
  // Maelstrom Orb: the endgame chase nuke — a huge, slow vortex with the biggest hit in the book.
  maelstrom_orb: {
    id: 'maelstrom_orb',
    name: 'Maelstrom Orb',
    key: '',
    kind: 'projectile',
    damage: 60,
    range: 480,
    cooldownMs: 2600,
    manaCost: 48,
    color: '#4fd8c9',
    projectileSpeed: 260,
    projectileTtlMs: 1900,
    radius: 20,
  },
} satisfies Record<string, Ability>;

/** Every ability id — derived from the table so adding a spell above extends the type for free. */
export type AbilityId = keyof typeof ABILITY_DEFS;

/** The ability table. Re-typed as Record<AbilityId, Ability> so every entry reads as a full
 *  Ability (optional projectile/melee fields accessible) while keys stay the literal AbilityId. */
export const ABILITIES: Record<AbilityId, Ability> = ABILITY_DEFS;

/** Canonical spell order (declaration order of ABILITIES) — drives seeding sort and any list UI. */
export const ABILITY_ORDER: AbilityId[] = Object.keys(ABILITIES) as AbilityId[];

/**
 * Abilities every fresh character knows. Everything else is *acquired* — learned from spellbook
 * items that drop from monsters, reward quests, or sit on a vendor's shelf ("loot = your build").
 */
export const STARTER_ABILITIES: AbilityId[] = ['slash'];

// --- Spell ranks (the Diablo 1 duplicate rule: re-reading a known book ranks the spell up) ---
export const MAX_SPELL_RANK = 5;
/** Effect bonus per rank above 1 (damage / healing), e.g. rank 3 = +24%. */
export const SPELL_RANK_EFFECT = 0.12;

/** Damage/heal multiplier for a spell at the given rank (rank 1 = 1.0). */
export function spellRankMult(rank: number): number {
  return 1 + SPELL_RANK_EFFECT * (Math.min(MAX_SPELL_RANK, Math.max(1, rank)) - 1);
}

export function isAbilityId(value: unknown): value is AbilityId {
  return typeof value === 'string' && value in ABILITIES;
}

// --- Player resources -----------------------------------------------------------------
export const PLAYER_MAX_HP = 100;
export const PLAYER_MAX_MANA = 100;
export const MANA_REGEN_PER_SEC = 12;
export const HP_REGEN_PER_SEC = 3;
export const PLAYER_RESPAWN_MS = 3000;

// --- Physical sizes (collision + rendering) -------------------------------------------
export const PLAYER_RADIUS = 14;
export const MOB_RADIUS = 16;
export const MOB_RESPAWN_MS = 8000;

// --- Transient visual effects the server emits and the client renders -----------------
export interface FxEvent {
  kind:
    | 'melee'
    | 'hit'
    | 'cast'
    | 'death'
    | 'pickup'
    | 'coin'
    | 'heal'
    | 'levelup'
    | 'telegraph'
    | 'slam'
    | 'arc'
    | 'beam';
  x: number;
  y: number;
  /** Facing/direction in radians (melee arcs, cast flashes, telegraph aim). */
  facing?: number;
  /** 'hit': damage · 'coin': gold · 'heal': HP restored · 'levelup': new level · 'telegraph': wind-up duration (ms) · 'slam': radius. */
  value?: number;
  /** Radius for AoE tells/impacts ('telegraph' slam danger zone, 'slam' impact ring). */
  radius?: number;
  /** 'telegraph' only: how to draw the tell — aimed line, strike arc, or AoE circle. */
  behavior?: 'melee' | 'ranged' | 'slam';
  /** 'hit' only: true if the strike was a critical hit (client renders it bigger). */
  crit?: boolean;
  /** 'pickup' only: rarity of a picked-up gear instance, so the sparkle matches its color. */
  rarity?: string;
  abilityId?: AbilityId;
  /** `arc` only: the far endpoint of a chain link (the source is x,y). */
  x2?: number;
  y2?: number;
  /** `arc` only: element tint for the arc color. */
  element?: DamageElement;
}
