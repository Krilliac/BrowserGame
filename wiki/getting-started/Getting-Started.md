# Getting Started

> Clone, install, run, and understand the moving parts in a few minutes.

## Prerequisites

- Node.js 20+ (the repo pins Node 22 via `.nvmrc`).
- npm (ships with Node).

## Run it

```bash
npm install
npm run dev
```

`npm run dev` launches two processes together:

- the **authoritative game server** (`tsx watch src/server/index.ts`) on port `8080`, and
- the **Vite client** on port `5173`, which proxies `/ws` to the server.

Open the printed Vite url. Move with **WASD / arrow keys**. Open a second tab to see live
multiplayer — both tabs are driven by the same server simulation.

## Verify your environment

```bash
npm run check     # typecheck + lint + format:check + test
```

This is the same gate CI runs. If it's green locally, CI should be green too.

## Project layout

| Path | Purpose |
|---|---|
| `src/shared/` | Wire protocol + math shared by client and server |
| `src/server/` | Authoritative simulation (`World`) + ws/http host |
| `src/client/` | Vite app: `net`, `input`, canvas renderer |
| `public/` | Static assets (sprites, audio) |
| `wiki/` | Project knowledge (this) |

## Next

- [Running From Your Phone](Running-From-Phone.md)
- [Architecture Overview](../architecture/Overview.md)
