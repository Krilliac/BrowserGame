# Areas & Instances

> The open world is instanced. This is the heart of how it scales — and how it stays simple to
> test. Implemented in `src/server/instance-manager.ts` and `src/shared/areas.ts`.

## The model

- **World** — one connected place, presented to players as a continuous open world.
- **Area** — a named region of that world (`town`, `wilderness`, `crypt`), each with its own
  dimensions, spawn point, player cap, and portals. Defined in `src/shared/areas.ts` (shared so
  the client can label areas and draw portals without a round-trip).
- **Instance** — a running simulation of one area (`src/server/world.ts`). An area can have many
  instances. Conceptually each instance is its own *area server*; here they run in one process,
  but nothing about the design assumes that — an instance could be hosted by a dedicated process
  later (this is the SparkEngine AreaServer/WorldServer model).
- **Portal** — a trigger rectangle in an area that transfers a player to another area when stepped
  into. Detection is **server-side and authoritative** (`InstanceManager.tick` → `resolvePortals`).

## Instancing modes

Set with the `INSTANCING` env var:

| Mode | Behavior | Use |
|---|---|---|
| `auto` (default) | Players pack into the fullest instance under an area's `playerCap`; once all instances of an area are full, a new one is spun up. Empty instances are GC'd. | Production-style scaling. |
| `single` | Unlimited cap, exactly one instance per area, never scales. | "Spin it all up under one world/instance" for quick local testing. |

## How a player flows through it

1. **Join** → `InstanceManager.join(name)` places the player into an instance of the start area
   (`town`) and assigns a **globally unique** entity id (stable across transfers).
2. **Snapshots** are per-instance: each tick, the host sends every player only their own
   instance's entities. That scoping *is* the instancing.
3. **Chat** is area-scoped — broadcast only to the sender's instance.
4. **Crossing a portal** → the server moves the entity to an instance of the destination area
   (preserving id + appearance), emits a `TransferEvent`, and the host sends the player an
   `area_changed` message. The client clears its interpolation buffer so the old area's entities
   vanish.

## Why this shape

- **Scales horizontally.** Load is absorbed by adding instances, then (later) by moving instances
  to their own processes/machines — without changing gameplay code.
- **Authoritative + cheat-resistant.** Players never assert their area or position; the server
  decides placement and transfers.
- **Testable.** The manager is pure (no sockets/timers) and fully unit-tested in
  `instance-manager.test.ts` (placement, cap scaling, single mode, portal transfer, GC).

## Tuning

- Area sizes, caps, spawns, and portals all live in `src/shared/areas.ts` — edit there.
- Keep arrival spawns clear of the destination's portal rects (otherwise arriving re-triggers a
  transfer). The current areas already satisfy this.

## See also

- [Architecture Overview](Overview.md)
- [Wire Protocol](Protocol.md)
- [Threat Model](../security/Threat-Model.md)
