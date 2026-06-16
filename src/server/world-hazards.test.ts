import { describe, expect, it, beforeEach } from 'vitest';
import { initGameDb, getDb, getContent, reloadContent } from './content.js';
import { World } from './world.js';

initGameDb(':memory:');

/**
 * Environmental hazard zones: a `poison_pool` / `lava_crack` decor prop is a DoT zone — standing in
 * its radius re-applies a short damage-over-time debuff each tick. Tests inject a hazard prop into an
 * area, reload content, and stand a player in (and out of) it. No mobs are populated, so the only
 * damage source is the hazard itself.
 */
describe('hazard zones (poison pools / lava cracks)', () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM decor WHERE area_id = ?').run('wilderness');
    db.prepare('INSERT INTO decor (area_id,kind,x,y) VALUES (?,?,?,?)').run(
      'wilderness',
      'poison_pool',
      200,
      200,
    );
    reloadContent();
  });

  /** Build a wilderness world (no mobs) and return it plus the scaled hazard position. */
  function hazardWorld(): { w: World; hx: number; hy: number } {
    const area = getContent().area('wilderness')!;
    const pool = (area.decor ?? []).find((d) => d.kind === 'poison_pool')!;
    const w = new World(area.width, area.height, area.spawn, undefined, 'wilderness');
    return { w, hx: pool.x, hy: pool.y };
  }

  it('drains a player standing in the pool over time', () => {
    const { w, hx, hy } = hazardWorld();
    const id = w.spawn('Wader');
    w.teleport(id, hx, hy);
    const before = w.playerStats(id)!.hp;
    for (let i = 0; i < 5; i++) w.tick(0.4); // 2s of standing in the venom
    expect(w.playerStats(id)!.hp).toBeLessThan(before);
  });

  it('leaves a player standing clear of the pool unharmed', () => {
    const { w, hx, hy } = hazardWorld();
    const id = w.spawn('Careful');
    w.teleport(id, hx + 300, hy + 300); // well outside the hazard radius
    const before = w.playerStats(id)!.hp;
    for (let i = 0; i < 5; i++) w.tick(0.4);
    expect(w.playerStats(id)!.hp).toBe(before); // full HP, capped by regen — no DoT
  });

  it('spares a god-mode player (DoT routes through the protected damage path)', () => {
    const { w, hx, hy } = hazardWorld();
    const id = w.spawn('Immortal');
    w.teleport(id, hx, hy);
    w.toggleGod(id);
    const before = w.playerStats(id)!.hp;
    for (let i = 0; i < 5; i++) w.tick(0.4);
    expect(w.playerStats(id)!.hp).toBe(before);
  });
});
