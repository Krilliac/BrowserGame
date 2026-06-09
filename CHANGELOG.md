# Changelog

All notable changes to this project are documented here. The format is loosely based on
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow semantic
versioning once it stabilizes.

## [Unreleased]

### Added

- **Client snapshot interpolation** (`src/client/interp.ts`) — smooth movement between 20Hz ticks
  by rendering a short delay in the past and lerping between bracketing snapshots.
- **Touch controls** — a drag-anywhere virtual joystick (`src/client/input.ts`) merged with
  keyboard input, for real phone play.
- **In-game chat** — first gameplay system: shared `chat` protocol messages, server-side
  sanitization (`src/server/chat.ts`), and a chat panel UI.
- **Server hardening** — per-connection token-bucket rate limiting (`src/server/rate-limit.ts`)
  for messages and chat, plus a WebSocket `maxPayload` cap.
- Initial TypeScript foundation: server-authoritative simulation (`src/server`), browser client
  (`src/client`), and a shared wire protocol (`src/shared`).
- Working multiplayer vertical slice: join, move (WASD/arrows), and see other players move in
  real time over WebSocket.
- Token-gated privileged "in-game engine" command surface (scaffold for live editing).
- Tooling and standards: strict TypeScript, ESLint, Prettier, EditorConfig, Vitest.
- Automation: GitHub Actions CI (typecheck/lint/format/test/build), CodeQL, Dependabot.
- Documentation: expanded `CLAUDE.md`, `AGENTS.md`, a structured `wiki/`, and project meta docs.
- Claude Code `SessionStart` hook so web/phone sessions arrive ready to lint and test.
