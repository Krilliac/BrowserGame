import { getDb } from './content.js';

/**
 * The editor's positional CREATE primitive: drop a NEW placeable entity at authored coordinates.
 *
 * The map canvas's Add palette lets a Developer pick a placeable kind and click the map; on click it
 * POSTs the target table + area + authored world position + kind, and the host calls
 * {@link createEntity}. Placement is content (it lives in the SQLite world data), so a create is just
 * an `INSERT` into the row's table — the same trusted-name / bound-value pattern the rest of the live
 * content editor uses (`editor-place.ts`, `content-edit.ts`). After a successful create the host
 * reloads + re-broadcasts content, so the new entity applies to freshly created instances.
 *
 * This is the mirror of {@link import('./editor-place.js').moveEntity}: only the same small set of
 * tables carry authored x/y placement (decor props, creature spawns, NPCs), so this module keeps the
 * SAME explicit whitelist rather than trusting any table that merely happens to have x/y columns.
 * Each placeable table needs a slightly different INSERT (its own NOT-NULL columns and FK), so the
 * shape is per-table rather than generic.
 */

/**
 * Build the column list + bound values for a placeable table's INSERT, or return an error string if
 * the request is invalid for that table (e.g. an unknown creature template — the FK column). `x`/`y`
 * are already finite; this rounds them to int for the INTEGER-coord tables. Table + column names are
 * fixed code constants (never client input), so they are safe to interpolate; every value is bound.
 */
function buildInsert(
  table: string,
  areaId: string,
  x: number,
  y: number,
  kind: string,
): { cols: string[]; values: (string | number | null)[]; label: string } | { error: string } {
  switch (table) {
    case 'decor':
      // decor: x,y are REAL; kind is the decor kind string (e.g. 'rock'). The optional shape
      // columns (x2/y2/color/scale) default to NULL — a single-point prop.
      return {
        label: 'decor',
        cols: ['area_id', 'kind', 'x', 'y', 'x2', 'y2', 'color', 'scale'],
        values: [areaId, kind, x, y, null, null, null, null],
      };
    case 'creature_spawns': {
      // creature_spawns: template_id = kind, an FK into mob_templates — validate it exists (else the
      // INSERT would fail an FK constraint with an opaque message). x,y are INTEGER; flags 0.
      if (!getDb().prepare('SELECT 1 FROM mob_templates WHERE id = ?').get(kind)) {
        return { error: `Unknown creature template: ${kind}. It must exist in mob_templates.` };
      }
      return {
        label: 'spawn',
        cols: ['area_id', 'template_id', 'x', 'y', 'flags'],
        values: [areaId, kind, Math.round(x), Math.round(y), 0],
      };
    }
    case 'npcs':
      // npcs: name defaults to kind (renameable later via the inspector), hue 0, npc_flags 0; kind is
      // the NPC role/sprite (e.g. 'vendor'). x,y are INTEGER.
      return {
        label: 'npc',
        cols: ['area_id', 'name', 'x', 'y', 'hue', 'kind', 'npc_flags'],
        values: [areaId, kind, Math.round(x), Math.round(y), 0, kind, 0],
      };
    default:
      return {
        error: `${table} is not a creatable placeable. Creatable tables: decor, creature_spawns, npcs.`,
      };
  }
}

/**
 * Create a new placed entity at authored coordinates. The FIXED wire contract: the canvas POSTs
 * `{ table, areaId, x, y, kind }` (authored world coords) and this performs the row insert.
 *
 * Rejections (all return `{ ok: false, message }`):
 *  - areaId is not a real area;
 *  - x or y is not a finite number;
 *  - table is not one of the three placeable tables;
 *  - (creature_spawns only) kind is not an existing mob_templates id (the FK column).
 *
 * On success the new row is inserted (x,y rounded to int for the INTEGER-coord tables) and the new
 * row's id (String of lastInsertRowid) is returned. The INSERT is wrapped in try/catch so any
 * constraint error surfaces friendly rather than throwing.
 */
export function createEntity(
  table: string,
  areaId: string,
  x: number,
  y: number,
  kind: string,
): { ok: boolean; message: string; id?: string } {
  // Coerce coordinates to finite numbers; reject NaN/Infinity (or non-numeric input that became NaN).
  const nx = Number(x);
  const ny = Number(y);
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
    return { ok: false, message: `Invalid coordinates (${x}, ${y}): x and y must be finite.` };
  }

  const db = getDb();
  // areaId is the only client string interpolated nowhere — it is bound here as a placement target.
  if (!db.prepare('SELECT 1 FROM areas WHERE id = ?').get(areaId)) {
    return { ok: false, message: `Unknown area: ${areaId}.` };
  }

  const plan = buildInsert(table, areaId, nx, ny, kind);
  if ('error' in plan) return { ok: false, message: plan.error };

  try {
    // plan.cols are fixed code constants (safe to interpolate); plan.values are all bound.
    const placeholders = plan.cols.map(() => '?').join(',');
    const info = db
      .prepare(`INSERT INTO ${table} (${plan.cols.join(',')}) VALUES (${placeholders})`)
      .run(...plan.values);
    const id = String(info.lastInsertRowid);
    return {
      ok: true,
      message: `Created ${plan.label} ${id} (${kind}) at (${nx}, ${ny}) in ${areaId} — applied live.`,
      id,
    };
  } catch (e) {
    return { ok: false, message: `Create failed: ${(e as Error).message}` };
  }
}
