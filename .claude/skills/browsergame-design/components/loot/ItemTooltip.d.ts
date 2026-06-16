import * as React from 'react';

export type Rarity = 'common' | 'magic' | 'rare' | 'epic' | 'legendary' | 'corrupted' | 'unique';

export interface TooltipStat {
  /** e.g. "Damage", "+Max HP". */
  label: string;
  /** e.g. "14", "+28". */
  value: string;
}
export interface TooltipAffix {
  /** Pre-formatted affix line, e.g. "+5% crit" or "−30 hp". */
  text: string;
  /** Render in blood-red as a downside. @default false */
  debuff?: boolean;
}

export interface ItemTooltipProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The affix-composed title, e.g. "Savage Iron Sword of the Boar". */
  name: string;
  rarity?: Rarity;
  /** Slot / class line under the title, e.g. "Two-Handed Sword". */
  itemType?: string;
  /** Base stat rows (gold). */
  baseStats?: TooltipStat[];
  /** Rolled affix rows (blue buffs / red debuffs). */
  affixes?: TooltipAffix[];
  /** Gem sockets: each entry a gem icon URL, or null for an empty socket. */
  sockets?: (string | null)[];
  /** Italic flavor / lore line. */
  flavor?: string;
  requiredLevel?: number | null;
  /** Show the level requirement in red (unmet). @default true */
  levelMet?: boolean;
  /** Vendor gold value, shown in the footer. */
  value?: number | null;
  width?: number;
}

/**
 * The loot inspection card — rarity title, stats, affixes, sockets, flavor.
 * @startingPoint section="Loot" subtitle="Diablo-style item tooltip" viewport="700x460"
 */
export function ItemTooltip(props: ItemTooltipProps): React.ReactElement;
