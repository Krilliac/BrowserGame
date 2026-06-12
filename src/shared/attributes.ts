/**
 * Character attributes — the Diablo-II stat-point layer. On each level-up a character earns
 * {@link ATTR_POINTS_PER_LEVEL} points to spend across four attributes, each feeding a derived combat
 * stat. Shared so the server (authoritative allocation + stat recompute) and the client (the allocate
 * panel + previews) agree exactly. All functions here are pure.
 *
 *   strength  → attack power
 *   vitality  → maximum HP
 *   dexterity → crit chance
 *   energy    → mana regeneration
 */

export interface AttributeSet {
  strength: number;
  vitality: number;
  dexterity: number;
  energy: number;
}

/** The four attribute keys, in display order. */
export const ATTRIBUTE_KEYS: (keyof AttributeSet)[] = [
  'strength',
  'vitality',
  'dexterity',
  'energy',
];

/** Short labels for the HUD. */
export const ATTRIBUTE_LABELS: Record<keyof AttributeSet, string> = {
  strength: 'Strength',
  vitality: 'Vitality',
  dexterity: 'Dexterity',
  energy: 'Energy',
};

/** One-line effect descriptions for the allocate panel. */
export const ATTRIBUTE_EFFECTS: Record<keyof AttributeSet, string> = {
  strength: '+attack power',
  vitality: '+maximum HP',
  dexterity: '+crit chance',
  energy: '+mana regen',
};

/** Every attribute starts here; points raise it from this floor. */
export const BASE_ATTRIBUTE = 10;
/** Attribute points granted per level-up. */
export const ATTR_POINTS_PER_LEVEL = 5;

/** Per-point yields (applied to the amount ABOVE {@link BASE_ATTRIBUTE}). */
const POWER_PER_STR = 0.5; // +1 power per 2 strength
const HP_PER_VIT = 4; // +4 max HP per vitality
const CRIT_PER_DEX = 0.002; // +0.2% crit per dexterity
const MANA_REGEN_PER_ENE = 0.3; // +0.3 mana/sec per energy

/** A fresh attribute set (all at the base). */
export function emptyAttributes(): AttributeSet {
  return {
    strength: BASE_ATTRIBUTE,
    vitality: BASE_ATTRIBUTE,
    dexterity: BASE_ATTRIBUTE,
    energy: BASE_ATTRIBUTE,
  };
}

/** Coerce an arbitrary (possibly partial / persisted) value into a valid AttributeSet. */
export function toAttributeSet(raw: Partial<AttributeSet> | undefined): AttributeSet {
  const base = emptyAttributes();
  if (!raw) return base;
  for (const k of ATTRIBUTE_KEYS) {
    const v = raw[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= BASE_ATTRIBUTE) base[k] = Math.floor(v);
  }
  return base;
}

export interface AttributeBonuses {
  power: number;
  maxHp: number;
  critChance: number;
  manaRegen: number;
}

/** The derived combat-stat bonuses from a set of attributes (zero when all at the base). */
export function attributeBonuses(attrs: AttributeSet): AttributeBonuses {
  return {
    power: Math.floor((attrs.strength - BASE_ATTRIBUTE) * POWER_PER_STR),
    maxHp: (attrs.vitality - BASE_ATTRIBUTE) * HP_PER_VIT,
    critChance: (attrs.dexterity - BASE_ATTRIBUTE) * CRIT_PER_DEX,
    manaRegen: (attrs.energy - BASE_ATTRIBUTE) * MANA_REGEN_PER_ENE,
  };
}
