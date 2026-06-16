import React from 'react';

export const RARITY_COLOR = {
  common: 'var(--rarity-common)',
  magic: 'var(--rarity-magic)',
  rare: 'var(--rarity-rare)',
  epic: 'var(--rarity-epic)',
  legendary: 'var(--rarity-legendary)',
  corrupted: 'var(--rarity-corrupted)',
  unique: 'var(--rarity-unique)',
};
const RARITY_TSHADOW = {
  legendary: 'var(--glow-legendary)',
  corrupted: 'var(--glow-corrupted)',
  unique: 'var(--glow-unique)',
  epic: 'var(--glow-epic)',
};

/**
 * RarityName — an item title painted in its loot-tier color. The single source
 * of the rarity→color rule for any inline item reference (chat drop lines, loot
 * toasts, bag rows). Higher tiers gain a soft glow. Mirrors RARITY[r].color.
 */
export function RarityName({ children, rarity = 'common', size = 'base', glow = true, style = {}, ...rest }) {
  const fontSize = { sm: 'var(--text-sm)', base: 'var(--text-base)', lg: 'var(--text-lg)' }[size];
  return (
    <span
      style={{
        fontFamily: 'var(--font-display)',
        fontWeight: 'var(--weight-bold)',
        letterSpacing: '0.02em',
        fontSize,
        color: RARITY_COLOR[rarity],
        textShadow: glow && RARITY_TSHADOW[rarity] ? RARITY_TSHADOW[rarity] : 'var(--shadow-text)',
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
