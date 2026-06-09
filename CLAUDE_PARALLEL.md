# Parallel Session Protocol

Adapted from DuetOS. BrowserGame can be worked on by several concurrent agents
(orchestrator + sub-agents, or multiple sessions) at once. Follow this protocol
so parallel work goes faster **without** clobbering shared files.

The scripts in `tools/parallel/` automate the bookkeeping; the tracked
coordinator `PARALLEL_WORK.md` (repo root) is the source of truth for who owns
what.

## Two ways this repo runs parallel

1. **Orchestrator + sub-agents (most common here).** One agent (the orchestrator)
   owns the shared chokepoint files and the git history. It dispatches sub-agents
   that each build a **disjoint, self-contained module** (its own new files +
   tests), then the orchestrator integrates and commits. Sub-agents do **not**
   run git or touch shared files.
2. **Multiple sessions (multi-machine git model).** Each session claims a
   subsystem, works on its own `claude/*` branch, and releases with `--push`.

In both cases: **partition by files, claim before editing, integrate deliberately.**

## On session start

```bash
tools/parallel/status.sh                                   # who owns what + conflict check
tools/parallel/claim.sh <name> "<files>" "<description>"   # claim before editing
```

`claim.sh` records an ownership entry and **refuses (exit 2)** if your files are
already claimed by an active session. Example:

```bash
tools/parallel/claim.sh progression "src/server/progression.ts" "XP + leveling"
tools/parallel/claim.sh loot        "src/server/loot.ts"        "loot tables"
```

## During work

- **Stay in your claimed files.** Do not touch files outside your scope.
- **Prefer new, self-contained modules** (own file + own `*.test.ts`). They have
  zero merge surface and parallelize cleanly.
- **Keep it green for your slice:** run only your test, e.g.
  `npx vitest run src/server/progression.test.ts`.
- **Honor the server-authoritative rule** (see `CLAUDE.md`): a claim grants edit
  ownership, not a licence to let the client assert state.
- **Do not edit `PARALLEL_WORK.md` by hand** — use the scripts.

## On complete

```bash
tools/parallel/release.sh <name>            # mark DONE in the coordinator
tools/parallel/release.sh <name> --push     # also push current branch (multi-session model)
```

## File-ownership cheatsheet (BrowserGame layout)

| Subsystem | Path | Notes |
|---|---|---|
| shared-protocol | `src/shared/protocol.ts` | **CHOKEPOINT — orchestrator-owned**, coordinate |
| shared-combat | `src/shared/combat.ts` | ability/resource table — coordinate |
| areas | `src/shared/areas.ts` | area + portal definitions |
| world-sim | `src/server/world.ts` | **CHOKEPOINT — central orchestration**, coordinate |
| server-host | `src/server/index.ts` | **CHOKEPOINT — ws/http wiring**, coordinate |
| instancing | `src/server/instance-manager.ts` | area-server routing |
| combat-geo | `src/server/combat.ts` | pure hit geometry |
| mobs | `src/server/mobs.ts` | monster templates + AI |
| chat / ratelimit | `src/server/chat.ts`, `src/server/rate-limit.ts` | small, safe |
| client-render | `src/client/draw.ts` | **CHOKEPOINT — rendering**, coordinate |
| client-main | `src/client/main.ts` | **CHOKEPOINT — orchestration + HUD**, coordinate |
| client-net/input/interp | `src/client/{net,input,interp}.ts` | smaller surfaces |
| docs | `wiki/**`, `*.md` | safe to parallelize freely |

> The CHOKEPOINTS — `protocol.ts`, `world.ts`, `index.ts`, `draw.ts`, `main.ts`,
> and shared `combat.ts` — are where features converge. In a parallel batch the
> **orchestrator** makes the contract changes in these files; sub-agents add new
> modules against that contract. That is how you parallelize this codebase
> without merge pain.

## Conflict resolution (multi-session git model)

1. Don't blind force-push over another session's work.
2. Scope the delta: `git diff <base>...HEAD`.
3. If the other session merged first, rebase onto the integration branch, resolve,
   `git add`, then re-run `release.sh --push` (it uses `--force-with-lease`).

## Quick reference

```bash
tools/parallel/status.sh                          # see all sessions + conflicts
tools/parallel/claim.sh <name> "<files>" "<desc>" # claim before starting
tools/parallel/release.sh <name> [--push]         # release when done
```
