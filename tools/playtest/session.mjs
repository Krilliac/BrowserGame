// Qualitative playthrough: drive the real built client in a headless browser, fight through the
// wilderness, and screenshot key moments — to eyeball feel (mob density, combat, the new
// waymarks/inspector) that the pure-sim pacing tool can't see. Requires `npm run build` first.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

const OUT = process.argv[2] ?? 'bg-shots/session';
const PORT = process.env.SHOT_PORT ?? '8131';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await mkdir(OUT, { recursive: true });

const server = spawn('node', ['dist/server/index.js'], {
  env: { ...process.env, PORT, TICK_RATE: '30' },
  stdio: 'ignore',
});

let browser;
const errors = [];
try {
  await sleep(1500);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await sleep(2500);
  await page.screenshot({ path: `${OUT}/01-town.png` });

  // Walk east toward the wilderness gate, fighting along the way (spells on 1/2).
  for (let i = 0; i < 30; i++) {
    await page.mouse.click(1180, 400);
    if (i % 2 === 0) {
      await page.keyboard.press('1');
      await page.keyboard.press('2');
    }
    await sleep(450);
  }
  await page.screenshot({ path: `${OUT}/02-crossing.png` });

  // Open the F9 inspector to confirm it mounts.
  await page.keyboard.press('F9');
  await sleep(400);
  await page.screenshot({ path: `${OUT}/03-inspector.png` });
  await page.keyboard.press('F9');

  // Fight in place for a bit to sample combat + density.
  for (let i = 0; i < 24; i++) {
    await page.mouse.click(740, 380);
    await page.keyboard.press('1');
    await page.keyboard.press('2');
    await page.keyboard.press('3');
    await sleep(350);
  }
  await page.screenshot({ path: `${OUT}/04-combat.png` });

  console.log(`[session] screenshots in ${OUT}; page errors: ${errors.length}`);
  if (errors.length) console.log(errors.slice(0, 8).join('\n'));
  await browser.close();
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill();
}
