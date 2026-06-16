import { describe, expect, it } from 'vitest';
import { instanceTitle, RARITY } from '../shared/items.js';
import { buildGemTooltip, buildItemTooltip, type TooltipResolvers } from './item-tooltip.js';
import type { ItemInstance } from '../shared/items.js';

// ---------------------------------------------------------------------------
// Shared stub resolvers
// ---------------------------------------------------------------------------

const BASE_RESOLVERS: TooltipResolvers = {
  itemInfo: (id) => {
    const table: Record<
      string,
      { name: string; kind: string; slot: string | null; sellValue: number; teaches: string | null }
    > = {
      iron_sword: {
        name: 'Iron Sword',
        kind: 'equip',
        slot: 'mainhand',
        sellValue: 25,
        teaches: null,
      },
      tome_of_fire: {
        name: 'Tome of Fire',
        kind: 'spellbook',
        slot: null,
        sellValue: 0,
        teaches: 'fireball',
      },
      corrupted_blade: {
        name: 'Corrupted Blade',
        kind: 'equip',
        slot: 'mainhand',
        sellValue: 10,
        teaches: null,
      },
    };
    return table[id];
  },
  abilityName: (id) => {
    const names: Record<string, string> = { fireball: 'Fireball' };
    return names[id];
  },
  gemName: (id) => {
    const names: Record<string, string> = {
      ruby_t1: 'Chipped Ruby',
      overcharge_t3: 'Overcharge Gem',
    };
    return names[id] ?? id;
  },
  gemColor: (id) => {
    const colors: Record<string, string> = {
      ruby_t1: '#ff4d4d',
      overcharge_t3: '#ff4d7a',
    };
    return colors[id] ?? '#ffffff';
  },
  gemEffect: (id) => {
    const effects: Record<string, string> = {
      ruby_t1: '+3 power',
      overcharge_t3: '+3 chain · −20% spell dmg',
    };
    return effects[id];
  },
};

// ---------------------------------------------------------------------------
// A magic sword instance (the primary test fixture)
// ---------------------------------------------------------------------------

const MAGIC_SWORD: ItemInstance = {
  uid: 1,
  baseId: 'iron_sword',
  rarity: 'magic',
  power: 10,
  hp: 0,
  affixes: [
    { stat: 'power', value: 5 },
    { stat: 'firedmg', value: 8 },
  ],
  sockets: ['ruby_t1', null],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lineTexts(model: ReturnType<typeof buildItemTooltip>): string[] {
  return model.lines.map((l) => l.text);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildItemTooltip', () => {
  it('title = instanceTitle and titleColor = RARITY.magic.color', () => {
    const model = buildItemTooltip(MAGIC_SWORD, 'Iron Sword', BASE_RESOLVERS, 'bag');
    expect(model.title).toBe(instanceTitle(MAGIC_SWORD, 'Iron Sword'));
    expect(model.titleColor).toBe(RARITY.magic.color);
  });

  it('lines include a type/slot line for kind=equip + slot=mainhand', () => {
    const model = buildItemTooltip(MAGIC_SWORD, 'Iron Sword', BASE_RESOLVERS, 'bag');
    const texts = lineTexts(model);
    const typeLine = texts.find((t) => t.includes('Main Hand'));
    expect(typeLine).toBeDefined();
  });

  it('lines include "+10 pow" for base power', () => {
    const model = buildItemTooltip(MAGIC_SWORD, 'Iron Sword', BASE_RESOLVERS, 'bag');
    expect(lineTexts(model)).toContain('+10 pow');
  });

  it('lines include "+5 power" for the power affix', () => {
    const model = buildItemTooltip(MAGIC_SWORD, 'Iron Sword', BASE_RESOLVERS, 'bag');
    const texts = lineTexts(model);
    const powerAffix = texts.find((t) => t === '+5 power');
    expect(powerAffix).toBeDefined();
  });

  it('lines include "+8% fire damage" for the firedmg affix', () => {
    const model = buildItemTooltip(MAGIC_SWORD, 'Iron Sword', BASE_RESOLVERS, 'bag');
    expect(lineTexts(model)).toContain('+8% fire damage');
  });

  it('socket lines: filled socket shows gem effect, empty socket shows ◇ empty socket', () => {
    const model = buildItemTooltip(MAGIC_SWORD, 'Iron Sword', BASE_RESOLVERS, 'bag');
    const texts = lineTexts(model);
    const rubyLine = texts.find((t) => t.includes('+3 power'));
    expect(rubyLine).toBeDefined();
    expect(texts).toContain('◇ empty socket');
  });

  it('sell line shows "Sell: 25"', () => {
    const model = buildItemTooltip(MAGIC_SWORD, 'Iron Sword', BASE_RESOLVERS, 'bag');
    expect(lineTexts(model)).toContain('Sell: 25');
  });

  it('filled socket line uses gemColor', () => {
    const model = buildItemTooltip(MAGIC_SWORD, 'Iron Sword', BASE_RESOLVERS, 'bag');
    const rubyLine = model.lines.find((l) => l.text.includes('+3 power'));
    expect(rubyLine?.color).toBe('#ff4d4d');
  });

  describe('debuff affix', () => {
    const CORRUPTED: ItemInstance = {
      uid: 2,
      baseId: 'corrupted_blade',
      rarity: 'corrupted',
      power: 30,
      hp: 0,
      affixes: [{ stat: 'fragile', value: 20 }],
      sockets: [],
    };

    it('debuff affix line has debuff=true', () => {
      const model = buildItemTooltip(CORRUPTED, 'Corrupted Blade', BASE_RESOLVERS, 'bag');
      const fragile = model.lines.find((l) => l.text.includes('dmg taken'));
      expect(fragile?.debuff).toBe(true);
    });

    it('debuff affix line uses red color', () => {
      const model = buildItemTooltip(CORRUPTED, 'Corrupted Blade', BASE_RESOLVERS, 'bag');
      const fragile = model.lines.find((l) => l.text.includes('dmg taken'));
      expect(fragile?.color).toBe('#ff6b6b');
    });
  });

  describe('spellbook item', () => {
    const SPELLBOOK: ItemInstance = {
      uid: 3,
      baseId: 'tome_of_fire',
      rarity: 'common',
      power: 0,
      hp: 0,
      affixes: [],
      sockets: [],
    };

    it('includes "Teaches: Fireball" line', () => {
      const model = buildItemTooltip(SPELLBOOK, 'Tome of Fire', BASE_RESOLVERS, 'bag');
      expect(lineTexts(model)).toContain('Teaches: Fireball');
    });
  });

  describe('actions by context', () => {
    it("'bag' ctx → equip + salvage actions with uid", () => {
      const model = buildItemTooltip(MAGIC_SWORD, 'Iron Sword', BASE_RESOLVERS, 'bag');
      const actions = model.actions.map((a) => a.action);
      expect(actions).toContain('equip');
      expect(actions).toContain('salvage');
      const equipAction = model.actions.find((a) => a.action === 'equip');
      expect(equipAction?.uid).toBe(1);
      const salvageAction = model.actions.find((a) => a.action === 'salvage');
      expect(salvageAction?.uid).toBe(1);
    });

    it("'equipped' ctx → unequip action with uid", () => {
      const model = buildItemTooltip(MAGIC_SWORD, 'Iron Sword', BASE_RESOLVERS, 'equipped');
      expect(model.actions.map((a) => a.action)).toContain('unequip');
      expect(model.actions[0]?.uid).toBe(1);
    });

    it("'vault' ctx → withdraw action with uid", () => {
      const model = buildItemTooltip(MAGIC_SWORD, 'Iron Sword', BASE_RESOLVERS, 'vault');
      expect(model.actions.map((a) => a.action)).toContain('withdraw');
      const withdrawAction = model.actions.find((a) => a.action === 'withdraw');
      expect(withdrawAction?.uid).toBe(1);
    });

    it("'gem-strip' ctx → no actions", () => {
      const model = buildItemTooltip(MAGIC_SWORD, 'Iron Sword', BASE_RESOLVERS, 'gem-strip');
      expect(model.actions).toHaveLength(0);
    });

    it("'none' ctx → no actions", () => {
      const model = buildItemTooltip(MAGIC_SWORD, 'Iron Sword', BASE_RESOLVERS, 'none');
      expect(model.actions).toHaveLength(0);
    });
  });
});

describe('buildGemTooltip', () => {
  it('title = gem name; titleColor = gem color', () => {
    const model = buildGemTooltip('overcharge_t3', BASE_RESOLVERS);
    expect(model.title).toBe('Overcharge Gem');
    expect(model.titleColor).toBe('#ff4d7a');
  });

  it('lines include the gem effect text', () => {
    const model = buildGemTooltip('overcharge_t3', BASE_RESOLVERS);
    const texts = model.lines.map((l) => l.text);
    const effectLine = texts.find((t) => t.includes('+3 chain'));
    expect(effectLine).toBeDefined();
    expect(effectLine).toContain('−20% spell dmg');
  });

  it('actions contain a socket action', () => {
    const model = buildGemTooltip('overcharge_t3', BASE_RESOLVERS);
    expect(model.actions.map((a) => a.action)).toContain('socket');
  });

  it('fallback when gemEffect returns undefined: line = "Gem"', () => {
    const resolvers: TooltipResolvers = {
      ...BASE_RESOLVERS,
      gemName: () => 'Mystery Gem',
      gemColor: () => '#aaaaaa',
      gemEffect: () => undefined,
    };
    const model = buildGemTooltip('unknown_gem', resolvers);
    expect(model.lines.map((l) => l.text)).toContain('Gem');
  });
});
