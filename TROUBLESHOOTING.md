# Troubleshooting

## `npm run dev` — nothing connects / "reconnecting…"

The client talks to the game server through Vite's `/ws` proxy. Make sure **both** processes are
running — `npm run dev` starts them together (the `server` and `client` panes). If you started
only `npm run dev:client`, there's no server to proxy to. Check the server is up:

```bash
curl http://localhost:8080/health
```

## Opening from my phone

`npm run dev` binds the Vite server to `0.0.0.0`. On the same Wi-Fi, open
`http://<your-computer-ip>:5173`. Remotely, put a tunnel (e.g. Cloudflare Tunnel, ngrok, or your
hosting provider's port forwarding) in front of port `5173` — the `/ws` proxy rides along, so you
still only open **one** url.

## Port already in use

Set a different port: `PORT=8090 npm run dev` (the Vite proxy reads `PORT` too).

## Type errors after pulling

Dependencies or types may have changed:

```bash
npm install
npm run typecheck
```

## Lint/format failures in CI but not locally

Run the same gate CI runs:

```bash
npm run check
npm run lint:fix && npm run format
```

## Tests can't find a module

Relative imports use explicit `.js` extensions (ESM + Node server requirement). Import
`./world.js`, not `./world`. Vitest and Vite both understand this.
