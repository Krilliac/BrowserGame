// Headless screenshot harness — launches the built game and captures the canvas, so visual
// changes (e.g. the renderer) can be verified without a human in the loop.
//
// Usage: npm run build && node scripts/screenshot.mjs [outDir]
//   - Starts the prod server (serves the built client + ws on one port).
//   - Opens it in headless Chromium, captures the start area, walks east into the
//     wilderness (to show terrain + monsters + combat), and captures again.
//
// Requires: `npm run build` first, and `npx playwright install chromium`.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

const OUT = process.argv[2] ?? '/tmp/bg-shots';
const PORT = process.env.SHOT_PORT ?? '8123';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await mkdir(OUT, { recursive: true });

const server = spawn('node', ['dist/server/index.js'], {
  env: { ...process.env, PORT, TICK_RATE: '30' },
  stdio: 'ignore',
});

let browser;
try {
  await sleep(1500);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });

  // Let it connect and render the start area.
  await sleep(2500);
  await page.screenshot({ path: `${OUT}/01-town.png` });
  console.log(`[screenshot] wrote ${OUT}/01-town.png`);

  // Walk east through the portal into the wilderness, casting as we go.
  await page.keyboard.down('d');
  await sleep(7000);
  await page.keyboard.up('d');
  await sleep(1500);
  // Fire a couple of spells toward screen center-right to show projectiles/FX.
  await page.mouse.move(900, 380);
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('2');
    await page.keyboard.press('3');
    await sleep(250);
  }
  await sleep(500);
  await page.screenshot({ path: `${OUT}/02-wilderness.png` });
  console.log(`[screenshot] wrote ${OUT}/02-wilderness.png`);

  await browser.close();
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGKILL');
}
