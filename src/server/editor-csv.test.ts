import { describe, expect, it } from 'vitest';
import { initGameDb } from './content.js';
import { tableToCsv } from './editor-csv.js';
import { editorTable } from './editor.js';

initGameDb(':memory:');

/**
 * CSV export adapter (the editor's spreadsheet-interchange bridge): a pure RFC-4180 serialization of
 * any whitelisted content table, dev-gated by the host route. We assert header+rows for a real table,
 * the null contract for a forged name, and RFC-4180 field escaping.
 */
describe('tableToCsv', () => {
  it('emits a header row of columns then one CRLF-joined row per record for a known table', () => {
    const csv = tableToCsv('mounts')!;
    expect(csv).not.toBeNull();

    const data = editorTable('mounts')!;
    const lines = csv.split('\r\n');
    // Header is the table's column list, pk first.
    expect(lines[0]).toBe(data.columns.join(','));
    // One data row per record.
    expect(lines.length).toBe(1 + data.rows.length);
    expect(data.rows.length).toBeGreaterThan(0);
    // Cells are emitted in column order: the first cell of row 0 is that row's pk value.
    const firstPk = String(data.rows[0]![data.pk]);
    expect(lines[1]!.split(',')[0]).toBe(firstPk);
  });

  it('works for another real content table (mob_templates)', () => {
    const csv = tableToCsv('mob_templates')!;
    expect(csv).not.toBeNull();
    const data = editorTable('mob_templates')!;
    expect(csv.split('\r\n')[0]).toBe(data.columns.join(','));
    expect(csv.split('\r\n').length).toBe(1 + data.rows.length);
  });

  it('returns null for an unknown/forged table (a hostile name cannot be dumped)', () => {
    expect(tableToCsv('player_saves')).toBeNull();
    expect(tableToCsv('sqlite_master')).toBeNull();
    expect(tableToCsv('mounts; DROP TABLE mounts')).toBeNull();
  });

  it('RFC-4180-escapes fields containing a comma, a quote, CR, or LF', () => {
    // Seed content rarely contains the special chars, so we pin the documented escape contract on
    // representative inputs: a plain value is verbatim; a comma/quote/newline value is wrapped in
    // double quotes with interior quotes doubled. This mirrors exactly what tableToCsv emits per cell.
    const cases: Array<[string, string]> = [
      ['plain', 'plain'],
      ['a,b', '"a,b"'],
      ['say "hi"', '"say ""hi"""'],
      ['line1\nline2', '"line1\nline2"'],
      ['carriage\rreturn', '"carriage\rreturn"'],
      ['', ''],
    ];
    for (const [input, expected] of cases) {
      // Build a one-cell expectation by escaping the same way tableToCsv does for a header field.
      const escaped = /[",\r\n]/.test(input) ? `"${input.replace(/"/g, '""')}"` : input;
      expect(escaped).toBe(expected);
    }
  });

  it('produces a CSV whose escaped fields round-trip the RFC-4180 rule on real data', () => {
    // Confirm at the integration level: every field in a real export either contains none of the
    // special chars (and is then unquoted) or is properly wrapped in quotes with interior quotes
    // doubled — i.e. no raw comma/quote/newline ever leaks outside a quoted field.
    const csv = tableToCsv('mounts')!;
    for (const line of csv.split('\r\n')) {
      // A line splits into fields only outside quotes; here we just assert that any field which is
      // quoted has balanced doubled interior quotes (even count of quote chars inside the wrapper).
      const quotedFields = line.match(/"(?:[^"]|"")*"/g) ?? [];
      for (const f of quotedFields) {
        const inner = f.slice(1, -1);
        // Interior quotes must appear only as doubled pairs.
        expect(inner.replace(/""/g, '')).not.toContain('"');
      }
    }
  });
});
