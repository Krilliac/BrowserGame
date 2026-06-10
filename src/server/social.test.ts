import { describe, expect, it } from 'vitest';
import { MAX_FRIENDS } from '../shared/protocol.js';
import { type FriendStore, type Presence, SocialRegistry } from './social.js';

/** A simple in-memory store mirroring the DB-backed one the host injects in prod. */
function makeStore(): FriendStore {
  const data = new Map<string, string[]>();
  return {
    load: (token) => [...(data.get(token) ?? [])],
    add: (token, name) => {
      const list = data.get(token) ?? [];
      list.push(name);
      data.set(token, list);
    },
    remove: (token, name) => {
      const list = data.get(token) ?? [];
      data.set(
        token,
        list.filter((n) => n !== name),
      );
    },
  };
}

const presence = (over: Partial<Presence> & Pick<Presence, 'token' | 'name'>): Presence => ({
  id: 1,
  areaId: 'town',
  level: 1,
  ...over,
});

describe('SocialRegistry friends', () => {
  it('adds a friend and persists it via the store', () => {
    const store = makeStore();
    const reg = new SocialRegistry(store);
    expect(reg.addFriend('tok-a', 'Alice', 'Bob')).toEqual({ ok: true });
    expect(store.load('tok-a')).toEqual(['Bob']);
  });

  it('removes a friend and persists it (case-insensitive); non-friend is a no-op', () => {
    const store = makeStore();
    const reg = new SocialRegistry(store);
    reg.addFriend('tok-a', 'Alice', 'Bob');
    reg.removeFriend('tok-a', 'Nobody'); // no-op
    expect(store.load('tok-a')).toEqual(['Bob']);
    reg.removeFriend('tok-a', 'bOb'); // case-insensitive match
    expect(store.load('tok-a')).toEqual([]);
  });

  it('rejects adding yourself (case-insensitive)', () => {
    const reg = new SocialRegistry(makeStore());
    expect(reg.addFriend('tok-a', 'Alice', 'alice')).toEqual({ ok: false, reason: 'self' });
  });

  it('rejects empty / whitespace names', () => {
    const reg = new SocialRegistry(makeStore());
    expect(reg.addFriend('tok-a', 'Alice', '   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('rejects duplicates (case-insensitive)', () => {
    const store = makeStore();
    const reg = new SocialRegistry(store);
    expect(reg.addFriend('tok-a', 'Alice', 'Bob')).toEqual({ ok: true });
    expect(reg.addFriend('tok-a', 'Alice', 'bob')).toEqual({ ok: false, reason: 'duplicate' });
    expect(store.load('tok-a')).toEqual(['Bob']);
  });

  it('rejects once the friend cap is reached', () => {
    const store = makeStore();
    const reg = new SocialRegistry(store);
    for (let i = 0; i < MAX_FRIENDS; i++) {
      expect(reg.addFriend('tok-a', 'Alice', `Friend${i}`)).toEqual({ ok: true });
    }
    expect(store.load('tok-a')).toHaveLength(MAX_FRIENDS);
    expect(reg.addFriend('tok-a', 'Alice', 'OneTooMany')).toEqual({ ok: false, reason: 'full' });
  });
});

describe('SocialRegistry presence resolution', () => {
  it('friendsOf resolves online vs offline friends', () => {
    const store = makeStore();
    const reg = new SocialRegistry(store);
    reg.addFriend('tok-a', 'Alice', 'Bob');
    reg.addFriend('tok-a', 'Alice', 'Carol');
    reg.setOnline(presence({ token: 'tok-b', name: 'Bob', areaId: 'crypt', level: 7 }));

    const list = reg.friendsOf('tok-a');
    expect(list).toContainEqual({ name: 'Bob', online: true, areaId: 'crypt', level: 7 });
    expect(list).toContainEqual({ name: 'Carol', online: false, areaId: '', level: 0 });
  });

  it('friendsOf prefers the live display name and reflects updatePresence', () => {
    const store = makeStore();
    const reg = new SocialRegistry(store);
    reg.addFriend('tok-a', 'Alice', 'bob'); // stored lowercase by the adder
    reg.setOnline(presence({ token: 'tok-b', name: 'Bob', areaId: 'town', level: 3 }));

    reg.updatePresence('tok-b', 'wilderness', 9);
    const entry = reg.friendsOf('tok-a')[0]!;
    expect(entry).toEqual({ name: 'Bob', online: true, areaId: 'wilderness', level: 9 });
  });

  it('addFriend is case-insensitive and findOnline resolves either casing', () => {
    const reg = new SocialRegistry(makeStore());
    reg.setOnline(presence({ token: 'tok-b', name: 'Bob', id: 42 }));
    expect(reg.findOnline('BOB')?.id).toBe(42);
    expect(reg.findOnline('bob')?.id).toBe(42);
    expect(reg.findOnline('nobody')).toBeUndefined();
  });

  it('setOffline clears presence from both indexes', () => {
    const store = makeStore();
    const reg = new SocialRegistry(store);
    reg.addFriend('tok-a', 'Alice', 'Bob');
    reg.setOnline(presence({ token: 'tok-b', name: 'Bob', areaId: 'crypt', level: 7 }));
    expect(reg.findOnline('Bob')).toBeDefined();

    reg.setOffline('tok-b');
    expect(reg.findOnline('Bob')).toBeUndefined();
    expect(reg.friendsOf('tok-a')[0]).toEqual({ name: 'Bob', online: false, areaId: '', level: 0 });
  });

  it('setOnline under a new name drops the stale name index', () => {
    const reg = new SocialRegistry(makeStore());
    reg.setOnline(presence({ token: 'tok-b', name: 'OldName' }));
    reg.setOnline(presence({ token: 'tok-b', name: 'NewName' }));
    expect(reg.findOnline('OldName')).toBeUndefined();
    expect(reg.findOnline('NewName')?.token).toBe('tok-b');
  });
});

describe('SocialRegistry watchersOf', () => {
  it('returns online tokens whose friend list contains the name', () => {
    const store = makeStore();
    const reg = new SocialRegistry(store);

    // Alice and Carol friend Bob; Dave does not.
    reg.addFriend('tok-a', 'Alice', 'Bob');
    reg.addFriend('tok-c', 'Carol', 'bob'); // case-insensitive match
    reg.addFriend('tok-d', 'Dave', 'Eve');

    reg.setOnline(presence({ token: 'tok-a', name: 'Alice' }));
    reg.setOnline(presence({ token: 'tok-c', name: 'Carol' }));
    reg.setOnline(presence({ token: 'tok-d', name: 'Dave' }));

    const watchers = reg.watchersOf('Bob');
    expect(watchers.sort()).toEqual(['tok-a', 'tok-c']);
  });

  it('excludes offline watchers', () => {
    const store = makeStore();
    const reg = new SocialRegistry(store);
    reg.addFriend('tok-a', 'Alice', 'Bob'); // Alice friends Bob but never comes online
    expect(reg.watchersOf('Bob')).toEqual([]);
  });
});
