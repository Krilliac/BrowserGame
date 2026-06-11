/**
 * Combat model shared by client and server. The server is authoritative for all damage and
 * deaths; this file just defines the *rules* (ability stats, resources) so the client can
 * draw cooldowns, mana, and projectiles consistently.
 *
 * Flavor: WoW/Diablo/WC3-style direct-action abilities (a melee swing, a fireball, an arrow,
 * a frostbolt) with RuneScape-ish roaming, respawning monsters to fight.
 */

export type EntityKind = 'player' | 'mob' | 'projectile' | 'item' | 'npc';

export type AbilityId =
  | 'slash'
  | 'fireball'
  | 'arrow'
  | 'frost'
  | 'heal'
  | 'lightning'
  | 'cleave'
  | 'venom'
  | 'meteor';

export type AbilityKind = 'melee' | 'projectile' | 'heal';

export interface Ability {
  id: AbilityId;
  name: string;
  /** Hotbar key (1-4). */
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
}

export const ABILITIES: Record<AbilityId, Ability> = {
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
  },
};

export const ABILITY_ORDER: AbilityId[] = [
  'slash',
  'fireball',
  'arrow',
  'frost',
  'heal',
  'lightning',
  'cleave',
  'venom',
  'meteor',
];

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
  kind: 'melee' | 'hit' | 'cast' | 'death' | 'pickup' | 'coin' | 'levelup' | 'telegraph' | 'slam';
  x: number;
  y: number;
  /** Facing/direction in radians (melee arcs, cast flashes, telegraph aim). */
  facing?: number;
  /** 'hit': damage · 'coin': gold · 'levelup': new level · 'telegraph': wind-up duration (ms) · 'slam': radius. */
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
}
