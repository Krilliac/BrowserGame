import React from 'react';

/**
 * AbilitySlot — a spell/skill button on the action hotbar. Recessed gold-framed
 * cell with the ability icon, a hotkey caption, an optional radial cooldown sweep
 * (conic overlay + seconds remaining), and a dim "out of mana" state. Built to
 * match the renderer's 52px hotbar slots.
 */
export function AbilitySlot({
  src = null,
  children = null,
  hotkey = '1',
  size = 52,
  cooldown = 0, // 0..1 fraction remaining
  cooldownText = null,
  ready = true,
  disabled = false,
  onClick,
  style = {},
}) {
  const onCd = cooldown > 0;
  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative',
        width: size,
        height: size,
        flex: 'none',
        background: 'var(--surface-slot)',
        border: '2px solid var(--gold-500)',
        borderRadius: 'var(--radius-slot)',
        boxShadow: ready && !onCd ? 'var(--shadow-slot-inset), var(--glow-gold)' : 'var(--shadow-slot-inset)',
        cursor: onClick ? 'pointer' : 'default',
        display: 'grid',
        placeItems: 'center',
        overflow: 'hidden',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          style={{
            width: '72%',
            height: '72%',
            objectFit: 'contain',
            imageRendering: 'pixelated',
            filter: onCd ? 'grayscale(0.6) brightness(0.6)' : 'drop-shadow(0 2px 3px rgba(0,0,0,0.7))',
          }}
        />
      ) : (
        children
      )}

      {/* Radial cooldown sweep */}
      {onCd && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `conic-gradient(rgba(0,0,0,0.7) ${cooldown * 360}deg, transparent 0)`,
            pointerEvents: 'none',
          }}
        />
      )}
      {onCd && cooldownText && (
        <span
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            fontSize: size * 0.3,
            color: 'var(--text-heading)',
            textShadow: '0 1px 3px #000',
          }}
        >
          {cooldownText}
        </span>
      )}

      <span
        style={{
          position: 'absolute',
          top: 2,
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
    </div>
  );
}
