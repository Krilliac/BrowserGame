# Companions — Minions, Pets & Mounts

> Three ways to bring a friend (or a faster horse): raise undead **minions**, **tame** a wild beast
> as a pet, or buy a **mount**. All three are server-authoritative, persist with the character, and
> are data-driven — adding content is a DB edit, not a code change.

## Summoned minions

A `kind:'summon'` ability raises a friendly minion that follows you and fights nearby monsters with
the hireling follow-and-fight AI. Minions persist until slain (no timer), and you may field up to
`MAX_MINIONS_PER_OWNER` (**5**) at once. Crossing an area dismisses them.

The system is **flag-driven, not skeleton-specific**: a minion is raised from _any_ creature whose
mob template carries the `summonable` flag. Adding a new summon is pure content — set the flag and
point a summon ability at the template. The minion's combat stats, AI archetype, and sprite all
come from that source template (scaled to caster level; weaker than the wild creature since you
field several). Minions render as the source creature with a green ally health bar
(`EntityState.friendly`) and are targeted/damaged by monsters through the same paths as hirelings.

Seeded with three skeleton summons and their grimoire tomes:

| Tome                          | Teaches ability         | Raises           |
| ----------------------------- | ----------------------- | ---------------- |
| Grimoire of Bone              | `raise_skeleton`        | Skeleton warrior |
| Grimoire of the Bound Dead    | `raise_skeleton_mage`   | Skeleton mage    |
| Grimoire of the Bone Volley   | `raise_skeleton_archer` | Skeleton archer  |

Learn a tome, then cast the ability to raise a minion in front of you.

### Key files & data

- `src/server/minions.ts` — pure stat/AI mapping (`minionFromTemplate`, `MinionProfile`).
- `src/server/world.ts` — owns spawning, the cap, damage, death, and attacks.
- `mob_templates.summonable` column (schema + migration #8). `AbilityKind` gains `'summon'`; the
  summon details ride in the ability's `behaviors_json` (no new ability column).

## Pets (beast taming)

Tame a wild creature as a single persistent companion:

1. Learn **Tame Beast** from the **Beastbinder Codex** tome (teaches the `tame` ability).
2. Wound a `tameable` creature to at or below **30%** HP (`TAME_HP_THRESHOLD`).
3. Cast Tame while standing near it — the nearest weakened tameable beast in range becomes your pet.

A pet follows you, fights with the same minion AI, is **saved and re-spawned across areas**, and is
**lost if it dies** (tame another). You may keep **one pet at a time**, and it does _not_ count
against the summon cap. Pets reuse the minion infrastructure (a `persistent` ally) — they render as
their source creature with a friendly health bar and take monster damage through the shared paths.

### Bonding & evolution

A pet **grows with you**. Every kill it shares (any monster you get credit for while it's alive)
earns it bond XP. At each threshold it climbs a **bond tier** that adds **+18% HP and damage** on top
of its owner-level base stats. Reaching the top tier (**5**) is its **evolution** — a fully-bonded
companion roughly **+90%** stronger, marked `★ EVOLVED`. A tier-up grants the HP increase (never a
free full heal), and bond progress is **saved with the pet** (carried across areas/relogs) — but lost
with the pet if it dies. `/pet` shows the current bond level and XP toward the next.

- `/pet` — show your current pet, its bond level, and progress.
- `/pet dismiss` (or `release`) — release it.

Seeded tameable beasts: **Gloom Wolf** and **Gloom Boar** (plus the wider tameable beast roster).

### Key files & data

- `mob_templates.tameable` flag (migration #9).
- `src/server/world.ts` — the tame capture (`tame` ability handler), pet save/respawn, `/pet`, and
  the bond system (`awardPetXp`/`refreshPetStats`/`scaleProfileForPet`; `PET_MAX_TIER`,
  `PET_XP_PER_TIER`, `PET_TIER_BONUS`). Bond xp/tier persist on `PlayerSave.pet`.

## Mounts

A mount is a **thing you own**, not a timed buff: bought once from a town Stablemaster, kept on the
character forever, and toggled on/off for a large move-speed multiplier. The multiplier folds into
`playerMoveMul` so the client predictor stays in sync (no special movement code), and both ownership
and the active mount persist across area crossings.

Buy mounts from **Hoss the Stablemaster** in town (NPC flag `STABLE`; press **E** on him to list
them). Three tiers are seeded as a recurring gold sink:

| Mount          | Speed   | Price       |
| -------------- | ------- | ----------- |
| Dustback Mule  | +40%    | 1,200 gold  |
| War Courser    | +70%    | 6,000 gold  |
| Dread Destrier | +100%   | 20,000 gold |

### Commands

- `/mounts` — list mounts you own and what a Stablemaster sells.
- `/mount [mountId]` — ride a mount you own; no id dismounts.
- `/buymount <mountId>` — buy a mount (stand near a Stablemaster).

### Key files & data

- `src/server/mounts.ts` — `MountDef`, `DEFAULT_MOUNTS` (seed/fallback), `findMount`.
- `src/server/world.ts` — owned-set, active mount, `mountStatus` / `toggleMount` / `buyMount`.
- `mounts` content table (no migration — `CREATE TABLE IF NOT EXISTS`), `NpcFlags.STABLE`.

## See also

- [Combat, Monsters & Rendering](../architecture/Combat.md)
- [Content Database (SQLite)](../architecture/Content-Database.md)
- [PvP Zones](PvP-Zones.md)
