# Agent Session Bootstrap

Scope: entire repository (`BrowserGame`).

For every new session/chat in this repo:

1. **Read `CLAUDE.md` first** — it is the source of truth for scope, standards, and the
   definition of done.
2. **Skim the wiki** — start at `wiki/_Sidebar.md` for the table of contents. Pending and
   deferred work is tracked in `wiki/reference/Roadmap.md`.
3. **Verify the tree is healthy** before changing it: `npm run check`.
4. Use `CLAUDE.md` plus the relevant wiki pages as persistent project context for workflow,
   conventions, and task execution.
5. **If concurrent work is possible, follow `CLAUDE_PARALLEL.md`** — run
   `tools/parallel/status.sh` and claim your files before editing. Sub-agents own disjoint,
   self-contained modules; the orchestrator owns the chokepoint files and integration.

If `CLAUDE.md` is missing, report that clearly and continue with available context.

## Project summary for agents

BrowserGame is a TypeScript, browser-based, top-down MMO with a **server-authoritative**
simulation. The client sends input; the server simulates and broadcasts snapshots. Setup is
intentionally minimal so a dev server can be launched from a phone. See `CLAUDE.md` → "What is
this?" for full scope, pillars, and non-goals.

## Non-negotiables

- Keep `npm run dev` working from one url (phone-friendly).
- Server stays authoritative; never trust client-asserted state.
- Privileged/admin paths stay token-gated and isolated.
- `npm run check` must pass before a slice is "done".
