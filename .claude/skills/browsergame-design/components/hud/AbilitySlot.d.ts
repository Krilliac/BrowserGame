import * as React from 'react';

export interface AbilitySlotProps {
  /** Ability icon URL (pixel-art). */
  src?: string | null;
  children?: React.ReactNode;
  /** Hotkey caption (1–4, Q, etc). @default "1" */
  hotkey?: string;
  /** Slot size in px. @default 52 */
  size?: number;
  /** Cooldown fraction remaining 0..1 (drives the radial sweep). @default 0 */
  cooldown?: number;
  /** Seconds-remaining text shown over the sweep. */
  cooldownText?: string | null;
  /** Gold "ready" glow when true and not on cooldown. @default true */
  ready?: boolean;
  /** Dim, unusable (e.g. out of mana / locked). @default false */
  disabled?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}

/** A spell/skill button on the action hotbar with radial cooldown. */
export function AbilitySlot(props: AbilitySlotProps): React.ReactElement;
