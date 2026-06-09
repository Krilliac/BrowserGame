// Runs a *named* Cloudflare Tunnel, which gives a STABLE public hostname (e.g.
// game.yourdomain.com) that does not change between restarts — unlike the random
// trycloudflare quick tunnel. Requires a one-time setup (see wiki/getting-started/Hosting.md):
// a free Cloudflare account, a domain on it, `cloudflared tunnel login`, `cloudflared tunnel
// create <name>`, and a DNS route to localhost:PORT.
//
// Usage: TUNNEL_NAME=browsergame npm run host:named   (or pass the name as an arg)
import { spawn } from 'node:child_process';

const name = process.env.TUNNEL_NAME ?? process.argv[2];
if (!name) {
  console.error('[tunnel] set TUNNEL_NAME (or pass a tunnel name).');
  console.error('[tunnel] one-time setup: see wiki/getting-started/Hosting.md');
  process.exit(1);
}

console.log(`[tunnel] running named tunnel "${name}" — your stable Cloudflare hostname …`);
const child = spawn('cloudflared', ['tunnel', 'run', name], { stdio: 'inherit', shell: true });
child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error('[tunnel] cloudflared failed:', err.message);
  process.exit(1);
});
