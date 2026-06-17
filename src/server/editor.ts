/**
 * Editor data-model API — slice 1 of the in-browser game editor (the ED5-studio port).
 *
 * The game is fully data-driven (all content lives in SQLite), and `db/editable.ts` already defines
 * the whitelisted, typed registry of every editable table/column. This module serializes that world
 * model into a structured, machine-readable shape an editor UI can render and an exporter can walk —
 * the foundation for both the visual editor (slice 2+) and cross-engine import/export (the north
 * star: the content model IS the engine's data; adapters translate other engines' formats in/out).
 *
 * Read-only + pure (queries the live DB via the trusted registry). Writes still go through the
 * validated `content-edit.ts` path. Exposure is dev-gated by the host, like the engine panel.
 */

import { getDb } from './content.js';
import { EDITABLE_TABLES, type ColumnSpec } from './db/editable.js';

/** One column in the editor schema (the registry's {@link ColumnSpec} plus its name). */
export interface EditorColumn extends ColumnSpec {
  name: string;
}

/** One editable table's schema: its key, label, note, and typed columns (pk-first). */
export interface EditorTableSchema {
  name: string;
  pk: string;
  label: string;
  note?: string;
  columns: EditorColumn[];
}

/** The full editor schema — every editable table, ready for a UI to render forms from. */
export interface EditorSchema {
  tables: EditorTableSchema[];
}

/** A table's structured contents: column order + the rows (capped). */
export interface EditorTableData {
  name: string;
  pk: string;
  columns: string[];
  rows: Record<string, unknown>[];
  /** True if rows were truncated to {@link ROW_CAP}. */
  truncated: boolean;
}

/** Cap on rows returned per table — generous, but bounds a dump of a large content table. */
export const ROW_CAP = 2000;

/** The editable world schema: each whitelisted table with its typed, editable columns (pk first). */
export function editorSchema(): EditorSchema {
  const tables = Object.entries(EDITABLE_TABLES).map(([name, spec]): EditorTableSchema => {
    const columns: EditorColumn[] = Object.entries(spec.columns).map(([col, c]) => ({
      name: col,
      ...c,
    }));
    return {
      name,
      pk: spec.pk,
      label: spec.label,
      ...(spec.note !== undefined ? { note: spec.note } : {}),
      columns,
    };
  });
  return { tables };
}

/**
 * A whitelisted table's rows as structured records (pk + every editable column). Returns null for an
 * unknown table (so a hostile/typo'd name can't read an arbitrary DB table — names come from the
 * trusted registry, never the client). Rows are capped at {@link ROW_CAP}.
 */
export function editorTable(name: string): EditorTableData | null {
  const spec = EDITABLE_TABLES[name];
  if (!spec) return null;
  // Column list is the registry's editable columns plus the pk, all trusted code constants — safe to
  // interpolate (the content-edit.ts path interpolates the same registry names; values stay bound).
  const cols = [spec.pk, ...Object.keys(spec.columns)];
  const select = cols.join(', ');
  // A registry entry may not map to a physical table (e.g. a virtual/derived one); tolerate that by
  // returning null rather than throwing, so a full-world dump never breaks on one odd entry.
  let rows: Record<string, unknown>[];
  try {
    rows = getDb()
      .prepare(`SELECT ${select} FROM ${name} LIMIT ${ROW_CAP + 1}`)
      .all() as Record<string, unknown>[];
  } catch {
    return null;
  }
  const truncated = rows.length > ROW_CAP;
  return {
    name,
    pk: spec.pk,
    columns: cols,
    rows: truncated ? rows.slice(0, ROW_CAP) : rows,
    truncated,
  };
}

/** A validated single-cell edit request from the editor UI's POST body. */
export interface EditRequest {
  table: string;
  id: string;
  column: string;
  value: string;
}

/**
 * Validate an untrusted `POST /editor/edit` body into an {@link EditRequest}, or null if malformed.
 * Only shape/type checking here — the actual table/column whitelist + value coercion happens in
 * `content-edit.ts` (`editContent`), so a bad table/column is still rejected there.
 */
export function parseEditBody(raw: unknown): EditRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.table !== 'string' || typeof o.column !== 'string') return null;
  if (o.table === '' || o.column === '') return null;
  // id and value may arrive as string or number (a numeric pk / value); normalize to string.
  if (o.id === undefined || o.id === null || typeof o.id === 'object') return null;
  if (o.value === undefined || o.value === null || typeof o.value === 'object') return null;
  return { table: o.table, id: String(o.id), column: o.column, value: String(o.value) };
}

/**
 * A full dump of the editable world — the schema plus every table's rows. This is the serialized
 * content model: what the editor loads, and the source an exporter walks to translate the game into
 * another engine's format (the cross-engine north star).
 */
export function editorWorld(): { schema: EditorSchema; tables: Record<string, EditorTableData> } {
  const schema = editorSchema();
  const tables: Record<string, EditorTableData> = {};
  for (const t of schema.tables) {
    const data = editorTable(t.name);
    if (data) tables[t.name] = data;
  }
  return { schema, tables };
}
