# Threat Model

> Security is a first-class pillar, carried from DuetOS. Assume every client is hostile.

## Assumptions

- The client is fully attacker-controlled. It may send malformed JSON, oversized payloads,
  spoofed ids, or messages out of order.
- The network is observable and tamperable.

## Mitigations in the foundation

| Threat | Mitigation | Where |
|---|---|---|
| Malformed messages | Defensive decoders return `null`; bad messages dropped | `src/shared/protocol.ts` |
| Client-asserted position (teleport/speed hacks) | Server simulates; client sends intent only | `src/server/world.ts` |
| Out-of-bounds movement | Positions clamped to world bounds every tick | `World.tick` |
| Diagonal speed exploit | Movement vector normalized | `World.tick` |
| Spoofed entity ids | Input for unknown ids ignored | `World.setInput` |
| Unauthorized privileged actions | Admin commands token-gated; isolated path | `src/server/index.ts` |
| Message flooding (DoS) | Per-connection token-bucket rate limits (messages + chat) | `src/server/rate-limit.ts` |
| Oversized frames (DoS) | WebSocket `maxPayload` cap (`MAX_MESSAGE_BYTES`) | `src/server/index.ts` |
| Chat injection (newlines/control chars) | `sanitizeChat` strips control chars, trims, length-caps | `src/server/chat.ts` |
| Vulnerable dependencies | Dependabot + CodeQL in CI | `.github/` |

## The review question

For any new path that touches state, ask:

> **"Could a malicious client use this to do something a normal client shouldn't?"**

If yes, the gate is wrong — fix the gate, don't extend the bypass. (This is the DuetOS
subsystem-isolation review signal, adapted.)

## Known gaps (foundation stage)

- No authentication of player identity yet (names are cosmetic).
- `ENGINE_ADMIN_TOKEN` is a single shared secret — fine for dev, replace with real auth for the
  privileged engine mode before shipping.

## See also

- [Privileged Engine Mode](Privileged-Engine-Mode.md)
- [Architecture Overview](../architecture/Overview.md)
