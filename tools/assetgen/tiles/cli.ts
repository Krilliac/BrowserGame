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
    hue: 110,
    sat: 0.32,
    light: 0.4,
    detail: 'flower',
    detailHue: 320,
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
