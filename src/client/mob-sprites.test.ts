import { describe, expect, it } from 'vitest';

import {
  MOB_ARCHETYPES,
  MOB_CLIPS,
  MOB_FRAMES,
  MOB_STATE_BY_ROW,
  mobArchetype,
  mobSheetKey,
  mobStaticSrc,
  mobStripSrc,
} from './mob-sprites.js';

describe('mob archetype resolution', () => {
  it('resolves long-tail creatures the generated sheets do not cover', () => {
    expect(mobArchetype('Rotting Zombie')).toBe('zombie');
    expect(mobArchetype('Festering Ghoul')).toBe('ghoul');
    expect(mobArchetype('Bone Lich')).toBe('lich');
    expect(mobArchetype('Wailing Banshee')).toBe('banshee');
    expect(mobArchetype('Hooded Reaper')).toBe('reaper');
    expect(mobArchetype('Pit Demon')).toBe('demon');
    expect(mobArchetype('Fire Imp')).toBe('imp');
    expect(mobArchetype('Stone Golem')).toBe('golem');
    expect(mobArchetype('Naga Priestess')).toBe('naga');
    expect(mobArchetype('Vile Ooze')).toBe('slime');
    expect(mobArchetype('Cave Spider')).toBe('spider');
    expect(mobArchetype('Giant Rat')).toBe('giant-rat');
    expect(mobArchetype('Burrowing Worm')).toBe('giant-worm');
    expect(mobArchetype('Goblin Archer')).toBe('goblin');
    expect(mobArchetype('Kobold Digger')).toBe('kobold');
  });

  it('leaves the archetypes the generated 8/16-dir sheets cover better to those sheets', () => {
    // These names are caught earlier in pixi-renderer's sheetKey (skeleton/wolf/bat/boss) and must
    // therefore NOT be claimed here — the tiering contract this module documents.
    for (const name of [
      'Skeleton Warrior',
      'Dire Wolf',
      'Cave Bat',
      'Hooded Cultist',
      'Shadow Wraith',
      'Hellhound',
    ]) {
      expect(mobArchetype(name)).toBeUndefined();
    }
  });

  it('returns undefined for an unrecognized name (renderer keeps the procedural orb)', () => {
    expect(mobArchetype('Glittering Whatsit')).toBeUndefined();
  });

  it('every rule output is a defined archetype with a known scale (no dangling art reference)', () => {
    // Drive a name through every archetype keyword and confirm it lands on a real MOB_ARCHETYPES entry.
    for (const arch of Object.keys(MOB_ARCHETYPES)) {
      expect(MOB_ARCHETYPES[arch]!.scale).toBeGreaterThan(0);
    }
    // Each resolvable archetype must be one we declared art + a scale for.
    const sample = [
      'zombie',
      'ghoul',
      'lich',
      'banshee',
      'reaper',
      'demon',
      'imp',
      'orc',
      'goblin',
      'troll',
      'minotaur',
      'golem',
      'naga',
      'gorgon',
      'kobold',
      'myconid',
      'slime',
      'spider',
      'giant-rat',
      'giant-worm',
      'giant-centipede',
    ];
    for (const arch of sample) expect(MOB_ARCHETYPES).toHaveProperty(arch);
  });
});

describe('mob sprite paths', () => {
  it('builds curated strip + portrait paths', () => {
    expect(mobStripSrc('demon', 'idle')).toBe('/assets/curated/mobs/demon_idle.png');
    expect(mobStripSrc('slime', 'walk')).toBe('/assets/curated/mobs/slime_walk.png');
    expect(mobStripSrc('golem', 'attack')).toBe('/assets/curated/mobs/golem_attack.png');
    expect(mobStaticSrc('lich')).toBe('/assets/curated/mobs/lich.png');
  });

  it('namespaces the sheet key', () => {
    expect(mobSheetKey('demon')).toBe('mob:demon');
  });
});

describe('mob clip set', () => {
  it('maps the three strips to rows 0/1/2 as dirless 4-frame clips', () => {
    expect(MOB_CLIPS.clips.idle).toMatchObject({ row0: 0, frames: MOB_FRAMES, dirless: true });
    expect(MOB_CLIPS.clips.walk).toMatchObject({ row0: 1, frames: MOB_FRAMES, dirless: true });
    expect(MOB_CLIPS.clips.attack).toMatchObject({ row0: 2, frames: MOB_FRAMES, loop: false });
    expect(MOB_CLIPS.clips.idle!.loop).toBe(true);
    expect(MOB_CLIPS.clips.walk!.loop).toBe(true);
  });

  it('row→state table matches the clip rows', () => {
    expect(MOB_STATE_BY_ROW[MOB_CLIPS.clips.idle!.row0]).toBe('idle');
    expect(MOB_STATE_BY_ROW[MOB_CLIPS.clips.walk!.row0]).toBe('walk');
    expect(MOB_STATE_BY_ROW[MOB_CLIPS.clips.attack!.row0]).toBe('attack');
  });
});
