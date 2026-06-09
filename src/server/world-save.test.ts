import { describe, expect, it } from 'vitest';
import { World } from './world.js';
import { initGameDb } from './content.js';

initGameDb(':memory:');

describe('player save / transfer', () => {
  it('round-trips persistent state across worlds (the portal-transfer fix)', () => {
    const a = new World();
    const id = a.spawn('Hero');
    a.setLevel(id, 5);
    a.addXp(id, 50);
    a.giveItem(id, 'iron_sword', 1);
    a.equip(id, 'iron_sword');
    a.giveItem(id, 'wolf_pelt', 3);

    const save = a.exportPlayer(id);
    expect(save).toBeDefined();

    const b = new World();
    b.importPlayer(id, save!, 100, 200);
    const s = b.playerStats(id)!;
    expect(s.level).toBeGreaterThanOrEqual(5);
    expect(s.weapon).toBe('iron_sword');
    expect(s.loot.wolf_pelt).toBe(3);
    expect(s.power).toBe(a.playerStats(id)!.power);
    expect({ x: s.x, y: s.y }).toEqual({ x: 100, y: 200 });
  });
});

describe('quests', () => {
  it('accepts quests, reports progress, and rejects duplicates/unknowns', () => {
    const w = new World();
    const id = w.spawn('Q');
    expect(w.acceptQuest(id, 'wolf_cull')).toContain('accepted');
    expect(w.acceptQuest(id, 'wolf_cull')).toContain('Already');
    expect(w.acceptQuest(id, 'nope')).toContain('No such quest');
    expect(w.questLog(id).some((l) => l.includes('Wolf Cull'))).toBe(true);
  });
});
