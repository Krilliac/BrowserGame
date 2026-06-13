/**
 * ASSET-FX CLI: render the animated effect strips + their manifests.
 *   tsx tools/assetgen/fx/cli.ts [--seed N] [--check]
 * Output: public/assets/fx/<kind>.png + a combined fx.json manifest map.
 */

import { emit, parseArgs } from '../shared/cli.ts';
import { FX_KINDS, synthFx } from './synth.ts';

const args = parseArgs(process.argv.slice(2));
const manifests: Record<string, unknown> = {};
const artifacts = FX_KINDS.map((kind, i) => {
  const src = `/assets/fx/${kind}.png`;
  const out = synthFx(kind, src, args.seed + i * 211);
  manifests[kind] = out.manifest;
  return { path: `public/assets/fx/${kind}.png`, png: out.png };
});
artifacts.push({ path: 'public/assets/fx/fx.json', json: manifests } as never);

emit(args, 'fx', artifacts);
