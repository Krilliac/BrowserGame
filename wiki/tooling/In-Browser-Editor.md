# In-Browser Editor

> A dev-gated, dependency-free visual editor for the data-driven world, served straight from the game
> host at `/editor`. Change the world from a browser — edit cells, add/remove rows, and round-trip
> any area's map through [Tiled](https://www.mapeditor.org/) — without touching SQL. This is the ED5
> Studio editor, ported, and the first cross-engine bridge.

## Security model

The whole editor is gated by `ENGINE_ADMIN_TOKEN` — the same token that gates the privileged engine
panel (see [Privileged Engine Mode](../security/Privileged-Engine-Mode.md)). If the token is unset,
every editor route is disabled. The page shell at `GET /editor` carries **no secrets**; every data
call sends the token, so access is enforced **server-side** on each request. Cell values are
HTML-escaped (XSS-safe), and table/column names come only from the trusted `db/editable.ts` registry
— a forged or sensitive table name can't be read or written.

## Launching it

1. **Set `ENGINE_ADMIN_TOKEN`.** A gitignored local `.env` is auto-loaded by the server (via Node's
   `loadEnvFile`) before any config is read, so you can put it in `.env` instead of the shell:

   ```
   ENGINE_ADMIN_TOKEN=your-secret-token
   ```

2. **Run the server:** `npm run dev`.
3. **Open** `http://localhost:8080/editor`.
4. **Paste your token** into the field and click **Connect**. The page loads the whole content model.

## What you can do

- **Edit any whitelisted cell live.** Click a cell in the grid, type, commit. The edit is validated
  by `content-edit.ts`, the content is reloaded, and the change is re-broadcast to connected players.
- **Clone a row** (per-row **Clone** button) — duplicates a row under a new primary key, copying every
  column so the new row is always valid, then tweak its cells. Create = clone + edit, so the editor is
  full CRUD.
- **Delete a row** (per-row **Delete** button) — FK-guarded: it refuses to remove a row another table
  references (e.g. a mob template a spawn points at).
- **Export an area as Tiled `.tmj`** — a faithful, re-importable snapshot of the area's decor,
  spawns, NPCs, portals, and meta as named object layers. Tiled `.tmj` imports into Godot, Unity
  (SuperTiled2Unity), GameMaker, Defold, and 001 Game Creator.
- **Import a Tiled `.tmj` back** — edit the map in any Tiled-exporting engine and load it. Coords are
  un-scaled back to authored space so export→import→export is stable. Unknown spawn templates are
  skipped (FK safety); portals and area dimensions are carried for round-trip but deliberately **not**
  overwritten (world-graph safety). The host reloads and re-broadcasts after.
- **Export an area as a Godot 4 `.tscn`** — a native-engine sibling to the Tiled export, opened
  directly in Godot. Root `Node2D` with `Decor`/`Spawns`/`Npcs`/`Portals` group nodes; each entity is
  a `Marker2D`/`Node2D` carrying a `position` plus lossless `metadata/*` (template id, npc name,
  portal target, …). Coordinate-compatible with the `.tmj` export.

## Routes (all dev-gated by `ENGINE_ADMIN_TOKEN`)

| Route                          | Method     | Purpose                                            |
| ------------------------------ | ---------- | -------------------------------------------------- |
| `/editor`                      | GET        | The editor page shell (no secrets).                |
| `/editor/world.json`           | GET        | Full content model dump (schema + all rows).       |
| `/editor/edit`                 | POST       | Single-cell edit `{table,id,column,value}`.        |
| `/editor/clone`                | POST       | Clone a row `{table,id,newId?}`.                   |
| `/editor/delete`               | POST       | Delete a row (FK-guarded).                          |
| `/editor/area/<id>.tmj`        | GET / POST | Export / import an area's map as Tiled `.tmj`.     |
| `/editor/area/<id>.tscn`       | GET        | Export an area as a Godot 4 `.tscn` scene.         |

## Key files

- `src/server/editor.ts` — the read-only, pure data-model API (`editorSchema`, `editorTable`,
  `editorWorld`, `parseEditBody`) over the `db/editable.ts` registry.
- `src/server/editor-tiled.ts` — `areaToTiled()`: pure transform of content into a Tiled map.
- `src/server/editor-godot.ts` — `areaToGodot()`: pure transform of content into a Godot `.tscn`.
- `src/server/editor-import.ts` — `tiledToContent()` / `applyTiledImport()`: defensive parser of an
  untrusted map, applied in one transaction.
- `src/server/editor-page.ts` — `EDITOR_HTML`: the self-contained editor UI.
- `src/server/index.ts` — wires the routes and enforces the token gate. Writes go through the
  validated `content-edit.ts` path.

## See also

- [Canvas Map Editor](Map-Editor.md) — the spatial, drag-to-move map view over the same data + gate.
- [Privileged Engine Mode](../security/Privileged-Engine-Mode.md)
- [Content Database (SQLite)](../architecture/Content-Database.md)
- [Content Engine (DB as source of truth)](../architecture/Content-Engine.md)
