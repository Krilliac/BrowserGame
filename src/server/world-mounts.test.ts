import { describe, expect, it } from 'vitest';
import { initGameDb } from './content.js';
import { areaWorld, npcPos } from './test-support.js';
import type { PlayerSave } from './world.js';

initGameDb(':memory:');

/**
 * Mounts: owned, persistent travel-speed boosts bought from the town Stablemaster (Hoss). Buying is
 * proximity- + gold-gated; toggling folds the mount's speed multiplier into the player's move speed
 * (reported via playerStats().moveMul); ownership + the active mount persist across area crossings.
 */
function townWithStable(): { w: ReturnType<typeof areaWorld>; id: number } {
  const w = areaWorld('town');
  w.populateNpcs('town');
  const id = w.spawn('Rider');
  const stable = npcPos('town', 'stable');
  w.teleport(id, stable.x, stable.y);
  w.giveItem(id, 'gold', 30000);
  return { w, id };
}

describe('mounts', () => {
  it('buys a mount at the Stablemaster, deducting gold', () => {
    const { w, id } = townWithStable();
    const goldBefore = w.playerStats(id)!.gold;
    const msg = w.buyMount(id, 'dustback_mule');
    expect(msg).toContain('Bought');
    expect(w.playerStats(id)!.gold).toBeLessThan(goldBefore);
  });

  it('refuses to buy away from a Stablemaster (proximity-gated)', () => {
    const { w, id } = townWithStable();
    w.teleport(id, 50, 50); // nowhere near Hoss
    const before = w.playerStats(id)!.gold;
    expect(w.buyMount(id, 'dustback_mule')).toContain('Stablemaster');
    expect(w.playerStats(id)!.gold).toBe(before); // not charged
  });

  it('riding a mount raises move speed; dismounting restores it', () => {
    const { w, id } = townWithStable();
    const baseMul = w.playerStats(id)!.moveMul;
    w.buyMount(id, 'war_courser');
    w.toggleMount(id, 'war_courser');
    expect(w.playerStats(id)!.moveMul).toBeGreaterThan(baseMul);
    w.toggleMount(id); // dismount
    expect(w.playerStats(id)!.moveMul).toBeCloseTo(baseMul, 5);
  });

  it('cannot ride a mount you do not own', () => {
    const { w, id } = townWithStable();
    const baseMul = w.playerStats(id)!.moveMul;
    expect(w.toggleMount(id, 'dread_destrier')).toContain("don't own");
    expect(w.playerStats(id)!.moveMul).toBeCloseTo(baseMul, 5);
  });

  it('owned mounts and the active mount persist across an area crossing', () => {
    const { w, id } = townWithStable();
    w.buyMount(id, 'dustback_mule');
    w.toggleMount(id, 'dustback_mule');
    const save: PlayerSave = w.exportPlayer(id)!;

    const dest = areaWorld('wilderness');
    dest.importPlayer(id, save, 200, 200);
    const lines = dest.mountStatus(id).join('\n');
    expect(lines).toContain('Dustback Mule');
    expect(lines).toContain('(riding)'); // still mounted after the crossing
    expect(dest.playerStats(id)!.moveMul).toBeGreaterThan(1);
  });
});
