/**
 * Host-level guild registry — persistent player societies (roster + ranks + guild chat). Pure and
 * framework-free (no ws, no Date/Math.random) over an injected {@link GuildStore} (DB-backed in
 * prod, in-memory in tests). It deals in opaque persistent **owner tokens** + display names; the
 * host (src/server/index.ts) resolves online names→tokens (via the SocialRegistry), wires the store,
 * and routes guild chat. Mirrors party.ts / social.ts.
 *
 * Invariants: a player is in at most one guild; a guild always has exactly one leader; a guild with
 * no members is deleted; a player has at most one pending invite.
 */

export type GuildRank = 'leader' | 'officer' | 'member';

/** One persisted guild member. */
export interface GuildMember {
  token: string;
  name: string;
  rank: GuildRank;
}

/** Persistence the host injects (the durable roster). All methods are synchronous + side-effecting. */
export interface GuildStore {
  /** Create a guild; returns its id, or null if the name is taken. */
  create(name: string): number | null;
  /** Delete a guild and all its membership rows. */
  delete(guildId: number): void;
  /** A guild's display name, or undefined. */
  name(guildId: number): string | undefined;
  /** A player's membership (guild id + rank), or undefined if guildless. */
  guildOf(token: string): { guildId: number; rank: string } | undefined;
  /** All members of a guild (leader/officer/member order). */
  members(guildId: number): GuildMember[];
  /** Add or refresh a member. */
  add(guildId: number, token: string, name: string, rank: GuildRank): void;
  /** Remove a member by token. */
  remove(token: string): void;
  /** Set a member's rank by token. */
  setRank(token: string, rank: GuildRank): void;
}

/** Largest guild roster. */
export const MAX_GUILD_SIZE = 30;

type Result = { ok: true } | { ok: false; reason: string };

export class GuildRegistry {
  /** Pending invites: invitee token -> the guild id they were invited to. */
  private readonly invites = new Map<string, number>();

  constructor(private readonly store: GuildStore) {}

  /** Create a guild led by the creator. Fails if they're already in one or the name is taken/blank. */
  create(token: string, name: string, displayName: string): Result {
    const clean = name.trim();
    if (clean.length < 3 || clean.length > 24) {
      return { ok: false, reason: 'Guild name must be 3–24 characters.' };
    }
    if (this.store.guildOf(token)) return { ok: false, reason: 'You are already in a guild.' };
    const guildId = this.store.create(clean);
    if (guildId === null) return { ok: false, reason: 'That guild name is taken.' };
    this.store.add(guildId, token, displayName, 'leader');
    return { ok: true };
  }

  /** Invite an online player (their token) to the inviter's guild. Leader/officer only. */
  invite(fromToken: string, toToken: string): Result {
    if (fromToken === toToken) return { ok: false, reason: 'You cannot invite yourself.' };
    const from = this.store.guildOf(fromToken);
    if (!from) return { ok: false, reason: 'You are not in a guild.' };
    if (from.rank === 'member')
      return { ok: false, reason: 'Only officers and the leader can invite.' };
    if (this.store.guildOf(toToken))
      return { ok: false, reason: 'That player is already in a guild.' };
    if (this.store.members(from.guildId).length >= MAX_GUILD_SIZE) {
      return { ok: false, reason: 'Your guild is full.' };
    }
    this.invites.set(toToken, from.guildId);
    return { ok: true };
  }

  /** The guild id a player is currently invited to, or undefined. */
  pendingInvite(token: string): number | undefined {
    return this.invites.get(token);
  }

  /** Accept the pending invite, joining as a member. Clears the invite either way. */
  accept(
    token: string,
    displayName: string,
  ): { ok: true; guildName: string } | { ok: false; reason: string } {
    const guildId = this.invites.get(token);
    this.invites.delete(token);
    if (guildId === undefined) return { ok: false, reason: 'You have no pending guild invite.' };
    if (this.store.guildOf(token)) return { ok: false, reason: 'You are already in a guild.' };
    const name = this.store.name(guildId);
    if (name === undefined) return { ok: false, reason: 'That guild no longer exists.' };
    if (this.store.members(guildId).length >= MAX_GUILD_SIZE) {
      return { ok: false, reason: 'That guild is full.' };
    }
    this.store.add(guildId, token, displayName, 'member');
    return { ok: true, guildName: name };
  }

  /** Decline (clear) the pending invite. */
  decline(token: string): void {
    this.invites.delete(token);
  }

  /**
   * Leave the guild. The leader leaving promotes the highest-ranked other member (officer first,
   * else the first member) to leader; the last member leaving disbands the guild. Returns the
   * affected member tokens (to re-broadcast presence) plus a human note.
   */
  leave(token: string): { ok: boolean; reason?: string; note?: string; affected: string[] } {
    const mine = this.store.guildOf(token);
    if (!mine) return { ok: false, reason: 'You are not in a guild.', affected: [] };
    const before = this.store.members(mine.guildId).map((m) => m.token);
    this.store.remove(token);
    const rest = this.store.members(mine.guildId);
    if (rest.length === 0) {
      this.store.delete(mine.guildId);
      return { ok: true, note: 'Your guild is disbanded.', affected: before };
    }
    if (mine.rank === 'leader') {
      const heir = rest.find((m) => m.rank === 'officer') ?? rest[0]!;
      this.store.setRank(heir.token, 'leader');
      return { ok: true, note: `${heir.name} is now the guild leader.`, affected: before };
    }
    return { ok: true, affected: before };
  }

  /** Kick a member (leader/officer; cannot kick the leader or an equal-ranked officer). */
  kick(byToken: string, targetToken: string): Result {
    const by = this.store.guildOf(byToken);
    if (!by) return { ok: false, reason: 'You are not in a guild.' };
    if (by.rank === 'member')
      return { ok: false, reason: 'Only officers and the leader can kick.' };
    if (byToken === targetToken) return { ok: false, reason: 'Use /guild leave to leave.' };
    const target = this.store.members(by.guildId).find((m) => m.token === targetToken);
    if (!target) return { ok: false, reason: 'They are not in your guild.' };
    if (target.rank === 'leader') return { ok: false, reason: 'You cannot kick the leader.' };
    if (target.rank === 'officer' && by.rank !== 'leader') {
      return { ok: false, reason: 'Only the leader can kick an officer.' };
    }
    this.store.remove(targetToken);
    return { ok: true };
  }

  /** Promote/demote a member between officer and member (leader only; never touches the leader). */
  setRank(byToken: string, targetToken: string, rank: 'officer' | 'member'): Result {
    const by = this.store.guildOf(byToken);
    if (!by || by.rank !== 'leader') return { ok: false, reason: 'Only the leader can set ranks.' };
    if (byToken === targetToken) return { ok: false, reason: 'You cannot change your own rank.' };
    const target = this.store.members(by.guildId).find((m) => m.token === targetToken);
    if (!target) return { ok: false, reason: 'They are not in your guild.' };
    this.store.setRank(targetToken, rank);
    return { ok: true };
  }

  /** The roster of the player's guild (with name), or undefined if guildless. */
  roster(token: string): { name: string; members: GuildMember[] } | undefined {
    const mine = this.store.guildOf(token);
    if (!mine) return undefined;
    const name = this.store.name(mine.guildId);
    if (name === undefined) return undefined;
    return { name, members: this.store.members(mine.guildId) };
  }

  /** Member tokens of the player's guild (for chat fan-out), empty if guildless. */
  memberTokens(token: string): string[] {
    const mine = this.store.guildOf(token);
    if (!mine) return [];
    return this.store.members(mine.guildId).map((m) => m.token);
  }

  /** The player's guild name, or undefined. */
  guildNameOf(token: string): string | undefined {
    const mine = this.store.guildOf(token);
    return mine ? this.store.name(mine.guildId) : undefined;
  }

  /** The caller's guild id + rank, or undefined if guildless (for guild-bank gating). */
  membership(token: string): { guildId: number; rank: GuildRank } | undefined {
    const mine = this.store.guildOf(token);
    if (!mine) return undefined;
    return { guildId: mine.guildId, rank: mine.rank as GuildRank };
  }

  /** Drop any pending invite for a disconnecting player (membership persists in the store). */
  remove(token: string): void {
    this.invites.delete(token);
  }
}
