import React from 'react';

const RARITY_COLOR = {
  common: 'var(--rarity-common)',
  magic: 'var(--rarity-magic)',
  rare: 'var(--rarity-rare)',
  epic: 'var(--rarity-epic)',
  legendary: 'var(--rarity-legendary)',
  corrupted: 'var(--rarity-corrupted)',
  unique: 'var(--rarity-unique)',
};
const RARITY_GLOW = {
  magic: 'var(--glow-magic)',
  rare: 'var(--glow-rare)',
  epic: 'var(--glow-epic)',
  legendary: 'var(--glow-legendary)',
  corrupted: 'var(--glow-corrupted)',
  unique: 'var(--glow-unique)',
};

/**
 * IconSlot — a single inventory / hotbar / belt cell. Recessed obsidian square
 * with an inner shadow, a rarity-colored frame + glow when it holds gear, and
 * optional stack count (bottom-right) and hotkey (top-left). The atomic cell the
 * inventory grid, vault, belt and ability bar are all built from.
 */
export function IconSlot({
  src = null,
  alt = '',
  children = null,
  rarity = null,
  size = 52,
  count = null,
  hotkey = null,
  empty = false,
  selected = false,
  onClick,
  style = {},
  ...rest
}) {
  const frame = rarity ? RARITY_COLOR[rarity] : 'var(--border-accent-soft)';
  const glow = rarity ? RARITY_GLOW[rarity] : 'none';

  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative',
        width: size,
        height: size,
        flex: 'none',
        background: empty ? 'rgba(0,0,0,0.35)' : 'var(--surface-slot)',
        border: `${rarity ? 2 : 1}px solid ${selected ? 'var(--gold-300)' : frame}`,
        borderRadius: 'var(--radius-slot)',
        boxShadow: `var(--shadow-slot-inset)${glow !== 'none' ? ', ' + glow : ''}${
          selected ? ', var(--glow-gold-strong)' : ''
        }`,
        cursor: onClick ? 'pointer' : 'default',
        display: 'grid',
        placeItems: 'center',
        overflow: 'hidden',
        ...style,
      }}
      {...rest}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          style={{
            width: '74%',
            height: '74%',
            objectFit: 'contain',
            imageRendering: 'pixelated',
            filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.7))',
          }}
        />
      ) : (
        children
      )}

      {hotkey != null && (
        <span
          style={{
            position: 'absolute',
            top: 3,
            left: 4,
            fontFamily: 'var(--font-body)',
            fontWeight: 700,
            fontSize: 'var(--text-2xs)',
            color: 'var(--gold-500)',
            textShadow: 'var(--shadow-text)',
            lineHeight: 1,
          }}
        >
          {hotkey}
        </span>
      )}
      {count != null && (
        <span
          style={{
            position: 'absolute',
            bottom: 2,
            right: 4,
            fontFamily: 'var(--font-body)',
            fontWeight: 700,
            fontSize: 'var(--text-xs)',
            color: 'var(--gold-300)',
            textShadow: 'var(--shadow-text)',
            lineHeight: 1,
          }}
        >
          {count}
        </span>
      )}
    </div>
  );
}
