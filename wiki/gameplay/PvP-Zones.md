# PvP Zones

> Player-vs-player combat, gated per area. Server-authoritative — players never assert who they can
> hit; the server decides from the area's rule and both players' opt-in flags.

## The three rules

Each area has one of three PvP rules. Absent from the table = `safe`.

| Rule        | Behavior                                                       | Where                        |
| ----------- | -------------------------------------------------------------- | ---------------------------- |
| `safe`      | No PvP. The default — towns and leveling zones.                | Everywhere not listed.       |
| `contested` | Only players who **both** opted in via `/pvp` can harm each other. | Endgame zones (seeded).      |
| `hostile`   | Free-for-all; anyone can harm anyone.                          | (none seeded yet)            |

Seeded contested endgame zones: **Voidmarch**, **Sundered Wastes**, **The Unmade Court**.

## How it works

- `/pvp` toggles your opt-in flag (only meaningful in a contested zone).
- Both melee cones and direct projectiles strike attackable players, routed through a single
  `canHarmPlayer` gate and `applyPvpDamage`.
- Damage is scaled by `PVP_DAMAGE_SCALE` (**0.35**) so duels last and nothing one-shots; armor,
  vulnerability, and god-mode still apply. God-mode players and the dead are immune.
- A kill announces to both the slayer and the victim.

Spell behaviors (chain / fork / splash) and beams stay **PvE-only** for now.

## Commands

- `/pvp` — toggle your PvP flag.

## Key files & data

- `src/server/world.ts` — `canHarmPlayer`, `applyPvpDamage`, `pvpProjectileHit`, `togglePvp`,
  `PVP_DAMAGE_SCALE`, `pvpRule()`.
- `area_pvp` table (no migration; absent = safe) mapped onto `AreaDef.pvp`.
- Seeded in `src/server/db/seed.ts`.

## See also

- [Areas & Instances](../architecture/Areas-And-Instances.md)
- [Combat, Monsters & Rendering](../architecture/Combat.md)
