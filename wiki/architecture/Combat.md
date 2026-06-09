# Combat, Monsters & Rendering

> How the world comes alive: terrain, characters, monsters, and direct-action abilities —
> WoW/Diablo/WC3 flavor with RuneScape-style roaming monsters. Server-authoritative throughout.

## What's rendered

- **World** (`src/client/draw.ts` → `drawWorld`) — per-area biomes (grassy town, dark wilderness,
  stone crypt) drawn as tiles, with deterministic scattered props (trees, graves) generated from a
  position hash so the world is detailed without any stored map.
- **Characters** (`drawCharacter`) — players and monsters as top-down figures with a facing blade,
  class/monster color, name + level, and a health bar. Your own character has a gold ring.
- **Projectiles** (`drawProjectile`) — fireballs (glowing orbs), arrows (oriented streaks),
  frostbolts (cyan orbs), colored from the shared ability table.
- **Effects** (`drawFx`) — floating damage numbers, melee swing arcs, cast flashes, and death
  bursts, faded by age.
- **HUD** (`src/client/main.ts` → `drawHud`) — Diablo-style HP/MP bars and a 1–4 ability hotbar
  with client-predicted cooldown sweeps and a death overlay.

## Abilities (`src/shared/combat.ts`)

| Key | Ability | Kind | Notes |
|---|---|---|---|
| 1 | Slash | melee | Cone hit in front; no mana, short cooldown |
| 2 | Fireball | projectile | High damage, costs mana |
| 3 | Arrow | projectile | Fast, cheap, low damage |
| 4 | Frostbolt | projectile | Slow, moderate damage |

The shared `ABILITIES` table is the single source of truth for damage, range, cooldown, mana, and
render color — used by both the authoritative server and the client HUD/renderer.

## Authority & flow

1. Client sends `{ t:'cast', ability, dx, dy }` — an **aim direction**, never a result.
2. Server (`World.cast`) validates **alive / cooldown / mana**, sets facing, and either resolves a
   melee cone (`inMeleeCone`) or spawns a server-simulated projectile.
3. Each tick the World steps projectiles (`circlesOverlap` vs monsters), runs monster AI
   (`src/server/mobs.ts`: aggro → chase → melee), applies damage, and handles death/respawn.
4. Damage, deaths, swings, and casts are emitted as **`FxEvent`s** in the snapshot; the client
   renders them. Personal HP/MP come via the per-player `you` message.

Nothing about damage, hits, or death is decided on the client — it only *draws* what the server
resolved. A cheating client can mis-aim but cannot fake a kill.

## Monsters (`src/server/mobs.ts`)

RuneScape-flavored: roaming, respawning creatures defined by templates (Gloom Wolf, Crypt
Skeleton, Cave Bat) placed per area (`AREA_MOBS`). Town is a safe zone. The AI step is a pure,
unit-tested function; the World owns mob state, wandering, and respawns.

## What's next

- XP / leveling and loot drops on kill (the next SparkGameMMO blueprint systems).
- More abilities + cooldown/resource variety; status effects (frost slow).
- Sprite art to replace the primitive shapes (the renderer is isolated in `draw.ts`).

## See also

- [Architecture Overview](Overview.md)
- [Areas & Instances](Areas-And-Instances.md)
- [Threat Model](../security/Threat-Model.md)
