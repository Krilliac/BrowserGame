import { describe, expect, it } from 'vitest';

import { elementStrip, projectileStrip } from './projectile-fx.js';

describe('elementStrip (color → spell strip)', () => {
  it('classifies the --fx-* palette colors', () => {
    expect(elementStrip('#ff8a3a')).toBe('fireball'); // --fx-fire
    expect(elementStrip('#7fc4ff')).toBe('frost'); // --fx-frost (icy light-blue)
    expect(elementStrip('#3b6fd2')).toBe('water'); // deep mana blue
    expect(elementStrip('#b07ae8')).toBe('arcane'); // --fx-arcane (violet)
  });

  it('returns null for elements with no matching strip (keep the orb)', () => {
    expect(elementStrip('#aef07a')).toBeNull(); // --fx-poison (green)
    expect(elementStrip('#ffe9a8')).toBeNull(); // --fx-holy (pale gold)
    expect(elementStrip(undefined)).toBeNull();
    expect(elementStrip('not-a-color')).toBeNull();
    expect(elementStrip('rgb(1,2,3)')).toBeNull();
  });
});

describe('projectileStrip (ability id + color)', () => {
  it('prefers an exact ability-id family over the color', () => {
    expect(projectileStrip('fireball', '#000000')).toBe('fireball');
    expect(projectileStrip('frostlance', '#000000')).toBe('frost');
    expect(projectileStrip('glacierspike', undefined)).toBe('frost');
    expect(projectileStrip('rocksling', undefined)).toBe('rock');
    expect(projectileStrip('firebomb', undefined)).toBe('firebomb');
    expect(projectileStrip('maelstrom_orb', undefined)).toBe('arcane');
  });

  it('falls back to color classification for unknown ids', () => {
    expect(projectileStrip('mystery_spell', '#ff8a3a')).toBe('fireball');
    expect(projectileStrip('mystery_spell', '#3b6fd2')).toBe('water');
    expect(projectileStrip(undefined, '#b07ae8')).toBe('arcane');
  });

  it('returns null (orb) for a green/holy projectile with an unknown id', () => {
    expect(projectileStrip('venom', '#aef07a')).toBeNull();
    expect(projectileStrip(undefined, undefined)).toBeNull();
  });
});
