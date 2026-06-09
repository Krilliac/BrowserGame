/**
 * Equippable gear shared by client and server. Weapons add flat attack power to every hit;
 * armor adds max HP. The server is authoritative for what's equipped and the derived stats;
 * this file is the shared source of truth for the items themselves.
 */

export type EquipSlot = 'weapon' | 'armor';

export interface EquipDef {
  id: string;
  name: string;
  slot: EquipSlot;
  /** Flat damage added to every attack (weapons). */
  power?: number;
  /** Bonus max HP (armor). */
  hp?: number;
  /** Render color for the ground-drop glint and UI. */
  color: string;
}

export const EQUIPMENT: Record<string, EquipDef> = {
  rusty_sword: {
    id: 'rusty_sword',
    name: 'Rusty Sword',
    slot: 'weapon',
    power: 6,
    color: '#b0a080',
  },
  iron_sword: { id: 'iron_sword', name: 'Iron Sword', slot: 'weapon', power: 13, color: '#c8d0d8' },
  leather_armor: {
    id: 'leather_armor',
    name: 'Leather Armor',
    slot: 'armor',
    hp: 30,
    color: '#8a5a2a',
  },
  iron_armor: { id: 'iron_armor', name: 'Iron Armor', slot: 'armor', hp: 65, color: '#9aa4b0' },
};

export function isEquip(id: string): boolean {
  return id in EQUIPMENT;
}

export function equipDef(id: string): EquipDef | undefined {
  return EQUIPMENT[id];
}
