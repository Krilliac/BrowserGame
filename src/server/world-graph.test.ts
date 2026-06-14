import { describe, expect, it } from 'vitest';
import { initGameDb, getContent } from './content.js';
import { DUNGEONS } from '../shared/areas.js';

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

  it('ships the overworld, the dungeons, the rift, the frontier, and the den shell', () => {
    expect([...ids].sort()).toEqual([
      'abyssal_throne',
      'ashveil_desert',
      'blighted_spire',
      'crypt',
      'den',
      'duskhaven',
      'forgotten_catacombs',
      'frostpeak',
      'frozen_vault',
      'grimfrost_barrow',
      'hollowroot',
      'howling_barrens',
      'infernal_forge',
      'marsh',
      'mines',
      'rift',
      'shattered_causeway',
      'sundered_wastes',
      'sunken_pass',
      'the_unmade_court',
      'town',
      'vhalreth',
      'voidmarch',
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
    // BFS from town must reach every area (the spine + spurs are actually connected). Two
    // exceptions enter without inbound portals: the rift (opened by the Riftkeeper) and the
    // den (entered via per-instance hatches) — but their own exits must still lead home.
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
    expect([...seen].sort()).toEqual([...ids].filter((id) => id !== 'rift' && id !== 'den').sort());
    expect(c.area('rift')!.portals.map((p) => p.toArea)).toEqual(['town']);
    expect(c.area('den')!.portals).toHaveLength(1); // the climb-out (rerouted per instance)
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

  it('the caves are a real dungeon and the town has enterable houses', () => {
    // Hollowroot Caverns: the new "caves" branch, a procedural dungeon off Gloomwood.
    expect(c.isDungeon('hollowroot')).toBe(true);
    expect(c.area('hollowroot')?.name).toBe('Hollowroot Caverns');
    const d = DUNGEONS.hollowroot!;
    const refs = [...d.pool, d.boss, ...(d.miniBoss ? [d.miniBoss] : [])];
    for (const id of refs) expect(c.mobTemplate(id), id).toBeDefined();
    // Enterable houses are footprint decor (x,y → x2,y2) the renderer fades the roof of.
    const houses = (c.area('town')?.decor ?? []).filter((p) => p.kind === 'house');
    expect(houses.length).toBeGreaterThan(0);
    expect(houses.every((h) => typeof h.x2 === 'number' && typeof h.y2 === 'number')).toBe(true);
  });

  it('new tiers exist: a quest for each new boss and reachable high-level content', () => {
    const questMobs = new Set(c.quests().map((q) => q.targetMob));
    expect(questMobs.has('fenwitch')).toBe(true);
    expect(questMobs.has('forge_tyrant')).toBe(true);
    expect(questMobs.has('pale_king')).toBe(true);
    expect(c.mobTemplate('pale_king')!.level).toBe(20);
    // Act 2 (the Sundered Wastes) raises the ceiling: the Unmaker is its quest boss.
    expect(questMobs.has('xalthirun')).toBe(true);
    expect(c.mobTemplate('xalthirun')!.level).toBe(26);
    // Act 3 (the Blighted Spire) is the current ceiling: the Throne-Tyrant.
    expect(questMobs.has('throne_tyrant')).toBe(true);
    expect(c.mobTemplate('throne_tyrant')!.level).toBe(32);
  });
});
