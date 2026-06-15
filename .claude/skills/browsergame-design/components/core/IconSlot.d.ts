import * as React from 'react';

export type Rarity = 'common' | 'magic' | 'rare' | 'epic' | 'legendary' | 'corrupted' | 'unique';

/**
 * One inventory / hotbar / belt cell — recessed slot with rarity frame + glow.
 */
export interface IconSlotProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Pixel-art icon URL (rendered nearest-neighbor). */
  src?: string | null;
  alt?: string;
  /** Custom slot content instead of an image (e.g. a flask shape). */
  children?: React.ReactNode;
  /** Drives the frame color + glow ring. Null = neutral empty/utility slot. */
  rarity?: Rarity | null;
  /** Square size in px. @default 52 */
  size?: number;
  /** Stack count, shown bottom-right. */
  count?: number | string | null;
  /** Hotkey caption, shown top-left in gold. */
  hotkey?: string | null;
  /** Dim, recessed empty state. @default false */
  empty?: boolean;
  /** Gold selection ring. @default false */
  selected?: boolean;
  onClick?: () => void;
}

export function IconSlot(props: IconSlotProps): React.ReactElement;
