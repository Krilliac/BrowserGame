# Roadmap

> Pending and deferred work. Keep this current — agents and contributors read it first.

## Now (foundation — done)

- [x] TypeScript project, strict config, ESM.
- [x] Server-authoritative simulation + fixed-tick loop.
- [x] WebSocket transport; join / input / snapshot.
- [x] Canvas client with camera, grid, multiplayer rendering.
- [x] Token-gated admin command scaffold.
- [x] Standards (ESLint/Prettier/EditorConfig), tests (Vitest).
- [x] CI, CodeQL, Dependabot, SessionStart hook.
- [x] Docs: CLAUDE.md, wiki, project meta.

## Next (small, high-value)

- [ ] **Decide world structure** — match-based vs. area/instanced vs. persistent open world.
      This unblocks the netcode and persistence direction. (See `CLAUDE.md` → open decisions.)
- [x] Snapshot interpolation on the client (smooth movement between ticks).
- [x] Touch controls (virtual joystick) for true phone play.
- [x] Message rate limiting + payload size caps (see Threat Model "known gaps").

## Later (systems — reimplement from the SparkGameMMO blueprint)

- [ ] Inventory + loot tables (server-authoritative).
- [x] Chat — basic global channel (sanitized + rate-limited). Next: area/party/whisper channels.
- [ ] Party / grouping.
- [ ] Character persistence (pick a store).
- [ ] Privileged engine mode: command registry + operator auth + UI panel.

## Reference material

- SparkEngine gameplay blueprint and netcode architecture.
- DuetOS security/isolation posture and React desktop-UI prototype (privileged panel base).

See [Influences](Influences.md) for specifics.
