import { describe, expect, it } from 'vitest';
import { initGameDb } from './content.js';
import { areaWorld } from './test-support.js';

initGameDb(':memory:');

/**
 * SEC-103: a player's wallet is capped at MAX_GOLD (1e12) on every credit, so a very long-lived
 * character can't accumulate into float-imprecision territory near 2^53 where the `gold < price`
 * checks that gate purchases/withdrawals would start lying. Driven through the mail-collect credit
 * path (mailDeliver → creditGold), which has no per-op quantity clamp of its own.
 */
describe('wallet cap (SEC-103)', () => {
  it('clamps gold credits to MAX_GOLD', () => {
    const w = areaWorld('town');
    const pid = w.spawn('Tycoon');
    // 1100 × 1e9 = 1.1T of credits — would blow past the cap without clamping.
    for (let i = 0; i < 1100; i++) w.mailDeliver(pid, 1_000_000_000, null);
    expect(w.playerStats(pid)!.gold).toBe(1_000_000_000_000); // capped at MAX_GOLD (1T)
  });

  it('still credits normally below the cap', () => {
    const w = areaWorld('town');
    const pid = w.spawn('Saver');
    const before = w.playerStats(pid)!.gold;
    w.giveItem(pid, 'gold', 250);
    expect(w.playerStats(pid)!.gold).toBe(before + 250);
  });
});
