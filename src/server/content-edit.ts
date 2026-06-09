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
