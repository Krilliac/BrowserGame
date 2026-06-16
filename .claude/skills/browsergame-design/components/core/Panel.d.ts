import * as React from 'react';

/**
 * The canonical HUD window — obsidian fill, gold frame, engraved title.
 */
export interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Engraved title-bar text (rendered uppercase Cinzel). */
  title?: React.ReactNode;
  /** Small muted line under the title. */
  subtitle?: React.ReactNode;
  /** Show a ✕ close button and fire this on click. */
  onClose?: () => void;
  /** Optional muted footer (hints, counts). */
  footer?: React.ReactNode;
  /** CSS width. @default "auto" */
  width?: number | string;
  children?: React.ReactNode;
}

export function Panel(props: PanelProps): React.ReactElement;
