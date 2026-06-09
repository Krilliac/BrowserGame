# Changelog

All notable changes to this project are documented here. The format is loosely based on
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow semantic
versioning once it stabilizes.

## [Unreleased]

### Added

- Initial TypeScript foundation: server-authoritative simulation (`src/server`), browser client
  (`src/client`), and a shared wire protocol (`src/shared`).
- Working multiplayer vertical slice: join, move (WASD/arrows), and see other players move in
  real time over WebSocket.
- Token-gated privileged "in-game engine" command surface (scaffold for live editing).
- Tooling and standards: strict TypeScript, ESLint, Prettier, EditorConfig, Vitest.
- Automation: GitHub Actions CI (typecheck/lint/format/test/build), CodeQL, Dependabot.
- Documentation: expanded `CLAUDE.md`, `AGENTS.md`, a structured `wiki/`, and project meta docs.
- Claude Code `SessionStart` hook so web/phone sessions arrive ready to lint and test.
