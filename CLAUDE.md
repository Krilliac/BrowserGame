# BrowserGame

## Vision
A browser-based, top-down MMO that creatively blends the feel of WarCraft III, StarCraft II,
Diablo II/III, and RuneScape — an original game themed around that lineage, **not** a clone of any
one of them.

## Open design decisions (undecided)
- **World structure:** one of —
  - Match-based (session/lobby rounds, RTS-style), or
  - Area/instance-based (Diablo-style zones), or
  - Persistent MMORPG open world.
  *(Not yet chosen — revisit before architecture work.)*

## Priorities & constraints
- **Security-first.** Treat the client as untrusted; authoritative server-side state.
- **Live editing / in-game engine:** authoring of the world/content while running, via either
  - a dedicated engine/tool, and/or
  - an **authenticated privileged user** who, when logged in, unlocks special UI + commands that
    act like an in-game engine (live edit entities, world, scripts).
  - Access to these powers must be gated by auth/role and isolated from normal players.

## Tech stack
- Open / undecided. Any browser-capable language is on the table, including C++ compiled to
  WebAssembly bytecode if it serves performance/security goals.

## Notes
- Originality over imitation: take inspiration from the genre, build our own systems and theme.
