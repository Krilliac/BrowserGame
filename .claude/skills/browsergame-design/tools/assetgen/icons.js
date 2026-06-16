/** Loot icons — faceted gems, carved-stone runes, crafting materials (64×64). */
const C = require('./core');

const GEMS = {
  ruby: { dark: '#5e0a1c', mid: '#c41f3e', light: '#ff8a9c', glow: '#ff3b5c' },
  sapphire: { dark: '#12245e', mid: '#2f5bc0', light: '#9fbcff', glow: '#3b6fd2' },
  emerald: { dark: '#0a4a2c', mid: '#1f9e63', light: '#9fecc4', glow: '#2fd07a' },
  topaz: { dark: '#7a3e08', mid: '#e08a1e', light: '#ffd488', glow: '#ffb03a' },
  amethyst: { dark: '#3d1a6e', mid: '#8a44d6', light: '#d6abff', glow: '#9b5cff' },
  jade: { dark: '#155244', mid: '#3f9e7e', light: '#a8ead0', glow: '#5fd0a0' },
  diamond: { dark: '#7f9fc6', mid: '#cdddf2', light: '#ffffff', glow: '#bcd4ff' },
  onyx: { dark: '#0a0b10', mid: '#262932', light: '#5a5f70', glow: '#3a3e4a' },
};
const SEED = { ruby: 11, sapphire: 22, emerald: 33, topaz: 44, amethyst: 55, jade: 66, diamond: 77, onyx: 88, opal: 99 };

function drawGem(g, cx, cy, R, pal, seed, opal) {
  const rng = C.mulberry32(seed);
  C.glow(g, cx, cy, R * 1.7, pal.glow, 0.5);
  const N = 8, rt = R * 0.42, base = -Math.PI / 2, Pn = [], T = [];
  for (let i = 0; i < N; i++) { const a = base + i * 2 * Math.PI / N; Pn.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R * 0.96]); }
  for (let i = 0; i < N; i++) { const a = base + Math.PI / N + i * 2 * Math.PI / N; T.push([cx + Math.cos(a) * rt, cy + Math.sin(a) * rt * 0.96]); }
  const L = [-0.5, -0.84]; const ll = Math.hypot(L[0], L[1]); L[0] /= ll; L[1] /= ll;
  const pastel = ['#ff9ec7', '#9ec7ff', '#9effc7', '#fff0a0', '#c79eff', '#9efff0'];
  function shade(pts, flat) {
    let mx = 0, my = 0; for (const p of pts) { mx += p[0]; my += p[1]; } mx /= pts.length; my /= pts.length;
    let nx = mx - cx, ny = my - cy; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    let b = flat ? 0.82 : 0.5 + 0.5 * (nx * L[0] + ny * L[1]); b += (rng() - 0.5) * 0.12; b = Math.max(0.05, Math.min(1, b));
    C.poly(g, pts);
    if (opal) { const col = pastel[Math.floor(rng() * pastel.length)]; g.fillStyle = C.mix(C.mix('#e9eef7', col, 0.55), '#ffffff', b * 0.4); }
    else g.fillStyle = C.mix3(pal.dark, pal.mid, pal.light, b);
    g.fill();
  }
  for (let i = 0; i < N; i++) shade([Pn[i], Pn[(i + 1) % N], T[i]], false);
  for (let i = 0; i < N; i++) shade([T[(i - 1 + N) % N], Pn[i], T[i]], false);
  shade(T, true);
  g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = R * 0.03; C.poly(g, T); g.stroke();
  g.strokeStyle = opal ? 'rgba(40,44,60,0.8)' : C.mix(pal.dark, C.P.ink950, 0.55); g.lineWidth = R * 0.08; g.lineJoin = 'round'; C.poly(g, Pn); g.stroke();
  const sx = cx - R * 0.32, sy = cy - R * 0.34;
  C.glow(g, sx, sy, R * 0.5, '#ffffff', 0.9);
  g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); g.arc(sx, sy, R * 0.07, 0, 7); g.fill();
}

// Rune glyphs in normalized -1..1 space (y down).
const RUNES = {
  el: [[[0, -0.7], [0, 0.7]], [[0, -0.7], [0.5, -0.3]]],
  dol: [[[-0.4, -0.7], [-0.4, 0.7]], [[-0.4, -0.05], [0.45, -0.55]], [[-0.4, 0.05], [0.45, 0.7]]],
  nef: [[[-0.42, 0.7], [-0.42, -0.7], [0.42, 0.35], [0.42, -0.7]]],
  ort: [[[0, -0.7], [0, 0.7]], [[-0.45, -0.7], [0.45, -0.7]], [[-0.3, 0.35], [0.3, 0.6]]],
  ral: [[[-0.4, 0.7], [-0.4, -0.65], [0.32, -0.65], [0.32, 0.0], [-0.4, 0.0]], [[-0.05, 0.0], [0.42, 0.7]]],
  sol: [[[0.42, -0.5], [-0.3, -0.62], [-0.3, -0.02], [0.3, 0.02], [0.3, 0.62], [-0.42, 0.5]]],
  thul: [[[-0.42, -0.7], [0.42, -0.7]], [[0, -0.7], [0, 0.7]], [[-0.28, 0.62], [0.28, 0.62]]],
  tir: [[[0, -0.72], [0, 0.7]], [[-0.42, -0.38], [0, -0.72], [0.42, -0.38]]],
  vex: [[[-0.46, -0.7], [0, 0.72], [0.46, -0.7]], [[-0.26, -0.12], [0.26, -0.12]]],
  zod: [[[-0.42, -0.62], [0.42, -0.62], [-0.42, 0.62], [0.42, 0.62]]],
};
const HOT = new Set(['vex', 'zod']);

function drawRune(g, w, h, name) {
  const rng = C.mulberry32(name.length * 97 + name.charCodeAt(0));
  const m = w * 0.12, tile = { x: m, y: m, w: w - 2 * m, h: h - 2 * m, r: w * 0.14 };
  const glowCol = HOT.has(name) ? '#ff7a1a' : '#ffb03a';
  const lineCol = HOT.has(name) ? '#ffc070' : '#ffd488';
  C.rr(g, tile.x, tile.y, tile.w, tile.h, tile.r);
  g.fillStyle = C.lg(g, 0, tile.y, 0, tile.y + tile.h, '#2a2d36', '#1b1d24', '#0e0f13'); g.fill();
  g.save(); C.rr(g, tile.x, tile.y, tile.w, tile.h, tile.r); g.clip();
  g.strokeStyle = 'rgba(120,128,148,0.5)'; g.lineWidth = w * 0.04; g.beginPath(); g.moveTo(tile.x, tile.y + tile.h); g.lineTo(tile.x, tile.y); g.lineTo(tile.x + tile.w, tile.y); g.stroke();
  g.strokeStyle = 'rgba(0,0,0,0.6)'; g.beginPath(); g.moveTo(tile.x + tile.w, tile.y); g.lineTo(tile.x + tile.w, tile.y + tile.h); g.lineTo(tile.x, tile.y + tile.h); g.stroke();
  g.restore();
  C.rr(g, tile.x, tile.y, tile.w, tile.h, tile.r); g.strokeStyle = 'rgba(201,162,75,0.55)'; g.lineWidth = w * 0.022; g.stroke();
  const cx = w / 2, cy = h / 2, S = Math.min(tile.w, tile.h) * 0.42, glyph = RUNES[name];
  function drawGlyph(stroke, lw, blur) {
    g.strokeStyle = stroke; g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round';
    g.shadowColor = blur ? glowCol : 'transparent'; g.shadowBlur = blur || 0;
    for (const pl of glyph) { g.beginPath(); pl.forEach((p, i) => { const X = cx + p[0] * S, Y = cy + p[1] * S; i ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.stroke(); }
    g.shadowBlur = 0;
  }
  g.save(); g.translate(w * 0.012, h * 0.012); drawGlyph('rgba(0,0,0,0.7)', S * 0.22, 0); g.restore();
  drawGlyph(lineCol, S * 0.17, S * 0.9); drawGlyph('#fff4d8', S * 0.07, 0);
}

function drawEmberOre(g, w, h) {
  const cx = w / 2, cy = h * 0.56, R = Math.min(w, h) * 0.4, rng = C.mulberry32(5);
  C.glow(g, cx, cy, R * 1.5, '#ff7a1a', 0.4);
  const pts = []; for (let i = 0; i < 9; i++) { const a = i / 9 * 2 * Math.PI, rr = R * (0.78 + rng() * 0.4); pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.92]); }
  C.poly(g, pts); g.fillStyle = C.lg(g, cx, cy - R, cx, cy + R, '#3a3e4a', '#16171d'); g.fill();
  g.strokeStyle = C.P.ink950; g.lineWidth = R * 0.07; g.lineJoin = 'round'; g.stroke();
  g.strokeStyle = '#ff8a3a'; g.lineWidth = R * 0.08; g.lineCap = 'round'; g.shadowColor = '#ff7a1a'; g.shadowBlur = R * 0.4;
  for (let i = 0; i < 4; i++) { g.beginPath(); let x = cx + (rng() - 0.5) * R, y = cy - R * 0.4; g.moveTo(x, y); for (let s = 0; s < 3; s++) { x += (rng() - 0.5) * R * 0.6; y += R * 0.3; g.lineTo(x, y); } g.stroke(); }
  g.shadowBlur = 0; g.fillStyle = '#ffd488'; for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(cx + (rng() - 0.5) * R * 1.2, cy + (rng() - 0.5) * R, R * 0.06, 0, 7); g.fill(); }
}
function drawFrostCore(g, w, h) {
  const cx = w / 2, cy = h * 0.56, R = Math.min(w, h) * 0.38;
  C.glow(g, cx, cy, R * 1.6, '#7fc4ff', 0.5);
  const shards = [[0, -1.3, 0.42], [-0.7, -0.7, 0.3], [0.7, -0.8, 0.34], [-0.3, -0.5, 0.26], [0.35, -0.4, 0.26]];
  for (const [ox, oy, wd] of shards) {
    const tx = cx + ox * R, ty = cy + oy * R, bw = R * wd, bx = cx + ox * R * 0.4;
    C.poly(g, [[tx, ty], [bx - bw * 0.5, cy], [bx, cy + R * 0.15], [bx + bw * 0.5, cy]]);
    g.fillStyle = C.lg(g, tx, ty, bx, cy, '#eaf6ff', '#7fc4ff', '#1e4f8a'); g.fill();
    g.strokeStyle = 'rgba(10,30,60,0.6)'; g.lineWidth = R * 0.04; g.stroke();
  }
  C.glow(g, cx, cy, R * 0.4, '#ffffff', 0.8);
}
function drawRuneShard(g, w, h) {
  const cx = w / 2, cy = h * 0.55, R = Math.min(w, h) * 0.4;
  C.glow(g, cx, cy, R * 1.4, '#ffb03a', 0.4);
  C.poly(g, [[cx - R * 0.5, cy - R * 0.9], [cx + R * 0.55, cy - R * 0.7], [cx + R * 0.35, cy + R * 0.95], [cx - R * 0.45, cy + R * 0.8]]);
  g.fillStyle = C.lg(g, cx, cy - R, cx, cy + R, '#4d5260', '#1b1d24'); g.fill();
  g.strokeStyle = C.P.ink950; g.lineWidth = R * 0.07; g.lineJoin = 'round'; g.stroke();
  g.strokeStyle = '#ffd488'; g.lineWidth = R * 0.1; g.lineCap = 'round'; g.lineJoin = 'round'; g.shadowColor = '#ffb03a'; g.shadowBlur = R * 0.5;
  g.beginPath(); g.moveTo(cx - R * 0.12, cy - R * 0.45); g.lineTo(cx - R * 0.12, cy + R * 0.45); g.lineTo(cx + R * 0.25, cy + R * 0.1); g.moveTo(cx - R * 0.12, cy - R * 0.1); g.lineTo(cx + R * 0.2, cy - R * 0.4); g.stroke();
  g.shadowBlur = 0;
}

function jobs() {
  const out = [];
  for (const name of ['amethyst', 'diamond', 'emerald', 'jade', 'onyx', 'opal', 'ruby', 'sapphire', 'topaz'])
    out.push({ path: `icons/gem-${name}.png`, w: 64, h: 64, ss: 3, grain: 10, draw: (g, w, h) => drawGem(g, w / 2, h * 0.5, Math.min(w, h) * 0.4, GEMS[name] || GEMS.diamond, SEED[name] || 7, name === 'opal') });
  for (const name of Object.keys(RUNES))
    out.push({ path: `icons/rune-${name}.png`, w: 64, h: 64, ss: 3, grain: 9, draw: (g, w, h) => drawRune(g, w, h, name) });
  out.push({ path: 'icons/material-ember-ore.png', w: 64, h: 64, ss: 3, grain: 12, draw: drawEmberOre });
  out.push({ path: 'icons/material-frost-core.png', w: 64, h: 64, ss: 3, grain: 9, draw: drawFrostCore });
  out.push({ path: 'icons/material-rune-shard.png', w: 64, h: 64, ss: 3, grain: 11, draw: drawRuneShard });
  return out;
}
module.exports = { jobs, drawGem, drawRune, GEMS, RUNES };
