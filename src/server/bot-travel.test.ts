import { describe, expect, it } from 'vitest';
import { newBotState, stepBot, type BotView } from './bot-brain.js';

/**
 * Bots travel toward a goal the host sets (a portal to the next zone), fighting only what's truly
 * in the way so they keep making progress out toward endgame instead of grinding one spot forever.
 */
function baseView(over: Partial<BotView> = {}): BotView {
  return {
    self: { x: 200, y: 200, hp: 100, maxHp: 100, mana: 50, maxMana: 50, level: 5, dead: false },
    abilities: [
      { id: 'slash', kind: 'melee', damage: 10, range: 40, manaCost: 0, cooldownReady: true },
    ],
    mobs: [],
    items: [],
    width: 1600,
    height: 1200,
    potions: { health: 3, mana: 3 },
    ...over,
  };
}

describe('bot travel toward a goal', () => {
  it('walks toward the goal when no mob is in the way', () => {
    const s = newBotState(1);
    const d = stepBot(baseView({ goal: { x: 1500, y: 200 } }), s, 0); // goal due east
    expect(d.input.right).toBe(true);
    expect(d.input.left).toBe(false);
  });

  it('still fights a mob blocking the path, then resumes toward the goal', () => {
    const s = newBotState(2);
    // A mob right next to the bot, between it and the goal.
    const blocked = stepBot(
      baseView({ goal: { x: 1500, y: 200 }, mobs: [{ id: 1, x: 230, y: 200, hp: 20 }] }),
      s,
      0,
    );
    expect(blocked.cast?.ability).toBe('slash'); // engages the blocker

    // With the path clear, it heads for the goal again.
    const clear = stepBot(baseView({ goal: { x: 1500, y: 200 } }), s, 100);
    expect(clear.input.right).toBe(true);
  });

  it('ignores a distant mob while travelling (keeps progressing)', () => {
    const s = newBotState(3);
    // A mob 400px away — within free-roam engage range but beyond the travel-fight range.
    const d = stepBot(
      baseView({ goal: { x: 1500, y: 200 }, mobs: [{ id: 1, x: 600, y: 200, hp: 20 }] }),
      s,
      0,
    );
    expect(d.cast).toBeUndefined(); // doesn't detour
    expect(d.input.right).toBe(true); // keeps heading to the goal
  });
});
