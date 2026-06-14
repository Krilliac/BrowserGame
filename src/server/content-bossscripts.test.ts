import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './db/database.js';
import { loadContent } from './content.js';
import { BOSS_SCRIPTS, DEFAULT_BOSS_SCRIPTS, applyBossScriptOverrides } from './boss-scripts.js';

/**
 * Boss scripts are TrinityCore-style content: the DB (seeded from the code defaults) is the runtime
 * authority for each boss's phases + step loop, while the executor + step vocabulary stay in code.
 * Restore defaults after each test so the live BOSS_SCRIPTS singleton never leaks between tests.
 */
afterEach(() => applyBossScriptOverrides({}));

describe('content boss scripts', () => {
  it('round-trips the default scripts through the DB unchanged', () => {
    const c = loadContent(openDatabase(':memory:'));
    expect(c.bossScripts()).toEqual(DEFAULT_BOSS_SCRIPTS);
  });

  it('overlay makes the live BOSS_SCRIPTS reflect a DB edit', () => {
    const db = openDatabase(':memory:');
    // Retune Nyxathor's opener brawl window (phase 0, the first step is a brawl with ms=6000).
    db.prepare(
      `UPDATE mob_script_steps SET ms = 1234
         WHERE kind = 'brawl' AND phase_id IN
           (SELECT id FROM mob_script_phases WHERE template_id = 'nyxathor' AND sort_order = 0)`,
    ).run();
    applyBossScriptOverrides(loadContent(db).bossScripts());
    const opener = BOSS_SCRIPTS.nyxathor!.phases[0]!.loop;
    expect(opener.find((s) => s.kind === 'brawl')).toEqual({ kind: 'brawl', ms: 1234 });
  });

  it('drops a malformed step row rather than crashing the load', () => {
    const db = openDatabase(':memory:');
    const phaseId = db
      .prepare('INSERT INTO mob_script_phases (template_id,hp_below,sort_order) VALUES (?,?,?)')
      .run('test_boss', 1.0, 0).lastInsertRowid;
    // A valid shout, then a malformed cast (null ability) that must be skipped on load.
    db.prepare('INSERT INTO mob_script_steps (phase_id,sort_order,kind,text) VALUES (?,?,?,?)').run(
      phaseId,
      0,
      'shout',
      'TEST: hello',
    );
    db.prepare('INSERT INTO mob_script_steps (phase_id,sort_order,kind) VALUES (?,?,?)').run(
      phaseId,
      1,
      'cast',
    );
    const loop = loadContent(db).bossScripts().test_boss!.phases[0]!.loop;
    expect(loop).toEqual([{ kind: 'shout', text: 'TEST: hello' }]); // the bad cast is gone
  });

  it('supports a brand-new scripted boss added only in the DB', () => {
    const db = openDatabase(':memory:');
    const phaseId = db
      .prepare('INSERT INTO mob_script_phases (template_id,hp_below,sort_order) VALUES (?,?,?)')
      .run('db_boss', 0.5, 0).lastInsertRowid;
    db.prepare(
      'INSERT INTO mob_script_steps (phase_id,sort_order,kind,summon_template,summon_count,summon_radius) VALUES (?,?,?,?,?,?)',
    ).run(phaseId, 0, 'summon', 'abyss_thrall', 3, 120);
    applyBossScriptOverrides(loadContent(db).bossScripts());
    expect(BOSS_SCRIPTS.db_boss!.phases[0]).toEqual({
      hpBelow: 0.5,
      loop: [{ kind: 'summon', templateId: 'abyss_thrall', count: 3, radius: 120 }],
    });
  });

  it('reset restores the code defaults', () => {
    applyBossScriptOverrides({});
    expect(BOSS_SCRIPTS).toEqual(DEFAULT_BOSS_SCRIPTS);
  });
});
