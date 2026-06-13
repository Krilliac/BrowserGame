/**
 * ASSET-ICON CLI: render a KIND-keyed item-icon sheet the engine resolves item ids onto (replacing
 * the licensed 32rogues sheet + minerals gem files).
 *   tsx tools/assetgen/icons/cli.ts [--seed N] [--check]
 * Output: public/assets/icons/items_gen.png + .json (cells keyed by KEY).
 *
 * KEYS + their order are mirrored in src/client/item-icons.ts (ICON_KEYS) — a test asserts they
 * match the generated manifest, so the packed grid stays aligned.
 */

import { emit, parseArgs } from '../shared/cli.ts';
import { synthIcons, type IconEntry, type IconKind } from './synth.ts';
import type { RGBA } from '../shared/raster.ts';

// KEY → how to draw it. Item categories (sword/helm/…) + a per-family gem set, in a FIXED order so
// the cell grid (col = i%8, row = floor(i/8)) is reproducible and matches the engine's resolver.
const GEM: Record<string, RGBA> = {
  ruby: [200, 60, 70, 255],
  sapphire: [70, 110, 220, 255],
  topaz: [220, 190, 70, 255],
  diamond: [220, 230, 240, 255],
  emerald: [70, 190, 110, 255],
  amethyst: [170, 90, 210, 255],
  jade: [90, 200, 170, 255],
  onyx: [60, 56, 70, 255],
  opal: [200, 210, 230, 255],
};

const KIND_KEYS: Array<[string, IconKind]> = [
  ['sword', 'sword'],
  ['axe', 'axe'],
  ['bow', 'bow'],
  ['staff', 'staff'],
  ['mace', 'mace'],
  ['dagger', 'dagger'],
  ['spear', 'spear'],
  ['shield', 'shield'],
  ['helm', 'helm'],
  ['chest', 'chest'],
  ['gloves', 'gloves'],
  ['boots', 'boots'],
  ['legs', 'legs'],
  ['amulet', 'amulet'],
  ['ring', 'ring'],
  ['charm', 'amulet'],
  ['potion', 'potion'],
  ['scroll', 'scroll'],
  ['tome', 'tome'],
  ['coin', 'coin'],
  ['rune', 'rune'],
  ['material', 'material'],
  ['generic', 'scroll'],
];

const args = parseArgs(process.argv.slice(2));
const entries: IconEntry[] = [
  ...KIND_KEYS.map(([id, kind]) => ({ id, kind, rarity: 'common' as const })),
  ...Object.entries(GEM).map(([fam, tint]) => ({
    id: `gem_${fam}`,
    kind: 'gem' as IconKind,
    rarity: 'rare' as const,
    tint,
  })),
];

const sheet = synthIcons('/assets/icons/items_gen.png', 32, entries);
emit(args, 'icons', [
  { path: 'public/assets/icons/items_gen.png', png: sheet.png },
  { path: 'public/assets/icons/items_gen.json', json: sheet.manifest },
]);
