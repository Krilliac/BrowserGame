/**
 * Gloomwood asset generator — orchestrator.
 *
 *   node build.js               # build everything
 *   node build.js icons mobs    # build only named groups
 *   OUT=../../public/assets node build.js   # override output root
 *
 * Output root defaults to ../../public/assets (the game's Vite web root) so files land
 * at the paths the renderer expects. Override with the OUT env var.
 */
const fs = require('fs');
const path = require('path');
const { grain } = require('./core');

const GROUPS = {
  icons: require('./icons'),
  fx: require('./fx'),
  terrain: require('./terrain'),
  ui: require('./ui'),
  decor: require('./decor'),
  mobs: require('./mobs'),
  anim: require('./anim'),
  rig: require('./rig'),
};

const OUT = process.env.OUT || path.resolve(__dirname, '../../public/assets');
const C = require('./core');

function render(job) {
  const c = C.makeIcon(job.w, job.h, job.ss || 1, job.draw);
  if (job.grain) grain(c, job.grain);
  const dest = path.join(OUT, job.path);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, c.toBuffer('image/png'));
  return dest;
}

function main() {
  const want = process.argv.slice(2);
  const groups = want.length ? want : Object.keys(GROUPS);
  let n = 0;
  for (const g of groups) {
    const mod = GROUPS[g];
    if (!mod) { console.error(`unknown group: ${g} (have: ${Object.keys(GROUPS).join(', ')})`); continue; }
    for (const job of mod.jobs()) { render(job); n++; }
    console.log(`✓ ${g}`);
  }
  console.log(`\nGenerated ${n} files → ${OUT}`);
}
main();
