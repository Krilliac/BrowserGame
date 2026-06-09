# Hosting

> Run the server on your PC (or anywhere) and let people connect over the internet.

The game serves the client **and** the WebSocket on one port in production, so a single tunnel/port
is all you need.

```bash
npm run build && npm start   # serves everything on PORT (default 8080)
```

## Option 1 — Quick tunnel (zero setup, **random URL**)

```bash
npm run host
```

Opens a free Cloudflare quick tunnel and prints a `https://<random>.trycloudflare.com` URL. Great
for a quick game with friends.

**Caveat:** the hostname is **random and changes every time you restart**. That's the price of
needing no account. For a URL that stays the same, use Option 2.

## Option 2 — Named tunnel (**stable URL, free**)

A *named* Cloudflare Tunnel gives a permanent hostname like `game.yourdomain.com` that survives
restarts. **The tunnel and the DNS record are free** — Cloudflare does not charge for this. The
only cost is owning a domain (~$8–12/yr, or use a free domain), added to a **free** Cloudflare plan.

One-time setup:

```bash
# 1. Authenticate cloudflared with your Cloudflare account (opens a browser).
npx cloudflared tunnel login

# 2. Create a named tunnel (pick any name).
npx cloudflared tunnel create browsergame

# 3. Route a hostname on your domain to it.
npx cloudflared tunnel route dns browsergame game.yourdomain.com
```

Then create `~/.cloudflared/config.yml` pointing the hostname at the game port:

```yaml
tunnel: browsergame
credentials-file: /home/<you>/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: game.yourdomain.com
    service: http://localhost:8080
  - service: http_status:404
```

From then on, every time you want to host:

```bash
TUNNEL_NAME=browsergame npm run host:named
```

Open `https://game.yourdomain.com` — same URL, every time. The client connects to `/ws` on that
origin automatically (`wss://`).

> Networks that block QUIC: prefix with `TUNNEL_PROTOCOL=http2` (quick tunnel) or add
> `protocol: http2` under the tunnel in `config.yml` (named tunnel).

## Option 3 — Port forwarding / DDNS (free, no tunnel)

Forward the game port on your router to your PC and use a free dynamic-DNS hostname (e.g.
DuckDNS). Fully free, but exposes your home IP and needs router access.

## Option 4 — A small always-on host

For 24/7 uptime, run `npm run build && npm start` on a cheap VPS (or a Raspberry Pi) and point a
named tunnel or DNS at it. Same one-port setup.

## Comparison

| Option | URL | Cost | Setup |
|---|---|---|---|
| Quick tunnel (`npm run host`) | random, changes each run | free | none |
| Named tunnel (`npm run host:named`) | **stable** (`game.yourdomain.com`) | free + a domain (~$10/yr) | one-time |
| Port forwarding + DDNS | stable | free | router config |
| VPS / Pi | stable | hosting cost | moderate |

## See also

- [Running From Your Phone](Running-From-Phone.md)
