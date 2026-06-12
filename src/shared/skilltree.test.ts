import { describe, expect, it } from 'vitest';
import {
  aggregateSkillEffects,
  canAllocate,
  SKILL_TREE,
  skillNode,
  type SkillEffects,
} from './skilltree.js';

/** Every field of SkillEffects, used to assert aggregate results are complete. */
const EFFECT_KEYS: (keyof SkillEffects)[] = [
  'power',
  'critPct',
  'maxHpPct',
  'lifestealPct',
  'swiftPct',
  'movePct',
  'armorPct',
  'vigor',
  'manaRegen',
  'multishot',
];

describe('SKILL_TREE structure', () => {
  it('has a sensible number of nodes', () => {
    expect(SKILL_TREE.length).toBeGreaterThanOrEqual(16);
    expect(SKILL_TREE.length).toBeLessThanOrEqual(20);
  });

  it('has unique ids', () => {
    const ids = SKILL_TREE.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses kebab-case ids and non-empty name/desc', () => {
    for (const node of SKILL_TREE) {
      expect(node.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(node.name.length).toBeGreaterThan(0);
      expect(node.desc.length).toBeGreaterThan(0);
      expect(node.tier).toBeGreaterThanOrEqual(0);
    }
  });

  it('tier-0 nodes have no prerequisites', () => {
    for (const node of SKILL_TREE) {
      if (node.tier === 0) expect(node.requires).toEqual([]);
    }
  });

  it('every prerequisite is a real node of a strictly lower tier (acyclic DAG)', () => {
    for (const node of SKILL_TREE) {
      for (const reqId of node.requires) {
        const req = skillNode(reqId);
        expect(req, `requires unknown node ${reqId}`).toBeDefined();
        expect(req!.tier).toBeLessThan(node.tier);
      }
    }
  });

  it('each node has at least one effect field set', () => {
    for (const node of SKILL_TREE) {
      expect(Object.keys(node.effects).length).toBeGreaterThan(0);
    }
  });
});

describe('skillNode', () => {
  it('returns the node by id', () => {
    expect(skillNode('off-might')?.name).toBe('Might');
  });

  it('returns undefined for unknown ids', () => {
    expect(skillNode('does-not-exist')).toBeUndefined();
  });
});

describe('canAllocate', () => {
  it('allows a tier-0 node from an empty set', () => {
    expect(canAllocate('off-might', new Set())).toBe(true);
  });

  it('rejects an unknown node', () => {
    expect(canAllocate('nope', new Set())).toBe(false);
  });

  it('rejects a node that is already allocated', () => {
    expect(canAllocate('off-might', new Set(['off-might']))).toBe(false);
  });

  it('rejects a deeper node when prerequisites are missing', () => {
    expect(canAllocate('off-precision', new Set())).toBe(false);
  });

  it('allows a deeper node once all prerequisites are allocated', () => {
    expect(canAllocate('off-precision', new Set(['off-might']))).toBe(true);
  });

  it('requires ALL prerequisites of a multi-prereq capstone', () => {
    const partial = new Set(['off-might', 'off-brutality', 'off-precision']);
    // off-onslaught needs off-brutality AND off-deadeye; off-deadeye is missing.
    expect(canAllocate('off-onslaught', partial)).toBe(false);

    const full = new Set(['off-might', 'off-brutality', 'off-precision', 'off-deadeye']);
    expect(canAllocate('off-onslaught', full)).toBe(true);
  });
});

describe('aggregateSkillEffects', () => {
  it('returns a fully-zeroed result for no allocation', () => {
    const total = aggregateSkillEffects([]);
    for (const key of EFFECT_KEYS) expect(total[key]).toBe(0);
  });

  it('always returns every field, even when only one stat is set', () => {
    const total = aggregateSkillEffects(['off-might']);
    expect(Object.keys(total).sort()).toEqual([...EFFECT_KEYS].sort());
    expect(total.power).toBe(5);
  });

  it('ignores unknown ids', () => {
    const total = aggregateSkillEffects(['off-might', 'ghost-node']);
    expect(total.power).toBe(5);
  });

  it('sums a single multi-effect node correctly', () => {
    // off-onslaught: power 8, multishot 1.
    const total = aggregateSkillEffects(['off-onslaught']);
    expect(total.power).toBe(8);
    expect(total.multishot).toBe(1);
  });

  it('sums a fully-allocated Offense branch into the expected totals', () => {
    const offense = SKILL_TREE.filter((n) => n.id.startsWith('off-')).map((n) => n.id);
    const total = aggregateSkillEffects(offense);
    // might 5 + brutality 8 + onslaught 8 = 21 power.
    expect(total.power).toBe(21);
    // precision 3 + deadeye 5 = 8 crit.
    expect(total.critPct).toBe(8);
    // onslaught grants the only multishot.
    expect(total.multishot).toBe(1);
    // Offense touches nothing defensive.
    expect(total.maxHpPct).toBe(0);
    expect(total.armorPct).toBe(0);
  });

  it('sums across multiple branches additively', () => {
    const total = aggregateSkillEffects(['off-might', 'def-toughness', 'util-fleet']);
    expect(total.power).toBe(5);
    expect(total.maxHpPct).toBe(5);
    expect(total.movePct).toBe(5);
  });
});
