import { describe, expect, it } from 'vitest';
import {
  HIRELING_FOLLOW_DIST,
  HIRELING_LEASH,
  hirelingCost,
  hirelingStats,
  hirelingTemplate,
  stepHireling,
  type HirelingTargetView,
  type HirelingView,
} from './hirelings.js';

const guard = hirelingTemplate('guard')!;
const marksman = hirelingTemplate('marksman')!;

function hv(x: number, y: number, tmpl = guard, attackReady = true): HirelingView {
  return { x, y, template: tmpl, attackReady };
}
function target(id: number, x: number, y: number, alive = true): HirelingTargetView {
  return { id, x, y, alive };
}
const speedOf = (i: { vx: number; vy: number }) => Math.hypot(i.vx, i.vy);

describe('hireling roster + scaling', () => {
  it('resolves known templates and rejects unknown ones', () => {
    expect(hirelingTemplate('guard')?.behavior).toBe('melee');
    expect(hirelingTemplate('marksman')?.behavior).toBe('ranged');
    expect(hirelingTemplate('dragon')).toBeUndefined();
  });

  it('scales cost and stats monotonically with level', () => {
    expect(hirelingCost(1)).toBe(210);
    expect(hirelingCost(10)).toBe(750);
    expect(hirelingCost(2)).toBeGreaterThan(hirelingCost(1));
    expect(hirelingStats(1)).toEqual({ maxHp: 66, power: 6 });
    const a = hirelingStats(5);
    const b = hirelingStats(6);
    expect(b.maxHp).toBeGreaterThan(a.maxHp);
    expect(b.power).toBeGreaterThanOrEqual(a.power);
  });
});

describe('stepHireling — leashing & heeling', () => {
  it('sprints straight back to the owner when past the leash, ignoring monsters', () => {
    const h = hv(0, 0);
    const owner = { x: HIRELING_LEASH + 100, y: 0 }; // due east, beyond leash
    const i = stepHireling(h, owner, [target(1, 5, 0)]); // a mob right next to it
    expect(i.attackTargetId).toBeNull(); // does not engage while recalling
    expect(i.vx).toBeGreaterThan(0); // heads toward the owner (east)
    expect(i.vy).toBeCloseTo(0, 6);
    expect(speedOf(i)).toBeCloseTo(guard.speed, 6);
  });

  it('heels toward the owner when idle and standing off, then rests at the side', () => {
    const owner = { x: 0, y: 0 };
    const far = stepHireling(hv(HIRELING_FOLLOW_DIST + 60, 0), owner, []);
    expect(far.vx).toBeLessThan(0); // walks back toward owner (west)
    expect(speedOf(far)).toBeCloseTo(guard.speed, 6);

    const close = stepHireling(hv(HIRELING_FOLLOW_DIST - 10, 0), owner, []);
    expect(close).toEqual({ vx: 0, vy: 0, facing: null, attackTargetId: null }); // idle
  });
});

describe('stepHireling — melee combat', () => {
  const owner = { x: 0, y: 0 };

  it('holds and attacks a target inside reach (when ready), facing it', () => {
    const i = stepHireling(hv(0, 0), owner, [target(7, guard.attackRange - 5, 0)]);
    expect(i.vx).toBe(0);
    expect(i.vy).toBe(0);
    expect(i.attackTargetId).toBe(7);
    expect(i.facing).toBeCloseTo(0, 6); // target due east
  });

  it('does not attack while on cooldown, but still holds position', () => {
    const i = stepHireling(hv(0, 0, guard, false), owner, [target(7, guard.attackRange - 5, 0)]);
    expect(i.attackTargetId).toBeNull();
    expect(speedOf(i)).toBe(0);
  });

  it('advances toward a target that is out of reach', () => {
    const i = stepHireling(hv(0, 0), owner, [target(7, 150, 0)]);
    expect(i.attackTargetId).toBeNull();
    expect(i.vx).toBeGreaterThan(0);
    expect(speedOf(i)).toBeCloseTo(guard.speed, 6);
  });
});

describe('stepHireling — ranged combat (kite)', () => {
  const owner = { x: 0, y: 0 };

  it('advances when beyond attack range but still within engage range', () => {
    // attackRange 230 < target 235 <= engage range 240 → it closes in (a target past 240 is ignored).
    const i = stepHireling(hv(0, 0, marksman), owner, [target(3, marksman.attackRange + 5, 0)]);
    expect(i.vx).toBeGreaterThan(0);
    expect(i.attackTargetId).toBeNull();
  });

  it('holds and fires inside the comfortable band', () => {
    const mid = (marksman.kiteRange! + marksman.attackRange) / 2;
    const i = stepHireling(hv(0, 0, marksman), owner, [target(3, mid, 0)]);
    expect(speedOf(i)).toBe(0);
    expect(i.attackTargetId).toBe(3);
  });

  it('retreats when a target closes inside the kite band', () => {
    const i = stepHireling(hv(0, 0, marksman), owner, [target(3, marksman.kiteRange! - 20, 0)]);
    expect(i.vx).toBeLessThan(0); // backs away from a target to the east
    expect(i.attackTargetId).toBeNull();
  });
});

describe('stepHireling — target selection', () => {
  const owner = { x: 0, y: 0 };

  it('ignores dead targets and picks the nearest engageable one', () => {
    // Dead one is closest (skipped); nearest LIVING (id 2) sits inside melee reach so it's attacked.
    const i = stepHireling(hv(0, 0), owner, [
      target(1, 20, 0, false), // dead, closest — must be skipped
      target(2, guard.attackRange - 6, 0), // nearest living, in reach
      target(3, 120, 0), // farther living
    ]);
    expect(i.attackTargetId).toBe(2);
  });

  it('will not chase a monster that sits past the leash from the owner', () => {
    const i = stepHireling(hv(0, 0), owner, [target(9, HIRELING_LEASH + 50, 0)]);
    expect(i.attackTargetId).toBeNull();
    expect(speedOf(i)).toBe(0); // no target, owner at our position → idle
  });
});
