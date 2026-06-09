# Privileged Engine Mode

> The live-editing "in-game engine" for authenticated operators — inspired by SparkEngine's
> in-engine console (`SparkConsole`) and DuetOS's capability-gated privilege.

## The vision

When a privileged user is authenticated, they unlock special UI and commands that let them edit
the running world — spawn entities, tweak parameters, run scripts — as if a game engine were
embedded in the live game. Normal players never see or reach these powers.

## The foundation today

A minimal, **token-gated** command surface exists end-to-end:

- Client can send `{ t:'admin', token, command }` (see `src/shared/protocol.ts`).
- The server only accepts it when `ENGINE_ADMIN_TOKEN` is set **and** matches
  (`src/server/index.ts`). Otherwise it replies `denied`.

This is intentionally tiny — it proves the gated path exists and is isolated, without yet
implementing real commands.

## Design rules (carried from DuetOS subsystem isolation)

1. **Privilege is server-owned.** The token check happens server-side; the client UI is a
   convenience, never the authority.
2. **Isolated path.** Admin handling must not share mutation paths with normal player input.
3. **Auditable.** Every accepted command should be logged (and eventually attributed to an
   operator identity).
4. **Least privilege.** Commands map to specific capabilities, not a blanket "god mode" — model
   this on capability gating as the command set grows.

## Roadmap for this feature

- Replace the single shared token with real operator authentication.
- Define a command registry (parser + handlers) — mirror `SparkConsole`'s
  CommandParser/CommandRegistry split, in TypeScript.
- Build the privileged UI panel (a port of DuetOS's React desktop-window prototype is a candidate
  base — see [Influences](../reference/Influences.md)).

## See also

- [Threat Model](Threat-Model.md)
- [Roadmap](../reference/Roadmap.md)
