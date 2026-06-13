import { describe, expect, it } from 'vitest';
import { newBotState, stepBot, type BotAbilityView, type BotView } from './bot-brain.js';

// --- Test fixtures --------------------------------------------------------------------

const arrow: BotAbilityView = {
  id: 'arrow',
  kind: 'projectile',
  damage: 15,
  range: 620,
  manaCost: 0,
  cooldownReady: true,
};
const slash: BotAbilityView = {
  id: 'slash',
  kind: 'melee',
  damage: 14,
  range: 78,
  manaCost: 0,
  cooldownReady: true,
};
const fireball: BotAbilityView = {
  id: 'fireball',
  kind: 'projectile',
  damage: 26,
  range: 480,
  manaCost: 18,
  cooldownReady: true,
};

function makeView(over: Partial<BotView> = {}): BotView {
  return {
    self: { x: 500, y: 500, hp: 100, maxHp: 100, mana: 100, maxMana: 100, level: 1, dead: false },
    abilities: [arrow],
    mobs: [],
    items: [],
    width: 1000,
    height: 1000,
    potions: { health: 0, mana: 0 },
    ...over,
  };
}

describe('bot-brain', () => {
  it('flees directly away from the nearest mob below 25% hp with no potions', () => {
    const state = newBotState(1);
    // Mob is up-and-left of the bot, so fleeing means moving down-and-right.
    const view = makeView({
      self: { x: 500, y: 500, hp: 20, maxHp: 100, mana: 100, maxMana: 100, level: 1, dead: false },
      mobs: [{ id: 1, x: 400, y: 400, hp: 50 }],
      potions: { health: 0, mana: 0 },
    });
    const d = stepBot(view, state, 0);
    expect(state.mode).toBe('flee');
    expect(d.cast).toBeUndefined();
    expect(d.input.down).toBe(true);
    expect(d.input.right).toBe(true);
    expect(d.input.up).toBe(false);
    expect(d.input.left).toBe(false);
  });

  it('quaffs a health potion below 30% hp when one is held (instead of fleeing)', () => {
    const state = newBotState(1);
    const view = makeView({
      self: { x: 500, y: 500, hp: 25, maxHp: 100, mana: 100, maxMana: 100, level: 1, dead: false },
      mobs: [{ id: 1, x: 520, y: 500, hp: 50 }],
      potions: { health: 2, mana: 0 },
    });
    const d = stepBot(view, state, 0);
    expect(d.usePotion).toBe('health');
    expect(d.cast).toBeUndefined();
  });

  it('targets and casts at the nearest mob with a range-appropriate ability, aimed at it', () => {
    const state = newBotState(1);
    const view = makeView({
      // Two mobs; the nearer is to the right at distance 200 (in arrow range).
      mobs: [
        { id: 1, x: 700, y: 500, hp: 40 },
        { id: 2, x: 500, y: 200, hp: 40 },
      ],
      abilities: [arrow],
    });
    const d = stepBot(view, state, 0);
    expect(state.mode).toBe('fight');
    expect(d.cast?.ability).toBe('arrow');
    // Aimed at the nearer mob (positive dx, ~zero dy).
    expect(d.cast?.dx).toBeGreaterThan(0);
    expect(Math.abs(d.cast?.dy ?? 1)).toBeLessThan(1e-9);
  });

  it('picks the higher-damage ability when two are both in range and affordable', () => {
    const state = newBotState(1);
    const view = makeView({
      // Distance 100 — both arrow (range 620) and fireball (range 480) reach.
      mobs: [{ id: 1, x: 600, y: 500, hp: 80 }],
      abilities: [arrow, fireball],
    });
    const d = stepBot(view, state, 0);
    expect(d.cast?.ability).toBe('fireball'); // 26 dmg > 15 dmg
  });

  it('closes to melee range before swinging a melee ability', () => {
    const state = newBotState(1);
    // Distance 300 with only a melee ability (reach 78): should walk toward, not cast yet.
    const view = makeView({
      mobs: [{ id: 1, x: 800, y: 500, hp: 80 }],
      abilities: [slash],
    });
    const d = stepBot(view, state, 0);
    expect(d.cast).toBeUndefined();
    expect(d.input.right).toBe(true);
  });

  it('walks toward a nearby item when there is no mob to fight', () => {
    const state = newBotState(1);
    const view = makeView({
      mobs: [],
      items: [{ id: 9, x: 560, y: 500 }],
    });
    const d = stepBot(view, state, 0);
    expect(state.mode).toBe('wander');
    expect(d.input.right).toBe(true);
    expect(d.cast).toBeUndefined();
  });

  it('steers away from a wall when hugging a bound', () => {
    const state = newBotState(1);
    // Force a known wander heading pointing further into the left wall (angle = π → dirX -1).
    state.wanderAngle = Math.PI;
    state.wanderUntil = Number.MAX_SAFE_INTEGER; // keep the heading fixed
    const view = makeView({
      self: { x: 20, y: 500, hp: 100, maxHp: 100, mana: 100, maxMana: 100, level: 1, dead: false },
    });
    const d = stepBot(view, state, 0);
    // Near the left bound (x=20 < margin 80): the steer-back nudge cancels the leftward push.
    expect(d.input.left).toBe(false);
  });

  it('is deterministic for fixed inputs (same seed → identical decisions over time)', () => {
    const a = newBotState(42);
    const b = newBotState(42);
    const view = makeView({ mobs: [], items: [] });
    for (let t = 0; t < 5000; t += 250) {
      const da = stepBot(makeView(view), a, t);
      const db = stepBot(makeView(view), b, t);
      expect(da).toEqual(db);
    }
  });

  it('stops fleeing once hp recovers above 60%', () => {
    const state = newBotState(1);
    const view = makeView({
      self: { x: 500, y: 500, hp: 20, maxHp: 100, mana: 100, maxMana: 100, level: 1, dead: false },
      mobs: [{ id: 1, x: 400, y: 400, hp: 50 }],
      potions: { health: 0, mana: 0 },
    });
    // Drop below threshold → enters flee.
    stepBot(view, state, 0);
    expect(state.mode).toBe('flee');

    // Hp climbs back over 60% → leaves flee and re-engages (mob still nearby → fight).
    const recovered = makeView({
      self: { x: 500, y: 500, hp: 70, maxHp: 100, mana: 100, maxMana: 100, level: 1, dead: false },
      mobs: [{ id: 1, x: 400, y: 400, hp: 50 }],
      potions: { health: 0, mana: 0 },
    });
    const d = stepBot(recovered, state, 1000);
    expect(state.mode).toBe('fight');
    expect(d.cast).toBeDefined();
  });
});
