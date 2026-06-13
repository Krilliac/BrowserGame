/**
 * Procedural N-direction character sheet synth (the SPRITEGEN-equivalent needed to finish RENDER-09).
 *
 * Renders a stylized billboard adventurer at `dirs` facings (clockwise from East, matching the engine's
 * `dirIndex`) across the full clip set (idle/walk/attack/cast/hurt/death), packed into one sheet.
 * Direction reads from where the figure looks (face vs back-of-head, profile eyes), a hood point toward
 * the facing, and a held item that orbits to the facing side. Lit upper-left to match the game.
 *
 * Sheet layout (so the engine's `frameAt` finds frames at `row0 + dirIndex(facing, dirs)`; dirless
 * clips occupy a single row):
 *   idle   rows 0..dirs-1            (1 col)
 *   walk   rows dirs..2dirs-1        (walkFrames cols)
 *   attack rows 2dirs..3dirs-1       (ATTACK_FRAMES cols)
 *   cast   rows 3dirs..4dirs-1       (CAST_FRAMES cols)
 *   hurt   row 4dirs        (dirless, HURT_FRAMES cols)
 *   death  row 4dirs+1      (dirless, DEATH_FRAMES cols)
 */

import { Raster } from '../shared/raster.ts';
import { cubicInOut, oscillate, overshoot } from '../shared/curves.ts';
import { numToRgba, shade } from '../shared/palette.ts';

export type Pose = 'idle' | 'walk' | 'attack' | 'cast' | 'hurt' | 'death';

export interface CharSpec {
  name: string;
  fw: number;
  fh: number;
  dirs: 4 | 8 | 16;
  walkFrames: number;
  walkFrameMs: number;
  skin: number;
  tunic: number;
  hair: number;
  accent: number;
}

export const ADVENTURER: CharSpec = {
  name: 'adventurer16',
  fw: 48,
  fh: 48,
  dirs: 16,
  walkFrames: 8,
  walkFrameMs: 110,
  skin: 0xe6b88a,
  tunic: 0x3b6b9a,
  hair: 0x4a3322,
  accent: 0x9a3b3b,
};

const ATTACK_FRAMES = 6;
const CAST_FRAMES = 7;
const HURT_FRAMES = 4;
const DEATH_FRAMES = 6;

const SUN: [number, number] = [-0.6, -0.6];

/** Body anchors for a given facing+pose+phase. The base body and every equipment layer draw from
 *  the same rig, so layer sheets align frame-for-frame with the body sheet. */
interface Rig {
  cx: number;
  feetY: number;
  fx: number;
  fy: number;
  front: number;
  lungeX: number;
  lungeY: number;
  collapse: number;
  flash: number;
  headR: number;
  bodyW: number;
  bodyH: number;
  hcx: number;
  hcy: number;
  bodyCx: number;
  bodyCy: number;
  handX: number;
  handY: number;
  handDx: number;
  handDy: number;
  swing: number;
}

function computeRig(spec: CharSpec, angle: number, pose: Pose, phase: number): Rig {
  const cx = spec.fw / 2;
  let feetY = spec.fh - 4;
  const fx = Math.cos(angle);
  const fy = Math.sin(angle);
  const headR = spec.fh * 0.2;
  const bodyW = spec.fh * 0.34;
  const bodyH = spec.fh * 0.34;
  let bob = 0;
  let lungeX = 0;
  let lungeY = 0;
  let collapse = 0;
  let flash = 0;
  if (pose === 'walk') bob = -Math.abs(oscillate(phase, 1)) * spec.fh * 0.05;
  else if (pose === 'idle') bob = oscillate(phase, 1) * spec.fh * 0.02;
  else if (pose === 'attack') {
    const k = overshoot(phase);
    lungeX = fx * k * spec.fh * 0.12;
    lungeY = fy * k * spec.fh * 0.12;
  } else if (pose === 'cast') bob = -cubicInOut(Math.min(1, phase * 1.5)) * spec.fh * 0.04;
  else if (pose === 'hurt') {
    lungeX = -fx * (1 - phase) * spec.fh * 0.1;
    flash = 1 - phase;
  } else if (pose === 'death') {
    collapse = cubicInOut(phase);
    feetY += collapse * spec.fh * 0.18;
  }
  const headCy = feetY - bodyH * 1.1 - headR - bob - collapse * spec.fh * 0.25;
  const bodyCy = feetY - bodyH * 0.7 - bob + lungeY;
  let itemAngle = angle + Math.PI / 2.4;
  let itemLift = 0;
  if (pose === 'attack') itemAngle = angle + Math.PI / 2.4 - overshoot(phase) * 1.6;
  if (pose === 'cast') itemLift = -8 * cubicInOut(Math.min(1, phase * 1.5));
  const handDx = Math.cos(itemAngle);
  const handDy = Math.sin(itemAngle);
  return {
    cx,
    feetY,
    fx,
    fy,
    front: fy,
    lungeX,
    lungeY,
    collapse,
    flash,
    headR,
    bodyW,
    bodyH,
    hcx: cx + lungeX,
    hcy: headCy + lungeY,
    bodyCx: cx + lungeX,
    bodyCy,
    handX: cx + lungeX + handDx * bodyW * 0.6,
    handY: bodyCy + handDy * bodyH * 0.5 + itemLift,
    handDx,
    handDy,
    swing: pose === 'walk' ? oscillate(phase, 1) * spec.fh * 0.09 : 0,
  };
}

/** A per-cell draw step (body or an equipment layer) — all consume the shared rig. */
type CellDraw = (r: Raster, spec: CharSpec, rig: Rig, pose: Pose, phase: number) => void;

const drawBody: CellDraw = (r, spec, rig, pose, phase) => {
  const skin = numToRgba(spec.skin);
  let tunic = numToRgba(spec.tunic);
  const hair = numToRgba(spec.hair);
  const accent = numToRgba(spec.accent);
  if (rig.flash > 0) tunic = shade(tunic, rig.flash * 0.5);
  const { bodyW, bodyH, headR, collapse, fx, fy, front } = rig;
  const back: [number, number] = [-fx, -fy];

  // Legs.
  const legc = shade(tunic, -0.35);
  r.ellipse(
    rig.cx - bodyW * 0.28 + rig.lungeX,
    rig.feetY - 2,
    3.2,
    5 + rig.swing * 0.2,
    shade(legc, rig.swing > 0 ? 0.1 : -0.1),
  );
  r.ellipse(
    rig.cx + bodyW * 0.28 + rig.lungeX,
    rig.feetY - 2,
    3.2,
    5 - rig.swing * 0.2,
    shade(legc, rig.swing < 0 ? 0.1 : -0.1),
  );

  // Cloak + body.
  r.ellipse(
    rig.bodyCx + back[0] * bodyW * 0.5,
    rig.bodyCy + back[1] * bodyH * 0.3,
    bodyW * 0.62,
    bodyH * (0.72 - collapse * 0.3),
    shade(accent, -0.15),
  );
  r.ellipse(rig.bodyCx, rig.bodyCy, bodyW * 0.55, bodyH * (0.7 - collapse * 0.3), tunic);
  r.ellipse(
    rig.bodyCx + SUN[0] * 3,
    rig.bodyCy + SUN[1] * 3,
    bodyW * 0.34,
    bodyH * 0.42,
    shade(tunic, 0.18),
  );
  r.ellipse(
    rig.bodyCx - SUN[0] * 3,
    rig.bodyCy - SUN[1] * 2,
    bodyW * 0.3,
    bodyH * 0.4,
    shade(tunic, -0.22),
  );

  // Head + hair + hood.
  r.disc(rig.hcx, rig.hcy, headR, rig.flash > 0 ? shade(skin, rig.flash * 0.5) : skin);
  r.disc(rig.hcx + SUN[0] * 2, rig.hcy + SUN[1] * 2, headR * 0.62, shade(skin, 0.16));
  r.ellipse(
    rig.hcx + back[0] * headR * 0.55,
    rig.hcy + back[1] * headR * 0.55 - headR * 0.15,
    headR * 0.92,
    headR * 0.8,
    hair,
  );
  r.disc(rig.hcx + fx * headR * 0.9, rig.hcy + fy * headR * 0.9, headR * 0.28, shade(accent, 0.1));

  // Eyes.
  if (front > -0.25 && pose !== 'death') {
    const eyeY = rig.hcy + headR * 0.15 + fy * headR * 0.25;
    const perp: [number, number] = [-fy, fx];
    const spread = headR * 0.34 * Math.max(0.25, 1 - Math.abs(fx) * 0.7);
    const ex = rig.hcx + fx * headR * 0.35;
    const eye = numToRgba(0x1a1420);
    const open = pose === 'hurt' ? 1.0 : 1.5;
    r.disc(ex + perp[0] * spread, eyeY + perp[1] * spread, open, eye);
    r.disc(ex - perp[0] * spread, eyeY - perp[1] * spread, open, eye);
  }

  // Default held baton (covered by the weapon layer when one is equipped).
  r.line(
    rig.handX,
    rig.handY + 6,
    rig.handX - rig.handDx * 2,
    rig.handY - 9,
    1.4,
    shade(accent, 0.2),
  );
  r.disc(rig.handX - rig.handDx * 2, rig.handY - 10, 2, shade(accent, 0.35));
  if (pose === 'cast') {
    const gr = 2 + cubicInOut(Math.min(1, phase * 1.5)) * 5;
    r.radial(rig.handX - rig.handDx * 2, rig.handY - 10, gr, [180, 210, 255, 200], 1.4);
  }
};

// ─── Equipment layers (ASSET — equippables on characters) ────────────────────────
// Each draws ONLY its piece, from the same rig, into a sheet with identical layout — so the renderer
// composites it over the body frame-for-frame.
const STEEL: [number, number, number, number] = [196, 204, 214, 255];
const GOLD: [number, number, number, number] = [206, 166, 74, 255];

const drawHelm: CellDraw = (_r, _spec, rig) => {
  const r = _r;
  const hr = rig.headR;
  // Metal dome covering the crown + back of head, with a sun highlight and a brow brim.
  r.disc(rig.hcx, rig.hcy - hr * 0.12, hr * 1.04, shade(STEEL, -0.05));
  r.disc(rig.hcx + SUN[0] * 2, rig.hcy + SUN[1] * 2 - hr * 0.12, hr * 0.6, shade(STEEL, 0.2));
  r.ellipse(rig.hcx, rig.hcy + hr * 0.42, hr * 1.06, hr * 0.32, shade(STEEL, -0.25));
  // Face is left open toward the camera so the body's eyes still read.
  if (rig.front > -0.1) {
    r.ellipse(rig.hcx + rig.fx * hr * 0.15, rig.hcy + hr * 0.28, hr * 0.62, hr * 0.4, [0, 0, 0, 0]);
  }
  // A small accent plume at the back.
  r.disc(
    rig.hcx - rig.fx * hr * 0.7,
    rig.hcy - rig.fy * hr * 0.7 - hr * 0.5,
    hr * 0.22,
    [150, 40, 40, 255],
  );
};

const drawArmor: CellDraw = (_r, _spec, rig) => {
  const r = _r;
  const { bodyW, bodyH, collapse } = rig;
  r.ellipse(
    rig.bodyCx,
    rig.bodyCy - bodyH * 0.06,
    bodyW * 0.5,
    bodyH * (0.56 - collapse * 0.3),
    shade(STEEL, -0.08),
  );
  r.ellipse(
    rig.bodyCx + SUN[0] * 2.5,
    rig.bodyCy + SUN[1] * 2.5,
    bodyW * 0.3,
    bodyH * 0.34,
    shade(STEEL, 0.22),
  );
  // Pauldrons perpendicular to facing.
  const px = -rig.fy;
  const py = rig.fx;
  r.disc(
    rig.bodyCx + px * bodyW * 0.42,
    rig.bodyCy - bodyH * 0.28 + py * bodyW * 0.42,
    3,
    shade(STEEL, 0.1),
  );
  r.disc(
    rig.bodyCx - px * bodyW * 0.42,
    rig.bodyCy - bodyH * 0.28 - py * bodyW * 0.42,
    3,
    shade(STEEL, 0.1),
  );
};

const drawWeapon: CellDraw = (_r, _spec, rig) => {
  const r = _r;
  const { handX, handY, handDx, handDy } = rig;
  const len = rig.bodyH * 1.0;
  const tipX = handX + handDx * len;
  const tipY = handY + handDy * len;
  r.line(handX, handY, tipX, tipY, 1.7, STEEL);
  r.line(handX, handY, tipX, tipY, 0.8, shade(STEEL, 0.3));
  const px = -handDy;
  const py = handDx;
  r.line(handX + px * 3, handY + py * 3, handX - px * 3, handY - py * 3, 1.2, GOLD); // guard
  r.disc(handX - handDx * 3, handY - handDy * 3, 1.8, GOLD); // pommel
};

export const EQUIP_LAYERS = { helm: drawHelm, armor: drawArmor, weapon: drawWeapon } as const;
export type EquipPiece = keyof typeof EQUIP_LAYERS;

interface ClipMeta {
  row0: number;
  startCol: number;
  frames: number;
  perFrameMs: number;
  loop: boolean;
  dirless?: boolean;
}

export interface CharSheet {
  png: Uint8Array;
  manifest: {
    key: string;
    src: string;
    fw: number;
    fh: number;
    dirCount: number;
    clips: Record<string, ClipMeta>;
  };
}

/** Render every cell (idle/walk/attack/cast ×dirs + dirless hurt/death) with `draw`. Body + each
 *  equipment layer share this layout, so a layer sheet overlays the body frame-for-frame. */
function renderSheet(spec: CharSpec, draw: CellDraw): Raster {
  const { fw, fh, dirs, walkFrames } = spec;
  const cols = Math.max(walkFrames, ATTACK_FRAMES, CAST_FRAMES, HURT_FRAMES, DEATH_FRAMES);
  const rows = dirs * 4 + 2;
  const sheet = new Raster(cols * fw, rows * fh);
  const step = (Math.PI * 2) / dirs;
  const cell = (pose: Pose, angle: number, phase: number, col: number, row: number) => {
    const c = new Raster(fw, fh);
    draw(c, spec, computeRig(spec, angle, pose, phase), pose, phase);
    sheet.paste(c, col * fw, row * fh);
  };
  for (let d = 0; d < dirs; d++) {
    const a = d * step;
    cell('idle', a, 0, 0, d);
    for (let f = 0; f < walkFrames; f++) cell('walk', a, f / walkFrames, f, dirs + d);
    for (let f = 0; f < ATTACK_FRAMES; f++)
      cell('attack', a, f / (ATTACK_FRAMES - 1), f, dirs * 2 + d);
    for (let f = 0; f < CAST_FRAMES; f++) cell('cast', a, f / (CAST_FRAMES - 1), f, dirs * 3 + d);
  }
  const south = Math.PI / 2;
  for (let f = 0; f < HURT_FRAMES; f++) cell('hurt', south, f / (HURT_FRAMES - 1), f, dirs * 4);
  for (let f = 0; f < DEATH_FRAMES; f++)
    cell('death', south, f / (DEATH_FRAMES - 1), f, dirs * 4 + 1);
  return sheet;
}

/** Render an equipment LAYER sheet (helm/armor/weapon) sharing the body's exact layout. */
export function synthLayer(spec: CharSpec, piece: EquipPiece): Uint8Array {
  return renderSheet(spec, EQUIP_LAYERS[piece]).toPng();
}

/** Compose the body + the given equipment layers into one cell (the same overlay order the renderer
 *  uses) — for previews + alignment tests. */
export function renderComposedCell(
  spec: CharSpec,
  angle: number,
  pose: Pose,
  phase: number,
  pieces: EquipPiece[],
): Raster {
  const r = new Raster(spec.fw, spec.fh);
  const rig = computeRig(spec, angle, pose, phase);
  drawBody(r, spec, rig, pose, phase);
  for (const p of pieces) EQUIP_LAYERS[p](r, spec, rig, pose, phase);
  return r;
}

/** Render the full body sheet + a manifest matching the engine's Sheet/ClipSet. */
export function synthCharacter(spec: CharSpec, src: string): CharSheet {
  const { fw, fh, dirs, walkFrames } = spec;
  const sheet = renderSheet(spec, drawBody);
  return {
    png: sheet.toPng(),
    manifest: {
      key: spec.name,
      src,
      fw,
      fh,
      dirCount: dirs,
      clips: {
        idle: { row0: 0, startCol: 0, frames: 1, perFrameMs: 240, loop: true },
        walk: {
          row0: dirs,
          startCol: 0,
          frames: walkFrames,
          perFrameMs: spec.walkFrameMs,
          loop: true,
        },
        attack: { row0: dirs * 2, startCol: 0, frames: ATTACK_FRAMES, perFrameMs: 60, loop: false },
        cast: { row0: dirs * 3, startCol: 0, frames: CAST_FRAMES, perFrameMs: 70, loop: false },
        hurt: {
          row0: dirs * 4,
          startCol: 0,
          frames: HURT_FRAMES,
          perFrameMs: 55,
          loop: false,
          dirless: true,
        },
        death: {
          row0: dirs * 4 + 1,
          startCol: 0,
          frames: DEATH_FRAMES,
          perFrameMs: 90,
          loop: false,
          dirless: true,
        },
      },
    },
  };
}
