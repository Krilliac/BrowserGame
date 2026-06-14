import { describe, expect, it } from 'vitest';
import { initGameDb, getContent, getDb, reloadContent } from './content.js';
import { QuestFlags, hasQuestFlag } from '../shared/quest-flags.js';

/**
 * Quests carry a `flags` bitmask (QuestFlags). It defaults to 0 (a normal one-off quest); the
 * REPEATABLE bit makes completeQuest leave the quest re-takeable. These tests cover the DB round-trip
 * and the default; the completion behavior is a single guarded line in world.ts.
 */
initGameDb(':memory:');

describe('quest flags', () => {
  it('seeded quests default to no flags (one-off)', () => {
    for (const q of getContent().quests()) {
      expect(q.flags, q.id).toBe(0);
      expect(hasQuestFlag(q.flags, QuestFlags.REPEATABLE), q.id).toBe(false);
    }
  });

  it('a REPEATABLE flag round-trips through the DB', () => {
    getDb()
      .prepare('UPDATE quests SET flags = ? WHERE id = ?')
      .run(QuestFlags.REPEATABLE, 'wolf_cull');
    const q = reloadContent().quest('wolf_cull');
    expect(q, 'wolf_cull exists').toBeDefined();
    expect(hasQuestFlag(q!.flags, QuestFlags.REPEATABLE)).toBe(true);
  });
});
