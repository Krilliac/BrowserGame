import { describe, expect, it } from 'vitest';
import { initGameDb, getDb, reloadContent } from './content.js';
import { areaWorld } from './test-support.js';

initGameDb(':memory:');

/**
 * PvP zones: player abilities can harm other players only where the area's rule allows — 'safe'
 * (never), 'contested' (both must /pvp opt in), 'hostile' (free-for-all). 'voidmarch' is seeded
 * contested; 'town' is safe. Damage is scaled down (PVP_DAMAGE_SCALE) so it never one-shots.
 */
function duel(area: string): { w: ReturnType<typeof areaWorld>; a: number; v: number } {
  const w = areaWorld(area);
  const a = w.spawn('Attacker');
  const v = w.spawn('Victim');
  w.teleport(a, 1000, 1000);
  w.teleport(v, 1000, 1040); // 40px south — inside slash range (78)
  return { w, a, v };
}

/** Cast slash straight south (toward the victim) and report the victim's HP delta. */
function slashSouth(w: ReturnType<typeof areaWorld>, a: number, v: number): number {
  const before = w.playerStats(v)!.hp;
  w.cast(a, 'slash', 0, 1);
  return before - w.playerStats(v)!.hp;
}

describe('PvP zones', () => {
  it('does no player damage in a safe area, even when both are flagged', () => {
    const { w, a, v } = duel('town');
    w.togglePvp(a);
    w.togglePvp(v);
    expect(slashSouth(w, a, v)).toBe(0);
  });

  it('contested: harms only when BOTH players have opted in', () => {
    // Only the attacker flagged → no damage.
    {
      const { w, a, v } = duel('voidmarch');
      w.togglePvp(a);
      expect(slashSouth(w, a, v)).toBe(0);
    }
    // Both flagged → the victim takes (scaled) damage.
    {
      const { w, a, v } = duel('voidmarch');
      w.togglePvp(a);
      w.togglePvp(v);
      expect(slashSouth(w, a, v)).toBeGreaterThan(0);
    }
  });

  it('hostile: harms without any opt-in', () => {
    getDb()
      .prepare("INSERT OR REPLACE INTO area_pvp (area_id, rule) VALUES ('town', 'hostile')")
      .run();
    reloadContent();
    const { w, a, v } = duel('town');
    expect(slashSouth(w, a, v)).toBeGreaterThan(0); // no flags needed
    // Reset so other suites see town as safe again.
    getDb().prepare("DELETE FROM area_pvp WHERE area_id = 'town'").run();
    reloadContent();
  });

  it('a god-mode victim is immune even in a PvP zone', () => {
    const { w, a, v } = duel('voidmarch');
    w.togglePvp(a);
    w.togglePvp(v);
    w.toggleGod(v);
    expect(slashSouth(w, a, v)).toBe(0);
  });

  it('a player projectile strikes a flagged enemy in a contested zone', () => {
    const w = areaWorld('voidmarch');
    const a = w.spawn('Caster');
    const v = w.spawn('Target');
    w.togglePvp(a);
    w.togglePvp(v);
    w.giveItem(a, 'tome_fireball', 1);
    w.learn(a, 'tome_fireball');
    w.teleport(a, 1000, 1000);
    w.teleport(v, 1000, 1120); // south, in the projectile's path
    const before = w.playerStats(v)!.hp;
    w.cast(a, 'fireball', 0, 1);
    for (let i = 0; i < 12; i++) w.tick(0.05); // let the bolt travel into the target
    expect(w.playerStats(v)!.hp).toBeLessThan(before);
  });
});
