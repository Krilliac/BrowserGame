# BrowserGame Wiki

Welcome. This wiki is the **persistent project knowledge base** — the structured companion to
[`CLAUDE.md`](../CLAUDE.md). Start here, then use the [sidebar](_Sidebar.md) to navigate.

## What is BrowserGame?

A browser-based, top-down MMO blending the *feel* of WarCraft III, StarCraft II, Diablo II/III,
and RuneScape — original, not a clone. TypeScript end-to-end, server-authoritative, and built so a
dev server runs from a phone.

## The 60-second tour

- **`src/shared`** — the wire protocol both sides agree on.
- **`src/server`** — the authoritative simulation (`World`) and the ws/http host.
- **`src/client`** — the Vite app: networking, input, and the canvas renderer.
- **`wiki/`** — you are here. Architecture, security, tooling, roadmap.

## Where to go next

- New to the repo? → [Getting Started](getting-started/Getting-Started.md)
- Want the big picture? → [Architecture Overview](architecture/Overview.md)
- Care about safety? → [Threat Model](security/Threat-Model.md)
- Looking for what's next? → [Roadmap](reference/Roadmap.md)
