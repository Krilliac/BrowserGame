// Loot-visuals screenshot harness — verifies the rarity glints, the D2-style top-tier name labels,
// and the health-globe pickup/heal floater, deterministically (no waiting on random drops).
//
// Usage: npm run build && node scripts/shot-loot.mjs [outDir]
//   - Starts the prod server with a known ENGINE_ADMIN_TOKEN + dev password.
//   - Opens it in headless Chromium, logs in as the seeded dev account (Developer access), and runs
//     the /showcase GM command, which drops a curated loot spread (a unique + a corrupted piece +
//     a glint spread + a health globe) and lightly wounds the player.
//   - Captures the spread, then click-to-moves onto the globe and captures the heal floater.
//
// Requires: `npm run build` first, and `npx playwright install chromium`.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

const OUT = process.argv[2] ?? '/tmp/bg-loot';
const PORT = process.env.SHOT_PORT ?? '8124';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await mkdir(OUT, { recursive: true });

const server = spawn('node', ['dist/server/index.js'], {
  env: { ...process.env, PORT, TICK_RATE: '30', DEV_PASSWORD: 'changeme' },
  stdio: 'ignore',
});

// Type a slash-command into the chat box and send it. Blur the input afterwards (NOT by clicking the
// canvas — that's a click-to-move and would walk the player off the loot).
const command = async (page, text) => {
  await page.fill('#chat-input', text);
  await page.press('#chat-input', 'Enter');
  await page.evaluate(() => document.activeElement?.blur?.());
  await sleep(500);
};

let browser;
try {
  await sleep(1500);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await sleep(2500); // connect + render the start area

  await command(page, '/login dev changeme'); // Developer access
  await command(page, '/showcase'); // drop the curated loot spread + wound self
  await sleep(900); // let the drops land + loot-pop settle

  await page.screenshot({ path: `${OUT}/01-loot-spread.png` });
  console.log(`[shot-loot] wrote ${OUT}/01-loot-spread.png`);

  // Walk south onto the health globe (just below screen center) to trigger the heal floater, then
  // grab a quick burst so at least one frame catches the rising +N before it fades.
  for (let i = 0; i < 3; i++) {
    await page.mouse.click(640, 500);
    await sleep(150);
  }
  for (let i = 0; i < 5; i++) {
    await page.screenshot({ path: `${OUT}/02-globe-heal-${i}.png` });
    await sleep(90);
  }
  console.log(`[shot-loot] wrote ${OUT}/02-globe-heal-*.png`);

  await browser.close();
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGKILL');
}
