/**
 * Equipment SLOT types + UI labels shared by client and server — the slot contract on the wire and
 * in the HUD. The item base DATA itself is database-driven: it lives in the `items` table (seeded
 * from src/server/db/seed-items.ts) and is read at runtime via content.ts on the server and the
 * content packet on the client. This file holds only the slot enums, labels, and the doll-slot
 * mapping, never item data.
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
