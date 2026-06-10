import { describe, expect, it } from 'vitest';
import {
  dirOf,
  newAnimView,
  resolveAnim,
  triggerOneShot,
  type ClipSet,
} from './animation-controller.js';

/** A full-LPC-style sheet: walk loops, attack/cast/hurt/death are one-shots; hurt is dirless. */
const LPC: ClipSet = {
  dirOrder: ['N', 'W', 'S', 'E'],
  clips: {
    idle: { row0: 8, startCol: 0, frames: 1, perFrameMs: 1, loop: true },
    walk: { row0: 8, startCol: 1, frames: 8, perFrameMs: 100, loop: true },
    cast: { row0: 0, startCol: 0, frames: 7, perFrameMs: 50, loop: false },
    attack: { row0: 12, startCol: 0, frames: 6, perFrameMs: 50, loop: false },
    hurt: { row0: 20, startCol: 0, frames: 6, perFrameMs: 40, loop: false, dirless: true },
    death: { row0: 20, startCol: 0, frames: 6, perFrameMs: 60, loop: false, dirless: true },
  },
};

/** A walk-only sheet (like the wolf/bat): no action clips — everything falls back to walk/idle. */
const WALK_ONLY: ClipSet = {
  dirOrder: ['N', 'W', 'S', 'E'],
  clips: {
    idle: { row0: 0, startCol: 0, frames: 1, perFrameMs: 1, loop: true },
    walk: { row0: 0, startCol: 0, frames: 4, perFrameMs: 100, loop: true },
  },
};

// Facing is atan2(dy, dx) in screen space (up = negative y), so 0=E, π/2=S(down), π=W, -π/2=N(up).
const EAST = 0;
const NORTH = -Math.PI / 2;

describe('dirOf', () => {
  it('quantizes facing to cardinals', () => {
    expect(dirOf(EAST)).toBe('E');
    expect(dirOf(NORTH)).toBe('N');
    expect(dirOf(Math.PI)).toBe('W');
    expect(dirOf(Math.PI / 2)).toBe('S');
  });
});

describe('locomotion', () => {
  it('idles when not moving and walks (looping) when moving, on the facing row', () => {
    const v = newAnimView();
    const idle = resolveAnim(v, LPC, EAST, false, 0);
    expect(idle).toEqual({ row: 11, col: 0 }); // walk block row0 8 + E index 3, idle col 0

    const walk = resolveAnim(v, LPC, EAST, true, 250); // 250/100 = frame 2 → col 1+2 = 3
    expect(walk.row).toBe(11);
    expect(walk.col).toBe(3);
  });

  it('directional rows follow dirOrder', () => {
    const v = newAnimView();
    expect(resolveAnim(v, LPC, NORTH, false, 0).row).toBe(8); // N index 0
  });
});

describe('one-shots', () => {
  it('an attack one-shot plays to completion, then locomotion resumes', () => {
    const v = newAnimView();
    triggerOneShot(v, 'attack', 1000, LPC);
    // mid-swing: frame floor((1100-1000)/50)=2 on the slash row (12 + E index 3 = 15)
    const mid = resolveAnim(v, LPC, EAST, false, 1100);
    expect(mid).toEqual({ row: 15, col: 2 });
    // after the clip duration (6*50=300ms) it returns to idle
    const after = resolveAnim(v, LPC, EAST, false, 1400);
    expect(after).toEqual({ row: 11, col: 0 });
  });

  it('movement does not interrupt an in-flight one-shot', () => {
    const v = newAnimView();
    triggerOneShot(v, 'cast', 0, LPC);
    const r = resolveAnim(v, LPC, EAST, true, 100); // moving=true, but cast still owns the pose
    expect(r.row).toBe(0 + 3); // cast row0 0 + E index 3
  });

  it('higher priority interrupts lower (hurt over attack), not the reverse', () => {
    const v = newAnimView();
    triggerOneShot(v, 'attack', 0, LPC);
    triggerOneShot(v, 'hurt', 50, LPC); // hurt > attack → takes over
    expect(v.action).toBe('hurt');
    triggerOneShot(v, 'attack', 80, LPC); // attack < hurt → ignored while hurt plays
    expect(v.action).toBe('hurt');
  });

  it('hurt is dirless (always the same row regardless of facing)', () => {
    const v = newAnimView();
    triggerOneShot(v, 'hurt', 0, LPC);
    const e = resolveAnim(v, LPC, EAST, false, 40);
    const n = resolveAnim(newAnimView2('hurt'), LPC, NORTH, false, 40);
    expect(e.row).toBe(20);
    expect(n.row).toBe(20);
  });
});

describe('death', () => {
  it('is terminal and holds the last frame forever', () => {
    const v = newAnimView();
    triggerOneShot(v, 'death', 0, LPC);
    expect(v.dead).toBe(true);
    const held = resolveAnim(v, LPC, EAST, true, 100000); // long after, still moving input
    expect(held).toEqual({ row: 20, col: 5 }); // death row 20, last frame col 0+5
    // nothing can revive the pose
    triggerOneShot(v, 'attack', 100001, LPC);
    expect(v.action).toBe('death');
  });
});

describe('walk-only sheets', () => {
  it('ignore action triggers and fall back to walk/idle', () => {
    const v = newAnimView();
    triggerOneShot(v, 'attack', 0, WALK_ONLY); // no attack clip → no-op
    expect(v.action).toBeNull();
    expect(resolveAnim(v, WALK_ONLY, EAST, true, 100).row).toBe(3); // walk row0 0 + E index 3
  });
});

/** Helper: a fresh view already in a one-shot, for the dirless cross-facing check. */
function newAnimView2(state: 'hurt'): ReturnType<typeof newAnimView> {
  const v = newAnimView();
  triggerOneShot(v, state, 0, LPC);
  return v;
}
