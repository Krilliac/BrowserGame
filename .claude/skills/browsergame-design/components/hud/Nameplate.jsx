import React from 'react';
import { ResourceBar } from './ResourceBar.jsx';

const TIER = {
  normal: { color: 'var(--rarity-common)', label: null, width: 96, h: 5 },
  elite: { color: 'var(--rarity-magic)', label: 'Elite', width: 120, h: 6 },
  champion: { color: 'var(--rarity-rare)', label: 'Champion', width: 132, h: 7 },
  boss: { color: 'var(--rarity-corrupted)', label: 'Boss', width: 200, h: 9 },
};

/**
 * Nameplate — the floating name + health bar above a monster. The tier drives the
 * name color, the bar size and an optional rank label: normal (white), elite
 * (blue), champion (gold), boss (corrupted red, with a wider bar). Reproduces the
 * overworld monster banner; pin it above the sprite in the world layer.
 */
export function Nameplate({ name = 'Rot Ghoul', tier = 'normal', level = null, hp = 80, maxHp = 100, style = {} }) {
  const t = TIER[tier];
  return (
    <div
      style={{
        width: t.width,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 3,
        textAlign: 'center',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, lineHeight: 1 }}>
        {level != null && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: 'var(--text-faint)' }}>
            L{level}
          </span>
        )}
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 'var(--weight-semibold)',
            fontSize: tier === 'boss' ? 'var(--text-base)' : 'var(--text-xs)',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: t.color,
            textShadow: 'var(--shadow-text)',
          }}
        >
          {name}
        </span>
        {t.label && (
          <span
            style={{
              fontFamily: 'var(--font-body)',
              fontWeight: 600,
              fontSize: 'var(--text-2xs)',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: t.color,
              opacity: 0.85,
            }}
          >
            {t.label}
          </span>
        )}
      </div>
      <div style={{ width: '100%' }}>
        <ResourceBar kind="health" value={hp} max={maxHp} height={t.h} />
      </div>
    </div>
  );
}
