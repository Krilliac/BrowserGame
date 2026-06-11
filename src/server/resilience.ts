/**
 * Server-side resilience guards. The authoritative loop processes untrusted client messages and
 * iterates many entities every tick; one bad message or one corrupt entity must not crash the whole
 * tick loop and take every player down with it. `runGuarded` wraps a unit of work in a try/catch,
 * logs it under a stable label, and returns `undefined` on throw so the caller can skip and continue.
 *
 * `GuardStats` is a bounded error-rate tracker for an admin/health readout — which labels are
 * failing, and how often. Both pieces are pure and unit-tested.
 */

/**
 * Run `fn` and return its result; on throw, log `[guard:<label>]` with the error, invoke `onError`
 * (e.g. to bump a `GuardStats` counter), and return `undefined`. The caller decides what `undefined`
 * means — typically "skip this message/entity and carry on".
 */
export function runGuarded<T>(
  label: string,
  fn: () => T,
  onError?: (label: string, err: unknown) => void,
): T | undefined {
  try {
    return fn();
  } catch (err) {
    console.error(`[guard:${label}]`, err);
    if (onError) onError(label, err);
    return undefined;
  }
}

/** One label's failure tally for the health readout. */
export interface GuardStat {
  label: string;
  count: number;
}

/**
 * Bounded error-rate tracker. Counts failures per label and reports the worst offenders. Bounded so
 * a hostile client can't grow it without limit by triggering errors under ever-changing labels: once
 * `maxLabels` distinct labels are tracked, a brand-new label is dropped (existing labels still count).
 */
export class GuardStats {
  private readonly counts = new Map<string, number>();
  private readonly maxLabels: number;

  constructor(maxLabels: number = 64) {
    this.maxLabels = Math.max(1, maxLabels);
  }

  /** Record one failure for `label`. New labels past the cap are ignored to stay bounded. */
  record(label: string): void {
    const existing = this.counts.get(label);
    if (existing !== undefined) {
      this.counts.set(label, existing + 1);
      return;
    }
    if (this.counts.size >= this.maxLabels) return; // bounded: drop unknown labels at capacity
    this.counts.set(label, 1);
  }

  /** Total failures recorded for `label` (0 if never seen / dropped). */
  countFor(label: string): number {
    return this.counts.get(label) ?? 0;
  }

  /** Total failures across all tracked labels. */
  total(): number {
    let sum = 0;
    for (const n of this.counts.values()) sum += n;
    return sum;
  }

  /** Number of distinct labels currently tracked. */
  get size(): number {
    return this.counts.size;
  }

  /**
   * The `limit` worst offenders, highest count first. Ties break by label for a stable readout.
   */
  top(limit: number = 5): GuardStat[] {
    const all: GuardStat[] = [...this.counts].map(([label, count]) => ({ label, count }));
    all.sort((a, b) => (b.count !== a.count ? b.count - a.count : a.label.localeCompare(b.label)));
    return all.slice(0, Math.max(0, limit));
  }

  clear(): void {
    this.counts.clear();
  }
}
