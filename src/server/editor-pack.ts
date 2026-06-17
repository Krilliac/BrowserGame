/**
 * Full-world content pack export/import — the engine's "save/load the whole game as one portable
 * file" capability (and a backup/restore primitive).
 *
 * The game is fully data-driven: every area, spell, item, monster, NPC, loot table, quest, and
 * tuning knob lives in SQLite, whitelisted by the {@link EDITABLE_TABLES} registry. This module
 * serializes that whole world into one self-describing JSON document ({@link ContentPack}) and
 * applies one back, transactionally. It is the file-level sibling of the per-cell editor in
 * `content-edit.ts`/`editor.ts`: same trusted registry, same "names from code, values bound" rule.
 *
 * Faithful backup vs. editable cells: the per-cell editor (`editorTable`) exposes only the registry's
 * EDITABLE columns, but a whole-game SAVE must round-trip EVERY physical column — some tables carry
 * NOT-NULL, non-editable columns (e.g. `loot_entry.mob_template_id`) that a partial dump would drop,
 * breaking the reload. So the column set per table is read from the live DB schema
 * (`PRAGMA table_info`), like `content-edit.ts`'s clone (which does `SELECT *`). The REGISTRY still
 * gates which TABLES are touched.
 *
 * Security: an imported pack is fully untrusted. Only tables in the registry are touched (unknown
 * tables are skipped + reported); column names come from the trusted DB schema, never the pack (extra
 * pack keys are ignored), and every value is bound. The whole import runs in ONE transaction with
 * try/catch, so a malformed pack rolls back and NEVER half-applies. Exposure is dev-gated by the
 * host, like the editor and engine panels.
 */

import { getDb } from './content.js';
import { EDITABLE_TABLES } from './db/editable.js';
import type { GameDatabase } from './db/database.js';

/** A single table inside a pack: its pk, its column order (pk-first), and its rows. */
export interface PackTable {
  pk: string;
  columns: string[];
  rows: Record<string, string | number | null>[];
}

/** The serialized whole game — every physical editable table, ready to write to disk or POST back. */
export interface ContentPack {
  format: 'browsergame-pack';
  version: 1;
  tables: Record<string, PackTable>;
}

const PACK_FORMAT = 'browsergame-pack';
const PACK_VERSION = 1;

/** One row of SQLite's `PRAGMA table_info` output (only the fields we use). */
interface TableInfoRow {
  name: string;
}

/**
 * The physical column names of a table, in schema order, read from the live DB. Returns [] for a
 * name with no physical table (a virtual/derived registry entry), so the export skips it cleanly.
 * `name` always comes from the trusted {@link EDITABLE_TABLES} registry — safe to interpolate.
 */
function physicalColumns(db: GameDatabase, name: string): string[] {
  try {
    const info = db.prepare(`PRAGMA table_info(${name})`).all() as TableInfoRow[];
    return info.map((c) => c.name);
  } catch {
    return [];
  }
}

/**
 * Serialize the whole game into a {@link ContentPack}. Walks every {@link EDITABLE_TABLES} entry,
 * dumping EVERY physical column of each (so the pack is a faithful backup that round-trips, not just
 * the editable subset). Registry entries with no physical table are skipped. Values are SQLite-native
 * (string | number | null), so the result is plain JSON.
 */
export function exportPack(): ContentPack {
  const db = getDb();
  const tables: Record<string, PackTable> = {};
  for (const [name, spec] of Object.entries(EDITABLE_TABLES)) {
    const columns = physicalColumns(db, name);
    if (columns.length === 0) continue; // virtual/derived registry entry — no physical table
    // Order pk-first for readability, then the remaining physical columns in schema order.
    const ordered = [spec.pk, ...columns.filter((c) => c !== spec.pk)];
    const rows = db.prepare(`SELECT ${ordered.join(', ')} FROM ${name}`).all() as Record<
      string,
      string | number | null
    >[];
    tables[name] = { pk: spec.pk, columns: ordered, rows };
  }
  return { format: PACK_FORMAT, version: PACK_VERSION, tables };
}

/** Result of an import attempt — ok plus a human message, how many tables were written, and skips. */
export interface ImportResult {
  ok: boolean;
  message: string;
  tablesWritten: number;
  skipped: string[];
}

/** Type guard: is this unknown blob a structurally-valid pack envelope? (Rows checked per-row later.) */
function isContentPack(pack: unknown): pack is ContentPack {
  if (!pack || typeof pack !== 'object') return false;
  const p = pack as Record<string, unknown>;
  if (p.format !== PACK_FORMAT) return false;
  if (p.version !== PACK_VERSION) return false;
  if (!p.tables || typeof p.tables !== 'object') return false;
  return true;
}

/**
 * Apply a whole-world {@link ContentPack} to the given database — the load/restore primitive.
 *
 * DEFENSIVE + TRANSACTIONAL:
 *  - Validates the pack envelope (format/version/tables) before touching the DB.
 *  - In ONE transaction, for each pack table that EXISTS in the registry: DELETE every existing row,
 *    then INSERT each pack row using the table's PHYSICAL columns (read from the live DB schema, not
 *    the pack). Extra keys in a row are ignored; a missing column binds NULL; unknown tables are
 *    skipped and recorded in `skipped`.
 *  - Table name comes from the trusted registry and column names from the live schema (both safe to
 *    interpolate — never from the pack); every value is bound.
 *  - FK enforcement is deferred to commit time (so wiping + refilling FK-linked tables in any order
 *    is fine, but a genuinely inconsistent pack still fails the commit and rolls back).
 *  - Any error rolls the whole transaction back and returns { ok:false } — a bad pack never
 *    half-applies. The caller reloads + rebroadcasts content only when ok.
 */
export function importPack(db: GameDatabase, pack: unknown): ImportResult {
  if (!isContentPack(pack)) {
    return {
      ok: false,
      message: `Not a valid ${PACK_FORMAT} v${PACK_VERSION} pack.`,
      tablesWritten: 0,
      skipped: [],
    };
  }

  const skipped: string[] = [];
  let tablesWritten = 0;

  try {
    const apply = db.transaction(() => {
      // Defer FK checks to COMMIT so we can DELETE/INSERT FK-linked tables in any order within the
      // transaction; an inconsistent pack still fails at commit and rolls the whole thing back.
      db.pragma('defer_foreign_keys = ON');

      for (const [name, rawTable] of Object.entries((pack as ContentPack).tables)) {
        const spec = EDITABLE_TABLES[name];
        if (!spec || !rawTable || typeof rawTable !== 'object') {
          skipped.push(name); // unknown/forged table — never reachable as SQL
          continue;
        }
        // Column set comes from the LIVE schema, never the pack — trusted + interpolation-safe, and a
        // faithful set that includes NOT-NULL non-editable columns. Skip a registry entry with no
        // physical table (defensive; export wouldn't have emitted one).
        const cols = physicalColumns(db, name);
        if (cols.length === 0) {
          skipped.push(name);
          continue;
        }
        const rows = Array.isArray((rawTable as PackTable).rows)
          ? (rawTable as PackTable).rows
          : [];

        db.prepare(`DELETE FROM ${name}`).run();

        const placeholders = cols.map(() => '?').join(', ');
        const insert = db.prepare(
          `INSERT INTO ${name} (${cols.join(', ')}) VALUES (${placeholders})`,
        );
        for (const row of rows) {
          const r = (row ?? {}) as Record<string, unknown>;
          // Bind only known columns from the row; a missing key becomes NULL (the INSERT then fails
          // on a NOT-NULL column, rolling back — a bad pack can't write a malformed row).
          const values = cols.map((c) => normalizeValue(r[c]));
          insert.run(...values);
        }
        tablesWritten++;
      }
    });
    apply();
  } catch (e) {
    return {
      ok: false,
      message: `Import failed (rolled back): ${(e as Error).message}`,
      tablesWritten: 0,
      skipped,
    };
  }

  return {
    ok: true,
    message: `Imported ${tablesWritten} table(s)${skipped.length ? `, skipped ${skipped.length} unknown` : ''}.`,
    tablesWritten,
    skipped,
  };
}

/**
 * Coerce a row value into a SQLite-bindable scalar. Pack values are expected to be string | number |
 * null already; anything else (an object/array/undefined from a hand-edited pack) becomes NULL so
 * the bind never throws on an unexpected type — a NOT-NULL column then rejects it and rolls back.
 */
function normalizeValue(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return null;
}

/** Convenience: import a pack into the live singleton DB (the host's getDb()). */
export function importPackToDb(pack: unknown): ImportResult {
  return importPack(getDb(), pack);
}
