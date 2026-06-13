/**
 * ASSET-EMIT CLI: emit a library of validated EmitterDef presets as JSON.
 *   tsx tools/assetgen/emitters/cli.ts [--seed N] [--check]
 * Output: public/assets/emitters/presets.json (a map the registry can spread in).
 */

import { emit, parseArgs } from '../shared/cli.ts';
import { Rng } from '../shared/rng.ts';
import { makeEmitter, validateEmitter, type EmitIntent } from './synth.ts';

const args = parseArgs(process.argv.slice(2));
const rng = new Rng(args.seed);

// Intent → (key, intensity, tint). Tints match the in-engine library where they overlap.
const recipe: Array<[string, EmitIntent, number, number]> = [
  ['footstepDust', 'dust', 0.6, 0xb6a98c],
  ['bloodSpray', 'blood', 1, 0x8a0c0c],
  ['emberRise', 'ember', 0.8, 0xff7a2a],
  ['frostShards', 'frost', 0.9, 0x9fe0ff],
  ['healSparkle', 'heal', 0.8, 0x9affc0],
  ['hitSpark', 'spark', 1, 0xffffff],
  ['dashTrail', 'dash', 0.7, 0xcfd8ff],
];

const presets: Record<string, ReturnType<typeof makeEmitter>> = {};
for (const [key, intent, intensity, tint] of recipe) {
  const d = makeEmitter(intent, intensity, tint, rng);
  validateEmitter(d);
  presets[key] = d;
}

emit(args, 'emitters', [{ path: 'public/assets/emitters/presets.json', json: presets }]);
