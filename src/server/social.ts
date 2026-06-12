/**
 * Friends list with live presence. Pure host-level logic over an injected {@link FriendStore}:
 * it deals in player **names**, opaque persistent **owner tokens**, and transient numeric ids —
 * never touching ws, the DB, or wall-clock/random. The host owns one instance, wires persistence
 * and networking, and feeds presence in as players join/move/level/disconnect.
 */

import { MAX_FRIENDS, type FriendInfo } from '../shared/protocol.js';

/** Persistence the host injects (DB-backed in prod, in-memory in tests). Friend names per owner token. */
export interface FriendStore {
  load(token: string): string[];
  add(token: string, name: string): void;
  remove(token: string, name: string): void;
}

/** Live presence of an online player. */
export interface Presence {
  id: number;
  token: string;
  name: string;
  areaId: string;
  level: number;
}

const norm = (name: string): string => name.trim().toLowerCase();

export class SocialRegistry {
  // Two indexes over the same online players:
  //  - byToken: identity-keyed, so disconnect/move/level updates (which carry a token) are O(1).
  //  - byLowerName: name-keyed (lowercased), so whisper routing and friend-presence resolution
  //    — which only know a *name* — are O(1) and case-insensitive.
  // Both must be kept in lock-step: setOffline cleans both, setOnline rewrites both.
  private readonly byToken = new Map<string, Presence>();
  private readonly byLowerName = new Map<string, Presence>();

  constructor(private readonly store: FriendStore) {}

  /** Mark a player online (on join). Indexed by both token and lowercased name for lookup. */
  setOnline(p: Presence): void {
    // If this token was online under a different name, drop the stale name index entry first.
    const prev = this.byToken.get(p.token);
    if (prev) this.byLowerName.delete(norm(prev.name));
    this.byToken.set(p.token, p);
    this.byLowerName.set(norm(p.name), p);
  }

  /** Mark offline (on disconnect) by token. */
  setOffline(token: string): void {
    const p = this.byToken.get(token);
    if (!p) return;
    this.byToken.delete(token);
    this.byLowerName.delete(norm(p.name));
  }

  /** Update an online player's area/level (called as they move/level). */
  updatePresence(token: string, areaId: string, level: number): void {
    const p = this.byToken.get(token);
    if (!p) return;
    p.areaId = areaId;
    p.level = level;
  }

  /**
   * Add a friend by name. Offline players are valid friends, so any non-empty name is accepted;
   * we only reject adding yourself, a duplicate, or going over the cap. Persists via the store.
   */
  addFriend(token: string, selfName: string, friendName: string): { ok: boolean; reason?: string } {
    const target = norm(friendName);
    if (target.length === 0) return { ok: false, reason: 'empty' };
    if (target === norm(selfName)) return { ok: false, reason: 'self' };

    const current = this.store.load(token);
    if (current.some((n) => norm(n) === target)) return { ok: false, reason: 'duplicate' };
    if (current.length >= MAX_FRIENDS) return { ok: false, reason: 'full' };

    this.store.add(token, friendName.trim());
    return { ok: true };
  }

  /** Remove a friend by name (persists). A non-friend is a no-op. */
  removeFriend(token: string, friendName: string): void {
    const target = norm(friendName);
    const stored = this.store.load(token).find((n) => norm(n) === target);
    if (stored !== undefined) this.store.remove(token, stored);
  }

  /** The friends list for a player with resolved live presence (online/areaId/level by name). */
  friendsOf(token: string): FriendInfo[] {
    return this.store.load(token).map((stored) => {
      const live = this.byLowerName.get(norm(stored));
      // Online: show the live display name + area/level. Offline: show the stored name as-is.
      if (live) return { name: live.name, online: true, areaId: live.areaId, level: live.level };
      return { name: stored, online: false, areaId: '', level: 0 };
    });
  }

  /** Resolve an ONLINE player by name (case-insensitive) for whisper routing. */
  findOnline(name: string): Presence | undefined {
    return this.byLowerName.get(norm(name));
  }

  /**
   * Tokens of online players who have `name` in their friends list. Lets the host push a presence
   * update only to the people who care when `name` comes online or goes offline — without scanning
   * every connected player's friends on every presence change.
   */
  watchersOf(name: string): string[] {
    const target = norm(name);
    const tokens: string[] = [];
    for (const p of this.byToken.values()) {
      if (this.store.load(p.token).some((n) => norm(n) === target)) tokens.push(p.token);
    }
    return tokens;
  }
}
