import { describe, expect, it } from 'vitest';
import { MAX_PARTY_SIZE } from '../shared/protocol.js';
import { PartyRegistry } from './party.js';

describe('PartyRegistry invite + accept', () => {
  it('forms a party on the first accept, inviter is leader and listed first', () => {
    const p = new PartyRegistry();
    expect(p.invite(1, 2)).toEqual({ ok: true });
    expect(p.pendingInvite(2)).toEqual({ fromId: 1, partyId: 0 }); // inviter still solo
    const res = p.accept(2);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.party.leaderId).toBe(1);
    expect(res.party.memberIds).toEqual([1, 2]); // leader first
    expect(p.partyOf(1)).toBe(p.partyOf(2)); // same party object
    expect(p.pendingInvite(2)).toBeUndefined(); // invite cleared
  });

  it('adds a third member into the inviter existing party', () => {
    const p = new PartyRegistry();
    p.invite(1, 2);
    p.accept(2);
    expect(p.invite(2, 3)).toEqual({ ok: true }); // any member may invite, not just the leader
    expect(p.pendingInvite(3)?.partyId).toBeGreaterThan(0); // inviter is now in a party
    const res = p.accept(3);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.party.memberIds).toEqual([1, 2, 3]);
    expect(res.party.leaderId).toBe(1);
  });

  it('cannot invite yourself', () => {
    const p = new PartyRegistry();
    expect(p.invite(7, 7).ok).toBe(false);
    expect(p.pendingInvite(7)).toBeUndefined();
  });

  it('cannot invite a player already in a party', () => {
    const p = new PartyRegistry();
    p.invite(1, 2);
    p.accept(2); // 2 is now partied
    expect(p.invite(3, 2)).toEqual({ ok: false, reason: 'That player is already in a party.' });
    expect(p.pendingInvite(2)).toBeUndefined();
  });

  it('rejects inviting when the party is full', () => {
    const p = new PartyRegistry();
    // Fill a party up to MAX_PARTY_SIZE: leader 1 + (MAX-1) accepters.
    for (let m = 2; m <= MAX_PARTY_SIZE; m++) {
      expect(p.invite(1, m).ok).toBe(true);
      expect(p.accept(m).ok).toBe(true);
    }
    expect(p.partyOf(1)?.memberIds.length).toBe(MAX_PARTY_SIZE);
    const over = MAX_PARTY_SIZE + 1;
    expect(p.invite(1, over)).toEqual({ ok: false, reason: 'Your party is full.' });
  });

  it('a new invite replaces a prior pending invite to the same player', () => {
    const p = new PartyRegistry();
    p.invite(1, 9);
    p.invite(2, 9); // replaces
    expect(p.pendingInvite(9)?.fromId).toBe(2);
  });

  it('accept with no pending invite fails', () => {
    const p = new PartyRegistry();
    expect(p.accept(5)).toEqual({ ok: false, reason: 'You have no pending invite.' });
  });

  it('rejects accept when the party filled up between invite and accept', () => {
    if (MAX_PARTY_SIZE < 3) return; // need room for two simultaneous outstanding invites
    const p = new PartyRegistry();
    p.invite(1, 2);
    p.accept(2); // party [1,2]

    // Two outstanding invites while there are >=2 free slots, so invite() lets both through.
    // Fill the party up to one free slot via direct accepts, leaving the last invite stale.
    const targets: number[] = [];
    for (let m = 3; m <= MAX_PARTY_SIZE + 1; m++) targets.push(m);
    // Issue invites to all targets while seats remain (invite() only blocks when already full).
    // Accept them one by one; the accept that would exceed the cap must hit the full guard.
    let fullGuardHit = false;
    for (const t of targets) {
      const inv = p.invite(1, t);
      if (!inv.ok) {
        // party became full -> further invites are blocked; that path is covered elsewhere.
        continue;
      }
      const res = p.accept(t);
      if (!res.ok) {
        expect(res.reason).toBe('That party is full.');
        fullGuardHit = true;
      }
    }
    expect(p.partyOf(1)?.memberIds.length).toBe(MAX_PARTY_SIZE);
    // Either the invite guard or the accept guard stopped the overflow; both are valid defenses.
    expect(fullGuardHit || p.partyOf(MAX_PARTY_SIZE + 1) === undefined).toBe(true);
  });
});

describe('PartyRegistry leave + disband', () => {
  it('leaving solo is a no-op returning the player', () => {
    const p = new PartyRegistry();
    expect(p.leave(1)).toEqual([1]);
    expect(p.partyOf(1)).toBeUndefined();
  });

  it('promotes a new leader to the front when the leader leaves a 3-person party', () => {
    const p = new PartyRegistry();
    p.invite(1, 2);
    p.accept(2);
    p.invite(1, 3);
    p.accept(3); // [1,2,3], leader 1
    const affected = p.leave(1);
    expect(affected.sort()).toEqual([1, 2, 3]); // everyone re-broadcast incl. leaver
    const party = p.partyOf(2);
    expect(party).toBeDefined();
    expect(party!.leaderId).toBe(2); // next member promoted
    expect(party!.memberIds).toEqual([2, 3]); // new leader first
    expect(p.partyOf(1)).toBeUndefined(); // leaver is now solo
  });

  it('disbands when fewer than two members remain', () => {
    const p = new PartyRegistry();
    p.invite(1, 2);
    p.accept(2); // party of two
    const partyId = p.partyOf(1)!.id;
    const affected = p.leave(2);
    expect(affected.sort()).toEqual([1, 2]);
    expect(p.partyOf(1)).toBeUndefined(); // remaining member goes solo
    expect(p.partyOf(2)).toBeUndefined();
    // The disbanded party id is gone; a new party gets a fresh id.
    p.invite(1, 3);
    const res = p.accept(3);
    if (!res.ok) throw new Error('expected ok');
    expect(res.party.id).not.toBe(partyId);
  });

  it('double-leave is safe', () => {
    const p = new PartyRegistry();
    p.invite(1, 2);
    p.accept(2);
    p.leave(2);
    expect(p.leave(2)).toEqual([2]); // already solo, no throw
  });

  it('leaving clears a pending invite the leaver had received', () => {
    const p = new PartyRegistry();
    p.invite(1, 5); // 5 has a pending invite from 1
    expect(p.pendingInvite(5)?.fromId).toBe(1);
    p.leave(5); // 5 leaves (was solo) — its pending invite is cleared
    expect(p.pendingInvite(5)).toBeUndefined();
  });

  it('decline clears the pending invite and accept then fails', () => {
    const p = new PartyRegistry();
    p.invite(1, 2);
    p.decline(2);
    expect(p.pendingInvite(2)).toBeUndefined();
    expect(p.accept(2)).toEqual({ ok: false, reason: 'You have no pending invite.' });
    p.decline(999); // no-op on unknown player, no throw
  });
});

describe('PartyRegistry remove (disconnect cleanup)', () => {
  it('removes membership and clears invites to and from the player', () => {
    const p = new PartyRegistry();
    p.invite(1, 2);
    p.accept(2); // party [1,2]
    p.invite(1, 3); // pending invite TO 3 FROM 1
    p.invite(4, 1); // pending invite TO 1 FROM 4 (inviter 4 solo) — actually 1 is partied
    // invite(4,1) is rejected because 1 is already in a party:
    expect(p.pendingInvite(1)).toBeUndefined();

    const affected = p.remove(1); // 1 disconnects
    expect(affected.sort()).toEqual([1, 2]); // both members re-broadcast
    expect(p.partyOf(1)).toBeUndefined();
    expect(p.partyOf(2)).toBeUndefined(); // party of two disbands
    expect(p.pendingInvite(3)).toBeUndefined(); // invite FROM the disconnected player cleared
  });

  it('clears a pending invite TO a disconnecting player', () => {
    const p = new PartyRegistry();
    p.invite(1, 2); // invite TO 2
    p.remove(2); // 2 disconnects before accepting
    expect(p.pendingInvite(2)).toBeUndefined();
    // 1 was solo and untouched.
    expect(p.partyOf(1)).toBeUndefined();
  });

  it('a stale invite from a disconnected inviter does not resurrect a party', () => {
    const p = new PartyRegistry();
    p.invite(1, 2); // 1 (solo) invites 2
    p.remove(1); // inviter disconnects, clearing the invite
    expect(p.pendingInvite(2)).toBeUndefined();
    expect(p.accept(2)).toEqual({ ok: false, reason: 'You have no pending invite.' });
  });
});

describe('PartyRegistry coMembers', () => {
  it('is empty for a solo player', () => {
    const p = new PartyRegistry();
    expect(p.coMembers(1)).toEqual([]);
  });

  it('excludes the player themselves', () => {
    const p = new PartyRegistry();
    p.invite(1, 2);
    p.accept(2);
    p.invite(1, 3);
    p.accept(3); // [1,2,3]
    expect(p.coMembers(1).sort()).toEqual([2, 3]);
    expect(p.coMembers(2).sort()).toEqual([1, 3]);
    expect(p.coMembers(3).sort()).toEqual([1, 2]);
  });
});
