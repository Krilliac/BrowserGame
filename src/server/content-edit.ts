import { getDb } from './content.js';
import { EDITABLE_TABLES, coerceColumn, type ColumnSpec } from './db/editable.js';

/**
 * Generic live content editor — the in-game engine for the whole content DB. A Developer can edit
 * any whitelisted table/column at runtime (`/set`), inspect rows (`/get`), and discover the schema
 * (`/tables`, `/cols`). All writes are validated/clamped at the boundary (`coerceColumn`) and the
 * table/column/pk names come from the `EDITABLE_TABLES` whitelist, so they are safe to interpolate
 * into SQL; values and ids are always bound. The host (index.ts) reloads + re-broadcasts content
 * after a successful edit, so changes apply live (numbers read per-use by the sim update instantly;
 * structural changes like new spawns/NPC placement apply to freshly created instances).
 */

const LIST_LIMIT = 60;

/** One-line description of a column's type + range, for `/cols`. */
function describeColumn(name: string, c: ColumnSpec): string {
  let t: string = c.type;
  if (c.type === 'enum') t = `enum(${(c.values ?? []).join('|')})`;
  else if (c.min !== undefined || c.max !== undefined) t += `[${c.min ?? ''}..${c.max ?? ''}]`;
  return `${name}:${t}${c.nullable ? '?' : ''}`;
}

/** `/tables` — the editable tables and their primary keys. */
export function listTables(): string {
  const tables = Object.entries(EDITABLE_TABLES)
    .map(([name, spec]) => `${name} (${spec.label}, pk=${spec.pk})`)
    .join(', ');
  return `Editable tables: ${tables}`;
}

/** `/cols <table>` — the editable columns of a table. */
export function listColumns(table: string): string {
  const spec = EDITABLE_TABLES[table];
  if (!spec) return `Unknown table: ${table}. Try /tables.`;
  const cols = Object.entries(spec.columns)
    .map(([name, c]) => describeColumn(name, c))
    .join('  ');
  return `${table} columns: ${cols}${spec.note ? `  — note: ${spec.note}` : ''}`;
}

/** `/get <table>` with no id — list the primary keys present. */
export function listRows(table: string): string {
  const spec = EDITABLE_TABLES[table];
  if (!spec) return `Unknown table: ${table}. Try /tables.`;
  const rows = getDb()
    .prepare(`SELECT ${spec.pk} AS id FROM ${table} LIMIT ${LIST_LIMIT + 1}`)
    .all() as { id: string | number }[];
  const ids = rows.slice(0, LIST_LIMIT).map((r) => String(r.id));
  const more = rows.length > LIST_LIMIT ? ' …' : '';
  return `${table} ${spec.pk}s (${ids.length}): ${ids.join(', ')}${more}`;
}

/** `/get <table> <id>` — show a row's columns and values. */
export function getRow(table: string, id: string): string {
  const spec = EDITABLE_TABLES[table];
  if (!spec) return `Unknown table: ${table}. Try /tables.`;
  const row = getDb().prepare(`SELECT * FROM ${table} WHERE ${spec.pk} = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return `No such ${spec.label}: ${id}`;
  const pairs = Object.entries(row).map(([k, v]) => `${k}=${v === null ? 'null' : String(v)}`);
  return `${table}[${id}]: ${pairs.join('  ')}`;
}

/** `/set <table> <id> <column> <value>` — validate, write, and report. */
export function editContent(
  table: string,
  id: string,
  column: string,
  raw: string,
): { ok: boolean; message: string } {
  const spec = EDITABLE_TABLES[table];
  if (!spec) return { ok: false, message: `Unknown table: ${table}. Try /tables.` };
  if (!(column in spec.columns)) {
    return {
      ok: false,
      message: `Column ${column} is not editable on ${table}. Try /cols ${table}.`,
    };
  }
  const coerced = coerceColumn(table, column, raw);
  if (!coerced.ok) return { ok: false, message: coerced.error };

  const db = getDb();
  if (!db.prepare(`SELECT 1 FROM ${table} WHERE ${spec.pk} = ?`).get(id)) {
    return { ok: false, message: `No such ${spec.label}: ${id}` };
  }
  db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${spec.pk} = ?`).run(coerced.value, id);
  const note = spec.note ? ` (${spec.note})` : '';
  return { ok: true, message: `Set ${table}.${column} = ${raw} on ${id} — applied live.${note}` };
}

/**
 * Duplicate an existing row under a new primary key — the editor's "create" primitive. Cloning copies
 * EVERY column (so the new row always satisfies NOT-NULL/shape constraints), then the caller tweaks
 * cells via {@link editContent}. For a text-pk table `newId` is required (and must be free); for an
 * auto-increment-pk table omit it and the DB assigns one. Table/pk/column names come from the row
 * itself + the trusted registry (safe to interpolate); all values are bound. Returns the new id.
 */
export function cloneRow(
  table: string,
  srcId: string,
  newId?: string,
): { ok: boolean; message: string; id?: string } {
  const spec = EDITABLE_TABLES[table];
  if (!spec) return { ok: false, message: `Unknown table: ${table}. Try /tables.` };
  const db = getDb();
  const src = db.prepare(`SELECT * FROM ${table} WHERE ${spec.pk} = ?`).get(srcId) as
    | Record<string, string | number | null>
    | undefined;
  if (!src) return { ok: false, message: `No such ${spec.label}: ${srcId}` };

  const wantId = (newId ?? '').trim();
  if (wantId && db.prepare(`SELECT 1 FROM ${table} WHERE ${spec.pk} = ?`).get(wantId)) {
    return { ok: false, message: `${spec.label} "${wantId}" already exists.` };
  }
  const cols = Object.keys(src).filter((c) => c !== spec.pk);
  const insertCols = wantId ? [spec.pk, ...cols] : cols;
  const values = wantId ? [wantId, ...cols.map((c) => src[c]!)] : cols.map((c) => src[c]!);
  const placeholders = insertCols.map(() => '?').join(',');
  try {
    const info = db
      .prepare(`INSERT INTO ${table} (${insertCols.join(',')}) VALUES (${placeholders})`)
      .run(...values);
    const id = wantId || String(info.lastInsertRowid);
    return { ok: true, message: `Cloned ${srcId} → ${id} on ${table} — applied live.`, id };
  } catch (e) {
    // A text-pk table cloned with no newId hits a NOT-NULL/PK error here — report it cleanly.
    return { ok: false, message: `Clone failed: ${(e as Error).message}` };
  }
}

/**
 * Delete a row — the editor's "remove" primitive. Fails cleanly if the row is referenced by another
 * table (SQLite FK enforcement is on), e.g. deleting a mob template a creature_spawn points at.
 */
export function deleteRow(table: string, id: string): { ok: boolean; message: string } {
  const spec = EDITABLE_TABLES[table];
  if (!spec) return { ok: false, message: `Unknown table: ${table}. Try /tables.` };
  const db = getDb();
  if (!db.prepare(`SELECT 1 FROM ${table} WHERE ${spec.pk} = ?`).get(id)) {
    return { ok: false, message: `No such ${spec.label}: ${id}` };
  }
  try {
    db.prepare(`DELETE FROM ${table} WHERE ${spec.pk} = ?`).run(id);
    return { ok: true, message: `Deleted ${spec.label} ${id} from ${table} — applied live.` };
  } catch (e) {
    return {
      ok: false,
      message: `Delete failed (referenced by other content?): ${(e as Error).message}`,
    };
  }
}
