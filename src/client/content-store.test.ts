import { describe, expect, it } from 'vitest';
import { ClientContentStore } from './content-store.js';

/**
 * The client mirrors the server's content packet. Dungeon-ness is now data: the server ships the
 * dungeon area-id set so the client marks dungeon-bound portals without a hardcoded list.
 */
describe('ClientContentStore.isDungeon', () => {
  it('reflects the dungeon id set from the content packet', () => {
    const s = new ClientContentStore();
    s.load([], [], [], {}, ['forgotten_catacombs', 'writhing_hive']);
    expect(s.isDungeon('forgotten_catacombs')).toBe(true);
    expect(s.isDungeon('writhing_hive')).toBe(true);
    expect(s.isDungeon('town')).toBe(false);
  });

  it('defaults to no dungeons when the packet omits the list', () => {
    const s = new ClientContentStore();
    s.load([], [], []);
    expect(s.isDungeon('forgotten_catacombs')).toBe(false);
  });
});
