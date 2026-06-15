import * as React from 'react';

export type Rarity = 'common' | 'magic' | 'rare' | 'epic' | 'legendary' | 'corrupted' | 'unique';

export interface RarityNameProps extends React.HTMLAttributes<HTMLSpanElement> {
  rarity?: Rarity;
  /** @default "base" */
  size?: 'sm' | 'base' | 'lg';
  /** Soft glow on legendary/epic/corrupted/unique. @default true */
  glow?: boolean;
  children?: React.ReactNode;
}

/** An item title painted in its loot-tier color (the rarity→color rule). */
export function RarityName(props: RarityNameProps): React.ReactElement;

/** Map of rarity → CSS color var, exported for ad-hoc use. */
export const RARITY_COLOR: Record<Rarity, string>;
