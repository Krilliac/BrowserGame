import React from 'react';

/**
 * Badge — a small engraved pill for rarity tags, status states, area labels and
 * counts. Three tones: solid (filled accent), outline (gold hairline), and
 * rarity (tinted to a loot tier). Kept compact and uppercase to read as game
 * chrome, not web UI.
 */
const TONE = {
  gold: { bg: 'var(--gold-600)', bd: 'var(--gold-400)', fg: 'var(--text-on-gold)' },
  neutral: { bg: 'var(--ink-700)', bd: 'var(--border-subtle)', fg: 'var(--text-muted)' },
  danger: { bg: 'var(--hp-deep)', bd: 'var(--danger)', fg: '#ffe2e2' },
  ok: { bg: '#1e3d20', bd: 'var(--ok)', fg: 'var(--ok)' },
};
const RARITY_COLOR = {
  common: 'var(--rarity-common)',
  magic: 'var(--rarity-magic)',
  rare: 'var(--rarity-rare)',
  epic: 'var(--rarity-epic)',
  legendary: 'var(--rarity-legendary)',
  corrupted: 'var(--rarity-corrupted)',
  unique: 'var(--rarity-unique)',
};

export function Badge({ children, tone = 'neutral', rarity = null, outline = false, style = {}, ...rest }) {
  let colors;
  if (rarity) {
    const c = RARITY_COLOR[rarity];
    colors = {
      bg: `color-mix(in srgb, ${c} 16%, transparent)`,
      bd: c,
      fg: c,
    };
  } else {
    const t = TONE[tone];
    colors = outline ? { bg: 'transparent', bd: t.bd, fg: t.bd } : t;
  }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 8px',
        fontFamily: 'var(--font-body)',
        fontWeight: 'var(--weight-semibold)',
        fontSize: 'var(--text-2xs)',
        letterSpacing: 'var(--tracking-label)',
        textTransform: 'uppercase',
        lineHeight: 1,
        borderRadius: 'var(--radius-sm)',
        background: colors.bg,
        border: `1px solid ${colors.bd}`,
        color: colors.fg,
        whiteSpace: 'nowrap',
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
