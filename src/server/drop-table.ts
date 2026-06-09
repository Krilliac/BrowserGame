/**
 * Drop tables: a generic weighted drop-table engine, RuneScape-style. A table does one
 * weighted "main" roll, plus optional independent "always" rows and an optional nested rare
 * sub-table reached at a small chance. All randomness is injected (`rng`) so rolls are pure
 * and unit-testable. This module is intentionally generic over the value type so the loot
 * system (or anything else) can reuse it; it imports nothing game-specific.
 */

/** One row of a drop table: produce `value` with the given relative weight, in qty [min,max]. */
export interface DropRow<V> {
  value: V;
  weight: number; // relative weight within its table
  min?: number; // default 1
  max?: number; // default 1
  /** If true this row is "nothing" (a blank) — selected but yields no drop. */
  nothing?: boolean;
}

/** A drop table: one weighted main roll, plus an optional nested rare sub-table. */
export interface DropTable<V> {
  /** Rows that always drop independently (e.g. guaranteed gold). Optional. */
  always?: DropRow<V>[];
  /** Exactly one of these is selected per roll, by weight. */
  main: DropRow<V>[];
  /** Optional rare table: with probability `chance`, also roll once on `table`. */
  rare?: { chance: number; table: DropRow<V>[] };
}

/** A single produced drop: a value and the quantity rolled for it. */
export interface Drop<V> {
  value: V;
  qty: number;
}

/** Pick one row from weighted rows. Returns null if rows empty or total weight <= 0. */
export function rollWeighted<V>(
  rows: DropRow<V>[],
  rng: () => number = Math.random,
): DropRow<V> | null {
  let total = 0;
  for (const row of rows) {
    if (row.weight > 0) total += row.weight;
  }
  if (total <= 0) return null;

  let t = rng() * total;
  for (const row of rows) {
    if (row.weight <= 0) continue;
    t -= row.weight;
    if (t < 0) return row;
  }
  // Float rounding fallback: return the last positive-weight row.
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row && row.weight > 0) return row;
  }
  return null;
}

/**
 * Roll the quantity for a selected row in [min, max] (min default 1, max default min). Returns
 * 0 for a `nothing` row or any non-positive result, signalling "produce no drop".
 */
function rollQty<V>(row: DropRow<V>, rng: () => number): number {
  if (row.nothing) return 0;
  const min = row.min ?? 1;
  const max = row.max ?? min;
  const span = max - min + 1;
  const qty = min + Math.floor(rng() * span);
  return qty > 0 ? qty : 0;
}

/**
 * Roll a full table: every `always` row (each independent), one weighted `main` selection, and —
 * if a rare table is present and the gate draw is below `chance` — one weighted pick from it.
 * Drops sharing the same `value` are merged into one summed `Drop`. Deterministic given `rng`.
 */
export function rollDropTable<V>(table: DropTable<V>, rng: () => number = Math.random): Drop<V>[] {
  const order: V[] = [];
  const byValue = new Map<V, number>();

  const add = (row: DropRow<V> | null): void => {
    if (!row) return;
    const qty = rollQty(row, rng);
    if (qty <= 0) return;
    if (!byValue.has(row.value)) order.push(row.value);
    byValue.set(row.value, (byValue.get(row.value) ?? 0) + qty);
  };

  for (const row of table.always ?? []) add(row);

  add(rollWeighted(table.main, rng));

  if (table.rare && rng() < table.rare.chance) {
    add(rollWeighted(table.rare.table, rng));
  }

  return order.map((value) => ({ value, qty: byValue.get(value) ?? 0 }));
}
