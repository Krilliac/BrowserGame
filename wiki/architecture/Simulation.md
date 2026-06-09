# Authoritative Simulation

> The pure, testable heart of the game: `src/server/world.ts`.

## Design

`World` is framework-free — no sockets, no timers, no DOM. It exposes a small surface:

- `spawn(name)` → creates an entity at the world centre, returns its id.
- `setInput(id, input)` → records a player's *intent* (booleans, re-validated).
- `tick(dt)` → advances every entity by `dt` seconds.
- `snapshot()` → returns a copy of all entity states to broadcast.
- `remove(id)` → drops a disconnected player.

Keeping it pure means:

- It's trivially unit-tested (`src/server/world.test.ts`) without a network.
- It could later move to a worker thread or compile to WASM unchanged.
- The host (`index.ts`) owns all I/O; the simulation owns all rules.

## Guarantees enforced here

- **Bounds:** every position is clamped to `WORLD_WIDTH` × `WORLD_HEIGHT`.
- **No speed exploits:** diagonal movement is normalized so corners aren't faster.
- **No spoofing:** input for an unknown id is ignored.
- **Sanitized identity:** names are trimmed and length-capped on spawn.

## Fixed timestep

The host runs `tick(dt)` at `TICK_RATE` Hz (default 20) with `dt = 1 / TICK_RATE`. A fixed step
keeps the simulation deterministic and frame-rate independent — the basis for future client
prediction and reconciliation.

## See also

- [Architecture Overview](Overview.md)
- [Wire Protocol](Protocol.md)
