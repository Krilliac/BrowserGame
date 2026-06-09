// Opens a free Cloudflare "quick tunnel" (trycloudflare.com) to the running game server,
// giving you a public https URL you can open from any device — no Cloudflare account needed.
//
// Used by `npm run host` (which builds + starts the server first). You can also run it on its
// own against an already-running server: `PORT=8080 node scripts/tunnel.mjs`.
import { spawn } from 'node:child_process';

const port = process.env.PORT ?? '8080';
const target = `http://localhost:${port}`;

console.log(`[tunnel] opening a trycloudflare tunnel to ${target} …`);
console.log('[tunnel] watch for the "https://<something>.trycloudflare.com" URL below — share it.');

// Some networks block QUIC; set TUNNEL_PROTOCOL=http2 to fall back.
const args = ['tunnel', '--url', target];
if (process.env.TUNNEL_PROTOCOL) args.push('--protocol', process.env.TUNNEL_PROTOCOL);

// node_modules/.bin/cloudflared is on PATH inside npm scripts; `shell: true` also finds a
// system-installed cloudflared if present.
const child = spawn('cloudflared', args, {
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error('[tunnel] failed to launch cloudflared:', err.message);
  console.error('[tunnel] run `npm install` (it fetches the cloudflared binary) and retry.');
  process.exit(1);
});
