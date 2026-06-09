# Architecture Overview

> How the pieces fit, and the one rule that shapes everything: the server is authoritative.

## The loop

```
Browser client (src/client)
   │  1. sends INPUT (intent) over WebSocket /ws, ~30x/sec
   ▼
Authoritative server (src/server/index.ts)
   │  2. World.tick(dt) advances the simulation at a fixed rate (src/server/world.ts)
   │  3. broadcasts a SNAPSHOT of all entities each tick
   ▼
All clients render the snapshot (src/client/main.ts)
```

## Why authoritative

The client never tells the server where it is — it tells the server which keys are held. The
server decides the resulting position, clamps it to the world, and broadcasts it. A cheating
client can lie about its input but cannot teleport, dupe items, or hit through walls, because it
never gets to assert state. This is the foundation for fairness and anti-cheat, and it is borrowed
directly from SparkEngine's networking model.

## Layers

| Layer | Module | Responsibility |
|---|---|---|
| Contract | `src/shared/protocol.ts` | Message shapes + constants; defensive decoders |
| Simulation | `src/server/world.ts` | Pure, testable game logic (no I/O) |
| Host | `src/server/index.ts` | ws/http, the fixed-tick loop, static hosting in prod |
| Transport (client) | `src/client/net.ts` | WebSocket connect/reconnect, message handling |
| Input | `src/client/input.ts` | Keyboard → `InputState` |
| Render | `src/client/main.ts` | Camera + canvas drawing of the latest snapshot |

## Extending it

- New gameplay → add a pure module + tests (mirror `world.ts`/`world.test.ts`), then wire it to
  the protocol. See `.github/prompts/gameplay-systems.prompt.md`.
- Network changes → see `.github/prompts/netcode.prompt.md` and [Protocol](Protocol.md).

## The world is instanced

The simulation above runs **per area instance**, not globally. The world is split into areas, each
served by one or more instances that scale with load; players cross between them through
server-authoritative portals, and only ever see their own instance. This is what makes it an
*open world* that can scale out. Full detail: [Areas & Instances](Areas-And-Instances.md).

## See also

- [Areas & Instances](Areas-And-Instances.md)
- [Wire Protocol](Protocol.md)
- [Authoritative Simulation](Simulation.md)
- [Threat Model](../security/Threat-Model.md)
