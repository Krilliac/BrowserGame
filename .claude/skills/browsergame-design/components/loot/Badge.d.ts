import * as React from 'react';

export type Rarity = 'common' | 'magic' | 'rare' | 'epic' | 'legendary' | 'corrupted' | 'unique';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Semantic tone (ignored if `rarity` is set). @default "neutral" */
  tone?: 'gold' | 'neutral' | 'danger' | 'ok';
  /** Tint the badge to a loot tier instead of a tone. */
  rarity?: Rarity | null;
  /** Hairline outline style (tone only). @default false */
  outline?: boolean;
  children?: React.ReactNode;
}

/** Compact uppercase pill — rarity tags, status, area labels, counts. */
export function Badge(props: BadgeProps): React.ReactElement;
