import React from 'react';

/**
 * Panel — the canonical HUD window: translucent obsidian fill, a 2px gold frame,
 * an engraved title bar and optional ✕ close. Every dialog, vendor screen and
 * inventory window is built on it. Matches inventory-panel.ts exactly
 * (rgba(8,9,13,0.94) fill, #c9a24b stroke, parchment header).
 */
export function Panel({
  title,
  subtitle,
  onClose,
  footer,
  children,
  width = 'auto',
  style = {},
  ...rest
}) {
  return (
    <div
      style={{
        position: 'relative',
        width,
        background: 'var(--surface-panel)',
        border: 'var(--border-frame) solid var(--border-accent)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-panel)',
        backdropFilter: 'blur(2px)',
        color: 'var(--text-body)',
        fontFamily: 'var(--font-body)',
        overflow: 'hidden',
        ...style,
      }}
      {...rest}
    >
      {/* Title bar */}
      {(title || onClose) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 14px 10px',
            borderBottom: '1px solid var(--border-accent-soft)',
            background: 'linear-gradient(180deg, rgba(201,162,75,0.08), transparent)',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {title && (
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 'var(--weight-semibold)',
                  fontSize: 'var(--text-md)',
                  letterSpacing: 'var(--tracking-heading)',
                  textTransform: 'uppercase',
                  color: 'var(--text-display)',
                  textShadow: 'var(--shadow-text)',
                }}
              >
                {title}
              </div>
            )}
            {subtitle && (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
                {subtitle}
              </div>
            )}
          </div>
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                flex: 'none',
                width: 22,
                height: 22,
                display: 'grid',
                placeItems: 'center',
                background: 'transparent',
                border: '1px solid var(--border-accent-soft)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: 13,
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          )}
        </div>
      )}

      <div style={{ padding: 14 }}>{children}</div>

      {footer && (
        <div
          style={{
            padding: '9px 14px',
            borderTop: '1px solid var(--border-accent-soft)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-faint)',
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
