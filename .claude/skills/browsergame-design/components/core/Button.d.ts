import * as React from 'react';

/**
 * Forged action button — gold-framed, engraved uppercase label.
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual weight. @default "primary" */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** @default "md" */
  size?: 'sm' | 'md' | 'lg';
  /** Stretch to fill its container. @default false */
  block?: boolean;
  /** Optional leading icon node. */
  iconLeft?: React.ReactNode;
  disabled?: boolean;
  children?: React.ReactNode;
}

export function Button(props: ButtonProps): React.ReactElement;
