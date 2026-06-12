// Verify the F9 dev inspector mounts against the running Vite dev server (where
// import.meta.env.DEV is true — it's tree-shaken out of prod builds).
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://localhost:5173/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(URL, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 3000));
await page.keyboard.press('F9');
await new Promise((r) => setTimeout(r, 600));
// The inspector is a fixed-position DOM panel appended to body — find it by its monospace style.
const panelCount = await page.evaluate(() => {
  return [...document.querySelectorAll('div')].filter((d) => {
    const s = getComputedStyle(d);
    return (
      s.position === 'fixed' &&
      parseInt(s.zIndex || '0', 10) >= 9999 &&
      /mono/i.test(s.fontFamily || '')
    );
  }).length;
});
await page.screenshot({ path: 'bg-shots/session/05-inspector-dev.png' });
console.log(`[inspector-check] fixed monospace panels found: ${panelCount} (expect >= 1)`);
await browser.close();
