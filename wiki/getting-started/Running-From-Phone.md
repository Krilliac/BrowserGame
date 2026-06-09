# Running From Your Phone

> A core goal: develop and test away from your PC. Here's how the setup supports that.

## Why it works

`npm run dev` binds the Vite server to `0.0.0.0`, and the client connects to `/ws` on **the same
origin** (Vite proxies it to the game server). That means there is exactly **one url** to open,
wherever you are — no separate API host to configure on mobile.

## On the same Wi-Fi

1. Run `npm run dev` on your computer.
2. Find your computer's LAN IP (e.g. `192.168.1.20`).
3. On your phone, open `http://192.168.1.20:5173`.

## Remotely (away from home) — one command

The easiest way to host from your PC and connect from anywhere:

```bash
npm run host
```

This builds the game, serves the client **and** WebSocket on one port (default `8080`), and opens a
free **Cloudflare quick tunnel** (`*.trycloudflare.com`) — no account, no config. Open the printed
`https://….trycloudflare.com` URL on any device. The client connects to `/ws` on the same https
origin, so it "just works" over the tunnel (auto-selecting `wss://`). Stop with `Ctrl+C`.

- Network blocks QUIC? `TUNNEL_PROTOCOL=http2 npm run host`.
- Just the tunnel against an already-running server: `PORT=8080 npm run tunnel`.

### Other options

- **Same machine, dev mode tunnel:** `cloudflared tunnel --url http://localhost:5173` (Vite),
  or **ngrok**: `ngrok http 5173`.
- **Port forwarding** on your router/provider also works — point it at the host port.

## Developing from a phone via Claude Code on the web

This repo is set up for [Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web):
a `SessionStart` hook (`.claude/`) installs dependencies and confirms the tree is healthy when a
cloud session starts, so you can drive development from a browser/phone session and have lint and
tests ready to run.

## Troubleshooting

See [`TROUBLESHOOTING.md`](../../TROUBLESHOOTING.md) for "nothing connects", port conflicts, etc.
