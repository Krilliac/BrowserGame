# Canvas Map Editor

> A dev-gated, visual, top-down map editor served from the game host at `GET /editor/map`. Load an
> area's scene and see its world laid out as **layered markers** — decor/objects, creature spawns,
> NPCs, portals (area triggers), and the spawn point — then pan/zoom, toggle layers, click to
> select and inspect/edit, drag to move (persisted), and hit **Play here** to launch the live game.
> This is the spatial companion to the grid-based [In-Browser Editor](In-Browser-Editor.md): same
> data, same security model, but you edit the world _on the map_ instead of in a table.

## Security model

Identical to the [In-Browser Editor](In-Browser-Editor.md): every `/editor/*` route — the map
included — is gated by `ENGINE_ADMIN_TOKEN`, the same token that gates the privileged engine panel
(see [Privileged Engine Mode](../security/Privileged-Engine-Mode.md)). If the token is unset, every
route is disabled. The page shell at `GET /editor/map` carries **no secrets**; every data call sends
the token, so access is enforced **server-side** on each request. Writes go through the validated
`content-edit.ts` path, and table/column names come only from the trusted `db/editable.ts` registry —
a forged or sensitive table name can't be read or written.

## Launching it

1. **Set `ENGINE_ADMIN_TOKEN`** (a gitignored local `.env` is auto-loaded — see the
   [In-Browser Editor](In-Browser-Editor.md#launching-it) for details).
2. **Run the server:** `npm run dev`.
3. **Open** `http://localhost:8080/editor/map`.
4. **Paste your token** and connect. Pick an area; its scene loads as markers on the canvas.

## What you can do

- **See the area laid out spatially.** The canvas renders one marker per entity, color-coded by
  layer: decor/objects, creature spawns, NPCs, portals (area triggers), and the single spawn point.
- **Toggle layers** on and off to declutter — hide decor while you place spawns, etc.
- **Pan and zoom** to move around a large area and work at the resolution you need.
- **Click to select, then inspect and edit.** Selecting a marker opens its row; edit fields commit
  through the same validated `content-edit.ts` path as the grid editor.
- **Drag to move.** Dragging a marker rewrites its `x` / `y` and **persists** the new position
  (`POST /editor/place`); the content reloads and re-broadcasts to connected players.
- **Add new entities on the canvas.** Flip the palette from **Select** to **Add** mode, choose the
  **entity type** (decor/object, creature spawn, or NPC) and a **kind** for that type, then click the
  canvas where you want it. The click's authored coordinates become the new row's `x` / `y`
  (`POST /editor/create`). The content reloads and the new marker appears on its layer.
- **Delete the selected marker.** In Select mode, pick a marker and hit **Delete selected** to remove
  that row (`POST /editor/delete`, FK-guarded). The marker disappears and the content re-broadcasts.
- **Place, clone, and delete** entities — full CRUD, shared with the grid editor (clone copies every
  column so the new row is always valid; delete is FK-guarded).
- **Inspect live content stats.** The in-editor **Debug panel** shows diagnostics straight from
  `/editor/debug.json` — loaded state and per-table counts — so you can confirm what's actually in
  content without leaving the map.
- **Audit the content.** The **Audit** button cross-references the data via `/editor/audit.json` and
  lists integrity / referential issues (e.g. dangling foreign keys, orphaned rows), so you can spot
  and fix problems before they hit the live world.
- **Export / import the area** as a Tiled `.tmj` for round-tripping through any Tiled-aware engine
  (see [In-Browser Editor](In-Browser-Editor.md#what-you-can-do)), and **dump a table as CSV**.
- **Play here.** Launches the live game so you can immediately test the area you're editing.

## Coordinate space

The editor works in **authored coordinates** — the raw `x` / `y` stored in content, **before
world-scale** is applied at simulation time. Markers are drawn, dragged, and persisted in this
authored space, so what you place in the editor matches what's in the database. (Tiled export/import
un-scales the same way, keeping export→import→export stable.)

## Routes (all dev-gated by `ENGINE_ADMIN_TOKEN`)

| Route                       | Method     | Purpose                                                            |
| --------------------------- | ---------- | ----------------------------------------------------------------- |
| `/editor/map`               | GET        | The map-editor page shell (no secrets).                           |
| `/editor/world.json`        | GET        | Area list + full content model (schema + all rows).               |
| `/editor/scene/<areaId>.json` | GET      | One area's scene: decor/objects, spawns, NPCs, portals, spawn pt. |
| `/editor/place`             | POST       | Place / move an entity `{table,id,x,y}` (authored coords).        |
| `/editor/create`            | POST       | Create a `decor`/`creature_spawns`/`npcs` row `{table,areaId,x,y,kind}`. |
| `/editor/edit`              | POST       | Single-cell edit `{table,id,column,value}`.                       |
| `/editor/clone`             | POST       | Clone a row `{table,id,newId?}`.                                  |
| `/editor/delete`            | POST       | Delete a row (FK-guarded).                                        |
| `/editor/area/<id>.tmj`     | GET / POST | Export / import an area's map as Tiled `.tmj`.                    |
| `/editor/table/<name>.csv`  | GET        | Export a whitelisted table as CSV.                                |
| `/editor/audit.json`        | GET        | Content audit (integrity / referential checks).                   |
| `/editor/debug.json`        | GET        | Editor diagnostics (loaded state, counts).                        |

Coordinates in `/editor/scene/<areaId>.json` and `/editor/place` are **authored** (pre-world-scale).

## Key files

- `src/server/editor.ts` — the read-only, pure data-model API over the `db/editable.ts` registry,
  plus the scene assembly the map editor reads.
- `src/server/editor-page.ts` — the self-contained editor UI, including the canvas map view.
- `src/server/editor-tiled.ts` / `src/server/editor-import.ts` — Tiled export / import transforms.
- `src/server/index.ts` — wires the routes and enforces the token gate. Writes go through the
  validated `content-edit.ts` path.

## Roadmap

Today **Play here** opens the _live_ game host for the area. True **in-editor play / pause / stop of
a local sim** — running an isolated simulation inside the editor so you can step the world without
touching the live host — is a planned future slice.

## See also

- [In-Browser Editor](In-Browser-Editor.md) — the grid/table editor that shares this data and gate.
- [Privileged Engine Mode](../security/Privileged-Engine-Mode.md)
- [Content Database (SQLite)](../architecture/Content-Database.md)
- [Areas & Instances](../architecture/Areas-And-Instances.md)
