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

/** Draw one cell: facing `angle` (rad, 0=East CW), `pose` at progress `phase` (0..1). */
function drawCharacter(r: Raster, spec: CharSpec, angle: number, pose: Pose, phase: number): void {
  const cx = spec.fw / 2;
  let feetY = spec.fh - 4;
  const fx = Math.cos(angle);
  const fy = Math.sin(angle);
  const front = fy;

  const skin = numToRgba(spec.skin);
  let tunic = numToRgba(spec.tunic);
  const hair = numToRgba(spec.hair);
  const accent = numToRgba(spec.accent);

  const headR = spec.fh * 0.2;
  const bodyW = spec.fh * 0.34;
  const bodyH = spec.fh * 0.34;

  // Pose-driven body offsets.
  let bob = 0;
  let lungeX = 0;
  let lungeY = 0;
  let collapse = 0; // 0..1 sink toward the ground (death)
  let flash = 0; // hurt whiten
  if (pose === 'walk') {
    bob = -Math.abs(oscillate(phase, 1)) * spec.fh * 0.05;
  } else if (pose === 'idle') {
    bob = oscillate(phase, 1) * spec.fh * 0.02;
  } else if (pose === 'attack') {
    const k = overshoot(phase);
    lungeX = fx * k * spec.fh * 0.12;
    lungeY = fy * k * spec.fh * 0.12;
  } else if (pose === 'cast') {
    bob = -cubicInOut(Math.min(1, phase * 1.5)) * spec.fh * 0.04;
  } else if (pose === 'hurt') {
    lungeX = -fx * (1 - phase) * spec.fh * 0.1;
    flash = 1 - phase;
  } else if (pose === 'death') {
    collapse = cubicInOut(phase);
    feetY += collapse * spec.fh * 0.18;
  }

  const headCy = feetY - bodyH * 1.1 - headR - bob - collapse * spec.fh * 0.25;
  const bodyCy = feetY - bodyH * 0.7 - bob;

  if (flash > 0) tunic = shade(tunic, flash * 0.5);

  // Legs + walk swing.
  const swing = pose === 'walk' ? oscillate(phase, 1) * spec.fh * 0.09 : 0;
  const legc = shade(tunic, -0.35);
  r.ellipse(
    cx - bodyW * 0.28 + lungeX,
    feetY - 2,
    3.2,
    5 + swing * 0.2,
    shade(legc, swing > 0 ? 0.1 : -0.1),
  );
  r.ellipse(
    cx + bodyW * 0.28 + lungeX,
    feetY - 2,
    3.2,
    5 - swing * 0.2,
    shade(legc, swing < 0 ? 0.1 : -0.1),
  );

  // Cloak behind the facing.
  const back: [number, number] = [-fx, -fy];
  r.ellipse(
    cx + back[0] * bodyW * 0.5 + lungeX,
    bodyCy + back[1] * bodyH * 0.3 + lungeY,
    bodyW * 0.62,
    bodyH * (0.72 - collapse * 0.3),
    shade(accent, -0.15),
  );

  // Body.
  r.ellipse(cx + lungeX, bodyCy + lungeY, bodyW * 0.55, bodyH * (0.7 - collapse * 0.3), tunic);
  r.ellipse(
    cx + lungeX + SUN[0] * 3,
    bodyCy + lungeY + SUN[1] * 3,
    bodyW * 0.34,
    bodyH * 0.42,
    shade(tunic, 0.18),
  );
  r.ellipse(
    cx + lungeX - SUN[0] * 3,
    bodyCy + lungeY - SUN[1] * 2,
    bodyW * 0.3,
    bodyH * 0.4,
    shade(tunic, -0.22),
  );

  // Head + hair + face.
  const hcx = cx + lungeX;
  const hcy = headCy + lungeY;
  r.disc(hcx, hcy, headR, flash > 0 ? shade(skin, flash * 0.5) : skin);
  r.disc(hcx + SUN[0] * 2, hcy + SUN[1] * 2, headR * 0.62, shade(skin, 0.16));
  r.ellipse(
    hcx + back[0] * headR * 0.55,
    hcy + back[1] * headR * 0.55 - headR * 0.15,
    headR * 0.92,
    headR * 0.8,
    hair,
  );

  // Hood point toward facing.
  r.disc(hcx + fx * headR * 0.9, hcy + fy * headR * 0.9, headR * 0.28, shade(accent, 0.1));

  // Eyes when facing camera-ish (and not dead).
  if (front > -0.25 && pose !== 'death') {
    const eyeY = hcy + headR * 0.15 + fy * headR * 0.25;
    const perp: [number, number] = [-fy, fx];
    const spread = headR * 0.34 * Math.max(0.25, 1 - Math.abs(fx) * 0.7);
    const ex = hcx + fx * headR * 0.35;
    const eye = numToRgba(0x1a1420);
    const open = pose === 'hurt' ? 1.0 : 1.5;
    r.disc(ex + perp[0] * spread, eyeY + perp[1] * spread, open, eye);
    r.disc(ex - perp[0] * spread, eyeY - perp[1] * spread, open, eye);
  }

  // Held item: orbits to the facing-right side. attack swings it forward; cast raises it + glows.
  let itemAngle = angle + Math.PI / 2.4;
  let itemLift = 0;
  if (pose === 'attack') itemAngle = angle + Math.PI / 2.4 - overshoot(phase) * 1.6; // swing toward front
  if (pose === 'cast') itemLift = -8 * cubicInOut(Math.min(1, phase * 1.5));
  const sd: [number, number] = [Math.cos(itemAngle), Math.sin(itemAngle)];
  const ix = cx + lungeX + sd[0] * bodyW * 0.6;
  const iy = bodyCy + lungeY + sd[1] * bodyH * 0.5 + itemLift;
  r.line(ix, iy + 6, ix - sd[0] * 2, iy - 9, 1.4, shade(accent, 0.2));
  r.disc(ix - sd[0] * 2, iy - 10, 2, shade(accent, 0.35));
  if (pose === 'cast') {
    const gr = 2 + cubicInOut(Math.min(1, phase * 1.5)) * 5;
    r.radial(ix - sd[0] * 2, iy - 10, gr, [180, 210, 255, 200], 1.4);
  }
}

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

/** Render the full sheet + a manifest matching the engine's Sheet/ClipSet (incl. dirless hurt/death). */
export function synthCharacter(spec: CharSpec, src: string): CharSheet {
  const { fw, fh, dirs, walkFrames } = spec;
  const cols = Math.max(walkFrames, ATTACK_FRAMES, CAST_FRAMES, HURT_FRAMES, DEATH_FRAMES);
  const rows = dirs * 4 + 2; // idle/walk/attack/cast (×dirs) + hurt + death (dirless)
  const sheet = new Raster(cols * fw, rows * fh);
  const step = (Math.PI * 2) / dirs;
  const cell = (pose: Pose, angle: number, phase: number, col: number, row: number) => {
    const c = new Raster(fw, fh);
    drawCharacter(c, spec, angle, pose, phase);
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
  // dirless hurt/death drawn facing South (toward camera) so they read whatever the facing was.
  const south = Math.PI / 2;
  for (let f = 0; f < HURT_FRAMES; f++) cell('hurt', south, f / (HURT_FRAMES - 1), f, dirs * 4);
  for (let f = 0; f < DEATH_FRAMES; f++)
    cell('death', south, f / (DEATH_FRAMES - 1), f, dirs * 4 + 1);

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
