import { describe, expect, it } from 'vitest';
import {
  MAX_LIGHTS,
  cullLights,
  packLights,
  pointToGpuLight,
  sunGpuLight,
  type GpuLight,
} from './deferred-lighting.js';

describe('pointToGpuLight (RENDER-01)', () => {
  it('unpacks the colour and carries height/intensity, as a point light', () => {
    const l = pointToGpuLight({ x: 100, y: 200, radius: 150, color: 0xff8000 }, 40, 1.5);
    expect(l.x).toBe(100);
    expect(l.y).toBe(200);
    expect(l.z).toBe(40);
    expect(l.radius).toBe(150);
    expect(l.r).toBeCloseTo(1, 5);
    expect(l.g).toBeCloseTo(128 / 255, 5);
    expect(l.b).toBe(0);
    expect(l.intensity).toBe(1.5);
    expect(l.kind).toBe(0);
  });
});

describe('sunGpuLight (RENDER-01)', () => {
  it('is a directional light with a normalized screen-space direction', () => {
    const sun = sunGpuLight(0.5);
    expect(sun.kind).toBe(1);
    expect(Math.hypot(sun.sunDx, sun.sunDy)).toBeCloseTo(1, 5);
  });

  it('is stronger by day and weaker at night (inverse of the point-light gating)', () => {
    expect(sunGpuLight(0).intensity).toBeGreaterThan(sunGpuLight(1).intensity);
  });
});

describe('cullLights (RENDER-01)', () => {
  const pt = (x: number, y: number): GpuLight =>
    pointToGpuLight({ x, y, radius: 100, color: 0xffffff }, 40, 1);

  it('returns a copy unchanged when within the cap', () => {
    const lights = [pt(0, 0), pt(10, 10)];
    const out = cullLights(lights, 0, 0, 4);
    expect(out).toHaveLength(2);
    expect(out).not.toBe(lights);
  });

  it('drops the lights farthest from the focus first, and is deterministic', () => {
    const lights = [pt(0, 0), pt(1000, 1000), pt(5, 5), pt(2000, 0)];
    const out = cullLights(lights, 0, 0, 2);
    expect(out).toHaveLength(2);
    // Nearest two to the origin are (0,0) and (5,5).
    const kept = new Set(out.map((l) => `${l.x},${l.y}`));
    expect(kept.has('0,0')).toBe(true);
    expect(kept.has('5,5')).toBe(true);
    // Deterministic across calls.
    expect(cullLights(lights, 0, 0, 2)).toEqual(out);
  });

  it('always keeps the sun regardless of position', () => {
    const lights = [sunGpuLight(0.5), pt(9000, 9000), pt(8000, 8000), pt(7000, 7000)];
    const out = cullLights(lights, 0, 0, 1);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe(1);
  });
});

describe('packLights (RENDER-01)', () => {
  it('packs into flat arrays sized to MAX_LIGHTS and clamps the count', () => {
    const lights = Array.from({ length: MAX_LIGHTS + 5 }, (_, i) =>
      pointToGpuLight({ x: i, y: 0, radius: 10, color: 0x804020 }, 30, 1),
    );
    const p = packLights(lights);
    expect(p.count).toBe(MAX_LIGHTS);
    expect(p.pos).toHaveLength(2 * MAX_LIGHTS);
    expect(p.color).toHaveLength(3 * MAX_LIGHTS);
    expect(p.kind).toHaveLength(MAX_LIGHTS);
    // First light's data lands at the right offsets.
    expect(p.pos[0]).toBe(0);
    expect(p.color[0]).toBeCloseTo(128 / 255, 5);
    expect(p.color[1]).toBeCloseTo(64 / 255, 5);
    expect(p.color[2]).toBeCloseTo(32 / 255, 5);
  });
});
