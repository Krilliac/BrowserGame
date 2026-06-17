import { describe, it, expect, beforeAll } from 'vitest';
import { initGameDb } from './content.js';
import { editorDebugInfo } from './editor-debug.js';

describe('editorDebugInfo', () => {
  beforeAll(() => {
    // Seed a fresh in-memory content DB so the snapshot reflects the built-in content.
    initGameDb(':memory:');
  });

  it('reports positive content counts', () => {
    const info = editorDebugInfo();
    expect(info.areas).toBeGreaterThan(0);
    expect(info.items).toBeGreaterThan(0);
    expect(info.mobTemplates).toBeGreaterThan(0);
    expect(info.abilities).toBeGreaterThan(0);
  });

  it('lists summonable and tameable creatures from the mob templates', () => {
    const info = editorDebugInfo();
    expect(info.summonableCreatures).toContain('skeleton_warrior');
    expect(info.tameableCreatures).toContain('wolf');
  });

  it('lists non-safe areas as pvp areas', () => {
    const info = editorDebugInfo();
    expect(info.pvpAreas.some((p) => p.areaId === 'voidmarch')).toBe(true);
  });

  it('reports an npc count per area', () => {
    const info = editorDebugInfo();
    expect(info.npcsByArea.length).toBe(info.areas);
    for (const entry of info.npcsByArea) {
      expect(entry.count).toBeGreaterThanOrEqual(0);
    }
  });
});
