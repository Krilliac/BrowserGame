/**
 * ASSET-ICON CLI: render a packed item-icon sheet + cell map.
 *   tsx tools/assetgen/icons/cli.ts [--seed N] [--check]
 * Output: public/assets/icons/items.png + .json
 */

import { emit, parseArgs } from '../shared/cli.ts';
import { synthIcons, type IconKind } from './synth.ts';

const args = parseArgs(process.argv.slice(2));

// A representative spread across item types + rarities (one icon per cell).
const KINDS: IconKind[] = [
  'sword',
  'axe',
  'bow',
  'staff',
  'shield',
  'helm',
  'chest',
  'potion',
  'scroll',
  'gem',
  'ring',
  'amulet',
];
const RARITIES = ['common', 'magic', 'rare', 'epic', 'legendary'] as const;
const entries = KINDS.map((kind, i) => ({
  id: `${kind}_${RARITIES[i % RARITIES.length]}`,
  kind,
  rarity: RARITIES[i % RARITIES.length],
}));

const src = '/assets/icons/items.png';
const sheet = synthIcons(src, 32, entries);
emit(args, 'icons', [
  { path: 'public/assets/icons/items.png', png: sheet.png },
  { path: 'public/assets/icons/items.json', json: sheet.manifest },
]);
