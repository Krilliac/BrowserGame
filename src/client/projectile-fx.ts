import type { DamageElement } from '../shared/combat.js';

/**
 * Maps a projectile to an animated spell strip — pure + framework-free so it stays unit-tested
 * (the renderer owns the textures and just looks up the alias for the key this returns). Lets the
 * many elemental projectiles that previously fell back to a plain colored orb (frost / venom /
 * arcane / water / …) play the original Gloomwood spell strips oriented along their flight.
 *
 * Resolution: an exact ability-id override first (the few cases a color can't disambiguate — bombs,
 * rocks), then classification of the ability's color into an element. Returns null for elements with
 * no matching strip (poison/nature green, holy gold), so those keep their correctly-tinted orb —
 * better than a mis-colored strip. (HANDOFF §3.2 — "map element → strip via the --fx-* palette".)
 */

/** The animated spell strips the design system ships for projectiles (under /assets/ui/fx/). */
export type ProjStrip = 'fireball' | 'firebomb' | 'frost' | 'water' | 'arcane' | 'rock';

/**
 * Exact ability-id → strip, for ids whose color is ambiguous or whose look is specific. Everything
 * else is classified by color (see {@link elementStrip}). Keys are matched case-insensitively and as
 * substrings so id families (frost / frostlance / glacierspike) resolve without listing every one.
 */
const ID_RULES: [RegExp, ProjStrip][] = [
  [/firebomb|bomb|meteor/, 'firebomb'],
  [/rock|stone|boulder|sling|pebble/, 'rock'],
  [/fireball|flame|pyro|ember|scorch/, 'fireball'],
  [/water|tidal|wave|aqua|geyser/, 'water'],
  [/frost|ice|glacier|chill|cryo|frostlance|frostshard/, 'frost'],
  [/arcane|arcanemissile|maelstrom|lightning|shock|bolt|spark|magic_orb/, 'arcane'],
];

/** Parse a `#rrggbb` color to [r,g,b], or null when it isn't a 6-digit hex. */
function rgb(color: string | undefined): [number, number, number] | null {
  if (!color) return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * Classify an ability color into an elemental strip, or null when no strip fits (green poison/nature,
 * gold holy → keep the orb). Ordered most-specific first: deep blue (water) before light cyan (frost),
 * violet (arcane), warm (fire). Thresholds are deliberately loose — the colors come from the locked
 * `--fx-*` palette, and a near-miss simply falls through to the orb.
 */
export function elementStrip(color: string | undefined): ProjStrip | null {
  const c = rgb(color);
  if (!c) return null;
  const [r, g, b] = c;
  if (b > 140 && b >= g + 60 && b >= r + 90 && g < 150) return 'water'; // deep saturated blue
  if (b > 170 && g > 140 && r < g) return 'frost'; // cyan / icy light-blue
  if (r > 110 && b > 150 && g < r && g < b - 40) return 'arcane'; // violet
  if (r > 170 && r >= g && b < g * 0.7) return 'fireball'; // warm orange/red (not pale gold)
  return null;
}

/** The --fx-* tint for a chain-arc VFX, by element. */
export function arcColor(element: DamageElement | undefined): string {
  switch (element) {
    case 'fire':
      return '#ff8a3a';
    case 'cold':
      return '#7fc4ff';
    case 'lightning':
      return '#b07ae8';
    case 'poison':
      return '#aef07a';
    default:
      return '#ffffff';
  }
}

/**
 * Resolve a projectile to its spell strip, or null to keep the procedural orb. `abilityId` takes
 * precedence over `color` so a recognized id always wins (a hostile-reddened tint never changes the
 * element — pass the ability's true color).
 */
export function projectileStrip(
  abilityId: string | undefined,
  color: string | undefined,
): ProjStrip | null {
  if (abilityId) {
    const id = abilityId.toLowerCase();
    for (const [re, strip] of ID_RULES) if (re.test(id)) return strip;
  }
  return elementStrip(color);
}
