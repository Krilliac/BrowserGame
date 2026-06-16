import * as React from 'react';

export interface NameplateProps {
  name?: string;
  /** Rank — drives name color, bar size, rank label. @default "normal" */
  tier?: 'normal' | 'elite' | 'champion' | 'boss';
  level?: number | null;
  hp?: number;
  maxHp?: number;
  style?: React.CSSProperties;
}

/** Floating monster name + health bar; tier sets color, size and rank label. */
export function Nameplate(props: NameplateProps): React.ReactElement;
