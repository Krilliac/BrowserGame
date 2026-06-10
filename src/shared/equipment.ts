/**
 * Equippable gear shared by client and server. Items carry base stats (weapons add attack power,
 * armor adds max HP) and roll affixes on top; the server is authoritative for what's equipped and
 * the derived stats. This file is the shared source of truth for the slots and the base items.
 */

/** What kind of slot an item occupies. (Rings resolve to one of the two ring doll-slots.) */
export type ItemSlot =
  | 'head'
  | 'neck'
  | 'shoulders'
  | 'chest'
  | 'hands'
  | 'waist'
  | 'legs'
  | 'feet'
  | 'mainhand'
  | 'offhand'
  | 'ring'
  | 'trinket';

/** A position on the character paper-doll (two ring positions). */
export type EquipSlot =
  | 'head'
  | 'neck'
  | 'shoulders'
  | 'chest'
  | 'hands'
  | 'waist'
  | 'legs'
  | 'feet'
  | 'mainhand'
  | 'offhand'
  | 'ring1'
  | 'ring2'
  | 'trinket';

/** All doll slots, in a stable order. */
export const EQUIP_SLOTS: EquipSlot[] = [
  'head',
  'neck',
  'shoulders',
  'chest',
  'hands',
  'waist',
  'legs',
  'feet',
  'mainhand',
  'offhand',
  'ring1',
  'ring2',
  'trinket',
];

/** Friendly labels for the character panel. */
export const SLOT_LABELS: Record<EquipSlot, string> = {
  head: 'Head',
  neck: 'Neck',
  shoulders: 'Shoulders',
  chest: 'Chest',
  hands: 'Hands',
  waist: 'Waist',
  legs: 'Legs',
  feet: 'Feet',
  mainhand: 'Main Hand',
  offhand: 'Off Hand',
  ring1: 'Ring',
  ring2: 'Ring',
  trinket: 'Trinket',
};

/** The doll slots an item of the given item-slot can occupy (rings can go in either ring slot). */
export function dollSlotsFor(itemSlot: ItemSlot): EquipSlot[] {
  if (itemSlot === 'ring') return ['ring1', 'ring2'];
  return [itemSlot];
}

export interface EquipDef {
  id: string;
  name: string;
  slot: ItemSlot;
  /** Flat damage added to every attack (weapons). */
  power?: number;
  /** Bonus max HP (armor and most gear). */
  hp?: number;
  /** Render color for the ground-drop glint and UI. */
  color: string;
}

/** Base equipment, one+ per slot. Weapons give power; armor gives HP; jewelry leans on affixes. */
export const EQUIPMENT: Record<string, EquipDef> = {
  // Main hand (weapons).
  rusty_sword: {
    id: 'rusty_sword',
    name: 'Rusty Sword',
    slot: 'mainhand',
    power: 6,
    color: '#b0a080',
  },
  iron_sword: {
    id: 'iron_sword',
    name: 'Iron Sword',
    slot: 'mainhand',
    power: 13,
    color: '#c8d0d8',
  },
  // Off hand.
  buckler: { id: 'buckler', name: 'Buckler', slot: 'offhand', hp: 14, color: '#9a7b4a' },
  wooden_shield: {
    id: 'wooden_shield',
    name: 'Wooden Shield',
    slot: 'offhand',
    hp: 26,
    color: '#7a5a30',
  },
  // Head.
  leather_cap: { id: 'leather_cap', name: 'Leather Cap', slot: 'head', hp: 12, color: '#8a5a2a' },
  iron_helm: { id: 'iron_helm', name: 'Iron Helm', slot: 'head', hp: 28, color: '#9aa4b0' },
  // Shoulders.
  leather_pauldrons: {
    id: 'leather_pauldrons',
    name: 'Leather Pauldrons',
    slot: 'shoulders',
    hp: 16,
    color: '#8a5a2a',
  },
  // Chest.
  leather_armor: {
    id: 'leather_armor',
    name: 'Leather Armor',
    slot: 'chest',
    hp: 30,
    color: '#8a5a2a',
  },
  iron_armor: { id: 'iron_armor', name: 'Iron Armor', slot: 'chest', hp: 65, color: '#9aa4b0' },
  // Hands.
  leather_gloves: {
    id: 'leather_gloves',
    name: 'Leather Gloves',
    slot: 'hands',
    hp: 10,
    color: '#8a5a2a',
  },
  // Waist.
  leather_belt: {
    id: 'leather_belt',
    name: 'Leather Belt',
    slot: 'waist',
    hp: 10,
    color: '#8a5a2a',
  },
  // Legs.
  leather_pants: {
    id: 'leather_pants',
    name: 'Leather Pants',
    slot: 'legs',
    hp: 18,
    color: '#8a5a2a',
  },
  iron_greaves: {
    id: 'iron_greaves',
    name: 'Iron Greaves',
    slot: 'legs',
    hp: 36,
    color: '#9aa4b0',
  },
  // Feet.
  leather_boots: {
    id: 'leather_boots',
    name: 'Leather Boots',
    slot: 'feet',
    hp: 12,
    color: '#8a5a2a',
  },
  // Jewelry (small base stats; their value is mostly in rolled affixes).
  pendant: { id: 'pendant', name: 'Pendant', slot: 'neck', hp: 6, color: '#e0c060' },
  copper_ring: { id: 'copper_ring', name: 'Copper Ring', slot: 'ring', hp: 4, color: '#c08040' },
  silver_ring: { id: 'silver_ring', name: 'Silver Ring', slot: 'ring', hp: 6, color: '#d8d8e0' },
  charm: { id: 'charm', name: 'Charm', slot: 'trinket', hp: 8, color: '#8fd0ff' },

  // --- Higher tiers, the loot identity of the new areas (marsh → mines → frostpeak) ---
  // Steel (Rotfen Marsh / Emberdeep): a clear step over iron.
  steel_sword: {
    id: 'steel_sword',
    name: 'Steel Sword',
    slot: 'mainhand',
    power: 22,
    color: '#c0c8d4',
  },
  steel_armor: { id: 'steel_armor', name: 'Steel Armor', slot: 'chest', hp: 95, color: '#b8c0cc' },
  steel_helm: { id: 'steel_helm', name: 'Steel Helm', slot: 'head', hp: 42, color: '#b8c0cc' },
  tower_shield: {
    id: 'tower_shield',
    name: 'Tower Shield',
    slot: 'offhand',
    hp: 48,
    color: '#8a8f99',
  },
  // Mithril (Frostpeak): the current endgame base tier.
  mithril_blade: {
    id: 'mithril_blade',
    name: 'Mithril Blade',
    slot: 'mainhand',
    power: 34,
    color: '#9fe6e0',
  },
  mithril_armor: {
    id: 'mithril_armor',
    name: 'Mithril Armor',
    slot: 'chest',
    hp: 140,
    color: '#9fe6e0',
  },
  runed_band: { id: 'runed_band', name: 'Runed Band', slot: 'ring', hp: 10, color: '#b388ff' },
};

export function isEquip(id: string): boolean {
  return id in EQUIPMENT;
}

export function equipDef(id: string): EquipDef | undefined {
  return EQUIPMENT[id];
}
