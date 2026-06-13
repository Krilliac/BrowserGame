/**
 * ASSET-SFX CLI: emit a library of validated procedural SFX synth defs as JSON.
 *   tsx tools/assetgen/sfx/cli.ts [--seed N] [--check]
 * Output: public/assets/audio/synth.json (the Web Audio synth path renders these — no asset weight).
 */

import { emit, parseArgs } from '../shared/cli.ts';
import { Rng } from '../shared/rng.ts';
import { makeSfx, validateSfx, type SfxIntent } from './synth.ts';

const args = parseArgs(process.argv.slice(2));
const rng = new Rng(args.seed);

const intents: SfxIntent[] = [
  'hit',
  'crit',
  'block',
  'pickup',
  'coin',
  'levelup',
  'footstep',
  'cast',
  'door',
  'portal',
  'uiClick',
  'uiError',
];

const defs = intents.map((intent) => {
  const d = makeSfx(intent, rng);
  validateSfx(d);
  return d;
});

emit(args, 'sfx', [{ path: 'public/assets/audio/synth.json', json: defs }]);
