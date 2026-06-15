/** Biome ground tilesheets — 16px grid, every cell a valid floor tile + placed detail cells. */
const C = require('./core');
const S = 16;

function vary(hex, d, rng) { const a = C.hx(hex); const n = (rng() - 0.5) * 2 * d; const cl = (v) => Math.max(0, Math.min(255, v)) | 0; return `rgb(${cl(a[0] + n)},${cl(a[1] + n)},${cl(a[2] + n)})`; }

function slabCell(g, x, y, rng, rubble) {
  if (rubble) { g.fillStyle = '#1b1d24'; g.fillRect(x, y, S, S); for (let k = 0; k < 5; k++) { const sx = x + rng() * S * 0.6, sy = y + rng() * S * 0.6, ss = S * (0.22 + rng() * 0.18); g.fillStyle = vary('#4a4e5a', 14, rng); g.beginPath(); g.arc(sx + ss / 2, sy + ss / 2, ss / 2, 0, 7); g.fill(); } return; }
  g.fillStyle = '#16171d'; g.fillRect(x, y, S, S);
  g.fillStyle = vary('#2e323c', 10, rng); g.fillRect(x + 1, y + 1, S - 2, S - 2);
  g.fillStyle = vary('#3a3e4a', 8, rng); g.fillRect(x + 1, y + 1, S - 2, 2);
  for (let k = 0; k < 3; k++) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + (rng() * S | 0), y + (rng() * S | 0), 1, 1); }
}
function cursedCell(g, x, y, rng, vein) {
  g.fillStyle = vary('#443842', 10, rng); g.fillRect(x, y, S, S);
  for (let k = 0; k < 4; k++) { g.fillStyle = 'rgba(20,10,16,0.4)'; g.fillRect(x + (rng() * S | 0), y + (rng() * S | 0), 1, 1); }
  if (rng() < 0.5) { g.strokeStyle = 'rgba(20,8,12,0.5)'; g.lineWidth = 1; g.beginPath(); let px = x + rng() * S, py = y; g.moveTo(px, py); for (let s = 0; s < 3; s++) { px += (rng() - 0.5) * S * 0.5; py += S / 3; g.lineTo(px, py); } g.stroke(); }
  if (vein) { g.strokeStyle = '#7a2424'; g.lineWidth = 1.4; g.lineCap = 'round'; for (let v = 0; v < 3; v++) { g.beginPath(); let px = x + S * 0.5, py = y + S * 0.5; g.moveTo(px, py); const a = v / 3 * 7; for (let s = 0; s < 3; s++) { px += Math.cos(a + (rng() - 0.5)) * S * 0.22; py += Math.sin(a + (rng() - 0.5)) * S * 0.22; g.lineTo(px, py); } g.stroke(); } g.fillStyle = '#b04a44'; g.beginPath(); g.arc(x + S * 0.5, y + S * 0.5, 1.6, 0, 7); g.fill(); }
}
function undeadCell(g, x, y, rng, heavy) {
  g.fillStyle = vary('#3a352c', 9, rng); g.fillRect(x, y, S, S);
  g.fillStyle = vary('#4a4438', 6, rng); g.fillRect(x + 1, y + 1, S - 2, 2);
  const nc = heavy ? 3 : 1; g.strokeStyle = 'rgba(10,8,5,0.55)'; g.lineWidth = 1;
  for (let c = 0; c < nc; c++) { g.beginPath(); let px = x + rng() * S, py = y + rng() * S; g.moveTo(px, py); for (let s = 0; s < 3; s++) { px += (rng() - 0.5) * S * 0.6; py += (rng() - 0.5) * S * 0.6; g.lineTo(px, py); } g.stroke(); }
  for (let k = 0; k < 2; k++) { g.fillStyle = 'rgba(120,112,90,0.4)'; g.fillRect(x + (rng() * S | 0), y + (rng() * S | 0), 1, 1); }
}
function grassCell(g, x, y, rng, kind) {
  if (kind === 'dirt') { g.fillStyle = vary('#5a4632', 10, rng); g.fillRect(x, y, S, S); for (let k = 0; k < 5; k++) { g.fillStyle = 'rgba(30,20,12,0.4)'; g.fillRect(x + (rng() * S | 0), y + (rng() * S | 0), 1, 1); } return; }
  g.fillStyle = vary('#345e2c', 10, rng); g.fillRect(x, y, S, S);
  for (let k = 0; k < 6; k++) { const bx = x + rng() * S, by = y + rng() * S; g.strokeStyle = rng() < 0.5 ? '#2a4e22' : '#427a36'; g.lineWidth = 1; g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + (rng() - 0.5) * 2, by - 1.5 - rng()); g.stroke(); }
  if (kind === 'flower') { const cols = ['#d87a9e', '#6ea8ff', '#e8d46a'], fc = cols[(rng() * 3) | 0]; g.fillStyle = fc; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(x + 2 + rng() * (S - 4), y + 2 + rng() * (S - 4), 1.3, 0, 7); g.fill(); } }
}

function biome(name) {
  return (g, W, H) => {
    const cols = Math.floor(W / S), rows = Math.floor(H / S);
    for (let r = 0; r < rows; r++) for (let cc = 0; cc < cols; cc++) {
      const rng = C.mulberry32((cc * 73856093) ^ (r * 19349663)), x = cc * S, y = r * S;
      if (name === 'catacombs') slabCell(g, x, y, rng, (cc === 49 || cc === 50) && (r === 17 || r === 18));
      else if (name === 'cursed') cursedCell(g, x, y, rng, (cc === 19 || cc === 20) && (r === 5 || r === 6));
      else if (name === 'undead') undeadCell(g, x, y, rng, r === 22);
      else { let kind = 'grass'; if (cc === 4 && r >= 1 && r <= 3) kind = 'dirt'; else if (r >= 6 && r <= 7 && cc <= 3) kind = 'flower'; grassCell(g, x, y, rng, kind); }
    }
  };
}

function jobs() {
  return [
    { path: 'terrain/catacombs.png', w: 1024, h: 640, ss: 1, draw: biome('catacombs') },
    { path: 'terrain/cursed_ground.png', w: 720, h: 560, ss: 1, draw: biome('cursed') },
    { path: 'terrain/undead_ground.png', w: 496, h: 592, ss: 1, draw: biome('undead') },
    { path: 'terrain/forest_spring.png', w: 256, h: 256, ss: 1, draw: biome('forest') },
  ];
}
module.exports = { jobs };
