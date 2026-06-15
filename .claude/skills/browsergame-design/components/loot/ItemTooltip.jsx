import React from 'react';
import { RARITY_COLOR } from './RarityName.jsx';

const RARITY_GLOW = {
  magic: 'var(--glow-magic)',
  rare: 'var(--glow-rare)',
  epic: 'var(--glow-epic)',
  legendary: 'var(--glow-legendary)',
  corrupted: 'var(--glow-corrupted)',
  unique: 'var(--glow-unique)',
};

/**
 * ItemTooltip — the loot inspection card. The most important surface in an ARPG:
 * a rarity-colored, centered title (the affix-composed name), the item type, base
 * stats, rolled affix lines (buffs in steel-blue, debuffs in blood-red), gem
 * sockets, an italic flavor line, and a value/level footer. Structure follows
 * src/shared/items.ts (instanceTitle, affixLabel, sockets, gearSellValue).
 */
export function ItemTooltip({
  name,
  rarity = 'common',
  itemType = '',
  baseStats = [],
  affixes = [],
  sockets = [],
  flavor = '',
  requiredLevel = null,
  levelMet = true,
  value = null,
  width = 248,
  style = {},
  ...rest
}) {
  const color = RARITY_COLOR[rarity];
  const glow = RARITY_GLOW[rarity];

  return (
    <div
      style={{
        width,
        background: 'var(--surface-panel)',
        border: `1px solid ${color}`,
        borderTop: `3px solid ${color}`,
        borderRadius: 'var(--radius-sm)',
        boxShadow: `var(--shadow-float)${glow ? ', ' + glow : ''}`,
        padding: '12px 14px 11px',
        fontFamily: 'var(--font-body)',
        textAlign: 'center',
        ...style,
      }}
      {...rest}
    >
      {/* Title */}
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 'var(--weight-bold)',
          fontSize: 'var(--text-base)',
          lineHeight: 1.2,
          letterSpacing: '0.02em',
          color,
          textShadow: glow || 'var(--shadow-text)',
          textWrap: 'balance',
        }}
      >
        {name}
      </div>
      {itemType && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 3 }}>
          {itemType}
        </div>
      )}

      {/* Base stats */}
      {baseStats.length > 0 && (
        <div
          style={{
            marginTop: 9,
            paddingTop: 9,
            borderTop: '1px solid var(--border-accent-soft)',
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
          }}
        >
          {baseStats.map((s, i) => (
            <div
              key={i}
              style={{
                fontFamily: 'var(--font-mono)',
                fontVariantNumeric: 'tabular-nums',
                fontSize: 'var(--text-sm)',
                color: 'var(--gold-300)',
              }}
            >
              {s.label} <strong style={{ color: 'var(--text-heading)' }}>{s.value}</strong>
            </div>
          ))}
        </div>
      )}

      {/* Affixes */}
      {affixes.length > 0 && (
        <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {affixes.map((a, i) => (
            <div
              key={i}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-sm)',
                color: a.debuff ? 'var(--danger)' : 'var(--rarity-magic)',
              }}
            >
              {a.text}
            </div>
          ))}
        </div>
      )}

      {/* Sockets */}
      {sockets.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', gap: 5, justifyContent: 'center' }}>
          {sockets.map((gem, i) => (
            <span
              key={i}
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                background: gem ? 'transparent' : 'rgba(0,0,0,0.55)',
                border: '1px solid var(--ink-500)',
                boxShadow: 'inset 0 0 5px rgba(0,0,0,0.8)',
              }}
            >
              {gem && (
                <img
                  src={gem}
                  alt=""
                  style={{ width: 18, height: 18, imageRendering: 'pixelated' }}
                />
              )}
            </span>
          ))}
        </div>
      )}

      {/* Flavor */}
      {flavor && (
        <div
          style={{
            marginTop: 10,
            fontFamily: 'var(--font-lore)',
            fontStyle: 'italic',
            fontSize: 'var(--text-xs)',
            lineHeight: 1.5,
            color: 'var(--gold-400)',
            textWrap: 'pretty',
          }}
        >
          “{flavor}”
        </div>
      )}

      {/* Footer */}
      {(requiredLevel != null || value != null) && (
        <div
          style={{
            marginTop: 10,
            paddingTop: 8,
            borderTop: '1px solid var(--border-accent-soft)',
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 'var(--text-xs)',
          }}
        >
          {requiredLevel != null ? (
            <span style={{ color: levelMet ? 'var(--text-faint)' : 'var(--danger)' }}>
              Requires Level {requiredLevel}
            </span>
          ) : (
            <span />
          )}
          {value != null && (
            <span style={{ color: 'var(--coin)' }}>{value}g</span>
          )}
        </div>
      )}
    </div>
  );
}
