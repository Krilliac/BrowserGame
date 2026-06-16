import React from 'react';

/**
 * ResourceBar — a horizontal gold-framed gauge for health, mana, experience or a
 * boss/cast bar. Recessed track, colored fill, optional label and value readout.
 * The flat alternative to OrbGauge (and the Kenney bar lineage); good for nameplates,
 * party frames and the XP strip.
 */
const KIND = {
  health: { fill: 'linear-gradient(180deg, var(--hp-glow), var(--hp) 55%, var(--hp-deep))' },
  mana: { fill: 'linear-gradient(180deg, var(--mana-glow), var(--mana) 55%, var(--mana-deep))' },
  xp: { fill: 'linear-gradient(180deg, var(--gold-300), var(--gold-500) 55%, var(--gold-700))' },
  essence: { fill: 'linear-gradient(180deg, #b6f0a0, var(--essence) 55%, #1e4a1a)' },
};

export function ResourceBar({
  kind = 'health',
  value = 70,
  max = 100,
  label = null,
  showValue = false,
  height = 16,
  style = {},
}) {
  const pct = Math.max(0, Math.min(1, max ? value / max : 0));
  return (
    <div style={{ width: '100%', ...style }}>
      {(label || showValue) && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: 3,
            fontSize: 'var(--text-2xs)',
            letterSpacing: 'var(--tracking-label)',
            textTransform: 'uppercase',
            color: 'var(--text-label)',
          }}
        >
          <span>{label}</span>
          {showValue && (
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-stat)' }}>
              {Math.round(value)} / {max}
            </span>
          )}
        </div>
      )}
      <div
        style={{
          position: 'relative',
          height,
          background: 'rgba(0,0,0,0.55)',
          border: '1px solid var(--gold-700)',
          borderRadius: 'var(--radius-sm)',
          boxShadow: 'inset 0 2px 5px rgba(0,0,0,0.7)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: `${pct * 100}%`,
            background: KIND[kind].fill,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)',
            transition: 'width var(--dur-base) var(--ease-out)',
          }}
        />
        {/* gloss */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '45%',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.18), transparent)',
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  );
}
