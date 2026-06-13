/**
 * ASSET — generated creature sheets (skeleton / wolf / bat) replacing the licensed LPC mob art.
 *
 * Each is an 8-direction sheet (clockwise from East, matching `dirIndex`) over idle/walk/attack +
 * dirless hurt/death, in the same packed layout the engine consumes. Bodies are built from
 * disc/line capsules (no rotated ellipses needed) so they orient cleanly to any facing:
 *   - skeleton: an upright bone humanoid (skull + ribs + limb bones).
 *   - wolf: a quadruped capsule oriented along the facing (snout front, tail back, 4 legs, walk cycle).
 *   - bat: a small flyer with flapping wings (walk phase drives the flap).
 * Lit upper-left to match the game.
 */

import { Raster } from '../shared/raster.ts';
import { numToRgba, shade } from '../shared/palette.ts';
import { oscillate, overshoot } from '../shared/curves.ts';

export type CreatureKind = 'skeleton' | 'wolf' | 'bat';
export type Pose = 'idle' | 'walk' | 'attack' | 'hurt' | 'death';

export interface CreatureSpec {
  name: string;
  kind: CreatureKind;
  fw: number;
  fh: number;
  dirs: number;
  tint: number; // primary body color
}

export const CREATURES: CreatureSpec[] = [
  { name: 'skeleton', kind: 'skeleton', fw: 48, fh: 48, dirs: 8, tint: 0xd8d4c4 },
  { name: 'wolf', kind: 'wolf', fw: 48, fh: 48, dirs: 8, tint: 0x6b6358 },
  { name: 'bat', kind: 'bat', fw: 48, fh: 48, dirs: 8, tint: 0x4a3b50 },
];

const WALK_FRAMES = 6;
const ATTACK_FRAMES = 5;
const HURT_FRAMES = 3;
const DEATH_FRAMES = 4;
const SUN: [number, number] = [-0.6, -0.6];

function drawSkeleton(
  r: Raster,
  spec: CreatureSpec,
  angle: number,
  pose: Pose,
  phase: number,
): void {
  const cx = spec.fw / 2;
  let feetY = spec.fh - 5;
  const fx = Math.cos(angle);
  const fy = Math.sin(angle);
  const bone = numToRgba(spec.tint);
  let collapse = 0;
  let lunge = 0;
  let flash = 0;
  if (pose === 'death') {
    collapse = Math.min(1, phase);
    feetY += collapse * spec.fh * 0.2;
  } else if (pose === 'attack') lunge = overshoot(phase) * spec.fh * 0.12;
  else if (pose === 'hurt') flash = 1 - phase;
  const swing = pose === 'walk' ? oscillate(phase, 1) * 3 : 0;
  const headR = spec.fh * 0.16;
  const headY = feetY - spec.fh * 0.5 - collapse * spec.fh * 0.3 + fy * 0;
  const torsoY = feetY - spec.fh * 0.28;
  const c = flash > 0 ? shade(bone, flash * 0.6) : bone;
  // Legs (two bone pairs).
  r.line(cx - 4, feetY, cx - 4 + swing, torsoY, 1.4, shade(c, -0.1));
  r.line(cx + 4, feetY, cx + 4 - swing, torsoY, 1.4, shade(c, -0.1));
  // Ribcage.
  for (let i = 0; i < 3; i++) {
    const ry = torsoY - i * 4 - 2;
    r.line(cx - 5 + lunge * fx, ry, cx + 5 + lunge * fx, ry, 1.1, shade(c, i === 0 ? 0.1 : -0.05));
  }
  r.line(cx + lunge * fx, torsoY + 2, cx + lunge * fx, torsoY - 12, 1.3, c); // spine
  // Arms (one swings on attack toward the facing).
  const armX = cx + fx * 6 + lunge * fx;
  r.line(
    cx + lunge * fx,
    torsoY - 8,
    armX,
    torsoY - 2 + (pose === 'attack' ? -4 : 2),
    1.2,
    shade(c, -0.05),
  );
  r.line(cx + lunge * fx, torsoY - 8, cx - fx * 6, torsoY + 2, 1.2, shade(c, -0.05));
  // Skull.
  r.disc(cx + lunge * fx, headY, headR, c);
  r.disc(cx + lunge * fx + SUN[0] * 1.5, headY + SUN[1] * 1.5, headR * 0.6, shade(c, 0.15));
  if (fy > -0.3 && pose !== 'death') {
    const perp: [number, number] = [-fy, fx];
    const sp = headR * 0.4 * Math.max(0.3, 1 - Math.abs(fx) * 0.6);
    const ex = cx + lunge * fx + fx * headR * 0.3;
    r.disc(ex + perp[0] * sp, headY + perp[1] * sp + 1, 1.4, [20, 16, 18, 255]);
    r.disc(ex - perp[0] * sp, headY - perp[1] * sp + 1, 1.4, [20, 16, 18, 255]);
  }
}

function drawWolf(r: Raster, spec: CreatureSpec, angle: number, pose: Pose, phase: number): void {
  const cx = spec.fw / 2;
  const cy = spec.fh * 0.62;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle) * 0.6; // foreshorten the depth axis (top-down tilt)
  const px = -Math.sin(angle);
  const py = Math.cos(angle) * 0.6;
  const fur = numToRgba(spec.tint);
  let collapse = 0;
  let lunge = 0;
  let flash = 0;
  if (pose === 'death') collapse = Math.min(1, phase);
  else if (pose === 'attack') lunge = overshoot(phase) * spec.fh * 0.18;
  else if (pose === 'hurt') flash = 1 - phase;
  const c = flash > 0 ? shade(fur, flash * 0.6) : shade(fur, -collapse * 0.3);
  const L = spec.fh * 0.26;
  const bx = cx + dx * lunge;
  const by = cy + dy * lunge - (1 - collapse) * 0;
  const wid = spec.fh * 0.13 * (1 - collapse * 0.5);
  // Tail.
  r.line(bx - dx * L, by - dy * L, bx - dx * L * 1.6, by - dy * L * 1.6 - 2, 1.4, shade(c, -0.1));
  // Legs (front/back pairs, walk gait).
  const step = pose === 'walk' ? oscillate(phase, 1) * 3 : 0;
  for (const along of [0.6, -0.4]) {
    for (const side of [1, -1]) {
      const lx = bx + dx * L * along + px * wid * 0.8 * side;
      const ly = by + dy * L * along + py * wid * 0.8 * side;
      const off = (along > 0 ? step : -step) * side;
      r.line(lx, ly, lx + dx * off * 0.3, ly + 5 + collapse * 3, 1.3, shade(c, -0.15));
    }
  }
  // Body capsule (discs back→front).
  for (let t = -1; t <= 1; t += 0.25) {
    const taper = 1 - Math.abs(t) * 0.3;
    r.disc(bx + dx * L * t, by + dy * L * t, wid * taper, t > 0 ? shade(c, 0.05) : c);
  }
  r.disc(bx + SUN[0] * 2, by + SUN[1] * 2, wid * 0.7, shade(c, 0.14));
  // Head + snout at the front.
  const hx = bx + dx * L * 1.15;
  const hy = by + dy * L * 1.15;
  r.disc(hx, hy, wid * 0.85, c);
  r.disc(hx + dx * wid * 0.7, hy + dy * wid * 0.7, wid * 0.4, shade(c, -0.05)); // snout
  // Ears.
  r.disc(hx - dx * 2 + px * 3, hy - dy * 2 + py * 3, 1.6, shade(c, -0.1));
  r.disc(hx - dx * 2 - px * 3, hy - dy * 2 - py * 3, 1.6, shade(c, -0.1));
  if (pose !== 'death') {
    r.disc(hx + px * wid * 0.4, hy + py * wid * 0.4, 1, [200, 180, 60, 255]);
    r.disc(hx - px * wid * 0.4, hy - py * wid * 0.4, 1, [200, 180, 60, 255]);
  }
}

function drawBat(r: Raster, spec: CreatureSpec, angle: number, pose: Pose, phase: number): void {
  const cx = spec.fw / 2;
  const cy = spec.fh * 0.42; // bats fly high
  const dx = Math.cos(angle);
  const dy = Math.sin(angle) * 0.6;
  const px = -Math.sin(angle);
  const py = Math.cos(angle) * 0.6;
  const body = numToRgba(spec.tint);
  let flash = 0;
  let collapse = 0;
  if (pose === 'hurt') flash = 1 - phase;
  else if (pose === 'death') collapse = Math.min(1, phase);
  const c = flash > 0 ? shade(body, flash * 0.6) : body;
  // Wings flap on walk; spread on attack; folded on death.
  const flap =
    pose === 'death'
      ? -0.6
      : pose === 'walk'
        ? oscillate(phase, 1)
        : pose === 'attack'
          ? 0.6
          : Math.sin(phase * 6) * 0.4;
  const span = spec.fh * 0.3 * (1 - collapse * 0.7);
  for (const side of [1, -1]) {
    const wx = cx + px * span * side;
    const wy = cy + py * span * side + flap * 4 * -1;
    r.polygon(
      [
        [cx, cy],
        [wx, wy - 3],
        [wx + dx * 4, wy + 4],
        [cx + px * span * 0.4 * side, cy + 3],
      ],
      shade(c, side > 0 ? 0 : -0.1),
    );
  }
  // Body.
  r.disc(cx, cy, spec.fh * 0.1, c);
  r.disc(cx + SUN[0] * 1.5, cy + SUN[1] * 1.5, spec.fh * 0.06, shade(c, 0.15));
  // Ears + eyes toward facing.
  r.disc(cx + px * 2, cy - 3, 1.4, c);
  r.disc(cx - px * 2, cy - 3, 1.4, c);
  if (pose !== 'death') {
    r.disc(cx + dx * 2 + px * 1.5, cy + dy * 1, 0.9, [210, 90, 90, 255]);
    r.disc(cx + dx * 2 - px * 1.5, cy + dy * 1, 0.9, [210, 90, 90, 255]);
  }
}

const DRAWERS: Record<
  CreatureKind,
  (r: Raster, s: CreatureSpec, a: number, p: Pose, ph: number) => void
> = {
  skeleton: drawSkeleton,
  wolf: drawWolf,
  bat: drawBat,
};

interface ClipMeta {
  row0: number;
  startCol: number;
  frames: number;
  perFrameMs: number;
  loop: boolean;
  dirless?: boolean;
}

export interface CreatureSheet {
  png: Uint8Array;
  manifest: {
    name: string;
    src: string;
    fw: number;
    fh: number;
    dirCount: number;
    clips: Record<string, ClipMeta>;
  };
}

/** Render an 8-direction creature sheet + a manifest matching the engine Sheet/ClipSet. */
export function synthCreature(spec: CreatureSpec, src: string): CreatureSheet {
  const { fw, fh, dirs } = spec;
  const cols = Math.max(WALK_FRAMES, ATTACK_FRAMES, HURT_FRAMES, DEATH_FRAMES);
  const rows = dirs * 3 + 2; // idle/walk/attack (×dirs) + hurt + death (dirless)
  const sheet = new Raster(cols * fw, rows * fh);
  const draw = DRAWERS[spec.kind];
  const step = (Math.PI * 2) / dirs;
  const cell = (pose: Pose, angle: number, phase: number, col: number, row: number) => {
    const c = new Raster(fw, fh);
    draw(c, spec, angle, pose, phase);
    sheet.paste(c, col * fw, row * fh);
  };
  for (let d = 0; d < dirs; d++) {
    const a = d * step;
    cell('idle', a, 0, 0, d);
    for (let f = 0; f < WALK_FRAMES; f++) cell('walk', a, f / WALK_FRAMES, f, dirs + d);
    for (let f = 0; f < ATTACK_FRAMES; f++)
      cell('attack', a, f / (ATTACK_FRAMES - 1), f, dirs * 2 + d);
  }
  const south = Math.PI / 2;
  for (let f = 0; f < HURT_FRAMES; f++) cell('hurt', south, f / (HURT_FRAMES - 1), f, dirs * 3);
  for (let f = 0; f < DEATH_FRAMES; f++)
    cell('death', south, f / (DEATH_FRAMES - 1), f, dirs * 3 + 1);
  return {
    png: sheet.toPng(),
    manifest: {
      name: spec.name,
      src,
      fw,
      fh,
      dirCount: dirs,
      clips: {
        idle: { row0: 0, startCol: 0, frames: 1, perFrameMs: 260, loop: true },
        walk: { row0: dirs, startCol: 0, frames: WALK_FRAMES, perFrameMs: 120, loop: true },
        attack: { row0: dirs * 2, startCol: 0, frames: ATTACK_FRAMES, perFrameMs: 65, loop: false },
        hurt: {
          row0: dirs * 3,
          startCol: 0,
          frames: HURT_FRAMES,
          perFrameMs: 55,
          loop: false,
          dirless: true,
        },
        death: {
          row0: dirs * 3 + 1,
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

/** Compose one creature cell — for previews/tests. */
export function renderCreatureCell(
  spec: CreatureSpec,
  angle: number,
  pose: Pose,
  phase: number,
): Raster {
  const r = new Raster(spec.fw, spec.fh);
  DRAWERS[spec.kind](r, spec, angle, pose, phase);
  return r;
}
