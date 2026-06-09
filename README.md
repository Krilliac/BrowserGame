# BrowserGame

A browser-based, **top-down MMO** that blends the *feel* of WarCraft III, StarCraft II,
Diablo II/III, and RuneScape — original, not a clone. Built in **TypeScript end-to-end** with a
**server-authoritative** simulation and a setup simple enough to run a dev server **from your phone**.

> Status: early foundation. There is a working vertical slice — connect, move, see other players
> move in real time — on top of a strong standards/automation/docs base. See
> [`wiki/reference/Roadmap.md`](wiki/reference/Roadmap.md).

## Quick start

```bash
npm install
npm run dev
```

Then open the printed Vite url (it binds `0.0.0.0`, so a phone on the same network — or a tunnel —
can reach it too). Move with **WASD / arrow keys**. Open a second tab to see live multiplayer.

That's it. One command, one url, laptop or phone.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run the game server **and** the Vite client together (hot reload). |
| `npm run build` | Type-check + build the server (`dist/server`) and client (`dist/client`). |
| `npm start` | Run the built server, which also hosts the built client on one port. |
| `npm run check` | `typecheck` + `lint` + `format:check` + `test` — the full gate. |
| `npm test` | Run the unit tests (Vitest). |

## How it fits together

```
Browser client (src/client)
   │  sends INPUT (intent) over WebSocket /ws
   ▼
Authoritative server (src/server)  ── fixed-tick simulation (src/server/world.ts)
   │  broadcasts SNAPSHOTS
   ▼
All clients render the same world
```

The client never asserts its own position; it sends inputs and renders what the server says.
This is the basis of fairness and anti-cheat. See [`CLAUDE.md`](CLAUDE.md) and the
[wiki](wiki/_Sidebar.md) for the full doctrine.

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — engineering context, standards, and the definition of done.
- [`wiki/`](wiki/_Sidebar.md) — architecture, security, tooling, and roadmap.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — workflow and conventions.
- [`SECURITY.md`](SECURITY.md) — security posture and how to report issues.

## Acknowledgements

The engineering standards, server-authoritative netcode model, and gameplay-system blueprint draw
on **[SparkEngine](https://github.com/Krilliac/SparkEngine)**, and the security/isolation posture
and structured wiki draw on **[DuetOS](https://github.com/Krilliac/DuetOS)** — both by Krilliac.
No native code from either project is included; the influence is in *practices*, not source.

## License

MIT — see [`LICENSE`](LICENSE).
