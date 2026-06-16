import * as React from 'react';

export interface OrbGaugeProps {
  /** @default "health" */
  type?: 'health' | 'mana';
  value?: number;
  max?: number;
  /** Diameter in px. @default 128 */
  size?: number;
  /** Show the numeric value centered. @default true */
  showValue?: boolean;
  style?: React.CSSProperties;
}

/** The iconic liquid health/mana globe. */
export function OrbGauge(props: OrbGaugeProps): React.ReactElement;
