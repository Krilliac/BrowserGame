/**
 * Sprite generator CLI: renders the procedural N-direction character sheet + its manifest.
 *   tsx tools/assetgen/sprites/cli.ts [--seed N] [--check]
 * Output: public/assets/sprites/<name>.png + public/assets/sprites/<name>.json
 */

import { emit, parseArgs } from '../shared/cli.ts';
import { ADVENTURER, synthCharacter } from './synth.ts';

const args = parseArgs(process.argv.slice(2));
const src = `/assets/sprites/${ADVENTURER.name}.png`;
const sheet = synthCharacter(ADVENTURER, src);
const base = `public/assets/sprites/${ADVENTURER.name}`;

emit(args, 'sprites', [
  { path: `${base}.png`, png: sheet.png },
  { path: `${base}.json`, json: sheet.manifest },
]);
