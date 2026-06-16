import { describe, expect, it, beforeEach } from 'vitest';
import {
  GuildRegistry,
  MAX_GUILD_SIZE,
  type GuildStore,
  type GuildMember,
  type GuildRank,
} from './guild.js';

/** A tiny in-memory GuildStore mirroring the DB schema (one guild per token). */
function memStore(): GuildStore {
  let nextId = 1;
  const names = new Map<number, string>();
  const members = new Map<string, { guildId: number; name: string; rank: GuildRank }>();
  return {
    create(name) {
      for (const n of names.values()) if (n.toLowerCase() === name.toLowerCase()) return null;
      const id = nextId++;
      names.set(id, name);
      return id;
    },
    delete(guildId) {
      names.delete(guildId);
      for (const [t, m] of members) if (m.guildId === guildId) members.delete(t);
    },
    name: (guildId) => names.get(guildId),
    guildOf(token) {
      const m = members.get(token);
      return m ? { guildId: m.guildId, rank: m.rank } : undefined;
    },
    members(guildId) {
      const rank = { leader: 0, officer: 1, member: 2 } as const;
      return [...members.entries()]
        .filter(([, m]) => m.guildId === guildId)
        .map(([token, m]): GuildMember => ({ token, name: m.name, rank: m.rank }))
        .sort((a, b) => rank[a.rank] - rank[b.rank] || a.name.localeCompare(b.name));
    },
    add: (guildId, token, name, rank) => void members.set(token, { guildId, name, rank }),
    remove: (token) => void members.delete(token),
    setRank(token, rank) {
      const m = members.get(token);
      if (m) m.rank = rank;
    },
  };
}

describe('GuildRegistry', () => {
  let g: GuildRegistry;
  beforeEach(() => {
    g = new GuildRegistry(memStore());
  });

  it('creates a guild with the founder as leader', () => {
    expect(g.create('tok-a', 'Ironwolves', 'Alice').ok).toBe(true);
    const r = g.roster('tok-a')!;
    expect(r.name).toBe('Ironwolves');
    expect(r.members).toHaveLength(1);
    expect(r.members[0]!.rank).toBe('leader');
  });

  it('rejects a duplicate name, a too-short name, and a double membership', () => {
    g.create('tok-a', 'Ironwolves', 'Alice');
    expect(g.create('tok-b', 'ironwolves', 'Bob').ok).toBe(false); // case-insensitive dup
    expect(g.create('tok-c', 'ab', 'Cara').ok).toBe(false); // too short
    expect(g.create('tok-a', 'Other', 'Alice').ok).toBe(false); // already in a guild
  });

  it('invites + accepts a member (officers can invite, members cannot)', () => {
    g.create('tok-a', 'Ironwolves', 'Alice');
    expect(g.invite('tok-a', 'tok-b').ok).toBe(true);
    expect(g.pendingInvite('tok-b')).toBeDefined();
    const acc = g.accept('tok-b', 'Bob');
    expect(acc.ok && acc.guildName).toBe('Ironwolves');
    expect(g.roster('tok-a')!.members).toHaveLength(2);
    // A plain member cannot invite.
    expect(g.invite('tok-b', 'tok-c').ok).toBe(false);
  });

  it('promotes a member to officer (leader only), who can then invite', () => {
    g.create('tok-a', 'Ironwolves', 'Alice');
    g.invite('tok-a', 'tok-b');
    g.accept('tok-b', 'Bob');
    expect(g.setRank('tok-b', 'tok-a', 'officer').ok).toBe(false); // non-leader can't set ranks
    expect(g.setRank('tok-a', 'tok-b', 'officer').ok).toBe(true);
    expect(g.invite('tok-b', 'tok-c').ok).toBe(true); // now an officer, can invite
  });

  it('promotes an officer to leader when the leader leaves; disbands when empty', () => {
    g.create('tok-a', 'Ironwolves', 'Alice');
    g.invite('tok-a', 'tok-b');
    g.accept('tok-b', 'Bob');
    g.setRank('tok-a', 'tok-b', 'officer');
    const left = g.leave('tok-a');
    expect(left.ok).toBe(true);
    expect(left.note).toContain('Bob'); // Bob promoted to leader
    expect(g.roster('tok-b')!.members.find((m) => m.token === 'tok-b')!.rank).toBe('leader');
    // Last member leaves → guild gone.
    g.leave('tok-b');
    expect(g.roster('tok-b')).toBeUndefined();
  });

  it('kicks a member (officer+), but not the leader', () => {
    g.create('tok-a', 'Ironwolves', 'Alice');
    g.invite('tok-a', 'tok-b');
    g.accept('tok-b', 'Bob');
    expect(g.kick('tok-b', 'tok-a').ok).toBe(false); // member can't kick
    expect(g.kick('tok-a', 'tok-b').ok).toBe(true); // leader kicks member
    expect(g.roster('tok-a')!.members).toHaveLength(1);
  });

  it('enforces the roster cap', () => {
    g.create('tok-a', 'Ironwolves', 'Alice');
    for (let i = 1; i < MAX_GUILD_SIZE; i++) {
      g.invite('tok-a', `tok-${i}`);
      g.accept(`tok-${i}`, `M${i}`);
    }
    expect(g.roster('tok-a')!.members).toHaveLength(MAX_GUILD_SIZE);
    expect(g.invite('tok-a', 'tok-over').ok).toBe(false); // full
  });
});
