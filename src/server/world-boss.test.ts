import { describe, expect, it } from 'vitest';
import { World } from './world.js';
import { initGameDb } from './content.js';
import { BOSS_SCRIPTS } from './boss-scripts.js';

initGameDb(':memory:');

/**
 * Apex bosses run a scripted phase loop layered over their brawling AI. These pin the world-side
 * wiring: a wounded boss shouts and summons its honor guard; an unblooded one just brawls.
 */
describe('boss phase scripts', () => {
  it('the authored scripts cover the two apex bosses', () => {
    expect(Object.keys(BOSS_SCRIPTS).sort()).toEqual(['athraxis', 'nyxathor']);
  });

  it('a wounded Nyxathor shouts and summons adds; the player hears it', () => {
    const w = new World(
      1500,
      1300,
      { x: 750, y: 650 },
      undefined,
      'abyssal_throne',
      undefined,
      0,
      7,
    );
    const id = w.spawn('Challenger', { x: 750, y: 650 });
    w.toggleGod(id); // survive the fight while we watch the script run
    w.setLevel(id, 80); // overwhelming power so the apex drops fast and deterministically
    w.giveItem(id, 'tome_meteor', 1);
    w.learn(id, 'tome_meteor');
    w.spawnMobAt(id, 'nyxathor');

    // Meteor is ranged + burns, so we keep pressure on the kiting charger while watching the
    // whole fight for its scripted shouts (P1+) and summons (below 50% HP) — one long window so
    // the assertion never hinges on exactly which tick a phase step lands.
    const boss = () => w.snapshot().find((e) => e.kind === 'mob' && e.name.includes('Nyxathor'));
    let shouted = false;
    let addsAppeared = false;
    const startMobs = w.snapshot().filter((e) => e.kind === 'mob').length;
    for (let i = 0; i < 5000 && boss(); i++) {
      const b = boss();
      if (b && b.hp > b.maxHp * 0.12) w.cast(id, 'meteor', b.x - 750, b.y - 650);
      w.tick(0.05);
      if (w.drainNotices().some((n) => /NYXATHOR:/i.test(n.text))) shouted = true;
      if (w.snapshot().filter((e) => e.kind === 'mob').length > startMobs) addsAppeared = true;
      if (shouted && addsAppeared) break;
    }
    expect(shouted).toBe(true); // the boss taunts
    expect(addsAppeared).toBe(true); // and calls its guard
  });

  it('an unblooded boss just brawls (no script actions at full HP)', () => {
    const w = new World(
      1500,
      1300,
      { x: 750, y: 650 },
      undefined,
      'the_unmade_court',
      undefined,
      0,
      3,
    );
    const id = w.spawn('Watcher', { x: 750, y: 650 });
    w.toggleGod(id);
    w.spawnMobAt(id, 'athraxis');
    for (let i = 0; i < 20; i++) w.tick(0.05);
    // Nothing shouted while it's at full health — phases are HP-gated.
    expect(w.drainNotices().some((n) => /ATHRAXIS:/i.test(n.text))).toBe(false);
  });
});
