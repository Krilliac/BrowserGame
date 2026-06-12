/**
 * Sprite tint math for the SQL color-override system (`sprite_tints` table). Tints are CSS
 * #rrggbb strings multiplied per channel over a sprite's pixels — the cheap, GPU-native way to
 * spawn dark/gritty variations of one image source without touching the file. Combining several
 * tints (a per-entity SQL override × the area's cohesive sprite tint) multiplies them together.
 */

/** Parse #rrggbb to 0xRRGGBB; anything unparsable reads as white (no tint). */
export function parseTint(hex: string | undefined): number {
  if (!hex) return 0xffffff;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  return m ? parseInt(m[1]!, 16) : 0xffffff;
}

/** Multiply tints channel-wise (white = identity), e.g. an entity override × the area tint. */
export function combineTints(...tints: (string | number | undefined)[]): number {
  let r = 255;
  let g = 255;
  let b = 255;
  for (const t of tints) {
    const n = typeof t === 'number' ? t : parseTint(t);
    r = Math.round((r * ((n >> 16) & 0xff)) / 255);
    g = Math.round((g * ((n >> 8) & 0xff)) / 255);
    b = Math.round((b * (n & 0xff)) / 255);
  }
  return (r << 16) | (g << 8) | b;
}
