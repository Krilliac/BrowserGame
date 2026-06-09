# Influences (SparkEngine & DuetOS)

> What we deliberately borrowed — in *practices and design*, not source code — and where it lands.

BrowserGame is its own project. No native code from the two sibling projects is included; both are
native (C++/Rust) and target desktop/bare-metal, neither of which runs in a browser. What we
carried over is the engineering thinking.

## From SparkEngine (C++ game engine)

| Borrowed | Where it lives here |
|---|---|
| Server-authoritative netcode model (AreaServer/WorldServer, intent-in/snapshots-out) | `src/server/world.ts`, `src/shared/protocol.ts`, [Architecture](../architecture/Overview.md) |
| MMO gameplay-system blueprint (`SparkGameMMO`: inventory, crafting, party, chat, guild…) | [Roadmap](Roadmap.md), `.github/prompts/gameplay-systems.prompt.md` |
| In-engine console concept (`SparkConsole`: CommandParser/Registry) | [Privileged Engine Mode](../security/Privileged-Engine-Mode.md) |
| Anti-bloat doctrine + readability principle + pre-code checklist | [`CLAUDE.md`](../../CLAUDE.md) |
| MMO art/audio assets (PNG/OBJ/WAV — engine-agnostic, usable later) | candidates for `public/assets/` when art work begins |

## From DuetOS (from-scratch OS)

| Borrowed | Where it lives here |
|---|---|
| Security-first posture; "assume the client is hostile" | [Threat Model](../security/Threat-Model.md) |
| Subsystem isolation + capability-gated privilege | [Privileged Engine Mode](../security/Privileged-Engine-Mode.md) |
| Structured wiki (Home/_Sidebar/_Template + sections) | this `wiki/` |
| Agent session bootstrap (`AGENTS.md`) | [`AGENTS.md`](../../AGENTS.md) |
| React desktop-window UI prototype (`docs/duet-theme/prototype`) | candidate base for the privileged operator panel |

## What we did NOT bring

- DuetOS kernel/drivers/Win32 ABI — non-portable to a browser by nature.
- SparkEngine's native renderer/editor/physics — desktop GPU + native toolchain; out of scope for
  a top-down browser MMO. A renderer abstraction keeps the door open for WebGL/PixiJS later.

## Attribution

Per SparkEngine's license and good practice, see [`LICENSE`](../../LICENSE) and
[`README.md`](../../README.md) acknowledgements.
