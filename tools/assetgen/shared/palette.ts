/**
 * Color helpers for the generators: hex/number ↔ RGBA, HSL synthesis, shading, and the game's rarity
 * tints (matched to the engine's loot colors) so generated icons/props read consistently.
 */

import type { RGBA } from './raster.ts';

export function hslToRgba(h: number, s: number, l: number, a = 255): RGBA {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r: number;
  let g: number;
  let b: number;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255), a];
}

export function numToRgba(n: number, a = 255): RGBA {
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, a];
}

/** Lighten (f>0) or darken (f<0) a color by fraction f, keeping alpha. */
export function shade(c: RGBA, f: number): RGBA {
  const m = (v: number) =>
    Math.max(0, Math.min(255, Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f))));
  return [m(c[0]), m(c[1]), m(c[2]), c[3]];
}

/** Loot rarity tints, matched to the engine's rarity palette. */
export const RARITY: Record<string, number> = {
  common: 0xb8b8b8,
  magic: 0x6f9bff,
  rare: 0xf2d54a,
  epic: 0xb46bff,
  legendary: 0xff8a3c,
};
