/**
 * Host-level party registry. Pure and framework-free (no ws, DB, timers, Date/Math.random) so it
 * is fully unit-testable. It deals in numeric player entity ids only — name resolution and
 * networking live in the host (src/server/index.ts), which owns one instance of this registry.
 *
 * Invariants: a player is in at most one party; a player has at most one pending invite at a time.
 */

import { MAX_PARTY_SIZE } from '../shared/protocol.js';

export interface Party {
  id: number; // unique party id
  leaderId: number; // current leader's player id
  memberIds: number[]; // all members incl. leader, in a stable order (leader first)
}

export class PartyRegistry {
  private readonly parties = new Map<number, Party>(); // partyId -> party
  private readonly partyOfPlayer = new Map<number, number>(); // playerId -> partyId
  /**
   * Pending invites keyed by invitee. We store only the inviter id and resolve the inviter's
   * current party at accept time — the inviter may have joined/left/changed parties (or gone
   * offline, which clears the invite via remove()) between sending and acceptance.
   */
  private readonly invites = new Map<number, { fromId: number }>();
  private nextPartyId = 1; // incrementing allocator; deterministic, no Date/random

  /**
   * Player `fromId` invites `toId`. Any member of a party may invite (chosen for simplicity; a
   * leader-only rule would only add a check here). Records a pending invite on the invitee,
   * replacing any prior pending invite.
   */
  invite(fromId: number, toId: number): { ok: boolean; reason?: string } {
    if (fromId === toId) return { ok: false, reason: 'You cannot invite yourself.' };
    if (this.partyOfPlayer.has(toId))
      return { ok: false, reason: 'That player is already in a party.' };

    const fromParty = this.partyOf(fromId);
    if (fromParty && fromParty.memberIds.length >= MAX_PARTY_SIZE) {
      return { ok: false, reason: 'Your party is full.' };
    }

    this.invites.set(toId, { fromId });
    return { ok: true };
  }

  /** The pending invite for a player, or undefined. `partyId` is 0 if the inviter is solo. */
  pendingInvite(playerId: number): { fromId: number; partyId: number } | undefined {
    const inv = this.invites.get(playerId);
    if (!inv) return undefined;
    return { fromId: inv.fromId, partyId: this.partyOfPlayer.get(inv.fromId) ?? 0 };
  }

  /**
   * Accept the pending invite. Creates the party if the inviter had none (inviter leads), else
   * adds the accepter to the inviter's existing party. Enforces MAX_PARTY_SIZE. Always clears the
   * pending invite, success or failure.
   */
  accept(playerId: number): { ok: true; party: Party } | { ok: false; reason: string } {
    const inv = this.invites.get(playerId);
    this.invites.delete(playerId);

    if (!inv) return { ok: false, reason: 'You have no pending invite.' };
    if (this.partyOfPlayer.has(playerId))
      return { ok: false, reason: 'You are already in a party.' };

    let party = this.partyOf(inv.fromId);
    if (!party) {
      // Inviter is solo: form a new party with the inviter as leader.
      party = { id: this.nextPartyId++, leaderId: inv.fromId, memberIds: [inv.fromId] };
      this.parties.set(party.id, party);
      this.partyOfPlayer.set(inv.fromId, party.id);
    }

    if (party.memberIds.length >= MAX_PARTY_SIZE) {
      // The party filled up between invite and accept. If we just created a solo->1 party for the
      // inviter it cannot be full (MAX_PARTY_SIZE >= 2), so no cleanup of a fresh party is needed.
      return { ok: false, reason: 'That party is full.' };
    }

    party.memberIds.push(playerId);
    this.partyOfPlayer.set(playerId, party.id);
    return { ok: true, party };
  }

  /** Decline (clear) the pending invite. No-op if none. */
  decline(playerId: number): void {
    this.invites.delete(playerId);
  }

  /**
   * Remove a player from their party. Clears any pending invite that this player is the invitee of.
   * Returns the ids of all players whose party state changed (incl. the leaver).
   *
   * Leader promotion: when the leader leaves, the next member becomes leader and is moved to the
   * front of memberIds so "leader first" ordering holds. Disband-on-<2: a party of one is not a
   * party, so if fewer than 2 members remain we dissolve it entirely (its sole member becomes solo).
   */
  leave(playerId: number): number[] {
    this.invites.delete(playerId);

    const partyId = this.partyOfPlayer.get(playerId);
    if (partyId === undefined) return [playerId]; // solo: only this player's state "changed"

    const party = this.parties.get(partyId);
    if (!party) {
      this.partyOfPlayer.delete(playerId);
      return [playerId];
    }

    const affected = [...party.memberIds]; // everyone in the party is re-broadcast, leaver included
    party.memberIds = party.memberIds.filter((id) => id !== playerId);
    this.partyOfPlayer.delete(playerId);

    if (party.memberIds.length < 2) {
      // Fewer than two members left — dissolve the party; any lone remaining member goes solo.
      for (const id of party.memberIds) this.partyOfPlayer.delete(id);
      this.parties.delete(partyId);
      return affected;
    }

    if (party.leaderId === playerId) {
      // Promote the next member to leader and move them to the front (leader-first ordering).
      const newLeader = party.memberIds[0]!;
      party.leaderId = newLeader;
      party.memberIds = [newLeader, ...party.memberIds.filter((id) => id !== newLeader)];
    }

    return affected;
  }

  /**
   * Full cleanup on disconnect: leave the party AND drop any pending invites to or from this player
   * (so a stale invite can't resolve to an offline inviter). Returns affected ids to re-broadcast.
   */
  remove(playerId: number): number[] {
    const affected = this.leave(playerId);
    for (const [toId, inv] of this.invites) {
      if (inv.fromId === playerId || toId === playerId) this.invites.delete(toId);
    }
    return affected;
  }

  /** The player's party, or undefined if solo. */
  partyOf(playerId: number): Party | undefined {
    const partyId = this.partyOfPlayer.get(playerId);
    if (partyId === undefined) return undefined;
    return this.parties.get(partyId);
  }

  /** Co-members of a player's party EXCLUDING the player themselves (empty if solo). */
  coMembers(playerId: number): number[] {
    const party = this.partyOf(playerId);
    if (!party) return [];
    return party.memberIds.filter((id) => id !== playerId);
  }
}
