/**
 * CSV export adapter — the editor's spreadsheet-interchange bridge.
 *
 * Where `editor-tiled.ts` exports an area as a map for other game engines, this exports any one
 * whitelisted content table as RFC-4180 CSV — the universal interchange for spreadsheets (Excel,
 * Google Sheets, LibreOffice) and data tools. A content author can pop a table open in a spreadsheet,
 * bulk-edit, and a future slice can re-import. Pure transform of `editorTable()`'s structured rows —
 * no DB calls of its own, fully unit-testable. Exposure is dev-gated by the host route, like the rest
 * of the editor (e.g. `/editor/world.json`); table names come from the trusted registry, never the
 * client, so a forged/non-whitelisted name yields null rather than dumping an arbitrary DB table.
 */

import { editorTable } from './editor.js';

/**
 * RFC-4180 quote a single field. A field is wrapped in double quotes (with any interior `"` doubled)
 * only when it contains a comma, a double-quote, a CR, or an LF — otherwise it's emitted verbatim.
 */
function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Stringify a cell value: null/undefined become the empty string, everything else via String(). */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

/**
 * Serialize one whitelisted table to RFC-4180 CSV, or null for an unknown/non-whitelisted table (so
 * a forged name can't be dumped — this mirrors {@link editorTable}'s null contract). The output is a
 * header row of the table's columns followed by one row per record, cells emitted in `columns` order;
 * rows are joined with CRLF.
 */
export function tableToCsv(tableName: string): string | null {
  const data = editorTable(tableName);
  if (!data) return null;

  const header = data.columns.map(csvField).join(',');
  const body = data.rows.map((row) =>
    data.columns.map((col) => csvField(csvCell(row[col]))).join(','),
  );

  return [header, ...body].join('\r\n');
}
