import { describe, it, expect } from 'vitest';
import {
  createTrade,
  setOffer,
  confirm,
  bothConfirmed,
  cancel,
  commit,
  isParticipant,
  type TradeSession,
} from './trade.js';

/** A standard 1 (A) vs 2 (B) session; throws if creation was rejected (never for distinct ids). */
function open(aId = 1, bId = 2): TradeSession {
  const s = createTrade(aId, bId);
  if (!s) throw new Error('expected a session for distinct ids');
  return s;
}

describe('createTrade', () => {
  it('opens fresh: empty offers, neither confirmed, status open', () => {
    const s = open();
    expect(s.aOffer).toEqual({ gold: 0, itemUids: [] });
    expect(s.bOffer).toEqual({ gold: 0, itemUids: [] });
    expect(s.aConfirmed).toBe(false);
    expect(s.bConfirmed).toBe(false);
    expect(s.status).toBe('open');
  });

  it('rejects a self-trade (aId === bId) with null', () => {
    expect(createTrade(7, 7)).toBeNull();
  });
});

describe('isParticipant', () => {
  it('recognises both parties and rejects outsiders', () => {
    const s = open(1, 2);
    expect(isParticipant(s, 1)).toBe(true);
    expect(isParticipant(s, 2)).toBe(true);
    expect(isParticipant(s, 3)).toBe(false);
  });
});

describe('setOffer', () => {
  it('applies a participant offer', () => {
    const s = open();
    const ok = setOffer(s, 1, { gold: 100, itemUids: [5, 6] });
    expect(ok).toBe(true);
    expect(s.aOffer).toEqual({ gold: 100, itemUids: [5, 6] });
  });

  it('ignores a non-participant (returns false, no mutation)', () => {
    const s = open(1, 2);
    const ok = setOffer(s, 99, { gold: 100, itemUids: [1] });
    expect(ok).toBe(false);
    expect(s.aOffer).toEqual({ gold: 0, itemUids: [] });
    expect(s.bOffer).toEqual({ gold: 0, itemUids: [] });
  });

  it('clamps negative gold to 0 and floors fractional gold', () => {
    const s = open();
    setOffer(s, 1, { gold: -500, itemUids: [] });
    expect(s.aOffer.gold).toBe(0);
    setOffer(s, 1, { gold: 12.9, itemUids: [] });
    expect(s.aOffer.gold).toBe(12);
  });

  it('drops non-finite gold to 0', () => {
    const s = open();
    setOffer(s, 1, { gold: Number.NaN, itemUids: [] });
    expect(s.aOffer.gold).toBe(0);
    setOffer(s, 1, { gold: Number.POSITIVE_INFINITY, itemUids: [] });
    expect(s.aOffer.gold).toBe(0);
  });

  it('de-dupes, drops negatives/non-ints, and sorts itemUids', () => {
    const s = open();
    setOffer(s, 1, { gold: 0, itemUids: [9, 9, 3, -1, 4.5, 3, 0] });
    expect(s.aOffer.itemUids).toEqual([0, 3, 9]);
  });

  it('rejects offers once the session is not open', () => {
    const s = open();
    cancel(s);
    expect(setOffer(s, 1, { gold: 1, itemUids: [] })).toBe(false);
  });
});

describe('confirm / bothConfirmed', () => {
  it('confirming both sides makes bothConfirmed true', () => {
    const s = open();
    expect(confirm(s, 1)).toBe(true);
    expect(bothConfirmed(s)).toBe(false);
    expect(confirm(s, 2)).toBe(true);
    expect(bothConfirmed(s)).toBe(true);
  });

  it('ignores confirmation from a non-participant', () => {
    const s = open(1, 2);
    expect(confirm(s, 42)).toBe(false);
    expect(s.aConfirmed).toBe(false);
    expect(s.bConfirmed).toBe(false);
  });

  it('does not confirm on a non-open session', () => {
    const s = open();
    cancel(s);
    expect(confirm(s, 1)).toBe(false);
  });
});

describe('anti-scam: changing an offer after a confirm resets BOTH confirmations', () => {
  it('voids both confirmations when either side changes the table', () => {
    const s = open();
    setOffer(s, 1, { gold: 100, itemUids: [5] });
    setOffer(s, 2, { gold: 0, itemUids: [9] });
    confirm(s, 1);
    confirm(s, 2);
    expect(bothConfirmed(s)).toBe(true);

    // B swaps the goods out after both confirmed — the classic scam. Confirmations must die.
    const ok = setOffer(s, 2, { gold: 0, itemUids: [] });
    expect(ok).toBe(true);
    expect(s.aConfirmed).toBe(false);
    expect(s.bConfirmed).toBe(false);
    expect(bothConfirmed(s)).toBe(false);

    // And a commit cannot fire against the swapped table without fresh affirmations.
    expect(commit(s)).toBeNull();
  });
});

describe('commit', () => {
  it('returns null until both sides confirm', () => {
    const s = open();
    setOffer(s, 1, { gold: 50, itemUids: [1] });
    setOffer(s, 2, { gold: 0, itemUids: [2] });
    expect(commit(s)).toBeNull();
    confirm(s, 1);
    expect(commit(s)).toBeNull();
    confirm(s, 2);
    expect(commit(s)).not.toBeNull();
  });

  it('returns the correct cross-transfer plan (each receives the other side)', () => {
    const s = open(1, 2);
    setOffer(s, 1, { gold: 100, itemUids: [10, 11] });
    setOffer(s, 2, { gold: 25, itemUids: [20] });
    confirm(s, 1);
    confirm(s, 2);

    const plan = commit(s);
    expect(plan).toEqual({
      aId: 1,
      bId: 2,
      toA: { gold: 25, itemUids: [20] }, // A receives B's offer
      toB: { gold: 100, itemUids: [10, 11] }, // B receives A's offer
    });
    expect(s.status).toBe('committed');
  });

  it('is idempotent: a second commit returns null', () => {
    const s = open();
    confirm(s, 1);
    confirm(s, 2);
    expect(commit(s)).not.toBeNull();
    expect(commit(s)).toBeNull();
    expect(s.status).toBe('committed');
  });

  it('returns null after a cancel (no commit on a cancelled trade)', () => {
    const s = open();
    confirm(s, 1);
    confirm(s, 2);
    cancel(s);
    expect(s.status).toBe('cancelled');
    expect(commit(s)).toBeNull();
  });
});

describe('cancel', () => {
  it('cancels an in-progress trade and is a no-op once terminal', () => {
    const s = open();
    setOffer(s, 1, { gold: 10, itemUids: [1] });
    confirm(s, 1);
    cancel(s);
    expect(s.status).toBe('cancelled');

    // No-op on an already-committed session (cancel must not resurrect/overwrite a terminal state).
    const s2 = open();
    confirm(s2, 1);
    confirm(s2, 2);
    commit(s2);
    cancel(s2);
    expect(s2.status).toBe('committed');
  });
});
