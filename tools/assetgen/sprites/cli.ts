/**
 * Sprite generator CLI: renders the procedural N-direction character sheet, its manifest, and the
 * equipment LAYER sheets (helm/armor/weapon) that overlay the body frame-for-frame (paper-doll).
 *   tsx tools/assetgen/sprites/cli.ts [--seed N] [--check]
 * Output: public/assets/sprites/adventurer16{,_helm,_armor,_weapon}.png + adventurer16.json
 */

import { emit, parseArgs } from '../shared/cli.ts';
import { ADVENTURER, EQUIP_LAYERS, synthCharacter, synthLayer, type EquipPiece } from './synth.ts';

const args = parseArgs(process.argv.slice(2));
const base = `public/assets/sprites/${ADVENTURER.name}`;
const sheet = synthCharacter(ADVENTURER, `/assets/sprites/${ADVENTURER.name}.png`);

const artifacts = [
  { path: `${base}.png`, png: sheet.png },
  { path: `${base}.json`, json: sheet.manifest },
  ...(Object.keys(EQUIP_LAYERS) as EquipPiece[]).map((piece) => ({
    path: `${base}_${piece}.png`,
    png: synthLayer(ADVENTURER, piece),
  })),
];

emit(args, 'sprites', artifacts);
