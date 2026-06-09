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

## Remotely (away from home)

Put a tunnel in front of port `5173`:

- **Cloudflare Tunnel**: `cloudflared tunnel --url http://localhost:5173`
- **ngrok**: `ngrok http 5173`
- or your host/provider's port forwarding.

Because `/ws` is same-origin and proxied, the WebSocket rides through the tunnel automatically —
you still only open one url. Over HTTPS tunnels the client auto-selects `wss://`.

## Developing from a phone via Claude Code on the web

This repo is set up for [Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web):
a `SessionStart` hook (`.claude/`) installs dependencies and confirms the tree is healthy when a
cloud session starts, so you can drive development from a browser/phone session and have lint and
tests ready to run.

## Troubleshooting

See [`TROUBLESHOOTING.md`](../../TROUBLESHOOTING.md) for "nothing connects", port conflicts, etc.
