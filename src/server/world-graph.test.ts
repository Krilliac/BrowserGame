import { describe, expect, it } from 'vitest';
import { initGameDb, getContent } from './content.js';

initGameDb(':memory:');

/**
 * Content-integrity tests for the expanded world. These guard the data wiring that has no
 * compiler to catch it: every portal must point at a real area, every spawn/loot/quest must
 * reference a real mob/item, and arrival points must not sit inside a portal (which would
 * bounce the player straight back).
 */
describe('world graph integrity', () => {
  const c = getContent();
  const areas = c.areas();
  const ids = new Set(areas.map((a) => a.id));

  it('ships the six overworld areas plus the four dungeons', () => {
    expect([...ids].sort()).toEqual([
      'crypt',
      'forgotten_catacombs',
      'frostpeak',
      'frozen_vault',
      'infernal_forge',
      'marsh',
      'mines',
      'town',
      'wilderness',
      'writhing_hive',
    ]);
  });

  it('every portal targets a real area, and the new areas are reachable from town', () => {
    for (const a of areas) {
      for (const p of a.portals) {
        expect(ids.has(p.toArea), `${a.id} → ${p.toArea}`).toBe(true);
      }
    }
    // BFS from town must reach every area (the spine + spurs are actually connected).
    const seen = new Set<string>(['town']);
    const queue = ['town'];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const p of c.area(cur)!.portals) {
        if (!seen.has(p.toArea)) {
          seen.add(p.toArea);
          queue.push(p.toArea);
        }
      }
    }
    expect([...seen].sort()).toEqual([...ids].sort());
  });

  it('arrival spawns are clear of every portal rect in the destination area', () => {
    for (const a of areas) {
      for (const p of a.portals) {
        const dest = c.area(p.toArea)!;
        for (const dp of dest.portals) {
          const inside =
            p.toSpawn.x >= dp.rect.x &&
            p.toSpawn.x <= dp.rect.x + dp.rect.w &&
            p.toSpawn.y >= dp.rect.y &&
            p.toSpawn.y <= dp.rect.y + dp.rect.h;
          expect(inside, `${a.id}→${p.toArea} spawn lands in a portal`).toBe(false);
        }
      }
    }
  });

  it('every area-mob spawn references a real mob template', () => {
    for (const a of areas) {
      for (const s of c.areaMobs(a.id)) {
        expect(c.mobTemplate(s.templateId), `${a.id}: ${s.templateId}`).toBeDefined();
      }
    }
  });

  it('every quest targets a real mob and its reward item (if any) exists', () => {
    for (const q of c.quests()) {
      if (q.targetMob) expect(c.mobTemplate(q.targetMob), q.id).toBeDefined();
      if (q.rewardItem) expect(c.item(q.rewardItem), q.id).toBeDefined();
    }
  });

  it('new tiers exist: a quest for each new boss and reachable high-level content', () => {
    const questMobs = new Set(c.quests().map((q) => q.targetMob));
    expect(questMobs.has('fenwitch')).toBe(true);
    expect(questMobs.has('forge_tyrant')).toBe(true);
    expect(questMobs.has('pale_king')).toBe(true);
    // The Pale King is the level ceiling of the shipped content.
    expect(c.mobTemplate('pale_king')!.level).toBe(20);
  });
});
