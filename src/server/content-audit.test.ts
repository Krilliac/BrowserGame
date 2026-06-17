import { describe, expect, it } from 'vitest';
import { initGameDb, getDb, reloadContent } from './content.js';
import { auditContent } from './content-audit.js';

/**
 * The content audit is a designer-facing safety net: a freshly-seeded database is the canonical
 * "everything wired up" state, so it must produce ZERO `error` issues — that assertion doubles as a
 * guard that the seed itself never ships a dangling reference. The remaining cases inject a single
 * deliberately broken row (via the raw DB), reload, and confirm the audit surfaces it with the
 * right `kind`.
 */
initGameDb(':memory:');

describe('content audit', () => {
  it('a freshly-seeded database has no error issues', () => {
    const { issues } = auditContent();
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors, `seeded content has dangling refs: ${JSON.stringify(errors, null, 2)}`).toEqual(
      [],
    );
  });

  it('flags a quest whose target mob does not exist', () => {
    // quests.target_mob has no FK, so SQLite happily stores the typo — exactly the silent mistake
    // the audit exists to catch.
    getDb()
      .prepare(
        `INSERT INTO quests (id, name, description, target_mob, target_count)
         VALUES ('audit_bad_quest', 'Bad Quest', 'desc', 'ghost_xyz', 3)`,
      )
      .run();
    reloadContent();

    const { issues } = auditContent();
    const hit = issues.find(
      (i) => i.kind === 'quest.targetMob' && i.ref === 'quest:audit_bad_quest',
    );
    expect(hit, 'audit should flag the bad targetMob').toBeDefined();
    expect(hit!.severity).toBe('error');
    expect(hit!.message).toContain('ghost_xyz');

    getDb().prepare(`DELETE FROM quests WHERE id = 'audit_bad_quest'`).run();
    reloadContent();
  });

  it('flags a portal that leads to a non-existent area', () => {
    const area = getDb().prepare('SELECT id FROM areas LIMIT 1').get() as { id: string };
    // portals.to_area has no FK (only area_id does), so a dangling destination loads fine.
    getDb()
      .prepare(
        `INSERT INTO portals (area_id, rect_x, rect_y, rect_w, rect_h, to_area, to_spawn_x, to_spawn_y, label)
         VALUES (?, 0, 0, 10, 10, 'nowhere_land', 0, 0, 'Broken Gate')`,
      )
      .run(area.id);
    reloadContent();

    const { issues } = auditContent();
    const hit = issues.find((i) => i.kind === 'portal.dest' && i.message.includes('nowhere_land'));
    expect(hit, 'audit should flag the portal to nowhere').toBeDefined();
    expect(hit!.severity).toBe('error');

    getDb().prepare(`DELETE FROM portals WHERE to_area = 'nowhere_land'`).run();
    reloadContent();
  });

  it('flags a loot table that references a non-existent item', () => {
    const mob = getDb().prepare('SELECT mob_template_id FROM loot_entry LIMIT 1').get() as {
      mob_template_id: string;
    };
    // loot_entry.item_id has no FK, so a typo'd drop id loads fine — a mob would silently drop
    // nothing for that slot in-game.
    getDb()
      .prepare(
        `INSERT INTO loot_entry (mob_template_id, grp, item_id, weight, min_qty, max_qty)
         VALUES (?, 'main', 'phantom_item', 1, 1, 1)`,
      )
      .run(mob.mob_template_id);
    reloadContent();

    const { issues } = auditContent();
    const hit = issues.find((i) => i.kind === 'loot.item' && i.message.includes('phantom_item'));
    expect(hit, 'audit should flag the bad loot item').toBeDefined();
    expect(hit!.severity).toBe('error');

    getDb().prepare(`DELETE FROM loot_entry WHERE item_id = 'phantom_item'`).run();
    reloadContent();
  });

  it('returns clean again after the broken rows are removed', () => {
    // Sanity: the cleanup in the prior cases restored the seed, so we are back to zero errors.
    reloadContent();
    const errors = auditContent().issues.filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
  });
});
