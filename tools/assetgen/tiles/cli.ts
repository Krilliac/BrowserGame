/**
 * ASSET-TILE CLI: render a seamless biome ground sheet + its GroundTileset manifest.
 *   tsx tools/assetgen/tiles/cli.ts [--seed N] [--check]
 * Output: public/assets/tiles/<name>.png + .json
 */

import { emit, parseArgs } from '../shared/cli.ts';
import { synthBiome, type BiomeSpec } from './synth.ts';

const BIOMES: BiomeSpec[] = [
  {
    name: 'meadow',
    tileSize: 32,
    hue: 104,
    sat: 0.4,
    light: 0.56,
    detail: 'flower',
    detailHue: 330,
  },
  { name: 'wastes', tileSize: 32, hue: 30, sat: 0.18, light: 0.36, detail: 'crack', detailHue: 24 },
  {
    name: 'shingle',
    tileSize: 32,
    hue: 210,
    sat: 0.08,
    light: 0.42,
    detail: 'pebble',
    detailHue: 210,
  },
  // --- Original replacements for the licensed biome sheets (32rogues rogues_tiles + CraftPix
  //     dungeon_floor + Mana Seed forest_autumn), so no third-party terrain art ships. ---
  // Rotfen Marsh / Sunken Pass — dark waterlogged green earth with grass tufts.
  { name: 'marsh', tileSize: 32, hue: 96, sat: 0.3, light: 0.3, detail: 'tuft', detailHue: 104 },
  // Emberdeep Mines / Infernal Forge — red-black volcanic stone, fissured.
  { name: 'mine', tileSize: 32, hue: 12, sat: 0.42, light: 0.22, detail: 'crack', detailHue: 18 },
  // Frostpeak Pass / Frozen Vault — blue-black glacial stone with ice cracks.
  { name: 'frost', tileSize: 32, hue: 208, sat: 0.22, light: 0.4, detail: 'crack', detailHue: 202 },
  // Hollowroot Caverns — dark grey-brown cave floor with loose stones.
  { name: 'cave', tileSize: 32, hue: 32, sat: 0.1, light: 0.26, detail: 'pebble', detailHue: 30 },
  // Worked-stone citadel floor (Blighted Spire / Vhal'reth) — plain cool slate.
  {
    name: 'dungeon',
    tileSize: 32,
    hue: 250,
    sat: 0.05,
    light: 0.34,
    detail: 'pebble',
    detailHue: 250,
  },
  // Seasonal grass re-skin (DB option) — amber autumn turf with fallen-leaf tufts.
  { name: 'autumn', tileSize: 32, hue: 34, sat: 0.45, light: 0.48, detail: 'tuft', detailHue: 28 },
];

const args = parseArgs(process.argv.slice(2));
const artifacts = BIOMES.flatMap((spec, i) => {
  const src = `/assets/tiles/${spec.name}.png`;
  const sheet = synthBiome(spec, src, args.seed + i * 101);
  const base = `public/assets/tiles/${spec.name}`;
  return [
    { path: `${base}.png`, png: sheet.png },
    { path: `${base}.json`, json: sheet.manifest },
  ];
});

emit(args, 'tiles', artifacts);
