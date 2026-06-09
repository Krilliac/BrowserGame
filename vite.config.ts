import { defineConfig } from 'vite';

// The client lives in src/client; the authoritative game server runs separately
// on PORT (default 8080). In dev we proxy the WebSocket so the phone/browser only
// ever needs ONE url (the Vite url) — open it and everything just works.
const GAME_PORT = process.env.PORT ?? '8080';

export default defineConfig({
  root: 'src/client',
  publicDir: '../../public',
  server: {
    host: true, // bind 0.0.0.0 so a phone on the same network / tunnel can reach it
    port: 5173,
    proxy: {
      '/ws': {
        target: `ws://localhost:${GAME_PORT}`,
        ws: true,
      },
    },
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
});
