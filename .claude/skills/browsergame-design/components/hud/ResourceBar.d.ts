import * as React from 'react';

export interface ResourceBarProps {
  /** @default "health" */
  kind?: 'health' | 'mana' | 'xp' | 'essence';
  value?: number;
  max?: number;
  /** Uppercase label above the track. */
  label?: string | null;
  /** Show "value / max" on the right. @default false */
  showValue?: boolean;
  /** Track height in px. @default 16 */
  height?: number;
  style?: React.CSSProperties;
}

/** Horizontal gold-framed gauge — health, mana, XP, cast/boss bars. */
export function ResourceBar(props: ResourceBarProps): React.ReactElement;
