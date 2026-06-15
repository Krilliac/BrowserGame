import React from 'react';

/**
 * OrbGauge — the iconic ARPG liquid globe for health (left) and mana (right).
 * A glass sphere with a rising liquid fill, inner glow, a glossy sheen and a
 * gold rim, with the current/max value centered. Colors come straight from the
 * belt flask palette (hp #d23b3b, mana #3b6fd2).
 */
export function OrbGauge({ type = 'health', value = 70, max = 100, size = 128, showValue = true, style = {} }) {
  const pct = Math.max(0, Math.min(1, max ? value / max : 0));
  const fillTop = `var(--${type === 'mana' ? 'mana-glow' : 'hp-glow'})`;
  const fillMid = `var(--${type === 'mana' ? 'mana' : 'hp'})`;
  const fillDeep = `var(--${type === 'mana' ? 'mana-deep' : 'hp-deep'})`;
  const glow = type === 'mana' ? 'var(--glow-mana)' : 'var(--glow-hp)';

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'radial-gradient(circle at 50% 60%, #15161d, #05060a 80%)',
        border: '2px solid var(--gold-600)',
        boxShadow: `inset 0 4px 12px rgba(0,0,0,0.8), 0 0 0 1px #000, ${glow}`,
        overflow: 'hidden',
        ...style,
      }}
    >
      {/* Liquid fill */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: `${pct * 100}%`,
          background: `linear-gradient(180deg, ${fillTop}, ${fillMid} 38%, ${fillDeep})`,
          boxShadow: `inset 0 6px 14px rgba(255,255,255,0.25)`,
          transition: 'height var(--dur-slow) var(--ease-out)',
        }}
      >
        {/* Surface meniscus */}
        <div
          style={{
            position: 'absolute',
            top: -2,
            left: 0,
            right: 0,
            height: 4,
            background: fillTop,
            opacity: 0.8,
            filter: 'blur(1px)',
          }}
        />
      </div>

      {/* Glass sheen */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background:
            'radial-gradient(60% 45% at 38% 26%, rgba(255,255,255,0.35), transparent 60%)',
          pointerEvents: 'none',
        }}
      />

      {showValue && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            fontFamily: 'var(--font-mono)',
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 700,
            fontSize: size * 0.16,
            color: 'var(--text-heading)',
            textShadow: '0 1px 3px #000, 0 0 6px rgba(0,0,0,0.9)',
          }}
        >
          {Math.round(value)}
        </div>
      )}
    </div>
  );
}
