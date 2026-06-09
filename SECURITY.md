# Security Policy

Security is a **first-class pillar** of BrowserGame, carried over from the DuetOS posture: treat
every client as hostile, and make privilege explicit and gated.

## Threat model (foundation stage)

- **The client is untrusted.** It may send malformed, malicious, or spoofed messages. The server
  decodes defensively (`decodeClient` returns `null` on bad input) and validates/clamps every
  input at the simulation boundary (`src/server/world.ts`).
- **No client-asserted state.** Clients send *intent* only; the server owns all positions and
  outcomes. This is the anti-cheat foundation.
- **Privileged "in-game engine" commands are token-gated.** The admin surface requires a
  server-side `ENGINE_ADMIN_TOKEN`; unauthenticated callers are rejected. Keep these paths
  isolated from normal player paths — *"could a malicious client reach this?"* must be **no**.

## Secrets

- Never commit secrets. `ENGINE_ADMIN_TOKEN` and friends live in `.env` (git-ignored); see
  `.env.example`.
- CI runs **CodeQL** and **Dependabot** keeps dependencies patched.

## Reporting a vulnerability

This is an early-stage personal project. If you find a security issue, please open a **private**
report (GitHub Security Advisory) rather than a public issue, and allow time for a fix before
disclosure.
