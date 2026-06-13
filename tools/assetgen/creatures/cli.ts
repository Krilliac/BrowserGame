/**
 * Creature generator CLI: render the skeleton/wolf/bat sheets + manifests.
 *   tsx tools/assetgen/creatures/cli.ts [--seed N] [--check]
 * Output: public/assets/sprites/<name>_gen.png + .json
 */

import { emit, parseArgs } from '../shared/cli.ts';
import { CREATURES, synthCreature } from './synth.ts';

const args = parseArgs(process.argv.slice(2));
const artifacts = CREATURES.flatMap((spec) => {
  const src = `/assets/sprites/${spec.name}_gen.png`;
  const out = synthCreature(spec, src);
  const base = `public/assets/sprites/${spec.name}_gen`;
  return [
    { path: `${base}.png`, png: out.png },
    { path: `${base}.json`, json: out.manifest },
  ];
});

emit(args, 'creatures', artifacts);
