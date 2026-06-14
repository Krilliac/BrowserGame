# Content Engine — DB as the single source of truth

> Target architecture (in progress): **all** game content lives in the SQLite database and is read
> from there at runtime — items, legendaries, spells, monsters, quests, NPCs, decor/objects,
> terrain, and themes. The TypeScript seed files are our "world-DB content" (the equivalent of
> MaNGOS / TrinityCore's `.sql` world database): they author the *default* rows, but nothing reads
> them during the game. Editing the DB (SQL or the in-game `/set` editor) changes the game.

## The model

```
  seed-*.ts  (authored defaults, TS)         <-- like TrinityCore world DB .sql files
        │  (seed / ensure*, idempotent)
        ▼
   SQLite tables  (the single runtime source of truth)
        │  content.ts (parametrized reads)
        ▼
   Content API  ──────────────►  server simulation (world.ts, …) reads ONLY from here
        │
        └── content packet ────►  ClientContentStore (client mirror; renders from the DB)
```

Two rules make something "DB-driven" here:

1. **No runtime read of a hardcoded content const.** The server resolves content through the
   `Content` API (`content.ts`), never by importing the authored array. Shared/`src/shared` modules
   that are really server-only logic (e.g. the loot/gamble rollers) take content in as parameters or
   read it via the content API — they do not import the data.
2. **The client renders from the content packet**, not from a shared data const. The packet
   (`protocol.ts` → `ClientContentStore`) already carries `areas`, `abilities`, `items`, and sprite
   `tints`; the client looks items/areas/spells up there. Shared **types** and pure UI constants
   (slot enums, labels) stay in `src/shared` — those are contract, not content.

## Status by domain

| Domain | Table(s) | Server reads DB | Client from packet | Authored in seed (not shared) |
|---|---|---|---|---|
| Areas / portals / themes | `areas`,`portals`,`area_theme` | ✅ | ✅ | ⬜ (still `shared/areas.ts`) |
| Abilities (spells) | `abilities` | ✅ | ✅ | ⬜ (still `shared/combat.ts`) |
| **Items (equipment/materials)** | `items` | ✅ | ✅ (`ItemInfo`) | ✅ `seed-items.ts` |
| **Legendaries (uniques)** | `uniques` | ✅ | n/a (sent as instances) | ✅ `seed-uniques.ts` |
| Monsters | `mob_templates`,`area_mobs` | ✅ (incl. traits/spell/support) | n/a (sent in snapshots) | ⬜ (still `mobs.ts`) |
| Loot tables | `loot_entry` | ✅ | n/a | ✅ (seed-*) |
| Dungeon population | `dungeons` | ✅ | n/a | ⬜ (`DUNGEONS` const = seed + client `isDungeon`) |
| NPCs | `npcs` | ✅ | via content/snapshots | ✅ (seed-*) |
| Decor / objects | `decor` | ✅ | via content packet | ✅ (seed-*) |
| Quests | `quests` | ✅ | via packet | partly (seed-*) |
| Vendor stock | `vendor_stock` | ✅ | via shop packet | ✅ (seed-*) |

Most domains are already DB-backed on the **server**. The remaining work is (a) eliminating the
last runtime reads of the shared data consts and (b) moving the *authored* arrays out of
`src/shared` into the seed layer so the DB is the only place content is defined.

## Phased plan

1. **Legendaries → DB.** ✅ Done. New `uniques` table seeded from `seed-uniques.ts`; `content.ts`
   loads them and owns the random pick + base resolution; `shared/uniques.ts` is now a pure,
   data-free roller. `world.ts` mints via `content.rollRandomUnique`.
2. **Items — full move.** ✅ Done. `gamble.ts` takes the equip pool as a parameter (server feeds it
   from the DB); client `item-icons.ts` reads slots from the content packet via an injected resolver
   (`setItemSlotResolver` in `main.ts`); the `EQUIPMENT`/`MATERIALS` data moved out of
   `src/shared/equipment.ts` into `seed-items.ts`, leaving only slot **types/labels** in shared.
3. **Spells → DB-authored.** Move the `ABILITIES` data to `seed-spells`/`seed-items`-style seed,
   keep `AbilityId`/types shared; server + client already read the DB/packet.
4. **Monsters — runtime → DB.** ✅ Done. Added `spell`/`support`/`traits` columns to
   `mob_templates` (traits as JSON), seeded from the authoring maps; `content.ts` loads them onto the
   template; `world.ts` and the `stepMob` AI now read `template.spell`/`template.support`/
   `template.traits` and the trait helpers take a `traits` array — no runtime read of the
   `MOB_SPELLS`/`MOB_SUPPORT`/`MOB_TRAITS` consts (which remain only as authored seed data).
   Remaining: relocate `MOB_TEMPLATES`/`AREA_MOBS` data out of `mobs.ts` into the seed layer.
5. **Dungeon population → DB.** ✅ Done. New `dungeons` table (pool as JSON + boss / mini-boss /
   elite chances + mob counts) seeded from the `DUNGEONS` const; `content.ts` exposes
   `content.dungeon(areaId)` and `world.ts` reads dungeon population from it. The `DUNGEONS` const
   stays as the structural client `isDungeon` check + the seed source.
6. **Gems & runes → DB.** Next. `GEMS` (`shared/gems.ts`) and `RUNES` (`shared/runewords.ts`) are
   still read at runtime by `world.ts` (artificer gem-combine, rune drops) and the client
   (`item-icons.ts`, runewords). Add `gems`/`runes` tables, load via `content.ts`, and ship them in
   the content packet so both sides read the DB.
7. **Authoring relocation (optional, type-safety permitting).** The `AREAS`/`ABILITIES`/
   `MOB_TEMPLATES` data still lives in `src/shared` as the seed default + the source of derived
   literal-union types (notably `AbilityId = keyof typeof ABILITY_DEFS`). These are already
   DB-driven at *runtime*; relocating the data out of shared would force those types to plain
   `string`, losing compile-time safety across the codebase. Treat these consts as the project's
   "world-DB content files" (the Trinity `.sql` analogue) unless the type trade-off is accepted.
8. **Quests.** Consolidate the scattered quest seed arrays; add area-scoped offering (the deferred
   roadmap item) now that quests are uniformly DB-driven.

Each phase keeps `npm run check` green and ships independently.
