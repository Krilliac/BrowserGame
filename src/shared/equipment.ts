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

  // ===================================================================================
  // Expanded loot pool — many more bases across every slot and tier. The drop system picks
  // a random equip base for each gear drop, so simply registering these widens all loot.
  // ===================================================================================

  // --- Weapons: main hand ---
  rusted_cleaver: {
    id: 'rusted_cleaver',
    name: 'Rusted Cleaver',
    slot: 'mainhand',
    power: 6,
    color: '#8a7355',
  },
  chipped_hatchet: {
    id: 'chipped_hatchet',
    name: 'Chipped Hatchet',
    slot: 'mainhand',
    power: 7,
    color: '#9a8b6f',
  },
  splintered_cudgel: {
    id: 'splintered_cudgel',
    name: 'Splintered Cudgel',
    slot: 'mainhand',
    power: 5,
    color: '#7c6242',
  },
  bent_shiv: { id: 'bent_shiv', name: 'Bent Shiv', slot: 'mainhand', power: 8, color: '#a39b88' },
  bronze_falchion: {
    id: 'bronze_falchion',
    name: 'Bronze Falchion',
    slot: 'mainhand',
    power: 12,
    color: '#caa86a',
  },
  iron_warpike: {
    id: 'iron_warpike',
    name: 'Iron Warpike',
    slot: 'mainhand',
    power: 14,
    color: '#b7b7bf',
  },
  footmans_mace: {
    id: 'footmans_mace',
    name: "Footman's Mace",
    slot: 'mainhand',
    power: 11,
    color: '#a8a29a',
  },
  serpentine_dagger: {
    id: 'serpentine_dagger',
    name: 'Serpentine Dagger',
    slot: 'mainhand',
    power: 15,
    color: '#7fae74',
  },
  knights_arming_sword: {
    id: 'knights_arming_sword',
    name: "Knight's Arming Sword",
    slot: 'mainhand',
    power: 22,
    color: '#d4d8e0',
  },
  wardens_halberd: {
    id: 'wardens_halberd',
    name: "Warden's Halberd",
    slot: 'mainhand',
    power: 25,
    color: '#c2c6cc',
  },
  reapers_scythe: {
    id: 'reapers_scythe',
    name: "Reaper's Scythe",
    slot: 'mainhand',
    power: 24,
    color: '#9aa0a8',
  },
  tempered_glaive: {
    id: 'tempered_glaive',
    name: 'Tempered Glaive',
    slot: 'mainhand',
    power: 20,
    color: '#b0b8c0',
  },
  mithril_warhammer: {
    id: 'mithril_warhammer',
    name: 'Mithril Warhammer',
    slot: 'mainhand',
    power: 33,
    color: '#bfe3e8',
  },
  moonsilver_saber: {
    id: 'moonsilver_saber',
    name: 'Moonsilver Saber',
    slot: 'mainhand',
    power: 30,
    color: '#cfe0f2',
  },
  frostforged_glaive: {
    id: 'frostforged_glaive',
    name: 'Frostforged Glaive',
    slot: 'mainhand',
    power: 37,
    color: '#a9d8ec',
  },
  doomspike_partisan: {
    id: 'doomspike_partisan',
    name: 'Doomspike Partisan',
    slot: 'mainhand',
    power: 44,
    color: '#c77be0',
  },

  // --- Off hand: shields (hp) and caster off-hands (power) ---
  battered_targe: {
    id: 'battered_targe',
    name: 'Battered Targe',
    slot: 'offhand',
    hp: 14,
    color: '#7c6a4d',
  },
  splitwood_parma: {
    id: 'splitwood_parma',
    name: 'Splitwood Parma',
    slot: 'offhand',
    hp: 17,
    color: '#8a7048',
  },
  banded_heater_shield: {
    id: 'banded_heater_shield',
    name: 'Banded Heater Shield',
    slot: 'offhand',
    hp: 26,
    color: '#b3b3bb',
  },
  iron_kite_shield: {
    id: 'iron_kite_shield',
    name: 'Iron Kite Shield',
    slot: 'offhand',
    hp: 29,
    color: '#a7abb2',
  },
  aegis_of_the_vanguard: {
    id: 'aegis_of_the_vanguard',
    name: 'Aegis of the Vanguard',
    slot: 'offhand',
    hp: 50,
    color: '#d6dae2',
  },
  bulwark_of_the_pale_moon: {
    id: 'bulwark_of_the_pale_moon',
    name: 'Bulwark of the Pale Moon',
    slot: 'offhand',
    hp: 70,
    color: '#c4e6f0',
  },
  cracked_grimoire: {
    id: 'cracked_grimoire',
    name: 'Cracked Grimoire',
    slot: 'offhand',
    power: 4,
    color: '#6f5a7d',
  },
  emberglass_orb: {
    id: 'emberglass_orb',
    name: 'Emberglass Orb',
    slot: 'offhand',
    power: 12,
    color: '#e08a5a',
  },

  // --- Armor: head ---
  padded_coif: { id: 'padded_coif', name: 'Padded Coif', slot: 'head', hp: 12, color: '#7a5c3e' },
  iron_sallet: { id: 'iron_sallet', name: 'Iron Sallet', slot: 'head', hp: 28, color: '#9aa4b0' },
  steel_bascinet: {
    id: 'steel_bascinet',
    name: 'Steel Bascinet',
    slot: 'head',
    hp: 43,
    color: '#b9c0c8',
  },
  mithril_visage: {
    id: 'mithril_visage',
    name: 'Mithril Visage',
    slot: 'head',
    hp: 62,
    color: '#3fb8a6',
  },
  runed_crown_of_vigil: {
    id: 'runed_crown_of_vigil',
    name: 'Runed Crown of Vigil',
    slot: 'head',
    hp: 77,
    color: '#8b5cd6',
  },

  // --- Armor: shoulders ---
  hide_spaulders: {
    id: 'hide_spaulders',
    name: 'Hide Spaulders',
    slot: 'shoulders',
    hp: 16,
    color: '#6f4e34',
  },
  iron_shoulderplates: {
    id: 'iron_shoulderplates',
    name: 'Iron Shoulderplates',
    slot: 'shoulders',
    hp: 25,
    color: '#949ea9',
  },
  steel_pauldrons: {
    id: 'steel_pauldrons',
    name: 'Steel Pauldrons',
    slot: 'shoulders',
    hp: 41,
    color: '#b4bcc4',
  },
  mithril_mantle: {
    id: 'mithril_mantle',
    name: 'Mithril Mantle',
    slot: 'shoulders',
    hp: 58,
    color: '#36b29f',
  },
  frostforged_pauldrons: {
    id: 'frostforged_pauldrons',
    name: 'Frostforged Pauldrons',
    slot: 'shoulders',
    hp: 73,
    color: '#9d6ee0',
  },

  // --- Armor: chest ---
  boiled_leather_jerkin: {
    id: 'boiled_leather_jerkin',
    name: 'Boiled Leather Jerkin',
    slot: 'chest',
    hp: 31,
    color: '#7c5a38',
  },
  iron_brigandine: {
    id: 'iron_brigandine',
    name: 'Iron Brigandine',
    slot: 'chest',
    hp: 65,
    color: '#929ca8',
  },
  steel_cuirass: {
    id: 'steel_cuirass',
    name: 'Steel Cuirass',
    slot: 'chest',
    hp: 95,
    color: '#bcc4cc',
  },
  mithril_hauberk: {
    id: 'mithril_hauberk',
    name: 'Mithril Hauberk',
    slot: 'chest',
    hp: 140,
    color: '#3cbaa8',
  },
  runed_aegis_plate: {
    id: 'runed_aegis_plate',
    name: 'Runed Aegis Plate',
    slot: 'chest',
    hp: 172,
    color: '#8f5fda',
  },

  // --- Armor: hands ---
  rough_handwraps: {
    id: 'rough_handwraps',
    name: 'Rough Handwraps',
    slot: 'hands',
    hp: 10,
    color: '#74532f',
  },
  iron_gauntlets: {
    id: 'iron_gauntlets',
    name: 'Iron Gauntlets',
    slot: 'hands',
    hp: 18,
    color: '#919ba6',
  },
  steel_grips: { id: 'steel_grips', name: 'Steel Grips', slot: 'hands', hp: 29, color: '#b6bec6' },
  mithril_gauntlets: {
    id: 'mithril_gauntlets',
    name: 'Mithril Gauntlets',
    slot: 'hands',
    hp: 43,
    color: '#39b4a2',
  },
  stormbound_grasp: {
    id: 'stormbound_grasp',
    name: 'Stormbound Grasp',
    slot: 'hands',
    hp: 54,
    color: '#9866dd',
  },

  // --- Armor: waist ---
  ragged_sash: { id: 'ragged_sash', name: 'Ragged Sash', slot: 'waist', hp: 10, color: '#6e4d2d' },
  iron_girdle: { id: 'iron_girdle', name: 'Iron Girdle', slot: 'waist', hp: 17, color: '#8f99a4' },
  steel_warbelt: {
    id: 'steel_warbelt',
    name: 'Steel Warbelt',
    slot: 'waist',
    hp: 27,
    color: '#b3bbc3',
  },
  mithril_cinch: {
    id: 'mithril_cinch',
    name: 'Mithril Cinch',
    slot: 'waist',
    hp: 39,
    color: '#37b09d',
  },
  runed_belt_of_wards: {
    id: 'runed_belt_of_wards',
    name: 'Runed Belt of Wards',
    slot: 'waist',
    hp: 50,
    color: '#9462db',
  },

  // --- Armor: legs ---
  tattered_leggings: {
    id: 'tattered_leggings',
    name: 'Tattered Leggings',
    slot: 'legs',
    hp: 18,
    color: '#785536',
  },
  iron_legguards: {
    id: 'iron_legguards',
    name: 'Iron Legguards',
    slot: 'legs',
    hp: 36,
    color: '#909aa5',
  },
  steel_chausses: {
    id: 'steel_chausses',
    name: 'Steel Chausses',
    slot: 'legs',
    hp: 54,
    color: '#b5bdc5',
  },
  mithril_legplates: {
    id: 'mithril_legplates',
    name: 'Mithril Legplates',
    slot: 'legs',
    hp: 79,
    color: '#38b29f',
  },
  warden_greaves: {
    id: 'warden_greaves',
    name: "Warden's Greaves",
    slot: 'legs',
    hp: 98,
    color: '#9160dc',
  },

  // --- Armor: feet ---
  worn_sandals: {
    id: 'worn_sandals',
    name: 'Worn Sandals',
    slot: 'feet',
    hp: 12,
    color: '#73522e',
  },
  iron_sabatons: {
    id: 'iron_sabatons',
    name: 'Iron Sabatons',
    slot: 'feet',
    hp: 20,
    color: '#8e98a3',
  },
  steel_treads: {
    id: 'steel_treads',
    name: 'Steel Treads',
    slot: 'feet',
    hp: 31,
    color: '#b4bcc4',
  },
  mithril_warboots: {
    id: 'mithril_warboots',
    name: 'Mithril Warboots',
    slot: 'feet',
    hp: 45,
    color: '#36b09e',
  },
  emberstride_boots: {
    id: 'emberstride_boots',
    name: 'Emberstride Boots',
    slot: 'feet',
    hp: 58,
    color: '#9764da',
  },

  // --- Jewelry: necks ---
  bloodstone_amulet: {
    id: 'bloodstone_amulet',
    name: 'Bloodstone Amulet',
    slot: 'neck',
    hp: 9,
    color: '#c0405a',
  },
  wyrmscale_pendant: {
    id: 'wyrmscale_pendant',
    name: 'Wyrmscale Pendant',
    slot: 'neck',
    hp: 11,
    color: '#3f7d52',
  },
  moonstone_locket: {
    id: 'moonstone_locket',
    name: 'Moonstone Locket',
    slot: 'neck',
    hp: 7,
    color: '#aebfd6',
  },
  amulet_of_the_vigil: {
    id: 'amulet_of_the_vigil',
    name: 'Amulet of the Vigil',
    slot: 'neck',
    hp: 12,
    color: '#d9c46a',
  },
  emberglass_pendant: {
    id: 'emberglass_pendant',
    name: 'Emberglass Pendant',
    slot: 'neck',
    hp: 8,
    color: '#e0712b',
  },

  // --- Jewelry: rings ---
  band_of_the_wolf: {
    id: 'band_of_the_wolf',
    name: 'Band of the Wolf',
    slot: 'ring',
    hp: 6,
    color: '#8a8f99',
  },
  signet_of_embers: {
    id: 'signet_of_embers',
    name: 'Signet of Embers',
    slot: 'ring',
    hp: 5,
    color: '#d65a2f',
  },
  gilded_loop: { id: 'gilded_loop', name: 'Gilded Loop', slot: 'ring', hp: 4, color: '#e3c057' },
  ring_of_the_tide: {
    id: 'ring_of_the_tide',
    name: 'Ring of the Tide',
    slot: 'ring',
    hp: 7,
    color: '#3b8fb0',
  },
  obsidian_signet: {
    id: 'obsidian_signet',
    name: 'Obsidian Signet',
    slot: 'ring',
    hp: 8,
    color: '#2b2730',
  },
  thornroot_band: {
    id: 'thornroot_band',
    name: 'Thornroot Band',
    slot: 'ring',
    hp: 6,
    color: '#5c7a3a',
  },

  // --- Jewelry: trinkets ---
  hunters_charm: {
    id: 'hunters_charm',
    name: "Hunter's Charm",
    slot: 'trinket',
    hp: 8,
    color: '#a9763f',
  },
  idol_of_the_grove: {
    id: 'idol_of_the_grove',
    name: 'Idol of the Grove',
    slot: 'trinket',
    hp: 10,
    color: '#4f8a44',
  },
  talisman_of_ash: {
    id: 'talisman_of_ash',
    name: 'Talisman of Ash',
    slot: 'trinket',
    hp: 14,
    color: '#7a6f66',
  },
  bone_fetish: { id: 'bone_fetish', name: 'Bone Fetish', slot: 'trinket', hp: 6, color: '#d8cdb4' },
};

export function isEquip(id: string): boolean {
  return id in EQUIPMENT;
}

export function equipDef(id: string): EquipDef | undefined {
  return EQUIPMENT[id];
}
