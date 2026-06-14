/**
 * Two-party, atomic, escrow trade window (Diablo II / OSRS style) — a **pure** state machine.
 *
 * Each side stages an offer (gold + item instance uids) into escrow, both sides toggle a
 * confirmation, and only when **both** are confirmed does the trade commit into a cross-transfer
 * plan (each player receives the other's offer). Nothing here touches the World or the DB: this
 * module models *offer state + validation* only. The World executes the actual item/gold transfer
 * and MUST re-validate ownership at commit time (each uid still in the player's bag) — that is
 * deliberately NOT this module's job. See the wiring guide.
 *
 * SECURITY — the load-bearing anti-scam rule:
 *   **Any change to either offer after a confirmation invalidates BOTH players' confirmations.**
 * The classic scam is: A confirms while B shows valuable goods, then B swaps the goods out and
 * confirms before A notices. Because {@link setOffer} resets *both* `aConfirmed` and `bConfirmed`
 * on every change, a commit can only ever fire against the exact offers both sides last saw and
 * re-affirmed. There is no window in which one side's confirmation outlives a change to the table.
 *
 * Everything here is pure and deterministic — no clocks, no randomness, no I/O — so it is trivially
 * unit-testable and safe to reason about as the single source of truth for trade negotiation.
 */

/** What one side stages into escrow: gold plus the item instance uids being offered. */
export interface TradeOffer {
  /** Gold offered. Always clamped to a non-negative integer at the boundary. */
  gold: number;
  /** Item instance uids offered. Always non-negative ints, de-duplicated, order-normalised. */
  itemUids: number[];
}

/** Negotiation state for a single trade between two distinct players. */
export interface TradeSession {
  /** Player A's id (the initiator, by convention). */
  aId: number;
  /** Player B's id (the recipient, by convention). */
  bId: number;
  /** A's staged offer. */
  aOffer: TradeOffer;
  /** B's staged offer. */
  bOffer: TradeOffer;
  /** Whether A has affirmed the *current* table. Reset on any offer change. */
  aConfirmed: boolean;
  /** Whether B has affirmed the *current* table. Reset on any offer change. */
  bConfirmed: boolean;
  /** Lifecycle: 'open' while negotiating, terminal once 'committed' or 'cancelled'. */
  status: 'open' | 'committed' | 'cancelled';
}

/** A fresh, empty offer (no gold, no items). */
function emptyOffer(): TradeOffer {
  return { gold: 0, itemUids: [] };
}

/** True if the player is one of the two participants in this session. */
export function isParticipant(s: TradeSession, playerId: number): boolean {
  return playerId === s.aId || playerId === s.bId;
}

/**
 * Sanitise an untrusted offer at the boundary — never trust a client:
 *  - gold clamped to a non-negative integer (drop NaN/Infinity/fractions/negatives),
 *  - itemUids reduced to non-negative integers, de-duplicated, and sorted for deterministic state.
 *
 * Note: this does NOT prove the player owns the uids — only the World can, at commit time.
 */
function sanitiseOffer(offer: TradeOffer): TradeOffer {
  const gold = Number.isFinite(offer.gold) ? Math.max(0, Math.floor(offer.gold)) : 0;

  const seen = new Set<number>();
  for (const raw of offer.itemUids) {
    if (Number.isInteger(raw) && raw >= 0) seen.add(raw);
  }
  const itemUids = [...seen].sort((x, y) => x - y);

  return { gold, itemUids };
}

/**
 * Open a fresh trade between two **distinct** players: empty offers, neither confirmed, status
 * 'open'. Returns `null` if `aId === bId` (you cannot trade with yourself) — callers should treat
 * null as "rejected, do not open a window".
 */
export function createTrade(aId: number, bId: number): TradeSession | null {
  if (aId === bId) return null;
  return {
    aId,
    bId,
    aOffer: emptyOffer(),
    bOffer: emptyOffer(),
    aConfirmed: false,
    bConfirmed: false,
    status: 'open',
  };
}

/**
 * Stage `playerId`'s side of the table to `offer` (sanitised). Applies only if `playerId` is a
 * participant and the session is still 'open'.
 *
 * SECURITY: a successful change **resets both confirmations** — see the module header. This is the
 * single anti-scam invariant; do not weaken it to "only reset the other side".
 *
 * @returns true if the offer was applied, false if rejected (non-participant or not open).
 */
export function setOffer(s: TradeSession, playerId: number, offer: TradeOffer): boolean {
  if (s.status !== 'open' || !isParticipant(s, playerId)) return false;

  const clean = sanitiseOffer(offer);
  if (playerId === s.aId) s.aOffer = clean;
  else s.bOffer = clean;

  // The whole point of the escrow: changing the goods voids every prior affirmation, so a commit
  // can only ever happen against an offer both sides have seen in its final form.
  s.aConfirmed = false;
  s.bConfirmed = false;
  return true;
}

/**
 * Mark `playerId`'s confirmation of the *current* table. Applies only if `playerId` is a
 * participant and the session is 'open'. Confirming is idempotent (re-confirming stays true).
 *
 * @returns true if applied, false if rejected (non-participant or not open).
 */
export function confirm(s: TradeSession, playerId: number): boolean {
  if (s.status !== 'open' || !isParticipant(s, playerId)) return false;

  if (playerId === s.aId) s.aConfirmed = true;
  else s.bConfirmed = true;
  return true;
}

/** True when both participants have affirmed the current table. */
export function bothConfirmed(s: TradeSession): boolean {
  return s.aConfirmed && s.bConfirmed;
}

/** Cancel the trade (terminal). Safe to call in any state; never throws. */
export function cancel(s: TradeSession): void {
  if (s.status === 'open') s.status = 'cancelled';
}

/**
 * Commit the trade — the atomic step. Succeeds only when the session is 'open' AND both sides have
 * confirmed the current table. On success it flips status to 'committed' and returns the
 * cross-transfer plan: each player **receives** the other's offer (`toA` = B's offer,
 * `toB` = A's offer). Otherwise returns `null`.
 *
 * Idempotent: once committed (or if cancelled / not both-confirmed), every further call returns
 * null — so a duplicate commit message from a racing client cannot double-spend.
 *
 * The returned plan is what the World should *attempt* to apply, after re-validating that each
 * player still owns every uid in their offer. Validation failure there means abort + refund, never
 * a partial transfer.
 */
export function commit(
  s: TradeSession,
): { aId: number; bId: number; toA: TradeOffer; toB: TradeOffer } | null {
  if (s.status !== 'open' || !bothConfirmed(s)) return null;

  s.status = 'committed';
  return {
    aId: s.aId,
    bId: s.bId,
    toA: s.bOffer, // A receives what B offered.
    toB: s.aOffer, // B receives what A offered.
  };
}
