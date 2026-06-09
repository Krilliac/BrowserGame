# Copilot / AI assistant instructions

This repository has a single source of truth for conventions: **[`CLAUDE.md`](../CLAUDE.md)**.
Read it before generating code. Highlights:

- **TypeScript strict, ESM** with explicit `.js` extensions on relative imports.
- **Server-authoritative**: the client sends input/intent, never state. Validate at the boundary.
- **Security-first**: privileged/admin paths are token-gated and isolated from player paths.
- **Anti-bloat**: smallest change that works; no un-wired systems; delete dead code.
- **Definition of done**: `npm run check` (typecheck + lint + format + test) must pass, and new
  logic needs a test.

When in doubt, prefer the boring, readable solution and keep `npm run dev` working from one url.
