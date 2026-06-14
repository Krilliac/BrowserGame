import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './db/database.js';
import { loadContent } from './content.js';
import {
  SKILL_TREE,
  DEFAULT_SKILL_TREE,
  applySkillTreeOverrides,
  skillNode,
  aggregateSkillEffects,
} from '../shared/skilltree.js';

/**
 * The passive skill tree is TrinityCore-style content: the DB (seeded from DEFAULT_SKILL_TREE) is the
 * runtime authority for nodes, prereqs, and per-node effects. The server folds aggregated effects
 * into stats; the client renders the tree from the content packet. Restore defaults after each test.
 */
afterEach(() => applySkillTreeOverrides([]));

describe('content skill tree', () => {
  it('seeds nodes from the defaults (effects + prereqs)', () => {
    const c = loadContent(openDatabase(':memory:'));
    const byId = new Map(c.skillTree().map((n) => [n.id, n]));
    for (const def of DEFAULT_SKILL_TREE) expect(byId.get(def.id)).toEqual(def);
  });

  it('overlay changes a node effect (aggregation reflects it)', () => {
    const db = openDatabase(':memory:');
    db.prepare(
      "UPDATE skill_node_effects SET value = ? WHERE node_id = 'off-might' AND effect = 'power'",
    ).run(99);
    applySkillTreeOverrides(loadContent(db).skillTree());
    expect(aggregateSkillEffects(['off-might']).power).toBe(99);
  });

  it('supports a node added only in the DB (with a prereq)', () => {
    const db = openDatabase(':memory:');
    db.prepare('INSERT INTO skill_nodes (id,name,desc,tier) VALUES (?,?,?,?)').run(
      'off-x',
      'Xtra',
      'x',
      2,
    );
    db.prepare(
      'INSERT INTO skill_node_requires (node_id,requires_id,sort_order) VALUES (?,?,?)',
    ).run('off-x', 'off-might', 0);
    db.prepare('INSERT INTO skill_node_effects (node_id,effect,value) VALUES (?,?,?)').run(
      'off-x',
      'power',
      3,
    );
    applySkillTreeOverrides(loadContent(db).skillTree());
    expect(skillNode('off-x')?.requires).toEqual(['off-might']);
    expect(skillNode('off-x')?.effects).toEqual({ power: 3 });
  });

  it('reset restores the code defaults', () => {
    applySkillTreeOverrides([]);
    expect(SKILL_TREE).toEqual(DEFAULT_SKILL_TREE);
  });
});
