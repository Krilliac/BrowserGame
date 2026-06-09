# BrowserGame — Claude Code Context

## What is this?

A browser-based, **top-down MMO** that creatively blends the *feel* of WarCraft III,
StarCraft II, Diablo II/III, and RuneScape — an original game themed around that lineage,
**not** a clone of any one of them.

- **Language:** TypeScript end-to-end (server + client + shared protocol).
- **Client:** Vite + Canvas2D today (renderer is abstracted so PixiJS/WebGL can drop in later).
- **Server:** Node + `ws`, an **authoritative** fixed-timestep simulation.
- **Shared:** one `src/shared` protocol used by both sides — single source of truth for the wire.
- **Primary workflow goal:** dead-simple setup. `npm install && npm run dev`, open one url —
  works the same on a laptop or a **phone**.

This project deliberately inherits the *engineering standards, documentation discipline, and
automation rigor* of two sibling projects (without copying their native code):

- **SparkEngine** (C++ game engine) — server-authoritative netcode model, anti-bloat doctrine,
  the in-engine console concept, and the MMO gameplay-system blueprint.
- **DuetOS** (from-scratch OS) — security-first posture, subsystem isolation, capability-gated
  privilege, and the structured wiki.

## Session start (run at the beginning of every session)

1. **Read this file first.**
2. **Skim the wiki:** `cat wiki/_Sidebar.md`, then read the pages relevant to your task.
   Roadmap and deferred work live in `wiki/reference/Roadmap.md`.
3. **Sanity-check the tree builds:** `npm run check` (typecheck + lint + format + tests).

## Project pillars (do not drift from these)

- **Server-authoritative.** The client sends *intent* (inputs), never state. The server
  simulates and broadcasts snapshots. A malicious client can lie about input but cannot
  teleport. See `src/server/world.ts`.
- **Security-first.** Treat every client as hostile. Validate and clamp all input at the
  simulation boundary. Privileged "in-game engine" powers are **token-gated server-side**
  (`ENGINE_ADMIN_TOKEN`) and must stay isolated from normal player paths.
- **Simple over clever.** This is a foundation. Prefer the boring, readable solution.
- **Phone-friendly.** Anything that breaks `npm run dev` working from a phone/tunnel is a bug.
- **One source of truth per concern.** One protocol (`src/shared`), one world simulation,
  one renderer abstraction. No parallel systems doing the same job.

## Anti-bloat guidelines (adapted from SparkEngine)

AI-assisted development has a structural bias toward complexity — adding features "just in
case," helpers for single uses, systems that are never wired in. The goal is **sanity, not
sacrifice**: keep code clean without stripping legitimate readability.

### Sensible thresholds (guidelines, not hard limits)

| Thing | Threshold | What to do |
|-------|-----------|------------|
| `.ts` file size | ~400 lines | Split if doing multiple jobs; leave if one coherent unit |
| Function length | ~50 lines | Split if nested branching; clear linear flow is fine |
| Public methods per class | ~15 | Ask: "does each method earn its place?" |
| Parallel systems doing the same thing | 0 | Remove the duplicate |

### Before writing code — checklist

1. **Does this already exist?** Search before writing.
2. **Will this be called?** If you can't name the caller, don't write it.
3. **Can existing code do this with a small change?** Prefer editing over adding.
4. **Is this a one-time use?** Inline it.
5. **Am I future-proofing?** Stop. Write only what is needed today.
6. **Is the code dead?** Delete it — git history exists.
7. **Is a system built but not wired in?** Either wire it in or delete it.

### The readability principle

Never sacrifice readability to hit a line count. Keep comments that explain *why*, use
descriptive names (`brushRadius` > `br`), keep vertical whitespace between logical sections.
The question is always: **"does this make sense to someone reading it for the first time?"**

## Coding standards

- **TypeScript strict** — `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`. No `any` without a written reason.
- **ESM with explicit `.js` extensions** on relative imports (required for the Node server
  build; Vite resolves them on the client).
- **Naming:** `PascalCase` types/classes, `camelCase` values, `UPPER_SNAKE` consts.
- **Validation at the boundary:** never trust a network message; decode defensively
  (`decodeClient`/`decodeServer` return `null` on bad input).
- **Pure where possible:** the simulation (`World`) is framework-free and unit-tested.

## Definition of done — before you call a slice complete

- [ ] `npm run check` passes (typecheck, lint, format, tests).
- [ ] New logic has at least one test (follow `src/server/world.test.ts`).
- [ ] No dead code, no un-wired systems, no `console.log` debris in committed client code.
- [ ] Docs updated: a wiki page and/or `CHANGELOG.md` entry if behavior changed.
- [ ] Anything security-relevant answers: *"could a malicious client use this path to do
      something it shouldn't?"* If yes, the gate is wrong.

## World structure (decided)

**Open world, instanced.** The world is one connected place carved into **areas** (`src/shared/areas.ts`).
Each area is served by one or more **instances**; the server spins up additional instances based
on player cap / load, and conceptually each instance could run as its own area-server process
(the AreaServer/WorldServer model from SparkEngine). Players cross between areas through
**portals**. For quick testing, `INSTANCING=single` collapses everything to one instance per area
in a single process. See [`wiki/architecture/Areas-And-Instances.md`](wiki/architecture/Areas-And-Instances.md)
and `src/server/instance-manager.ts`.

## Open design decisions (still to settle)

- **Renderer:** Canvas2D now; PixiJS/WebGL when art density demands it.
- **Cross-instance social features:** chat is currently per-instance (area-scoped); global/party/
  whisper channels and a friends list are future work.

## Layout

```
src/shared/   protocol + math shared by both sides (the wire contract)
src/server/   authoritative simulation (World) + ws/http host
src/client/   Vite app: net, input, canvas renderer
public/        static assets (sprites, audio)
wiki/          structured project knowledge (start at _Sidebar.md)
.github/       CI, CodeQL, dependabot, agent prompts
.claude/       SessionStart hook so web/phone sessions are ready to lint + test
```
