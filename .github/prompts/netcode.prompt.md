# Prompt: Netcode & replication

Use when touching the network layer (transport, snapshots, interpolation, prediction, anti-cheat).

Reference architecture: SparkEngine's `Engine/Networking/` — AreaServer/WorldServer,
ClientPrediction, DeltaSnapshotManager, EntityReplicator, InterpolationBuffer, NetQuantize,
PacketValidator, NetworkSecurity, SubTickInput. Use it as an architecture map; implement the
TypeScript equivalent only as far as the game actually needs today (anti-bloat).

Rules for this repo:

1. **Authoritative server, intent-only clients.** Never accept client-asserted state.
2. **Snapshots out, inputs in.** Keep the `snapshot` / `input` split in `src/shared/protocol.ts`.
3. **Validate before simulate.** Bad/oversized/spoofed messages are dropped, not trusted.
4. **Measure before optimizing.** Add delta encoding / interpolation / prediction when a real
   bandwidth or smoothness problem exists — not speculatively.
5. **Keep one transport.** Don't fork a second connection path.

Deliver: minimal, tested changes + a `wiki/architecture/` note describing the protocol change.
