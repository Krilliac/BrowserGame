import { describe, expect, it } from 'vitest';
import { EMITTERS, lerp, particleT, stepParticle } from './particles.js';

function freshParticle(over: Partial<Parameters<typeof stepParticle>[0]> = {}) {
  return {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    gravity: 0,
    life: 1000,
    maxLife: 1000,
    startScale: 1,
    endScale: 0,
    startAlpha: 1,
    endAlpha: 0,
    active: true,
    ...over,
  };
}

describe('lerp / particleT (RENDER-03)', () => {
  it('lerp interpolates endpoints', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(2, 4, 0.5)).toBe(3);
  });

  it('particleT goes 0 at birth → 1 at death and clamps', () => {
    expect(particleT({ life: 1000, maxLife: 1000 })).toBe(0);
    expect(particleT({ life: 500, maxLife: 1000 })).toBe(0.5);
    expect(particleT({ life: 0, maxLife: 1000 })).toBe(1);
    expect(particleT({ life: -50, maxLife: 1000 })).toBe(1); // clamped
    expect(particleT({ life: 10, maxLife: 0 })).toBe(1); // guard divide-by-zero
  });
});

describe('stepParticle (RENDER-03)', () => {
  it('integrates planar position and decrements life', () => {
    const p = freshParticle({ vx: 100, vy: -50, life: 1000, maxLife: 1000 });
    const alive = stepParticle(p, 100); // 0.1s
    expect(p.x).toBeCloseTo(10, 5);
    expect(p.y).toBeCloseTo(-5, 5);
    expect(p.life).toBe(900);
    expect(alive).toBe(true);
  });

  it('applies gravity to height and clamps z at the ground', () => {
    const p = freshParticle({ z: 5, vz: 0, gravity: 1000 }); // falls
    stepParticle(p, 100); // vz -= 100, z += 0 then... order: z += vz*dt (0) then vz -= g*dt
    expect(p.vz).toBeCloseTo(-100, 5);
    // step again: z should drop and then clamp to 0, vz zeroed on landing
    stepParticle(p, 100);
    expect(p.z).toBe(0);
    expect(p.vz).toBe(0);
  });

  it('rising particles (negative gravity) gain height', () => {
    const p = freshParticle({ z: 0, vz: 50, gravity: -60 });
    stepParticle(p, 100);
    expect(p.z).toBeGreaterThan(0);
  });

  it('deactivates once life runs out', () => {
    const p = freshParticle({ life: 80, maxLife: 1000 });
    expect(stepParticle(p, 100)).toBe(false);
    expect(p.active).toBe(false);
  });
});

describe('EMITTERS library (RENDER-03)', () => {
  it('every emitter is well-formed (positive count, ordered ranges, valid blend)', () => {
    for (const [key, d] of Object.entries(EMITTERS)) {
      expect(d.count, key).toBeGreaterThan(0);
      expect(d.lifeMs[0], key).toBeLessThanOrEqual(d.lifeMs[1]);
      expect(d.speed[0], key).toBeLessThanOrEqual(d.speed[1]);
      expect(d.startScale[0], key).toBeLessThanOrEqual(d.startScale[1]);
      expect(['normal', 'add'], key).toContain(d.blend);
      expect(['spark', 'soft'], key).toContain(d.texture);
      expect(d.startAlpha, key).toBeGreaterThanOrEqual(0);
      expect(d.startAlpha, key).toBeLessThanOrEqual(1);
    }
  });
});
