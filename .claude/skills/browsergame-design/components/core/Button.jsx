import React from 'react';

/**
 * Button — the forged action control. Stone-dark fill, gold frame, engraved
 * uppercase label. Used for menus, confirms, vendor actions and dialog choices.
 * Mirrors the game's gold-on-obsidian chrome (Kenney brown button lineage).
 */
export function Button({
  children,
  variant = 'primary',
  size = 'md',
  block = false,
  disabled = false,
  iconLeft = null,
  style = {},
  ...rest
}) {
  const sizes = {
    sm: { padding: '6px 12px', fontSize: 'var(--text-2xs)', minHeight: 28 },
    md: { padding: '9px 18px', fontSize: 'var(--text-xs)', minHeight: 38 },
    lg: { padding: '13px 26px', fontSize: 'var(--text-sm)', minHeight: 48 },
  };

  const variants = {
    primary: {
      background: 'linear-gradient(180deg, var(--gold-400), var(--gold-600))',
      color: 'var(--text-on-gold)',
      border: '1px solid var(--gold-300)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35), 0 2px 0 #000, var(--glow-gold)',
      textShadow: '0 1px 0 rgba(255,255,255,0.3)',
    },
    secondary: {
      background: 'linear-gradient(180deg, var(--ink-700), var(--ink-850))',
      color: 'var(--gold-300)',
      border: '1px solid var(--gold-600)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 0 #000',
      textShadow: 'var(--shadow-text)',
    },
    ghost: {
      background: 'transparent',
      color: 'var(--text-muted)',
      border: '1px solid transparent',
      boxShadow: 'none',
      textShadow: 'none',
    },
    danger: {
      background: 'linear-gradient(180deg, #b33, var(--hp-deep))',
      color: '#ffe2e2',
      border: '1px solid var(--danger)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), 0 2px 0 #000, var(--glow-hp)',
      textShadow: '0 1px 1px rgba(0,0,0,0.6)',
    },
  };

  return (
    <button
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        width: block ? '100%' : 'auto',
        fontFamily: 'var(--font-display)',
        fontWeight: 'var(--weight-semibold)',
        letterSpacing: 'var(--tracking-heading)',
        textTransform: 'uppercase',
        borderRadius: 'var(--radius-sm)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transition: 'transform var(--dur-fast) var(--ease-out), filter var(--dur-base)',
        userSelect: 'none',
        ...sizes[size],
        ...variants[variant],
        ...style,
      }}
      onMouseDown={(e) => !disabled && (e.currentTarget.style.transform = 'translateY(1px) scale(0.985)')}
      onMouseUp={(e) => (e.currentTarget.style.transform = '')}
      onMouseLeave={(e) => (e.currentTarget.style.transform = '')}
      {...rest}
    >
      {iconLeft}
      {children}
    </button>
  );
}
