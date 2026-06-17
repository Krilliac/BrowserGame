import { getDb } from './content.js';
import { EDITABLE_TABLES } from './db/editable.js';

/**
 * The editor's positional WRITE primitive: move a placed entity to new authored coordinates.
 *
 * The map canvas lets a Developer drag a placed marker; on drop it POSTs the new authored
 * position and the host calls {@link moveEntity}. Placement is content (it lives in the SQLite
 * world data), so a move is just an `UPDATE ... SET x=?, y=? WHERE pk=?` on the row — the same
 * trusted-name / bound-value pattern the rest of the live content editor uses
 * (`content-edit.ts`). After a successful move the host reloads + re-broadcasts content, so the
 * new placement applies to freshly created instances.
 *
 * Only a small, explicit set of tables carry AUTHORED x/y placement (decor props, creature
 * spawns, NPCs). Many editable tables have no position at all; some have an `x`/`y` that means
 * something else entirely (e.g. boss-script steps use x/y as 0..1 fractions, not world coords).
 * So this module keeps its own whitelist — {@link PLACEABLE_TABLES} — rather than trusting any
 * table that merely happens to have x/y columns. Each entry names the primary-key column and
 * whether coordinates are integers (rounded on write) or reals (stored as-is).
 */

interface PlaceableSpec {
  /** Primary-key column name (trusted — safe to interpolate into SQL). */
  pk: string;
  /** Human label for messages. */
  label: string;
  /** true → x/y are INTEGER columns and values are rounded; false → REAL, stored as-is. */
  integer: boolean;
}

/**
 * Tables whose rows carry an authored world position the canvas can drag. Names are a fixed,
 * code-owned whitelist (never client input), so the table + pk are safe to interpolate into SQL;
 * the x/y values are always bound. Column types mirror src/server/db/schema.ts.
 */
const PLACEABLE_TABLES: Record<string, PlaceableSpec> = {
  decor: { pk: 'id', label: 'decor', integer: false }, // x,y REAL
  creature_spawns: { pk: 'uid', label: 'spawn', integer: true }, // x,y INTEGER
  npcs: { pk: 'id', label: 'npc', integer: true }, // x,y INTEGER
};

/**
 * Whether a table holds draggable, authored positions — so the UI can decide which markers to
 * make draggable. True iff the table is in the placeable whitelist AND the live schema confirms
 * it has both `x` and `y` columns (a cheap guard against drift between this file and schema.ts).
 */
export function canMoveTable(table: string): boolean {
  if (!(table in PLACEABLE_TABLES)) return false;
  return hasXY(table);
}

/** Read the live column set for a table via PRAGMA and check for both x and y. */
function hasXY(table: string): boolean {
  // `table` is a key of the trusted PLACEABLE_TABLES whitelist — safe to interpolate.
  const cols = getDb().prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  return names.has('x') && names.has('y');
}

/**
 * Move a placed entity to new authored coordinates. The FIXED wire contract: the canvas POSTs
 * `{ table, id, x, y }` (authored world coords) and this performs the row update.
 *
 * Rejections (all return `{ ok: false, message }`):
 *  - table not a placeable table (or, defensively, has no x/y columns in the live schema);
 *  - no row with that primary key;
 *  - x or y not a finite number.
 *
 * On success the row's x,y are updated (rounded to int for INTEGER tables) and a clear message
 * is returned. The DB write is wrapped in try/catch so any constraint error surfaces friendly.
 */
export function moveEntity(
  table: string,
  id: string,
  x: number,
  y: number,
): { ok: boolean; message: string } {
  const spec = PLACEABLE_TABLES[table];
  if (!spec) {
    // Distinguish "valid content table but not movable" from "no such table" for a clearer hint.
    const known = table in EDITABLE_TABLES;
    return {
      ok: false,
      message: known
        ? `${table} has no movable position. Movable tables: ${Object.keys(PLACEABLE_TABLES).join(', ')}.`
        : `Unknown table: ${table}. Movable tables: ${Object.keys(PLACEABLE_TABLES).join(', ')}.`,
    };
  }
  if (!hasXY(table)) {
    return { ok: false, message: `${table} has no x/y columns to move.` };
  }

  // Coerce to finite numbers; reject NaN/Infinity (and non-numeric input that became NaN).
  let nx = Number(x);
  let ny = Number(y);
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
    return { ok: false, message: `Invalid coordinates (${x}, ${y}): x and y must be finite.` };
  }
  if (spec.integer) {
    nx = Math.round(nx);
    ny = Math.round(ny);
  }

  const db = getDb();
  if (!db.prepare(`SELECT 1 FROM ${table} WHERE ${spec.pk} = ?`).get(id)) {
    return { ok: false, message: `No such ${spec.label}: ${id}` };
  }

  try {
    // table/pk names come from the trusted whitelist; x, y, id are bound.
    db.prepare(`UPDATE ${table} SET x = ?, y = ? WHERE ${spec.pk} = ?`).run(nx, ny, id);
  } catch (e) {
    return { ok: false, message: `Move failed: ${(e as Error).message}` };
  }
  return {
    ok: true,
    message: `Moved ${spec.label} ${id} to (${nx}, ${ny}) on ${table} — applied live.`,
  };
}
